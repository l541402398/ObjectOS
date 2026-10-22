import { AppError, type AIConnectionView } from '@projectos/contracts'
import type { LlmProvider } from '@projectos/provider-interfaces'
import type { AIConnectionService } from './ai-connections.js'
import type { ProviderManager } from './provider-manager.js'

/**
 * The Planner deliberately reuses the existing AI connection / default model
 * mechanism. There is no ModelRouter and no Agent routing here: the target is
 * either the user's default native AI connection or the legacy single-provider
 * configuration that the runtime already owns.
 */
export interface PlannerModelTarget {
  provider: LlmProvider
  connectionId: string | null
  connectionName: string | null
  model: string
  protocol: string
}

export interface PlannerModelSource {
  resolve(): PlannerModelTarget
}

const NATIVE_PROTOCOLS = new Set(['openai-chat', 'openai-responses', 'anthropic-messages'])

export class AiPlannerModelSource implements PlannerModelSource {
  constructor(
    private readonly provider: ProviderManager,
    private readonly connections: AIConnectionService,
  ) {}

  resolve(): PlannerModelTarget {
    const connection: AIConnectionView | null = this.connections.getDefault()
    if (connection) {
      if (!connection.enabled) {
        throw new AppError(
          'PROVIDER_NOT_CONFIGURED',
          `默认 AI 连接「${connection.name}」已停用。请在设置中启用它或切换默认连接。`,
        )
      }
      if (connection.backendKind !== 'native-llm' || !NATIVE_PROTOCOLS.has(connection.protocol)) {
        throw new AppError(
          'PROVIDER_NOT_CONFIGURED',
          `默认 AI 连接「${connection.name}」不是可用的原生模型连接（${connection.backendKind}/${connection.protocol}）。AI Planner 只调用原生模型连接。`,
        )
      }
      if (!connection.defaultModelId) {
        throw new AppError(
          'PROVIDER_NOT_CONFIGURED',
          `默认 AI 连接「${connection.name}」没有默认模型。请在设置中选择模型后重试。`,
        )
      }
      if (!this.provider.hasConnection(connection.id)) {
        throw new AppError(
          'PROVIDER_NOT_CONFIGURED',
          `默认 AI 连接「${connection.name}」的凭据尚未同步到 Runtime。请打开设置，重新保存或测试该连接后重试。`,
        )
      }
      return {
        provider: this.provider.createProvider(connection.id, connection.defaultModelId),
        connectionId: connection.id,
        connectionName: connection.name,
        model: connection.defaultModelId,
        protocol: connection.protocol,
      }
    }

    if (!this.provider.isConfigured()) {
      throw new AppError(
        'PROVIDER_NOT_CONFIGURED',
        '尚未配置可用的 AI 连接。请打开设置 → AI 连接，填写 Base URL、模型与 API Key 后重试。',
      )
    }
    const config = this.provider.rawConfig()
    return {
      provider: this.provider.createProvider(),
      connectionId: null,
      connectionName: '默认 Provider',
      model: config.model,
      protocol: config.protocol,
    }
  }
}
