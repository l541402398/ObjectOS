import {
  AppError,
  newId,
  now,
  type CollaborationSnapshot,
  type HandoffView,
  type InboxItemView,
  type RequestHandoffInput,
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

  snapshot(projectId: string): CollaborationSnapshot {
    this.getProject(projectId)
    return this.store.read.getCollaborationSnapshot(projectId)
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

  requestHandoff(input: RequestHandoffInput, actor: ActionActor = USER_ACTOR): HandoffView {
    const task = this.store.read.getTask(input.taskId)
    if (!task) throw new AppError('NOT_FOUND', '任务不存在')
    this.getProject(task.projectId)
    const toAgent = this.store.read.getAgent(input.toAgentId)
    if (!toAgent) throw new AppError('NOT_FOUND', '接收方 Agent 不存在')
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
        payload: { taskTitle: task.title, fromAgentName: this.store.read.getAgent(fromSession!.agentId)?.name },
        requestedAt: now(),
        decidedAt: null,
      }
      this.store.createHandoff(handoff)
      this.store.appendEvent(task.projectId, handoff.id, PROJECT_EVENT_TYPES.handoffRequested, {
        title: task.title,
        toAgentName: toAgent.name,
        actor,
        actorName: actor.name,
      })
      return handoff
    })
    const view = this.store.read.getHandoffView(created.id)
    if (!view) throw new AppError('INTERNAL', '交接创建失败')
    return view
  }

  acceptHandoff(handoffId: string, sessionId: string | null = null, actor: ActionActor = USER_ACTOR): { handoff: HandoffView; sessionId: string } {
    const handoff = this.store.read.getHandoff(handoffId)
    if (!handoff) throw new AppError('NOT_FOUND', '交接请求不存在')
    assertHandoffTransition(handoff.status, 'accepted')
    const task = this.store.read.getTask(handoff.taskId)
    if (!task) throw new AppError('NOT_FOUND', '交接任务不存在')
    const toAgent = this.store.read.getAgent(handoff.toAgentId)
    if (!toAgent) throw new AppError('NOT_FOUND', '接收方 Agent 不存在')
    let targetSession = sessionId ? this.getSession(sessionId) : null
    if (targetSession) {
      if (targetSession.projectId !== handoff.projectId || targetSession.agentId !== handoff.toAgentId) {
        throw new AppError('BAD_REQUEST', '目标会话与交接接收方不匹配')
      }
    }
    const timestamp = now()
    const resolvedSessionId = this.store.transaction(() => {
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
        content: `已接受任务交接「${task.title}」。\n\n${handoff.summary}`,
        metadata: { handoffId: handoff.id },
      })
      this.store.appendEvent(handoff.projectId, handoff.id, PROJECT_EVENT_TYPES.handoffAccepted, {
        title: task.title,
        actor,
        actorName: actor.name,
      })
      return session.id
    })
    const view = this.store.read.getHandoffView(handoff.id)
    if (!view) throw new AppError('INTERNAL', '交接更新失败')
    return { handoff: view, sessionId: resolvedSessionId }
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
