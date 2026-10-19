import {
  AppError,
  newId,
  now,
  type CreateSessionInput,
  type MessageView,
  type SendMessageInput,
  type SessionDetail,
  type SessionSummary,
} from '@projectos/contracts'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import { normalizeUserMessage, sessionTitleForTask } from '@projectos/session-manager'
import type { ActionActor, CoreStore } from './ports.js'
import { USER_ACTOR } from './ports.js'

export class SessionService {
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

  list(projectId: string): SessionSummary[] {
    this.getProject(projectId)
    return this.store.read.listSessionSummaries(projectId)
  }

  create(input: CreateSessionInput, actor: ActionActor = USER_ACTOR): SessionSummary {
    const project = this.getProject(input.projectId)
    const agent = this.store.read.getAgent(input.agentId)
    if (!agent) throw new AppError('NOT_FOUND', 'Agent 不存在')
    const timestamp = now()
    const session = {
      id: newId('ses'),
      projectId: input.projectId,
      agentId: agent.id,
      title: input.title ?? sessionTitleForTask('', agent.name),
      status: 'active' as const,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    return this.store.transaction(() => {
      const created = this.store.createSession(session)
      this.store.appendEvent(project.id, created.id, PROJECT_EVENT_TYPES.sessionCreated, {
        title: created.title,
        actor,
        actorName: actor.name,
      })
      return this.store.read.getSessionSummary(created)
    })
  }

  get(sessionId: string, messageLimit = 200): SessionDetail {
    const detail = this.store.read.getSessionDetail(sessionId, messageLimit)
    if (!detail) throw new AppError('NOT_FOUND', '会话不存在')
    return detail
  }

  sendMessage(input: SendMessageInput, actor: ActionActor = USER_ACTOR): MessageView {
    const session = this.getSession(input.sessionId)
    if (session.status === 'archived') throw new AppError('CONFLICT', '会话已归档，不能继续发送消息')
    if (input.taskId) {
      const task = this.store.read.getTask(input.taskId)
      if (!task || task.projectId !== session.projectId) throw new AppError('NOT_FOUND', '关联任务不存在')
    }
    const content = normalizeUserMessage(input.content)
    const project = this.store.read.getProject(session.projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    return this.store.transaction(() => {
      const message = this.store.appendMessage({
        sessionId: session.id,
        role: 'user',
        content,
        runId: null,
        metadata: input.taskId ? { taskId: input.taskId } : {},
      })
      this.store.appendEvent(project.id, session.id, PROJECT_EVENT_TYPES.messageSent, {
        title: session.title,
        preview: content.slice(0, 120),
        actor,
        actorName: actor.name,
      })
      return { ...message, agentName: null }
    })
  }

  update(
    sessionId: string,
    patch: { title?: string; status?: 'active' | 'idle' | 'archived' },
    actor: ActionActor = USER_ACTOR,
  ): SessionSummary {
    const session = this.getSession(sessionId)
    return this.store.transaction(() => {
      this.store.updateSession(sessionId, patch)
      this.store.appendEvent(session.projectId, session.id, PROJECT_EVENT_TYPES.sessionCreated, {
        title: patch.title ?? session.title,
        status: patch.status ?? session.status,
        actor,
        actorName: actor.name,
      })
      return this.store.read.getSessionSummary(session)
    })
  }
}
