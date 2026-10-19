import {
  AppError,
  newId,
  now,
  type AIConnectionCheck,
  type AIConnectionCreateInput,
  type AIConnectionTestResult,
  type AIConnectionUpdateInput,
  type AIConnectionView,
  type AIModel,
  type AIModelCapabilities,
  type AIModelCreateInput,
  type AgentBackendBinding,
  type AgentBackendBindingUpsert,
  type AIUsageSummary,
} from '@projectos/contracts'
import { classifyFetchError, classifyHttpStatus } from '@projectos/connection-diagnostics'
import type { SqliteStore } from '@projectos/persistence'

const UNKNOWN_CAPABILITIES: AIModelCapabilities = {
  streaming: 'unknown',
  toolCalling: 'unknown',
  vision: 'unknown',
  reasoning: 'unknown',
}

const DEFAULT_CAPABILITIES: AIModelCapabilities = {
  streaming: 'yes',
  toolCalling: 'unknown',
  vision: 'unknown',
  reasoning: 'unknown',
}

function endpoint(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (trimmed.endsWith(path)) return trimmed
  return `${trimmed}${path}`
}

export function validateBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) throw new AppError('BAD_REQUEST', 'Base URL 不能为空')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new AppError('BAD_REQUEST', 'Base URL 不是合法 URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('BAD_REQUEST', 'Base URL 只支持 http/https')
  }
  if (url.username || url.password) {
    throw new AppError('BAD_REQUEST', 'Base URL 不能包含用户名或密码')
  }
  const host = url.hostname.toLowerCase()
  if (
    host === '169.254.169.254' ||
    host === 'metadata.google.internal' ||
    host === '100.100.100.200' ||
    host.endsWith('.metadata.google.internal')
  ) {
    throw new AppError('POLICY_DENIED', '不允许访问云元数据地址')
  }
  return trimmed
}

function abortAfter(ms: number): { controller: AbortController; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { controller, clear: () => clearTimeout(timer) }
}

async function readBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 4000)
  } catch {
    return ''
  }
}

export class AIConnectionService {
  constructor(private readonly store: SqliteStore) {}

  listViews(): AIConnectionView[] {
    return this.store.read.listAIConnectionViews()
  }

  getView(id: string): AIConnectionView {
    const view = this.store.read.getAIConnectionView(id)
    if (!view) throw new AppError('NOT_FOUND', 'AI 连接不存在')
    return view
  }

  getDefault(): AIConnectionView | null {
    const profile = this.store.read.getDefaultAIConnection()
    return profile ? this.store.read.getAIConnectionView(profile.id) : null
  }

  private ensureNativeFields(input: { backendKind: string; baseUrl: string; protocol: string }): string {
    if (input.backendKind !== 'native-llm') {
      throw new AppError('BAD_REQUEST', '本期只支持原生模型连接')
    }
    if (
      input.protocol !== 'openai-chat' &&
      input.protocol !== 'anthropic-messages' &&
      input.protocol !== 'openai-responses'
    ) {
      throw new AppError('PROVIDER_ERROR', '目前仅执行 openai-chat、openai-responses 与 anthropic-messages 协议') 
    }
    return validateBaseUrl(input.baseUrl)
  }

  private ensureModel(connectionId: string, modelId: string, displayName?: string): AIModel {
    const existing = this.store.read.getAIModel(connectionId, modelId)
    if (existing) return existing
    const timestamp = now()
    return this.store.upsertAIModel({
      connectionId,
      modelId,
      displayName: displayName?.trim() || modelId,
      source: 'manual',
      capabilities: UNKNOWN_CAPABILITIES,
      contextWindow: null,
      maxOutputTokens: null,
      verifiedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }

  create(input: AIConnectionCreateInput): AIConnectionView {
    const baseUrl = input.backendKind === 'native-llm' ? this.ensureNativeFields(input) : ''
    const timestamp = now()
    const isFirst = this.store.read.listAIConnections().length === 0
    const profile = this.store.createAIConnection({
      id: newId('aic'),
      name: input.name,
      backendKind: input.backendKind,
      providerId: input.providerId,
      protocol: input.protocol,
      baseUrl,
      defaultModelId: input.defaultModelId?.trim() || null,
      secretRef: null,
      enabled: input.enabled,
      isDefault: input.isDefault || isFirst,
      timeoutMs: input.timeoutMs,
      temperature: input.temperature,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    if (profile.defaultModelId) this.ensureModel(profile.id, profile.defaultModelId)
    return this.getView(profile.id)
  }

  update(input: AIConnectionUpdateInput): AIConnectionView {
    const existing = this.store.read.getAIConnection(input.id)
    if (!existing) throw new AppError('NOT_FOUND', 'AI 连接不存在')
    const next = {
      ...existing,
      name: input.name ?? existing.name,
      backendKind: input.backendKind ?? existing.backendKind,
      providerId: input.providerId ?? existing.providerId,
      protocol: input.protocol ?? existing.protocol,
      baseUrl: input.baseUrl ?? existing.baseUrl,
      defaultModelId:
        input.defaultModelId === undefined ? existing.defaultModelId : input.defaultModelId?.trim() || null,
      temperature: input.temperature ?? existing.temperature,
      timeoutMs: input.timeoutMs ?? existing.timeoutMs,
      enabled: input.enabled ?? existing.enabled,
      isDefault: input.isDefault ?? existing.isDefault,
      updatedAt: now(),
    }
    next.baseUrl = this.ensureNativeFields(next)
    this.store.updateAIConnection(next)
    if (next.defaultModelId) this.ensureModel(next.id, next.defaultModelId)
    return this.getView(next.id)
  }

  delete(id: string): void {
    if (!this.store.read.getAIConnection(id)) throw new AppError('NOT_FOUND', 'AI 连接不存在')
    this.store.deleteAIConnection(id)
  }

  setDefault(id: string): AIConnectionView {
    this.store.setDefaultAIConnection(id)
    return this.getView(id)
  }

  listModels(connectionId: string): AIModel[] {
    if (!this.store.read.getAIConnection(connectionId)) throw new AppError('NOT_FOUND', 'AI 连接不存在')
    return this.store.read.listAIModels(connectionId)
  }

  createModel(input: AIModelCreateInput): AIModel[] {
    const connection = this.store.read.getAIConnection(input.connectionId)
    if (!connection) throw new AppError('NOT_FOUND', 'AI 连接不存在')
    const timestamp = now()
    const existing = this.store.read.getAIModel(input.connectionId, input.modelId)
    this.store.upsertAIModel({
      connectionId: input.connectionId,
      modelId: input.modelId,
      displayName: input.displayName?.trim() || input.modelId,
      source: 'manual',
      capabilities: { ...UNKNOWN_CAPABILITIES, ...input.capabilities },
      contextWindow: input.contextWindow ?? existing?.contextWindow ?? null,
      maxOutputTokens: input.maxOutputTokens ?? existing?.maxOutputTokens ?? null,
      verifiedAt: existing?.verifiedAt ?? null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
    return this.listModels(input.connectionId)
  }

  deleteModel(connectionId: string, modelId: string): AIModel[] {
    this.store.deleteAIModel(connectionId, modelId)
    return this.listModels(connectionId)
  }

  setDefaultModel(connectionId: string, modelId: string): AIConnectionView {
    this.store.setDefaultAIModel(connectionId, modelId)
    return this.getView(connectionId)
  }

  listBindings(): AgentBackendBinding[] {
    return this.store.read.listAgentBackendBindings()
  }

  upsertBinding(input: AgentBackendBindingUpsert): AgentBackendBinding[] {
    if (!input.connectionId) throw new AppError('BAD_REQUEST', '路由必须选择 AI 连接')
    if (!this.store.read.getAIConnection(input.connectionId)) throw new AppError('NOT_FOUND', 'AI 连接不存在')
    if (input.scopeType === 'project' && !input.scopeId) throw new AppError('BAD_REQUEST', '项目级路由必须指定项目')
    if (input.scopeType === 'agent' && !input.agentRole && !input.scopeId) {
      throw new AppError('BAD_REQUEST', 'Agent 路由必须指定角色或 Agent')
    }
    const existing = input.id ? this.listBindings().find((binding) => binding.id === input.id) : null
    if (input.id && !existing) throw new AppError('NOT_FOUND', '路由规则不存在')
    const timestamp = now()
    this.store.upsertAgentBackendBinding({
      id: existing?.id ?? newId('bnd'),
      scopeType: input.scopeType,
      scopeId: input.scopeId ?? null,
      agentRole: input.agentRole ?? null,
      taskType: input.taskType ?? null,
      connectionId: input.connectionId,
      modelId: input.modelId ?? null,
      priority: input.priority,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
    return this.listBindings()
  }

  deleteBinding(id: string): void {
    if (!this.listBindings().some((binding) => binding.id === id)) {
      throw new AppError('NOT_FOUND', '路由规则不存在')
    }
    this.store.deleteAgentBackendBinding(id)
  }

  usageSummary(projectId?: string): AIUsageSummary {
    return this.store.read.summarizeAIUsage(projectId)
  }

  resolveForRun(input: {
    projectId: string
    agentId: string
    agentRole: string
    taskId?: string | null
  }): { connectionId: string; modelId: string | null } | null {
    const connections = new Map(
      this.listViews()
        .filter((connection) => connection.enabled && connection.backendKind === 'native-llm' && (connection.protocol === 'openai-chat' || connection.protocol === 'anthropic-messages' || connection.protocol === 'openai-responses'))
        .map((connection) => [connection.id, connection]),
    )
    const scored = this.listBindings()
      .filter((binding) => binding.connectionId && connections.has(binding.connectionId))
      .map((binding) => {
        let specificity = -1
        if (binding.scopeType === 'task' && input.taskId && binding.scopeId === input.taskId) specificity = 40
        else if (binding.scopeType === 'agent' && (binding.scopeId === input.agentId || binding.agentRole === input.agentRole)) specificity = 30
        else if (binding.scopeType === 'project' && binding.scopeId === input.projectId) specificity = 20
        else if (binding.scopeType === 'global') specificity = 10
        return specificity < 0 ? null : { binding, score: specificity + binding.priority }
      })
      .filter((item): item is { binding: AgentBackendBinding; score: number } => item !== null)
      .sort((a, b) => b.score - a.score)
    const selected = scored[0]?.binding
    if (selected?.connectionId) {
      return { connectionId: selected.connectionId, modelId: selected.modelId }
    }
    const fallback = this.getDefault()
    if (!fallback || !fallback.enabled || (fallback.protocol !== 'openai-chat' && fallback.protocol !== 'anthropic-messages' && fallback.protocol !== 'openai-responses')) return null
    return { connectionId: fallback.id, modelId: fallback.defaultModelId }
  }

  private check(
    connectionId: string,
    stage: AIConnectionCheck['stage'],
    status: AIConnectionCheck['status'],
    message: string,
    latencyMs: number,
    errorCode: AIConnectionCheck['errorCode'] = null,
  ): AIConnectionCheck {
    return {
      id: newId('ack'),
      connectionId,
      stage,
      status,
      errorCode,
      message,
      latencyMs,
      checkedAt: now(),
    }
  }

  async test(profile: AIConnectionView, apiKey: string): Promise<AIConnectionTestResult> {
    const startedAt = Date.now()
    const stages: AIConnectionCheck[] = []
    const finish = (code: AIConnectionCheck['errorCode'], message: string, httpStatus: number | null = null) => {
      const result: AIConnectionTestResult = {
        ok: code === null,
        code: code ?? 'UNKNOWN',
        message,
        latencyMs: Date.now() - startedAt,
        httpStatus,
        checkedAt: now(),
        stages,
      }
      for (const stage of stages) this.store.recordAIConnectionCheck(stage)
      return result
    }

    const l1Start = Date.now()
    try {
      validateBaseUrl(profile.baseUrl)
      if (!apiKey) {
        const check = this.check(profile.id, 'L1', 'failed', '未保存 API Key', Date.now() - l1Start, 'INVALID_KEY')
        stages.push(check)
        return finish('INVALID_KEY', '未保存 API Key')
      }
      if (profile.protocol !== 'openai-chat') {
        const check = this.check(
          profile.id,
          'L1',
          'failed',
          '当前执行器只支持 openai-chat 协议',
          Date.now() - l1Start,
          'PROTOCOL_MISMATCH',
        )
        stages.push(check)
        return finish('PROTOCOL_MISMATCH', '当前执行器只支持 openai-chat 协议')
      }
      stages.push(this.check(profile.id, 'L1', 'passed', '配置有效', Date.now() - l1Start))
    } catch (error) {
      const classified = classifyFetchError(error)
      const check = this.check(profile.id, 'L1', 'failed', classified.message, Date.now() - l1Start, classified.code)
      stages.push(check)
      return finish(classified.code, classified.message)
    }

    const l2Start = Date.now()
    let httpStatus: number | null = null
    const l2 = abortAfter(profile.timeoutMs)
    try {
      const response = await fetch(endpoint(profile.baseUrl, '/models'), {
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
        signal: l2.controller.signal,
      })
      httpStatus = response.status
      if (response.ok) {
        stages.push(this.check(profile.id, 'L2', 'passed', '服务可达', Date.now() - l2Start))
      } else if (response.status === 404 || response.status === 405) {
        stages.push(
          this.check(profile.id, 'L2', 'passed', '服务可达；/models 不可用', Date.now() - l2Start),
        )
      } else {
        const body = await readBody(response)
        const classified = classifyHttpStatus(response.status, body)
        stages.push(
          this.check(profile.id, 'L2', 'failed', classified.message, Date.now() - l2Start, classified.code),
        )
        return finish(classified.code, classified.message, response.status)
      }
    } catch (error) {
      const classified = classifyFetchError(error)
      stages.push(this.check(profile.id, 'L2', 'failed', classified.message, Date.now() - l2Start, classified.code))
      return finish(classified.code, classified.message)
    } finally {
      l2.clear()
    }

    const l3Start = Date.now()
    const l3 = abortAfter(profile.timeoutMs)
    try {
      const response = await fetch(endpoint(profile.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          model: profile.defaultModelId ?? 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
          max_tokens: 8,
          temperature: 0,
          stream: false,
        }),
        signal: l3.controller.signal,
      })
      httpStatus = response.status
      if (!response.ok) {
        const body = await readBody(response)
        const classified = classifyHttpStatus(response.status, body)
        stages.push(
          this.check(profile.id, 'L3', 'failed', classified.message, Date.now() - l3Start, classified.code),
        )
        return finish(classified.code, classified.message, response.status)
      }
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
      const content = data.choices?.[0]?.message?.content ?? ''
      if (!Array.isArray(data.choices)) {
        const check = this.check(
          profile.id,
          'L3',
          'failed',
          '响应不是 OpenAI chat completion 格式',
          Date.now() - l3Start,
          'PROTOCOL_MISMATCH',
        )
        stages.push(check)
        return finish('PROTOCOL_MISMATCH', check.message, response.status)
      }
      stages.push(
        this.check(
          profile.id,
          'L3',
          'passed',
          content.trim() ? `推理成功 · ${content.trim().slice(0, 80)}` : '推理成功',
          Date.now() - l3Start,
        ),
      )
      const modelId = profile.defaultModelId
      if (modelId) this.store.upsertAIModelCapabilities(profile.id, modelId, { streaming: 'yes' }, now())
      return finish(null, '连接成功', httpStatus)
    } catch (error) {
      const classified = classifyFetchError(error)
      stages.push(this.check(profile.id, 'L3', 'failed', classified.message, Date.now() - l3Start, classified.code))
      return finish(classified.code, classified.message, httpStatus)
    } finally {
      l3.clear()
    }
  }

  async discoverModels(profile: AIConnectionView, apiKey: string): Promise<AIModel[]> {
    validateBaseUrl(profile.baseUrl)
    if (!apiKey) throw new AppError('PROVIDER_ERROR', '未保存 API Key')
    const timeout = abortAfter(profile.timeoutMs)
    try {
      const response = await fetch(endpoint(profile.baseUrl, '/models'), {
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
        signal: timeout.controller.signal,
      })
      if (!response.ok) {
        const body = await readBody(response)
        const classified = classifyHttpStatus(response.status, body)
        throw new AppError(classified.code === 'MODEL_NOT_FOUND' ? 'NOT_FOUND' : 'PROVIDER_ERROR', classified.message, {
          details: { code: classified.code },
        })
      }
      const data = (await response.json()) as { data?: Array<{ id?: string; name?: string }> }
      if (!Array.isArray(data.data)) {
        throw new AppError('PROVIDER_ERROR', '模型列表响应格式不正确')
      }
      const timestamp = now()
      const models: AIModel[] = []
      for (const item of data.data) {
        if (!item || typeof item.id !== 'string' || !item.id.trim()) continue
        const existing = this.store.read.getAIModel(profile.id, item.id)
        models.push(
          this.store.upsertAIModel({
            connectionId: profile.id,
            modelId: item.id,
            displayName: item.name?.trim() || existing?.displayName || item.id,
            source: existing?.source ?? 'discovered',
            capabilities: existing?.capabilities ?? DEFAULT_CAPABILITIES,
            contextWindow: existing?.contextWindow ?? null,
            maxOutputTokens: existing?.maxOutputTokens ?? null,
            verifiedAt: existing?.verifiedAt ?? null,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
          }),
        )
      }
      return this.listModels(profile.id)
    } catch (error) {
      if (error instanceof AppError) throw error
      const classified = classifyFetchError(error)
      throw new AppError('PROVIDER_ERROR', classified.message)
    } finally {
      timeout.clear()
    }
  }
}
