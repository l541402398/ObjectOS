import {
  AIConnectionProbeSchema,
  AIRegistryActionSchema,
  ApiSchemas,
  AppError,
  ProviderRuntimeConfigSchema,
  RUNTIME_INTERNAL_METHODS,
  RUNTIME_METHODS,
  isMainMethod,
  newId,
  type AIConnectionView,
  type ApiMethod,
  type ApiParsedInput,
  type ApprovalView,
  type Project,
  type RuntimeEvent,
} from '@projectos/contracts'
import type { CoreServices } from '@projectos/application'
import type { SqliteStore } from '@projectos/persistence'
import {
  getGitDiff,
  getGitStatus,
  readTextFile,
  readWorkspaceTree,
  runReadonlyCommand,
} from '@projectos/workspace'
import { AIConnectionService } from './ai-connections.js'
import { listExternalAgents } from './external-agents.js'
import { ExternalAgentRunner } from './external-runner.js'
import { OperationsService } from './operations.js'
import { OrchestrationService } from './orchestration.js'
import type { AgentRunner } from './agent-runner.js'
import type { RuntimeConfig } from './config.js'
import type { RuntimeEventHub } from './events.js'
import type { Logger } from './logger.js'
import type { ProviderManager } from './provider-manager.js'
import { seedDemo } from './demo.js'
import { OrchestrationScheduler } from './orchestrator.js'

export interface DispatcherDeps {
  config: RuntimeConfig
  store: SqliteStore
  services: CoreServices
  runner: AgentRunner
  provider: ProviderManager
  hub: RuntimeEventHub
  logger: Logger
  startedAt: number
  shutdown: () => void
}

export class RuntimeDispatcher {
  private readonly aiConnections: AIConnectionService
  private readonly orchestration: OrchestrationService
  private readonly scheduler: OrchestrationScheduler
  private readonly externalRunner: ExternalAgentRunner
  private readonly operations: OperationsService

  constructor(private readonly deps: DispatcherDeps) {
    this.aiConnections = new AIConnectionService(deps.store)
    deps.runner.setAIConnections(this.aiConnections)
    this.orchestration = new OrchestrationService(deps.store, deps.services)
    this.externalRunner = new ExternalAgentRunner(deps.store, deps.services, deps.logger)
    this.operations = new OperationsService(deps.store, deps.services)
    this.scheduler = new OrchestrationScheduler(
      deps.store,
      deps.services,
      deps.runner,
      deps.logger,
      deps.config.dataDir,
    )
  }

  recoverOrchestrations(): void {
    this.scheduler.recover()
  }

  shutdownOrchestrations(): void {
    this.scheduler.shutdown()
  }

  private parse<M extends ApiMethod>(method: M, raw: unknown): ApiParsedInput<M> {
    const parsed = ApiSchemas[method].input.safeParse(raw ?? {})
    if (!parsed.success) {
      throw new AppError('BAD_REQUEST', '请求参数不合法', { details: parsed.error.issues })
    }
    return parsed.data as ApiParsedInput<M>
  }

  async dispatch(method: string, rawInput: unknown): Promise<unknown> {
    const internal = (RUNTIME_INTERNAL_METHODS as readonly string[]).includes(method)
    if (!internal && isMainMethod(method)) {
      throw new AppError('FORBIDDEN', '该方法只能由 Electron Main 处理')
    }
    if (!internal && !(RUNTIME_METHODS as readonly string[]).includes(method)) {
      throw new AppError('NOT_FOUND', `未知方法：${method}`)
    }
    const { store, services, runner, provider, hub, config } = this.deps
    switch (method) {
      case 'runtime.health':
        return {
          ok: true,
          protocolVersion: 1,
          runtimeVersion: config.runtimeVersion,
          pid: process.pid,
          uptimeMs: Date.now() - this.deps.startedAt,
          activeRuns: store.read.countActiveRuns(),
          queuedApprovals: store.read.countPendingApprovals(),
        }
      case 'runtime.ai.credentials': {
        const input = this.parse('runtime.ai.credentials', rawInput)
        provider.registerConnections(input.connections)
        return { ok: true as const }
      }
      case 'aiRouting.list':
        return { bindings: this.aiConnections.listBindings() }
      case 'aiRouting.upsert':
        return { bindings: this.aiConnections.upsertBinding(this.parse('aiRouting.upsert', rawInput)) }
      case 'aiRouting.delete': {
        const input = this.parse('aiRouting.delete', rawInput)
        this.aiConnections.deleteBinding(input.id)
        return { ok: true as const }
      }
      case 'aiPricing.list': {
        const input = this.parse('aiPricing.list', rawInput)
        return { prices: this.aiConnections.listPrices(input.connectionId) }
      }
      case 'aiPricing.upsert': {
        const input = this.parse('aiPricing.upsert', rawInput)
        return { prices: this.aiConnections.upsertPrice(input) }
      }
      case 'aiPricing.delete': {
        const input = this.parse('aiPricing.delete', rawInput)
        this.aiConnections.deletePrice(input.id)
        return { ok: true as const }
      }
      case 'aiUsage.summary': {
        const input = this.parse('aiUsage.summary', rawInput)
        return this.aiConnections.usageSummary(input.projectId)
      }
      case 'runtime.shutdown': {
        // Let the response frame flush before closing the transport and store.
        setTimeout(() => this.deps.shutdown(), 80)
        return { ok: true }
      }
      case 'runtime.provider.configure': {
        const parsed = ProviderRuntimeConfigSchema.safeParse(rawInput)
        if (!parsed.success) throw new AppError('BAD_REQUEST', 'Provider 配置不合法')
        const changed = provider.configure(parsed.data)
        if (changed) {
          hub.publish({
            type: 'provider.changed',
            configured: provider.isConfigured(),
            model: parsed.data.model,
          })
        }
        return provider.info()
      }
      case 'runtime.provider.clear': {
        provider.clear()
        hub.publish({ type: 'provider.changed', configured: false, model: '' })
        return provider.info()
      }
      case 'runtime.ai.registry': {
        const parsed = AIRegistryActionSchema.safeParse(rawInput)
        if (!parsed.success) throw new AppError('BAD_REQUEST', 'AI 连接参数不合法', { details: parsed.error.issues })
        const action = parsed.data
        switch (action.action) {
          case 'list': {
            const connections = this.aiConnections.listViews()
            return {
              connections,
              defaultId: connections.find((connection) => connection.isDefault)?.id ?? null,
            }
          }
          case 'getDefault':
            return this.aiConnections.getDefault()
          case 'create':
            return this.aiConnections.create(action.input)
          case 'update':
            return this.aiConnections.update(action.input)
          case 'delete':
            this.aiConnections.delete(action.id)
            return { ok: true }
          case 'setDefault':
            return this.aiConnections.setDefault(action.id)
          case 'setSecretRef':
            store.setAIConnectionSecretRef(action.id, action.secretRef)
            return this.aiConnections.getView(action.id)
          case 'listModels':
            return { models: this.aiConnections.listModels(action.connectionId) }
          case 'createModel':
            return { models: this.aiConnections.createModel(action.input) }
          case 'deleteModel':
            return { models: this.aiConnections.deleteModel(action.input.connectionId, action.input.modelId) }
          case 'setDefaultModel':
            return this.aiConnections.setDefaultModel(action.input.connectionId, action.input.modelId)
          case 'recordCheck':
            store.recordAIConnectionCheck(action.check)
            return { ok: true }
          case 'upsertModels': {
            const connection = this.aiConnections.getView(action.connectionId)
            const models = action.models.map((model) =>
              store.upsertAIModel({ ...model, connectionId: connection.id }),
            )
            return { models }
          }
          default:
            throw new AppError('BAD_REQUEST', '未知 AI 连接操作')
        }
      }
      case 'runtime.ai.probe': {
        const parsed = AIConnectionProbeSchema.safeParse(rawInput)
        if (!parsed.success) throw new AppError('BAD_REQUEST', '连接测试参数不合法', { details: parsed.error.issues })
        const input = parsed.data
        const profile: AIConnectionView = {
          id: input.connectionId,
          name: input.name ?? input.connectionId,
          backendKind: 'native-llm',
          providerId: 'custom',
          protocol: input.protocol,
          baseUrl: input.baseUrl,
          defaultModelId: input.model,
          secretRef: null,
          enabled: true,
          isDefault: false,
          timeoutMs: input.timeoutMs,
          temperature: input.temperature,
          createdAt: 0,
          updatedAt: 0,
          hasSecret: true,
          modelCount: 1,
          lastCheck: null,
        }
        return this.aiConnections.test(profile, input.apiKey)
      }
      case 'runtime.ai.discover': {
        const parsed = AIConnectionProbeSchema.safeParse(rawInput)
        if (!parsed.success) throw new AppError('BAD_REQUEST', '模型发现参数不合法', { details: parsed.error.issues })
        const input = parsed.data
        const profile: AIConnectionView = {
          id: input.connectionId,
          name: input.name ?? input.connectionId,
          backendKind: 'native-llm',
          providerId: 'custom',
          protocol: input.protocol,
          baseUrl: input.baseUrl,
          defaultModelId: input.model || null,
          secretRef: null,
          enabled: true,
          isDefault: false,
          timeoutMs: input.timeoutMs,
          temperature: input.temperature,
          createdAt: 0,
          updatedAt: 0,
          hasSecret: true,
          modelCount: 0,
          lastCheck: null,
        }
        return { models: await this.aiConnections.discoverModels(profile, input.apiKey) }
      }
      case 'project.list': {
        const input = this.parse('project.list', rawInput)
        return { projects: services.projects.list(input.includeArchived) }
      }
      case 'project.create': {
        const input = this.parse('project.create', rawInput)
        return { project: await services.projects.create(input) }
      }
      case 'project.overview': {
        const input = this.parse('project.overview', rawInput)
        return services.projects.overview(input.projectId)
      }
      case 'project.update': {
        const input = this.parse('project.update', rawInput)
        return { project: services.projects.update(input) }
      }
      case 'project.advanceStage': {
        const input = this.parse('project.advanceStage', rawInput)
        const project = await services.projects.advanceStage(input.projectId, input.stage)
        return { project, overview: await services.projects.overview(project.id) }
      }
      case 'project.activity': {
        const input = this.parse('project.activity', rawInput)
        return { events: services.projects.activity(input.projectId, input.limit) }
      }
      case 'task.board': {
        const input = this.parse('task.board', rawInput)
        return services.tasks.board(input.projectId)
      }
      case 'task.detail': {
        const input = this.parse('task.detail', rawInput)
        return services.tasks.detail(input.taskId)
      }
      case 'task.create': {
        const input = this.parse('task.create', rawInput)
        return { task: services.tasks.create(input) }
      }
      case 'task.update': {
        const input = this.parse('task.update', rawInput)
        return { task: services.tasks.update(input) }
      }
      case 'task.move': {
        const input = this.parse('task.move', rawInput)
        return { task: services.tasks.move(input) }
      }
      case 'task.addDependency': {
        const input = this.parse('task.addDependency', rawInput)
        return { task: services.tasks.addDependency(input.taskId, input.dependsOnId) }
      }
      case 'task.removeDependency': {
        const input = this.parse('task.removeDependency', rawInput)
        return { task: services.tasks.removeDependency(input.taskId, input.dependsOnId) }
      }
      case 'requirement.list': {
        const input = this.parse('requirement.list', rawInput)
        return { requirements: services.projects.requirements(input.projectId) }
      }
      case 'requirement.create': {
        const input = this.parse('requirement.create', rawInput)
        return { requirement: services.projects.createRequirement(input) }
      }
      case 'requirement.setStatus': {
        const input = this.parse('requirement.setStatus', rawInput)
        return { requirement: services.projects.setRequirementStatus(input.requirementId, input.status) }
      }
      case 'milestone.list': {
        const input = this.parse('milestone.list', rawInput)
        return { milestones: services.projects.milestones(input.projectId) }
      }
      case 'milestone.create': {
        const input = this.parse('milestone.create', rawInput)
        return { milestone: services.projects.createMilestone(input) }
      }
      case 'milestone.setStatus': {
        const input = this.parse('milestone.setStatus', rawInput)
        return { milestone: services.projects.setMilestoneStatus(input.milestoneId, input.status) }
      }
      case 'decision.list': {
        const input = this.parse('decision.list', rawInput)
        return { decisions: services.projects.decisions(input.projectId) }
      }
      case 'decision.create': {
        const input = this.parse('decision.create', rawInput)
        return { decision: services.projects.createDecision(input) }
      }
      case 'decision.setStatus': {
        const input = this.parse('decision.setStatus', rawInput)
        return { decision: services.projects.setDecisionStatus(input.decisionId, input.status) }
      }
      case 'artifact.list': {
        const input = this.parse('artifact.list', rawInput)
        return { artifacts: services.projects.artifacts(input.projectId, input.taskId) }
      }
      case 'artifact.create': {
        const input = this.parse('artifact.create', rawInput)
        return { artifact: services.projects.createArtifact(input) }
      }
      case 'knowledge.list': {
        const input = this.parse('knowledge.list', rawInput)
        return { entries: services.projects.knowledge(input.projectId) }
      }
      case 'knowledge.search': {
        const input = this.parse('knowledge.search', rawInput)
        services.projects.getProjectOrThrow(input.projectId)
        return { entries: store.read.searchKnowledge(input.projectId, input.query, input.limit) }
      }
      case 'agent.list': {
        const input = this.parse('agent.list', rawInput)
        return { agents: services.projects.listAgents(input.projectId) }
      }
      case 'session.list': {
        const input = this.parse('session.list', rawInput)
        return { sessions: services.sessions.list(input.projectId) }
      }
      case 'session.create': {
        const input = this.parse('session.create', rawInput)
        return { session: services.sessions.create(input) }
      }
      case 'session.get': {
        const input = this.parse('session.get', rawInput)
        return services.sessions.get(input.sessionId, input.messageLimit)
      }
      case 'session.update': {
        const input = this.parse('session.update', rawInput)
        return { session: services.sessions.update(input.sessionId, { title: input.title, status: input.status }) }
      }
      case 'session.sendMessage': {
        const input = this.parse('session.sendMessage', rawInput)
        const session = store.read.getSession(input.sessionId)
        if (!session) throw new AppError('NOT_FOUND', '会话不存在')
        const message = services.sessions.sendMessage(input)
        let runId: string | null = null
        let warning: string | null = null
        if (input.startRun) {
          if (!provider.isConfigured()) {
            warning = '消息已保存。尚未配置模型 Provider，因此未启动 Agent 运行。'
          } else {
            try {
              const run = await runner.startRun({
                projectId: session.projectId,
                sessionId: session.id,
                taskId: input.taskId ?? null,
                prompt: input.content,
                messageId: message.id,
              })
              runId = run.runId
            } catch (error) {
              warning = error instanceof Error ? error.message : String(error)
            }
          }
        }
        return { message, runId, warning }
      }
      case 'run.start': {
        const input = this.parse('run.start', rawInput)
        const session = store.read.getSession(input.sessionId)
        if (!session) throw new AppError('NOT_FOUND', '会话不存在')
        if (!provider.isConfigured()) {
          throw new AppError('PROVIDER_NOT_CONFIGURED', '尚未配置模型 Provider，请先在设置中配置 API Key')
        }
        const message = services.sessions.sendMessage({
          sessionId: input.sessionId,
          content: input.prompt,
          taskId: input.taskId,
          startRun: false,
        })
        const run = await runner.startRun({
          projectId: input.projectId,
          sessionId: input.sessionId,
          taskId: input.taskId,
          prompt: input.prompt,
          messageId: message.id,
        })
        return { runId: run.runId, messageId: message.id }
      }
      case 'run.cancel': {
        const input = this.parse('run.cancel', rawInput)
        await runner.cancel(input.runId)
        return { ok: true as const }
      }
      case 'run.list': {
        const input = this.parse('run.list', rawInput)
        services.projects.getProjectOrThrow(input.projectId)
        return { runs: store.read.listRunSummaries(input.projectId, input.limit) }
      }
      case 'run.get': {
        const input = this.parse('run.get', rawInput)
        const detail = store.read.getRunDetail(input.runId)
        if (!detail) throw new AppError('NOT_FOUND', '运行不存在')
        return detail
      }
      case 'approval.list': {
        const input = this.parse('approval.list', rawInput)
        return { approvals: store.read.listApprovalViews(input.projectId, input.runId) }
      }
      case 'approval.decide': {
        const input = this.parse('approval.decide', rawInput)
        await runner.decideApproval(input.approvalId, input.decision, input.note)
        const view = store.read.getApprovalView(input.approvalId)
        if (!view) throw new AppError('NOT_FOUND', '授权请求不存在')
        return { approval: view satisfies ApprovalView }
      }
      case 'collaboration.snapshot': {
        const input = this.parse('collaboration.snapshot', rawInput)
        return services.collaboration.snapshot(input.projectId)
      }
      case 'inbox.list': {
        const input = this.parse('inbox.list', rawInput)
        return { items: services.collaboration.listInbox(input.projectId, input.sessionId) }
      }
      case 'inbox.send': {
        const input = this.parse('inbox.send', rawInput)
        const result = services.collaboration.send(input)
        let inbox = result.inbox
        if (result.created && input.wake && provider.isConfigured()) {
          try {
            await runner.wakeInbox(result.inbox.id)
            const updated = store.read.getInbox(result.inbox.id)
            if (updated) inbox = store.read.getInboxItemView(updated)
          } catch (error) {
            this.deps.logger.warn({ err: error, inboxId: result.inbox.id }, 'failed to wake recipient session')
          }
        }
        return { inbox }
      }
      case 'inbox.ack': {
        const input = this.parse('inbox.ack', rawInput)
        return { inbox: services.collaboration.ack(input.inboxId) }
      }
      case 'inbox.resume': {
        const input = this.parse('inbox.resume', rawInput)
        return runner.resumeInbox(input.inboxId)
      }
      case 'handoff.list': {
        const input = this.parse('handoff.list', rawInput)
        services.projects.getProjectOrThrow(input.projectId)
        return { handoffs: store.read.listHandoffViews(input.projectId) }
      }
      case 'handoff.request': {
        const input = this.parse('handoff.request', rawInput)
        return { handoff: services.collaboration.requestHandoff(input) }
      }
      case 'handoff.accept': {
        const input = this.parse('handoff.accept', rawInput)
        return services.collaboration.acceptHandoff(input.handoffId, input.sessionId)
      }
      case 'handoff.reject': {
        const input = this.parse('handoff.reject', rawInput)
        return { handoff: services.collaboration.rejectHandoff(input.handoffId, input.reason) }
      }
      case 'workspace.snapshot': {
        const input = this.parse('workspace.snapshot', rawInput)
        const project = services.projects.getProjectOrThrow(input.projectId)
        const [entries, git] = await Promise.all([
          Promise.resolve(readWorkspaceTree(project.rootPath, { maxDepth: 8 })),
          getGitStatus(project.rootPath).catch(() => null),
        ])
        return { rootPath: project.rootPath, entries, git }
      }
      case 'workspace.readFile': {
        const input = this.parse('workspace.readFile', rawInput)
        const project = services.projects.getProjectOrThrow(input.projectId)
        return readTextFile(project.rootPath, input.path)
      }
      case 'workspace.gitDiff': {
        const input = this.parse('workspace.gitDiff', rawInput)
        const project = services.projects.getProjectOrThrow(input.projectId)
        return getGitDiff(project.rootPath, input.path)
      }
      case 'workspace.runReadonly': {
        const input = this.parse('workspace.runReadonly', rawInput)
        const project = services.projects.getProjectOrThrow(input.projectId)
        return runReadonlyCommand(project.rootPath, input.command)
      }
      case 'event.list': {
        const input = this.parse('event.list', rawInput)
        services.projects.getProjectOrThrow(input.projectId)
        return { events: store.read.listEventViews(input.projectId, input.limit, input.offset, input.sinceSeq) }
      }
      case 'provider.status':
        return provider.info()
      case 'externalAgents.list':
        return { installations: await listExternalAgents() }
      case 'externalAgents.execute':
        return this.externalRunner.execute(this.parse('externalAgents.execute', rawInput))
      case 'externalAgents.cancel': {
        const input = this.parse('externalAgents.cancel', rawInput)
        await this.externalRunner.cancel(input.runId)
        return { ok: true as const }
      }
      case 'provider.test': {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 20_000)
        try {
          const result = await provider.test(controller.signal)
          return { ...result, model: provider.info().model }
        } finally {
          clearTimeout(timer)
        }
      }
      case 'demo.seed': {
        const input = this.parse('demo.seed', rawInput)
        return seedDemo({ store, dataDir: config.dataDir, force: input.force })
      }
      case 'project.scan': {
        const input = this.parse('project.scan', rawInput)
        return this.orchestration.scan(input.projectId)
      }
      case 'project.snapshot.get': {
        const input = this.parse('project.snapshot.get', rawInput)
        return { snapshot: this.orchestration.snapshot(input.projectId) }
      }
      case 'project.metrics': {
        const input = this.parse('project.metrics', rawInput)
        return this.orchestration.metrics(input.projectId)
      }
      case 'operations.snapshot': {
        const input = this.parse('operations.snapshot', rawInput)
        return this.operations.snapshot(input.projectId)
      }
      case 'operations.runChecks': {
        const input = this.parse('operations.runChecks', rawInput)
        return this.operations.runChecks(input.projectId)
      }
      case 'operations.propose': {
        const input = this.parse('operations.propose', rawInput)
        return this.operations.propose(input.projectId, input.findingIds)
      }
      case 'operations.getTrigger': {
        const input = this.parse('operations.getTrigger', rawInput)
        return this.deps.store.read.getAutomationTrigger(input.projectId)
      }
      case 'operations.setTrigger': {
        const input = this.parse('operations.setTrigger', rawInput)
        const nextRunAt = input.enabled ? Date.now() + input.intervalMinutes * 60_000 : null
        this.deps.store.upsertAutomationTrigger(input.projectId, input.intervalMinutes, input.enabled, nextRunAt)
        return this.deps.store.read.getAutomationTrigger(input.projectId)
      }
      case 'operations.startRepair': {
        const input = this.parse('operations.startRepair', rawInput)
        const proposal = this.deps.store.read.getProposal(input.proposalId)
        if (!proposal) throw new Error('修复提案不存在')
        if (proposal.status !== 'approved') throw new Error('提案尚未批准')
        if (proposal.planId) throw new Error('提案已有修复计划')
        const draft = this.orchestration.generatePlan(proposal.projectId, '修复健康检查问题：' + proposal.scope.join('；'))
        this.orchestration.approvePlan(draft.id)
        this.deps.store.setProposalPlan(proposal.id, draft.id)
        this.deps.store.updateProposalStatus(proposal.id, 'executing')
        const plan = await this.scheduler.start(draft.id, 2, 2, true)
        return { proposal: this.deps.store.read.getProposal(proposal.id), plan }
      }
      case 'operations.reviewProposal': {
        const input = this.parse('operations.reviewProposal', rawInput)
        return this.operations.reviewProposal(input.proposalId, input.decision)
      }
      case 'operations.setMode': {
        const input = this.parse('operations.setMode', rawInput)
        return this.operations.setMode(input.projectId, input.mode)
      }
      case 'project.budget.get': {
        const input = this.parse('project.budget.get', rawInput)
        return this.orchestration.budget(input.projectId)
      }
      case 'project.budget.set': {
        const input = this.parse('project.budget.set', rawInput)
        return this.orchestration.setBudget(input.projectId, input.softLimit, input.currency)
      }
      case 'plan.generate': {
        const input = this.parse('plan.generate', rawInput)
        return this.orchestration.generatePlan(input.projectId, input.goal)
      }
      case 'plan.list': {
        const input = this.parse('plan.list', rawInput)
        return { plans: this.orchestration.listPlans(input.projectId) }
      }
      case 'plan.get': {
        const input = this.parse('plan.get', rawInput)
        return this.orchestration.getPlan(input.planId)
      }
      case 'plan.update': {
        const input = this.parse('plan.update', rawInput)
        return this.orchestration.updatePlan(input)
      }
      case 'plan.revise': {
        const input = this.parse('plan.revise', rawInput)
        return this.orchestration.revisePlan(input)
      }
      case 'plan.approve': {
        const input = this.parse('plan.approve', rawInput)
        return this.orchestration.approvePlan(input.planId)
      }
      case 'plan.reject': {
        const input = this.parse('plan.reject', rawInput)
        return this.orchestration.rejectPlan(input.planId)
      }
      case 'orchestration.start': {
        const input = this.parse('orchestration.start', rawInput)
        return this.scheduler.start(input.planId, input.concurrency, input.maxRetries, input.allowOverBudget)
      }
      case 'orchestration.pause': {
        const input = this.parse('orchestration.pause', rawInput)
        return this.scheduler.pause(input.planId)
      }
      case 'orchestration.resume': {
        const input = this.parse('orchestration.resume', rawInput)
        return this.scheduler.resume(input.planId)
      }
      case 'orchestration.cancel': {
        const input = this.parse('orchestration.cancel', rawInput)
        return this.scheduler.cancel(input.planId)
      }
      case 'worktree.info': {
        const input = this.parse('worktree.info', rawInput)
        return this.scheduler.info(input.planId)
      }
      case 'worktree.merge': {
        const input = this.parse('worktree.merge', rawInput)
        return this.scheduler.merge(input.planId)
      }
      case 'worktree.discard': {
        const input = this.parse('worktree.discard', rawInput)
        await this.scheduler.discard(input.planId)
        return { ok: true as const }
      }
      case 'graph.snapshot.get': {
        const input = this.parse('graph.snapshot.get', rawInput)
        return this.orchestration.graph(input.projectId)
      }
      case 'graph.layout.save': {
        const input = this.parse('graph.layout.save', rawInput)
        this.orchestration.saveLayout(input)
        return { ok: true }
      }
      default:
        throw new AppError('NOT_IMPLEMENTED', `尚未实现方法：${method}`)
    }
  }
}

export function projectFromStore(project: Project | null): Project {
  if (!project) throw new AppError('NOT_FOUND', '项目不存在')
  return project
}

export function newRequestId(): string {
  return newId('evt')
}

export function emitLog(hub: RuntimeEventHub, level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
  const event: RuntimeEvent = { type: 'runtime.log', level, message, createdAt: Date.now() }
  hub.publish(event)
}







