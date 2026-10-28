import { execFileSync } from 'node:child_process'
import {
  AppError,
  now,
  type AgentCapability,
  type HandoffView,
  type PlanDraft,
  type PlanExecution,
  type PlanRole,
  type PlannedTask,
  type ReplanTrigger,
  type TaskCard,
  type WorktreeInfo,
} from '@projectos/contracts'
import { evaluateCompletion, reviewVerdictOf, type CoreServices } from '@projectos/application'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import { getGitStatus } from '@projectos/workspace'
import { createArtifactRecord } from '@projectos/persistence'
import type { SqliteStore } from '@projectos/persistence'
import { WorktreeManager } from '@projectos/worktree'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import {
  mergeHardCapabilities,
  rankAssignmentCandidates,
  topologicalPlanTasks,
  type AssignmentRejection,
} from '@projectos/planning'
import type { AgentRunner } from './agent-runner.js'
import type { Logger } from './logger.js'
import { QualityGateService, DEFAULT_QUALITY_POLICY, type QualityGateReport } from './quality-gate.js'
import { planSessionTitle } from '@projectos/session-manager'
import { buildAssignmentCandidates } from './assignment-candidates.js'
import { classifyExecutionFailure } from './failure-classifier.js'

const SYSTEM_ACTOR = { kind: 'system' as const, id: 'orchestrator', name: '编排器' }

/** Ranked replacement candidate kept in the Handoff payload for user confirmation. */
export interface ReassignmentCandidateView {
  agentId: string
  name: string
  score: number
  reasons: string[]
  capabilities: string[]
  addedCapabilities: string[]
  runtime: string
  runtimeRank: number
  raisesRuntimeRisk: boolean
}

export interface ReassignmentDecision {
  status: 'applied' | 'needs_confirmation' | 'none'
  fromAgentId: string
  toAgentId: string | null
  candidates: ReassignmentCandidateView[]
  rejected: AssignmentRejection[]
  reasons: string[]
  explicitAssignment: boolean
  error: string
  originalAgent: { agentId: string; name: string; capabilities: string[]; runtime: string }
  runtimeChange: { from: string; to: string | null; increased: boolean }
}

function execution(status: PlanExecution['status'], concurrency: number, previous?: PlanExecution | null): PlanExecution {
  return {
    status,
    concurrency,
    startedAt: previous?.startedAt ?? now(),
    updatedAt: now(),
    error: previous?.error ?? null,
    runIds: previous?.runIds ?? [],
    workspaceRef: previous?.workspaceRef ?? null,
    branch: previous?.branch ?? null,
    allowedPaths: previous?.allowedPaths ?? ['.'],
    diffArtifactId: previous?.diffArtifactId ?? null,
    mergedAt: previous?.mergedAt ?? null,
    maxRetries: previous?.maxRetries ?? 2,
    retries: previous?.retries ?? {},
    nextAttemptAt: previous?.nextAttemptAt ?? {},
    retryForRun: previous?.retryForRun ?? {},
    maxEvidenceRetries: previous?.maxEvidenceRetries ?? 1,
    evidenceRetries: previous?.evidenceRetries ?? {},
    evidenceRetryForRun: previous?.evidenceRetryForRun ?? {},
    requireWorktree: previous?.requireWorktree ?? false,
    maxWallClockMs: previous?.maxWallClockMs ?? 0,
    deadlineAt: previous?.deadlineAt ?? 0,
    budgetExhausted: previous?.budgetExhausted ?? null,
  }
}

/**
 * Select at most `slots` ready tasks, and at most one task per Agent.
 * Same-Agent tasks stay ready and are picked up on a later tick, after the
 * Agent's current Run has released its Session. This is the serial queue that
 * prevents "该会话已有运行中的 Agent" from failing a whole plan.
 */
export function selectStartableTasks(input: {
  ready: TaskCard[]
  activeAgentIds: Iterable<string>
  slots: number
}): TaskCard[] {
  const active = new Set(input.activeAgentIds)
  const selected: TaskCard[] = []
  for (const card of input.ready) {
    if (selected.length >= input.slots) break
    if (!card.assigneeAgentId || active.has(card.assigneeAgentId)) continue
    selected.push(card)
    active.add(card.assigneeAgentId)
  }
  return selected
}

export class OrchestrationScheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly ticking = new Set<string>
  private readonly workspaceInflight = new Map<string, Promise<string>>()
  private readonly qualityReports = new Map<string, QualityGateReport>()

  constructor(
    private readonly store: SqliteStore,
    private readonly services: CoreServices,
    private readonly runner: AgentRunner,
    private readonly logger: Logger,
    private readonly dataDir: string,
    private readonly qualityGate = new QualityGateService(),
    private readonly worktrees = new WorktreeManager(),
    /**
     * Trusted backend guard. Production wires this to PlanGrantService; direct
     * scheduler unit tests omit it. It is never derived from renderer state.
     */
    private readonly planGrantGuard?: (plan: PlanDraft) => void,
    /** Trusted, user-confirmed Handoff substitution only. */
    private readonly onAgentReassigned?: (planId: string, taskId: string, agentId: string) => void,
    /** Automatic trigger only. It creates a proposal; it never applies it. */
    private readonly onReplanNeeded?: (planId: string, trigger: ReplanTrigger, reason: string) => void,
  ) {}

  private notifyReplan(plan: PlanDraft, trigger: ReplanTrigger, reason: string): void {
    const classification = classifyExecutionFailure(reason)
    try {
      this.store.appendEvent(plan.projectId, plan.id, PROJECT_EVENT_TYPES.planExecutionFailureClassified, {
        planId: plan.id,
        revision: plan.revision,
        trigger,
        failureClass: classification.class,
        action: classification.action,
        replan: classification.replan,
        reason: classification.reason,
        error: reason.slice(0, 2000),
      })
    } catch (error) {
      this.logger.warn({ err: error, planId: plan.id }, 'failed to persist failure classification')
    }
    if (!classification.replan) {
      this.logger.info(
        { planId: plan.id, trigger, failureClass: classification.class, action: classification.action },
        'execution failure is technical/recoverable; replan proposal suppressed',
      )
      return
    }
    if (!this.onReplanNeeded) return
    try {
      this.onReplanNeeded(plan.id, trigger, reason.slice(0, 3000))
    } catch (error) {
      this.logger.warn({ err: error, planId: plan.id, trigger }, 'failed to request replan proposal')
    }
  }

  private getPlan(planId: string): PlanDraft {
    const plan = this.store.read.getPlanRevision(planId)
    if (!plan) throw new AppError('NOT_FOUND', '计划不存在')
    return plan
  }

  private saveExecution(plan: PlanDraft, next: PlanExecution): PlanDraft {
    const updated: PlanDraft = { ...plan, execution: next, updatedAt: now() }
    this.store.updatePlanRevision(updated)
    return updated
  }

  async start(
    planId: string,
    concurrency = 2,
    maxRetries = 2,
    allowOverBudget = false,
    requireWorktree = false,
    allowedPaths?: string[],
    maxEvidenceRetries = 1,
  ): Promise<PlanDraft> {
    const plan = this.getPlan(planId)
    if (plan.status !== 'approved') throw new AppError('CONFLICT', '计划尚未批准，不能开始执行')
    this.planGrantGuard?.(plan)
    const budget = this.store.read.getProjectBudget(plan.projectId)
    if (budget && budget.softLimit > 0 && !allowOverBudget) {
      const spent = this.store.read.summarizeAIUsage(plan.projectId).estimatedCost
      if (spent > budget.softLimit) {
        throw new AppError('BUDGET_EXCEEDED', `项目已用估算费用 ${spent.toFixed(4)} 超过软预算 ${budget.softLimit}，需确认后继续`)
      }
    }
    if (!plan.createdTaskIds.length) throw new AppError('CONFLICT', '计划没有已创建的任务')
    if (plan.execution?.status === 'running') throw new AppError('CONFLICT', '计划已经在执行中')
    const planWallClockMs = this.runner.getLimits().planWallClockMs
    const next = this.saveExecution(plan, {
      ...execution('running', concurrency, plan.execution),
      maxWallClockMs: planWallClockMs,
      deadlineAt: planWallClockMs > 0 ? now() + planWallClockMs : 0,
      budgetExhausted: null,
      maxRetries: Math.max(0, Math.min(5, maxRetries)),
      maxEvidenceRetries: Math.max(0, Math.min(3, maxEvidenceRetries)),
      requireWorktree: requireWorktree || Boolean(plan.execution?.requireWorktree),
      allowedPaths:
        allowedPaths && allowedPaths.length
          ? allowedPaths
          : plan.execution?.allowedPaths ?? ['.'],
    })
    try {
      await this.ensureWorkspace(next)
    } catch (error) {
      const failed = this.getPlan(next.id)
      this.saveExecution(failed, {
        ...failed.execution!,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        updatedAt: now(),
      })
      throw error
    }
    this.arm(next.id)
    void this.tick(next.id)
    return this.getPlan(next.id)
  }

  pause(planId: string): PlanDraft {
    const plan = this.getPlan(planId)
    if (plan.execution?.status !== 'running') throw new AppError('CONFLICT', '计划不在执行中')
    this.disarm(planId)
    return this.saveExecution(plan, { ...plan.execution, status: 'paused', updatedAt: now() })
  }

  resume(planId: string): PlanDraft {
    const plan = this.getPlan(planId)
    if (plan.execution?.status !== 'paused') throw new AppError('CONFLICT', '计划不在暂停状态')
    this.planGrantGuard?.(plan)
    if (plan.execution.deadlineAt > 0 && now() >= plan.execution.deadlineAt) {
      throw new AppError('BUDGET_EXCEEDED', '计划总执行时间已超出上限，不能继续；请修订计划并重新开始')
    }
    // A human-requested verification may leave the reviewed task blocked. Resume
    // re-enters review so CompletionDecision can re-evaluate the new evidence
    // without starting a duplicate execution run.
    for (const taskId of plan.createdTaskIds) {
      const card = this.store.read.getTaskCard(taskId)
      if (!card || card.status !== 'blocked') continue
      if (this.store.read.getActiveRunForTask(taskId)) continue
      try {
        this.services.tasks.move({ taskId, expectedVersion: card.version, to: 'review' }, SYSTEM_ACTOR)
      } catch (error) {
        this.logger.warn({ err: error, taskId }, 'failed to requeue blocked task for review after resume')
      }
    }
    const next = this.saveExecution(plan, { ...plan.execution, status: 'running', error: null, updatedAt: now() })
    this.arm(planId)
    void this.tick(planId)
    return this.getPlan(next.id)
  }

  async cancel(planId: string): Promise<PlanDraft> {
    const plan = this.getPlan(planId)
    if (!plan.execution || !['running', 'paused'].includes(plan.execution.status)) {
      throw new AppError('CONFLICT', '计划没有可取消的执行')
    }
    this.disarm(planId)
    for (const taskId of plan.createdTaskIds) {
      const active = this.store.read.getActiveRunForTask(taskId)
      if (active) {
        try {
          await this.runner.cancel(active.id)
        } catch (error) {
          this.logger.warn({ err: error, taskId }, 'failed to cancel orchestrated run')
        }
      }
    }
    const cancelled = this.saveExecution(plan, { ...plan.execution, status: 'cancelled', updatedAt: now() })
    return cancelled
  }

  async info(planId: string): Promise<WorktreeInfo> {
    const plan = this.getPlan(planId)
    const execution = plan.execution
    const available = Boolean(
      execution?.branch && execution.workspaceRef && existsSync(execution.workspaceRef),
    )
    let diff = ''
    let files: WorktreeInfo['files'] = []
    if (available && execution?.workspaceRef) {
      try {
        diff = await this.worktrees.diff(execution.workspaceRef)
        files = await this.worktrees.changedFiles(execution.workspaceRef, execution.allowedPaths ?? ['.'])
      } catch (error) {
        diff = `无法读取 diff：${error instanceof Error ? error.message : String(error)}`
      }
    }
    return {
      planId,
      available,
      branch: execution?.branch ?? null,
      workspaceRef: execution?.workspaceRef ?? null,
      status: execution?.status ?? null,
      diff,
      files,
      diffArtifactId: execution?.diffArtifactId ?? null,
      mergedAt: execution?.mergedAt ?? null,
    }
  }

  async merge(planId: string): Promise<WorktreeInfo> {
    const plan = this.getPlan(planId)
    const execution = plan.execution
    if (!execution?.branch || !execution.workspaceRef) throw new AppError('CONFLICT', '该计划没有可合并的 Worktree')
    if (execution.status !== 'completed') throw new AppError('CONFLICT', '只有完成且通过质量门禁的计划可以合并')
    if (execution.mergedAt) throw new AppError('CONFLICT', '该 Worktree 已合并')
    const project = this.store.read.getProject(plan.projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    const result = await this.worktrees.merge(
      project.rootPath,
      execution.branch,
      `Merge ProjectOS plan ${plan.id}: ${plan.goal.slice(0, 120)}`,
      execution.allowedPaths ?? ['.'],
    )
    if (!result.ok) throw new AppError('CONFLICT', result.message || '合并失败')
    this.saveExecution(plan, { ...execution, mergedAt: now(), updatedAt: now() })
    return this.info(planId)
  }

  async discard(planId: string): Promise<void> {
    const plan = this.getPlan(planId)
    const execution = plan.execution
    if (!execution?.workspaceRef) throw new AppError('CONFLICT', '该计划没有 Worktree')
    if (execution.status === 'running') throw new AppError('CONFLICT', '运行中的计划不能丢弃 Worktree')
    const project = this.store.read.getProject(plan.projectId)
    if (project) await this.worktrees.remove(project.rootPath, execution.workspaceRef)
    this.saveExecution(plan, { ...execution, workspaceRef: null, branch: null, updatedAt: now() })
  }

  recover(): void {
    const plans = this.store.read.listAllPlanRevisions()
    for (const plan of plans) {
      if (plan.execution?.status !== 'running') continue
      this.arm(plan.id)
      void this.tick(plan.id)
    }
  }

  /**
   * Nudges every running plan of a project. Used by the autonomy coordinator when a
   * business event lands: it is the existing scheduler doing the work, just told that
   * something changed. Returns the plan ids that were nudged.
   */
  nudgeProject(projectId: string): string[] {
    const plans = this.store.read.listAllPlanRevisions().filter(
      (plan) => plan.projectId === projectId && plan.execution?.status === 'running',
    )
    for (const plan of plans) {
      this.arm(plan.id)
      void this.tick(plan.id)
    }
    return plans.map((plan) => plan.id)
  }

  shutdown(): void {
    for (const timer of this.timers.values()) clearInterval(timer)
    this.timers.clear()
  }

  private arm(planId: string): void {
    this.disarm(planId)
    const timer = setInterval(() => void this.tick(planId), 2_500)
    timer.unref?.()
    this.timers.set(planId, timer)
  }

  private disarm(planId: string): void {
    const timer = this.timers.get(planId)
    if (timer) clearInterval(timer)
    this.timers.delete(planId)
  }

  private handoffPayload(handoff: HandoffView): Record<string, unknown> {
    const payload = handoff.payload
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  }

  /**
   * Prepare accepted handoffs for the normal scheduler path. This method never
   * starts a Run: it only releases finished source runs, reassigns the Task and
   * moves it back to `ready`. The ready/start loop below remains the single
   * starter, so Task Lease and duplicate-Run protections stay in one place.
   */
  private async applyAcceptedHandoffs(plan: PlanDraft): Promise<void> {
    const handoffs = this.store.read
      .listHandoffViews(plan.projectId)
      .filter((handoff) => handoff.status === 'accepted' && plan.createdTaskIds.includes(handoff.taskId))
    for (const handoff of handoffs) {
      const payload = this.handoffPayload(handoff)
      if (payload.schedulerPreparedAt || payload.continuedAt || payload.continuationError) continue
      if (handoff.fromAgentId === handoff.toAgentId) continue
      const card = this.store.read.getTaskCard(handoff.taskId)
      if (!card || ['done', 'cancelled'].includes(card.status)) continue
      if (!this.store.read.isAgentVisibleToProject(plan.projectId, handoff.toAgentId)) {
        const hiddenCard = this.store.read.getTaskCard(handoff.taskId)
        if (hiddenCard && !['done', 'cancelled'].includes(hiddenCard.status)) {
          const decision = this.evaluateReassignment(
            plan,
            hiddenCard,
            handoff,
            '接收方 Agent 不在当前项目可见范围',
            ['接收方 Agent 不在当前项目可见范围，替代必须人工确认'],
          )
          this.recordReassignment(plan, handoff, decision)
          this.blockUnassignedTask(hiddenCard, `交接接收方不可见：${decision.reasons.join('；')}`)
        } else {
          this.store.updateHandoffPayload(handoff.id, {
            schedulerPreparedAt: now(),
            continuationError: '接收方 Agent 不在当前项目可见范围',
          })
        }
        continue
      }
      const activeRun = this.store.read.getActiveRunForTask(handoff.taskId)
      if (activeRun) continue
      const lease = this.store.read.getTaskLease(handoff.taskId)
      if (lease && lease.expiresAt > now()) {
        const holderRun = lease.holderId.startsWith('run:') ? this.store.read.getRun(lease.holderId.slice('run:'.length)) : null
        const holderActive =
          holderRun && !['completed', 'failed', 'cancelled', 'needs_reconciliation'].includes(holderRun.status)
        if (holderActive) continue
        try {
          this.store.releaseTaskLease(handoff.taskId, lease.holderId, lease.fencingToken)
        } catch (error) {
          this.logger.warn({ err: error, taskId: handoff.taskId, handoffId: handoff.id }, 'failed to release stale source lease')
          continue
        }
      }
      try {
        let latest = card
        if (latest.assigneeAgentId !== handoff.toAgentId) {
          latest = this.services.tasks.update(
            {
              taskId: latest.id,
              expectedVersion: latest.version,
              assigneeAgentId: handoff.toAgentId,
            },
            SYSTEM_ACTOR,
          )
        }
        if (latest.status === 'review') {
          latest = this.services.tasks.move(
            {
              taskId: latest.id,
              expectedVersion: latest.version,
              to: 'blocked',
              note: `交接续办：等待调度器启动 ${handoff.toAgentName}`,
            },
            SYSTEM_ACTOR,
          )
        }
        if (latest.status === 'running') {
          latest = this.services.tasks.move(
            {
              taskId: latest.id,
              expectedVersion: latest.version,
              to: 'ready',
              note: '交接续办：源运行已释放',
            },
            SYSTEM_ACTOR,
          )
        } else if (latest.status === 'blocked' || latest.status === 'backlog') {
          latest = this.services.tasks.move(
            {
              taskId: latest.id,
              expectedVersion: latest.version,
              to: 'ready',
              note: '交接续办：由调度器启动接收方',
            },
            SYSTEM_ACTOR,
          )
        }
        this.store.updateHandoffPayload(handoff.id, { schedulerPreparedAt: now() })
        this.store.appendEvent(plan.projectId, handoff.id, PROJECT_EVENT_TYPES.handoffContinued, {
          title: handoff.taskTitle,
          targetAgentId: handoff.toAgentId,
          targetAgentName: handoff.toAgentName,
        })
        if (handoff.toSessionId) {
          this.store.appendMessage({
            sessionId: handoff.toSessionId,
            role: 'system',
            content: `调度器已接手交接任务「${handoff.taskTitle}」；源运行释放后将启动 ${handoff.toAgentName}。`,
            metadata: { kind: 'handoff-scheduled', handoffId: handoff.id },
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.store.updateHandoffPayload(handoff.id, {
          schedulerPreparedAt: now(),
          continuationError: message,
        })
        this.logger.warn({ err: error, handoffId: handoff.id, taskId: handoff.taskId }, 'failed to prepare handoff continuation')
      }
    }
  }

  /**
   * Plan wall-clock deadline reached. Stop every in-flight Run with a distinct
   * `timed_out` terminal state, mark the Plan failed with a budget reason, and
   * never start another task — the audit records both decisions.
   */
  /**
   * Map created Task ids back to their planned nodes. `approvePlan` creates
   * tasks in topological order, so index parity is the durable mapping.
   */
  private plannedTaskFor(plan: PlanDraft, taskId: string): PlannedTask | null {
    const index = plan.createdTaskIds.indexOf(taskId)
    if (index < 0) return null
    return topologicalPlanTasks(plan)[index] ?? null
  }

  private static readonly ROLE_SET = new Set<PlanRole>(['architect', 'developer', 'reviewer', 'tester', 'custom'])

  private roleFor(card: TaskCard, planned: PlannedTask | null): PlanRole {
    if (planned) return planned.role
    const fromLabel = card.labels.find((label) => OrchestrationScheduler.ROLE_SET.has(label as PlanRole))
    return (fromLabel as PlanRole | undefined) ?? 'custom'
  }

  private runtimeRisk(agentId: string): { rank: number; label: string } {
    const definition = this.store.read.getAgentDefinition(agentId)
    const profileId = definition?.primaryRuntimeProfileId ?? definition?.runtimeProfileIds[0] ?? null
    if (!profileId) return { rank: 0, label: '内置 Provider' }
    const profile = this.store.read.listRuntimeProfiles().find((item) => item.id === profileId)
    if (!profile) return { rank: 3, label: `未知 Runtime ${profileId}` }
    if (profile.protocol === 'acp') return { rank: 1, label: `ACP ${profile.name}` }
    if (profile.protocol === 'native') return { rank: 0, label: `内置 ${profile.name}` }
    return { rank: 2, label: `CLI ${profile.name}` }
  }

  /**
   * Compute a safe substitute for a Handoff whose receiver failed to start.
   *
   * Hard rules (no silent substitution):
   * - explicit user assignment, non-low handoff risk, permission expansion,
   *   higher-risk Runtime, or unknown prior side effects all require confirmation;
   * - a candidate is only eligible through project visibility, active status,
   *   skills and Runtime availability (the shared assignment resolver);
   * - no candidate means an explicit `blocked`, never a fake success.
   */
  private evaluateReassignment(
    plan: PlanDraft,
    card: TaskCard,
    handoff: HandoffView,
    error: string,
    forcedConfirmationReasons: string[] = [],
  ): ReassignmentDecision {
    const planned = this.plannedTaskFor(plan, card.id)
    const payload = this.handoffPayload(handoff)
    // Unknown origin (legacy plan) is treated as explicit: never silently swap.
    const explicitAssignment = planned
      ? (planned.assignmentMode ?? (planned.agentId ? 'explicit' : 'auto')) === 'explicit'
      : true
    const role = this.roleFor(card, planned)
    const candidates = buildAssignmentCandidates({
      store: this.store,
      projectId: plan.projectId,
      listAgents: (projectId) => this.services.projects.listAgents(projectId),
      listTasks: (projectId) => this.services.tasks.board(projectId).tasks,
    }).filter((candidate) => candidate.agentId !== card.assigneeAgentId)
    const { ranked, rejected } = rankAssignmentCandidates({
      role,
      title: card.title,
      description: card.description,
      requiredCapabilities: planned?.requiredCapabilities,
      hardCapabilities: mergeHardCapabilities(role, planned?.hardCapabilities),
      candidates,
    })
    const originalAgent = card.assigneeAgentId ? this.store.read.getAgent(card.assigneeAgentId) : null
    const originalCapabilities = originalAgent?.capabilities ?? []
    const originalRisk = card.assigneeAgentId
      ? this.runtimeRisk(card.assigneeAgentId)
      : { rank: 0, label: '未知' }
    const top = ranked.slice(0, 3).map((entry) => {
      const risk = this.runtimeRisk(entry.candidate.agentId)
      return {
        agentId: entry.candidate.agentId,
        name: entry.candidate.name,
        score: entry.score,
        reasons: entry.reasons,
        capabilities: entry.candidate.capabilities,
        addedCapabilities: entry.candidate.capabilities.filter(
          (capability: AgentCapability) => !originalCapabilities.includes(capability),
        ),
        runtime: risk.label,
        runtimeRank: risk.rank,
        raisesRuntimeRisk: risk.rank > originalRisk.rank,
      }
    })
    const base: ReassignmentDecision = {
      status: 'none',
      fromAgentId: card.assigneeAgentId ?? handoff.toAgentId,
      toAgentId: null,
      candidates: top,
      rejected,
      reasons: [],
      explicitAssignment,
      error,
      originalAgent: {
        agentId: card.assigneeAgentId ?? handoff.toAgentId,
        name: handoff.toAgentName,
        capabilities: originalCapabilities,
        runtime: originalRisk.label,
      },
      runtimeChange: { from: originalRisk.label, to: null, increased: false },
    }
    if (top.length === 0) {
      return {
        ...base,
        reasons: [
          '没有可用的替代 Agent',
          ...rejected.slice(0, 4).map((item) => `${item.name}：${item.reasons.join('；')}`),
        ],
      }
    }

    const confirmReasons: string[] = [...forcedConfirmationReasons]
    if (explicitAssignment) confirmReasons.push('用户显式指定了接收方 Agent，不能静默换人')
    if (payload.riskLevel !== 'low') {
      confirmReasons.push(`交接风险等级为 ${String(payload.riskLevel ?? '未知')}，不满足低风险自动替代条件`)
    }
    const selected = ranked[0]!.candidate
    const selectedView = top[0]!
    if (selectedView.addedCapabilities.length > 0) {
      confirmReasons.push(`替代 Agent 权限更大（新增能力：${selectedView.addedCapabilities.join(', ')}）`)
    }
    if (selectedView.raisesRuntimeRisk) {
      confirmReasons.push(`替代 Runtime 风险更高（${originalRisk.label} → ${selectedView.runtime}）`)
    }
    const runtimeChange = {
      from: originalRisk.label,
      to: selectedView.runtime,
      increased: selectedView.raisesRuntimeRisk,
    }

    const active = this.store.read.getActiveRunForTask(card.id)
    const lease = this.store.read.getTaskLease(card.id)
    if (active) confirmReasons.push(`原 Run ${active.id} 仍处于 ${active.status}，无法判断先前执行的副作用`)
    if (lease && lease.expiresAt > now()) {
      const holder = lease.holderId.startsWith('run:')
        ? this.store.read.getRun(lease.holderId.slice('run:'.length))
        : null
      const holderActive = holder && !['completed', 'failed', 'cancelled', 'timed_out', 'budget_exhausted', 'needs_reconciliation'].includes(holder.status)
      if (holderActive || !holder) confirmReasons.push('原 Task Lease 未释放，不能直接换人')
    }
    const latest = this.store.read.getLatestRunForTask(card.id)
    if (latest?.status === 'needs_reconciliation') {
      confirmReasons.push('存在待人工核对的 Run，先前副作用未知')
    }

    if (confirmReasons.length > 0) {
      return { ...base, status: 'needs_confirmation', reasons: confirmReasons, runtimeChange }
    }
    return {
      ...base,
      status: 'applied',
      toAgentId: selected.agentId,
      reasons: [`低风险交接（${String(payload.riskLevel)}），自动选择 ${selected.name}`, ...ranked[0]!.reasons],
      runtimeChange,
    }
  }

  private recordReassignment(
    plan: PlanDraft,
    handoff: HandoffView,
    decision: ReassignmentDecision,
  ): void {
    this.store.updateHandoffPayload(handoff.id, {
      continuationError: decision.error,
      reassignment: {
        status: decision.status,
        fromAgentId: decision.fromAgentId,
        toAgentId: decision.toAgentId,
        candidates: decision.candidates,
        rejected: decision.rejected.slice(0, 5),
        reasons: decision.reasons,
        explicitAssignment: decision.explicitAssignment,
        requiresConfirmation: decision.status === 'needs_confirmation',
        originalError: decision.error,
        originalAgent: decision.originalAgent,
        runtimeChange: decision.runtimeChange,
        decidedAt: now(),
      },
    })
    this.store.appendEvent(plan.projectId, handoff.id, PROJECT_EVENT_TYPES.handoffReassignmentProposed, {
      taskId: handoff.taskId,
      taskTitle: handoff.taskTitle,
      status: decision.status,
      fromAgentId: decision.fromAgentId,
      toAgentId: decision.toAgentId,
      candidates: decision.candidates.map((candidate) => candidate.agentId),
      reasons: decision.reasons,
      error: decision.error,
    })
  }

  /**
   * Called when the receiver Run cannot start. Returns true when the Task was
   * re-queued for another Agent (the normal scheduler loop starts it later).
   */
  private hasPendingReassignment(projectId: string, taskId: string): boolean {
    return this.store.read
      .listHandoffViews(projectId)
      .some((handoff) => {
        if (handoff.taskId !== taskId || handoff.status !== 'accepted') return false
        const reassignment = this.handoffPayload(handoff).reassignment
        return Boolean(
          reassignment &&
            typeof reassignment === 'object' &&
            (reassignment as Record<string, unknown>).status === 'needs_confirmation',
        )
      })
  }

  private async handleReceiverStartFailure(
    plan: PlanDraft,
    card: TaskCard,
    handoff: HandoffView,
    error: string,
  ): Promise<boolean> {    const decision = this.evaluateReassignment(plan, card, handoff, error)
    this.recordReassignment(plan, handoff, decision)
    if (decision.status !== 'applied' || !decision.toAgentId) {
      const note =
        decision.status === 'none'
          ? `交接接收方启动失败且没有合法替代：${decision.reasons.join('；')}`
          : `交接接收方启动失败，替代需要确认：${decision.reasons.join('；')}`
      this.blockUnassignedTask(card, note)
      return false
    }
    try {
      let latest = this.store.read.getTaskCard(card.id)
      if (!latest) return false
      if (latest.assigneeAgentId !== decision.toAgentId) {
        latest = this.services.tasks.update(
          { taskId: latest.id, expectedVersion: latest.version, assigneeAgentId: decision.toAgentId },
          SYSTEM_ACTOR,
        )
      }
      if (latest.status === 'review') {
        latest = this.services.tasks.move(
          { taskId: latest.id, expectedVersion: latest.version, to: 'blocked', note: '交接重新分配，等待调度器接手' },
          SYSTEM_ACTOR,
        )
      }
      if (latest.status !== 'ready') {
        this.services.tasks.move(
          { taskId: latest.id, expectedVersion: latest.version, to: 'ready', note: '交接重新分配，由调度器启动替代 Agent' },
          SYSTEM_ACTOR,
        )
      }
      const target = this.store.read.getAgent(decision.toAgentId)
      if (handoff.toSessionId) {
        this.store.appendMessage({
          sessionId: handoff.toSessionId,
          role: 'system',
          content: `交接接收方 ${handoff.toAgentName} 启动失败（${error}），已重新分配给 ${target?.name ?? decision.toAgentId}，由调度器启动。`,
          metadata: { kind: 'handoff-reassigned', handoffId: handoff.id, toAgentId: decision.toAgentId },
        })
      }
      this.logger.info(
        { handoffId: handoff.id, taskId: card.id, from: handoff.toAgentId, to: decision.toAgentId },
        'handoff reassigned to a safe substitute',
      )
      return true
    } catch (reassignError) {
      this.logger.warn({ err: reassignError, handoffId: handoff.id }, 'failed to apply handoff reassignment')
      this.blockUnassignedTask(card, `交接替代失败：${reassignError instanceof Error ? reassignError.message : String(reassignError)}`)
      return false
    }
  }

  /**
   * Explicit human confirmation for a pending replacement proposal. The Task is
   * only re-queued; the scheduler still owns starting the Run.
   */
  confirmReassignment(planId: string, taskId: string, agentId: string): { taskId: string; agentId: string } {
    const plan = this.getPlan(planId)
    const pausedForConfirmation = plan.execution?.status === 'paused'
    if (plan.execution?.status !== 'running' && !pausedForConfirmation) {
      throw new AppError('CONFLICT', '计划不在执行中')
    }
    if (!plan.createdTaskIds.includes(taskId)) throw new AppError('NOT_FOUND', '任务不在该计划中')
    const handoff = this.store.read
      .listHandoffViews(plan.projectId)
      .find((item) => item.status === 'accepted' && item.taskId === taskId)
    if (!handoff) throw new AppError('NOT_FOUND', '该任务没有可确认的交接')
    const payload = this.handoffPayload(handoff)
    const reassignment = (payload.reassignment ?? {}) as Record<string, unknown>
    if (reassignment.status !== 'needs_confirmation') {
      throw new AppError('CONFLICT', '该交接没有待确认的替代方案')
    }
    const candidates = Array.isArray(reassignment.candidates)
      ? (reassignment.candidates as Array<{ agentId: string }>)
      : []
    if (!candidates.some((candidate) => candidate.agentId === agentId)) {
      throw new AppError('BAD_REQUEST', '只能从已计算的合法候选中选择替代 Agent')
    }
    const card = this.store.read.getTaskCard(taskId)
    if (!card) throw new AppError('NOT_FOUND', '任务不存在')
    const activeLease = this.store.read.getTaskLease(taskId)
    if (this.store.read.getActiveRunForTask(taskId) || (activeLease && activeLease.expiresAt > now())) {
      throw new AppError('CONFLICT', '任务仍有运行或租约，不能换人')
    }
    let latest = card
    if (latest.assigneeAgentId !== agentId) {
      latest = this.services.tasks.update(
        { taskId, expectedVersion: latest.version, assigneeAgentId: agentId },
        SYSTEM_ACTOR,
      )
      // The user explicitly confirmed this substitute. Extend the scoped plan
      // grant by exactly this Agent; automatic reassignment never calls this.
      this.onAgentReassigned?.(planId, taskId, agentId)
    }
    if (latest.status === 'review') {
      latest = this.services.tasks.move(
        { taskId, expectedVersion: latest.version, to: 'blocked', note: '已确认替代 Agent' },
        SYSTEM_ACTOR,
      )
    }
    if (latest.status !== 'ready') {
      this.services.tasks.move(
        { taskId, expectedVersion: latest.version, to: 'ready', note: '已确认替代 Agent，等待调度器启动' },
        SYSTEM_ACTOR,
      )
    }
    this.store.updateHandoffPayload(handoff.id, {
      reassignment: {
        ...reassignment,
        status: 'confirmed',
        toAgentId: agentId,
        confirmedAt: now(),
        confirmedBy: 'user',
      },
    })
    this.store.appendEvent(plan.projectId, handoff.id, PROJECT_EVENT_TYPES.handoffReassignmentProposed, {
      taskId,
      status: 'confirmed',
      toAgentId: agentId,
      actorName: '用户',
    })
    if (pausedForConfirmation) {
      const current = this.getPlan(planId)
      if (current.execution?.status === 'paused') {
        this.saveExecution(current, {
          ...current.execution,
          status: 'running',
          error: null,
          updatedAt: now(),
        })
        this.arm(planId)
        void this.tick(planId)
      }
    }
    return { taskId, agentId }
  }

  /**
   * Explicit human cancellation of a pending replacement proposal. The Task
   * stays blocked and the Plan stays paused with a clear reason so the user can
   * revise the plan instead of getting a fake success or a silent Agent swap.
   */
  declineReassignment(planId: string, taskId: string, note = ''): { taskId: string; status: 'declined' } {
    const plan = this.getPlan(planId)
    if (!plan.createdTaskIds.includes(taskId)) throw new AppError('NOT_FOUND', '任务不在该计划中')
    const handoff = this.store.read
      .listHandoffViews(plan.projectId)
      .find((item) => item.status === 'accepted' && item.taskId === taskId)
    if (!handoff) throw new AppError('NOT_FOUND', '该任务没有可取消的交接替代方案')
    const payload = this.handoffPayload(handoff)
    const reassignment = (payload.reassignment ?? {}) as Record<string, unknown>
    if (reassignment.status !== 'needs_confirmation') {
      throw new AppError('CONFLICT', '该交接没有待确认的替代方案')
    }
    const card = this.store.read.getTaskCard(taskId)
    if (!card) throw new AppError('NOT_FOUND', '任务不存在')
    const activeLease = this.store.read.getTaskLease(taskId)
    if (this.store.read.getActiveRunForTask(taskId) || (activeLease && activeLease.expiresAt > now())) {
      throw new AppError('CONFLICT', '任务仍有运行或租约，不能取消替代方案')
    }
    this.store.updateHandoffPayload(handoff.id, {
      reassignment: {
        ...reassignment,
        status: 'declined',
        declinedAt: now(),
        declinedBy: 'user',
        note: note.slice(0, 2000),
      },
    })
    this.blockUnassignedTask(card, '用户取消了交接替代方案；请修订计划或手动处理该任务')
    const current = this.getPlan(planId)
    if (current.execution?.status === 'paused') {
      this.saveExecution(current, {
        ...current.execution,
        error: `已取消替代方案：任务「${card.title}」保持阻塞，请修订计划或手动处理`,
        updatedAt: now(),
      })
    }
    this.store.appendEvent(plan.projectId, handoff.id, PROJECT_EVENT_TYPES.handoffReassignmentProposed, {
      taskId,
      status: 'declined',
      actorName: '用户',
      note,
    })
    return { taskId, status: 'declined' }
  }

  private async enforcePlanDeadline(plan: PlanDraft): Promise<void> {
    const execution = plan.execution!
    const minutes = Math.round((execution.maxWallClockMs || 0) / 60_000)
    const message = `计划总执行时间超出上限（${minutes} 分钟），已停止全部运行`
    for (const taskId of plan.createdTaskIds) {
      const active = this.store.read.getActiveRunForTask(taskId)
      if (!active) continue
      try {
        await this.runner.terminateRun(active.id, 'timed_out', 'plan_wall_clock_timeout', message)
      } catch (error) {
        this.logger.warn({ err: error, runId: active.id }, 'failed to terminate run after plan deadline')
      }
    }
    this.saveExecution(plan, {
      ...execution,
      status: 'failed',
      error: message,
      budgetExhausted: 'plan_wall_clock',
      updatedAt: now(),
    })
    this.store.appendEvent(plan.projectId, plan.id, PROJECT_EVENT_TYPES.planStatusChanged, {
      planId: plan.id,
      status: 'failed',
      reason: 'plan_wall_clock',
      error: message,
    })
    this.disarm(plan.id)
  }

  private blockUnassignedTask(card: TaskCard, note: string): void {    try {
      const latest = this.store.read.getTaskCard(card.id)
      if (!latest || ['done', 'cancelled', 'blocked'].includes(latest.status)) return
      this.services.tasks.move(
        { taskId: card.id, expectedVersion: latest.version, to: 'blocked', note },
        SYSTEM_ACTOR,
      )
    } catch (error) {
      this.logger.warn({ err: error, taskId: card.id }, 'failed to block task after start failure')
    }
  }

  /** Single-flight per plan: a start racing a restart must not run `git worktree add` twice. */
  private async ensureWorkspace(plan: PlanDraft): Promise<string> {
    const running = this.workspaceInflight.get(plan.id)
    if (running) return running
    const task = this.ensureWorkspaceInner(plan).finally(() => this.workspaceInflight.delete(plan.id))
    this.workspaceInflight.set(plan.id, task)
    return task
  }

  private async ensureWorkspaceInner(plan: PlanDraft): Promise<string> {
    const project = this.store.read.getProject(plan.projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    if (plan.execution?.workspaceRef && existsSync(plan.execution.workspaceRef)) {
      return plan.execution.workspaceRef
    }
    const worktreePath = join(this.dataDir, 'worktrees', plan.projectId, plan.id)
    const branch = `projectos/plan-${plan.id}`
    try {
      const ref = await this.worktrees.create(project.rootPath, worktreePath, branch)
      const current = plan.execution ?? execution('running', 2)
      this.saveExecution(plan, {
        ...current,
        workspaceRef: ref.path,
        branch: ref.branch,
        updatedAt: now(),
      })
      return ref.path
    } catch (error) {
      // A Git project must never fall back to writing the main workspace; only non-Git V1.3 plans may.
      if (plan.execution?.requireWorktree || existsSync(join(project.rootPath, '.git'))) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new AppError('CONFLICT', `无法创建隔离 Worktree，已停止执行：${reason}`)
      }
      this.logger.warn({ err: error, planId: plan.id }, 'non-git project; using project root')
      return project.rootPath
    }
  }

  /**
   * Real, recorded check failures across the plan's runs. Only calls that actually
   * executed and reported an exit code count; a later passing run of the same command
   * supersedes the older failure so a genuine fix clears the signal.
   */
  private failingVerifications(plan: PlanDraft): Array<{ command: string; exitCode: number }> {
    const latest = new Map<string, { command: string; exitCode: number; at: number }>()
    const runs = this.store.db
      .prepare("SELECT id, created_at FROM agent_runs WHERE task_id IN (SELECT value FROM json_each(?)) ORDER BY created_at ASC")
      .all(JSON.stringify(plan.createdTaskIds)) as Array<{ id: string; created_at: number }>
    for (const runRow of runs) {
      for (const call of this.store.read.getToolCalls(runRow.id)) {
        if (call.status !== 'completed') continue
        if (call.toolName !== 'run_tests' && call.toolName !== 'run_command') continue
        const cmdText = typeof call.args?.command === 'string' ? call.args.command.trim() : ''
        // Only real verification commands can fail verification. A read-only helper such
        // as `git diff --no-index` exits 1 when files differ; that is information, not a
        // failing check, and must never pause a plan.
        const isVerification =
          call.toolName === 'run_tests' ||
          /^(npm|pnpm|yarn)\s+(run\s+)?test\b/i.test(cmdText) ||
          /^(npx\s+)?(vitest|jest|mocha)\b/i.test(cmdText) ||
          /^node\s+--test\b/i.test(cmdText) ||
          /^(npm|pnpm|yarn)\s+run\s+(build|typecheck|lint)\b/i.test(cmdText) ||
          /^(npx\s+)?tsc\b/i.test(cmdText)
        if (!isVerification) continue
        const result = (call.result ?? {}) as Record<string, unknown>
        const exitCode = typeof result.exitCode === 'number' ? result.exitCode : typeof result.code === 'number' ? result.code : null
        if (exitCode === null) continue
        const command = typeof call.args?.command === 'string' ? call.args.command : call.toolName
        latest.set(command, { command, exitCode, at: call.startedAt ?? call.finishedAt ?? 0 })
      }
    }
    return [...latest.values()].filter((item) => item.exitCode !== 0).map(({ command, exitCode }) => ({ command, exitCode }))
  }

  /**
   * Review evidence that is valid but NOT approving (需要修改 / 阻断交付). A negative
   * review legally completes the review task, but it must never let the plan claim
   * success: it is a verification failure that goes back to the Replanner.
   */
  private negativeReviews(plan: PlanDraft): Array<{ title: string; conclusion: string }> {
    const reviews: Array<{ title: string; metadata: Record<string, unknown>; revision: string; conclusion: string }> = []
    for (const taskId of plan.createdTaskIds) {
      for (const artifact of this.store.read.listArtifacts(plan.projectId, taskId)) {
        const metadata = (artifact.metadata ?? {}) as Record<string, unknown>
        if (metadata.artifactType !== 'review') continue
        reviews.push({
          title: artifact.title,
          metadata,
          revision: typeof metadata.reviewedRevision === 'string' ? metadata.reviewedRevision : '',
          conclusion: typeof metadata.conclusion === 'string' ? metadata.conclusion.trim() : '',
        })
      }
    }
    if (reviews.length === 0) return []

    // ADR-0024 supersession: a re-review of the *current* revision supersedes older
    // verdicts for the same plan (history is kept, it just stops being decisive). Every
    // review that belongs to the current revision still has to pass.
    const currentRevision = this.workspaceRevision(plan)
    const atCurrent = reviews.filter((item) => !item.revision || !currentRevision || item.revision === currentRevision)
    const decisive = atCurrent.length > 0 ? atCurrent : reviews
    const rejected: Array<{ title: string; conclusion: string }> = []
    for (const item of decisive) {
      const verdict = reviewVerdictOf(item.metadata, { currentRevision })
      if (verdict !== 'approved') {
        rejected.push({ title: item.title, conclusion: `${item.conclusion || '未给出结论'}（${verdict}）` })
      }
    }
    return rejected
  }

  /** HEAD of the plan's workspace, when it can be read. */
  private workspaceRevision(plan: PlanDraft): string | null {
    const root = plan.execution?.workspaceRef
    if (!root) return null
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() || null
    } catch {
      return null
    }
  }

  private async tick(planId: string): Promise<void> {
    if (this.ticking.has(planId)) return
    this.ticking.add(planId)
    try {
      let plan = this.getPlan(planId)
      if (plan.execution?.status !== 'running') {
        this.disarm(planId)
        return
      }
      // A revoked/expired/revision-mismatched grant must stop new Task/Run starts.
      if (this.planGrantGuard) {
        try {
          this.planGrantGuard(plan)
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          this.saveExecution(plan, { ...plan.execution, status: 'paused', error: reason, updatedAt: now() })
          this.disarm(planId)
          this.store.appendEvent(plan.projectId, plan.id, PROJECT_EVENT_TYPES.planGrantInvalidated, {
            planId: plan.id,
            revision: plan.revision,
            reason,
          })
          if (/Agent|Runtime|不可用|没有分配/i.test(reason)) {
            this.notifyReplan(plan, 'agent_unavailable', reason)
          }
          this.logger.warn({ planId, reason }, 'plan execution grant no longer valid; paused')
          return
        }
      }
      // Hard Plan wall-clock budget: checked before any new task or tool can start.
      if (plan.execution.deadlineAt > 0 && now() >= plan.execution.deadlineAt) {
        await this.enforcePlanDeadline(plan)
        return
      }
      const cards = plan.createdTaskIds
        .map((taskId) => this.store.read.getTaskCard(taskId))
        .filter((card): card is TaskCard => Boolean(card))
      if (cards.length === 0) throw new AppError('CONFLICT', '计划任务不存在')
      const workspaceRoot = await this.ensureWorkspace(plan)

      // Accepted handoffs are prepared here, but the normal ready/start flow
      // below is the only place that starts the receiver's Run.
      await this.applyAcceptedHandoffs(plan)
      const refreshedCards = plan.createdTaskIds
        .map((taskId) => this.store.read.getTaskCard(taskId))
        .filter((card): card is TaskCard => Boolean(card))

      for (const card of refreshedCards) {
        const latest = this.store.read.getLatestRunForTask(card.id)
        if (latest?.status === 'needs_reconciliation') {
          // Side effects are unknown: never replay automatically, wait for a human to reconcile the run.
          this.saveExecution(plan, {
            ...plan.execution!,
            status: 'paused',
            error: `运行 ${latest.id} 待人工核对，核对后再继续`,
            updatedAt: now(),
          })
          this.disarm(planId)
          return
        }
        // Only the automatic path (task parked in `blocked` by the failed Run)
        // consumes the retry budget. A manual reconcile leaves the task `ready`
        // on purpose and must be allowed to start a new Run.
        if (latest?.status === 'failed' && card.status === 'blocked') {
          const retries = plan.execution?.retries ?? {}
          const used = retries[card.id] ?? 0
          const nextAt = plan.execution?.nextAttemptAt[card.id] ?? 0
          const scheduledFor = plan.execution?.retryForRun[card.id]
          if (scheduledFor === latest.id) {
            if (nextAt > now()) continue
            // Backoff elapsed: task promotion below starts the next attempt.
          } else {
            if (used >= (plan.execution?.maxRetries ?? 2)) {
              const next = { ...plan.execution!, status: 'failed' as const, error: latest.error ?? '任务执行失败（重试已用尽）', updatedAt: now() }
              this.saveExecution(plan, next)
              this.notifyReplan(plan, 'retry_exhausted', next.error ?? '任务执行失败（重试已用尽）')
              this.disarm(planId)
              return
            }
            const delay = Math.min(30_000, 2_000 * 2 ** used)
            plan = this.saveExecution(plan, {
              ...plan.execution!,
              retries: { ...retries, [card.id]: used + 1 },
              nextAttemptAt: { ...(plan.execution?.nextAttemptAt ?? {}), [card.id]: now() + delay },
              retryForRun: { ...(plan.execution?.retryForRun ?? {}), [card.id]: latest.id },
              error: `任务失败，${Math.round(delay / 1000)}s 后重试（${used + 1}/${plan.execution?.maxRetries ?? 2}）`,
              updatedAt: now(),
            })
            continue
          }
        }
      }

      let changed = false
      // Re-read review cards: handoff preparation and retries may have changed
      // task versions/status since the tick started.
      const reviewCards = plan.createdTaskIds
        .map((taskId) => this.store.read.getTaskCard(taskId))
        .filter((card): card is TaskCard => Boolean(card))
      for (const card of reviewCards) {
        if (card.status !== 'review') continue
        const role = card.labels.find((label) => ['architect', 'developer', 'reviewer', 'tester'].includes(label))
        let report = this.qualityReports.get(card.id)
        if (role === 'developer' || role === 'tester') {
          if (!report) {
            const policy = this.store.read.getQualityPolicy(plan.projectId) ?? DEFAULT_QUALITY_POLICY
            report = await this.qualityGate.run(workspaceRoot, { policy })
            this.qualityReports.set(card.id, report)
            this.store.createArtifact(
              createArtifactRecord({
                projectId: plan.projectId,
                taskId: card.id,
                kind: 'test-report',
                title: `质量门禁 · ${card.title}`,
                body: [
                  `结果：${report.outcome}${report.skipped ? '（必需检查未执行）' : ''}`,
                  `必需：${report.required.join(', ') || '无'}；可选：${report.optional.join(', ') || '无'}`,
                  ...(report.missingRequired.length ? [`缺失必需检查：${report.missingRequired.join(', ')}`] : []),
                  ...report.checks.map(
                    (check) =>
                      `## ${check.name} · ${check.status} · exit ${check.exitCode ?? '—'}\n$ ${check.command}\n${check.output.slice(-6000)}`,
                  ),
                ].join('\n\n'),
                verified: report.outcome === 'passed',
              }),
            )
          }
          if (report.outcome === 'failed' || report.outcome === 'error') {
            try {
              this.services.tasks.move(
                { taskId: card.id, expectedVersion: card.version, to: 'blocked', note: '质量门禁未通过' },
                SYSTEM_ACTOR,
              )
            } catch (error) {
              this.logger.warn({ err: error, taskId: card.id }, 'failed to block task after quality gate')
            }
            const qualityError = `质量门禁未通过：${report.checks.filter((check) => check.status === 'failed' || check.status === 'error').map((check) => check.name).join(', ')}`
            this.saveExecution(plan, {
              ...plan.execution!,
              status: 'failed',
              error: qualityError,
              updatedAt: now(),
            })
            this.notifyReplan(plan, 'quality_gate_failed', qualityError)
            this.disarm(planId)
            return
          }
          if (report.outcome === 'skipped') {
            // No configured checks is not a pass; evidence may still come from a
            // real agent-run test report/run_tests, otherwise the task stays in review.
            this.qualityReports.delete(card.id)
          }
        }

        const artifacts = this.store.read.listArtifacts(plan.projectId, card.id)
        const runDetails = this.store.read
          .listRunSummaries(plan.projectId, 200)
          .filter((run) => run.taskId === card.id)
          .slice(0, 5)
          .map((run) => this.store.read.getRunDetail(run.id))
          .filter((detail): detail is NonNullable<typeof detail> => Boolean(detail))
        const git = await getGitStatus(workspaceRoot).catch(() => null)
        const decision = evaluateCompletion({
          task: card,
          artifacts,
          runs: runDetails,
          qualityGate: report
            ? {
                outcome: report.outcome,
                passed: report.passed,
                skipped: report.skipped,
                checks: report.checks.map((check) => ({
                  name: check.name,
                  status: check.status,
                  exitCode: check.exitCode,
                })),
              }
            : null,
          workspaceRoot,
          fileExists: (relativePath) => existsSync(join(workspaceRoot, relativePath)),
          changedFiles: git?.changes.map((change) => change.path) ?? [],
          actorKind: 'system',
        })
        if (!decision.ok) {
          const missing = decision.requirements
            .filter((item) => !item.satisfied)
            .map((item) => `${item.label}：${item.missing.join('；')}`)
          const execution = plan.execution!
          const latestRun = runDetails[0]?.run ?? null
          const used = execution.evidenceRetries?.[card.id] ?? 0
          const max = execution.maxEvidenceRetries ?? 1
          const retryFor = execution.evidenceRetryForRun?.[card.id]
          if (
            latestRun?.status === 'completed' &&
            retryFor !== latestRun.id &&
            used < max &&
            card.assigneeAgentId
          ) {
            const assignee = this.store.read.getAgent(card.assigneeAgentId)
            const sessionTitle = planSessionTitle(assignee?.name ?? 'Agent', plan.revision)
            const session =
              this.store.read
                .listSessionSummaries(plan.projectId)
                .find((item) => item.agentId === card.assigneeAgentId && item.title === sessionTitle) ??
              this.services.sessions.create(
                { projectId: plan.projectId, agentId: card.assigneeAgentId, title: sessionTitle },
                SYSTEM_ACTOR,
              )
            try {
              const result = await this.runner.startRun({
                projectId: plan.projectId,
                sessionId: session.id,
                taskId: card.id,
                workspaceRoot,
                prompt: [
                  `补证任务：${card.title}`,
                  '上一次运行没有满足完成依据，不能直接标记完成。',
                  `缺失项：${missing.join('；') || decision.reasons.join('；')}`,
                  '请只补齐真实证据：创建结构化 Artifact、执行真实测试或提供实际文件；不得伪造，也不得仅用文本声明完成。',
                ].join('\n\n'),
              })
              this.saveExecution(plan, {
                ...execution,
                status: 'running',
                error: `任务「${card.title}」证据不足，已启动第 ${used + 1}/${max} 次补证`,
                runIds: [...new Set([...execution.runIds, result.runId])],
                evidenceRetries: { ...(execution.evidenceRetries ?? {}), [card.id]: used + 1 },
                evidenceRetryForRun: {
                  ...(execution.evidenceRetryForRun ?? {}),
                  [card.id]: latestRun.id,
                },
                updatedAt: now(),
              })
              changed = true
              continue
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              this.saveExecution(plan, {
                ...execution,
                status: 'paused',
                error: `任务「${card.title}」补证启动失败：${message}`,
                updatedAt: now(),
              })
              this.disarm(planId)
              return
            }
          }
          const evidenceError = `任务「${card.title}」缺少有效完成依据：${missing.join('；') || decision.reasons.join('；')}`
          this.saveExecution(plan, {
            ...plan.execution!,
            status: 'paused',
            error: evidenceError,
            updatedAt: now(),
          })
          this.notifyReplan(plan, 'evidence_exhausted', evidenceError)
          this.disarm(planId)
          return
        }
        try {
          this.services.tasks.complete(
            {
              taskId: card.id,
              expectedVersion: card.version,
              note: '编排器自动验收通过（完成依据已校验）',
              decision,
            },
            SYSTEM_ACTOR,
          )
          changed = true
        } catch (error) {
          this.logger.warn({ err: error, taskId: card.id }, 'failed to auto-complete reviewed task')
        }
      }

      plan = this.getPlan(planId)
      const refreshed = plan.createdTaskIds
        .map((taskId) => this.store.read.getTaskCard(taskId))
        .filter((card): card is TaskCard => Boolean(card))
      const hasActiveRun = plan.createdTaskIds.some((taskId) => Boolean(this.store.read.getActiveRunForTask(taskId)))
      const reconciling = plan.createdTaskIds
        .map((taskId) => this.store.read.getActiveRunForTask(taskId))
        .filter((run) => run?.status === 'needs_reconciliation')
      if (reconciling.length > 0) {
        this.saveExecution(plan, {
          ...plan.execution!,
          status: 'paused',
          error: `存在待人工核对的 Run（${reconciling.map((run) => run!.id).join('、')}），未知副作用不会自动重试`,
          updatedAt: now(),
        })
        this.disarm(planId)
        return
      }
      if (!hasActiveRun && refreshed.every((card) => card.status === 'done')) {
        // ADR-2.8.3: a diagnostic task may legally finish by *reporting* a real failure,
        // but that must never let the plan claim success. If any recorded check in this
        // plan exited non-zero and has not been superseded by a later passing run, the
        // plan is a verification failure: keep the failure evidence and ask the
        // Replanner for a legitimate fix instead of marking the plan completed.
        const failedChecks = this.failingVerifications(plan)
        const rejectedReviews = this.negativeReviews(plan)
        if (failedChecks.length > 0 || rejectedReviews.length > 0) {
          const reason = [
            ...(failedChecks.length > 0
              ? [`验证未通过：${failedChecks.map((item) => `${item.command.slice(0, 60)}（退出码 ${item.exitCode}）`).join('、')}`]
              : []),
            ...(rejectedReviews.length > 0
              ? [`审查未通过：${rejectedReviews.map((item) => `${item.title}（${item.conclusion.slice(0, 40)}）`).join('、')}`]
              : []),
          ].join('；')
          this.saveExecution(plan, { ...plan.execution!, status: 'paused', error: reason, updatedAt: now() })
          this.disarm(planId)
          this.notifyReplan(plan, 'evidence_exhausted', reason)
          this.store.appendEvent(plan.projectId, plan.id, PROJECT_EVENT_TYPES.planExecutionFailureClassified, {
            planId: plan.id,
            failureClass: 'verification_failed',
            reason,
          })
          return
        }
        let completedExecution: PlanExecution = { ...plan.execution!, status: 'completed', error: null, updatedAt: now() }
        if (completedExecution.branch && completedExecution.workspaceRef && !completedExecution.diffArtifactId) {
          try {
            const diff = await this.worktrees.diff(completedExecution.workspaceRef)
            const artifact = this.store.createArtifact(
              createArtifactRecord({
                projectId: plan.projectId,
                kind: 'diff',
                title: `编排 Diff · ${plan.goal.slice(0, 80)}`,
                body: diff,
                uri: completedExecution.branch,
              }),
            )
            completedExecution = { ...completedExecution, diffArtifactId: artifact.id }
          } catch (error) {
            this.logger.warn({ err: error, planId }, 'failed to create orchestration diff artifact')
          }
        }
        this.saveExecution(plan, completedExecution)
        this.disarm(planId)
        return
      }

      for (const card of refreshed) {
        const retryAt = plan.execution?.nextAttemptAt[card.id] ?? 0
        const latest = this.store.read.getLatestRunForTask(card.id)
        const retryReady =
          card.status === 'blocked' &&
          latest?.status === 'failed' &&
          retryAt > 0 &&
          now() >= retryAt
        if ((card.status !== 'backlog' && !retryReady) || card.blockedBy.length > 0) continue
        try {
          this.services.tasks.move(
            { taskId: card.id, expectedVersion: card.version, to: 'ready' },
            SYSTEM_ACTOR,
          )
          changed = true
        } catch (error) {
          this.logger.warn({ err: error, taskId: card.id }, 'failed to promote orchestrated task')
        }
      }

      plan = this.getPlan(planId)
      const currentExecution = plan.execution
      if (!currentExecution) throw new AppError('CONFLICT', '计划缺少执行状态')
      const activeAgentIds = new Set<string>()
      for (const card of refreshed) {
        if (card.status !== 'running') continue
        const activeRun = this.store.read.getActiveRunForTask(card.id)
        const agentId = activeRun?.agentId ?? card.assigneeAgentId
        if (agentId) activeAgentIds.add(agentId)
      }
      const ready = plan.createdTaskIds
        .map((taskId) => this.store.read.getTaskCard(taskId))
        .filter((card): card is TaskCard => Boolean(card))
        .filter((card) => card.status === 'ready' && !this.store.read.getActiveRunForTask(card.id))
        .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
      // Cross-plan/cross-project capacity: one active Run per Agent by default.
      // The DB query is the shared source of truth, so a second scheduler cannot
      // start the same Agent concurrently.
      for (const card of ready) {
        if (card.assigneeAgentId && this.store.read.countActiveRunsForAgent(card.assigneeAgentId) > 0) {
          activeAgentIds.add(card.assigneeAgentId)
        }
      }

      const active = plan.createdTaskIds
        .map((taskId) => this.store.read.getTaskCard(taskId))
        .filter((card): card is TaskCard => Boolean(card))
        .filter((card) => card.status === 'running').length
      const slots = Math.max(0, currentExecution.concurrency - active)
      const runIds = [...currentExecution.runIds]
      let executionError = currentExecution.error
      for (const card of ready) {
        if (card.assigneeAgentId) continue
        this.blockUnassignedTask(card, '计划任务没有 assigneeAgentId，无法自动启动')
        executionError = `任务「${card.title}」没有 assigneeAgentId`
        this.notifyReplan(plan, 'agent_unavailable', executionError)
        changed = true
      }
      // One run per Agent per tick. Ready tasks for an Agent that already has a
      // running task stay queued instead of colliding on the Agent's Session.
      const startable = selectStartableTasks({
        ready: ready.filter((card) => Boolean(card.assigneeAgentId)),
        activeAgentIds,
        slots,
      })
      for (const card of startable) {
        if (!card.assigneeAgentId) {
          this.blockUnassignedTask(card, '计划任务没有 assigneeAgentId，无法自动启动')
          executionError = `任务「${card.title}」没有 assigneeAgentId`
          this.notifyReplan(plan, 'agent_unavailable', executionError)
          changed = true
          continue
        }
        try {
          const assignee = this.store.read.getAgent(card.assigneeAgentId)
          const sessionTitle = planSessionTitle(assignee?.name ?? 'Agent', plan.revision)
          const session =
            this.store.read
              .listSessionSummaries(plan.projectId)
              .find((item) => item.agentId === card.assigneeAgentId && item.title === sessionTitle) ??
            this.services.sessions.create(
              {
                projectId: plan.projectId,
                agentId: card.assigneeAgentId,
                title: sessionTitle,
              },
              SYSTEM_ACTOR,
            )
          const result = await this.runner.startRun({
            projectId: plan.projectId,
            sessionId: session.id,
            taskId: card.id,
            workspaceRoot,
            prompt: [
              `执行计划任务：${card.title}`,
              card.description || '',
              card.acceptanceCriteria.length ? `验收标准：\n- ${card.acceptanceCriteria.join('\n- ')}` : '',
              '请使用工具完成实际工作并创建必要的交付物。完成后如任务仍未进入 review，请调用 update_task_status 将其标记为完成；编排器会进行自动验收。',
            ]
              .filter(Boolean)
              .join('\n\n'),
          })
          runIds.push(result.runId)
          const handoff = this.store.read
            .listHandoffViews(plan.projectId)
            .find((item) => item.status === 'accepted' && item.taskId === card.id && !this.handoffPayload(item).continuedAt)
          if (handoff) {
            const payload = this.handoffPayload(handoff)
            this.store.updateHandoffPayload(handoff.id, {
              schedulerPreparedAt: payload.schedulerPreparedAt ?? now(),
              continuedAt: now(),
              targetRunId: result.runId,
            })
          }
          changed = true
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (/执行容量已满/.test(message)) {
            // Another plan/process owns this Agent's global slot. Keep the task
            // ready and let a later tick retry; never fail the plan or block it.
            this.logger.info({ taskId: card.id, agentId: card.assigneeAgentId }, 'agent capacity busy; task queued')
            continue
          }
          this.logger.warn({ err: error, taskId: card.id, agentId: card.assigneeAgentId }, 'orchestrated run failed to start')
          const handoff = this.store.read
            .listHandoffViews(plan.projectId)
            .find((item) => item.status === 'accepted' && item.taskId === card.id && !this.handoffPayload(item).continuedAt)
          if (handoff) {
            this.store.updateHandoffPayload(handoff.id, {
              schedulerPreparedAt: this.handoffPayload(handoff).schedulerPreparedAt ?? now(),
              continuationError: message,
            })
          }
          const activeRun = this.store.read.getActiveRunForTask(card.id)
          if (activeRun) {
            try {
              await this.runner.cancel(activeRun.id)
            } catch (cancelError) {
              this.logger.warn({ err: cancelError, runId: activeRun.id }, 'failed to cancel partially started run')
            }
          }
          if (handoff) {
            // Safe substitution: low-risk + no permission expansion may re-queue
            // automatically; everything else is persisted as a proposal that a
            // human must confirm. Starting still belongs to this scheduler.
            const requeued = await this.handleReceiverStartFailure(plan, card, handoff, message)
            if (!requeued) executionError = `任务「${card.title}」接收方启动失败：${message}`
          } else {
            this.blockUnassignedTask(card, `启动失败：${message}`)
            executionError = `任务「${card.title}」启动失败：${message}`
          }
          changed = true
          continue
        }
      }

      const latestPlanForSave = this.getPlan(planId)
      const latestExecutionForSave = latestPlanForSave.execution
      if (
        latestExecutionForSave &&
        latestExecutionForSave.status === 'running' &&
        (changed || runIds.length !== currentExecution.runIds.length || executionError !== currentExecution.error)
      ) {
        this.saveExecution(latestPlanForSave, {
          ...latestExecutionForSave,
          status: 'running',
          error: executionError ?? latestExecutionForSave.error,
          runIds: [...new Set([...latestExecutionForSave.runIds, ...runIds])],
          updatedAt: now(),
        })
      }

      // If nothing can make progress and tasks remain, fail the plan explicitly
      // instead of spinning the timer forever or pretending the plan is healthy.
      const latestPlan = this.getPlan(planId)
      const latestExecution = latestPlan.execution
      if (!latestExecution || latestExecution.status !== 'running') return
      const remaining = latestPlan.createdTaskIds
        .map((taskId) => this.store.read.getTaskCard(taskId))
        .filter((card): card is TaskCard => Boolean(card))
      const hasRunning = remaining.some((card) => ['running', 'review'].includes(card.status))
      const hasReady = remaining.some((card) => card.status === 'ready')
      const hasPromotable = remaining.some((card) => card.status === 'backlog' && card.blockedBy.length === 0)
      // A failed task waiting for its backoff must not be mistaken for a dead plan.
      const hasPendingRetry = remaining.some((card) => {
        if (card.status !== 'blocked') return false
        const retryAt = latestExecution.nextAttemptAt?.[card.id] ?? 0
        const failedRunId = latestExecution.retryForRun?.[card.id]
        return Boolean(failedRunId) && retryAt > 0 && retryAt > now()
      })
      // A Handoff replacement proposal waiting for a human must pause the plan,
      // not fail it: the plan can continue as soon as the user confirms.
      const awaitingConfirmation = remaining.filter(
        (card) => card.status === 'blocked' && this.hasPendingReassignment(latestPlan.projectId, card.id),
      )
      if (!hasRunning && !hasReady && !hasPromotable && !hasPendingRetry && awaitingConfirmation.length > 0) {
        this.saveExecution(latestPlan, {
          ...latestExecution,
          status: 'paused',
          error: `任务「${awaitingConfirmation.map((card) => card.title).join('、')}」等待人工确认替代 Agent`,
          updatedAt: now(),
        })
        this.disarm(planId)
        return
      }
      if (!hasRunning && !hasReady && !hasPromotable && !hasPendingRetry) {
        const unresolved = remaining.filter((card) => !['done', 'cancelled'].includes(card.status))
        if (unresolved.length > 0) {
          const failureReason =
            latestExecution.error ??
            `没有可继续执行的任务：${unresolved.map((card) => `${card.title}（${card.status}）`).join('；')}`
          this.saveExecution(latestPlan, {
            ...latestExecution,
            status: 'failed',
            error: failureReason,
            updatedAt: now(),
          })
          this.notifyReplan(
            latestPlan,
            /Agent|Runtime|不可用|disabled/i.test(failureReason) ? 'agent_unavailable' : 'retry_exhausted',
            failureReason,
          )
          this.disarm(planId)
          return
        }
        if (remaining.some((card) => card.status === 'cancelled')) {
          this.saveExecution(latestPlan, {
            ...latestExecution,
            status: 'failed',
            error: '计划中有任务被取消，无法完成全部任务',
            updatedAt: now(),
          })
          this.disarm(planId)
          return
        }
      }
    } catch (error) {
      this.logger.error({ err: error, planId }, 'orchestration tick failed')
      try {
        const plan = this.getPlan(planId)
        if (plan.execution?.status === 'running') {
          this.saveExecution(plan, {
            ...plan.execution,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            updatedAt: now(),
          })
        }
      } catch {
        // plan may have been removed
      }
      this.disarm(planId)
    } finally {
      this.ticking.delete(planId)
    }
  }
}

