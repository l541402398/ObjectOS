import { AppError } from '@projectos/contracts'
import type {
  ChatMessage,
  ChatRequest,
  LlmProvider,
  ProviderStreamEvent,
  ProviderTestResult,
  ToolCallRequest,
} from '@projectos/provider-interfaces'
import { redactSecrets } from '@projectos/policy'

export interface OpenAiCompatibleConfig {
  baseUrl: string
  model: string
  apiKey: string
  temperature?: number
  maxTokens?: number
}

interface WireToolCall {
  index: number
  id: string
  name: string
  arguments: string
}

function endpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}/chat/completions`
}

function wireMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
    }
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      }
    }
    return { role: message.role, content: message.content }
  })
}

function extractUsage(value: unknown): { inputTokens?: number; outputTokens?: number } {
  if (!value || typeof value !== 'object') return {}
  const usage = value as Record<string, unknown>
  const input = usage.prompt_tokens ?? usage.input_tokens
  const output = usage.completion_tokens ?? usage.output_tokens
  return {
    inputTokens: typeof input === 'number' ? input : undefined,
    outputTokens: typeof output === 'number' ? output : undefined,
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return redactSecrets(text.slice(0, 2000))
  } catch {
    return response.statusText
  }
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id = 'openai-compatible'
  readonly model: string
  private readonly config: OpenAiCompatibleConfig

  constructor(config: OpenAiCompatibleConfig) {
    this.config = config
    this.model = config.model
  }

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderStreamEvent> {
    if (!this.config.apiKey) {
      throw new AppError('PROVIDER_NOT_CONFIGURED', '尚未配置 API Key')
    }
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: wireMessages(request.messages),
      stream: true,
      stream_options: { include_usage: true },
    }
    if (request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }))
      body.tool_choice = 'auto'
    }
    const temperature = this.config.temperature ?? request.temperature
    if (temperature !== undefined) body.temperature = temperature
    if (this.config.maxTokens ?? request.maxTokens) body.max_tokens = this.config.maxTokens ?? request.maxTokens

    let response: Response
    try {
      response = await fetch(endpoint(this.config.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
          accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      if (signal.aborted) throw new AppError('CANCELLED', '模型请求已取消')
      throw new AppError('PROVIDER_ERROR', `无法连接模型服务：${(error as Error).message}`)
    }
    if (!response.ok) {
      const detail = await readError(response)
      throw new AppError('PROVIDER_ERROR', `模型服务返回 ${response.status}：${detail}`)
    }
    if (!response.body) {
      throw new AppError('PROVIDER_ERROR', '模型服务没有返回流式响应体')
    }

    const toolCalls = new Map<number, WireToolCall>()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finishReason = 'stop'
    let usage: { inputTokens?: number; outputTokens?: number } = {}

    const processLine = function* (line: string): Generator<ProviderStreamEvent> {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) return
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') return
      let parsed: unknown
      try {
        parsed = JSON.parse(payload)
      } catch {
        return
      }
      if (!parsed || typeof parsed !== 'object') return
      const chunk = parsed as Record<string, unknown>
      const chunkUsage = extractUsage(chunk.usage)
      if (chunkUsage.inputTokens !== undefined || chunkUsage.outputTokens !== undefined) usage = chunkUsage
      const choices = chunk.choices
      if (!Array.isArray(choices) || choices.length === 0) return
      const choice = choices[0] as Record<string, unknown>
      if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason
      const delta = choice.delta
      if (!delta || typeof delta !== 'object') return
      const deltaRecord = delta as Record<string, unknown>
      if (typeof deltaRecord.content === 'string' && deltaRecord.content.length > 0) {
        yield { type: 'text.delta', text: deltaRecord.content }
      }
      if (Array.isArray(deltaRecord.tool_calls)) {
        for (const raw of deltaRecord.tool_calls) {
          const entry = raw as Record<string, unknown>
          const index = typeof entry.index === 'number' ? entry.index : 0
          if (!toolCalls.has(index)) {
            toolCalls.set(index, { index, id: '', name: '', arguments: '' })
          }
          const target = toolCalls.get(index)!
          if (typeof entry.id === 'string' && entry.id) target.id = entry.id
          const fn = entry.function
          if (fn && typeof fn === 'object') {
            const fnRecord = fn as Record<string, unknown>
            if (typeof fnRecord.name === 'string' && fnRecord.name) target.name += fnRecord.name
            if (typeof fnRecord.arguments === 'string') target.arguments += fnRecord.arguments
          }
        }
      }
    }

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        for (const event of processLine(line)) yield event
        newlineIndex = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      for (const event of processLine(buffer)) yield event
    }
    if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) {
      yield { type: 'usage', ...usage }
    }
    for (const call of [...toolCalls.values()].sort((a, b) => a.index - b.index)) {
      if (!call.name) continue
      const request: ToolCallRequest = {
        id: call.id || `call_${Date.now()}_${call.index}`,
        name: call.name,
        arguments: call.arguments || '{}',
      }
      yield { type: 'tool.call', call: request }
    }
    yield { type: 'done', finishReason }
  }

  async test(signal: AbortSignal): Promise<ProviderTestResult> {
    const startedAt = Date.now()
    if (!this.config.apiKey) {
      return { ok: false, latencyMs: 0, message: '尚未配置 API Key' }
    }
    try {
      const response = await fetch(endpoint(this.config.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
          max_tokens: 8,
          temperature: 0,
          stream: false,
        }),
        signal,
      })
      if (!response.ok) {
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          message: `HTTP ${response.status}：${await readError(response)}`,
        }
      }
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
      const content = data.choices?.[0]?.message?.content ?? ''
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        message: content.trim() ? `连接成功 · ${content.trim().slice(0, 80)}` : '连接成功',
      }
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        message: `连接失败：${(error as Error).message}`,
      }
    }
  }
}
