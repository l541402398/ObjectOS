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
  type ProjectEvent,
  type RuntimeEvent,
} from '@projectos/contracts'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
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
import { OperationsService, repairRunKey } from './operations.js'
import { LifecycleService } from './lifecycle.js'
import { ReleaseService } from './release-service.js'
import { AgentStudioService } from './agent-studio.js'
import { RuntimeExecutionService } from './runtime-executor.js'
import { OrchestrationService } from './orchestration.js'
import { PlannerService } from './planner.js'
import { AiPlannerModelSource } from './planner-provider.js'
import { PlannerUsageService } from './planner-usage.js'
import { PlanGrantService } from './plan-grant.js'
import { ReplanService } from './replan-service.js'
import { RuntimeSettingsService } from './runtime-settings.js'
import type { AgentRunner } from './agent-runner.js'
import type { RuntimeConfig } from './config.js'
import type { RuntimeEventHub } from './events.js'
import type { Logger } from './logger.js'
import type { ProviderManager } from './provider-manager.js'
import { seedDemo } from './demo.js'
import { OrchestrationScheduler } from './orchestrator.js'
import { ResourceService } from './resource-service.js'
import { agentForPlannedTask } from '@projectos/planning'
import { planGroupTitle } from '@projectos/session-manager'

const EVENT_CHECK_DEBOUNCE_MS = 60_000
const REPAIR_MAX_RUN_MS = 60 * 60_000
const MAX_CONCURRENT_REPAIRS = 1
// Phase 0: approved-autofix writes are disabled until allowedPaths is derived
// from a real automation grant and enforced by the execution gateway.
const AUTOFIX_WRITE_ENABLED = false

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
  private readonly planGrants: PlanGrantService
  private readonly runtimeSettings: RuntimeSettingsService
  private readonly plannerUsage: PlannerUsageService
  private readonly orchestration: OrchestrationService
  private readonly replans: ReplanService
  private readonly scheduler: OrchestrationScheduler
  private readonly externalRunner: ExternalAgentRunner
  private readonly operations: OperationsService
  private readonly lifecycle: LifecycleService
  private readonly release: ReleaseService
  private readonly resources: ResourceService
  private readonly agentStudio: AgentStudioService
  private readonly runtimeExecutor: RuntimeExecutionService
  private readonly operationsTimer: NodeJS.Timeout
  private readonly inboxTimer: NodeJS.Timeout
  private readonly eventChecks = new Map<string, NodeJS.Timeout>()
  private readonly groupDiscussions = new Map<string, Promise<void>>()

  constructor(private readonly deps: DispatcherDeps) {
    this.aiConnections = new AIConnectionService(deps.store)
    this.planGrants = new PlanGrantService(deps.store, deps.logger)
    this.runtimeSettings = new RuntimeSettingsService(deps.store, (limits) => deps.runner.setLimits(limits))
    this.runtimeSettings.apply()
    this.plannerUsage = new PlannerUsageService(deps.store)
    deps.runner.setAIConnections(this.aiConnections)
    deps.runner.setPlanGrants(this.planGrants)
    const planner = new PlannerService({
      store: deps.store,
      modelSource: new AiPlannerModelSource(deps.provider, this.aiConnections),
      logger: deps.logger,
      onAttemptUsage: (usage) => this.plannerUsage.record(usage),
      runtimeSettings: () => this.runtimeSettings.get(),
    })
    this.orchestration = new OrchestrationService(deps.store, deps.services, planner)
    this.replans = new ReplanService(deps.store, this.orchestration, planner, this.planGrants, deps.logger)
    this.externalRunner = new ExternalAgentRunner(deps.store, deps.services, deps.logger)
    this.operations = new OperationsService(deps.store, deps.services)
    this.lifecycle = new LifecycleService(deps.store)
    this.release = new ReleaseService(deps.store)
    this.resources = new ResourceService(deps.store)
    this.agentStudio = new AgentStudioService(deps.store)
    this.runtimeExecutor = new RuntimeExecutionService(deps.store, () => deps.provider.rawConfig())
    this.operationsTimer = setInterval(() => this.runDueChecks(), 30_000)
    this.operationsTimer.unref()
    this.inboxTimer = setInterval(() => void deps.runner.retryPendingInbox(), 30_000)
    this.inboxTimer.unref()
    deps.hub.onCommitted((event) => this.onProjectEvent(event))
    this.scheduler = new OrchestrationScheduler(
      deps.store,
      deps.services,
      deps.runner,
      deps.logger,
      deps.config.dataDir,
      undefined,
      undefined,
      (plan) => {
        this.planGrants.assertExecutionActive(plan)
      },
      (planId, taskId, agentId) => {
        this.planGrants.amendAgentForConfirmedReassignment(planId, taskId, agentId)
      },
      (planId, trigger, reason) => {
        void this.replans
          .propose({ planId, trigger, reason, requestedBy: 'system:scheduler' })
          .catch((error) => {
            this.deps.logger.warn({ err: error, planId, trigger }, 'automatic replan proposal failed')
          })
      },
    )
  }

  recoverOrchestrations(): void {
    this.operations.recoverRuns()
    const recovered = this.planGrants.recoverStartReservations()
    if (recovered.started > 0 || recovered.released > 0) {
      this.deps.logger.info(recovered, 'recovered stale plan grant start reservations')
    }
    const recoveredReplans = this.replans.recover()
    if (recoveredReplans > 0) this.deps.logger.info({ count: recoveredReplans }, 'recovered applying replan proposals')
    this.scheduler.recover()
  }

  shutdownOrchestrations(): void {
    clearInterval(this.operationsTimer)
    clearInterval(this.inboxTimer)
    for (const timer of this.eventChecks.values()) clearTimeout(timer)
    this.eventChecks.clear()
    this.scheduler.shutdown()
  }

  /** Task blocked / run failed schedules a debounced health check while monitoring is enabled. */
  private onProjectEvent(event: ProjectEvent): void {
    if (!this.deps.store.read.getAutomationTrigger(event.projectId)?.enabled) return
    if (!this.operations.isTriggerEvent(event)) return
    if (this.eventChecks.has(event.projectId)) return
    const timer = setTimeout(() => {
      this.eventChecks.delete(event.projectId)
      void this.operations
        .runChecks(event.projectId, `event:${event.eventType}`, `checks:event:${event.projectId}:${event.id}`)
        .then(() => this.autoStartRepairs(event.projectId))
        .catch((error) => this.deps.logger.warn({ err: error, projectId: event.projectId }, 'event-triggered health checks failed'))
    }, EVENT_CHECK_DEBOUNCE_MS)
    timer.unref?.()
    this.eventChecks.set(event.projectId, timer)
  }

  private runDueChecks(): void {
    this.stopOverdueRepairs()
    for (const trigger of this.deps.store.read.listDueAutomationTriggers(Date.now())) {
      this.deps.store.upsertAutomationTrigger(
        trigger.projectId,
        trigger.intervalMinutes,
        true,
        Date.now() + trigger.intervalMinutes * 60_000,
      )
      // The scheduled slot is the idempotency key: a duplicate timer firing for it runs nothing.
      void this.operations
        .runChecks(trigger.projectId, 'interval', `checks:interval:${trigger.projectId}:${trigger.nextRunAt ?? 0}`)
        .then(() => this.autoStartRepairs(trigger.projectId))
        .catch((error) => this.deps.logger.warn({ err: error, projectId: trigger.projectId }, 'scheduled health checks failed'))
    }
  }

  /** Cancels repair plans that exceeded the maximum run time; reconcile then marks them failed. */
  private stopOverdueRepairs(): void {
    const repairing = new Set(
      this.deps.store.read.listRunningAutomationRuns().filter((run) => run.kind === 'repair').map((run) => run.projectId),
    )
    // Reconcile first so plans that already finished close their automation runs.
    for (const projectId of repairing) this.operations.snapshot(projectId)
    for (const run of this.deps.store.read.listRunningAutomationRuns()) {
      if (run.kind !== 'repair' || !run.planId || Date.now() - run.startedAt < REPAIR_MAX_RUN_MS) continue
      this.deps.store.appendAutomationRunEvent(run.id, 'timeout', { maxRunMs: REPAIR_MAX_RUN_MS })
      void this.scheduler
        .cancel(run.planId)
        .then(() => this.operations.snapshot(run.projectId))
        .catch((error) => this.deps.logger.warn({ err: error, runId: run.id }, 'failed to stop overdue repair'))
    }
  }

  private async autoStartRepairs(projectId: string): Promise<void> {
    if (!AUTOFIX_WRITE_ENABLED) return
    if (this.deps.store.read.getAutonomyMode(projectId) !== 'approved-autofix') return
    if (this.operations.circuitOpen(projectId)) {
      this.deps.logger.warn({ projectId }, 'automatic repairs paused by circuit breaker')
      return
    }
    for (const proposal of this.deps.store.read.listProposals(projectId)) {
      if (proposal.status !== 'approved' || proposal.planId) continue
      if (!this.operations.risk(proposal.id).allowed) continue
      try {
        await this.startRepair(proposal.id, 'autofix')
      } catch (error) {
        this.deps.logger.warn({ err: error, proposalId: proposal.id }, 'automatic repair start failed')
      }
    }
  }

  private async requestVerification(projectId: string, taskId: string): Promise<{ sessionId: string; runId: string }> {
    const task = this.deps.store.read.getTask(taskId)
    if (!task || task.projectId !== projectId) throw new AppError('NOT_FOUND', '任务不存在')
    if (task.status === 'done' || task.status === 'cancelled') {
      throw new AppError('CONFLICT', '该任务已结束，不能再次请求验证')
    }
    if (task.status === 'running') throw new AppError('CONFLICT', '任务正在执行，请等待当前运行结束')
    const agentId =
      task.assigneeAgentId ??
      this.deps.services.projects.listAgents(projectId)[0]?.agent.id ??
      null
    if (!agentId) throw new AppError('CONFLICT', '项目没有可用 Agent，无法执行受控验证')
    const session = this.deps.services.sessions.create({
      projectId,
      agentId,
      title: `验证 · ${task.title}`.slice(0, 240),
    })
    const result = await this.deps.runner.startRun({
      projectId,
      sessionId: session.id,
      taskId,
      prompt: [
        `受控验证任务：${task.title}`,
        '请只做验证，不要修改无关文件：',
        '1. 阅读任务验收标准与当前 Artifact。',
        '2. 使用 run_tests 或受控命令执行真实测试/检查；命令不可执行时明确报告原因。',
        '3. 创建 test-report / review Artifact，写入实际命令、退出码、输出摘要与哈希（如有）。',
        '   若任务要求审查/评审，create_artifact 必须包含 metadata：',
        '   { artifactType: "review", reviewedObjects: ["实际审查对象"], findings: ["发现"], conclusion: "结论", blockers: [], changedFiles: ["涉及文件"] }。',
        '   Artifact 的 body 必须对应真实检查结果，不能只写“已完成”。',
        '4. 只有证据满足验收标准时才声明完成；否则列出缺失项，等待人工决定。',
        '5. 只依据当前任务的验收标准判断；满足标准时审查结论必须为“通过”，不要把 skipped/未验证状态或不可执行的历史哈希当作新增阻断项。',
        '不要调用 update_task_status 把任务直接标记为 done；验证 Run 结束后保持 review，由编排器按证据执行 CompletionDecision。',
        '不要调用 send_agent_message 或 handoff_task 创建额外 Run；本次验证只允许只读检查、run_tests 和 create_artifact。',
        '不得伪造测试结果，不得把 skipped/未验证写成 passed。',
      ].join('\n'),
    })
    return { sessionId: session.id, runId: result.runId }
  }

  private async startRepair(proposalId: string, source: 'manual' | 'autofix' = 'manual') {
    if (!AUTOFIX_WRITE_ENABLED) {
      throw new AppError('POLICY_DENIED', 'Phase 0 已禁用自动修复写能力（allowedPaths 尚未由授权派生）；请使用受控 Agent 计划修复')
    }
    const proposal = this.deps.store.read.getProposal(proposalId)
    if (!proposal) throw new AppError('NOT_FOUND', '修复提案不存在')
    if (proposal.status !== 'approved') throw new AppError('CONFLICT', '提案尚未批准')
    if (proposal.planId) throw new AppError('CONFLICT', '提案已有修复计划')
    const repairAgentId = this.deps.store.read.getAutomationRepairAgentId(proposal.projectId)
    if (repairAgentId) {
      const repairAgent = this.deps.store.read.getAgent(repairAgentId)
      if (!repairAgent) throw new AppError('NOT_FOUND', '项目配置的修复 Agent 不存在')
      const definition = this.deps.store.read.getAgentDefinition(repairAgentId)
      if (definition && definition.status !== 'active') {
        throw new AppError('CONFLICT', '项目配置的修复 Agent 当前不可用')
      }
    }
    const running = this.deps.store.read
      .listRunningAutomationRuns()
      .filter((run) => run.kind === 'repair' && run.projectId === proposal.projectId)
    if (running.length >= MAX_CONCURRENT_REPAIRS) throw new AppError('CONFLICT', '该项目已有修复在执行')
    this.operations.consumeGrant(proposal.projectId)
    const claim = this.deps.store.claimAutomationRun({
      id: newId('aur'),
      projectId: proposal.projectId,
      kind: 'repair',
      source,
      proposalId: proposal.id,
      idempotencyKey: repairRunKey(proposal.id),
    })
    if (!claim) throw new AppError('CONFLICT', '该提案已启动过修复')
    const draft = this.orchestration.generatePlan(proposal.projectId, '修复健康检查问题：' + proposal.scope.join('；'))
    const planDraft = repairAgentId
      ? this.orchestration.updatePlan({
          planId: draft.id,
          tasks: draft.tasks.map((task) =>
            task.role === 'developer' ? { ...task, agentId: repairAgentId } : task,
          ),
        })
      : draft
    const approvedPlan = this.orchestration.approvePlan(planDraft.id).plan
    this.deps.store.setProposalPlan(proposal.id, planDraft.id)
    this.deps.store.setAutomationRunPlan(claim.id, planDraft.id)
    this.deps.store.updateProposalStatus(proposal.id, 'executing')
    this.deps.store.transitionProposalFindings(proposal.id, ['proposed', 'open', 'reopened'], 'in_progress')
    // Repairs always run in an isolated worktree and respect the project budget.
    let plan
    try {
      // The existing automation grant/proposal approval is the user's
      // authorization for this repair. Materialize it as a normal plan grant so
      // the scheduler and ToolHandler follow the same audited path.
      const grant = this.planGrants.issueForAutomationRepair(approvedPlan, claim.id)
      const reservation = this.planGrants.reserveStart(approvedPlan, grant, `repair:${claim.id}`)
      if (!reservation) throw new AppError('APPROVAL_REQUIRED', '自动化修复授权启动配额不可用')
      try {
        plan = await this.scheduler.start(approvedPlan.id, 2, 2, false, true)
        this.planGrants.markStartSucceeded(reservation.reservation.id, plan)
      } catch (error) {
        this.planGrants.settleStartFailure(
          reservation.reservation.id,
          approvedPlan.id,
          error instanceof Error ? error.message : String(error),
        )
        throw error
      }
    } catch (error) {
      this.deps.store.updateProposalStatus(proposal.id, 'failed')
      this.deps.store.transitionProposalFindings(proposal.id, ['in_progress'], 'open')
      this.deps.store.finishAutomationRun(claim.id, claim.leaseToken, 'failed', error instanceof Error ? error.message : String(error))
      throw error
    }
    return { proposal: this.deps.store.read.getProposal(proposal.id), plan }
  }

  private async discussPlan(planId: string, content: string): Promise<{ groupSessionId: string; participants: number; status: 'started' }> {
    const plan = this.orchestration.getPlan(planId)
    if (plan.status === 'rejected') throw new AppError('CONFLICT', '已拒绝的计划不能群聊')
    const sessions = this.deps.store.read.listSessionSummaries(plan.projectId)
    const group =
      sessions.find((session) => session.title === planGroupTitle(plan.goal, plan.revision)) ??
      sessions.find((session) => session.title.startsWith('计划群聊 ·'))
    if (!group) throw new AppError('CONFLICT', '计划群聊尚未建立，请重新批准计划')
    if (this.groupDiscussions.has(group.id) || this.deps.store.read.getActiveRunForSession(group.id)) {
      throw new AppError('CONFLICT', '计划群聊正在讨论中，请等待当前轮次完成')
    }
    const agentIds = [
      ...new Set(
        plan.tasks
          .filter((task) => !task.assignmentBlocked)
          .map((task) => agentForPlannedTask(task))
          .filter((id): id is string => Boolean(id)),
      ),
    ]
    const agents = agentIds
      .map((id) => this.deps.store.read.getAgent(id))
      .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent))
    if (agents.length === 0) throw new AppError('CONFLICT', '计划没有可参与群聊的 Agent')
    const message = this.deps.services.sessions.sendMessage({ sessionId: group.id, content, startRun: false })
    const discussion = this.runGroupDiscussion(plan.projectId, plan.id, group.id, agents, content, message.id)
      .catch((error) => {
        this.deps.logger.error({ err: error, planId, sessionId: group.id }, 'group discussion crashed')
      })
      .finally(() => {
        this.groupDiscussions.delete(group.id)
      })
    this.groupDiscussions.set(group.id, discussion)
    return { groupSessionId: group.id, participants: agents.length, status: 'started' as const }
  }

  private async runGroupDiscussion(
    projectId: string,
    planId: string,
    sessionId: string,
    agents: Array<{ id: string; name: string; role: string }>,
    content: string,
    messageId: string,
  ): Promise<void> {
    type TurnStatus = 'completed' | 'failed' | 'timeout' | 'cancelled' | 'skipped'
    interface TurnResult {
      agentId: string
      name: string
      status: TurnStatus
      runId?: string
      error?: string
    }
    const results: TurnResult[] = agents.map((agent) => ({ agentId: agent.id, name: agent.name, status: 'skipped' }))
    let stopped = false
    try {
      for (const [index, agent] of agents.entries()) {
        if (stopped) continue
        const leftover = this.deps.store.read.getActiveRunForSession(sessionId)
        if (leftover) {
          try {
            await this.deps.runner.cancel(leftover.id)
          } catch (error) {
            this.deps.logger.warn({ err: error, runId: leftover.id }, 'failed to cancel leftover group run')
          }
          results[index] = {
            agentId: agent.id,
            name: agent.name,
            status: 'failed',
            runId: leftover.id,
            error: '群聊会话存在未结束的运行，已取消',
          }
          this.deps.store.appendMessage({
            sessionId,
            role: 'system',
            content: `${agent.name} 本轮未能发言：上一条运行未结束，已取消。`,
            metadata: { kind: 'group-error', agentId: agent.id, runId: leftover.id },
          })
          continue
        }
        const detail = this.deps.store.read.getSessionDetail(sessionId, 120)
        const transcript = (detail?.messages ?? [])
          .filter((message) => message.role !== 'system')
          .slice(-24)
          .map((message) => `${message.role === 'user' ? '用户' : message.agentName ?? 'Agent'}：${message.content.slice(0, 1200)}`)
          .join('\n\n')
        const prompt = [
          `[计划群聊] 你是 ${agent.name}（${agent.role}）。`,
          '这是一个多 Agent 头脑风暴群聊。请阅读前文，分析其他 Agent 的观点，给出你的判断、风险、分歧和下一步建议。',
          '不要只复述用户的话；明确提出你同意什么、反对什么、还需要什么信息。',
          '',
          '最近讨论：',
          transcript,
          '',
          `用户最新发言：${content}`,
        ].join('\n')
        try {
          const started = await this.deps.runner.startRun({
            projectId,
            sessionId,
            prompt,
            messageId,
            agentId: agent.id,
            promptOverride: prompt,
          })
          const { run, timedOut } = await this.deps.runner.awaitRunTerminal(started.runId, {
            timeoutMs: groupTurnTimeoutMs(),
            pollMs: 200,
          })
          if (timedOut) {
            results[index] = {
              agentId: agent.id,
              name: agent.name,
              status: 'timeout',
              runId: started.runId,
              error: `超过 ${groupTurnTimeoutMs()}ms 未完成，已取消`,
            }
            this.deps.store.appendMessage({
              sessionId,
              role: 'system',
              content: `${agent.name} 本轮超时，运行已取消；本轮讨论停止。`,
              metadata: { kind: 'group-timeout', agentId: agent.id, runId: started.runId },
            })
            stopped = true
            continue
          }
          if (run.status === 'completed') {
            const hasReply = (this.deps.store.read.getMessages(sessionId, 400) ?? []).some(
              (message) => message.runId === started.runId && message.role === 'assistant' && message.content.trim().length > 0,
            )
            if (!hasReply) {
              results[index] = {
                agentId: agent.id,
                name: agent.name,
                status: 'failed',
                runId: started.runId,
                error: '运行完成但没有可见回复',
              }
              this.deps.store.appendMessage({
                sessionId,
                role: 'system',
                content: `${agent.name} 本轮运行完成，但没有产生可见回复。`,
                metadata: { kind: 'group-error', agentId: agent.id, runId: started.runId },
              })
              continue
            }
            results[index] = { agentId: agent.id, name: agent.name, status: 'completed', runId: started.runId }
            continue
          }
          if (run.status === 'cancelled') {
            results[index] = {
              agentId: agent.id,
              name: agent.name,
              status: 'cancelled',
              runId: started.runId,
              error: run.error ?? '运行已取消',
            }
            this.deps.store.appendMessage({
              sessionId,
              role: 'system',
              content: `${agent.name} 本轮已取消；本轮讨论停止。`,
              metadata: { kind: 'group-cancelled', agentId: agent.id, runId: started.runId },
            })
            stopped = true
            continue
          }
          results[index] = {
            agentId: agent.id,
            name: agent.name,
            status: 'failed',
            runId: started.runId,
            error: run.error ?? `运行状态：${run.status}`,
          }
          this.deps.store.appendMessage({
            sessionId,
            role: 'system',
            content: `${agent.name} 本轮未能发言：${run.error ?? run.status}`,
            metadata: { kind: 'group-error', agentId: agent.id, runId: started.runId, status: run.status },
          })
          if (run.status === 'needs_reconciliation') stopped = true
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          results[index] = { agentId: agent.id, name: agent.name, status: 'failed', error: message }
          this.deps.logger.warn({ err: error, agentId: agent.id, sessionId }, 'group chat agent turn failed')
          this.deps.store.appendMessage({
            sessionId,
            role: 'system',
            content: `${agent.name} 本轮未能发言：${message}`,
            metadata: { kind: 'group-error', agentId: agent.id },
          })
        }
      }
    } finally {
      const succeeded = results.filter((result) => result.status === 'completed').length
      const failed = results.filter((result) => result.status === 'failed' || result.status === 'timeout').length
      const cancelled = results.filter((result) => result.status === 'cancelled').length
      const skipped = results.filter((result) => result.status === 'skipped').length
      this.deps.store.appendMessage({
        sessionId,
        role: 'system',
        content: [
          `本轮群聊完成：成功 ${succeeded} / 失败 ${failed} / 取消 ${cancelled} / 跳过 ${skipped}`,
          '',
          ...results.map((result) => {
            const suffix = result.error ? `（${result.error}）` : ''
            return `- ${result.name}：${result.status}${suffix}`
          }),
        ].join('\n'),
        metadata: {
          kind: 'group-summary',
          planId,
          succeeded,
          failed,
          cancelled,
          skipped,
          results,
        },
      })
    }
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
      case 'runtime.settings.get': {
        return this.runtimeSettings.get()
      }
      case 'runtime.settings.update': {
        const input = this.parse('runtime.settings.update', rawInput)
        return this.runtimeSettings.update(input)
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
      case 'lifecycle.overview': {
        const input = this.parse('lifecycle.overview', rawInput)
        return this.lifecycle.overview(input.projectId)
      }
      case 'product.list': {
        const input = this.parse('product.list', rawInput)
        return { products: this.lifecycle.products(input.projectId) }
      }
      case 'version.create': {
        const input = this.parse('version.create', rawInput)
        return this.lifecycle.createVersion(input)
      }
      case 'version.transition': {
        const input = this.parse('version.transition', rawInput)
        return this.lifecycle.transitionVersion(input)
      }
      case 'iteration.create': {
        const input = this.parse('iteration.create', rawInput)
        return this.lifecycle.createIteration(input)
      }
      case 'iteration.setStatus': {
        const input = this.parse('iteration.setStatus', rawInput)
        return this.lifecycle.setIterationStatus(input.iterationId, input.status)
      }
      case 'environment.create': {
        const input = this.parse('environment.create', rawInput)
        return this.lifecycle.createEnvironment(input)
      }
      case 'project.focus.set': {
        const input = this.parse('project.focus.set', rawInput)
        return this.lifecycle.setFocus(input)
      }
      case 'evidence.record': {
        const input = this.parse('evidence.record', rawInput)
        return this.lifecycle.recordEvidence(input)
      }
      case 'gate.overview': {
        const input = this.parse('gate.overview', rawInput)
        return this.lifecycle.gateOverview(input.projectId, input.subjectType, input.subjectId)
      }
      case 'resource.overview': {
        const input = this.parse('resource.overview', rawInput)
        return this.resources.overview(input.projectId)
      }
      case 'resource.create': {
        const input = this.parse('resource.create', rawInput)
        return this.resources.create(input)
      }
      case 'resource.update': {
        const input = this.parse('resource.update', rawInput)
        return this.resources.update(input)
      }
      case 'resource.profile.create': {
        const input = this.parse('resource.profile.create', rawInput)
        return this.resources.createProfile(input)
      }
      case 'resource.profile.update': {
        const input = this.parse('resource.profile.update', rawInput)
        return this.resources.updateProfile(input)
      }
      case 'resource.profile.delete': {
        const input = this.parse('resource.profile.delete', rawInput)
        return this.resources.deleteProfile(input.profileId)
      }
      case 'resource.credential.register': {
        const input = this.parse('resource.credential.register', rawInput)
        return this.resources.registerCredential(input)
      }
      case 'resource.credential.disable': {
        const input = this.parse('resource.credential.disable', rawInput)
        return this.resources.disableCredential(input.credentialId)
      }
      case 'resource.profile.internal': {
        const input = this.parse('resource.profile.internal', rawInput)
        return this.resources.internalProfile(input.profileId)
      }
      case 'resource.test.record': {
        const input = this.parse('resource.test.record', rawInput)
        return this.resources.recordTest(input)
      }
      case 'release.overview': {
        const input = this.parse('release.overview', rawInput)
        return this.release.overview(input.projectId, input.versionId)
      }
      case 'release.approvals': {
        const input = this.parse('release.approvals', rawInput)
        return { approvals: this.release.listApprovals(input.projectId) }
      }
      case 'changeRequest.create': {
        const input = this.parse('changeRequest.create', rawInput)
        return this.release.createChangeRequest(input)
      }
      case 'changeRequest.update': {
        const input = this.parse('changeRequest.update', rawInput)
        return this.release.updateChangeRequest(input)
      }
      case 'changeRequest.submit': {
        const input = this.parse('changeRequest.submit', rawInput)
        return this.release.submitChangeRequest(input.changeRequestId)
      }
      case 'release.approval.decide': {
        const input = this.parse('release.approval.decide', rawInput)
        return this.release.decideApproval(input)
      }
      case 'release.candidate.create': {
        const input = this.parse('release.candidate.create', rawInput)
        return this.release.createCandidate(input)
      }
      case 'release.create': {
        const input = this.parse('release.create', rawInput)
        return this.release.createRelease(input)
      }
      case 'deployment.create': {
        const input = this.parse('deployment.create', rawInput)
        return this.release.createDeployment(input)
      }
      case 'deployment.record': {
        const input = this.parse('deployment.record', rawInput)
        return this.release.recordDeploymentResult(input)
      }
      case 'deployment.inspect': {
        const input = this.parse('deployment.inspect', rawInput)
        return this.release.inspectDeployment(input.deploymentId)
      }
      case 'deployment.prepare': {
        const input = this.parse('deployment.prepare', rawInput)
        return this.release.prepareDeployment(input.deploymentId)
      }
      case 'deployment.finish': {
        const input = this.parse('deployment.finish', rawInput)
        return this.release.finishDeployment(input)
      }
      case 'deployment.operation.step': {
        const input = this.parse('deployment.operation.step', rawInput)
        return this.release.recordOperationStep(input)
      }
      case 'deployment.operation.mark_unknown': {
        const input = this.parse('deployment.operation.mark_unknown', rawInput)
        return this.release.markOperationUnknown(input)
      }
      case 'deployment.operations': {
        const input = this.parse('deployment.operations', rawInput)
        return this.release.deploymentOperations(input.deploymentId)
      }
      case 'deployment.prepare_context': {
        const input = this.parse('deployment.prepare_context', rawInput)
        return this.release.deploymentContext(input.deploymentId)
      }
      case 'deployment.reconcile': {
        const input = this.parse('deployment.reconcile', rawInput)
        return this.release.reconcileDeployment(input)
      }
      case 'deployment.execute.local': {
        const input = this.parse('deployment.execute.local', rawInput)
        return this.release.executeDeployment(input.deploymentId)
      }
      case 'deployment.execute': {
        const input = this.parse('deployment.execute', rawInput)
        return this.release.executeDeployment(input.deploymentId)
      }
      case 'delivery.adapters': {
        this.parse('delivery.adapters', rawInput)
        return this.release.adapterCapabilities()
      }
      case 'deployment.rollback': {
        const input = this.parse('deployment.rollback', rawInput)
        return this.release.createRollback(input.sourceDeploymentId, input)
      }
      case 'deployment.target.create': {
        const input = this.parse('deployment.target.create', rawInput)
        return this.release.createTarget(input)
      }
      case 'deployment.strategy.create': {
        const input = this.parse('deployment.strategy.create', rawInput)
        return this.release.createStrategy(input)
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
      case 'task.acceptancePolicy': {
        const input = this.parse('task.acceptancePolicy', rawInput)
        return services.tasks.acceptancePolicy(input.taskId)
      }
      case 'task.requestAcceptance': {
        const input = this.parse('task.requestAcceptance', rawInput)
        return services.tasks.requestAcceptance(input)
      }
      case 'task.decideAcceptance': {
        const input = this.parse('task.decideAcceptance', rawInput)
        const approval = services.tasks.decideAcceptance(input)
        return { approvalId: approval.id, status: approval.status }
      }
      case 'task.confirmAcceptance': {
        const input = this.parse('task.confirmAcceptance', rawInput)
        return { task: services.tasks.confirmAcceptance(input) }
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
      case 'agentDefinition.list': {
        return { agents: this.agentStudio.listAgents() }
      }
      case 'agentDefinition.upsert': {
        const input = this.parse('agentDefinition.upsert', rawInput)
        return this.agentStudio.upsertAgent(input)
      }
      case 'agentDefinition.setStatus': {
        const input = this.parse('agentDefinition.setStatus', rawInput)
        return this.agentStudio.setStatus(input.id, input.status)
      }
      case 'agentDefinition.export': {
        const input = this.parse('agentDefinition.export', rawInput)
        return this.agentStudio.exportAgent(input.id)
      }
      case 'agentDefinition.import': {
        const input = this.parse('agentDefinition.import', rawInput)
        return this.agentStudio.importAgent(input.json)
      }
      case 'agentDefinition.delete': {
        const input = this.parse('agentDefinition.delete', rawInput)
        this.agentStudio.deleteAgent(input.id)
        return { ok: true as const }
      }
      case 'agentDefinition.run': {
        // Phase 0: the legacy Agent Studio direct-run path bypasses the scheduler,
        // execution slots, task leases and approval. Use Agent Workbench sessions
        // (AgentRunner.startRun) instead until it is routed through the gateway.
        this.parse('agentDefinition.run', rawInput)
        throw new AppError('POLICY_DENIED', 'Agent Studio 直跑入口已在 Phase 0 禁用；请在 Agent 工作台创建会话运行 Agent')
      }
      case 'agentDefinition.preview': {
        const input = this.parse('agentDefinition.preview', rawInput)
        return this.agentStudio.preview(input.id)
      }
      case 'skill.list': {
        return { skills: this.agentStudio.listSkills() }
      }
      case 'skill.import': {
        const input = this.parse('skill.import', rawInput)
        return this.agentStudio.importSkill(input)
      }
      case 'runtime.list': {
        return { profiles: this.agentStudio.listRuntimeProfiles(), detections: await this.agentStudio.detect() }
      }
      case 'runtime.upsert': {
        const input = this.parse('runtime.upsert', rawInput)
        return this.agentStudio.upsertRuntime(input)
      }
      case 'runtime.delete': {
        const input = this.parse('runtime.delete', rawInput)
        this.agentStudio.deleteRuntime(input.id)
        return { ok: true as const }
      }
      case 'runtime.detect': {
        const input = this.parse('runtime.detect', rawInput)
        return { detections: await this.agentStudio.detect(input.profileId) }
      }
      case 'runtime.install': {
        this.parse('runtime.install', rawInput)
        // Phase 0: global npm installation is an unapproved process/network
        // side effect. Keep detection/registry read-only until an approved
        // installer path exists.
        throw new AppError('POLICY_DENIED', 'Phase 0 已禁用自动安装 Harness（缺少审批）；请手动安装后在设置中检测')
      }
      case 'runtime.importRegistry': {
        const input = this.parse('runtime.importRegistry', rawInput)
        return this.agentStudio.importRegistry(input)
      }
      case 'runtime.acpAuthenticate': {
        const input = this.parse('runtime.acpAuthenticate', rawInput)
        return this.agentStudio.acpAuthenticate(input.profileId, input.methodId, input.cwd)
      }
      case 'runtime.acpHandshake': {
        const input = this.parse('runtime.acpHandshake', rawInput)
        return this.agentStudio.acpHandshake(input.profileId, input.cwd)
      }
      case 'runtime.cancel': {
        const input = this.parse('runtime.cancel', rawInput)
        this.runtimeExecutor.cancel(input.executionId)
        return { ok: true as const }
      }
      case 'runtime.registry': {
        const input = this.parse('runtime.registry', rawInput)
        return this.agentStudio.registry(input.force)
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
        // Validate session, task dependencies, Agent state, runtime availability and
        // provider credentials before persisting a user message or creating a Run.
        runner.assertRunnable({
          projectId: input.projectId,
          sessionId: input.sessionId,
          taskId: input.taskId,
        })
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
      case 'run.reconcile': {
        const input = this.parse('run.reconcile', rawInput)
        const run = await runner.reconcileRun(input.runId, input.decision, input.note)
        if (input.decision !== 'failed' && run.taskId) {
          const plan = store.read
            .listPlanRevisions(run.projectId)
            .find((item) => item.createdTaskIds.includes(run.taskId!))
          if (plan?.execution?.status === 'paused') {
            try {
              await this.scheduler.resume(plan.id)
            } catch (error) {
              this.deps.logger.warn({ err: error, planId: plan.id }, 'failed to resume plan after reconcile')
            }
          }
        }
        return { runId: run.id, status: run.status, taskId: run.taskId }
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
        return { handoffs: services.collaboration.listHandoffs(input.projectId) }
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
      case 'handoff.cancel': {
        const input = this.parse('handoff.cancel', rawInput)
        return { handoff: services.collaboration.cancelHandoff(input.handoffId, input.reason) }
      }
      case 'handoff.policy.get': {
        const input = this.parse('handoff.policy.get', rawInput)
        return services.collaboration.getPolicy(input.projectId)
      }
      case 'handoff.policy.set': {
        const input = this.parse('handoff.policy.set', rawInput)
        return services.collaboration.setPolicy(input.projectId, input.mode)
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
        this.parse('externalAgents.execute', rawInput)
        // Phase 0: external CLI runs have no run-level approval yet. Keep
        // detection/list, but fail closed rather than spawning an unapproved
        // external agent. The controlled CLI/ACP path is Agent Workbench.
        throw new AppError('POLICY_DENIED', 'Phase 0 已禁用外部 Agent 执行（缺少运行级审批）；请使用 Agent 工作台的受控 CLI/ACP 或原生 Agent')
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
        await this.operations.runChecks(input.projectId)
        await this.autoStartRepairs(input.projectId)
        return this.operations.snapshot(input.projectId)
      }
      case 'operations.propose': {
        const input = this.parse('operations.propose', rawInput)
        return this.operations.propose(input.projectId, input.findingIds)
      }
      case 'operations.insights': {
        const input = this.parse('operations.insights', rawInput)
        return this.operations.insights(input.projectId, input.runAudit)
      }
      case 'operations.risk': {
        const input = this.parse('operations.risk', rawInput)
        return this.operations.risk(input.proposalId)
      }
      case 'operations.getGrant': {
        const input = this.parse('operations.getGrant', rawInput)
        return this.operations.getGrant(input.projectId)
      }
      case 'operations.grant': {
        const input = this.parse('operations.grant', rawInput)
        return this.operations.grant(input.projectId, input.hours, input.maxRuns)
      }
      case 'operations.revokeGrant': {
        const input = this.parse('operations.revokeGrant', rawInput)
        return this.operations.revokeGrant(input.projectId)
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
        return this.startRepair(input.proposalId)
      }
      case 'operations.reviewProposal': {
        const input = this.parse('operations.reviewProposal', rawInput)
        return this.operations.reviewProposal(input.proposalId, input.decision)
      }
      case 'operations.setMode': {
        const input = this.parse('operations.setMode', rawInput)
        return this.operations.setMode(input.projectId, input.mode, input.repairAgentId)
      }
      case 'project.budget.get': {
        const input = this.parse('project.budget.get', rawInput)
        return this.orchestration.budget(input.projectId)
      }
      case 'project.budget.set': {
        const input = this.parse('project.budget.set', rawInput)
        return this.orchestration.setBudget(input.projectId, input.softLimit, input.currency)
      }
      case 'project.qualityPolicy.get': {
        const input = this.parse('project.qualityPolicy.get', rawInput)
        services.projects.getProjectOrThrow(input.projectId)
        return (
          this.deps.store.read.getQualityPolicy(input.projectId) ?? {
            required: ['test'],
            optional: ['typecheck', 'lint', 'build'],
          }
        )
      }
      case 'project.qualityPolicy.set': {
        const input = this.parse('project.qualityPolicy.set', rawInput)
        services.projects.getProjectOrThrow(input.projectId)
        this.deps.store.setQualityPolicy(input.projectId, {
          required: input.required,
          optional: input.optional,
        })
        return { required: input.required, optional: input.optional }
      }
      case 'plan.generate': {
        const input = this.parse('plan.generate', rawInput)
        return this.orchestration.generateAIPlan({
          projectId: input.projectId,
          goal: input.goal,
          mode: input.mode,
          allowRuleFallback: input.allowRuleFallback,
          maxTasks: input.maxTasks,
          allowOverBudget: input.allowOverBudget,
        })
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
      case 'plan.discuss': {
        const input = this.parse('plan.discuss', rawInput)
        return this.discussPlan(input.planId, input.content)
      }
      case 'plan.grant.get': {
        const input = this.parse('plan.grant.get', rawInput)
        return this.planGrants.get(input.planId)
      }
      case 'plan.grant.issue': {
        const input = this.parse('plan.grant.issue', rawInput)
        return this.planGrants.issue(input)
      }
      case 'plan.grant.revoke': {
        const input = this.parse('plan.grant.revoke', rawInput)
        const revoked = this.planGrants.revoke(input.grantId, input.reason)
        const plan = this.orchestration.getPlan(revoked.planId)
        if (plan.execution && ['running', 'paused'].includes(plan.execution.status)) {
          try {
            await this.scheduler.cancel(plan.id)
          } catch (error) {
            this.deps.logger.warn({ err: error, planId: plan.id }, 'failed to stop plan after grant revocation')
          }
        }
        return this.planGrants.getById(revoked.id)
      }
      case 'plan.replan.propose': {
        const input = this.parse('plan.replan.propose', rawInput)
        return this.replans.propose({
          planId: input.planId,
          trigger: input.trigger,
          reason: input.reason,
          allowOverBudget: input.allowOverBudget,
        })
      }
      case 'plan.replan.list': {
        const input = this.parse('plan.replan.list', rawInput)
        return { proposals: this.replans.list(input.projectId, input.planId) }
      }
      case 'plan.replan.get': {
        const input = this.parse('plan.replan.get', rawInput)
        return this.replans.get(input.proposalId)
      }
      case 'plan.replan.apply': {
        const input = this.parse('plan.replan.apply', rawInput)
        return this.replans.apply(input.proposalId)
      }
      case 'plan.replan.reject': {
        const input = this.parse('plan.replan.reject', rawInput)
        return this.replans.reject(input.proposalId, input.reason)
      }
      case 'orchestration.start': {
        const input = this.parse('orchestration.start', rawInput)
        const plan = this.orchestration.getPlan(input.planId)
        const startKey = input.startRequestId?.trim() || `start:${plan.id}:r${plan.revision}:${newId('pgs')}`
        const candidateGrant = input.grantId
          ? this.planGrants.getById(input.grantId)
          : this.planGrants.get(plan.id)
        const existing = candidateGrant ? this.planGrants.findStartReservation(candidateGrant.id, startKey) : null
        if (existing?.status === 'started') return plan
        if (existing?.status === 'reserved') {
          throw new AppError('CONFLICT', '同一启动请求正在执行，请等待当前启动完成，不能重复占用授权')
        }
        if (existing?.status === 'failed') {
          throw new AppError('CONFLICT', '该启动请求上次失败，授权预留已释放；请使用新的启动请求重试')
        }
        const grant = this.planGrants.assertStartAllowed(plan, input.grantId)
        const budget = this.deps.store.read.getProjectBudget(plan.projectId)
        const spent = budget ? this.deps.store.read.summarizeAIUsage(plan.projectId).estimatedCost : 0
        if (budget && budget.softLimit > 0 && spent > budget.softLimit && input.allowOverBudget && !grant.allowOverBudget) {
          throw new AppError(
            'APPROVAL_REQUIRED',
            `项目 AI 软预算已超出（${spent.toFixed(4)} / ${budget.softLimit} ${budget.currency}）。本次超预算执行未在该计划授权中显式允许，请重新授权并记录风险说明。`,
          )
        }
        const reserved = this.planGrants.reserveStart(plan, grant, startKey)
        if (!reserved) throw new AppError('INTERNAL', '计划启动预留失败')
        try {
          const started = await this.scheduler.start(
            input.planId,
            input.concurrency,
            input.maxRetries,
            input.allowOverBudget,
            false,
            grant.allowedPaths,
            input.maxEvidenceRetries,
          )
          this.planGrants.markStartSucceeded(reserved.reservation.id, started)
          const overBudget =
            Boolean(budget && budget.softLimit > 0 && spent > budget.softLimit) &&
            input.allowOverBudget &&
            grant.allowOverBudget
          this.deps.store.appendEvent(plan.projectId, plan.id, PROJECT_EVENT_TYPES.planGrantStarted, {
            grantId: grant.id,
            planId: plan.id,
            revision: plan.revision,
            allowOverBudget: overBudget,
            spent,
            softLimit: budget?.softLimit ?? null,
            startRequestId: startKey,
            reservationId: reserved.reservation.id,
          })
          return started
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const settled = this.planGrants.settleStartFailure(reserved.reservation.id, plan.id, message)
          this.deps.logger.warn(
            { err: error, planId: plan.id, grantId: grant.id, reservationId: reserved.reservation.id, settled },
            'plan start failed; grant reservation settled',
          )
          throw error
        }
      }
      case 'orchestration.pause': {
        const input = this.parse('orchestration.pause', rawInput)
        return this.scheduler.pause(input.planId)
      }
      case 'orchestration.resume': {
        const input = this.parse('orchestration.resume', rawInput)
        const plan = this.orchestration.getPlan(input.planId)
        this.planGrants.assertExecutionActive(plan)
        return this.scheduler.resume(input.planId)
      }
      case 'orchestration.cancel': {
        const input = this.parse('orchestration.cancel', rawInput)
        return this.scheduler.cancel(input.planId)
      }
      case 'orchestration.reassign': {
        const input = this.parse('orchestration.reassign', rawInput)
        return this.scheduler.confirmReassignment(input.planId, input.taskId, input.agentId)
      }
      case 'orchestration.declineReassign': {
        const input = this.parse('orchestration.declineReassign', rawInput)
        return this.scheduler.declineReassignment(input.planId, input.taskId, input.note)
      }
      case 'verification.request': {
        const input = this.parse('verification.request', rawInput)
        return this.requestVerification(input.projectId, input.taskId)
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

/** Per-turn group-chat timeout; configurable so regression tests never wait minutes. */
function groupTurnTimeoutMs(): number {
  const raw = Number(process.env.PROJECTOS_GROUP_TURN_TIMEOUT_MS ?? 120_000)
  if (!Number.isFinite(raw)) return 120_000
  return Math.max(1_000, Math.min(30 * 60_000, Math.trunc(raw)))
}






















