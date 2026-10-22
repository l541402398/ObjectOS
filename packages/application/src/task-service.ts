import {
  AppError,
  newId,
  now,
  type Approval,
  type Artifact,
  type CreateTaskInput,
  type MoveTaskInput,
  type RunDetail,
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
import {
  acceptanceAuditMetadata,
  evaluateHumanAcceptance,
  type HumanAcceptancePolicy,
} from './acceptance-policy.js'
import type { ActionActor, CoreStore } from './ports.js'
import { USER_ACTOR } from './ports.js'

const HUMAN_ACCEPTANCE_REASON_MIN = 8

interface HumanAcceptanceAudit {
  policy: HumanAcceptancePolicy
  reason: string
  approvalId: string | null
  override: boolean
}


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
    const card = this.store.read.getTaskCard(task.id)
    if (!card) throw new AppError('NOT_FOUND', '任务不存在')
    if (input.to === 'done') {
      if (task.status === 'done' || task.status === 'cancelled') {
        throw new AppError('CONFLICT', '已完成或已取消的任务不能再次完成')
      }
      if (input.acceptance && actor.kind !== 'user') {
        throw new AppError('FORBIDDEN', '只有项目所有者可以提交人工验收')
      }
      const dependencies = card.dependencyIds
        .map((id) => this.store.read.getTask(id))
        .filter((dependency): dependency is Task => dependency !== null)
      assertTaskCanComplete({ task, dependencies })
      const project = this.getProject(task.projectId)
      const artifacts = this.taskArtifacts(task)
      const runs = this.taskRuns(task)
      if (actor.kind === 'user') {
        this.assertLocalOwner(actor)
        const automatic = this.completionDecision(task, card, 'system', null, artifacts, runs, project.rootPath)
        const policy = evaluateHumanAcceptance({ task: card, artifacts, runs, automatic })
        const acceptance = input.acceptance
        const reason = (acceptance?.reason ?? input.note ?? '').trim()
        if (policy.requiresApproval) {
          throw new AppError('APPROVAL_REQUIRED', '关键风险任务必须走独立的验收审批，不能直接点击完成', {
            details: { taskId: task.id, policy },
          })
        }
        if (!acceptance && policy.riskLevel !== 'normal') {
          throw new AppError('CONFLICT', '该任务为高风险，必须显式确认并填写验收理由', {
            details: { taskId: task.id, policy },
          })
        }
        const override = policy.unsatisfiedRequirements.length > 0
        const effectiveReason =
          policy.riskLevel === 'normal' && reason.length < HUMAN_ACCEPTANCE_REASON_MIN
            ? override
              ? '人工确认完成（常规验收，覆盖自动验收要求）'
              : '人工确认完成（常规验收）'
            : reason
        const minimum = HUMAN_ACCEPTANCE_REASON_MIN
        if (policy.riskLevel !== 'normal' && effectiveReason.length < minimum) {
          throw new AppError('CONFLICT', `人工验收理由至少需要 ${minimum} 个字符`, {
            details: { taskId: task.id, policy },
          })
        }
        if (policy.riskLevel === 'high' && !acceptance?.confirmHighRisk) {
          throw new AppError('CONFLICT', '高风险验收需要显式安全确认（confirmHighRisk）', {
            details: { taskId: task.id, policy },
          })
        }
        if (policy.requiresExtraEvidence && !policy.hasExtraEvidence) {
          throw new AppError('CONFLICT', '高风险验收必须提供额外的持久化证据（已验证 Artifact、真实工具结果或文件归属）', {
            details: { taskId: task.id, policy },
          })
        }
        if (override && policy.riskLevel !== 'normal' && !acceptance?.override) {
          throw new AppError('CONFLICT', '覆盖未满足的自动验收要求必须显式声明 override', {
            details: { taskId: task.id, policy },
          })
        }
        if (override && policy.riskLevel === 'normal' && effectiveReason.length < HUMAN_ACCEPTANCE_REASON_MIN) {
          throw new AppError('CONFLICT', '覆盖自动验收要求需要更完整的验收理由', {
            details: { taskId: task.id, policy },
          })
        }
        const decision = this.humanDecision(automatic, effectiveReason, override)
        const reviewTask = this.prepareDoneState(task, actor, effectiveReason)
        return this.finishTask(reviewTask, reviewTask.version, effectiveReason, actor, decision, {
          policy,
          reason: effectiveReason,
          approvalId: null,
          override,
        })
      }
      const decision = this.completionDecision(task, card, actor.kind, input.note ?? null, artifacts, runs, project.rootPath)
      if (!decision.ok) {
        throw new AppError('CONFLICT', `任务缺少有效完成依据：${decision.reasons.join('；')}`, {
          details: decision,
        })
      }
      const reviewTask = this.prepareDoneState(task, actor, input.note)
      return this.finishTask(reviewTask, reviewTask.version, input.note, actor, decision)
    }
    assertTaskTransition(task.status, input.to)
    if ((input.to === 'ready' || input.to === 'running') && card.blockedBy.length > 0) {
      throw new AppError('CONFLICT', '存在未完成的依赖任务，无法进入就绪/执行状态')
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
    if (task.status === 'done' || task.status === 'cancelled') {
      throw new AppError('CONFLICT', '已完成或已取消的任务不能再次完成')
    }
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
    const reviewTask = this.prepareDoneState(task, actor, input.note)
    return this.finishTask(reviewTask, reviewTask.version, input.note, actor, input.decision)
  }

  /** Move through the legal state path to review; done is only legal from review. */
  private prepareDoneState(task: Task, actor: ActionActor, note: string | undefined): Task {
    let current = this.getTask(task.id)
    if (current.status === 'review') return current
    const path: Task['status'][] =
      current.status === 'blocked' || current.status === 'backlog'
        ? ['ready', 'running', 'review']
        : current.status === 'ready'
          ? ['running', 'review']
          : current.status === 'running'
            ? ['review']
            : []
    for (const to of path) {
      current = this.store.moveTask(current.id, current.version, to)
      this.store.appendEvent(current.projectId, current.id, PROJECT_EVENT_TYPES.taskMoved, {
        taskTitle: current.title,
        title: current.title,
        status: to,
        note: note ?? `完成前状态整理：${to}`,
        actor,
        actorName: actor.name,
      })
    }
    if (current.status !== 'review') {
      throw new AppError('CONFLICT', `任务当前状态 ${current.status} 不能进入完成`)
    }
    return current
  }

  private taskArtifacts(task: Task): Artifact[] {
    return this.store.read.listArtifacts(task.projectId, task.id)
  }

  private taskRuns(task: Task): RunDetail[] {
    return this.store.read
      .listRunSummaries(task.projectId, 100)
      .filter((run) => run.taskId === task.id)
      .slice(0, 5)
      .map((run) => this.store.read.getRunDetail(run.id))
      .filter((detail): detail is NonNullable<typeof detail> => Boolean(detail))
  }

  private completionDecision(
    task: Task,
    card: TaskCard,
    actorKind: ActionActor['kind'],
    note: string | null,
    artifacts: Artifact[],
    runs: RunDetail[],
    workspaceRoot: string,
  ): CompletionDecision {
    return evaluateCompletion({
      task: card,
      artifacts,
      runs,
      workspaceRoot,
      actorKind,
      humanNote: note,
    })
  }

  private assertLocalOwner(actor: ActionActor): void {
    if (actor.kind !== 'user' || actor.id !== USER_ACTOR.id) {
      throw new AppError('FORBIDDEN', '只有本机项目所有者（local-user）可以执行人工验收', {
        details: { actorKind: actor.kind, actorId: actor.id },
      })
    }
  }

  private humanDecision(automatic: CompletionDecision, reason: string, override: boolean): CompletionDecision {
    const overridden = automatic.requirements.filter((requirement) => !requirement.satisfied)
    return {
      ok: true,
      role: automatic.role,
      requirements: [
        { id: 'human', label: '人工验收确认', satisfied: true, evidence: [`理由：${reason}`], missing: [] },
        ...automatic.requirements.map((requirement) => ({
          ...requirement,
          ...(requirement.satisfied ? {} : { overridden: true }),
        })),
      ] as CompletionDecision['requirements'],
      toolOutcomes: automatic.toolOutcomes,
      reasons: [
        ...automatic.reasons,
        ...(override ? [`人工覆盖未满足项：${overridden.map((item) => item.label).join('；')}`] : []),
      ],
    }
  }

  acceptancePolicy(taskId: string): HumanAcceptancePolicy {
    const task = this.getTask(taskId)
    const card = this.store.read.getTaskCard(task.id)
    if (!card) throw new AppError('NOT_FOUND', '任务不存在')
    const project = this.getProject(task.projectId)
    const artifacts = this.taskArtifacts(task)
    const runs = this.taskRuns(task)
    const automatic = this.completionDecision(task, card, 'system', null, artifacts, runs, project.rootPath)
    return evaluateHumanAcceptance({ task: card, artifacts, runs, automatic })
  }

  /**
   * Critical-risk tasks need a separate, explicit acceptance approval. This uses
   * the existing Approval store/entity; the project owner is the only approver.
   */
  requestAcceptance(input: { taskId: string; reason: string }, actor: ActionActor = USER_ACTOR): {
    approvalId: string
    policy: HumanAcceptancePolicy
  } {
    this.assertLocalOwner(actor)
    const task = this.getTask(input.taskId)
    if (task.status === 'done' || task.status === 'cancelled') {
      throw new AppError('CONFLICT', '已完成或已取消的任务不能申请验收')
    }
    const policy = this.acceptancePolicy(task.id)
    if (!policy.requiresApproval) {
      throw new AppError('CONFLICT', '该任务风险等级不需要独立验收审批')
    }
    if (!policy.hasExtraEvidence) {
      throw new AppError('CONFLICT', '关键风险任务缺少可核验的额外证据，不能申请验收', {
        details: { policy },
      })
    }
    const reason = input.reason.trim()
    if (reason.length < HUMAN_ACCEPTANCE_REASON_MIN) {
      throw new AppError('CONFLICT', `验收理由至少需要 ${HUMAN_ACCEPTANCE_REASON_MIN} 个字符`)
    }
    const pending = this.store.read
      .listApprovalViews(task.projectId)
      .find(
        (approval) =>
          approval.status === 'pending' &&
          approval.request?.kind === 'task-acceptance' &&
          approval.request?.taskId === task.id,
      )
    if (pending) return { approvalId: pending.id, policy }
    const latestRun = this.store.read
      .listRunSummaries(task.projectId, 100)
      .filter((run) => run.taskId === task.id)
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0]
    if (!latestRun) {
      throw new AppError('CONFLICT', '关键风险验收需要至少一次真实运行作为副作用依据')
    }
    const approval = this.store.createApproval({
      projectId: task.projectId,
      runId: latestRun.id,
      toolCallId: null,
      title: `高风险任务验收 · ${task.title}`,
      detail: `风险：${policy.reasons.join('；')}\n理由：${reason}`,
      request: {
        kind: 'task-acceptance',
        taskId: task.id,
        taskVersion: task.version,
        riskLevel: policy.riskLevel,
        riskReasons: policy.reasons,
        evidence: policy.evidence,
        unsatisfiedRequirements: policy.unsatisfiedRequirements,
        reason,
        override: true,
      },
      expiresAt: now() + 24 * 60 * 60 * 1000,
    })
    this.store.appendEvent(task.projectId, approval.id, PROJECT_EVENT_TYPES.approvalRequested, {
      approvalId: approval.id,
      taskId: task.id,
      title: approval.title,
      riskLevel: policy.riskLevel,
      actor,
      actorName: actor.name,
    })
    return { approvalId: approval.id, policy }
  }

  decideAcceptance(
    input: { approvalId: string; decision: 'approved' | 'rejected'; note?: string },
    actor: ActionActor = USER_ACTOR,
  ): Approval {
    this.assertLocalOwner(actor)
    const approval = this.store.getApprovalById(input.approvalId)
    if (!approval) throw new AppError('NOT_FOUND', '验收审批不存在')
    if (approval.request?.kind !== 'task-acceptance') {
      throw new AppError('BAD_REQUEST', '该审批不是任务验收审批')
    }
    if (approval.status !== 'pending') {
      throw new AppError('CONFLICT', '该验收审批已被处理')
    }
    if (approval.expiresAt && approval.expiresAt <= now()) {
      this.store.decideApproval(approval.id, 'rejected', '验收审批已过期')
      throw new AppError('CONFLICT', '该验收审批已过期')
    }
    const updated = this.store.decideApproval(approval.id, input.decision, input.note ?? '')
    this.store.appendEvent(approval.projectId, approval.id, PROJECT_EVENT_TYPES.approvalDecided, {
      approvalId: approval.id,
      decision: input.decision,
      taskId: approval.request?.taskId ?? null,
      note: input.note ?? '',
      actor,
      actorName: actor.name,
    })
    return updated
  }

  confirmAcceptance(
    input: { taskId: string; approvalId: string; note?: string },
    actor: ActionActor = USER_ACTOR,
  ): TaskCard {
    this.assertLocalOwner(actor)
    const task = this.getTask(input.taskId)
    if (task.status === 'done' || task.status === 'cancelled') {
      throw new AppError('CONFLICT', '已完成或已取消的任务不能再次完成')
    }
    const approval = this.store.getApprovalById(input.approvalId)
    if (!approval) throw new AppError('NOT_FOUND', '验收审批不存在')
    if (approval.request?.kind !== 'task-acceptance' || approval.request?.taskId !== task.id) {
      throw new AppError('CONFLICT', '验收审批与任务不匹配')
    }
    if (approval.status === 'rejected' || approval.status === 'expired' || approval.status === 'cancelled') {
      throw new AppError('CONFLICT', '验收审批未通过，不能完成任务')
    }
    if (approval.status !== 'approved') {
      throw new AppError('APPROVAL_REQUIRED', '验收审批尚未批准')
    }
    const card = this.store.read.getTaskCard(task.id)
    if (!card) throw new AppError('NOT_FOUND', '任务不存在')
    const project = this.getProject(task.projectId)
    const artifacts = this.taskArtifacts(task)
    const runs = this.taskRuns(task)
    const automatic = this.completionDecision(task, card, 'system', null, artifacts, runs, project.rootPath)
    const policy = evaluateHumanAcceptance({ task: card, artifacts, runs, automatic })
    if (!policy.requiresApproval) {
      throw new AppError('CONFLICT', '任务风险已变化，不再需要验收审批')
    }
    const requestReason = typeof approval.request.reason === 'string' ? approval.request.reason : ''
    const reason = [requestReason, input.note ?? ''].filter(Boolean).join('；').trim()
    const override = policy.unsatisfiedRequirements.length > 0
    const decision = this.humanDecision(automatic, reason, override)
    const reviewTask = this.prepareDoneState(task, actor, reason)
    return this.finishTask(reviewTask, reviewTask.version, reason, actor, decision, {
      policy,
      reason,
      approvalId: approval.id,
      override,
    })
  }

  private finishTask(
    task: Task,
    expectedVersion: number,
    note: string | undefined,
    actor: ActionActor,
    decision: CompletionDecision,
    audit?: HumanAcceptanceAudit,
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
        metadata: {
          acceptanceMode: actor.kind === 'user' ? 'human' : 'automatic',
          actorKind: actor.kind,
          actorId: actor.id,
          taskId: task.id,
          role: decision.role,
          requirements: decision.requirements.map((item) => ({
            id: item.id,
            satisfied: item.satisfied,
            evidence: item.evidence,
          })),
          ...(audit
            ? acceptanceAuditMetadata({
                policy: audit.policy,
                reason: audit.reason,
                actor,
                decidedAt: timestamp,
                approvalId: audit.approvalId,
                override: audit.override,
              })
            : {}),
        },
        verifiedAt: timestamp,
        body: [
          `${actor.kind === 'user' ? '人工验收' : '自动验收'}：由 ${actor.name} 于 ${new Date(timestamp).toLocaleString('zh-CN')} 确认。`,
          '',
          ...(audit
            ? [
                `风险等级：${audit.policy.riskLevel}`,
                `风险依据：${audit.policy.reasons.join('；') || '无写入/进程/敏感路径'} `,
                `验收理由：${audit.reason}`,
                `额外证据：已验证 Artifact ${audit.policy.evidence.verifiedArtifacts} 个；工具 ${audit.policy.evidence.successfulTools.join(', ') || '无'}；文件归属 ${audit.policy.evidence.attributedFiles} 个`,
                ...(audit.override
                  ? [`覆盖的自动要求：${audit.policy.unsatisfiedRequirements.join('；') || '无'}`]
                  : []),
                ...(audit.approvalId ? [`验收审批：${audit.approvalId}`] : []),
                '',
              ]
            : []),
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
