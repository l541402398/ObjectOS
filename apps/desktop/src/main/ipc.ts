import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  ApiSchemas,
  AppError,
  isApiMethod,
  isMainMethod,
  serializeError,
  type AIConnectionCreateInput,
  type AIConnectionList,
  type AIConnectionUpdateInput,
  type AIConnectionView,
  type AIModelList,
  type ApprovalView,
  type ProjectStats,
  type ProjectSummary,
  type ProviderInfo,
  type SerializedAppError,
} from '@projectos/contracts'
import type { MainLogger } from './logger.js'
import type { ProviderConfigStore } from './provider-config.js'
import type { ConnectionSecretStore } from './connection-secrets.js'
import type { ResourceCredentialVault } from './resource-credentials.js'
import { testSshConnection } from './resource-connection.js'
import { executeSshDeployment } from './ssh-deploy.js'
import type { RuntimeSupervisor } from './runtime-supervisor.js'

export interface IpcContext {
  supervisor: RuntimeSupervisor
  providerConfig: ProviderConfigStore
  connectionSecrets: ConnectionSecretStore
  resourceSecrets: ResourceCredentialVault
  dataDir: string
  window: BrowserWindow
  logger: MainLogger
}

interface HandlerResult {
  ok: boolean
  result?: unknown
  error?: SerializedAppError
}

function aggregateStats(projects: ProjectSummary[]): ProjectStats {
  const total = projects.reduce((sum, project) => sum + project.stats.tasksTotal, 0)
  const done = projects.reduce((sum, project) => sum + project.stats.tasksDone, 0)
  const cancelled = projects.reduce((sum, project) => sum + project.stats.tasksCancelled, 0)
  return {
    tasksTotal: total,
    tasksDone: done,
    tasksCancelled: cancelled,
    tasksRunning: projects.reduce((sum, project) => sum + project.stats.tasksRunning, 0),
    tasksReview: projects.reduce((sum, project) => sum + project.stats.tasksReview, 0),
    progress: total === 0 ? 0 : (done + cancelled) / total,
    requirementsApproved: projects.reduce((sum, project) => sum + project.stats.requirementsApproved, 0),
    milestonesTotal: projects.reduce((sum, project) => sum + project.stats.milestonesTotal, 0),
    milestonesCompleted: projects.reduce((sum, project) => sum + project.stats.milestonesCompleted, 0),
    artifacts: projects.reduce((sum, project) => sum + project.stats.artifacts, 0),
    activeRuns: projects.reduce((sum, project) => sum + project.stats.activeRuns, 0),
    pendingApprovals: projects.reduce((sum, project) => sum + project.stats.pendingApprovals, 0),
    sessions: projects.reduce((sum, project) => sum + project.stats.sessions, 0),
  }
}

export function registerIpc(ctx: IpcContext): () => void {
  const { supervisor, providerConfig, connectionSecrets, resourceSecrets, window, logger } = ctx

  const syncProvider = async (): Promise<void> => {
    if (!supervisor.isReady()) return
    await supervisor.request('runtime.provider.configure', providerConfig.runtimeConfig(), 10_000)
  }

  const aiRegistry = async <T>(action: unknown): Promise<T> => {
    if (!supervisor.isReady()) throw new AppError('RUNTIME_UNAVAILABLE', 'Runtime 尚未就绪')
    return supervisor.request<T>('runtime.ai.registry', action, 25_000)
  }

  const withSecretState = (view: AIConnectionView): AIConnectionView => ({
    ...view,
    hasSecret: connectionSecrets.has(view.id),
  })

  const listConnections = async (): Promise<AIConnectionList> => {
    const result = await aiRegistry<AIConnectionList>({ action: 'list' })
    return {
      connections: result.connections.map(withSecretState),
      defaultId: result.defaultId,
    }
  }

  const ensureLegacyConnection = async (force = false): Promise<void> => {
    if (!supervisor.isReady()) return
    const list = await aiRegistry<AIConnectionList>({ action: 'list' })
    if (list.connections.length > 0) {
      if (!providerConfig.isConnectionMigrationDone()) providerConfig.markConnectionMigrationDone()
      return
    }
    if (providerConfig.isConnectionMigrationDone() && !force) return
    const legacy = providerConfig.runtimeConfig()
    if (!force && !providerConfig.hasConfigFile() && !legacy.apiKey) {
      providerConfig.markConnectionMigrationDone()
      return
    }
    try {
      const created = await aiRegistry<AIConnectionView>({
        action: 'create',
        input: {
          name: 'Legacy OpenAI-compatible',
          backendKind: 'native-llm',
          providerId: 'openai',
          protocol: 'openai-chat',
          baseUrl: legacy.baseUrl,
          defaultModelId: legacy.model,
          temperature: legacy.temperature,
          timeoutMs: 30_000,
          enabled: true,
          isDefault: true,
        },
      })
      if (legacy.apiKey) {
        try {
          connectionSecrets.set(created.id, legacy.apiKey)
          await aiRegistry<AIConnectionView>({
            action: 'setSecretRef',
            id: created.id,
            secretRef: `vault:${created.id}`,
          })
        } catch (error) {
          logger.warn('legacy key migration failed; connection requires re-authorization', {
            connectionId: created.id,
            error: String(error),
          })
        }
      }
      providerConfig.markConnectionMigrationDone()
    } catch (error) {
      logger.warn('failed to migrate legacy provider config', { error: String(error) })
    }
  }

  const clearRuntimeProvider = async (): Promise<void> => {
    try {
      await supervisor.request('runtime.provider.clear', {}, 5_000)
    } catch (error) {
      logger.warn('failed to clear runtime provider', { error: String(error) })
    }
  }

  const syncDefaultProvider = async (): Promise<void> => {
    if (!supervisor.isReady()) return
    const profile = await aiRegistry<AIConnectionView | null>({ action: 'getDefault' })
    if (
      !profile ||
      !profile.enabled ||
      !profile.baseUrl ||
      !profile.defaultModelId ||
      (profile.protocol !== 'openai-chat' &&
        profile.protocol !== 'anthropic-messages' &&
        profile.protocol !== 'openai-responses')
    ) {
      await clearRuntimeProvider()
      return
    }
    const apiKey = connectionSecrets.get(profile.id) ?? ''
    if (!apiKey) {
      await clearRuntimeProvider()
      return
    }
    await supervisor.request(
      'runtime.provider.configure',
      {
        provider: 'openai-compatible',
        protocol: profile.protocol,
        baseUrl: profile.baseUrl,
        model: profile.defaultModelId,
        apiKey,
        temperature: profile.temperature,
      },
      10_000,
    )
    providerConfig.syncFromConnection({
      baseUrl: profile.baseUrl,
      model: profile.defaultModelId,
      temperature: profile.temperature,
      apiKey,
    })
  }

  const syncConnectionCredentials = async (): Promise<void> => {
    if (!supervisor.isReady()) return
    try {
      const list = await listConnections()
      const connections = list.connections
        .filter(
          (profile) =>
            profile.enabled &&
            profile.backendKind === 'native-llm' &&
            (profile.protocol === 'openai-chat' || profile.protocol === 'anthropic-messages' || profile.protocol === 'openai-responses') &&
            profile.baseUrl &&
            profile.defaultModelId,
        )
        .map((profile) => ({
          connectionId: profile.id,
          name: profile.name,
          protocol: profile.protocol,
          baseUrl: profile.baseUrl,
          model: profile.defaultModelId ?? '',
          apiKey: connectionSecrets.get(profile.id) ?? '',
          timeoutMs: profile.timeoutMs,
          temperature: profile.temperature,
        }))
        .filter((profile) => Boolean(profile.apiKey))
      await supervisor.request('runtime.ai.credentials', { connections }, 10_000)
    } catch (error) {
      logger.warn('failed to sync connection credentials', { error: String(error) })
    }
  }

  const findConnection = async (id: string): Promise<AIConnectionView> => {
    const list = await listConnections()
    const found = list.connections.find((connection) => connection.id === id)
    if (!found) throw new AppError('NOT_FOUND', 'AI 连接不存在')
    return found
  }

  const probeInput = (profile: AIConnectionView, apiKey: string) => ({
    connectionId: profile.id,
    name: profile.name,
    protocol: profile.protocol,
    baseUrl: profile.baseUrl,
    model: profile.defaultModelId ?? '',
    apiKey,
    timeoutMs: profile.timeoutMs,
    temperature: profile.temperature,
  })

  const providerInfo = async (): Promise<ProviderInfo> => {
    if (!supervisor.isReady()) return providerConfig.info()
    try {
      const info = await supervisor.request<ProviderInfo>('provider.status', {}, 5_000)
      return providerConfig.info(info)
    } catch {
      return providerConfig.info()
    }
  }

  const handleMain = async (method: string, input: Record<string, unknown>): Promise<unknown> => {
    switch (method) {
      case 'app.bootstrap': {
        await supervisor.waitForReady(25_000)
        await ensureLegacyConnection()
        await syncDefaultProvider()
        await syncConnectionCredentials()
        const [projectResult, approvalResult] = await Promise.all([
          supervisor.request<{ projects: ProjectSummary[] }>('project.list', { includeArchived: false }),
          supervisor.request<{ approvals: ApprovalView[] }>('approval.list', {}),
        ])
        const projects = projectResult.projects
        const activities = await Promise.all(
          projects.slice(0, 6).map(async (project) => {
            try {
              const result = await supervisor.request<{ events: Array<{ createdAt: number }> }>(
                'project.activity',
                { projectId: project.id, limit: 6 },
              )
              return result.events
            } catch {
              return []
            }
          }),
        )
        const recentActivity = activities
          .flat()
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 10)
        return {
          projects,
          stats: aggregateStats(projects),
          provider: await providerInfo(),
          runtime: supervisor.getStatus(),
          pendingApprovals: approvalResult.approvals.filter((approval) => approval.status === 'pending'),
          recentActivity,
        }
      }
      case 'settings.get':
        return providerInfo()
      case 'settings.update': {
        providerConfig.update({
          baseUrl: String(input.baseUrl ?? ''),
          model: String(input.model ?? ''),
          apiKey: typeof input.apiKey === 'string' ? input.apiKey : undefined,
          temperature: typeof input.temperature === 'number' ? input.temperature : 0.2,
        })
        try {
          await syncProvider()
          await ensureLegacyConnection(true)
          await syncDefaultProvider()
        await syncConnectionCredentials()
        } catch (error) {
          logger.warn('saved provider config but runtime sync failed', { error: String(error) })
        }
        return providerInfo()
      }
      case 'settings.clearKey': {
        providerConfig.clearKey()
        try {
          const profile = await aiRegistry<AIConnectionView | null>({ action: 'getDefault' })
          if (profile) {
            connectionSecrets.delete(profile.id)
            await aiRegistry({ action: 'setSecretRef', id: profile.id, secretRef: null })
          }
          await syncProvider()
          await syncDefaultProvider()
        await syncConnectionCredentials()
        } catch (error) {
          logger.warn('cleared provider key but runtime sync failed', { error: String(error) })
        }
        return providerInfo()
      }
      case 'aiConnections.list': {
        await ensureLegacyConnection()
        return listConnections()
      }
      case 'aiConnections.create': {
        const parsedInput = input as unknown as AIConnectionCreateInput
        const { apiKey, ...profileInput } = parsedInput
        const created = await aiRegistry<AIConnectionView>({ action: 'create', input: profileInput })
        if (apiKey?.trim()) {
          try {
            connectionSecrets.set(created.id, apiKey)
            await aiRegistry({
              action: 'setSecretRef',
              id: created.id,
              secretRef: `vault:${created.id}`,
            })
          } catch (error) {
            await aiRegistry({ action: 'delete', id: created.id }).catch(() => undefined)
            throw error
          }
        }
        await syncDefaultProvider()
        await syncConnectionCredentials()
        return withSecretState(await findConnection(created.id))
      }
      case 'aiConnections.update': {
        const parsedInput = input as unknown as AIConnectionUpdateInput
        const { apiKey, ...patch } = parsedInput
        const updated = await aiRegistry<AIConnectionView>({ action: 'update', input: patch })
        if (apiKey?.trim()) {
          connectionSecrets.set(updated.id, apiKey)
          await aiRegistry({ action: 'setSecretRef', id: updated.id, secretRef: `vault:${updated.id}` })
        }
        await syncDefaultProvider()
        await syncConnectionCredentials()
        return withSecretState(await findConnection(updated.id))
      }
      case 'aiConnections.delete': {
        const id = String(input.id)
        await aiRegistry({ action: 'delete', id })
        connectionSecrets.delete(id)
        await syncDefaultProvider()
        await syncConnectionCredentials()
        return { ok: true }
      }
      case 'aiConnections.setDefault': {
        const id = String(input.id)
        const updated = await aiRegistry<AIConnectionView>({ action: 'setDefault', id })
        await syncDefaultProvider()
        await syncConnectionCredentials()
        return withSecretState(updated)
      }
      case 'aiConnections.test': {
        const profile = await findConnection(String(input.id))
        const apiKey = connectionSecrets.get(profile.id) ?? ''
        return supervisor.request('runtime.ai.probe', probeInput(profile, apiKey), profile.timeoutMs + 5_000)
      }
      case 'aiConnections.discoverModels': {
        const profile = await findConnection(String(input.id))
        const apiKey = connectionSecrets.get(profile.id) ?? ''
        if (!apiKey) throw new AppError('PROVIDER_ERROR', '该连接尚未保存 API Key')
        return supervisor.request('runtime.ai.discover', probeInput(profile, apiKey), profile.timeoutMs + 5_000)
      }
      case 'aiModels.list': {
        return aiRegistry<AIModelList>({ action: 'listModels', connectionId: String(input.id) })
      }
      case 'aiModels.create': {
        return aiRegistry<AIModelList>({ action: 'createModel', input })
      }
      case 'aiModels.delete': {
        const result = await aiRegistry<AIModelList>({
          action: 'deleteModel',
          input: { connectionId: String(input.connectionId), modelId: String(input.modelId) },
        })
        await syncDefaultProvider()
        await syncConnectionCredentials()
        return result
      }
      case 'aiModels.setDefault': {
        const updated = await aiRegistry<AIConnectionView>({
          action: 'setDefaultModel',
          input: { connectionId: String(input.connectionId), modelId: String(input.modelId) },
        })
        await syncDefaultProvider()
        await syncConnectionCredentials()
        return withSecretState(updated)
      }
      case 'settings.test': {
        if (!supervisor.isReady()) {
          return {
            ok: false,
            latencyMs: 0,
            model: providerConfig.runtimeConfig().model,
            message: 'Runtime 尚未就绪',
          }
        }
        try {
          await syncProvider()
          return await supervisor.request('provider.test', {}, 30_000)
        } catch (error) {
          return {
            ok: false,
            latencyMs: 0,
            model: providerConfig.runtimeConfig().model,
            message: error instanceof Error ? error.message : String(error),
          }
        }
      }
      case 'app.pickDirectory': {
        const result = await dialog.showOpenDialog(window, {
          title: typeof input.title === 'string' ? input.title : '选择项目根目录',
          properties: ['openDirectory', 'createDirectory'],
        })
        return { canceled: result.canceled, path: result.canceled ? null : (result.filePaths[0] ?? null) }
      }
      case 'app.revealPath': {
        const target = String(input.path ?? '')
        if (!target) throw new AppError('BAD_REQUEST', '路径不能为空')
        await shell.openPath(target)
        return { ok: true as const }
      }
      case 'project.reveal': {
        const projectId = String(input.projectId ?? '')
        const overview = await supervisor.request<{ project: { rootPath: string } }>('project.overview', {
          projectId,
        })
        const error = await shell.openPath(overview.project.rootPath)
        if (error) throw new AppError('INTERNAL', `无法打开项目目录：${error}`)
        return { ok: true as const }
      }
      case 'app.openExternal': {
        const url = new URL(String(input.url ?? ''))
        if (!['http:', 'https:'].includes(url.protocol)) {
          throw new AppError('POLICY_DENIED', '只允许打开 http/https 链接')
        }
        await shell.openExternal(url.toString())
        return { ok: true as const }
      }
      case 'app.windowMinimize':
        window.minimize()
        return { ok: true as const }
      case 'app.windowToggleMaximize': {
        if (window.isMaximized()) window.unmaximize()
        else window.maximize()
        return { maximized: window.isMaximized() }
      }
      case 'app.windowClose':
        window.close()
        return { ok: true as const }
      case 'app.runtimeStatus':
        return supervisor.getStatus()
      case 'app.preferences.get':
        return {
          provider: await providerInfo(),
          dataDir: ctx.dataDir,
          appVersion: app.getVersion(),
          platform: process.platform,
        }
      case 'runtime.health':
        return supervisor.request('runtime.health', {}, 8_000)
      case 'resource.credential.create': {
        if (!supervisor.isReady()) throw new AppError('RUNTIME_UNAVAILABLE', 'Runtime 尚未就绪')
        const id = `crd_${randomUUID().replace(/-/g, '')}`
        resourceSecrets.set(id, input.secret as Record<string, unknown>)
        try {
          return await supervisor.request('resource.credential.register', {
            id, projectId: input.projectId, kind: input.kind, label: input.label, vaultKey: id,
          }, 10_000)
        } catch (error) {
          resourceSecrets.delete(id)
          throw error
        }
      }
      case 'resource.credential.disable': {
        if (!supervisor.isReady()) throw new AppError('RUNTIME_UNAVAILABLE', 'Runtime 尚未就绪')
        resourceSecrets.delete(String(input.credentialId))
        return supervisor.request('resource.credential.disable', { credentialId: input.credentialId }, 10_000)
      }
      case 'deployment.execute': {
        if (!supervisor.isReady()) throw new AppError('RUNTIME_UNAVAILABLE', 'Runtime 尚未就绪')
        const inspection = await supervisor.request<{ adapterType: string | null }>('deployment.inspect', { deploymentId: input.deploymentId }, 10_000)
        if (inspection.adapterType !== 'ssh-artifact') {
          return supervisor.request('deployment.execute.local', { deploymentId: input.deploymentId }, 180_000)
        }
        const context = await supervisor.request<any>('deployment.prepare', { deploymentId: input.deploymentId }, 30_000)
        logger.info('deployment.execute prepared', { deploymentId: input.deploymentId, targetId: context.target?.id })
        const secret = context.profile?.credentialRef ? resourceSecrets.get(context.profile.credentialRef) : null
        try {
          const result = await executeSshDeployment({
            deploymentId: context.deployment.id, targetRef: context.target?.targetRef ?? '', profile: context.profile,
            artifacts: context.artifacts,
          }, secret)
          logger.info('deployment.execute ssh result', { deploymentId: context.deployment.id, status: result.status, externalId: result.externalId })
          const finished = await supervisor.request('deployment.finish', {
            deploymentId: context.deployment.id, status: result.status,
            assurance: result.health.ok ? 'externally_confirmed' : 'source_observed',
            externalId: result.externalId, artifactHash: result.artifactHash,
            receipt: { ...result.receipt, health: result.health }, notes: result.notes,
          }, 30_000)
          logger.info('deployment.execute finish done', { deploymentId: context.deployment.id, status: (finished as any)?.status })
          return finished
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await supervisor.request('deployment.finish', {
            deploymentId: context.deployment.id, status: 'failed', assurance: 'self_declared',
            externalId: null, artifactHash: null, receipt: {}, notes: message,
          }, 30_000).catch(() => undefined)
          throw error
        }
      }
      case 'resource.connection.test': {
        const profile = await supervisor.request<import('@projectos/contracts').ConnectionProfile>('resource.profile.internal', { profileId: input.profileId }, 10_000)
        const secret = profile.credentialRef ? resourceSecrets.get(profile.credentialRef) : null
        const result = await testSshConnection(profile, secret)
        return supervisor.request('resource.test.record', {
          profileId: profile.id, status: result.status, stage: result.stage, message: result.message,
          latencyMs: result.latencyMs, details: result.details,
        }, 10_000)
      }
      default:
        throw new AppError('NOT_IMPLEMENTED', `Main 尚未实现方法：${method}`)
    }
  }

  const handler = async (
    event: Electron.IpcMainInvokeEvent,
    method: unknown,
    rawInput: unknown,
  ): Promise<HandlerResult> => {
    try {
      if (BrowserWindow.fromWebContents(event.sender) !== ctx.window) {
        throw new AppError('FORBIDDEN', 'IPC 请求来源不是主窗口')
      }
      if (typeof method !== 'string' || !isApiMethod(method)) {
        throw new AppError('BAD_REQUEST', '未知 IPC 方法')
      }
      const parsed = ApiSchemas[method].input.safeParse(rawInput ?? {})
      if (!parsed.success) {
        throw new AppError('BAD_REQUEST', 'IPC 参数不合法', { details: parsed.error.issues })
      }
      const value = parsed.data as Record<string, unknown>
      let result: unknown
      if (isMainMethod(method)) {
        result = await handleMain(method, value)
      } else {
        const timeout =
          method === 'plan.generate'
            ? 240_000
            : method === 'agentDefinition.run' || method === 'runtime.install'
            ? 180_000
            : method === 'approval.decide'
            ? 180_000
            : method === 'demo.seed'
              ? 120_000
              : method === 'run.start'
                ? 60_000
                : 60_000
        result = await supervisor.request(method, value, timeout)
      }
      return { ok: true, result }
    } catch (error) {
      const serialized = serializeError(error)
      if (serialized.code === 'INTERNAL') {
        logger.error('IPC request failed', { method, error: serialized.message })
      } else {
        logger.warn('IPC request rejected', { method, code: serialized.code, message: serialized.message })
      }
      return { ok: false, error: serialized }
    }
  }

  ipcMain.handle('projectos:request', handler)
  return () => {
    ipcMain.removeHandler('projectos:request')
  }
}



