import { AppError, now, type AIConnectionProbe, type ProviderInfo, type ProviderRuntimeConfig } from '@projectos/contracts'
import { OpenAiCompatibleProvider } from '@projectos/provider-openai-compatible'
import { AnthropicMessagesProvider } from '@projectos/provider-anthropic'
import { OpenAiResponsesProvider } from '@projectos/provider-openai-responses'
import type { LlmProvider, ProviderTestResult } from '@projectos/provider-interfaces'

export interface ProviderTestRecord {
  at: number
  ok: boolean
  message: string
}

export class ProviderManager {
  private config: ProviderRuntimeConfig
  private lastTest: ProviderTestRecord | null = null
  private connections = new Map<string, AIConnectionProbe>()

  constructor(initial: ProviderRuntimeConfig) {
    this.config = { ...initial }
  }

  configure(config: ProviderRuntimeConfig): boolean {
    const changed =
      this.config.baseUrl !== config.baseUrl ||
      this.config.model !== config.model ||
      this.config.apiKey !== config.apiKey ||
      this.config.protocol !== config.protocol ||
      this.config.temperature !== config.temperature
    this.config = { ...config }
    if (changed) this.lastTest = null
    return changed
  }

  clear(): void {
    this.config = {
      provider: 'openai-compatible',
      protocol: 'openai-chat',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: '',
      temperature: 0.2,
    }
    this.lastTest = null
  }

  rawConfig(): ProviderRuntimeConfig {
    return { ...this.config }
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey && this.config.baseUrl && this.config.model)
  }

  registerConnections(connections: AIConnectionProbe[]): void {
    this.connections = new Map(connections.map((connection) => [connection.connectionId, connection]))
  }

  hasConnection(connectionId: string): boolean {
    return this.connections.has(connectionId)
  }

  connectionInfo(connectionId: string): AIConnectionProbe | null {
    return this.connections.get(connectionId) ?? null
  }

  createProvider(connectionId?: string | null, modelId?: string | null): LlmProvider {
    if (connectionId) {
      const connection = this.connections.get(connectionId)
      if (
        !connection ||
        !connection.apiKey ||
        !connection.baseUrl ||
        (connection.protocol !== 'openai-chat' &&
          connection.protocol !== 'anthropic-messages' &&
          connection.protocol !== 'openai-responses')
      ) {
        throw new AppError('PROVIDER_NOT_CONFIGURED', '路由选择的 AI 连接未配置可执行密钥')
      }
      if (connection.protocol === 'anthropic-messages') {
        return new AnthropicMessagesProvider({
          baseUrl: connection.baseUrl,
          model: modelId || connection.model,
          apiKey: connection.apiKey,
          temperature: connection.temperature,
        })
      }
      if (connection.protocol === 'openai-responses') {
        return new OpenAiResponsesProvider({
          baseUrl: connection.baseUrl,
          model: modelId || connection.model,
          apiKey: connection.apiKey,
          temperature: connection.temperature,
        })
      }
      return new OpenAiCompatibleProvider({
        baseUrl: connection.baseUrl,
        model: modelId || connection.model,
        apiKey: connection.apiKey,
        temperature: connection.temperature,
      })
    }
    if (!this.isConfigured()) {
      throw new AppError('PROVIDER_NOT_CONFIGURED', '尚未配置模型 Provider，请在设置中填写 API Key')
    }
    if (this.config.protocol === 'anthropic-messages') {
      return new AnthropicMessagesProvider({
        baseUrl: this.config.baseUrl,
        model: this.config.model,
        apiKey: this.config.apiKey,
        temperature: this.config.temperature,
      })
    }
    if (this.config.protocol === 'openai-responses') {
      return new OpenAiResponsesProvider({
        baseUrl: this.config.baseUrl,
        model: this.config.model,
        apiKey: this.config.apiKey,
        temperature: this.config.temperature,
      })
    }
    return new OpenAiCompatibleProvider({
      baseUrl: this.config.baseUrl,
      model: this.config.model,
      apiKey: this.config.apiKey,
      temperature: this.config.temperature,
    })
  }

  info(): ProviderInfo {
    return {
      configured: this.isConfigured(),
      provider: 'openai-compatible',
      baseUrl: this.config.baseUrl,
      model: this.config.model,
      hasKey: Boolean(this.config.apiKey),
      temperature: this.config.temperature,
      lastTestAt: this.lastTest?.at ?? null,
      lastTestOk: this.lastTest?.ok ?? null,
      lastError: this.lastTest && !this.lastTest.ok ? this.lastTest.message : null,
    }
  }

  async test(signal: AbortSignal): Promise<ProviderTestResult> {
    if (!this.isConfigured()) {
      const result = { ok: false, latencyMs: 0, message: '尚未配置 API Key' }
      this.lastTest = { at: now(), ok: false, message: result.message }
      return result
    }
    let provider: LlmProvider
    if (this.config.apiKey) {
      provider =
        this.config.protocol === 'anthropic-messages'
          ? new AnthropicMessagesProvider({
              baseUrl: this.config.baseUrl,
              model: this.config.model,
              apiKey: this.config.apiKey,
            })
          : this.config.protocol === 'openai-responses'
            ? new OpenAiResponsesProvider({
                baseUrl: this.config.baseUrl,
                model: this.config.model,
                apiKey: this.config.apiKey,
              })
            : new OpenAiCompatibleProvider({
                baseUrl: this.config.baseUrl,
                model: this.config.model,
                apiKey: this.config.apiKey,
              })
    } else {
      throw new AppError('PROVIDER_NOT_CONFIGURED', '尚未配置 API Key')
    }
    const result = await provider.test(signal)
    this.lastTest = { at: now(), ok: result.ok, message: result.message }
    return result
  }
}

