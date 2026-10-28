import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  AppError,
  TASK_STATUSES,
  type Agent,
  type AgentDefinition,
  type Approval,
  type Artifact,
  type Project,
  type Run,
  type RunSnapshot,
  type RunStatus,
  type RuntimeProfile,
  type Session,
  type Skill,
  type Task,
  type TaskStatus,
  type ToolCall,
  newId,
  now,
} from '@projectos/contracts'
import {
  PROJECT_EVENT_TYPES,
  assertRunTransition,
  isTerminalRunStatus,
} from '@projectos/domain'
import { evaluateCompletion, type CoreServices } from '@projectos/application'
import {
  repairToolCallTranscript,
  runAgentLoop,
  type AgentLoopResult,
  type ToolInvocation,
  type ToolOutcome,
} from '@projectos/agent-runtime'
import { buildContext } from '@projectos/context-engine'
import type { ChatMessage, LlmProvider, LlmToolDefinition, ToolCallRequest } from '@projectos/provider-interfaces'
import { formatSessionHistory } from '@projectos/session-manager'
import { selectSkills } from '@projectos/skills'
import {
  evaluateToolPolicy,
  redactObject,
  redactSecrets,
} from '@projectos/policy'
import { getToolDefinition, toolCatalogForAgent } from '@projectos/tools'
import { RuntimeExecutionService } from './runtime-executor.js'
import { collectUpstreamContext } from './upstream-context.js'
import { AcpClient, acpTextFromEvent, acpTextFromResult } from './acp-client.js'
import { assertApprovalSnapshotValid, persistWriteSnapshot, planWriteSnapshot } from './file-approval.js'
import {
  getGitDiff,
  getGitStatus,
  listProjectAgentsFile,
  readTextFile,
  readWorkspaceTree,
  runApprovedCommand,
  writeTextFile,
  diffFileFingerprints,
  snapshotFileFingerprints,
  type FileFingerprint,
} from '@projectos/workspace'
import { createArtifactRecord, type SqliteStore } from '@projectos/persistence'
import type { RuntimeConfig } from './config.js'
import { resolveLimits, type RuntimeLimits } from './limits.js'
import type { ProviderManager } from './provider-manager.js'
import type { RuntimeEventHub } from './events.js'
import type { Logger } from './logger.js'

export interface StartRunInput {
  projectId: string
  sessionId: string
  taskId?: string | null
  prompt: string
  actorName?: string
  messageId?: string
  inboxId?: string
  workspaceRoot?: string
  /** Group-chat: run this agent inside the shared session. */
  agentId?: string
  /** Replaces the visible user message only for this run's model context. */
  promptOverride?: string
}

export interface StartRunResult {
  runId: string
  messageId: string
}

interface PendingAcpPermission {
  resolve: (optionId: string | null) => void
  state: ActiveRun
  optionId: string | null
  toolCallId: string
}

interface PendingRuntimeApproval {
  resolve: (approved: boolean) => void
  state: ActiveRun
  toolCallId: string
}

interface ResolvedRunTarget {
  project: Project
  session: Session
  agent: Agent
  task: Task | null
  definition: AgentDefinition | null
  runtimeProfile: RuntimeProfile | null
  useRuntime: boolean
  routed: { connectionId: string; modelId: string | null } | null
  provider: LlmProvider | null
}

const RUNNER_ACTOR = { kind: 'system' as const, id: 'agent-runner', name: 'Agent Runner' }

interface ExecBudget {
  maxWallClockMs: number
  maxSteps: number
  maxToolCalls: number
  stepsUsed: number
  toolCallsUsed: number
  deadlineAt: number
}

interface ActiveRun {
  runId: string
  projectId: string
  sessionId: string
  agentId: string
  taskId: string | null
  workspaceRoot: string
  snapshot: RunSnapshot
  provider: LlmProvider | null
  connectionId: string | null
  modelId: string | null
  abort: AbortController
  lease: { token: number; expiresAt: number } | null
  slot: { token: number; expiresAt: number } | null
  budget: ExecBudget
  attemptNo: number
  inboxId: string | null
  promptMessageId: string
  promptOverride?: string | null
  busy: boolean
  checkpointSeq: number
  inputTokens: number
  outputTokens: number
  lastAssistantText: string
  textStepId: string | null
  textBuffer: string
  lastTextFlushAt: number
  pendingApprovalId: string | null
  leaseTimer: NodeJS.Timeout | null
  deadlineTimer: NodeJS.Timeout | null
  startedAt: number
  runtimeCancel: (() => void) | null
}

/** setTimeout overflows above 2^31-1 ms; clamp the deadline timer. */
const MAX_TIMER_MS = 2_147_483_647

export function assertCoordinatedTaskScope(input: {
  action: 'update' | 'handoff'
  projectId: string
  agentId: string
  runTaskId: string | null
  target: { id: string; projectId: string; assigneeAgentId: string | null }
}): void {
  // Phase 0: coordination tools must not mutate a task from another project
  // or another plan. A run bound to a task may only act on that task; a
  // project-level run may only update tasks assigned to its own Agent.
  if (input.target.projectId !== input.projectId) {
    throw new AppError('POLICY_DENIED', '协调工具不能操作其他项目的任务')
  }
  if (input.runTaskId) {
    if (input.target.id !== input.runTaskId) {
      throw new AppError('POLICY_DENIED', '协调工具只能操作当前计划/当前运行绑定的任务')
    }
    return
  }
  if (input.action === 'handoff') {
    throw new AppError('POLICY_DENIED', '没有运行绑定任务时不能发起交接')
  }
  if (input.target.assigneeAgentId && input.target.assigneeAgentId !== input.agentId) {
    throw new AppError('POLICY_DENIED', '协调工具只能更新分配给当前 Agent 的任务')
  }
}

export class AgentRunner {
  private readonly active = new Map<string, ActiveRun>()
  private readonly runtimeExecutor: RuntimeExecutionService
  private readonly sessionIndex = new Map<string, string>()
  private readonly activeConnections = new Map<string, number>()
  private readonly pendingPermissions = new Map<string, PendingAcpPermission>()
  private readonly pendingRuntimeApprovals = new Map<string, PendingRuntimeApproval>()
  private limits: RuntimeLimits
  private aiConnections: import('./ai-connections.js').AIConnectionService | null = null
  private planGrants: import('./plan-grant.js').PlanGrantService | null = null

  constructor(
    private readonly config: RuntimeConfig,
    private readonly store: SqliteStore,
    private readonly services: CoreServices,
    private readonly provider: ProviderManager,
    private readonly hub: RuntimeEventHub,
    private readonly logger: Logger,
  ) {
    this.runtimeExecutor = new RuntimeExecutionService(store, () => provider.rawConfig())
    this.limits = resolveLimits(config.limits)
  }

  /** Effective hard limits, exposed for diagnostics and tests. */
  getLimits(): RuntimeLimits {
    return { ...this.limits }
  }

  /**
   * Apply settings to new Runs/Plans. Existing Runs keep their persisted budget
   * snapshots and are never retroactively widened.
   */
  setLimits(partial: Partial<RuntimeLimits>): void {
    this.limits = resolveLimits({ ...this.limits, ...partial })
  }

  setAIConnections(service: import('./ai-connections.js').AIConnectionService): void {
    this.aiConnections = service
  }

  setPlanGrants(service: import('./plan-grant.js').PlanGrantService): void {
    this.planGrants = service
  }

  isSessionBusy(sessionId: string): boolean {
    return this.sessionIndex.has(sessionId)
  }

  activeRunId(sessionId: string): string | null {
    return this.sessionIndex.get(sessionId) ?? null
  }

  /** Preflight used before persisting a user message or creating a Run. */
  assertRunnable(input: {
    projectId: string
    sessionId: string
    taskId?: string | null
    agentId?: string
  }): void {
    this.resolveRunTarget(input)
  }

  private resolveRunTarget(input: {
    projectId: string
    sessionId: string
    taskId?: string | null
    agentId?: string
  }): ResolvedRunTarget {
    const project = this.store.read.getProject(input.projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    const session = this.store.read.getSession(input.sessionId)
    if (!session || session.projectId !== project.id) throw new AppError('NOT_FOUND', '会话不存在')
    if (session.status === 'archived') throw new AppError('CONFLICT', '会话已归档')
    if (this.sessionIndex.has(session.id) || this.store.read.getActiveRunForSession(session.id)) {
      throw new AppError('CONFLICT', '该会话已有运行中的 Agent，请等待完成或取消')
    }
    const agent = this.store.read.getAgent(input.agentId ?? session.agentId)
    if (!agent) throw new AppError('NOT_FOUND', 'Agent 不存在')

    let task: Task | null = null
    if (input.taskId) {
      task = this.store.read.getTask(input.taskId)
      if (!task || task.projectId !== project.id) throw new AppError('NOT_FOUND', '任务不存在')
      if (task.status === 'done' || task.status === 'cancelled') {
        throw new AppError('CONFLICT', '已完成或已取消的任务不能重新启动 Agent 运行')
      }
      const activeTaskRun = this.store.read.getActiveRunForTask(task.id)
      if (activeTaskRun) {
        throw new AppError('CONFLICT', '该任务已有运行中的 Agent，请等待完成或取消')
      }
      if (task.status === 'running') {
        throw new AppError('CONFLICT', '任务已经在运行，请先核对运行状态')
      }
      const card = this.store.read.getTaskCard(task.id)
      if (!card) throw new AppError('NOT_FOUND', '任务不存在')
      if (card.blockedBy.length > 0) {
        throw new AppError('CONFLICT', '存在未完成的依赖任务，无法启动 Agent 运行')
      }
    }

    const definition = this.store.read.getAgentDefinition(agent.id)
    if (definition && definition.status !== 'active') {
      throw new AppError('CONFLICT', `Agent 当前状态为 ${definition.status}，不能启动新的运行`)
    }
    const knownSkills = new Set(this.store.read.listSkills().map((skill) => skill.id))
    const missingSkills = (definition?.skills ?? [])
      .filter((binding) => binding.enabled && !knownSkills.has(binding.skillId))
      .map((binding) => binding.skillId)
    if (missingSkills.length > 0) {
      throw new AppError('CONFLICT', `Agent 绑定的 Skill 不存在：${missingSkills.join(', ')}`)
    }

    const profiles = this.store.read.listRuntimeProfiles()
    const profileId = definition
      ? definition.primaryRuntimeProfileId ?? definition.runtimeProfileIds[0] ?? null
      : null
    const runtimeProfile = profileId ? profiles.find((profile) => profile.id === profileId) ?? null : null
    if (definition && profileId && !runtimeProfile) {
      throw new AppError('CONFLICT', `Agent 绑定的 Runtime 不存在：${profileId}`)
    }
    const useRuntime = Boolean(runtimeProfile && runtimeProfile.protocol !== 'native')
    if (useRuntime && runtimeProfile!.status !== 'available') {
      throw new AppError(
        'CONFLICT',
        `Agent 绑定的 Runtime「${runtimeProfile!.name}」当前不可用（${runtimeProfile!.status}），请先检测/认证或改绑可用 Runtime`,
      )
    }

    const routed = useRuntime
      ? null
      : this.aiConnections?.resolveForRun(
          {
            projectId: project.id,
            agentId: agent.id,
            agentRole: agent.role,
            taskId: task?.id ?? null,
            modelRef: definition?.modelRef ?? null,
          },
          Object.fromEntries(this.activeConnections),
        ) ?? null
    const provider = useRuntime ? null : this.provider.createProvider(routed?.connectionId, routed?.modelId)
    return { project, session, agent, task, definition, runtimeProfile, useRuntime, routed, provider }
  }

  async startRun(input: StartRunInput): Promise<StartRunResult> {
    const target = this.resolveRunTarget(input)
    const { project, session, agent, task, definition, runtimeProfile, useRuntime, provider, routed } = target
    if (!input.messageId) {
      const message = this.store.appendMessage({
        sessionId: session.id,
        role: 'user',
        content: input.prompt,
        metadata: task ? { taskId: task.id } : {},
      })
      input.messageId = message.id
    }
    const promptMessage = this.store.getMessageById(input.messageId)
    if (!promptMessage) throw new AppError('NOT_FOUND', '触发消息不存在')
    const timestamp = now()
    const runId = newId('run')
    const attemptNo = task ? this.store.nextAttemptNo(task.id) : 1
    const deadlineAt = timestamp + this.limits.runWallClockMs
    const budget: ExecBudget = {
      maxWallClockMs: this.limits.runWallClockMs,
      maxSteps: this.limits.maxAgentSteps,
      maxToolCalls: this.limits.maxToolCalls,
      stepsUsed: 0,
      toolCallsUsed: 0,
      deadlineAt,
    }
    const snapshot = this.buildRunSnapshot({
      runId,
      agent,
      definition,
      runtimeProfile,
      task,
      routed,
      createdAt: timestamp,
    })
    let lease: { token: number; expiresAt: number } | null = null
    let slot: { token: number; expiresAt: number } | null = null
    try {
      // Global Agent capacity is acquired atomically before any Task lease,
      // Run, Attempt or Session state is created.
      slot = this.store.acquireAgentExecutionSlot(agent.id, runId, this.limits.agentSlotTtlMs)
      if (task) {
        // Acquire the lease before creating Run/Attempt or mutating the task. A failed
        // lease acquisition must leave no half-created execution state behind.
        lease = this.store.acquireTaskLease(task.id, `run:${runId}`, this.limits.taskLeaseTtlMs)
      }
    } catch (error) {
      if (slot) {
        try {
          this.store.releaseAgentExecutionSlot(agent.id, runId, slot.token)
        } catch {
          // ignore cleanup failure; slot expires
        }
      }
      throw error
    }
    let createdRun: Run | null = null
    try {
      this.store.transaction(() => {
        const run: Run = {
          id: runId,
          projectId: project.id,
          taskId: task?.id ?? null,
          sessionId: session.id,
          agentId: agent.id,
          attempt: attemptNo,
          status: 'running',
          error: null,
          summary: null,
          inputTokens: 0,
          outputTokens: 0,
          checkpointId: null,
          startedAt: timestamp,
          finishedAt: null,
          deadlineAt,
          budget: {
            maxWallClockMs: budget.maxWallClockMs,
            maxSteps: budget.maxSteps,
            maxToolCalls: budget.maxToolCalls,
            stepsUsed: 0,
            toolCallsUsed: 0,
          },
          createdAt: timestamp,
        }
        this.store.createRun(run)
        this.store.createRunSnapshot(snapshot)
        this.store.appendRunStep({
          runId,
          kind: 'status',
          title: '运行开始',
          payload: { status: 'running', sessionId: session.id, agentId: agent.id, taskId: task?.id ?? null },
        })
        this.store.appendRunStep({
          runId,
          kind: 'context',
          title: '上下文快照',
          payload: {
            promptMessageId: input.messageId,
            inboxId: input.inboxId ?? null,
            workspaceRoot: input.workspaceRoot ?? project.rootPath,
          },
        })
        if (task) {
          const handoff = this.store.read
            .listHandoffViews(project.id)
            .find((item) => item.taskId === task.id && item.status === 'accepted')
          if (handoff) {
            this.store.appendRunStep({
              runId,
              kind: 'context',
              title: '交接来源',
              payload: {
                handoffId: handoff.id,
                fromAgentName: handoff.fromAgentName,
                sourceRunId: handoff.sourceRunId,
                artifactRefs: handoff.artifactRefs.map((artifact) => artifact.id),
                upstreamRunIds: handoff.upstreamRunIds,
              },
            })
          }
          this.store.createAttempt({
            id: newId('att'),
            taskId: task.id,
            attemptNo,
            agentId: agent.id,
            runId,
            status: 'running',
          })
          let current = task
          if (current.assigneeAgentId !== agent.id) {
            current = this.store.updateTask(current.id, current.version, { assigneeAgentId: agent.id })
          }
          if (current.status === 'blocked' || current.status === 'backlog') {
            this.services.tasks.move(
              { taskId: current.id, expectedVersion: current.version, to: 'ready' },
              RUNNER_ACTOR,
            )
            current = this.store.read.getTask(current.id) ?? current
          }
          if (current.status !== 'running') {
            this.services.tasks.move(
              { taskId: current.id, expectedVersion: current.version, to: 'running' },
              RUNNER_ACTOR,
            )
          }
        }
        this.store.appendEvent(project.id, runId, PROJECT_EVENT_TYPES.runStarted, {
          title: task?.title ?? session.title,
          status: 'running',
          runId,
          sessionId: session.id,
          taskId: task?.id ?? null,
          actorName: agent.name,
        })
        createdRun = run
      })
    } catch (error) {
      if (lease && task) this.releaseRunLease(task.id, runId, lease)
      if (slot) {
        try {
          this.store.releaseAgentExecutionSlot(agent.id, runId, slot.token)
        } catch {
          // ignore; slot expires
        }
      }
      throw error
    }
    if (!createdRun) {
      if (lease && task) this.releaseRunLease(task.id, runId, lease)
      if (slot) {
        try {
          this.store.releaseAgentExecutionSlot(agent.id, runId, slot.token)
        } catch {
          // ignore; slot expires
        }
      }
      throw new AppError('INTERNAL', '运行创建失败')
    }
    const state: ActiveRun = {
      runId,
      projectId: project.id,
      sessionId: session.id,
      agentId: agent.id,
      taskId: task?.id ?? null,
      workspaceRoot: input.workspaceRoot ?? project.rootPath,
      snapshot,
      provider,
      connectionId: routed?.connectionId ?? null,
      modelId: routed?.modelId ?? null,
      abort: new AbortController(),
      lease,
      slot,
      budget,
      attemptNo,
      inboxId: input.inboxId ?? null,
      promptMessageId: promptMessage.id,
      promptOverride: input.promptOverride ?? null,
      busy: false,
      checkpointSeq: 0,
      inputTokens: 0,
      outputTokens: 0,
      lastAssistantText: '',
      textStepId: null,
      textBuffer: '',
      lastTextFlushAt: 0,
      pendingApprovalId: null,
      leaseTimer: null,
      deadlineTimer: null,
      startedAt: timestamp,
      runtimeCancel: null,
    }
    this.active.set(runId, state)
    this.sessionIndex.set(session.id, runId)
    if (state.connectionId) {
      this.activeConnections.set(state.connectionId, (this.activeConnections.get(state.connectionId) ?? 0) + 1)
    }
    if (lease || slot) {
      // The Task lease and the global Agent capacity slot are renewed from one
      // timer so a long Run can never lose capacity while it still holds tasks.
      state.leaseTimer = setInterval(() => {
        try {
          if (lease && task) {
            this.store.renewTaskLease(task.id, `run:${runId}`, lease.token, this.limits.taskLeaseTtlMs)
            lease.expiresAt = now() + this.limits.taskLeaseTtlMs
          }
          if (state.slot) {
            this.store.renewAgentExecutionSlot(agent.id, runId, state.slot.token, this.limits.agentSlotTtlMs)
            state.slot.expiresAt = now() + this.limits.agentSlotTtlMs
          }
        } catch (error) {
          this.handleLeaseLoss(state, error)
        }
      }, 120_000)
      state.leaseTimer.unref?.()
    }
    this.armDeadline(state);
    if (input.inboxId) {
      try {
        this.store.updateInboxStatus(input.inboxId, 'accepted')
      } catch (error) {
        this.logger.warn({ err: error, inboxId: input.inboxId }, 'failed to mark inbox accepted')
      }
    }
    if (definition && runtimeProfile && useRuntime) {
      void this.executeViaRuntime(state, runtimeProfile, state.promptOverride ?? promptMessage.content, state.workspaceRoot).catch((error) => {
        this.logger.error({ err: error, runId }, 'runtime agent run crashed')
        void this.failRun(state, error instanceof Error ? error.message : String(error)).catch((nested) => {
          this.logger.error({ err: nested, runId }, 'failed to finalize runtime run')
        })
      })
      return { runId, messageId: promptMessage.id }
    }

    void this.execute(state).catch((error) => {
      this.logger.error({ err: error, runId }, 'agent run crashed')
      void this.failRun(state, error instanceof Error ? error.message : String(error)).catch((nested) => {
        this.logger.error({ err: nested, runId }, 'failed to finalize crashed run')
      })
    })
    return { runId, messageId: promptMessage.id }
  }

  /**
   * Wait until a Run reaches a terminal state (or needs reconciliation).
   * On timeout the Run is cancelled so the caller never leaves a busy Session
   * behind; the result still carries the latest persisted Run state.
   */
  async awaitRunTerminal(
    runId: string,
    options: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<{ run: Run; timedOut: boolean }> {
    const timeoutMs = Math.max(100, Math.trunc(options.timeoutMs ?? 120_000))
    const pollMs = Math.max(25, Math.trunc(options.pollMs ?? 200))
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const run = this.store.read.getRun(runId)
      if (!run) throw new AppError('NOT_FOUND', '运行不存在')
      if (isTerminalRunStatus(run.status) || run.status === 'needs_reconciliation') {
        return { run, timedOut: false }
      }
      if (Date.now() >= deadline) {
        try {
          await this.cancel(runId)
        } catch (error) {
          this.logger.warn({ err: error, runId }, 'failed to cancel timed-out run')
        }
        const latest = this.store.read.getRun(runId)
        return { run: latest ?? run, timedOut: true }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, pollMs))
    }
  }

  // ---------------------------------------------------------------------------
  // Hard budgets (wall clock, steps, tool calls)
  // ---------------------------------------------------------------------------

  /**
   * (Re)arm the wall-clock deadline timer. The deadline is an absolute
   * timestamp stored on the Run, so resuming after a restart keeps the
   * remaining budget instead of granting a fresh one.
   */
  private armDeadline(state: ActiveRun): void {
    if (state.deadlineTimer) {
      clearTimeout(state.deadlineTimer)
      state.deadlineTimer = null
    }
    if (!state.budget || state.budget.maxWallClockMs <= 0 || state.budget.deadlineAt <= 0) return
    const remaining = state.budget.deadlineAt - Date.now()
    const delay = Math.max(0, Math.min(MAX_TIMER_MS, remaining))
    state.deadlineTimer = setTimeout(() => {
      void this.enforceDeadline(state)
    }, delay)
    state.deadlineTimer.unref?.()
  }

  private async enforceDeadline(state: ActiveRun): Promise<void> {
    const run = this.store.read.getRun(state.runId)
    if (!run || isTerminalRunStatus(run.status)) return
    const seconds = Math.round(state.budget.maxWallClockMs / 1000)
    await this.terminateRun(state.runId, 'timed_out', 'wall_clock_timeout', `运行超出墙钟上限 ${seconds}s，已强制终止`)
  }

  private persistBudget(state: ActiveRun): void {
    try {
      this.store.updateRun(state.runId, {
        deadlineAt: state.budget.deadlineAt,
        budget: {
          maxWallClockMs: state.budget.maxWallClockMs,
          maxSteps: state.budget.maxSteps,
          maxToolCalls: state.budget.maxToolCalls,
          stepsUsed: state.budget.stepsUsed,
          toolCallsUsed: state.budget.toolCallsUsed,
        },
      })
    } catch (error) {
      this.logger.warn({ err: error, runId: state.runId }, 'failed to persist run budget')
    }
  }

  /**
   * Hard terminal transition used by timeouts and budget exhaustion. It is
   * deliberately idempotent: a late loop result must not overwrite the reason.
   */
  async terminateRun(
    runId: string,
    status: 'timed_out' | 'budget_exhausted',
    reason: string,
    message: string,
  ): Promise<void> {
    const run = this.store.read.getRun(runId)
    if (!run || isTerminalRunStatus(run.status)) return
    const state =
      this.active.get(runId) ??
      ({ runId, abort: new AbortController(), runtimeCancel: null } as unknown as ActiveRun)
    const isActive = this.active.has(runId)
    try {
      state.abort.abort()
    } catch {
      // ignore
    }
    try {
      state.runtimeCancel?.()
    } catch {
      // ignore
    }
    this.resolvePendingPermissions(runId, null)
    this.store.cancelPendingApprovals(runId, message)
    const error = redactSecrets(message).slice(0, 8000)
    this.store.appendRunStep({
      runId,
      kind: 'budget',
      title: status === 'timed_out' ? '墙钟超时终止' : '预算耗尽终止',
      payload: {
        reason,
        status,
        error,
        budget: state.budget
          ? {
              maxWallClockMs: state.budget.maxWallClockMs,
              maxSteps: state.budget.maxSteps,
              maxToolCalls: state.budget.maxToolCalls,
              stepsUsed: state.budget.stepsUsed,
              toolCallsUsed: state.budget.toolCallsUsed,
            }
          : null,
        at: now(),
      },
    })
    if (isActive) {
      try {
        this.transitionRun(state, status, { error, finishedAt: now() })
      } catch (transitionError) {
        this.store.updateRun(runId, { status, error, finishedAt: now() })
        this.logger.warn({ err: transitionError, runId }, 'budget transition bypassed state machine')
      }
    } else {
      this.store.updateRun(runId, { status, error, finishedAt: now() })
      this.store.appendEvent(run.projectId, runId, PROJECT_EVENT_TYPES.runStatusChanged, {
        status,
        reason,
        runId,
        sessionId: run.sessionId,
      })
    }
    this.store.updateTaskAttemptStatus(runId, status === 'timed_out' ? 'timed_out' : 'budget_exhausted')
    try {
      this.tryMoveTask(run.taskId, 'blocked', message)
    } catch (error) {
      this.logger.warn({ err: error, runId }, 'failed to block task after budget termination')
    }
    if (isActive) {
      if (state.inboxId) {
        try {
          this.store.updateInboxStatus(state.inboxId, 'failed', { error })
        } catch {
          // ignore
        }
      }
      this.cleanup(state, status)
    } else {
      this.store.releaseAgentExecutionSlotForRun(runId)
      this.releaseStoredLease(run)
    }
  }

  /** Remaining assistant/tool rounds for this Run. */
  private remainingSteps(state: ActiveRun): number {
    return Math.max(0, state.budget.maxSteps - state.budget.stepsUsed)
  }

  private remainingToolCalls(state: ActiveRun): number {
    return Math.max(0, state.budget.maxToolCalls - state.budget.toolCallsUsed)
  }

  private collectRunSkills(
    definition: AgentDefinition | null,
    task: Task | null,
    agent: Agent,
  ): Skill[] {
    const selected = selectSkills({ task, agent }).map((entry) => ({
      id: entry.skill.id,
      name: entry.skill.name,
      description: entry.skill.description,
      version: '1.0.0',
      source: 'builtin',
      content: entry.skill.prompt,
      schemaVersion: 1,
      createdAt: 0,
      updatedAt: 0,
    }))
    const byId = new Map(selected.map((skill) => [skill.id, skill]))
    for (const binding of definition?.skills ?? []) {
      if (!binding.enabled || byId.has(binding.skillId)) continue
      const skill = this.store.read.listSkills().find((item) => item.id === binding.skillId)
      if (skill) byId.set(skill.id, skill)
    }
    return [...byId.values()]
  }

  private buildRunSnapshot(input: {
    runId: string
    agent: Agent
    definition: AgentDefinition | null
    runtimeProfile: RuntimeProfile | null
    task: Task | null
    routed: { connectionId: string; modelId: string | null } | null
    createdAt: number
  }): RunSnapshot {
    const { runId, agent, definition, runtimeProfile, task, routed, createdAt } = input
    const persona = definition?.persona ?? {
      role: agent.role,
      background: '',
      responsibilities: '',
      principles: '',
      style: '',
      constraints: '',
      systemPrompt: agent.systemPrompt,
    }
    const permissions = definition?.permissions ?? {
      tools: [],
      files: true,
      shell: true,
      network: true,
    }
    return {
      runId,
      agentId: agent.id,
      agentConfigVersion: definition?.currentVersion ?? 0,
      agentName: agent.name,
      agentRole: agent.role,
      agentDescription: agent.description,
      agentCapabilities: agent.capabilities,
      persona,
      skills: this.collectRunSkills(definition, task, agent).map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        version: skill.version,
        source: skill.source,
        content: skill.content,
        enabled: true,
      })),
      permissions,
      modelRef: definition?.modelRef ?? null,
      runtimeProfileId: runtimeProfile?.id ?? null,
      runtimeProfileName: runtimeProfile?.name ?? null,
      runtimeProtocol: runtimeProfile?.protocol ?? null,
      runtimeProfileVersion: runtimeProfile?.version ?? null,
      connectionId: routed?.connectionId ?? null,
      modelId: routed?.modelId ?? null,
      worktreeId: null,
      workflowNodeId: null,
      createdAt,
    }
  }

  private isAcpPermission(request: Record<string, unknown> | null | undefined): boolean {
    return request?.kind === 'acp-permission'
  }

  private isRuntimeApproval(request: Record<string, unknown> | null | undefined): boolean {
    return request?.kind === 'runtime-execution'
  }

  private isEphemeralApproval(request: Record<string, unknown> | null | undefined): boolean {
    return this.isAcpPermission(request) || this.isRuntimeApproval(request)
  }

  private resolvePendingPermissions(runId: string, optionId: string | null): void {
    for (const [approvalId, pending] of this.pendingPermissions) {
      if (pending.state.runId !== runId) continue
      pending.resolve(optionId)
      this.pendingPermissions.delete(approvalId)
    }
    for (const [approvalId, pending] of this.pendingRuntimeApprovals) {
      if (pending.state.runId !== runId) continue
      pending.resolve(false)
      this.pendingRuntimeApprovals.delete(approvalId)
    }
  }

  /**
   * CLI runtimes may write to the workspace. Gate a run behind a real Approval
   * before spawning the runtime; read-only ACP uses per-tool permission requests.
   */
  private requestRuntimeApproval(
    state: ActiveRun,
    profile: RuntimeProfile,
    toolCall: ToolCall,
  ): Promise<boolean> {
    this.store.updateToolCall(toolCall.id, { status: 'waiting_approval' })
    const approval = this.store.createApproval({
      projectId: state.projectId,
      runId: state.runId,
      toolCallId: toolCall.id,
      title: `授权运行 ${profile.name}`,
      detail: `即将通过 CLI Runtime「${profile.name}」执行 Agent；批准后子进程可修改工作区。`,
      request: {
        kind: 'runtime-execution',
        runtimeProfileId: profile.id,
        protocol: profile.protocol,
      },
      expiresAt: now() + this.limits.taskLeaseTtlMs,
    })
    this.transitionRun(state, 'waiting_approval')
    state.pendingApprovalId = approval.id
    this.store.appendRunStep({
      runId: state.runId,
      kind: 'approval',
      title: `等待 Runtime 授权：${profile.name}`,
      status: 'waiting',
      payload: { approvalId: approval.id, toolCallId: toolCall.id, runtimeProfileId: profile.id },
    })
    this.store.appendEvent(state.projectId, state.runId, PROJECT_EVENT_TYPES.approvalRequested, {
      approvalId: approval.id,
      runId: state.runId,
      sessionId: state.sessionId,
      toolName: 'runtime.execute',
      taskId: state.taskId,
    })
    return new Promise<boolean>((resolve) => {
      this.pendingRuntimeApprovals.set(approval.id, { resolve, state, toolCallId: toolCall.id })
    })
  }

  /**
   * ACP delegates permission decisions to the client. Do not auto-approve from
   * Agent grants: create a ProjectOS ToolCall + Approval and wait for a human.
   */
  private async requestAcpPermission(state: ActiveRun, params: unknown): Promise<string | null> {
    const value = params as {
      options?: Array<{ optionId?: string; kind?: string; name?: string }>
      toolCall?: { kind?: string; title?: string; toolCallId?: string }
    }
    const kind = value.toolCall?.kind ?? 'unknown'
    const options = value.options ?? []
    const optionId =
      options.find((option) => ['allow', 'allow_once', 'approve', 'approved'].includes((option.kind ?? '').toLowerCase()))?.optionId ??
      options[0]?.optionId ??
      null
    const toolCall = this.store.createToolCall({
      runId: state.runId,
      toolName: 'acp.permission',
      idempotencyKey: `${state.runId}:acp:${newId('tol')}`,
      status: 'waiting_approval',
      argsHash: hashArgs({ kind, options }),
      args: { kind, title: value.toolCall?.title ?? null, options },
    })
    const approval = this.store.createApproval({
      projectId: state.projectId,
      runId: state.runId,
      toolCallId: toolCall.id,
      title: `ACP 授权：${kind}`,
      detail: `ACP Runtime 请求执行 ${kind} 操作；批准前不会返回 allow。`,
      request: {
        kind: 'acp-permission',
        toolKind: kind,
        optionId,
        options: options.map((option) => ({ optionId: option.optionId ?? null, kind: option.kind ?? null, name: option.name ?? null })),
      },
      expiresAt: now() + this.limits.taskLeaseTtlMs,
    })
    this.transitionRun(state, 'waiting_approval')
    state.pendingApprovalId = approval.id
    this.store.appendRunStep({
      runId: state.runId,
      kind: 'approval',
      title: `等待 ACP 授权：${kind}`,
      status: 'waiting',
      payload: { approvalId: approval.id, toolCallId: toolCall.id, toolKind: kind },
    })
    this.store.appendEvent(state.projectId, state.runId, PROJECT_EVENT_TYPES.approvalRequested, {
      approvalId: approval.id,
      runId: state.runId,
      sessionId: state.sessionId,
      toolName: 'acp.permission',
      taskId: state.taskId,
    })
    return new Promise<string | null>((resolve) => {
      this.pendingPermissions.set(approval.id, { resolve, state, optionId, toolCallId: toolCall.id })
    })
  }

  private releaseRunLease(taskId: string, runId: string, lease: { token: number }): void {
    try {
      this.store.releaseTaskLease(taskId, `run:${runId}`, lease.token)
    } catch (error) {
      this.logger.warn({ err: error, runId }, 'failed to release task lease')
    }
  }

  private releaseStoredLease(run: Run): void {
    if (!run.taskId) return
    const lease = this.store.read.getTaskLease(run.taskId)
    if (lease && lease.holderId === `run:${run.id}`) {
      this.releaseRunLease(run.taskId, run.id, { token: lease.fencingToken })
    }
  }

  private assertRunLease(run: Run): void {
    if (!run.taskId) return
    const lease = this.store.read.getTaskLease(run.taskId)
    if (!lease || lease.holderId !== `run:${run.id}` || lease.expiresAt <= now()) {
      throw new AppError('CONFLICT', '任务租约已失效，旧执行者不能继续提交任务状态')
    }
  }

  private assertLease(state: ActiveRun): void {
    if (!state.taskId) return
    if (!state.lease) {
      throw new AppError('CONFLICT', '任务租约不存在或已失效，运行不能继续提交')
    }
    const lease = this.store.read.getTaskLease(state.taskId)
    if (
      !lease ||
      lease.holderId !== `run:${state.runId}` ||
      lease.fencingToken !== state.lease.token ||
      lease.expiresAt <= now()
    ) {
      throw new AppError('CONFLICT', '任务租约已失效，旧执行者不能继续提交任务状态')
    }
  }

  private handleLeaseLoss(state: ActiveRun, error: unknown): void {
    if (state.leaseTimer) {
      clearInterval(state.leaseTimer)
      state.leaseTimer = null
    }
    const run = this.store.read.getRun(state.runId)
    if (!run || isTerminalRunStatus(run.status)) return
    state.abort.abort()
    const message = error instanceof Error ? error.message : String(error)
    this.logger.error({ err: error, runId: state.runId }, 'task lease lost; stopping run')
    void this.failRun(state, `任务租约已失效，运行已停止：${message}`).catch((nested) => {
      this.logger.error({ err: nested, runId: state.runId }, 'failed to finalize run after lease loss')
    })
  }

  /**
   * Fencing check for the global Agent capacity slot. The 120s renewal timer is
   * too coarse for long tool loops, so the owning Run verifies its token before
   * every model turn and before every tool side effect.
   */
  private assertExecutionSlot(state: ActiveRun): void {
    if (!state.slot) return
    const slot = this.store.getAgentExecutionSlot(state.agentId)
    if (!slot || slot.runId !== state.runId || slot.token !== state.slot.token) {
      throw new AppError(
        'CONFLICT',
        'Agent 执行容量已失效：该 Agent 的容量槽已被其他运行占用（fencing token 不匹配）',
      )
    }
  }

  private handleSlotLoss(state: ActiveRun, error: unknown): void {
    const run = this.store.read.getRun(state.runId)
    if (!run || isTerminalRunStatus(run.status)) return
    state.abort.abort()
    try {
      state.runtimeCancel?.()
    } catch {
      // ignore cancellation failure; the abort signal is authoritative
    }
    const message = error instanceof Error ? error.message : String(error)
    this.logger.error({ err: error, runId: state.runId }, 'execution slot lost; stopping run')
    void this.failRun(state, `Agent 执行容量已失效，运行已停止：${message}`).catch((nested) => {
      this.logger.error({ err: nested, runId: state.runId }, 'failed to finalize run after slot loss')
    })
  }

  private async executeViaRuntime(
    state: ActiveRun,
    profile: RuntimeProfile,
    userPrompt: string,
    cwd: string,
  ): Promise<void> {
    const snapshot = state.snapshot
    if (profile.protocol !== 'acp' && !snapshot.permissions.shell) {
      throw new AppError('APPROVAL_REQUIRED', '该 Runtime 需要 Shell 权限，请先在 Agent 权限中启用 Shell')
    }
    const task = state.taskId ? this.store.read.getTask(state.taskId) : null
    const structured = [
      `# Agent: ${snapshot.agentName}`,
      `Role: ${snapshot.agentRole}`,
      snapshot.persona.background ? `Background: ${snapshot.persona.background}` : '',
      snapshot.persona.responsibilities ? `Responsibilities: ${snapshot.persona.responsibilities}` : '',
      snapshot.persona.principles ? `Principles: ${snapshot.persona.principles}` : '',
      snapshot.persona.style ? `Style: ${snapshot.persona.style}` : '',
      snapshot.persona.constraints ? `Constraints: ${snapshot.persona.constraints}` : '',
      snapshot.persona.systemPrompt,
    ].filter(Boolean).join('\n')
    const skillText = snapshot.skills
      .filter((skill) => skill.enabled)
      .map((skill) => `# Skill: ${skill.name}\n${skill.content}`)
      .join('\n\n')
    const taskText = task
      ? `# Task\n${task.title}\n${task.description}\nAcceptance: ${task.acceptanceCriteria.join('; ')}`
      : ''
    const prompt = [structured, skillText, taskText, `# User request\n${userPrompt}`].filter(Boolean).join('\n\n')
    this.store.appendRunStep({
      runId: state.runId,
      kind: 'status',
      title: `Runtime 执行：${profile.name}`,
      payload: { runtimeProfileId: profile.id, protocol: profile.protocol, cwd },
    })
    const runtimeToolCall = this.store.createToolCall({
      runId: state.runId,
      toolName: profile.protocol === 'acp' ? 'runtime.acp' : 'runtime.execute',
      idempotencyKey: `${state.runId}:runtime`,
      status: 'running',
      argsHash: hashArgs({ profileId: profile.id, protocol: profile.protocol, promptChars: prompt.length }),
      args: { profileId: profile.id, protocol: profile.protocol, promptChars: prompt.length, cwd },
    })
    // Baseline before the external process starts: only files that change
    // between these two snapshots are attributed to this Run.
    const fileBaseline: FileFingerprint[] = snapshotFileFingerprints(cwd || state.workspaceRoot)
    try {
      // A stolen capacity slot must stop the Run before it spawns an external
      // process or asks for a fresh approval.
      this.assertExecutionSlot(state)
      let output: string
      let executionId: string
      if (profile.protocol === 'acp') {
        if (!profile.executable) throw new AppError('BAD_REQUEST', 'ACP Runtime 未配置可执行路径')
        const client = new AcpClient(profile.executable, profile.args, cwd)
        state.runtimeCancel = () => client.dispose()
        client.setPermissionHandler((params) => this.requestAcpPermission(state, params))
        const chunks: string[] = []
        const offEvent = client.onEvent((message) => {
          const text = acpTextFromEvent(message)
          if (text) chunks.push(text)
        })
        try {
          const session = await client.initialize(cwd)
          const result = await client.prompt(session.sessionId, prompt)
          output = chunks.join('').trim() || acpTextFromResult(result) || 'Runtime 执行完成（ACP 未返回文本内容）'
          executionId = `acp-${state.runId}`
          this.store.appendRunStep({
            runId: state.runId,
            kind: 'status',
            title: 'ACP 执行完成',
            payload: { result },
          })
        } finally {
          offEvent()
          client.dispose()
        }
      } else {
        const approved = await this.requestRuntimeApproval(state, profile, runtimeToolCall)
        if (!approved) {
          throw new AppError('APPROVAL_REQUIRED', '用户拒绝了 CLI Runtime 执行')
        }
        const result = await this.runtimeExecutor.execute(profile.id, prompt, cwd, (executionId) => {
          state.runtimeCancel = () => this.runtimeExecutor.cancel(executionId)
        })
        output = result.output
        executionId = result.executionId
        if (state.abort.signal.aborted) {
          this.store.updateToolCall(runtimeToolCall.id, { status: 'failed', error: '运行已取消', finishedAt: now() })
          return
        }
      if (result.status !== 'completed') throw new AppError('INTERNAL', output || `Runtime ${result.status}`)
      }
      this.assertLease(state)
      const summary = output.trim().slice(0, 20_000) || 'Runtime 执行完成'
      this.store.updateToolCall(runtimeToolCall.id, {
        status: 'completed',
        result: { summary: summary.slice(0, 20_000), executionId },
        finishedAt: now(),
      })
      this.store.appendMessage({ sessionId: state.sessionId, role: 'assistant', content: summary, runId: state.runId, metadata: { runtimeProfileId: profile.id, executionId } })
      this.transitionRun(state, 'completed', { summary, finishedAt: now() })
      this.tryMoveTask(state.taskId, 'review')
      if (state.inboxId) {
        try { this.store.updateInboxStatus(state.inboxId, 'completed') } catch { /* ignore */ }
      }
      this.store.updateTaskAttemptStatus(state.runId, 'completed')
      this.cleanup(state, 'completed')
    } catch (error) {
      this.store.updateToolCall(runtimeToolCall.id, {
        status: 'failed',
        error: redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 8000),
        finishedAt: now(),
      })
      if (state.abort.signal.aborted) return
      throw error instanceof Error ? error : new Error(String(error))
    } finally {
      state.runtimeCancel = null
      this.recordRunFileChanges(state, fileBaseline, cwd || state.workspaceRoot)
    }
  }

  /**
   * Attribute only the files that changed during this external-Runtime Run.
   * A file that was already dirty before the Run keeps its baseline hash and is
   * therefore excluded, which keeps per-Run ownership trustworthy.
   */
  private recordRunFileChanges(state: ActiveRun, baseline: FileFingerprint[], rootPath: string): void {
    try {
      const changes = diffFileFingerprints(baseline, snapshotFileFingerprints(rootPath))
      this.store.replaceRunFileChanges(state.runId, changes)
      this.store.appendRunStep({
        runId: state.runId,
        kind: 'context',
        title: '文件变更归属',
        payload: {
          count: changes.length,
          files: changes.slice(0, 200),
          method: 'baseline-content-hash',
        },
      })
    } catch (error) {
      this.logger.warn({ err: error, runId: state.runId }, 'failed to attribute run file changes')
    }
  }

  private async buildMessages(state: ActiveRun, resume: boolean): Promise<{ messages: ChatMessage[]; tools: LlmToolDefinition[]; system: string }> {
    const run = this.store.read.getRun(state.runId)
    if (!run) throw new AppError('NOT_FOUND', '运行不存在')
    const project = this.store.read.getProject(state.projectId)
    const session = this.store.read.getSession(state.sessionId)
    if (!project || !session) throw new AppError('NOT_FOUND', '项目或会话不存在')
    const task = state.taskId ? this.store.read.getTask(state.taskId) : null
    const agent = this.store.read.getAgent(state.agentId)
    if (!agent) throw new AppError('NOT_FOUND', 'Agent 不存在')
    const requirements = this.store.read.listRequirements(project.id)
    const decisions = this.store.read.listDecisions(project.id)
    const artifacts = this.store.read.listArtifacts(project.id, task?.id ?? null)
    const knowledge = this.store.read.listKnowledge(project.id)
    const agentsFile = listProjectAgentsFile(project.rootPath)
    const snapshot = state.snapshot
    const skills = snapshot.skills
      .filter((skill) => skill.enabled)
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        prompt: skill.content,
      }))
    const contextAgent: Agent = {
      ...agent,
      name: snapshot.agentName,
      role: snapshot.agentRole,
      description: snapshot.agentDescription,
      capabilities: snapshot.agentCapabilities as Agent['capabilities'],
      systemPrompt: snapshot.persona.systemPrompt,
    }
    const handoffs = this.store.read.listHandoffViews(project.id)
    const handoff = task
      ? handoffs.find((entry) => entry.taskId === task.id && entry.status === 'accepted')
      : undefined
    const upstream = task
      ? collectUpstreamContext(this.store, project, task)
      : { items: [], audit: { artifacts: [], runIds: [], skipped: [] } }
    const context = buildContext({
      project,
      task,
      agent: contextAgent,
      requirements,
      decisions,
      artifacts: task ? artifacts : artifacts.slice(0, 8),
      knowledge,
      agentsFile,
      skills,
      handoffSummary: handoff?.summary ?? null,
      upstream: upstream.items,
    })
    const tools = toolCatalogForAgent(contextAgent.capabilities).filter((tool) => {
      if (tool.name === 'write_file') return snapshot.permissions.files
      if (tool.name === 'run_command' || tool.name === 'run_tests') return snapshot.permissions.shell
      return true
    })
    const toolPrompt = tools.map((tool) => `- ${tool.name}：${tool.description}`).join('\n')
    const system = `${context.system}\n\n## 可用工具\n${toolPrompt || '无'}\n`
    if (!resume) {
      this.store.appendRunStep({
        runId: run.id,
        kind: 'context',
        title: '上下文组装完成',
        payload: {
          chars: context.chars,
          truncated: context.truncated,
          sources: context.sources,
          skillIds: skills.map((skill) => skill.id),
        },
      })
      this.store.appendRunStep({
        runId: run.id,
        kind: 'context',
        title: '触发消息',
        payload: { promptMessageId: state.promptMessageId },
      })
      const hasUpstreamStep = this.store.read
        .getRunSteps(run.id)
        .some((step) => step.title === '上游成果注入')
      if (!hasUpstreamStep) {
        this.store.appendRunStep({
          runId: run.id,
          kind: 'context',
          title: '上游成果注入',
          payload: {
            artifacts: upstream.audit.artifacts,
            runIds: upstream.audit.runIds,
            skipped: upstream.audit.skipped,
          },
        })
      }
    }
    const allMessages = this.store.read.getMessages(session.id, 400)
    const promptIndex = allMessages.findIndex((message) => message.id === state.promptMessageId)
    const prior = promptIndex >= 0 ? allMessages.slice(0, promptIndex + 1) : allMessages.filter((message) => message.createdAt <= run.createdAt)
    const history = formatSessionHistory(prior, 30).map((message) => ({
      role: message.role,
      content: message.content,
    })) as ChatMessage[]
    if (history.length === 0) {
      const prompt = this.store.getMessageById(state.promptMessageId)
      history.push({ role: 'user', content: prompt?.content ?? '请开始执行当前任务。' })
    }
    if (state.promptOverride) {
      let replaced = false
      for (let index = history.length - 1; index >= 0; index -= 1) {
        if (history[index]?.role === 'user') {
          history[index] = { role: 'user', content: state.promptOverride }
          replaced = true
          break
        }
      }
      if (!replaced) history.push({ role: 'user', content: state.promptOverride })
    }
    const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history]
    const steps = this.store.read.getRunSteps(run.id)
    const hasPersistedTurns = steps.some(
      (step) =>
        (step.kind === 'text' && step.payload.final === true) ||
        step.kind === 'tool_result',
    )
    if (resume || run.status === 'waiting_approval' || hasPersistedTurns) {
      messages.push(...this.reconstructTranscript(run.id))
    }
    return { messages: repairToolCallTranscript(messages), tools, system }
  }

  private reconstructTranscript(runId: string): ChatMessage[] {
    const steps = this.store.read.getRunSteps(runId)
    const messages: ChatMessage[] = []
    for (const step of steps) {
      if (step.kind === 'text' && step.payload.final === true) {
        const content = typeof step.payload.content === 'string' ? step.payload.content : ''
        const rawCalls = Array.isArray(step.payload.toolCalls) ? step.payload.toolCalls : []
        const toolCalls: ToolCallRequest[] = rawCalls
          .filter((call): call is Record<string, unknown> => Boolean(call) && typeof call === 'object')
          .map((call) => ({
            id: String(call.id ?? ''),
            name: String(call.name ?? ''),
            arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.args ?? {}),
          }))
          .filter((call) => call.id && call.name)
        messages.push({
          role: 'assistant',
          content,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        })
      } else if (step.kind === 'tool_result') {
        const callId = typeof step.payload.callId === 'string' ? step.payload.callId : ''
        const content = typeof step.payload.content === 'string' ? step.payload.content : ''
        if (callId) messages.push({ role: 'tool', toolCallId: callId, content })
      }
    }
    return messages
  }

  private async execute(state: ActiveRun): Promise<void> {
    if (!state.provider) throw new AppError('INTERNAL', 'Agent 运行缺少 Provider')
    if (state.busy) return
    const existing = this.store.read.getRun(state.runId)
    if (!existing || isTerminalRunStatus(existing.status)) return
    try {
      this.assertExecutionSlot(state)
    } catch (error) {
      this.handleSlotLoss(state, error)
      return
    }
    if (Date.now() >= state.budget.deadlineAt && state.budget.maxWallClockMs > 0) {
      await this.terminateRun(state.runId, 'timed_out', 'wall_clock_timeout', '运行墙钟预算已耗尽，未再启动新的模型轮次')
      return
    }
    if (this.remainingSteps(state) <= 0) {
      await this.terminateRun(
        state.runId,
        'budget_exhausted',
        'step_budget_exhausted',
        `运行步骤预算已耗尽（上限 ${state.budget.maxSteps} 轮），未再启动新的模型轮次`,
      )
      return
    }
    if (this.remainingToolCalls(state) <= 0) {
      await this.terminateRun(
        state.runId,
        'budget_exhausted',
        'tool_budget_exhausted',
        `工具调用预算已耗尽（上限 ${state.budget.maxToolCalls} 次），未再执行工具`,
      )
      return
    }
    state.busy = true
    try {
      const built = await this.buildMessages(state, existing.status === 'waiting_approval')
      if (state.abort.signal.aborted) return
      const result = await runAgentLoop({
        provider: state.provider,
        tools: built.tools,
        messages: built.messages,
        signal: state.abort.signal,
        maxSteps: this.remainingSteps(state),
        onTextDelta: (text) => this.onTextDelta(state, text),
        onAssistantTurn: (turn) => this.onAssistantTurn(state, turn),
        onToolResult: (invocation, outcome) => this.onToolResult(state, invocation, outcome),
        onUsage: (usage) => {
          state.inputTokens += usage.inputTokens ?? 0
          state.outputTokens += usage.outputTokens ?? 0
        },
        executeTool: (invocation) => this.executeTool(state, invocation),
      })
      state.budget.stepsUsed += Math.max(0, result.steps)
      this.persistBudget(state)
      await this.applyLoopResult(state, result)
    } finally {
      state.busy = false
    }
  }

  private async applyLoopResult(state: ActiveRun, result: AgentLoopResult): Promise<void> {
    const current = this.store.read.getRun(state.runId)
    if (!current || isTerminalRunStatus(current.status) || !this.active.has(state.runId)) return
    state.inputTokens = Math.max(state.inputTokens, result.inputTokens ?? 0)
    state.outputTokens = Math.max(state.outputTokens, result.outputTokens ?? 0)
    if (result.status === 'waiting_approval') {
      state.pendingApprovalId = result.approvalId ?? null
      this.store.updateRun(state.runId, {
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
      })
      return
    }
    if (result.status === 'completed') {
      this.assertLease(state)
      const summary = (state.lastAssistantText || result.text || 'Agent 完成了本轮执行。').trim().slice(0, 20_000)
      this.transitionRun(state, 'verifying', { summary, inputTokens: state.inputTokens, outputTokens: state.outputTokens })
      this.store.appendRunStep({
        runId: state.runId,
        kind: 'status',
        title: '执行完成',
        payload: { summary, steps: result.steps },
      })
      this.transitionRun(state, 'completed', {
        summary,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        finishedAt: now(),
      })
      this.tryMoveTask(state.taskId, 'review')
      if (state.inboxId) {
        try {
          this.store.updateInboxStatus(state.inboxId, 'completed')
        } catch (error) {
          this.logger.warn({ err: error }, 'failed to complete inbox')
        }
      }
      this.cleanup(state, 'completed')
      return
    }
    if (result.status === 'cancelled') {
      this.store.appendRunStep({
        runId: state.runId,
        kind: 'status',
        title: '运行已取消',
        payload: {},
      })
      this.transitionRun(state, 'cancelled', {
        error: '用户取消了运行',
        finishedAt: now(),
      })
      this.tryMoveTask(state.taskId, 'ready')
      if (state.inboxId) {
        try {
          this.store.updateInboxStatus(state.inboxId, 'failed', { error: '运行已取消' })
        } catch {
          // ignore
        }
      }
      this.store.updateTaskAttemptStatus(state.runId, 'cancelled')
      this.cleanup(state, 'cancelled')
      return
    }
    if (result.status === 'failed' && /达到最大工具轮次/.test(result.error ?? '')) {
      await this.terminateRun(
        state.runId,
        'budget_exhausted',
        'step_budget_exhausted',
        `运行步骤预算已耗尽（上限 ${state.budget.maxSteps} 轮）：${result.error ?? ''}`,
      )
      return
    }
    await this.failRun(state, result.error ?? 'Agent 运行失败')
  }

  private async failRun(state: ActiveRun, message: string): Promise<void> {
    if (!this.active.has(state.runId)) return
    const current = this.store.read.getRun(state.runId)
    if (!current || isTerminalRunStatus(current.status)) {
      this.cleanup(state, 'failed')
      return
    }
    const error = redactSecrets(message).slice(0, 8000)
    this.store.appendRunStep({
      runId: state.runId,
      kind: 'error',
      title: '运行失败',
      payload: { error },
    })
    this.store.updateRun(state.runId, {
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
    })
    this.transitionRun(state, 'failed', {
      error,
      finishedAt: now(),
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
    })
    this.tryMoveTask(state.taskId, 'blocked', `Agent 运行失败：${error}`)
    if (state.inboxId) {
      try {
        this.store.updateInboxStatus(state.inboxId, 'failed', { error })
      } catch {
        // ignore
      }
    }
    this.store.updateTaskAttemptStatus(state.runId, 'failed')
    this.cleanup(state, 'failed')
  }

  private cleanup(state: ActiveRun, status: RunStatus): void {
    this.resolvePendingPermissions(state.runId, null)
    const price =
      state.connectionId && state.modelId
        ? this.store.read.getAIModelPrice(state.connectionId, state.modelId)
        : null
    const estimatedCost = price
      ? (state.inputTokens / 1_000_000) * price.inputPerMillion +
        (state.outputTokens / 1_000_000) * price.outputPerMillion
      : null
    try {
      this.store.recordAIUsage({
        id: newId('usg'),
        runId: state.runId,
        connectionId: state.connectionId,
        modelId: state.modelId,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        usageSource: state.inputTokens || state.outputTokens ? 'provider' : 'unknown',
        estimatedCost,
        currency: price?.currency ?? null,
        createdAt: now(),
      })
    } catch (error) {
      this.logger.warn({ err: error, runId: state.runId }, 'failed to record AI usage')
    }
    if (state.leaseTimer) clearInterval(state.leaseTimer)
    if (state.deadlineTimer) clearTimeout(state.deadlineTimer)
    state.deadlineTimer = null
    if (state.lease && state.taskId) {
      try {
        this.store.releaseTaskLease(state.taskId, `run:${state.runId}`, state.lease.token)
      } catch (error) {
        this.logger.warn({ err: error }, 'failed to release lease')
      }
    }
    if (state.slot) {
      try {
        this.store.releaseAgentExecutionSlot(state.agentId, state.runId, state.slot.token)
      } catch (error) {
        this.logger.warn({ err: error, runId: state.runId }, 'failed to release agent execution slot')
      }
    }
    this.active.delete(state.runId)
    this.sessionIndex.delete(state.sessionId)
    if (state.connectionId) {
      const remaining = (this.activeConnections.get(state.connectionId) ?? 1) - 1
      if (remaining <= 0) this.activeConnections.delete(state.connectionId)
      else this.activeConnections.set(state.connectionId, remaining)
    }
    this.logger.info({ runId: state.runId, status }, 'agent run finished')
  }

  private transitionRun(
    state: ActiveRun,
    status: RunStatus,
    patch: {
      error?: string | null
      summary?: string | null
      inputTokens?: number
      outputTokens?: number
      finishedAt?: number | null
    } = {},
  ): void {
    const run = this.store.read.getRun(state.runId)
    if (!run) return
    if (run.status === status) return
    assertRunTransition(run.status, status)
    this.store.updateRun(state.runId, { status, ...patch })
    this.store.appendEvent(state.projectId, state.runId, PROJECT_EVENT_TYPES.runStatusChanged, {
      status,
      runId: state.runId,
      sessionId: state.sessionId,
      taskId: state.taskId,
      actorName: this.store.read.getAgent(state.agentId)?.name ?? 'Agent',
    })
    this.store.appendRunStep({
      runId: state.runId,
      kind: 'status',
      title: `状态：${status}`,
      payload: { status },
    })
  }

  private async onTextDelta(state: ActiveRun, text: string): Promise<void> {
    state.textBuffer += text
    const timestamp = now()
    if (!state.textStepId) {
      const step = this.store.appendRunStep({
        runId: state.runId,
        kind: 'text',
        status: 'streaming',
        title: 'Agent 输出',
        payload: { content: state.textBuffer, final: false },
      })
      state.textStepId = step.id
      this.hub.publish({
        type: 'run.step',
        projectId: state.projectId,
        runId: state.runId,
        stepId: step.id,
        kind: 'text',
      })
      state.lastTextFlushAt = timestamp
    } else if (timestamp - state.lastTextFlushAt > 250) {
      this.store.updateRunStep(state.textStepId, {
        payload: { content: state.textBuffer, final: false },
      })
      state.lastTextFlushAt = timestamp
    }
    this.hub.publish({
      type: 'run.delta',
      projectId: state.projectId,
      runId: state.runId,
      sessionId: state.sessionId,
      text,
      stepSeq: 0,
    })
  }

  private async onAssistantTurn(
    state: ActiveRun,
    turn: { content: string; toolCalls: ToolCallRequest[] },
  ): Promise<void> {
    const payload = {
      content: turn.content,
      toolCalls: turn.toolCalls,
      final: true,
      role: 'assistant',
    }
    if (state.textStepId) {
      this.store.updateRunStep(state.textStepId, { payload, status: 'completed' })
      this.hub.publish({
        type: 'run.step',
        projectId: state.projectId,
        runId: state.runId,
        stepId: state.textStepId,
        kind: 'text',
      })
    } else if (turn.content.trim() || turn.toolCalls.length > 0) {
      const step = this.store.appendRunStep({
        runId: state.runId,
        kind: 'text',
        title: 'Agent 输出',
        payload,
      })
      this.hub.publish({
        type: 'run.step',
        projectId: state.projectId,
        runId: state.runId,
        stepId: step.id,
        kind: 'text',
      })
    }
    state.textStepId = null
    state.textBuffer = ''
    if (turn.content.trim()) {
      state.lastAssistantText = turn.content.trim()
      this.store.appendMessage({
        sessionId: state.sessionId,
        role: 'assistant',
        content: turn.content,
        runId: state.runId,
        metadata: { agentId: state.agentId },
      })
    }
    state.checkpointSeq += 1
    const checkpointId = newId('ckp')
    try {
      this.store.createCheckpoint({
        id: checkpointId,
        runId: state.runId,
        seq: state.checkpointSeq,
        schemaVersion: 1,
        state: {
          status: 'running',
          turn: state.checkpointSeq,
          provider: state.provider?.id ?? 'runtime',
          sessionId: state.sessionId,
          taskId: state.taskId,
        },
      })
      this.store.updateRun(state.runId, {
        checkpointId,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
      })
    } catch (error) {
      this.logger.warn({ err: error, runId: state.runId }, 'failed to write checkpoint')
    }
  }

  private async onToolResult(state: ActiveRun, invocation: ToolInvocation, outcome: ToolOutcome): Promise<void> {
    if (outcome.status === 'paused') return
    const ok = outcome.status === 'completed'
    const content = ok
      ? JSON.stringify(outcome.result ?? null).slice(0, 60_000)
      : JSON.stringify({ ok: false, error: outcome.error }).slice(0, 60_000)
    const step = this.store.appendRunStep({
      runId: state.runId,
      kind: 'tool_result',
      title: `工具结果：${invocation.name}`,
      payload: {
        callId: invocation.callId,
        name: invocation.name,
        ok,
        content,
      },
    })
    this.hub.publish({
      type: 'run.step',
      projectId: state.projectId,
      runId: state.runId,
      stepId: step.id,
      kind: 'tool_result',
    })
  }

  private async executeTool(state: ActiveRun, invocation: ToolInvocation): Promise<ToolOutcome> {
    // Hard budgets are checked before any side effect. A run that reached its
    // wall clock, step or tool-call limit must not start another tool.
    const currentRun = this.store.read.getRun(state.runId)
    if (!currentRun || isTerminalRunStatus(currentRun.status)) {
      return { status: 'failed', error: '运行已终止，不再执行工具' }
    }
    try {
      this.assertExecutionSlot(state)
    } catch (error) {
      this.handleSlotLoss(state, error)
      return { status: 'failed', error: 'Agent 执行容量已失效，工具未执行' }
    }
    if (state.budget.maxWallClockMs > 0 && Date.now() >= state.budget.deadlineAt) {
      await this.terminateRun(
        state.runId,
        'timed_out',
        'wall_clock_timeout',
        `运行超出墙钟上限 ${Math.round(state.budget.maxWallClockMs / 1000)}s，已停止执行工具`,
      )
      return { status: 'failed', error: '运行墙钟超时，工具未执行' }
    }
    if (this.remainingToolCalls(state) <= 0) {
      await this.terminateRun(
        state.runId,
        'budget_exhausted',
        'tool_budget_exhausted',
        `工具调用预算已耗尽（上限 ${state.budget.maxToolCalls} 次），已停止执行工具`,
      )
      return { status: 'failed', error: '工具调用预算已耗尽，工具未执行' }
    }
    state.budget.toolCallsUsed += 1
    this.persistBudget(state)
    this.assertLease(state)
    const definition = getToolDefinition(invocation.name)
    const project = this.store.read.getProject(state.projectId)
    if (!definition || !project) {
      return { status: 'denied', error: `未知工具：${invocation.name}` }
    }
    const policy = evaluateToolPolicy({
      rootPath: state.workspaceRoot,
      toolName: invocation.name,
      args: invocation.args,
    })
    const idempotencyKey = `${state.runId}:${invocation.callId}`
    let toolCall: ToolCall
    try {
      toolCall = this.store.createToolCall({
        runId: state.runId,
        toolName: invocation.name,
        idempotencyKey,
        status: 'proposed',
        argsHash: hashArgs(invocation.args),
        args: invocation.args,
      })
    } catch (error) {
      return { status: 'failed', error: error instanceof Error ? error.message : '工具调用记录失败' }
    }
    // Policy remains authoritative. A plan grant can only narrow the
    // require_approval path for scoped write_file calls; it never overrides deny,
    // process, Git-write or external Runtime approvals.
    const grantDecision =
      policy.decision === 'require_approval' && this.planGrants
        ? this.planGrants.authorizeToolCall({
            projectId: state.projectId,
            workspaceRoot: state.workspaceRoot,
            taskId: state.taskId,
            runId: state.runId,
            agentId: state.agentId,
            toolName: invocation.name,
            toolCallId: toolCall.id,
            args: invocation.args,
          })
        : null
    const effectiveDecision =
      grantDecision?.decision === 'allow'
        ? 'plan-grant'
        : grantDecision?.decision === 'deny'
          ? 'deny'
          : policy.decision
    this.store.appendRunStep({
      runId: state.runId,
      kind: 'tool_request',
      title: `工具请求：${invocation.name}`,
      payload: {
        toolCallId: toolCall.id,
        callId: invocation.callId,
        name: invocation.name,
        args: redactObject(invocation.args),
        risk: policy.risk,
        policy: effectiveDecision,
        grantId: grantDecision?.grantId ?? null,
        grantReason: grantDecision?.reason ?? null,
      },
    })
    if (policy.decision === 'deny' || grantDecision?.decision === 'deny') {
      const reason = grantDecision?.reason ?? policy.reason
      this.store.updateToolCall(toolCall.id, { status: 'denied', error: reason })
      this.store.appendRunStep({
        runId: state.runId,
        kind: 'tool_result',
        title: `工具被拒绝：${invocation.name}`,
        payload: { callId: invocation.callId, name: invocation.name, ok: false, content: JSON.stringify({ error: reason }) },
      })
      this.store.appendEvent(state.projectId, state.runId, PROJECT_EVENT_TYPES.toolFailed, {
        runId: state.runId,
        toolName: invocation.name,
        error: reason,
        grantId: grantDecision?.grantId ?? null,
      })
      return { status: 'denied', error: reason }
    }
    if (policy.decision === 'require_approval' && grantDecision?.decision !== 'allow') {
      this.store.updateToolCall(toolCall.id, { status: 'waiting_approval' })
      // Capture the trusted file baseline BEFORE the approver sees anything, so the
      // approved snapshot cannot be re-pointed at different content later. Path scope
      // stays the policy layer's job: if a snapshot cannot be taken we still request
      // approval, and record that the approval carries no trusted baseline.
      let writePlan = null as ReturnType<typeof planWriteSnapshot>
      let snapshotSkipReason: string | null = null
      if (invocation.name === 'write_file') {
        try {
          writePlan = planWriteSnapshot(state.workspaceRoot, invocation.args)
          if (!writePlan) snapshotSkipReason = '工具参数缺少 path/content'
        } catch (error) {
          snapshotSkipReason = error instanceof Error ? error.message : String(error)
        }
      }
      const approval = this.store.createApproval({
        projectId: state.projectId,
        runId: state.runId,
        toolCallId: toolCall.id,
        title: `授权 ${invocation.name}`,
        detail: approvalDetail(invocation),
        request: {
          toolName: invocation.name,
          args: redactObject(invocation.args),
          risk: policy.risk,
          reason: policy.reason,
          grantId: grantDecision?.grantId ?? null,
          grantReason: grantDecision?.reason ?? null,
          ...(writePlan ? { fileSnapshot: writePlan.summary } : {}),
          ...(snapshotSkipReason ? { fileSnapshotSkipped: snapshotSkipReason } : {}),
        },
        expiresAt: now() + 30 * 60 * 1000,
      })
      if (writePlan) {
        try {
          persistWriteSnapshot(this.store, approval.id, state.workspaceRoot, writePlan)
        } catch (error) {
          this.store.appendEvent(state.projectId, state.runId, PROJECT_EVENT_TYPES.approvalRequested, {
            approvalId: approval.id,
            snapshotPersistFailed: error instanceof Error ? error.message : String(error),
          })
        }
      }
      state.pendingApprovalId = approval.id
      this.transitionRun(state, 'waiting_approval')
      this.store.appendRunStep({
        runId: state.runId,
        kind: 'approval',
        title: `等待授权：${invocation.name}`,
        status: 'waiting',
        payload: { approvalId: approval.id, toolCallId: toolCall.id, toolName: invocation.name },
      })
      this.store.appendEvent(state.projectId, state.runId, PROJECT_EVENT_TYPES.approvalRequested, {
        approvalId: approval.id,
        runId: state.runId,
        sessionId: state.sessionId,
        toolName: invocation.name,
        taskId: state.taskId,
        grantId: grantDecision?.grantId ?? null,
      })
      return { status: 'paused', approvalId: approval.id }
    }
    this.store.updateToolCall(toolCall.id, { status: 'running', startedAt: now() })
    try {
      const result = await this.executeToolHandler(state, invocation)
      this.store.updateToolCall(toolCall.id, {
        status: 'completed',
        result,
        finishedAt: now(),
      })
      this.store.appendEvent(state.projectId, state.runId, PROJECT_EVENT_TYPES.toolCompleted, {
        runId: state.runId,
        toolName: invocation.name,
        toolCallId: toolCall.id,
      })
      return { status: 'completed', result }
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 8000)
      this.store.updateToolCall(toolCall.id, {
        status: 'failed',
        error: message,
        finishedAt: now(),
      })
      this.store.appendEvent(state.projectId, state.runId, PROJECT_EVENT_TYPES.toolFailed, {
        runId: state.runId,
        toolName: invocation.name,
        toolCallId: toolCall.id,
        error: message,
      })
      return { status: 'failed', error: message }
    }
  }

  private async executeToolHandler(state: ActiveRun, invocation: ToolInvocation): Promise<unknown> {
    const project = this.store.read.getProject(state.projectId)
    const session = this.store.read.getSession(state.sessionId)
    const agent = this.store.read.getAgent(state.agentId)
    if (!project || !session || !agent) throw new AppError('NOT_FOUND', '运行上下文已失效')
    const definition = getToolDefinition(invocation.name)
    if (!definition) throw new AppError('NOT_FOUND', `未知工具：${invocation.name}`)
    const actor = { kind: 'agent' as const, id: agent.id, name: agent.name }
    const args = invocation.args
    const taskId =
      typeof args.taskId === 'string' && args.taskId
        ? args.taskId
        : state.taskId
    if (invocation.name === 'update_task_status' || invocation.name === 'handoff_task') {
      if (!taskId) throw new AppError('POLICY_DENIED', '当前运行没有关联任务，无法执行协调操作')
      const target = this.store.read.getTask(taskId)
      if (!target) throw new AppError('POLICY_DENIED', '协调工具目标任务不存在')
      assertCoordinatedTaskScope({
        action: invocation.name === 'handoff_task' ? 'handoff' : 'update',
        projectId: project.id,
        agentId: agent.id,
        runTaskId: state.taskId,
        target,
      })
    }
    switch (invocation.name) {
      case 'list_directory': {
        const subPath = typeof args.path === 'string' ? args.path.replace(/^\.\/?/, '').replace(/\/$/, '') : ''
        const entries = readWorkspaceTree(state.workspaceRoot, { maxDepth: 5, maxEntries: 500 })
        const filtered = subPath
          ? entries.filter((entry) => entry.path === subPath || entry.path.startsWith(`${subPath}/`))
          : entries
        return {
          root: state.workspaceRoot,
          entries: filtered.slice(0, 300).map((entry) => `${entry.type === 'directory' ? '📁' : '📄'} ${entry.path}`),
          truncated: filtered.length > 300,
        }
      }
      case 'read_file': {
        const path = requiredString(args, 'path')
        return readTextFile(state.workspaceRoot, path)
      }
      case 'write_file': {
        const path = requiredString(args, 'path')
        const content = requiredString(args, 'content', { allowEmpty: true })
        const result = writeTextFile(state.workspaceRoot, path, content)
        return { ok: true, ...result }
      }
      case 'git_status':
        return await getGitStatus(state.workspaceRoot)
      case 'git_diff':
        return await getGitDiff(state.workspaceRoot, typeof args.path === 'string' ? args.path : undefined)
      case 'run_command': {
        const command = requiredString(args, 'command')
        const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 30_000
        return await runApprovedCommand(state.workspaceRoot, command, timeoutMs)
      }
      case 'run_tests': {
        const command = typeof args.command === 'string' && args.command.trim() ? args.command.trim() : 'pnpm test'
        return await runApprovedCommand(state.workspaceRoot, command, 120_000)
      }
      case 'list_tasks': {
        const tasks = this.store.read.listTasks(project.id)
        const filter = typeof args.status === 'string' ? args.status : null
        const filtered = filter ? tasks.filter((task) => task.status === filter) : tasks
        return filtered.slice(0, 100).map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          acceptanceCriteria: task.acceptanceCriteria,
        }))
      }
      case 'create_task': {
        const acceptance = stringArray(args, 'acceptanceCriteria')
        if (acceptance.length === 0) throw new AppError('BAD_REQUEST', '验收标准不能为空')
        const card = this.services.tasks.create(
          {
            projectId: project.id,
            title: requiredString(args, 'title'),
            description: typeof args.description === 'string' ? args.description : '',
            priority: priorityArg(args.priority),
            acceptanceCriteria: acceptance,
            labels: [],
            assigneeAgentId: typeof args.assigneeAgentId === 'string' ? args.assigneeAgentId : agent.id,
            milestoneId: null,
            dependsOn: Array.isArray(args.dependsOn) ? args.dependsOn.filter((value): value is string => typeof value === 'string') : [],
            dueAt: null,
          },
          actor,
        )
        return { taskId: card.id, title: card.title, status: card.status }
      }
      case 'update_task_status': {
        if (!taskId) throw new AppError('BAD_REQUEST', '当前运行没有关联任务')
        const task = this.store.read.getTask(taskId)
        if (!task) throw new AppError('NOT_FOUND', '任务不存在')
        const status = taskStatusArg(args.status)
        const note = typeof args.note === 'string' ? args.note : undefined
        if (status === 'done') {
          const card = this.store.read.getTaskCard(task.id)
          if (!card) throw new AppError('NOT_FOUND', '任务不存在')
          const artifacts = this.store.read.listArtifacts(project.id, task.id)
          const runs = this.store.read
            .listRunSummaries(project.id, 200)
            .filter((run) => run.taskId === task.id)
            .slice(0, 5)
            .map((run) => this.store.read.getRunDetail(run.id))
            .filter((detail): detail is NonNullable<typeof detail> => Boolean(detail))
          const decision = evaluateCompletion({
            task: card,
            artifacts,
            runs,
            workspaceRoot: state.workspaceRoot,
            fileExists: (relativePath) => existsSync(join(state.workspaceRoot, relativePath)),
            actorKind: actor.kind,
            humanNote: note,
          })
          if (!decision.ok) {
            throw new AppError('CONFLICT', `任务缺少有效完成依据：${decision.reasons.join('；')}`, {
              details: decision,
            })
          }
          const completed = this.services.tasks.complete(
            { taskId: task.id, expectedVersion: task.version, note, decision },
            actor,
          )
          return { taskId: completed.id, status: completed.status }
        }
        const card = this.services.tasks.move(
          { taskId: task.id, to: status, expectedVersion: task.version, note },
          actor,
        )
        return { taskId: card.id, status: card.status }
      }
      case 'create_requirement': {
        const requirement = this.services.projects.createRequirement(
          {
            projectId: project.id,
            title: requiredString(args, 'title'),
            body: typeof args.body === 'string' ? args.body : '',
            acceptanceCriteria: Array.isArray(args.acceptanceCriteria)
              ? args.acceptanceCriteria.filter((value): value is string => typeof value === 'string')
              : [],
            source: 'agent',
          },
          actor,
        )
        return { requirementId: requirement.id, title: requirement.title }
      }
      case 'create_milestone': {
        const milestone = this.services.projects.createMilestone(
          {
            projectId: project.id,
            title: requiredString(args, 'title'),
            description: typeof args.description === 'string' ? args.description : '',
            dueAt: typeof args.dueAt === 'number' ? args.dueAt : null,
          },
          actor,
        )
        return { milestoneId: milestone.id, title: milestone.title }
      }
      case 'record_decision': {
        const status = args.status === 'accepted' ? 'accepted' : 'proposed'
        const decision = this.services.projects.createDecision(
          {
            projectId: project.id,
            title: requiredString(args, 'title'),
            body: typeof args.body === 'string' ? args.body : '',
            status,
          },
          actor,
        )
        return { decisionId: decision.id, title: decision.title, status: decision.status }
      }
      case 'create_artifact': {
        const kindArg = typeof args.kind === 'string' ? args.kind : 'document'
        const title = requiredString(args, 'title')
        const body = typeof args.body === 'string' ? args.body : ''
        const uri = typeof args.uri === 'string' ? args.uri : null
        const rawMetadata =
          args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)
            ? (args.metadata as Record<string, unknown>)
            : {}
        const artifact = this.services.projects.createArtifact(
          {
            projectId: project.id,
            taskId: state.taskId,
            runId: state.runId,
            kind: kindArg as Artifact['kind'],
            title,
            body,
            uri,
            metadata: normalizeReviewArtifactMetadata(rawMetadata, title, body, uri),
          },
          actor,
        )
        return { artifactId: artifact.id, title: artifact.title }
      }
      case 'search_knowledge': {
        const query = requiredString(args, 'query').toLowerCase()
        const entries = this.store.read.listKnowledge(project.id)
        return entries
          .filter((entry) => `${entry.title}\n${entry.body}`.toLowerCase().includes(query))
          .slice(0, 8)
          .map((entry) => ({ id: entry.id, title: entry.title, body: entry.body.slice(0, 4000) }))
      }
      case 'list_collaborators': {
        const includeSelf = args.includeSelf !== false
        const collaborators = this.services.collaboration
          .listCollaborators(project.id, agent.id)
          .filter((item) => includeSelf || !item.isSelf)
        return { collaborators }
      }
      case 'send_agent_message': {
        const toSessionId = typeof args.toSessionId === 'string' && args.toSessionId ? args.toSessionId : null
        const toAgentId = typeof args.toAgentId === 'string' && args.toAgentId ? args.toAgentId : null
        if (!toSessionId && !toAgentId) throw new AppError('BAD_REQUEST', '需要提供 toAgentId 或 toSessionId')
        let targetSession = toSessionId
          ? this.services.sessions.list(project.id).find((item) => item.id === toSessionId) ?? null
          : null
        if (toSessionId && !targetSession) throw new AppError('NOT_FOUND', '接收方会话不存在')
        if (toAgentId) {
          if (!this.store.read.isAgentVisibleToProject(project.id, toAgentId)) {
            throw new AppError('CONFLICT', '接收方 Agent 不在当前项目可见范围')
          }
          const targetAgent = this.store.read.getAgent(toAgentId)
          if (!targetAgent) throw new AppError('NOT_FOUND', '接收方 Agent 不存在')
          if (targetSession && targetSession.agentId !== toAgentId) {
            throw new AppError('BAD_REQUEST', 'toSessionId 与 toAgentId 指向不同 Agent')
          }
          if (!targetSession) {
            if (toAgentId === state.agentId) throw new AppError('BAD_REQUEST', '不能向当前 Agent 自身委派')
            targetSession =
              this.services.sessions.list(project.id).find(
                (item) =>
                  item.agentId === toAgentId &&
                  item.status !== 'archived' &&
                  !item.title.startsWith('计划群聊 ·'),
              ) ??
              this.services.sessions.create(
                { projectId: project.id, agentId: toAgentId, title: `协作 · ${targetAgent.name}` },
                actor,
              )
          }
        }
        if (!targetSession) throw new AppError('BAD_REQUEST', '无法解析接收方会话')
        const result = this.services.collaboration.send(
          {
            projectId: project.id,
            fromSessionId: session.id,
            toSessionId: targetSession.id,
            type: (typeof args.type === 'string' ? args.type : 'agent.message') as never,
            body: requiredString(args, 'body'),
            taskId: state.taskId,
            wake: true,
          },
          actor,
        )
        if (result.created) {
          void this.wakeInbox(result.inbox.id).catch((error) => {
            this.logger.warn({ err: error, inboxId: result.inbox.id }, 'agent message delivered but recipient wake failed')
          })
        }
        return { inboxId: result.inbox.id, status: result.inbox.status, created: result.created, woke: result.created }
      }
      case 'handoff_task': {
        if (!taskId) throw new AppError('BAD_REQUEST', '当前运行没有关联任务，无法交接')
        const riskLevel =
          args.riskLevel === 'low' || args.riskLevel === 'high' || args.riskLevel === 'medium'
            ? args.riskLevel
            : 'medium'
        const handoff = this.services.collaboration.requestHandoff(
          {
            taskId,
            toAgentId: requiredString(args, 'toAgentId'),
            summary: requiredString(args, 'summary'),
            sessionId: session.id,
            completed: stringArray(args, 'completed'),
            remaining: stringArray(args, 'remaining'),
            risks: stringArray(args, 'risks'),
            nextActions: stringArray(args, 'nextActions'),
            artifactRefs: stringArray(args, 'artifactRefs'),
            riskLevel,
          },
          actor,
        )
        return {
          handoffId: handoff.id,
          status: handoff.status,
          toAgentName: handoff.toAgentName,
          sourceRunId: handoff.sourceRunId,
          autoAccepted: handoff.status === 'accepted',
        }
      }
      default:
        throw new AppError('NOT_IMPLEMENTED', `工具尚未实现：${invocation.name}`)
    }
  }

  async decideApproval(
    approvalId: string,
    decision: 'approved' | 'rejected',
    note = '',
  ): Promise<Approval> {
    const approval = this.store.getApprovalById(approvalId)
    if (!approval) throw new AppError('NOT_FOUND', '授权请求不存在')
    if (approval.status !== 'pending') throw new AppError('CONFLICT', '授权请求已被处理')
    const run = this.store.read.getRun(approval.runId)
    if (!run) throw new AppError('NOT_FOUND', '运行不存在')
    const toolCall = approval.toolCallId
      ? this.store.read.getToolCalls(run.id).find((call) => call.id === approval.toolCallId) ?? null
      : null
    const acpPermission = this.isAcpPermission(approval.request)
    const runtimeApproval = this.isRuntimeApproval(approval.request)
    if (approval.expiresAt && approval.expiresAt <= now()) {
      if (acpPermission || runtimeApproval) this.resolvePendingPermissions(run.id, null)
      const activeState = this.active.get(run.id)
      const terminal = isTerminalRunStatus(run.status)
      this.store.transaction(() => {
        this.store.expireApproval(approvalId, '审批已过期，操作未执行')
        if (toolCall) {
          this.store.updateToolCall(toolCall.id, {
            status: 'denied',
            error: '审批已过期，操作未执行',
            finishedAt: now(),
          })
        }
        if (!terminal) {
          this.store.updateRun(run.id, {
            status: 'failed',
            error: '审批已过期，操作未执行',
            finishedAt: now(),
          })
          this.store.appendEvent(run.projectId, run.id, PROJECT_EVENT_TYPES.runStatusChanged, {
            status: 'failed',
            runId: run.id,
            sessionId: run.sessionId,
          })
          this.store.updateTaskAttemptStatus(run.id, 'failed')
        }
        this.store.appendEvent(run.projectId, approvalId, PROJECT_EVENT_TYPES.approvalDecided, {
          decision: 'expired',
          runId: run.id,
          sessionId: run.sessionId,
        })
      })
      this.tryMoveTask(run.taskId, 'blocked', '审批已过期，运行未继续')
      if (activeState) this.cleanup(activeState, 'failed')
      else if (run.taskId) {
        const lease = this.store.read.getTaskLease(run.taskId)
        if (lease && lease.holderId === `run:${run.id}`) {
          this.releaseRunLease(run.taskId, run.id, { token: lease.fencingToken })
        }
      }
      throw new AppError('CONFLICT', '该授权请求已过期，操作未执行')
    }
    if (decision === 'approved' && !acpPermission && !runtimeApproval && !this.provider.isConfigured()) {
      throw new AppError(
        'PROVIDER_NOT_CONFIGURED',
        '模型 Provider 尚未配置，无法在批准后继续运行。请先配置模型，或拒绝该授权。',
      )
    }
    if (decision === 'approved') this.assertRunLease(run)
    // Re-verify the trusted snapshot at decision time: if the workspace moved after
    // the approval was requested, the approval no longer describes what would be written.
    if (decision === 'approved') {
      // Use the same root the snapshot was captured against (the active run's
      // workspace), falling back to the project root for recovered runs.
      const projectRoot = this.active.get(run.id)?.workspaceRoot
        ?? this.store.read.getProject(run.projectId)?.rootPath
        ?? process.cwd()
      try {
        assertApprovalSnapshotValid(this.store, approvalId, projectRoot)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.store.transaction(() => {
          this.store.expireApproval(approvalId, message)
          if (toolCall) {
            this.store.updateToolCall(toolCall.id, { status: 'denied', error: message, finishedAt: now() })
          }
          this.store.appendEvent(run.projectId, approvalId, PROJECT_EVENT_TYPES.approvalDecided, {
            decision: 'expired',
            runId: run.id,
            sessionId: run.sessionId,
            reason: 'snapshot_drift',
          })
        })
        throw new AppError('CONFLICT', message)
      }
    }
    if (decision === 'rejected' && !this.provider.isConfigured()) {
      const activeState = this.active.get(run.id)
      const decided = this.store.transaction(() => {
        const value = this.store.decideApproval(approvalId, decision, note || '用户拒绝了该操作')
        this.store.appendEvent(run.projectId, approvalId, PROJECT_EVENT_TYPES.approvalDecided, {
          decision,
          runId: run.id,
          sessionId: run.sessionId,
        })
        if (toolCall) {
          this.store.updateToolCall(toolCall.id, {
            status: 'denied',
            error: note || '用户拒绝了该操作',
            finishedAt: now(),
          })
          this.store.appendRunStep({
            runId: run.id,
            kind: 'tool_result',
            title: `用户拒绝：${toolCall.toolName}`,
            payload: {
              callId: toolCall.idempotencyKey.split(':').pop() ?? toolCall.id,
              name: toolCall.toolName,
              ok: false,
              content: JSON.stringify({ ok: false, error: note || '用户拒绝了该操作', denied: true }),
            },
          })
        }
        this.store.updateRun(run.id, {
          status: 'cancelled',
          error: '用户拒绝了工具调用；模型 Provider 未配置，运行未继续。',
          finishedAt: now(),
        })
        this.store.appendEvent(run.projectId, run.id, PROJECT_EVENT_TYPES.runStatusChanged, {
          status: 'cancelled',
          runId: run.id,
          sessionId: run.sessionId,
        })
        return value
      })
      this.tryMoveTask(run.taskId, 'ready')
      this.store.updateTaskAttemptStatus(run.id, 'cancelled')
      if (activeState) this.cleanup(activeState, 'cancelled')
      return decided
    }
    const updated = this.store.transaction(() => {
      const decided = this.store.decideApproval(approvalId, decision, note)
      this.store.appendEvent(run.projectId, approvalId, PROJECT_EVENT_TYPES.approvalDecided, {
        decision,
        runId: run.id,
        sessionId: run.sessionId,
      })
      return decided
    })
    // Remember an explicit human approval for this exact command so identical repeats in
    // the same plan do not ask again. The command text itself is the key; any change
    // requires a new decision.
    if (decision === 'approved' && this.planGrants && toolCall) {
      const request = (approval.request ?? {}) as Record<string, unknown>
      const args = (request.args ?? {}) as Record<string, unknown>
      const toolName = String(request.toolName ?? toolCall.toolName)
      const command = typeof args.command === 'string' ? args.command : ''
      if (command) {
        try {
          this.planGrants.recordApprovedCommandForTask({
            projectId: run.projectId,
            taskId: run.taskId,
            agentId: run.agentId,
            toolName,
            command,
            approvalId,
          })
        } catch (error) {
          void error
        }
      }
    }
    if (acpPermission) {
      return this.decideAcpPermission(approval, run, toolCall, decision, updated)
    }
    if (runtimeApproval) {
      return this.decideRuntimeApproval(approval, run, toolCall, decision, updated)
    }
    if (!toolCall) {
      await this.failRun(await this.requireState(run.id), '授权关联的工具调用不存在')
      return updated
    }
    const state = await this.requireState(run.id)
    if (decision === 'rejected') {
      this.store.updateToolCall(toolCall.id, {
        status: 'denied',
        error: note || '用户拒绝了该操作',
        finishedAt: now(),
      })
      const step = this.store.appendRunStep({
        runId: run.id,
        kind: 'tool_result',
        title: `用户拒绝：${toolCall.toolName}`,
        payload: {
          callId: toolCall.idempotencyKey.split(':').pop() ?? toolCall.id,
          name: toolCall.toolName,
          ok: false,
          content: JSON.stringify({ ok: false, error: note || '用户拒绝了该操作', denied: true }),
        },
      })
      this.hub.publish({ type: 'run.step', projectId: run.projectId, runId: run.id, stepId: step.id, kind: 'tool_result' })
      this.transitionRun(state, 'running')
      void this.execute(state).catch((error) => this.failRun(state, String(error)))
      return updated
    }
    this.assertLease(state)
    // The Run may have spent its wall-clock budget while waiting for this
    // approval. Re-check before executing the approved side effect.
    if (state.budget.maxWallClockMs > 0 && Date.now() >= state.budget.deadlineAt) {
      this.store.updateToolCall(toolCall.id, {
        status: 'denied',
        error: '运行已超出墙钟上限，工具未执行',
        finishedAt: now(),
      })
      await this.terminateRun(
        run.id,
        'timed_out',
        'wall_clock_timeout',
        '审批等待期间运行超出墙钟上限，工具未执行',
      )
      return updated
    }
    if (this.remainingToolCalls(state) <= 0) {
      this.store.updateToolCall(toolCall.id, {
        status: 'denied',
        error: '工具调用预算已耗尽，工具未执行',
        finishedAt: now(),
      })
      await this.terminateRun(
        run.id,
        'budget_exhausted',
        'tool_budget_exhausted',
        '工具调用预算已耗尽，审批后的工具未执行',
      )
      return updated
    }
    state.pendingApprovalId = null
    this.transitionRun(state, 'running')
    // Final gate right before the side effect: the snapshot must still be valid.
    {
      const projectRoot = this.store.read.getProject(run.projectId)?.rootPath ?? state.workspaceRoot
      assertApprovalSnapshotValid(this.store, approvalId, projectRoot)
    }
    this.store.updateToolCall(toolCall.id, { status: 'running', startedAt: now() })
    let outcome: ToolOutcome
    try {
      const invocation: ToolInvocation = {
        callId: toolCall.idempotencyKey.split(':').pop() ?? toolCall.id,
        name: toolCall.toolName,
        args: toolCall.args,
        rawArguments: JSON.stringify(toolCall.args),
      }
      const result = await this.executeToolHandler(state, invocation)
      this.store.updateToolCall(toolCall.id, { status: 'completed', result, finishedAt: now() })
      outcome = { status: 'completed', result }
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 8000)
      this.store.updateToolCall(toolCall.id, { status: 'failed', error: message, finishedAt: now() })
      outcome = { status: 'failed', error: message }
    }
    await this.onToolResult(state, {
      callId: toolCall.idempotencyKey.split(':').pop() ?? toolCall.id,
      name: toolCall.toolName,
      args: toolCall.args,
      rawArguments: '',
    }, outcome)
    void this.execute(state).catch((error) => this.failRun(state, String(error)))
    return updated
  }

  private decideRuntimeApproval(
    approval: Approval,
    run: Run,
    toolCall: ToolCall | null,
    decision: 'approved' | 'rejected',
    updated: Approval,
  ): Approval {
    const pending = this.pendingRuntimeApprovals.get(approval.id)
    if (!pending) {
      if (toolCall) {
        this.store.updateToolCall(toolCall.id, {
          status: 'denied',
          error: 'Runtime 已退出，授权无法恢复',
          finishedAt: now(),
        })
      }
      if (!isTerminalRunStatus(run.status)) {
        this.store.updateRun(run.id, {
          status: 'failed',
          error: 'Runtime 已退出，授权无法恢复；请人工核对后重新运行',
          finishedAt: now(),
        })
        this.store.appendEvent(run.projectId, run.id, PROJECT_EVENT_TYPES.runStatusChanged, {
          status: 'failed',
          runId: run.id,
          sessionId: run.sessionId,
        })
        this.store.updateTaskAttemptStatus(run.id, 'failed')
      }
      this.tryMoveTask(run.taskId, 'blocked', 'Runtime 授权已失效')
      const active = this.active.get(run.id)
      if (active) this.cleanup(active, 'failed')
      throw new AppError('CONFLICT', '该 Runtime 授权已随进程退出失效，未执行操作')
    }
    if (toolCall) {
      this.store.updateToolCall(
        toolCall.id,
        decision === 'approved'
          ? { status: 'running', finishedAt: null }
          : { status: 'denied', error: '用户拒绝了 Runtime 执行', finishedAt: now() },
      )
    }
    pending.state.pendingApprovalId = null
    this.transitionRun(pending.state, 'running')
    pending.resolve(decision === 'approved')
    this.pendingRuntimeApprovals.delete(approval.id)
    return updated
  }

  private decideAcpPermission(
    approval: Approval,
    run: Run,
    toolCall: ToolCall | null,
    decision: 'approved' | 'rejected',
    updated: Approval,
  ): Approval {
    const pending = this.pendingPermissions.get(approval.id)
    if (!pending) {
      if (toolCall) {
        this.store.updateToolCall(toolCall.id, {
          status: 'denied',
          error: 'ACP Runtime 已退出，授权无法恢复',
          finishedAt: now(),
        })
      }
      if (!isTerminalRunStatus(run.status)) {
        this.store.updateRun(run.id, {
          status: 'failed',
          error: 'ACP Runtime 已退出，授权无法恢复；请人工核对后重新运行',
          finishedAt: now(),
        })
        this.store.appendEvent(run.projectId, run.id, PROJECT_EVENT_TYPES.runStatusChanged, {
          status: 'failed',
          runId: run.id,
          sessionId: run.sessionId,
        })
        this.store.updateTaskAttemptStatus(run.id, 'failed')
      }
      this.tryMoveTask(run.taskId, 'blocked', 'ACP 授权已失效')
      const active = this.active.get(run.id)
      if (active) this.cleanup(active, 'failed')
      throw new AppError('CONFLICT', '该 ACP 授权已随 Runtime 退出失效，未执行操作')
    }
    if (toolCall) {
      this.store.updateToolCall(toolCall.id, decision === 'approved'
        ? { status: 'completed', result: { approved: true, optionId: pending.optionId }, finishedAt: now() }
        : { status: 'denied', error: '用户拒绝了 ACP 权限请求', finishedAt: now() })
    }
    pending.state.pendingApprovalId = null
    this.transitionRun(pending.state, 'running')
    pending.resolve(decision === 'approved' ? pending.optionId : null)
    this.pendingPermissions.delete(approval.id)
    return updated
  }

  private async requireState(runId: string): Promise<ActiveRun> {
    const existing = this.active.get(runId)
    if (existing) return existing
    const run = this.store.read.getRun(runId)
    if (!run) throw new AppError('NOT_FOUND', '运行不存在')
    const agent = this.store.read.getAgent(run.agentId)
    const definition = agent ? this.store.read.getAgentDefinition(agent.id) : null
    const routed = agent
      ? this.aiConnections?.resolveForRun({
          projectId: run.projectId,
          agentId: agent.id,
          agentRole: agent.role,
          taskId: run.taskId,
          modelRef: definition?.modelRef ?? null,
        }, Object.fromEntries(this.activeConnections)) ?? null
      : null
    const provider = this.provider.createProvider(routed?.connectionId, routed?.modelId)
    const project = this.store.read.getProject(run.projectId)
    const task = run.taskId ? this.store.read.getTask(run.taskId) : null
    let snapshot = this.store.read.getRunSnapshot(runId)
    if (!snapshot && agent) {
      const profiles = this.store.read.listRuntimeProfiles()
      const profileId = definition
        ? definition.primaryRuntimeProfileId ?? definition.runtimeProfileIds[0] ?? null
        : null
      const runtimeProfile = profileId ? profiles.find((profile) => profile.id === profileId) ?? null : null
      snapshot = this.buildRunSnapshot({
        runId,
        agent,
        definition,
        runtimeProfile,
        task,
        routed,
        createdAt: run.createdAt,
      })
      this.store.createRunSnapshot(snapshot)
    }
    if (!snapshot) throw new AppError('NOT_FOUND', '运行快照不存在')
    const workspaceStep = this.store.read
      .getRunSteps(run.id)
      .find((step) => typeof step.payload.workspaceRoot === 'string')
    const workspaceRoot =
      (workspaceStep?.payload.workspaceRoot as string | undefined) ?? project?.rootPath ?? process.cwd()
    const storedLease = run.taskId ? this.store.read.getTaskLease(run.taskId) : null
    const lease =
      storedLease && storedLease.holderId === `run:${runId}` && storedLease.expiresAt > now()
        ? { token: storedLease.fencingToken, expiresAt: storedLease.expiresAt }
        : null
    if (!agent) throw new AppError('NOT_FOUND', 'Agent 不存在')
    let storedSlot = this.store.getAgentExecutionSlot(agent.id)
    if (!storedSlot || storedSlot.runId !== runId || storedSlot.expiresAt <= now()) {
      const acquired = this.store.acquireAgentExecutionSlot(agent.id, runId, this.limits.agentSlotTtlMs)
      storedSlot = { runId, token: acquired.token, expiresAt: acquired.expiresAt }
    }
    const slot = { token: storedSlot.token, expiresAt: storedSlot.expiresAt }
    const budget = this.budgetForRun(run)
    const state: ActiveRun = {
      runId,
      projectId: run.projectId,
      sessionId: run.sessionId,
      agentId: run.agentId,
      taskId: run.taskId,
      workspaceRoot,
      snapshot,
      provider,
      connectionId: routed?.connectionId ?? null,
      modelId: routed?.modelId ?? null,
      abort: new AbortController(),
      lease,
      slot,
      budget,
      attemptNo: run.attempt,
      inboxId: null,
      promptMessageId: this.findPromptMessageId(run),
      promptOverride: null,
      busy: false,
      checkpointSeq: 0,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      lastAssistantText: run.summary ?? '',
      textStepId: null,
      textBuffer: '',
      lastTextFlushAt: 0,
      pendingApprovalId: null,
      leaseTimer: null,
      deadlineTimer: null,
      startedAt: run.startedAt ?? run.createdAt,
      runtimeCancel: null,
    }
    this.active.set(runId, state)
    this.sessionIndex.set(run.sessionId, runId)
    if (state.connectionId) {
      this.activeConnections.set(state.connectionId, (this.activeConnections.get(state.connectionId) ?? 0) + 1)
    }
    this.armDeadline(state)
    if (lease || slot) {
      state.leaseTimer = setInterval(() => {
        try {
          if (lease && run.taskId) {
            this.store.renewTaskLease(run.taskId, `run:${runId}`, lease.token, this.limits.taskLeaseTtlMs)
            lease.expiresAt = now() + this.limits.taskLeaseTtlMs
          }
          if (state.slot) {
            this.store.renewAgentExecutionSlot(agent.id, runId, state.slot.token, this.limits.agentSlotTtlMs)
            state.slot.expiresAt = now() + this.limits.agentSlotTtlMs
          }
        } catch (error) {
          this.handleLeaseLoss(state, error)
        }
      }, 120_000)
      state.leaseTimer.unref?.()
    }
    return state
  }

  /**
   * Budget for a Run resumed after a restart. The persisted snapshot wins; for
   * legacy rows the counters are reconstructed from the Run's own tool results
   * so a restart cannot reset the budget silently.
   */
  private budgetForRun(run: Run): ExecBudget {
    const persisted = run.budget
    const startedAt = run.startedAt ?? run.createdAt
    const toolResults = this.store.read
      .getRunSteps(run.id)
      .filter((step) => step.kind === 'tool_result').length
    const finalTurns = this.store.read
      .getRunSteps(run.id)
      .filter((step) => step.kind === 'text' && step.payload.final === true).length
    return {
      maxWallClockMs: persisted?.maxWallClockMs ?? this.limits.runWallClockMs,
      maxSteps: persisted?.maxSteps ?? this.limits.maxAgentSteps,
      maxToolCalls: persisted?.maxToolCalls ?? this.limits.maxToolCalls,
      stepsUsed: persisted?.stepsUsed ?? finalTurns,
      toolCallsUsed: persisted?.toolCallsUsed ?? toolResults,
      deadlineAt: run.deadlineAt ?? startedAt + (persisted?.maxWallClockMs ?? this.limits.runWallClockMs),
    }
  }

  private findPromptMessageId(run: Run): string {
    const steps = this.store.read.getRunSteps(run.id)
    for (const step of steps) {
      if (typeof step.payload.promptMessageId === 'string') return step.payload.promptMessageId
    }
    const messages = this.store.read.getMessages(run.sessionId, 400)
    const candidate = [...messages].reverse().find((message) => message.role === 'user' && message.createdAt <= run.createdAt)
    return candidate?.id ?? ''
  }

  async cancel(runId: string): Promise<void> {
    const state = this.active.get(runId)
    if (state) {
      state.abort.abort()
      state.runtimeCancel?.()
      const run = this.store.read.getRun(runId)
      if (run && (run.status === 'waiting_approval' || run.status === 'running')) {
        if (run.status === 'waiting_approval') {
          this.store.cancelPendingApprovals(runId, '用户取消了运行')
        }
        this.transitionRun(state, 'cancelled', { error: '用户取消了运行', finishedAt: now() })
        this.tryMoveTask(state.taskId, 'ready')
        this.store.updateTaskAttemptStatus(runId, 'cancelled')
        this.cleanup(state, 'cancelled')
      }
      return
    }
    const run = this.store.read.getRun(runId)
    if (!run) throw new AppError('NOT_FOUND', '运行不存在')
    if (isTerminalRunStatus(run.status)) return
    this.store.cancelPendingApprovals(runId, '用户取消了运行')
    this.resolvePendingPermissions(runId, null)
    this.store.updateRun(runId, { status: 'cancelled', error: '用户取消了运行', finishedAt: now() })
    this.store.appendEvent(run.projectId, runId, PROJECT_EVENT_TYPES.runStatusChanged, {
      status: 'cancelled',
      runId,
      sessionId: run.sessionId,
    })
    this.tryMoveTask(run.taskId, 'ready')
    this.store.updateTaskAttemptStatus(runId, 'cancelled')
    this.store.releaseAgentExecutionSlotForRun(runId)
  }

  /**
   * Human reconciliation of a run whose external side effects are unknown.
   * History is preserved: the original status/error is written into a RunStep
   * and an Artifact, never overwritten or deleted.
   */
  async reconcileRun(
    runId: string,
    decision: 'completed' | 'retry' | 'failed',
    note = '',
  ): Promise<Run> {
    const run = this.store.read.getRun(runId)
    if (!run) throw new AppError('NOT_FOUND', '运行不存在')
    if (run.status !== 'needs_reconciliation') {
      throw new AppError('CONFLICT', '只有 needs_reconciliation 运行可以人工核对')
    }
    const target = decision === 'completed' ? 'completed' : 'failed'
    assertRunTransition(run.status, target)
    const task = run.taskId ? this.store.read.getTask(run.taskId) : null
    const originalError = run.error
    const actor = { kind: 'user' as const, id: 'local-user', name: '你' }
    this.store.transaction(() => {
      this.store.appendRunStep({
        runId,
        kind: 'status',
        title: '人工核对',
        payload: {
          decision,
          note,
          originalStatus: run.status,
          originalError,
        },
      })
      this.store.updateRun(runId, {
        status: target,
        error: decision === 'completed' ? null : `${originalError ?? '运行中断'}${note ? `；人工说明：${note}` : ''}`,
        summary: run.summary,
        finishedAt: now(),
      })
      this.store.updateTaskAttemptStatus(runId, decision === 'completed' ? 'completed' : 'failed')
      if (task) {
        this.store.createArtifact(
          createArtifactRecord({
            projectId: run.projectId,
            taskId: task.id,
            runId,
            kind: 'document',
            title: `人工核对记录 · ${task.title}`,
            verified: decision === 'completed',
            body: [
              `决策：${decision}`,
              `原运行状态：${run.status}`,
              `原运行错误：${originalError ?? '—'}`,
              `核对说明：${note || '—'}`,
              '历史 Run、ToolCall、RunStep 均保留。',
            ].join('\n'),
          }),
        )
      }
      this.store.appendEvent(run.projectId, runId, PROJECT_EVENT_TYPES.runReconciled, {
        decision,
        note,
        taskId: run.taskId,
        originalStatus: run.status,
        originalError,
        actorName: actor.name,
      })
    })
    if (task) {
      this.releaseStoredLease(run)
      this.store.releaseAgentExecutionSlotForRun(runId)
      this.moveTaskAfterReconcile(task.id, decision)
    }
    const updated = this.store.read.getRun(runId)
    if (!updated) throw new AppError('INTERNAL', '运行核对后不存在')
    return updated
  }

  private moveTaskAfterReconcile(taskId: string, decision: 'completed' | 'retry' | 'failed'): void {
    const actor = { kind: 'user' as const, id: 'local-user', name: '你' }
    const current = () => this.store.read.getTask(taskId)
    const move = (to: 'ready' | 'running' | 'review' | 'blocked'): void => {
      const task = current()
      if (!task || task.status === to || task.status === 'done' || task.status === 'cancelled') return
      try {
        this.services.tasks.move(
          { taskId, expectedVersion: task.version, to, note: `人工核对：${decision}` },
          actor,
        )
      } catch (error) {
        this.logger.warn({ err: error, taskId, to, decision }, 'failed to move task after reconcile')
      }
    }
    if (decision === 'completed') {
      if (current()?.status === 'review') return
      move('ready')
      move('running')
      move('review')
    } else if (decision === 'retry') {
      if (current()?.status === 'review') move('blocked')
      move('ready')
    } else {
      move('blocked')
    }
  }

  /**
   * Persistent inbox retry: delivered items that were never accepted are retried
   * with a bounded attempt count; stale items are marked failed instead of being
   * silently lost. Idempotency is enforced by agent_inbox.idempotency_key.
   */
  async retryPendingInbox(minAgeMs = 5_000): Promise<void> {
    if (!this.provider.isConfigured()) return
    const nowTs = now()
    for (const item of this.store.read.listStaleInbox(nowTs - 24 * 60 * 60 * 1000, 20)) {
      try {
        this.store.updateInboxStatus(item.id, 'failed', { error: '投递超时：24 小时内未唤醒接收方' })
      } catch (error) {
        this.logger.warn({ err: error, inboxId: item.id }, 'failed to expire stale inbox')
      }
    }
    for (const item of this.store.read.listDeliverableInbox(nowTs - minAgeMs, 3, 20)) {
      if (this.sessionIndex.has(item.recipientSessionId)) continue
      try {
        const result = await this.resumeInbox(item.id)
        if (!result.runId && result.warning) continue
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        try {
          const nextAttempt = item.attempts + 1
          const delay = Math.min(5 * 60_000, 5_000 * 2 ** item.attempts)
          this.store.updateInboxStatus(item.id, nextAttempt >= 3 ? 'failed' : 'delivered', {
            error: message,
            incrementAttempts: true,
            nextAttemptAt: now() + delay,
          })
        } catch (nested) {
          this.logger.warn({ err: nested, inboxId: item.id }, 'failed to record inbox retry')
        }
      }
    }
  }

  async resumeInbox(inboxId: string): Promise<{ runId: string | null; warning: string | null }> {
    if (!this.provider.isConfigured()) {
      return { runId: null, warning: '尚未配置模型 Provider，消息已持久化但无法唤醒 Agent' }
    }
    const item = this.store.read.getInbox(inboxId)
    if (!item) throw new AppError('NOT_FOUND', '收件箱条目不存在')
    if (item.status === 'completed') return { runId: null, warning: '该消息已处理完成' }
    const session = this.store.read.getSession(item.recipientSessionId)
    if (!session) throw new AppError('NOT_FOUND', '接收方会话不存在')
    if (this.sessionIndex.has(session.id)) {
      return { runId: null, warning: '接收方 Agent 正在运行，消息已排队' }
    }
    const message = this.store.getMessageById(item.messageId)
    if (!message) throw new AppError('NOT_FOUND', '消息不存在')
    // A message may reference the sender's task. The recipient must not take
    // over a task that is still leased/running by someone else; deliver the
    // message as a task-less collaboration turn instead.
    let taskId = item.envelope.taskId ?? null
    if (taskId) {
      const active = this.store.read.getActiveRunForTask(taskId)
      const lease = this.store.read.getTaskLease(taskId)
      if (active || (lease && lease.expiresAt > now())) taskId = null
    }
    const result = await this.startRun({
      projectId: item.projectId,
      sessionId: item.recipientSessionId,
      taskId,
      prompt: message.content,
      messageId: message.id,
      inboxId: item.id,
    })
    return { runId: result.runId, warning: null }
  }

  async wakeInbox(inboxId: string): Promise<{ runId: string | null; warning: string | null }> {
    return this.resumeInbox(inboxId)
  }

  private tryMoveTask(taskId: string | null, to: TaskStatus, note?: string): void {
    if (!taskId) return
    try {
      const task = this.store.read.getTask(taskId)
      if (!task || task.status === to) return
      if (to === 'review' && task.status !== 'running') return
      if (to === 'blocked' && task.status === 'done') return
      if (to === 'ready' && !['running', 'blocked'].includes(task.status)) return
      this.store.moveTask(task.id, task.version, to)
      this.store.appendEvent(task.projectId, task.id, PROJECT_EVENT_TYPES.taskMoved, {
        taskTitle: task.title,
        status: to,
        note: note ?? null,
        actorName: 'ProjectOS',
      })
    } catch (error) {
      this.logger.warn({ err: error, taskId, to }, 'failed to move task after run')
    }
  }

  recoverInterruptedRuns(): void {
    const interrupted = this.store.read.listUnfinishedRuns(200)
    for (const run of interrupted) {
      if (run.status === 'waiting_approval') {
        const pendingEphemeralApproval = this.store.read
          .listApprovalViews(null, run.id)
          .some((approval) => approval.status === 'pending' && this.isEphemeralApproval(approval.request))
        if (!pendingEphemeralApproval) {
          this.logger.info({ runId: run.id }, 'run is waiting for approval; keep it resumable')
          continue
        }
        // ACP/CLI approvals are held by a live child process; after a Runtime
        // restart there is no pending resolver to release them.
        try {
          this.store.transaction(() => {
            this.store.updateRun(run.id, {
              status: 'needs_reconciliation',
              error: 'Runtime 在授权期间退出，权限请求已失效；不会自动重试，请人工核对后重新运行。',
              finishedAt: now(),
            })
            this.store.appendEvent(run.projectId, run.id, PROJECT_EVENT_TYPES.runStatusChanged, {
              status: 'needs_reconciliation',
              runId: run.id,
              sessionId: run.sessionId,
            })
            this.store.cancelPendingApprovals(run.id, 'Runtime 重启，授权已失效')
            this.store.updateTaskAttemptStatus(run.id, 'needs_reconciliation')
            this.releaseStoredLease(run)
          })
          this.tryMoveTask(run.taskId, 'blocked', 'Runtime 重启，授权已失效')
          this.store.releaseAgentExecutionSlotForRun(run.id)
        } catch (error) {
          this.logger.warn({ err: error, runId: run.id }, 'failed to reconcile ACP approval after restart')
        }
        continue
      }
      try {
        this.store.transaction(() => {
          this.store.updateRun(run.id, {
            status: 'needs_reconciliation',
            error: 'Runtime 在执行期间退出，外部副作用状态未知；不会自动重试，请人工核对后重新运行。',
            finishedAt: now(),
          })
          this.store.appendEvent(run.projectId, run.id, PROJECT_EVENT_TYPES.runStatusChanged, {
            status: 'needs_reconciliation',
            runId: run.id,
            sessionId: run.sessionId,
          })
          this.store.cancelPendingApprovals(run.id, 'Runtime 重启，未完成审批已失效')
          this.store.updateTaskAttemptStatus(run.id, 'needs_reconciliation')
          this.releaseStoredLease(run)
        })
        this.tryMoveTask(run.taskId, 'blocked', 'Runtime 重启，执行状态待人工核对')
        this.store.releaseAgentExecutionSlotForRun(run.id)
      } catch (error) {
        this.logger.warn({ err: error, runId: run.id }, 'failed to reconcile interrupted run')
      }
    }
    // A crashed process can leave capacity slots behind; drop the ones whose Run
    // is already terminal or gone so the Agent is not stalled for the whole TTL.
    try {
      const released = this.store.releaseDeadAgentExecutionSlots()
      if (released.length > 0) {
        this.logger.info({ agents: released }, 'released stale agent execution slots')
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'failed to release stale agent execution slots')
    }
  }

  shutdown(): void {
    for (const state of this.active.values()) {
      state.abort.abort()
      if (state.leaseTimer) clearInterval(state.leaseTimer)
      if (state.deadlineTimer) clearTimeout(state.deadlineTimer)
      this.resolvePendingPermissions(state.runId, null)
    }
    this.active.clear()
    this.sessionIndex.clear()
  }
}

/**
 * Real agents often put review findings in the artifact body/title but omit the
 * structured metadata fields. Preserve the actual content while normalizing the
 * envelope so CompletionDecision can evaluate it as a review rather than as an
 * unstructured document. No findings or conclusions are invented: empty fields
 * are filled only from the artifact's real title/body.
 */
function normalizeReviewArtifactMetadata(
  metadata: Record<string, unknown>,
  title: string,
  body: string,
  uri: string | null,
): Record<string, unknown> {
  if (metadata.artifactType) return metadata
  if (!/审查|评审|review/i.test(title)) return metadata
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*#>\s]+/, '').trim())
    .filter(Boolean)
  return {
    ...metadata,
    artifactType: 'review',
    scope:
      typeof metadata.scope === 'string' && metadata.scope.trim()
        ? metadata.scope
        : 'task workspace',
    reviewedObjects: Array.isArray(metadata.reviewedObjects) && metadata.reviewedObjects.length
      ? metadata.reviewedObjects
      : [uri ?? 'workspace'],
    findings: Array.isArray(metadata.findings) && metadata.findings.length
      ? metadata.findings
      : (lines.length ? lines.slice(0, 8) : [title]),
    conclusion:
      typeof metadata.conclusion === 'string' && metadata.conclusion.trim()
        ? metadata.conclusion
        : (body.trim().slice(0, 4000) || title),
    blockers:
      Array.isArray(metadata.blockers) && metadata.blockers.length
        ? metadata.blockers
        : ['无阻塞项'],
  }
}

function hashArgs(args: Record<string, unknown>): string {  return createHash('sha256').update(stableStringify(args)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function requiredString(
  args: Record<string, unknown>,
  key: string,
  options: { allowEmpty?: boolean } = {},
): string {
  const value = args[key]
  if (typeof value !== 'string' || (!options.allowEmpty && value.trim() === '')) {
    throw new AppError('BAD_REQUEST', `参数 ${key} 必须是非空字符串`)
  }
  return value
}

function stringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function priorityArg(value: unknown): 1 | 2 | 3 | 4 {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : 3
}

function taskStatusArg(value: unknown): TaskStatus {
  if (typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)) {
    return value as TaskStatus
  }
  throw new AppError('BAD_REQUEST', `未知任务状态：${String(value)}`)
}

function approvalDetail(invocation: ToolInvocation): string {
  if (invocation.name === 'write_file') {
    const path = typeof invocation.args.path === 'string' ? invocation.args.path : '(未知路径)'
    const content = typeof invocation.args.content === 'string' ? invocation.args.content : ''
    return `Agent 请求写入文件：${path}\n\n内容长度：${content.length} 字符\n\n预览：\n${content.slice(0, 1200)}`
  }
  if (invocation.name === 'run_command' || invocation.name === 'run_tests') {
    return `Agent 请求执行命令：\n\n${String(invocation.args.command ?? '(未提供)')}`
  }
  return `Agent 请求执行 ${invocation.name}。`
}






