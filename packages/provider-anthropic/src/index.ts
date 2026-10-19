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

export interface AnthropicConfig {
  baseUrl: string
  model: string
  apiKey: string
  temperature?: number
  maxTokens?: number
}

interface WireToolCall {
  id: string
  name: string
  json: string
}

function endpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (trimmed.endsWith('/messages')) return trimmed
  return `${trimmed}/messages`
}

function wireMessages(messages: ChatMessage[]): { system: string; messages: unknown[] } {
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n')
  const wire: unknown[] = []
  for (const message of messages) {
    if (message.role === 'system') continue
    if (message.role === 'tool') {
      wire.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }],
      })
      continue
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      wire.push({
        role: 'assistant',
        content: [
          ...(message.content ? [{ type: 'text', text: message.content }] : []),
          ...message.toolCalls.map((call) => ({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: (() => {
              try {
                return JSON.parse(call.arguments || '{}')
              } catch {
                return {}
              }
            })(),
          })),
        ],
      })
      continue
    }
    wire.push({ role: message.role, content: message.content })
  }
  return { system, messages: wire }
}

async function readError(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return redactSecrets(text.slice(0, 2000))
  } catch {
    return response.statusText
  }
}

export class AnthropicMessagesProvider implements LlmProvider {
  readonly id = 'anthropic-messages'
  readonly model: string
  private readonly config: AnthropicConfig

  constructor(config: AnthropicConfig) {
    this.config = config
    this.model = config.model
  }

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderStreamEvent> {
    if (!this.config.apiKey) throw new AppError('PROVIDER_NOT_CONFIGURED', '尚未配置 Anthropic API Key')
    const wire = wireMessages(request.messages)
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? request.maxTokens ?? 4096,
      stream: true,
      messages: wire.messages,
    }
    if (wire.system) body.system = wire.system
    if (request.tools.length) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }))
    }
    if (this.config.temperature !== undefined) body.temperature = this.config.temperature

    let response: Response
    try {
      response = await fetch(endpoint(this.config.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      if (signal.aborted) throw new AppError('CANCELLED', '模型请求已取消')
      throw new AppError('PROVIDER_ERROR', `无法连接 Anthropic：${(error as Error).message}`)
    }
    if (!response.ok) throw new AppError('PROVIDER_ERROR', `Anthropic 返回 ${response.status}：${await readError(response)}`)
    if (!response.body) throw new AppError('PROVIDER_ERROR', 'Anthropic 没有返回流式响应体')

    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    let buffer = ''
    const calls = new Map<number, WireToolCall>()
    let inputTokens: number | undefined
    let outputTokens: number | undefined
    let finishReason = 'stop'

    const process = function* (block: string): Generator<ProviderStreamEvent> {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('')
      if (!data) return
      let event: Record<string, unknown>
      try {
        event = JSON.parse(data) as Record<string, unknown>
      } catch {
        return
      }
      const type = event.type
      if (type === 'message_start') {
        const usage = (event.message as Record<string, unknown> | undefined)?.usage as Record<string, unknown> | undefined
        if (typeof usage?.input_tokens === 'number') inputTokens = usage.input_tokens
      } else if (type === 'content_block_start') {
        const index = typeof event.index === 'number' ? event.index : 0
        const content = event.content_block as Record<string, unknown> | undefined
        if (content?.type === 'tool_use') {
          calls.set(index, {
            id: typeof content.id === 'string' ? content.id : `tool_${index}`,
            name: typeof content.name === 'string' ? content.name : '',
            json: '',
          })
        }
      } else if (type === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown> | undefined
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          yield { type: 'text.delta', text: delta.text }
        }
        if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          const index = typeof event.index === 'number' ? event.index : 0
          const call = calls.get(index)
          if (call) call.json += delta.partial_json
        }
      } else if (type === 'message_delta') {
        const usage = event.usage as Record<string, unknown> | undefined
        if (typeof usage?.output_tokens === 'number') outputTokens = usage.output_tokens
        const delta = event.delta as Record<string, unknown> | undefined
        if (typeof delta?.stop_reason === 'string') finishReason = delta.stop_reason
      }
    }

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf('\n\n')
      while (index >= 0) {
        const block = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        for (const event of process(block)) yield event
        index = buffer.indexOf('\n\n')
      }
    }
    if (buffer.trim()) for (const event of process(buffer)) yield event
    if (inputTokens !== undefined || outputTokens !== undefined) yield { type: 'usage', inputTokens, outputTokens }
    for (const call of calls.values()) {
      if (!call.name) continue
      const request: ToolCallRequest = {
        id: call.id,
        name: call.name,
        arguments: call.json || '{}',
      }
      yield { type: 'tool.call', call: request }
    }
    yield { type: 'done', finishReason }
  }

  async test(signal: AbortSignal): Promise<ProviderTestResult> {
    const startedAt = Date.now()
    if (!this.config.apiKey) return { ok: false, latencyMs: 0, message: '尚未配置 API Key' }
    try {
      const response = await fetch(endpoint(this.config.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal,
      })
      return {
        ok: response.ok,
        latencyMs: Date.now() - startedAt,
        message: response.ok ? 'Anthropic Messages 可用' : `Anthropic 返回 ${response.status}：${await readError(response)}`,
      }
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - startedAt, message: (error as Error).message }
    }
  }
}
