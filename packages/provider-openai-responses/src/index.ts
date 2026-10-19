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

export interface OpenAiResponsesConfig {
  baseUrl: string
  model: string
  apiKey: string
  temperature?: number
  maxTokens?: number
}

interface FunctionCall {
  id: string
  callId: string
  name: string
  arguments: string
  index: number
}

function endpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (trimmed.endsWith('/responses')) return trimmed
  return `${trimmed}/responses`
}

function wireInput(messages: ChatMessage[]): { instructions: string; input: unknown[] } {
  const instructions = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n')
  const input: unknown[] = []
  for (const message of messages) {
    if (message.role === 'system') continue
    if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content })
      continue
    }
    if (message.role === 'assistant') {
      if (message.content) input.push({ role: 'assistant', content: [{ type: 'output_text', text: message.content }] })
      for (const call of message.toolCalls ?? []) {
        input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments })
      }
      continue
    }
    input.push({ role: 'user', content: [{ type: 'input_text', text: message.content }] })
  }
  return { instructions, input }
}

async function readError(response: Response): Promise<string> {
  try {
    return redactSecrets((await response.text()).slice(0, 2000))
  } catch {
    return response.statusText
  }
}

export class OpenAiResponsesProvider implements LlmProvider {
  readonly id = 'openai-responses'
  readonly model: string
  private readonly config: OpenAiResponsesConfig

  constructor(config: OpenAiResponsesConfig) {
    this.config = config
    this.model = config.model
  }

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderStreamEvent> {
    if (!this.config.apiKey) throw new AppError('PROVIDER_NOT_CONFIGURED', '尚未配置 API Key')
    const wire = wireInput(request.messages)
    const body: Record<string, unknown> = {
      model: this.config.model,
      input: wire.input,
      stream: true,
    }
    if (wire.instructions) body.instructions = wire.instructions
    if (request.tools.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }))
    }
    const temperature = this.config.temperature ?? request.temperature
    if (temperature !== undefined) body.temperature = temperature
    if (this.config.maxTokens ?? request.maxTokens) {
      body.max_output_tokens = this.config.maxTokens ?? request.maxTokens
    }

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
    if (!response.ok) throw new AppError('PROVIDER_ERROR', `模型服务返回 ${response.status}：${await readError(response)}`)
    if (!response.body) throw new AppError('PROVIDER_ERROR', '模型服务没有返回流式响应体')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let eventName = ''
    const calls = new Map<string, FunctionCall>()
    let inputTokens: number | undefined
    let outputTokens: number | undefined
    let finishReason = 'stop'

    const process = function* (block: string): Generator<ProviderStreamEvent> {
      let data = ''
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (!data || data === '[DONE]') return
      let event: Record<string, unknown>
      try {
        event = JSON.parse(data) as Record<string, unknown>
      } catch {
        return
      }
      const type = typeof event.type === 'string' ? event.type : eventName
      if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
        yield { type: 'text.delta', text: event.delta }
      } else if (type === 'response.output_item.added') {
        const item = event.item as Record<string, unknown> | undefined
        if (item?.type === 'function_call') {
          const key = typeof item.id === 'string' ? item.id : typeof item.call_id === 'string' ? item.call_id : `call_${calls.size}`
          calls.set(key, {
            id: key,
            callId: typeof item.call_id === 'string' ? item.call_id : key,
            name: typeof item.name === 'string' ? item.name : '',
            arguments: typeof item.arguments === 'string' ? item.arguments : '',
            index: typeof event.output_index === 'number' ? event.output_index : calls.size,
          })
        }
      } else if (type === 'response.function_call_arguments.delta') {
        const itemId = typeof event.item_id === 'string' ? event.item_id : ''
        const call = calls.get(itemId) ?? [...calls.values()].at(-1)
        if (call && typeof event.delta === 'string') call.arguments += event.delta
      } else if (type === 'response.output_item.done') {
        const item = event.item as Record<string, unknown> | undefined
        if (item?.type === 'function_call') {
          const key = typeof item.id === 'string' ? item.id : typeof item.call_id === 'string' ? item.call_id : `call_${calls.size}`
          const call = calls.get(key) ?? {
            id: key,
            callId: typeof item.call_id === 'string' ? item.call_id : key,
            name: typeof item.name === 'string' ? item.name : '',
            arguments: '',
            index: calls.size,
          }
          call.name = typeof item.name === 'string' ? item.name : call.name
          call.arguments = typeof item.arguments === 'string' ? item.arguments : call.arguments
          call.callId = typeof item.call_id === 'string' ? item.call_id : call.callId
          calls.set(key, call)
        }
      } else if (type === 'response.completed') {
        const responseObject = event.response as Record<string, unknown> | undefined
        const usage = responseObject?.usage as Record<string, unknown> | undefined
        if (typeof usage?.input_tokens === 'number') inputTokens = usage.input_tokens
        if (typeof usage?.output_tokens === 'number') outputTokens = usage.output_tokens
        if (typeof responseObject?.status === 'string') finishReason = responseObject.status
      } else if (type === 'response.failed') {
        const error = (event.response as Record<string, unknown> | undefined)?.error as Record<string, unknown> | undefined
        throw new AppError('PROVIDER_ERROR', typeof error?.message === 'string' ? error.message : 'OpenAI Responses 失败')
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
    for (const call of [...calls.values()].sort((a, b) => a.index - b.index)) {
      if (!call.name) continue
      const request: ToolCallRequest = { id: call.callId, name: call.name, arguments: call.arguments || '{}' }
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
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ model: this.config.model, input: 'ping', max_output_tokens: 16 }),
        signal,
      })
      return {
        ok: response.ok,
        latencyMs: Date.now() - startedAt,
        message: response.ok ? 'OpenAI Responses 可用' : `OpenAI 返回 ${response.status}：${await readError(response)}`,
      }
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - startedAt, message: (error as Error).message }
    }
  }
}
