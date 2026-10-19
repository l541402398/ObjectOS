export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCallRequest {
  id: string
  name: string
  arguments: string
}

export interface ChatMessage {
  role: ChatRole
  content: string
  toolCallId?: string
  toolCalls?: ToolCallRequest[]
}

export interface JsonSchema {
  type: string
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
  [key: string]: unknown
}

export interface LlmToolDefinition {
  name: string
  description: string
  parameters: JsonSchema
}

export interface ChatRequest {
  messages: ChatMessage[]
  tools: LlmToolDefinition[]
  temperature?: number
  maxTokens?: number
}

export type ProviderStreamEvent =
  | { type: 'text.delta'; text: string }
  | { type: 'tool.call'; call: ToolCallRequest }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'done'; finishReason: string }

export interface ProviderTestResult {
  ok: boolean
  latencyMs: number
  message: string
}

export interface LlmProvider {
  readonly id: string
  readonly model: string
  stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderStreamEvent>
  test(signal: AbortSignal): Promise<ProviderTestResult>
}

export class ProviderNotConfiguredError extends Error {
  constructor() {
    super('尚未配置模型 Provider，请在设置中填写 Base URL、模型与 API Key')
    this.name = 'ProviderNotConfiguredError'
  }
}
