import { ProjectService } from './project-service.js'
import { TaskService } from './task-service.js'
import { SessionService } from './session-service.js'
import { CollaborationService } from './collaboration-service.js'
import type { CoreStore, WorkspacePort } from './ports.js'

export class CoreServices {
  readonly projects: ProjectService
  readonly tasks: TaskService
  readonly sessions: SessionService
  readonly collaboration: CollaborationService

  constructor(store: CoreStore, workspace: WorkspacePort) {
    this.projects = new ProjectService(store, workspace)
    this.tasks = new TaskService(store)
    this.sessions = new SessionService(store)
    this.collaboration = new CollaborationService(store)
  }
}
