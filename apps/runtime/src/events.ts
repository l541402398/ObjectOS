import type { ProjectEvent, RuntimeEvent } from '@projectos/contracts'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import type { SqliteStore } from '@projectos/persistence'
import type { Logger } from './logger.js'

export interface RuntimeEventSink {
  sendEvent(seq: number, event: RuntimeEvent): void
}

export class RuntimeEventHub {
  private seq = 0

  constructor(
    private readonly sink: RuntimeEventSink,
    private readonly store: SqliteStore,
    private readonly logger: Logger,
  ) {}

  publish(event: RuntimeEvent): void {
    this.seq += 1
    try {
      this.sink.sendEvent(this.seq, event)
    } catch (error) {
      this.logger.warn({ err: error }, 'failed to emit runtime event')
    }
  }

  publishCommitted(events: ProjectEvent[]): void {
    for (const event of events) {
      try {
        this.mapCommittedEvent(event)
      } catch (error) {
        this.logger.warn({ err: error, eventId: event.id }, 'failed to map committed event')
      }
    }
  }

  private mapCommittedEvent(event: ProjectEvent): void {
    const payload = event.payload
    const projectId = event.projectId
    const aggregate = event.aggregateId
    switch (event.eventType) {
      case PROJECT_EVENT_TYPES.taskCreated:
      case PROJECT_EVENT_TYPES.taskUpdated:
      case PROJECT_EVENT_TYPES.taskMoved:
      case PROJECT_EVENT_TYPES.taskCompleted:
      case PROJECT_EVENT_TYPES.taskDependencyAdded:
      case PROJECT_EVENT_TYPES.taskDependencyRemoved: {
        const task = this.store.read.getTask(aggregate)
        this.publish({
          type: 'task.changed',
          projectId,
          taskId: aggregate,
          status: (typeof payload.status === 'string' ? payload.status : task?.status ?? 'backlog') as never,
          reason: event.eventType,
        })
        this.publish({ type: 'project.changed', projectId, reason: event.eventType })
        return
      }
      case PROJECT_EVENT_TYPES.runStarted:
      case PROJECT_EVENT_TYPES.runStatusChanged:
      case PROJECT_EVENT_TYPES.runCompleted:
      case PROJECT_EVENT_TYPES.runFailed: {
        const run = this.store.read.getRun(aggregate)
        if (run) {
          this.publish({
            type: 'run.changed',
            projectId,
            runId: run.id,
            sessionId: run.sessionId,
            status: typeof payload.status === 'string' ? (payload.status as never) : run.status,
          })
          this.publish({
            type: 'session.changed',
            projectId,
            sessionId: run.sessionId,
            reason: event.eventType,
          })
        }
        this.publish({ type: 'project.changed', projectId, reason: event.eventType })
        return
      }
      case PROJECT_EVENT_TYPES.approvalRequested:
      case PROJECT_EVENT_TYPES.approvalDecided: {
        const approval = this.store.read.getApproval(aggregate)
        if (approval) {
          this.publish({
            type: 'approval.changed',
            projectId,
            approvalId: approval.id,
            status: approval.status,
          })
        }
        this.publish({ type: 'project.changed', projectId, reason: event.eventType })
        return
      }
      case PROJECT_EVENT_TYPES.messageDelivered:
      case PROJECT_EVENT_TYPES.messageAcknowledged: {
        this.publish({
          type: 'inbox.changed',
          projectId,
          inboxId: typeof payload.inboxId === 'string' ? payload.inboxId : aggregate,
        })
        this.publish({ type: 'project.changed', projectId, reason: event.eventType })
        return
      }
      case PROJECT_EVENT_TYPES.handoffRequested:
      case PROJECT_EVENT_TYPES.handoffAccepted:
      case PROJECT_EVENT_TYPES.handoffRejected: {
        this.publish({ type: 'handoff.changed', projectId, handoffId: aggregate })
        this.publish({ type: 'project.changed', projectId, reason: event.eventType })
        return
      }
      case PROJECT_EVENT_TYPES.sessionCreated:
      case PROJECT_EVENT_TYPES.messageSent: {
        this.publish({
          type: 'session.changed',
          projectId,
          sessionId: aggregate,
          reason: event.eventType,
        })
        this.publish({ type: 'project.changed', projectId, reason: event.eventType })
        return
      }
      case PROJECT_EVENT_TYPES.artifactCreated:
      case PROJECT_EVENT_TYPES.artifactVerified: {
        this.publish({ type: 'project.changed', projectId, reason: event.eventType })
        const taskId = typeof payload.taskId === 'string' ? payload.taskId : null
        if (taskId) {
          const task = this.store.read.getTask(taskId)
          if (task) {
            this.publish({
              type: 'task.changed',
              projectId,
              taskId,
              status: task.status,
              reason: event.eventType,
            })
          }
        }
        return
      }
      default:
        this.publish({ type: 'project.changed', projectId, reason: event.eventType })
    }
  }
}
