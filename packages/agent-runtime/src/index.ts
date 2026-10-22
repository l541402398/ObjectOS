import type {
  ChatMessage,
  LlmProvider,
  LlmToolDefinition,
  ToolCallRequest,
} from '@projectos/provider-interfaces'

export interface ToolInvocation {
  callId: string
  name: string
  args: Record<string, unknown>
  rawArguments: string
}

export type ToolOutcome =
  | { status: 'completed'; result: unknown; display?: string }
  | { status: 'paused'; approvalId: string }
  | { status: 'denied'; error: string }
  | { status: 'failed'; error: string }

export interface AssistantTurn {
  content: string
  toolCalls: ToolCallRequest[]
}

export interface AgentLoopResult {
  status: 'completed' | 'waiting_approval' | 'failed' | 'cancelled'
  text: string
  messages: ChatMessage[]
  error?: string
  approvalId?: string
  inputTokens?: number
  outputTokens?: number
  steps: number
}

export interface AgentLoopOptions {
  provider: LlmProvider
  tools: LlmToolDefinition[]
  messages: ChatMessage[]
  maxSteps?: number
  signal: AbortSignal
  onTextDelta?: (text: string) => void | Promise<void>
  onAssistantTurn?: (turn: AssistantTurn) => void | Promise<void>
  onToolResult?: (invocation: ToolInvocation, outcome: ToolOutcome) => void | Promise<void>
  onUsage?: (usage: { inputTokens?: number; outputTokens?: number }) => void
  executeTool: (invocation: ToolInvocation) => Promise<ToolOutcome>
}

/**
 * OpenAI-compatible providers reject a request when an assistant message with
 * tool_calls is not immediately followed by one tool message per call id. The
 * persisted run transcript can contain a missing result after a pause, crash,
 * denial, or a killed tool. Repair it with an explicit, non-fake failure result
 * instead of dropping the call or pretending it succeeded.
 */
export function repairToolCallTranscript(messages: ChatMessage[]): ChatMessage[] {
  const repaired: ChatMessage[] = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    if (message.role === 'assistant' && message.toolCalls?.length) {
      repaired.push(message)
      const expected = message.toolCalls.map((call) => call.id)
      const following: ChatMessage[] = []
      let cursor = index + 1
      while (cursor < messages.length && messages[cursor]?.role === 'tool') {
        following.push(messages[cursor]!)
        cursor += 1
      }
      const byCallId = new Map<string, ChatMessage>()
      for (const toolMessage of following) {
        if (toolMessage.role === 'tool' && toolMessage.toolCallId && expected.includes(toolMessage.toolCallId)) {
          byCallId.set(toolMessage.toolCallId, toolMessage)
        }
      }
      for (const call of message.toolCalls) {
        repaired.push(
          byCallId.get(call.id) ?? {
            role: 'tool',
            toolCallId: call.id,
            content: JSON.stringify({
              ok: false,
              error: 'tool result missing from persisted transcript; the tool was not executed',
              missingToolResult: true,
            }),
          },
        )
      }
      index = cursor - 1
      continue
    }
    if (message.role === 'tool') {
      // Orphan results are dropped; they cannot be paired with a preceding
      // assistant tool_calls message.
      continue
    }
    repaired.push(message)
  }
  return repaired
}

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

function toolResultContent(outcome: ToolOutcome): string {
  if (outcome.status === 'completed') {
    return JSON.stringify({ ok: true, result: outcome.result }).slice(0, 60_000)
  }
  if (outcome.status === 'denied') {
    return JSON.stringify({ ok: false, error: outcome.error, denied: true })
  }
  if (outcome.status === 'failed') {
    return JSON.stringify({ ok: false, error: outcome.error })
  }
  return JSON.stringify({ ok: false, error: 'awaiting approval' })
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  let messages = repairToolCallTranscript(options.messages.map((message) => ({ ...message })))
  const maxSteps = options.maxSteps ?? 8
  let lastText = ''
  let inputTokens = 0
  let outputTokens = 0

  for (let step = 0; step < maxSteps; step += 1) {
    if (options.signal.aborted) {
      return { status: 'cancelled', text: lastText, messages, steps: step }
    }
    let content = ''
    const toolCalls: ToolCallRequest[] = []
    messages = repairToolCallTranscript(messages)
    try {
      for await (const event of options.provider.stream(
        {
          messages,
          tools: options.tools,
        },
        options.signal,
      )) {
        if (event.type === 'text.delta') {
          content += event.text
          lastText += event.text
          if (options.onTextDelta) await options.onTextDelta(event.text)
        } else if (event.type === 'tool.call') {
          toolCalls.push(event.call)
        } else if (event.type === 'usage') {
          inputTokens += event.inputTokens ?? 0
          outputTokens += event.outputTokens ?? 0
          options.onUsage?.({ inputTokens: event.inputTokens, outputTokens: event.outputTokens })
        }
      }
    } catch (error) {
      if (options.signal.aborted) {
        return { status: 'cancelled', text: lastText, messages, steps: step, inputTokens, outputTokens }
      }
      return {
        status: 'failed',
        text: lastText,
        messages,
        error: error instanceof Error ? error.message : String(error),
        steps: step,
        inputTokens,
        outputTokens,
      }
    }

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    }
    messages.push(assistantMessage)
    if (options.onAssistantTurn) {
      await options.onAssistantTurn({ content, toolCalls })
    }

    if (toolCalls.length === 0) {
      return { status: 'completed', text: lastText, messages, steps: step + 1, inputTokens, outputTokens }
    }

    for (const toolCall of toolCalls) {
      const invocation: ToolInvocation = {
        callId: toolCall.id,
        name: toolCall.name,
        args: parseArguments(toolCall.arguments),
        rawArguments: toolCall.arguments,
      }
      let outcome: ToolOutcome
      try {
        outcome = await options.executeTool(invocation)
      } catch (error) {
        outcome = { status: 'failed', error: error instanceof Error ? error.message : String(error) }
      }
      if (options.onToolResult) await options.onToolResult(invocation, outcome)
      if (outcome.status === 'paused') {
        return {
          status: 'waiting_approval',
          text: lastText,
          messages,
          approvalId: outcome.approvalId,
          steps: step + 1,
          inputTokens,
          outputTokens,
        }
      }
      messages.push({
        role: 'tool',
        toolCallId: toolCall.id,
        content: toolResultContent(outcome),
      })
    }
  }

  return {
    status: 'failed',
    text: lastText,
    messages,
    error: `达到最大工具轮次（${maxSteps}），运行已暂停以避免失控`,
    steps: maxSteps,
    inputTokens,
    outputTokens,
  }
}
