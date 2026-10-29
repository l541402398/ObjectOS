import {
  AppError,
  newId,
  now,
  type Agent,
  type CollaborationSnapshot,
  type CollaborationOverview,
  type HandoffView,
  type InboxItemView,
  type RequestHandoffInput,
  type RunStatus,
  type SendCrossSessionInput,
  type Session,
} from '@projectos/contracts'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import { assertHandoffTransition, buildEnvelope, validateEnvelope } from '@projectos/collaboration'
import { sessionTitleForTask } from '@projectos/session-manager'
import type { ActionActor, CoreStore } from './ports.js'
import { USER_ACTOR } from './ports.js'

export interface SendCrossSessionResult {
  inbox: InboxItemView
  created: boolean
  toSession: Session
  taskId: string | null
}

export interface CollaboratorView {
  agentId: string
  name: string
  role: string
  capabilities: string[]
  skills: string[]
  status: string
  runtime: { name: string; status: string } | null
  available: boolean
  active: boolean
  isSelf: boolean
}

const AUTO_ACTOR: ActionActor = { kind: 'system', id: 'handoff-auto', name: '自动交接' }

/** Run states that still own an execution slot in the overview. Terminal states are excluded. */
const ACTIVE_RUN_STATUSES = new Set<RunStatus>([
  'created',
  'queued',
  'running',
  'waiting_tool',
  'waiting_approval',
  'verifying',
  'suspended',
])

function handoffTtlMs(): number {
  const raw = Number(process.env.PROJECTOS_HANDOFF_TTL_MS ?? 24 * 60 * 60 * 1000)
  if (!Number.isFinite(raw)) return 24 * 60 * 60 * 1000
  return Math.max(60_000, Math.min(30 * 24 * 60 * 60 * 1000, Math.trunc(raw)))
}

export class CollaborationService {
  constructor(private readonly store: CoreStore) {}

  private getProject(projectId: string) {
    const project = this.store.read.getProject(projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    return project
  }

  private getSession(sessionId: string) {
    const session = this.store.read.getSession(sessionId)
    if (!session) throw new AppError('NOT_FOUND', '会话不存在')
    return session
  }

  private payload(handoff: HandoffView): Record<string, unknown> {
    const value = handoff.payload
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  }

  /** Re-check that the target Agent can actually be used in this project. */
  private assertTargetAvailable(projectId: string, agentId: string): Agent {
    const agent = this.store.read.getAgent(agentId)
    if (!agent) throw new AppError('NOT_FOUND', '接收方 Agent 不存在')
    if (!this.store.read.isAgentVisibleToProject(projectId, agentId)) {
      throw new AppError('CONFLICT', '接收方 Agent 不在当前项目的可见范围')
    }
    const definition = this.store.read.getAgentDefinition(agentId)
    if (definition && definition.status !== 'active') {
      throw new AppError('CONFLICT', `接收方 Agent 当前不可用：${definition.status}`)
    }
    if (definition) {
      const knownSkills = new Set(this.store.read.listSkills().map((skill) => skill.id))
      const missing = definition.skills
        .filter((binding) => binding.enabled && !knownSkills.has(binding.skillId))
        .map((binding) => binding.skillId)
      if (missing.length > 0) {
        throw new AppError('CONFLICT', `接收方 Agent 缺少 Skill：${missing.join(', ')}`)
      }
      const profileId = definition.primaryRuntimeProfileId ?? definition.runtimeProfileIds[0] ?? null
      if (profileId) {
        const profile = this.store.read.listRuntimeProfiles().find((item) => item.id === profileId)
        if (!profile || profile.status !== 'available') {
          throw new AppError(
            'CONFLICT',
            `接收方 Agent 绑定的 Runtime「${profile?.name ?? profileId}」不可用（${profile?.status ?? 'missing'}）`,
          )
        }
      }
    }
    return agent
  }

  snapshot(projectId: string): CollaborationSnapshot {
    this.getProject(projectId)
    this.expireStaleHandoffs(projectId)
    return this.store.read.getCollaborationSnapshot(projectId)
  }

  /**
   * Read-only Agent collaboration overview (ADR-ORG-0101).
   *
   * It only composes persisted task/run/handoff/approval/artifact rows and the latest plan revision.
   * No scheduler, timer or synthetic progress is involved: an Agent is "working" because an active
   * Run row exists, and an artifact is displayed only because an artifact row exists.
   */
  overview(projectId: string): CollaborationOverview {
    this.getProject(projectId)
    this.expireStaleHandoffs(projectId)
    const read = this.store.read
    const views = read.getAgentViews(projectId)
    const tasks = read.listTaskCards(projectId)
    const runs = read.listRunSummaries(projectId, 60)
    const sessions = read.listSessionSummaries(projectId)
    const handoffs = read.listHandoffViews(projectId)
    const approvals = read.listApprovalViews(projectId)
    const artifacts = read.listArtifacts(projectId)
    const activity = read.getProjectActivity(projectId, 16)
    const planRevisions = read.listPlanRevisions(projectId)
    const latestPlan = planRevisions[0] ?? null
    const pendingApprovals = approvals.filter((approval) => approval.status === 'pending')

    const agents = views.map((view) => {
      const activeRun = (view.activeRunId ? runs.find((run) => run.id === view.activeRunId) : undefined)
        ?? runs.find((run) => run.agentId === view.agent.id && ACTIVE_RUN_STATUSES.has(run.status))
        ?? null
      const task = activeRun?.taskId ? tasks.find((item) => item.id === activeRun.taskId) ?? null : null
      const agentSessions = sessions.filter((session) => session.agentId === view.agent.id)
      const agentRuns = runs.filter((run) => run.agentId === view.agent.id)
      const lastSessionAt = agentSessions.reduce((latest, session) => Math.max(latest, session.lastMessageAt ?? session.updatedAt), 0)
      const lastRunAt = agentRuns.reduce((latest, run) => Math.max(latest, run.finishedAt ?? run.startedAt ?? run.createdAt), 0)
      const lastActivityAt = Math.max(lastSessionAt, lastRunAt)
      return {
        id: view.agent.id,
        name: view.agent.name,
        role: view.agent.role,
        accent: view.agent.accent,
        status: view.status,
        activeRunId: activeRun?.id ?? null,
        activeSessionId: activeRun?.sessionId ?? view.activeSessionId,
        runStatus: activeRun?.status ?? null,
        taskId: task?.id ?? null,
        taskTitle: task?.title ?? null,
        taskStatus: task?.status ?? null,
        pendingApprovals: pendingApprovals.filter((approval) => approval.runId === activeRun?.id || approval.agentName === view.agent.name).length,
        completedRuns: view.completedRuns,
        sessionCount: view.sessionCount,
        lastActivityAt: lastActivityAt > 0 ? lastActivityAt : null,
      }
    })

    const metrics = {
      workingAgents: agents.filter((agent) => agent.status === 'working').length,
      activeTasks: tasks.filter((task) => task.status === 'running' || task.status === 'review').length,
      blockedTasks: tasks.filter((task) => task.status === 'blocked' || (task.blockedBy.length > 0 && task.status !== 'done' && task.status !== 'cancelled')).length,
      pendingApprovals: pendingApprovals.length,
      pendingHandoffs: handoffs.filter((handoff) => handoff.status === 'requested').length,
      artifacts: artifacts.length,
      doneTasks: tasks.filter((task) => task.status === 'done').length,
      totalTasks: tasks.filter((task) => task.status !== 'cancelled').length,
    }

    return {
      projectId,
      generatedAt: now(),
      agents,
      tasks,
      runs,
      handoffs,
      approvals,
      artifacts,
      activity,
      plan: latestPlan
        ? {
            id: latestPlan.id,
            goal: latestPlan.goal,
            status: latestPlan.status,
            revision: latestPlan.revision,
            approvedAt: latestPlan.approvedAt ?? null,
            executionStatus: latestPlan.execution?.status ?? null,
            taskCount: latestPlan.tasks.length,
            taskIds: latestPlan.createdTaskIds ?? [],
            createdAt: latestPlan.createdAt,
          }
        : null,
      metrics,
    }
  }

  listInbox(projectId: string, sessionId: string | null = null): InboxItemView[] {
    this.getProject(projectId)
    return this.store.read.listInboxViews(projectId, sessionId)
  }

  send(input: SendCrossSessionInput, actor: ActionActor = USER_ACTOR): SendCrossSessionResult {
    const project = this.getProject(input.projectId)
    const fromSession = this.getSession(input.fromSessionId)
    const toSession = this.getSession(input.toSessionId)
    if (fromSession.projectId !== project.id || toSession.projectId !== project.id) {
      throw new AppError('BAD_REQUEST', '跨会话消息只能在同一项目内发送')
    }
    if (fromSession.agentId === toSession.agentId && fromSession.id === toSession.id) {
      throw new AppError('BAD_REQUEST', '不能向自身发送消息')
    }
    if (input.taskId) {
      const task = this.store.read.getTask(input.taskId)
      if (!task || task.projectId !== project.id) throw new AppError('NOT_FOUND', '关联任务不存在')
    }
    const envelope = validateEnvelope(
      buildEnvelope({
        projectId: project.id,
        taskId: input.taskId,
        sender: { agentId: fromSession.agentId, sessionId: fromSession.id },
        recipient: { agentId: toSession.agentId, sessionId: toSession.id },
        type: input.type,
        body: input.body,
      }),
    )
    const result = this.store.transaction(() => {
      const inserted = this.store.insertInboxWithMessage({
        projectId: project.id,
        envelope,
        recipientAgentId: toSession.agentId,
        recipientSessionId: toSession.id,
      })
      if (!inserted.duplicate) {
        this.store.appendEvent(project.id, inserted.item.id, PROJECT_EVENT_TYPES.messageDelivered, {
          title: `消息 → ${this.store.read.getAgent(toSession.agentId)?.name ?? toSession.agentId}`,
          type: envelope.type,
          inboxId: inserted.item.id,
          actor,
          actorName: actor.name,
        })
      }
      return inserted
    })
    return {
      inbox: this.store.read.getInboxItemView(result.item),
      created: !result.duplicate,
      toSession,
      taskId: input.taskId,
    }
  }

  ack(inboxId: string, actor: ActionActor = USER_ACTOR): InboxItemView {
    const inbox = this.store.read.getInbox(inboxId)
    if (!inbox) throw new AppError('NOT_FOUND', '收件箱条目不存在')
    if (inbox.status === 'completed') return this.store.read.getInboxItemView(inbox)
    return this.store.transaction(() => {
      const updated = this.store.updateInboxStatus(inbox.id, 'accepted')
      this.store.appendEvent(inbox.projectId, inbox.id, PROJECT_EVENT_TYPES.messageAcknowledged, {
        inboxId: inbox.id,
        actor,
        actorName: actor.name,
      })
      return this.store.read.getInboxItemView(updated)
    })
  }

  listCollaborators(projectId: string, requesterAgentId: string): CollaboratorView[] {
    this.getProject(projectId)
    const requester = this.store.read.getAgent(requesterAgentId)
    if (!requester) throw new AppError('NOT_FOUND', '请求方 Agent 不存在')
    const skills = this.store.read.listSkills()
    const profiles = this.store.read.listRuntimeProfiles()
    return this.store.read
      .getAgentViews(projectId)
      .filter((view) => this.store.read.isAgentVisibleToProject(projectId, view.agent.id))
      .map((view) => {
        const definition = this.store.read.getAgentDefinition(view.agent.id)
        const profileId = definition?.primaryRuntimeProfileId ?? definition?.runtimeProfileIds[0] ?? null
        const profile = profileId ? profiles.find((item) => item.id === profileId) ?? null : null
        const status = definition?.status ?? 'active'
        const runtimeAvailable = !profileId || profile?.status === 'available'
        return {
          agentId: view.agent.id,
          name: view.agent.name,
          role: view.agent.role,
          capabilities: view.agent.capabilities,
          skills: (definition?.skills ?? [])
            .filter((binding) => binding.enabled)
            .map((binding) => skills.find((skill) => skill.id === binding.skillId)?.name ?? binding.skillId),
          status,
          runtime: profile ? { name: profile.name, status: profile.status } : null,
          available: status === 'active' && runtimeAvailable,
          active: Boolean(view.activeRunId),
          isSelf: view.agent.id === requesterAgentId,
        }
      })
  }

  getPolicy(projectId: string): { mode: 'manual' | 'auto' } {
    this.getProject(projectId)
    return { mode: this.store.read.getHandoffMode(projectId) }
  }

  setPolicy(projectId: string, mode: 'manual' | 'auto', actor: ActionActor = USER_ACTOR): { mode: 'manual' | 'auto' } {
    this.getProject(projectId)
    this.store.setHandoffMode(projectId, mode)
    this.store.appendEvent(projectId, projectId, PROJECT_EVENT_TYPES.handoffPolicyChanged, {
      mode,
      actor,
      actorName: actor.name,
    })
    return { mode }
  }

  listHandoffs(projectId: string): HandoffView[] {
    this.getProject(projectId)
    this.expireStaleHandoffs(projectId)
    return this.store.read.listHandoffViews(projectId)
  }

  expireStaleHandoffs(projectId: string): void {
    const timestamp = now()
    for (const view of this.store.read.listHandoffViews(projectId)) {
      if (view.status !== 'requested') continue
      const expiresAt = view.expiresAt ?? (typeof this.payload(view).expiresAt === 'number' ? Number(this.payload(view).expiresAt) : null)
      if (expiresAt === null || expiresAt > timestamp) continue
      this.store.transaction(() => {
        this.store.updateHandoff(view.id, { status: 'expired', decidedAt: timestamp })
        this.store.appendEvent(projectId, view.id, PROJECT_EVENT_TYPES.handoffExpired, {
          reason: '交接请求已过期',
        })
      })
    }
  }

  requestHandoff(input: RequestHandoffInput, actor: ActionActor = USER_ACTOR): HandoffView {
    const task = this.store.read.getTask(input.taskId)
    if (!task) throw new AppError('NOT_FOUND', '任务不存在')
    this.getProject(task.projectId)
    if (task.status === 'done' || task.status === 'cancelled') {
      throw new AppError('CONFLICT', '已完成或已取消的任务不能发起交接')
    }
    const toAgent = this.assertTargetAvailable(task.projectId, input.toAgentId)
    let fromSession: Session | null = input.sessionId ? this.getSession(input.sessionId) : null
    if (!fromSession) {
      const sessions = this.store.read.listSessionSummaries(task.projectId)
      fromSession =
        sessions.find((session) => session.agentId === task.assigneeAgentId) ??
        sessions.find((session) => session.agentId !== input.toAgentId) ??
        null
    }
    if (!fromSession) throw new AppError('CONFLICT', '当前项目没有可用的来源会话，请先创建 Agent 会话')
    if (fromSession.projectId !== task.projectId) throw new AppError('BAD_REQUEST', '来源会话不属于当前项目')
    if (fromSession.agentId === input.toAgentId) throw new AppError('BAD_REQUEST', '不能把任务交接给当前 Agent 自身')

    const existing = this.store.read
      .listHandoffViews(task.projectId)
      .find(
        (item) =>
          item.taskId === task.id &&
          item.toAgentId === input.toAgentId &&
          (item.status === 'requested' || item.status === 'accepted'),
      )
    if (existing) return existing

    const runs = this.store.read.listRunSummaries(task.projectId, 500)
    const sourceRun = runs.find((run) => run.taskId === task.id) ?? null
    const card = this.store.read.getTaskCard(task.id)
    const dependencyIds = card?.dependencyIds ?? []
    const upstreamRunIds = dependencyIds
      .map((id) => runs.find((run) => run.taskId === id && run.status === 'completed')?.id)
      .filter((id): id is string => Boolean(id))
      .slice(0, 20)
    const ownArtifacts = this.store.read
      .listArtifacts(task.projectId, task.id)
      .filter((artifact) => !artifact.isDemo)
    const requestedArtifacts = (input.artifactRefs ?? [])
      .map((id) => this.store.read.listArtifacts(task.projectId).find((artifact) => artifact.id === id) ?? null)
      .filter((artifact): artifact is NonNullable<typeof artifact> => artifact !== null && !artifact.isDemo)
    const artifactMap = new Map([...ownArtifacts, ...requestedArtifacts].map((artifact) => [artifact.id, artifact]))
    const artifactRefs = [...artifactMap.values()].slice(0, 20).map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      kind: artifact.kind,
      uri: artifact.uri,
      verified: Boolean(artifact.verifiedAt),
    }))
    const expiresAt = now() + handoffTtlMs()
    const created = this.store.transaction(() => {
      const handoff = {
        id: newId('hnd'),
        projectId: task.projectId,
        taskId: task.id,
        fromAgentId: fromSession!.agentId,
        fromSessionId: fromSession!.id,
        toAgentId: input.toAgentId,
        toSessionId: null,
        status: 'requested' as const,
        summary: input.summary,
        payload: {
          taskTitle: task.title,
          fromAgentName: this.store.read.getAgent(fromSession!.agentId)?.name ?? null,
          sourceTaskId: task.id,
          sourceAgentId: fromSession!.agentId,
          targetAgentId: input.toAgentId,
          sourceRunId: sourceRun?.id ?? null,
          completed: input.completed ?? [],
          remaining: input.remaining ?? [],
          risks: input.risks ?? [],
          artifactRefs,
          upstreamRunIds,
          nextActions: input.nextActions ?? [],
          riskLevel: input.riskLevel ?? 'medium',
          expiresAt,
        },
        requestedAt: now(),
        decidedAt: null,
      }
      this.store.createHandoff(handoff)
      this.store.appendEvent(task.projectId, handoff.id, PROJECT_EVENT_TYPES.handoffRequested, {
        title: task.title,
        toAgentName: toAgent.name,
        riskLevel: input.riskLevel ?? 'medium',
        actor,
        actorName: actor.name,
      })
      return handoff
    })
    const view = this.store.read.getHandoffView(created.id)
    if (!view) throw new AppError('INTERNAL', '交接创建失败')

    if (this.store.read.getHandoffMode(task.projectId) === 'auto' && (input.riskLevel ?? 'medium') === 'low') {
      try {
        return this.acceptHandoff(created.id, null, AUTO_ACTOR).handoff
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.store.updateHandoffPayload(created.id, { autoAcceptError: message })
        this.store.appendMessage({
          sessionId: fromSession.id,
          role: 'system',
          content: `自动交接未执行：${message}。交接保持待接受，可人工处理。`,
          metadata: { kind: 'handoff-auto-error', handoffId: created.id },
        })
        return this.store.read.getHandoffView(created.id) ?? view
      }
    }
    return view
  }

  acceptHandoff(
    handoffId: string,
    sessionId: string | null = null,
    actor: ActionActor = USER_ACTOR,
  ): { handoff: HandoffView; sessionId: string } {
    const handoff = this.store.read.getHandoff(handoffId)
    if (!handoff) throw new AppError('NOT_FOUND', '交接请求不存在')
    const currentView = this.store.read.getHandoffView(handoff.id)
    if (!currentView) throw new AppError('INTERNAL', '交接视图不存在')
    if (handoff.status === 'accepted') {
      if (!handoff.toSessionId) throw new AppError('CONFLICT', '交接已接受但没有目标会话')
      return { handoff: currentView, sessionId: handoff.toSessionId }
    }
    assertHandoffTransition(handoff.status, 'accepted')
    const task = this.store.read.getTask(handoff.taskId)
    if (!task) throw new AppError('NOT_FOUND', '交接任务不存在')
    if (task.status === 'done' || task.status === 'cancelled') {
      throw new AppError('CONFLICT', '已完成或已取消的任务不能接受交接')
    }
    const expiresAt = currentView.expiresAt ?? null
    if (expiresAt !== null && expiresAt <= now()) {
      this.store.transaction(() => {
        this.store.updateHandoff(handoff.id, { status: 'expired', decidedAt: now() })
        this.store.appendEvent(handoff.projectId, handoff.id, PROJECT_EVENT_TYPES.handoffExpired, {
          reason: '交接请求已过期',
        })
      })
      throw new AppError('CONFLICT', '交接请求已过期')
    }
    const toAgent = this.assertTargetAvailable(handoff.projectId, handoff.toAgentId)
    let targetSession = sessionId ? this.getSession(sessionId) : null
    if (targetSession) {
      if (targetSession.projectId !== handoff.projectId || targetSession.agentId !== handoff.toAgentId) {
        throw new AppError('BAD_REQUEST', '目标会话与交接接收方不匹配')
      }
    }
    const timestamp = now()
    const resolvedSessionId = this.store.transaction(() => {
      if (!targetSession) {
        const existing = this.store.read
          .listSessionSummaries(handoff.projectId)
          .find(
            (session) =>
              session.agentId === handoff.toAgentId &&
              session.status !== 'archived' &&
              !session.title.startsWith('计划群聊 ·'),
          )
        targetSession = existing
          ? this.store.read.getSession(existing.id)
          : null
      }
      if (!targetSession) {
        targetSession = this.store.createSession({
          id: newId('ses'),
          projectId: handoff.projectId,
          agentId: handoff.toAgentId,
          title: sessionTitleForTask(task.title, toAgent.name),
          status: 'active',
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        this.store.appendEvent(handoff.projectId, targetSession.id, PROJECT_EVENT_TYPES.sessionCreated, {
          title: targetSession.title,
          actor,
          actorName: actor.name,
        })
      }
      const session = targetSession
      this.store.updateHandoff(handoff.id, {
        status: 'accepted',
        toSessionId: session.id,
        decidedAt: timestamp,
      })
      if (task.assigneeAgentId !== handoff.toAgentId) {
        this.store.updateTask(task.id, task.version, { assigneeAgentId: handoff.toAgentId })
      }
      this.store.appendMessage({
        sessionId: session.id,
        role: 'system',
        content: this.handoffMessage(currentView, task.title),
        metadata: {
          kind: 'handoff-accepted',
          handoffId: handoff.id,
          sourceTaskId: task.id,
          sourceRunId: currentView.sourceRunId,
          artifactRefs: currentView.artifactRefs.map((artifact) => artifact.id),
        },
      })
      this.store.appendEvent(handoff.projectId, handoff.id, PROJECT_EVENT_TYPES.handoffAccepted, {
        title: task.title,
        sourceTaskId: task.id,
        targetAgentId: handoff.toAgentId,
        sourceRunId: currentView.sourceRunId,
        actor,
        actorName: actor.name,
      })
      return session.id
    })
    const view = this.store.read.getHandoffView(handoff.id)
    if (!view) throw new AppError('INTERNAL', '交接更新失败')
    return { handoff: view, sessionId: resolvedSessionId }
  }

  private handoffMessage(handoff: HandoffView, taskTitle: string): string {
    const sections = (label: string, items: string[]): string[] =>
      items.length > 0 ? [`${label}：`, ...items.map((item) => `- ${item}`)] : []
    return [
      `已接受任务交接「${taskTitle}」。`,
      '',
      `来源 Agent：${handoff.fromAgentName}`,
      `风险级别：${String(this.payload(handoff).riskLevel ?? 'medium')}`,
      '',
      ...sections('已完成', handoff.completed),
      ...sections('未完成', handoff.remaining),
      ...sections('风险', handoff.risks),
      ...sections('下一步', handoff.nextActions),
      ...(handoff.artifactRefs.length > 0
        ? ['上游产物：', ...handoff.artifactRefs.map((artifact) => `- ${artifact.title}（${artifact.kind}）`)]
        : []),
      '',
      handoff.summary,
      '',
      '调度器会在源运行释放 Task Lease 后启动接收方，不会重复启动。',
    ].join('\n')
  }

  cancelHandoff(handoffId: string, reason = '', actor: ActionActor = USER_ACTOR): HandoffView {
    const handoff = this.store.read.getHandoff(handoffId)
    if (!handoff) throw new AppError('NOT_FOUND', '交接请求不存在')
    assertHandoffTransition(handoff.status, 'cancelled')
    this.store.transaction(() => {
      this.store.updateHandoff(handoff.id, { status: 'cancelled', decidedAt: now() })
      this.store.appendEvent(handoff.projectId, handoff.id, PROJECT_EVENT_TYPES.handoffCancelled, {
        reason,
        actor,
        actorName: actor.name,
      })
    })
    const view = this.store.read.getHandoffView(handoff.id)
    if (!view) throw new AppError('INTERNAL', '交接更新失败')
    return view
  }

  rejectHandoff(handoffId: string, reason = '', actor: ActionActor = USER_ACTOR): HandoffView {
    const handoff = this.store.read.getHandoff(handoffId)
    if (!handoff) throw new AppError('NOT_FOUND', '交接请求不存在')
    assertHandoffTransition(handoff.status, 'rejected')
    this.store.transaction(() => {
      this.store.updateHandoff(handoff.id, { status: 'rejected', decidedAt: now() })
      this.store.appendEvent(handoff.projectId, handoff.id, PROJECT_EVENT_TYPES.handoffRejected, {
        reason,
        actor,
        actorName: actor.name,
      })
    })
    const view = this.store.read.getHandoffView(handoff.id)
    if (!view) throw new AppError('INTERNAL', '交接更新失败')
    return view
  }
}
