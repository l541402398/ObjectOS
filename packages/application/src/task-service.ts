import {
  AppError,
  newId,
  now,
  type CreateTaskInput,
  type MoveTaskInput,
  type Task,
  type TaskCard,
  type TaskDetail,
  type UpdateTaskInput,
} from '@projectos/contracts'
import {
  PROJECT_EVENT_TYPES,
  assertTaskCanComplete,
  assertTaskTransition,
  wouldCreateCycle,
} from '@projectos/domain'
import { evaluateCompletion, type CompletionDecision } from './completion-evidence.js'
import type { ActionActor, CoreStore } from './ports.js'
import { USER_ACTOR } from './ports.js'

export class TaskService {
  constructor(private readonly store: CoreStore) {}

  board(projectId: string) {
    this.getProject(projectId)
    return this.store.read.getTaskBoard(projectId)
  }

  detail(taskId: string): TaskDetail {
    const detail = this.store.read.getTaskDetail(taskId)
    if (!detail) throw new AppError('NOT_FOUND', '任务不存在')
    return detail
  }

  private getProject(projectId: string) {
    const project = this.store.read.getProject(projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    return project
  }

  private getTask(taskId: string): Task {
    const task = this.store.read.getTask(taskId)
    if (!task) throw new AppError('NOT_FOUND', '任务不存在')
    return task
  }

  private assertAgent(agentId: string | null): void {
    if (!agentId) return
    if (!this.store.read.getAgent(agentId)) throw new AppError('NOT_FOUND', '指定的 Agent 不存在')
  }

  private validateDependencies(projectId: string, taskId: string, dependsOn: string[]): void {
    const existing = this.store.read.listDependencies(projectId)
    for (const dependencyId of dependsOn) {
      if (dependencyId === taskId) throw new AppError('CONFLICT', '任务不能依赖自身')
      const dependency = this.store.read.getTask(dependencyId)
      if (!dependency) throw new AppError('NOT_FOUND', `依赖任务不存在：${dependencyId}`)
      if (dependency.projectId !== projectId) {
        throw new AppError('CONFLICT', '不能依赖其他项目的任务')
      }
      if (wouldCreateCycle(existing, taskId, dependencyId)) {
        throw new AppError('CONFLICT', '该依赖会形成环形任务图')
      }
    }
  }

  create(input: CreateTaskInput, actor: ActionActor = USER_ACTOR): TaskCard {
    const project = this.getProject(input.projectId)
    this.assertAgent(input.assigneeAgentId)
    const taskId = newId('tsk')
    this.validateDependencies(input.projectId, taskId, input.dependsOn)
    const timestamp = now()
    const task: Task = {
      id: taskId,
      projectId: input.projectId,
      parentId: null,
      milestoneId: input.milestoneId,
      title: input.title,
      description: input.description,
      status: 'backlog',
      priority: input.priority,
      assigneeAgentId: input.assigneeAgentId,
      acceptanceCriteria: input.acceptanceCriteria,
      expectedArtifacts: input.expectedArtifacts ?? [],
      labels: input.labels,
      version: 0,
      dueAt: input.dueAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    return this.store.transaction(() => {
      this.store.createTask(task, input.dependsOn)
      this.store.appendEvent(project.id, task.id, PROJECT_EVENT_TYPES.taskCreated, {
        title: task.title,
        taskTitle: task.title,
        status: task.status,
        priority: task.priority,
        actor,
        actorName: actor.name,
      })
      const card = this.store.read.getTaskCard(task.id)
      if (!card) throw new AppError('INTERNAL', '任务创建失败')
      return card
    })
  }

  update(input: UpdateTaskInput, actor: ActionActor = USER_ACTOR): TaskCard {
    const task = this.getTask(input.taskId)
    this.assertAgent(input.assigneeAgentId ?? null)
    return this.store.transaction(() => {
      const updated = this.store.updateTask(input.taskId, input.expectedVersion, {
        title: input.title,
        description: input.description,
        priority: input.priority,
        acceptanceCriteria: input.acceptanceCriteria,
        expectedArtifacts: input.expectedArtifacts,
        labels: input.labels,
        assigneeAgentId: input.assigneeAgentId,
        milestoneId: input.milestoneId,
        dueAt: input.dueAt,
      })
      this.store.appendEvent(task.projectId, task.id, PROJECT_EVENT_TYPES.taskUpdated, {
        taskTitle: updated.title,
        title: updated.title,
        status: updated.status,
        actor,
        actorName: actor.name,
      })
      const card = this.store.read.getTaskCard(task.id)
      if (!card) throw new AppError('INTERNAL', '任务更新失败')
      return card
    })
  }

  move(input: MoveTaskInput, actor: ActionActor = USER_ACTOR): TaskCard {
    const task = this.getTask(input.taskId)
    assertTaskTransition(task.status, input.to)
    const card = this.store.read.getTaskCard(task.id)
    if (!card) throw new AppError('NOT_FOUND', '任务不存在')
    if ((input.to === 'ready' || input.to === 'running') && card.blockedBy.length > 0) {
      throw new AppError('CONFLICT', '存在未完成的依赖任务，无法进入就绪/执行状态')
    }
    if (input.to === 'done') {
      const dependencies = card.dependencyIds
        .map((id) => this.store.read.getTask(id))
        .filter((dependency): dependency is Task => dependency !== null)
      assertTaskCanComplete({ task, dependencies })
      const decision = this.completionDecision(task, card, actor, input.note ?? null)
      if (!decision.ok) {
        throw new AppError('CONFLICT', `任务缺少有效完成依据：${decision.reasons.join('；')}`, {
          details: decision,
        })
      }
      return this.finishTask(task, input.expectedVersion, input.note, actor, decision)
    }
    return this.store.transaction(() => {
      const updated = this.store.moveTask(task.id, input.expectedVersion, input.to)
      this.store.appendEvent(task.projectId, task.id, PROJECT_EVENT_TYPES.taskMoved, {
        taskTitle: task.title,
        title: task.title,
        status: input.to,
        note: input.note ?? null,
        actor,
        actorName: actor.name,
      })
      const updatedCard = this.store.read.getTaskCard(updated.id)
      if (!updatedCard) throw new AppError('INTERNAL', '任务状态更新失败')
      return updatedCard
    })
  }

  /** Used by the Scheduler after it has evaluated the full evidence set. */
  complete(
    input: { taskId: string; expectedVersion: number; note?: string; decision: CompletionDecision },
    actor: ActionActor = USER_ACTOR,
  ): TaskCard {
    const task = this.getTask(input.taskId)
    assertTaskTransition(task.status, 'done')
    const card = this.store.read.getTaskCard(task.id)
    if (!card) throw new AppError('NOT_FOUND', '任务不存在')
    const dependencies = card.dependencyIds
      .map((id) => this.store.read.getTask(id))
      .filter((dependency): dependency is Task => dependency !== null)
    assertTaskCanComplete({ task, dependencies })
    if (!input.decision.ok) {
      throw new AppError('CONFLICT', `任务缺少有效完成依据：${input.decision.reasons.join('；')}`, {
        details: input.decision,
      })
    }
    return this.finishTask(task, input.expectedVersion, input.note, actor, input.decision)
  }

  private completionDecision(
    task: Task,
    card: TaskCard,
    actor: ActionActor,
    note: string | null,
  ): CompletionDecision {
    const project = this.getProject(task.projectId)
    const artifacts = this.store.read.listArtifacts(task.projectId, task.id)
    const runs = this.store.read
      .listRunSummaries(task.projectId, 100)
      .filter((run) => run.taskId === task.id)
      .slice(0, 5)
      .map((run) => this.store.read.getRunDetail(run.id))
      .filter((detail): detail is NonNullable<typeof detail> => Boolean(detail))
    return evaluateCompletion({
      task: card,
      artifacts,
      runs,
      workspaceRoot: project.rootPath,
      actorKind: actor.kind,
      humanNote: note,
    })
  }

  private finishTask(
    task: Task,
    expectedVersion: number,
    note: string | undefined,
    actor: ActionActor,
    decision: CompletionDecision,
  ): TaskCard {
    const timestamp = now()
    return this.store.transaction(() => {
      const evidence = decision.requirements
        .map((item) => `- ${item.label}：${item.satisfied ? '满足' : '缺失'}${item.evidence.length ? `（${item.evidence.join('；')}）` : ''}`)
        .join('\n')
      const artifact = {
        id: newId('art'),
        projectId: task.projectId,
        taskId: task.id,
        runId: null,
        kind: 'document' as const,
        title: `验收记录 · ${task.title}`,
        uri: null,
        contentHash: null,
        gitCommit: null,
        verifiedAt: timestamp,
        body: [
          `由 ${actor.name} 于 ${new Date(timestamp).toLocaleString('zh-CN')} 确认验收。`,
          '',
          '完成依据：',
          evidence || '- 人工验收确认',
          ...decision.toolOutcomes
            .filter((item) => item.status === 'denied' || item.status === 'failed')
            .map((item) => `- 工具 ${item.name}：${item.status}${item.detail ? `（${item.detail}）` : ''}`),
          ...decision.reasons.map((reason) => `- ${reason}`),
          note ? `\n说明：${note}` : '',
        ].filter(Boolean).join('\n'),
        isDemo: false,
        createdAt: timestamp,
      }
      this.store.createArtifact(artifact)
      this.store.appendEvent(task.projectId, task.id, PROJECT_EVENT_TYPES.artifactCreated, {
        title: artifact.title,
        kind: artifact.kind,
        actor,
        actorName: actor.name,
      })
      const updated = this.store.moveTask(task.id, expectedVersion, 'done')
      this.store.appendEvent(task.projectId, task.id, PROJECT_EVENT_TYPES.taskMoved, {
        taskTitle: task.title,
        title: task.title,
        status: 'done',
        note: note ?? null,
        actor,
        actorName: actor.name,
      })
      this.store.appendEvent(task.projectId, task.id, PROJECT_EVENT_TYPES.taskCompleted, {
        taskTitle: task.title,
        actor,
        actorName: actor.name,
      })
      const updatedCard = this.store.read.getTaskCard(updated.id)
      if (!updatedCard) throw new AppError('INTERNAL', '任务状态更新失败')
      return updatedCard
    })
  }

  addDependency(taskId: string, dependsOnId: string, actor: ActionActor = USER_ACTOR): TaskCard {
    const task = this.getTask(taskId)
    this.validateDependencies(task.projectId, taskId, [dependsOnId])
    return this.store.transaction(() => {
      try {
        this.store.addDependency(taskId, dependsOnId)
      } catch (error) {
        if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) {
          throw new AppError('CONFLICT', '依赖关系已存在')
        }
        throw error
      }
      this.store.appendEvent(task.projectId, task.id, PROJECT_EVENT_TYPES.taskDependencyAdded, {
        taskTitle: task.title,
        dependencyId: dependsOnId,
        actor,
        actorName: actor.name,
      })
      const card = this.store.read.getTaskCard(taskId)
      if (!card) throw new AppError('INTERNAL', '任务依赖更新失败')
      return card
    })
  }

  removeDependency(taskId: string, dependsOnId: string, actor: ActionActor = USER_ACTOR): TaskCard {
    const task = this.getTask(taskId)
    return this.store.transaction(() => {
      this.store.removeDependency(taskId, dependsOnId)
      this.store.appendEvent(task.projectId, task.id, PROJECT_EVENT_TYPES.taskDependencyRemoved, {
        taskTitle: task.title,
        dependencyId: dependsOnId,
        actor,
        actorName: actor.name,
      })
      const card = this.store.read.getTaskCard(taskId)
      if (!card) throw new AppError('INTERNAL', '任务依赖更新失败')
      return card
    })
  }
}
