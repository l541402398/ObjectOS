import {
  AppError,
  newId,
  now,
  type GraphLayout,
  type PlanDraft,
  type PlanGeneration,
  type PlannedTask,
  type PlanUpdateInput,
  type ProjectSnapshot,
} from '@projectos/contracts'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import type { CoreServices } from '@projectos/application'
import type { SqliteStore } from '@projectos/persistence'
import { buildGraphSnapshot } from '@projectos/graph-projection'
import {
  agentForPlanRole,
  agentForPlannedTask,
  criticalPathTasks,
  generateLocalPlan,
  mergeHardCapabilities,
  resolveAgentAssignment,
  topologicalPlanTasks,
  validatePlanDraft,
  type AssignmentCandidate,
} from '@projectos/planning'
import { scanProject } from '@projectos/project-analyzer'
import { getGitStatus } from '@projectos/workspace'
import { planGroupTitle, planSessionTitle } from '@projectos/session-manager'
import { buildAssignmentCandidates as buildCandidateSnapshot } from './assignment-candidates.js'
import type { PlannerService } from './planner.js'

const LOCAL_RULES_PROMPT_VERSION = 'local-rules-v1'

export interface AiPlanGenerationInput {
  projectId: string
  goal: string
  mode: 'ai' | 'local'
  allowRuleFallback: boolean
  maxTasks: number
  allowOverBudget: boolean
}

export class OrchestrationService {
  constructor(
    private readonly store: SqliteStore,
    private readonly services: CoreServices,
    private readonly planner: PlannerService | null = null,
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
      .find((entry) => entry.sourceUri?.startsWith('projectos://snapshot/'))
    const title = `项目索引 · ${projectName}`.slice(0, 240)
    const body = [
      `语言：${snapshot.languages.join(' / ') || '未知'}`,
      `包管理器：${snapshot.packageManager ?? '未知'}`,
      `框架：${snapshot.frameworks.map((item) => item.name).join('、') || '未知'}`,
      `模块：${snapshot.modules.slice(0, 40).map((item) => `${item.path} (${item.kind})`).join('、') || '未知'}`,
      `关键依赖：${snapshot.keyDependencies.slice(0, 40).join('、') || '无'}`,
      `Git HEAD：${snapshot.gitHead ?? '—'}`,
      snapshot.warnings.length ? `警告：${snapshot.warnings.join(' / ')}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    const sourceVersion = snapshot.gitHead ?? String(snapshot.scannedAt)
    if (existing) {
      this.store.updateKnowledge(existing.id, { title, body, sourceVersion })
      return
    }
    this.store.createKnowledge({
      id: newId('knw'),
      projectId,
      title,
      body,
      sourceUri: `projectos://snapshot/${snapshot.id}`,
      sourceVersion,
    })
  }

  snapshot(projectId: string): ProjectSnapshot | null {
    if (!this.store.read.getProject(projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    return this.store.read.getLatestProjectSnapshot(projectId)
  }

  budget(projectId: string) {
    if (!this.store.read.getProject(projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    const budget = this.store.read.getProjectBudget(projectId)
    const spent = this.store.read.summarizeAIUsage(projectId).estimatedCost
    const remaining = budget ? Math.max(0, budget.softLimit - spent) : null
    return {
      budget,
      spent,
      remaining,
      exceeded: Boolean(budget && budget.softLimit > 0 && spent > budget.softLimit),
    }
  }

  setBudget(projectId: string, softLimit: number, currency: string) {
    if (!this.store.read.getProject(projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    this.store.upsertProjectBudget({ projectId, softLimit, currency })
    return this.budget(projectId)
  }

  metrics(projectId: string) {    if (!this.store.read.getProject(projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    const board = this.services.tasks.board(projectId)
    const done = board.tasks.filter((task) => task.status === 'done')
    const blocked = board.tasks.filter((task) => task.status === 'blocked')
    const runs = this.store.read.listRunSummaries(projectId, 500)
    const activeRuns = runs.filter((run) => ['created', 'queued', 'running', 'waiting_tool', 'waiting_approval', 'verifying', 'needs_reconciliation'].includes(run.status))
    const agents = this.services.projects.listAgents(projectId)
    const plans = this.store.read.listPlanRevisions(projectId)
    const approved = plans.find((plan) => plan.status === 'approved')
    // After a revision supersedes the approved plan, the metrics must keep
    // pointing at the last plan that actually owns Tasks instead of going empty.
    const reference =
      approved ??
      [...plans]
        .filter((plan) => plan.createdTaskIds.length > 0)
        .sort((a, b) => b.revision - a.revision)[0] ??
      null
    const critical = reference
      ? criticalPathTasks(reference).map((task) => ({ key: task.key, title: task.title }))
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
      planRevision: reference?.revision ?? null,
      planStatus: reference?.status ?? null,
    }
  }

  private buildAssignmentCandidates(plan: PlanDraft): AssignmentCandidate[] {
    return buildCandidateSnapshot({
      store: this.store,
      projectId: plan.projectId,
      listAgents: (projectId) => this.services.projects.listAgents(projectId),
      listTasks: (projectId) => this.services.tasks.board(projectId).tasks,
    })
  }

  /** Resolve unassigned nodes; explicit user choices are preserved. */
  private assignPlanAgents(plan: PlanDraft, explicitKeys: Set<string> = new Set()): PlanDraft {
    if (plan.tasks.length === 0) return plan
    const candidates = this.buildAssignmentCandidates(plan)
    return {
      ...plan,
      tasks: plan.tasks.map((task) => {
        // `assignmentMode` is persisted with the plan. A node the user assigned
        // stays explicit forever; an auto-resolved node keeps its origin so the
        // scheduler can safely swap a failed Handoff receiver later.
        const mode: 'auto' | 'explicit' = explicitKeys.has(task.key)
          ? 'explicit'
          : task.assignmentMode ?? (task.agentId ? 'explicit' : 'auto')
        const hardCapabilities = mergeHardCapabilities(task.role, task.hardCapabilities)
        const assignment = resolveAgentAssignment({
          role: task.role,
          title: task.title,
          description: task.description,
          explicitAgentId: mode === 'explicit' ? task.agentId ?? null : null,
          defaultAgentId: agentForPlanRole(task.role),
          requiredCapabilities: task.requiredCapabilities,
          hardCapabilities,
          candidates,
        })
        return {
          ...task,
          hardCapabilities,
          agentId: assignment.agentId,
          assignmentReasons: assignment.reasons,
          assignmentBlocked: assignment.blocked,
          assignmentMode: mode,
        }
      }),
      updatedAt: now(),
    }
  }

  /**
   * Revision reuse references. Only *completed* old tasks are linked; they are
   * never re-executed or silently treated as fresh evidence for the new task.
   */
  private requirementText(values: readonly string[]): string {
    // Formatting-only changes (one line vs several) do not change what must be
    // verified. Any wording/order change still changes this signature.
    return values.map((value) => value.trim()).join('；').replace(/\s+/g, ' ').trim()
  }

  private taskRequirementSignature(task: PlannedTask): string {
    return JSON.stringify({
      role: task.role,
      acceptance: this.requirementText(task.acceptanceCriteria),
      artifacts: this.requirementText(task.expectedArtifacts),
      // Soft preferences may change without invalidating completed work; hard
      // role/capability requirements are the safety boundary.
      hard: [...(task.hardCapabilities ?? [])].sort(),
    })
  }

  private reuseReferences(
    source: PlanDraft,
    nextTasks: PlannedTask[] = source.tasks,
  ): Map<string, { taskId: string; artifactIds: string[] }> {
    const result = new Map<string, { taskId: string; artifactIds: string[] }>()
    if (source.createdTaskIds.length === 0) return result
    const ordered = topologicalPlanTasks(source)
    const oldByKey = new Map(ordered.map((task) => [task.key, task]))
    const newByKey = new Map(nextTasks.map((task) => [task.key, task]))
    source.createdTaskIds.forEach((taskId, index) => {
      const key = ordered[index]?.key
      if (!key) return
      const oldPlanTask = oldByKey.get(key)
      const newPlanTask = newByKey.get(key)
      if (!oldPlanTask || !newPlanTask) return
      // A same key/title alone is never enough: changing acceptance or expected
      // artifacts requires new evidence and therefore a fresh execution.
      if (this.taskRequirementSignature(oldPlanTask) !== this.taskRequirementSignature(newPlanTask)) return
      const task = this.store.read.getTask(taskId)
      if (!task || task.status !== 'done') return
      result.set(key, {
        taskId,
        artifactIds: this.store.read.listArtifacts(source.projectId, taskId).map((artifact) => artifact.id),
      })
    })
    return result
  }

  private validatePlanAgents(plan: PlanDraft, strict = false): void {
    const profiles = strict ? this.store.read.listRuntimeProfiles() : []
    for (const task of plan.tasks) {
      const reasons = task.assignmentReasons ?? []
      if (task.assignmentBlocked) {
        if (strict) {
          throw new AppError(
            'CONFLICT',
            `计划节点「${task.title}」暂无可用 Agent：${reasons.join('；') || '未找到匹配的 Agent'}。请手动选择 Agent，或修复 Runtime/Skill 后重试。`,
          )
        }
        continue
      }
      const agentId = task.agentId ?? agentForPlannedTask(task)
      const agent = this.store.read.getAgent(agentId)
      if (!agent) {
        if (strict) {
          throw new AppError('BAD_REQUEST', `计划节点「${task.title}」绑定的 Agent 不存在：${agentId}`)
        }
        continue
      }
      const definition = this.store.read.getAgentDefinition(agentId)
      if (definition && definition.status !== 'active') {
        if (strict) {
          throw new AppError('CONFLICT', `计划节点「${task.title}」绑定的 Agent 当前不可用：${definition.status}`)
        }
        continue
      }
      if (strict) {
        const profileId = definition?.primaryRuntimeProfileId ?? definition?.runtimeProfileIds[0] ?? null
        if (profileId) {
          const profile = profiles.find((item) => item.id === profileId)
          if (!profile || profile.status !== 'available') {
            throw new AppError(
              'CONFLICT',
              `计划节点「${task.title}」绑定的 Runtime 不可用：${profile?.name ?? profileId}（${profile?.status ?? 'missing'}）`,
            )
          }
        }
      }
    }
  }

  private ensurePlanCollaboration(plan: PlanDraft): void {
    const agentIds = [
      ...new Set(
        plan.tasks
          .filter((task) => !task.assignmentBlocked)
          .map((task) => agentForPlannedTask(task))
          .filter((id): id is string => Boolean(id)),
      ),
    ]
    if (agentIds.length === 0) return
    const existing = this.services.sessions.list(plan.projectId)
    for (const agentId of agentIds) {
      const agent = this.store.read.getAgent(agentId)
      const title = planSessionTitle(agent?.name ?? 'Agent', plan.revision)
      if (existing.some((session) => session.agentId === agentId && session.title === title)) continue
      const session = this.services.sessions.create(
        { projectId: plan.projectId, agentId, title },
        { kind: 'system', id: 'orchestrator', name: '编排器' },
      )
      this.store.appendMessage({
        sessionId: session.id,
        role: 'system',
        content: `计划「${plan.goal}」已生成，正在等待批准。\n\n你会参与其中的任务讨论与执行；批准后可在编排工作台确认开始。`,
        metadata: { kind: 'plan-draft', planId: plan.id, revision: plan.revision },
      })
    }
    const groupTitle = planGroupTitle(plan.goal, plan.revision)
    if (!existing.some((session) => session.title === groupTitle)) {
      const lead = agentIds[0]!
      const participants = agentIds.map((agentId) => this.store.read.getAgent(agentId)?.name ?? 'Agent').join('、')
      const group = this.services.sessions.create(
        { projectId: plan.projectId, agentId: lead, title: groupTitle },
        { kind: 'system', id: 'orchestrator', name: '编排器' },
      )
      this.store.appendMessage({
        sessionId: group.id,
        role: 'system',
        content: `计划群聊已建立（草案）。\n目标：${plan.goal}\n参与 Agent：${participants}\n\n批准后，用户和所有 Agent 的讨论都会进入本群聊。`,
        metadata: { kind: 'plan-group', planId: plan.id, revision: plan.revision },
      })
    }
  }

  /** Synchronous local-rules draft, kept as the deterministic fallback path. */
  generatePlan(projectId: string, goal: string): PlanDraft {
    return this.persistLocalPlan(projectId, goal).plan
  }

  private persistLocalPlan(
    projectId: string,
    goal: string,
    generation?: PlanGeneration | null,
  ): { plan: PlanDraft } {
    if (!this.store.read.getProject(projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    const snapshot = this.store.read.getLatestProjectSnapshot(projectId)
    const startedAt = Date.now()
    const local = generateLocalPlan({
      projectId,
      goal,
      revision: this.store.read.getNextPlanRevision(projectId),
      snapshot,
    })
    const plan: PlanDraft = {
      ...this.assignPlanAgents(local),
      generation:
        generation ??
        {
          mode: 'local-rules',
          promptVersion: LOCAL_RULES_PROMPT_VERSION,
          connectionId: null,
          connectionName: null,
          model: null,
          protocol: null,
          attempts: 0,
          durationMs: Math.max(0, Date.now() - startedAt),
          maxTasks: local.tasks.length,
          contextChars: 0,
          estimatedInputTokens: null,
          inputTokens: null,
          outputTokens: null,
          fallbackReason: null,
          warnings: ['本地规则草稿使用固定任务模板，不代表模型理解或真实执行结果。'],
          contextSources: [],
        },
    }
    validatePlanDraft(plan)
    this.validatePlanAgents(plan)
    this.store.createPlanRevision(plan)
    this.ensurePlanCollaboration(plan)
    this.recordPlanGenerated(plan)
    return { plan }
  }

  private recordPlanGenerated(plan: PlanDraft): void {
    this.store.appendEvent(plan.projectId, plan.id, PROJECT_EVENT_TYPES.planGenerated, {
      planId: plan.id,
      revision: plan.revision,
      goal: plan.goal,
      generatedBy: plan.generatedBy,
      mode: plan.generation?.mode ?? plan.generatedBy,
      connectionId: plan.generation?.connectionId ?? null,
      connectionName: plan.generation?.connectionName ?? null,
      model: plan.generation?.model ?? null,
      taskCount: plan.tasks.length,
      attempts: plan.generation?.attempts ?? 0,
      durationMs: plan.generation?.durationMs ?? 0,
      fallbackReason: plan.generation?.fallbackReason ?? null,
    })
  }

  /**
   * Phase 2B-1 entry point. It builds exactly one validated draft; it never
   * approves it, creates Tasks, starts the Scheduler or executes a tool.
   */
  async generateAIPlan(input: AiPlanGenerationInput): Promise<PlanDraft> {
    if (!this.store.read.getProject(input.projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    const goal = input.goal.trim()
    if (goal.length < 3) throw new AppError('BAD_REQUEST', '计划目标至少需要 3 个字符')

    if (input.mode === 'local') {
      return this.persistLocalPlan(input.projectId, goal).plan
    }
    if (!this.planner) {
      throw new AppError(
        'PROVIDER_NOT_CONFIGURED',
        'AI Planner 尚未初始化，无法调用当前 AI 连接。请重启应用或在设置中重新保存连接。',
      )
    }

    const revision = this.store.read.getNextPlanRevision(input.projectId)
    const planId = newId('pln')
    const requestId = newId('plr')
    const startedAt = Date.now()
    let generated: Awaited<ReturnType<PlannerService['generate']>>
    try {
      generated = await this.planner.generate({
        projectId: input.projectId,
        goal,
        revision,
        planId,
        requestId,
        maxTasks: input.maxTasks,
        allowOverBudget: input.allowOverBudget,
      })
    } catch (error) {
      if (!input.allowRuleFallback) throw error
      const message = error instanceof Error ? error.message : String(error)
      const errorDetails = error instanceof AppError && error.details && typeof error.details === 'object'
        ? (error.details as Record<string, unknown>)
        : null
      const attempts = typeof errorDetails?.attempts === 'number' ? errorDetails.attempts : 1
      const fallbackPlan = this.persistLocalPlan(input.projectId, goal, {
        mode: 'local-rules',
        promptVersion: LOCAL_RULES_PROMPT_VERSION,
        connectionId: null,
        connectionName: null,
        model: null,
        protocol: null,
        attempts,
        durationMs: Math.max(0, Date.now() - startedAt),
        maxTasks: input.maxTasks,
        contextChars: 0,
        estimatedInputTokens: null,
        inputTokens: null,
        outputTokens: null,
        fallbackReason: message.slice(0, 2000),
        warnings: [
          '模型规划失败，已明确回退到本地规则模板；来源标记为 local-rules，不冒充模型生成。',
          '本地规则模板不会根据项目上下文调整任务数量。',
        ],
        contextSources: [],
      }).plan
      return fallbackPlan
    }

    const plan: PlanDraft = {
      ...this.assignPlanAgents({
        id: planId,
        projectId: input.projectId,
        revision,
        status: 'draft',
        goal,
        tasks: generated.tasks,
        assumptions: generated.assumptions,
        risks: generated.risks,
        generatedBy: 'provider',
        generation: generated.generation,
        createdAt: now(),
        updatedAt: now(),
        approvedAt: null,
        createdTaskIds: [],
        execution: null,
      }),
      updatedAt: now(),
    }
    validatePlanDraft(plan)
    this.validatePlanAgents(plan)
    this.store.createPlanRevision(plan)
    this.ensurePlanCollaboration(plan)
    this.recordPlanGenerated(plan)
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
    const tasks = input.tasks ?? plan.tasks
    const previousByKey = new Map(plan.tasks.map((task) => [task.key, task]))
    // A node whose Agent changed relative to the stored draft is a deliberate
    // user choice: persist it as explicit so Handoff fallback never overrides it.
    const explicitKeys = new Set<string>()
    for (const task of tasks) {
      const previousAgentId = previousByKey.get(task.key)?.agentId ?? null
      if (task.agentId && task.agentId !== previousAgentId) explicitKeys.add(task.key)
    }
    const next: PlanDraft = this.assignPlanAgents(
      {
        ...plan,
        goal: input.goal ?? plan.goal,
        versionId: input.versionId ?? plan.versionId ?? null,
        iterationId: input.iterationId ?? plan.iterationId ?? null,
        tasks,
        assumptions: input.assumptions ?? plan.assumptions,
        risks: input.risks ?? plan.risks,
        updatedAt: now(),
      },
      explicitKeys,
    )
    validatePlanDraft(next)
    this.validatePlanAgents(next)
    this.store.updatePlanRevision(next)
    if (next.versionId !== undefined) {
      this.store.db
        .prepare("UPDATE plan_revisions SET subject_type = 'version', subject_id = ?, updated_at = ? WHERE id = ?")
        .run(next.versionId ?? null, now(), next.id)
    }
    this.ensurePlanCollaboration(next)
    return next
  }

  /** Read-only assignment preview for a replan proposal; does not persist. */
  previewAssignedTasks(projectId: string, goal: string, tasks: PlannedTask[]): PlannedTask[] {
    if (!this.store.read.getProject(projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    const timestamp = now()
    const plan: PlanDraft = {
      id: 'preview',
      projectId,
      revision: 1,
      status: 'draft',
      goal,
      tasks,
      assumptions: [],
      risks: [],
      generatedBy: 'provider',
      createdAt: timestamp,
      updatedAt: timestamp,
      approvedAt: null,
      createdTaskIds: [],
      execution: null,
    }
    return this.assignPlanAgents(plan).tasks
  }

  revisePlan(input: PlanUpdateInput): PlanDraft {
    const source = this.getPlan(input.planId)
    if (source.status === 'draft') return this.updatePlan(input)
    if (source.execution?.status === 'running') {
      throw new AppError('CONFLICT', '执行中的计划不能修订，请先暂停或取消')
    }
    for (const taskId of source.createdTaskIds) {
      if (this.store.read.getActiveRunForTask(taskId)) {
        throw new AppError('CONFLICT', '计划仍有任务在运行，请先取消运行后再修订')
      }
    }
    const revision = this.store.read.getNextPlanRevision(source.projectId)
    // ADR-0026: a revision arrives with assignments that were already decided — by the user's
    // approved plan, or by the product reusing an Agent inside the granted envelope. Re-resolving
    // them here silently swaps Agents (and made an in-envelope repair look like a scope increase).
    // Any task that arrives with an agentId is therefore pinned for this revision.
    const pinnedKeys = new Set(
      (input.tasks ?? source.tasks).filter((task) => Boolean(task.agentId)).map((task) => task.key),
    )
    const assigned: PlanDraft = this.assignPlanAgents({
      id: newId('pln'),
      projectId: source.projectId,
      revision,
      status: 'draft',
      goal: input.goal ?? source.goal,
      tasks: input.tasks ?? source.tasks,
      assumptions: input.assumptions ?? source.assumptions,
      risks: input.risks ?? source.risks,
      generatedBy: source.generatedBy,
      generation: source.generation
        ? {
            ...source.generation,
            warnings: [
              ...source.generation.warnings,
              `本版本由 r${source.revision} 人工修订；任务与依赖可能已不同于模型原始输出。`,
            ].slice(0, 30),
          }
        : undefined,
      createdAt: now(),
      updatedAt: now(),
      approvedAt: null,
      supersededByPlanId: null,
      createdTaskIds: [],
      execution: null,
    }, pinnedKeys)
    const reuse = this.reuseReferences(source, assigned.tasks)
    const next: PlanDraft = {
      ...assigned,
      tasks: assigned.tasks.map((task) => {
        const reference = reuse.get(task.key)
        return reference
          ? { ...task, reuseFromTaskId: reference.taskId, reuseArtifactIds: reference.artifactIds }
          : task
      }),
    }
    validatePlanDraft(next)
    this.validatePlanAgents(next)
    this.store.createPlanRevision(next)
    if (source.status === 'approved') {
      const revokedGrants = this.store.revokeActivePlanExecutionGrants(source.id, `计划被 r${revision} 替代`, now())
      if (revokedGrants > 0) {
        this.store.appendEvent(source.projectId, source.id, PROJECT_EVENT_TYPES.planGrantInvalidated, {
          reason: `计划被 r${revision} 替代`,
          revision,
          count: revokedGrants,
        })
      }
      this.store.updatePlanRevision({
        ...source,
        status: 'superseded',
        supersededByPlanId: next.id,
        updatedAt: now(),
      })
      for (const taskId of source.createdTaskIds) {
        const task = this.store.read.getTask(taskId)
        if (!task || task.status === 'done' || task.status === 'cancelled') continue
        try {
          this.services.tasks.move(
            {
              taskId,
              expectedVersion: task.version,
              to: 'cancelled',
              note: `已被计划 r${revision} 替代（superseded）`,
            },
            { kind: 'system', id: 'orchestrator', name: '编排器' },
          )
        } catch (error) {
          this.store.appendEvent(source.projectId, taskId, 'task.superseded', {
            planId: source.id,
            supersededByPlanId: next.id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
    this.ensurePlanCollaboration(next)
    return next
  }

  approvePlan(planId: string): { plan: PlanDraft; taskIds: string[] } {
    const plan = this.assignPlanAgents(this.getPlan(planId))
    if (plan.status !== 'draft') throw new AppError('CONFLICT', '计划不是草稿状态')
    validatePlanDraft(plan)
    this.validatePlanAgents(plan, true)
    this.ensurePlanCollaboration(plan)
    const ordered = topologicalPlanTasks(plan)
    const taskIdByKey = new Map<string, string>()
    const tasksByAgent = new Map<string, string[]>()
    const created = this.store.transaction(() => {
      const ids: string[] = []
      for (const planned of ordered) {
        const dependsOn = planned.dependsOn.map((key) => {
          const id = taskIdByKey.get(key)
          if (!id) throw new AppError('INTERNAL', `计划依赖顺序错误：${key}`)
          return id
        })
        // A validated reuse reference points at a completed Task with identical
        // requirements. Reuse that Task instead of creating a duplicate node
        // that would execute the same work again.
        if (planned.reuseFromTaskId) {
          const reused = this.store.read.getTask(planned.reuseFromTaskId)
          if (reused && reused.status === 'done' && reused.projectId === plan.projectId) {
            taskIdByKey.set(planned.key, reused.id)
            ids.push(reused.id)
            this.store.appendEvent(plan.projectId, plan.id, PROJECT_EVENT_TYPES.planTaskReused, {
              planId: plan.id,
              revision: plan.revision,
              taskKey: planned.key,
              reusedTaskId: reused.id,
              artifactIds: planned.reuseArtifactIds ?? [],
            })
            continue
          }
        }
        const assigneeAgentId = planned.agentId ?? agentForPlannedTask(planned)
        const task = this.services.tasks.create({
          projectId: plan.projectId,
          title: planned.title,
          description: planned.description,
          priority: 2,
          acceptanceCriteria: planned.acceptanceCriteria,
          expectedArtifacts: planned.expectedArtifacts,
          labels: ['plan', planned.role],
          assigneeAgentId,
          milestoneId: null,
          versionId: plan.versionId ?? null,
          iterationId: plan.iterationId ?? null,
          dependsOn,
          dueAt: null,
          ...(planned.workType ? { workType: planned.workType } : {}),
        })
        taskIdByKey.set(planned.key, task.id)
        ids.push(task.id)
        if (assigneeAgentId) {
          const list = tasksByAgent.get(assigneeAgentId) ?? []
          list.push(planned.title)
          tasksByAgent.set(assigneeAgentId, list)
        }
      }

      for (const [agentId, titles] of tasksByAgent) {
        const agent = this.store.read.getAgent(agentId)
        const sessionTitle = planSessionTitle(agent?.name ?? 'Agent', plan.revision)
        const session = this.services.sessions.list(plan.projectId).find((item) => item.agentId === agentId && item.title === sessionTitle) ??
          this.services.sessions.create(
            {
              projectId: plan.projectId,
              agentId,
              title: sessionTitle,
            },
            { kind: 'system', id: 'orchestrator', name: '编排器' },
          )
        this.store.appendMessage({
          sessionId: session.id,
          role: 'system',
          content: `计划「${plan.goal}」已批准。\n\n分配给 ${agent?.name ?? '当前 Agent'} 的任务：\n${titles.map((title) => `- ${title}`).join('\n')}\n\n等待用户在编排工作台确认后开始执行。`,
          metadata: { kind: 'plan-approved', planId: plan.id, revision: plan.revision },
        })
      }

      const groupLead = [...tasksByAgent.keys()][0]
      if (groupLead) {
        const participants = [...tasksByAgent.keys()]
          .map((agentId) => this.store.read.getAgent(agentId)?.name ?? 'Agent')
          .join('、')
        const groupTitle = planGroupTitle(plan.goal, plan.revision)
        const groupSession = this.services.sessions.list(plan.projectId).find((item) => item.title === groupTitle) ??
          this.services.sessions.create(
            {
              projectId: plan.projectId,
              agentId: groupLead,
              title: groupTitle,
            },
            { kind: 'system', id: 'orchestrator', name: '编排器' },
          )
        this.store.appendMessage({
          sessionId: groupSession.id,
          role: 'system',
          content: `计划群聊已建立。\n目标：${plan.goal}\n参与 Agent：${participants}\n\n用户和所有 Agent 的发言都会进入本群聊；Agent 会依次阅读前文后回应。`,
          metadata: { kind: 'plan-group', planId: plan.id, revision: plan.revision },
        })
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

