import {
  AppError,
  newId,
  now,
  type GraphLayout,
  type PlanDraft,
  type PlanUpdateInput,
  type ProjectSnapshot,
} from '@projectos/contracts'
import type { CoreServices } from '@projectos/application'
import type { SqliteStore } from '@projectos/persistence'
import { buildGraphSnapshot } from '@projectos/graph-projection'
import {
  agentForPlanRole,
  criticalPathTasks,
  generateLocalPlan,
  topologicalPlanTasks,
  validatePlanDraft,
} from '@projectos/planning'
import { scanProject } from '@projectos/project-analyzer'
import { getGitStatus } from '@projectos/workspace'

export class OrchestrationService {
  constructor(
    private readonly store: SqliteStore,
    private readonly services: CoreServices,
  ) {}

  async scan(projectId: string): Promise<ProjectSnapshot> {
    const project = this.store.read.getProject(projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    const git = await getGitStatus(project.rootPath)
    const snapshot = await scanProject({
      projectId,
      rootPath: project.rootPath,
      gitHead: git?.lastCommit?.hash ?? null,
    })
    this.store.saveProjectSnapshot(snapshot)
    this.indexSnapshot(projectId, project.name, snapshot)
    return snapshot
  }

  private indexSnapshot(projectId: string, projectName: string, snapshot: ProjectSnapshot): void {
    const existing = this.store.read
      .listKnowledge(projectId)
      .some((entry) => entry.sourceUri?.startsWith('projectos://snapshot/'))
    if (existing) return
    this.store.createKnowledge({
      id: newId('knw'),
      projectId,
      title: `项目索引 · ${projectName}`.slice(0, 240),
      body: [
        `语言：${snapshot.languages.join(' / ') || '未知'}`,
        `包管理器：${snapshot.packageManager ?? '未知'}`,
        `框架：${snapshot.frameworks.map((item) => item.name).join(' / ') || '未知'}`,
        `模块：${snapshot.modules.slice(0, 40).map((item) => `${item.path} (${item.kind})`).join(' / ') || '未知'}`,
        `关键依赖：${snapshot.keyDependencies.slice(0, 40).join(' / ') || '无'}`,
        `Git HEAD：${snapshot.gitHead ?? '—'}`,
        snapshot.warnings.length ? `警告：${snapshot.warnings.join(' / ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      sourceUri: `projectos://snapshot/${snapshot.id}`,
      sourceVersion: snapshot.gitHead ?? String(snapshot.scannedAt),
    })
  }

  snapshot(projectId: string): ProjectSnapshot | null {
    if (!this.store.read.getProject(projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    return this.store.read.getLatestProjectSnapshot(projectId)
  }

  metrics(projectId: string) {
    if (!this.store.read.getProject(projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    const board = this.services.tasks.board(projectId)
    const done = board.tasks.filter((task) => task.status === 'done')
    const blocked = board.tasks.filter((task) => task.status === 'blocked')
    const runs = this.store.read.listRunSummaries(projectId, 500)
    const activeRuns = runs.filter((run) => ['created', 'queued', 'running', 'waiting_tool', 'waiting_approval', 'verifying', 'needs_reconciliation'].includes(run.status))
    const agents = this.services.projects.listAgents(projectId)
    const plans = this.store.read.listPlanRevisions(projectId)
    const approved = plans.find((plan) => plan.status === 'approved')
    const critical = approved
      ? criticalPathTasks(approved).map((task) => ({ key: task.key, title: task.title }))
      : []
    const cutoff = now() - 7 * 24 * 60 * 60 * 1000
    const cycleTimes = done.map((task) => Math.max(0, task.updatedAt - task.createdAt))
    return {
      projectId,
      tasksTotal: board.tasks.length,
      tasksDone: done.length,
      completionRate: board.tasks.length ? done.length / board.tasks.length : 0,
      blockedTasks: blocked.length,
      activeRuns: activeRuns.length,
      averageCycleTimeMs: cycleTimes.length
        ? Math.round(cycleTimes.reduce((sum, value) => sum + value, 0) / cycleTimes.length)
        : 0,
      throughput7d: done.filter((task) => task.updatedAt >= cutoff).length,
      agents: agents.map((view) => ({
        agentId: view.agent.id,
        name: view.agent.name,
        runs: runs.filter((run) => run.agentId === view.agent.id).length,
        completed: runs.filter((run) => run.agentId === view.agent.id && run.status === 'completed').length,
      })),
      criticalPath: critical,
      planRevision: approved?.revision ?? null,
    }
  }

  generatePlan(projectId: string, goal: string): PlanDraft {
    if (!this.store.read.getProject(projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    const snapshot = this.store.read.getLatestProjectSnapshot(projectId)
    const plan = generateLocalPlan({
      projectId,
      goal,
      revision: this.store.read.getNextPlanRevision(projectId),
      snapshot,
    })
    validatePlanDraft(plan)
    this.store.createPlanRevision(plan)
    return plan
  }

  listPlans(projectId: string): PlanDraft[] {
    if (!this.store.read.getProject(projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    return this.store.read.listPlanRevisions(projectId)
  }

  getPlan(planId: string): PlanDraft {
    const plan = this.store.read.getPlanRevision(planId)
    if (!plan) throw new AppError('NOT_FOUND', '计划不存在')
    return plan
  }

  updatePlan(input: PlanUpdateInput): PlanDraft {
    const plan = this.getPlan(input.planId)
    if (plan.status !== 'draft') throw new AppError('CONFLICT', '只有草稿计划可以编辑；已批准计划请创建新 revision')
    const next: PlanDraft = {
      ...plan,
      goal: input.goal ?? plan.goal,
      tasks: input.tasks ?? plan.tasks,
      assumptions: input.assumptions ?? plan.assumptions,
      risks: input.risks ?? plan.risks,
      updatedAt: now(),
    }
    validatePlanDraft(next)
    this.store.updatePlanRevision(next)
    return next
  }

  revisePlan(input: PlanUpdateInput): PlanDraft {
    const source = this.getPlan(input.planId)
    if (source.status === 'draft') return this.updatePlan(input)
    if (source.execution?.status === 'running') {
      throw new AppError('CONFLICT', '执行中的计划不能修订，请先暂停或取消')
    }
    const revision = this.store.read.getNextPlanRevision(source.projectId)
    const next: PlanDraft = {
      id: newId('pln'),
      projectId: source.projectId,
      revision,
      status: 'draft',
      goal: input.goal ?? source.goal,
      tasks: input.tasks ?? source.tasks,
      assumptions: input.assumptions ?? source.assumptions,
      risks: input.risks ?? source.risks,
      generatedBy: source.generatedBy,
      createdAt: now(),
      updatedAt: now(),
      approvedAt: null,
      createdTaskIds: [],
      execution: null,
    }
    validatePlanDraft(next)
    this.store.createPlanRevision(next)
    return next
  }

  approvePlan(planId: string): { plan: PlanDraft; taskIds: string[] } {
    const plan = this.getPlan(planId)
    if (plan.status !== 'draft') throw new AppError('CONFLICT', '计划不是草稿状态')
    validatePlanDraft(plan)
    const ordered = topologicalPlanTasks(plan)
    const taskIdByKey = new Map<string, string>()
    const created = this.store.transaction(() => {
      const ids: string[] = []
      for (const planned of ordered) {
        const dependsOn = planned.dependsOn.map((key) => {
          const id = taskIdByKey.get(key)
          if (!id) throw new AppError('INTERNAL', `计划依赖顺序错误：${key}`)
          return id
        })
        const task = this.services.tasks.create({
          projectId: plan.projectId,
          title: planned.title,
          description: planned.description,
          priority: 2,
          acceptanceCriteria: planned.acceptanceCriteria,
          labels: ['plan', planned.role],
          assigneeAgentId: agentForPlanRole(planned.role),
          milestoneId: null,
          dependsOn,
          dueAt: null,
        })
        taskIdByKey.set(planned.key, task.id)
        ids.push(task.id)
      }
      const approved: PlanDraft = {
        ...plan,
        status: 'approved',
        approvedAt: now(),
        updatedAt: now(),
        createdTaskIds: ids,
      }
      this.store.updatePlanRevision(approved)
      return { plan: approved, taskIds: ids }
    })
    return created
  }

  rejectPlan(planId: string): PlanDraft {
    const plan = this.getPlan(planId)
    if (plan.status !== 'draft') throw new AppError('CONFLICT', '计划不是草稿状态')
    const rejected: PlanDraft = { ...plan, status: 'rejected', updatedAt: now() }
    this.store.updatePlanRevision(rejected)
    return rejected
  }

  graph(projectId: string) {
    const project = this.store.read.getProject(projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    const board = this.services.tasks.board(projectId)
    const latestRuns: Record<string, ReturnType<SqliteStore['read']['getLatestRunForTask']>> = {}
    for (const task of board.tasks) latestRuns[task.id] = this.store.read.getLatestRunForTask(task.id)
    const layout = this.store.read.getGraphLayout(projectId)
    return buildGraphSnapshot({
      projectId,
      projectName: project.name,
      lastEventSeq: this.store.read.getLastEventSeq(projectId),
      agents: this.services.projects.listAgents(projectId),
      tasks: board.tasks,
      latestRuns,
      layout,
    })
  }

  saveLayout(input: { projectId: string; viewId: string; positions: GraphLayout['positions'] }): void {
    if (!this.store.read.getProject(input.projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    this.store.saveGraphLayout({
      projectId: input.projectId,
      viewId: input.viewId || 'default',
      positions: input.positions,
      updatedAt: now(),
    })
  }
}

