import type { DatabaseSync } from 'node:sqlite'
import {
  TASK_COLUMNS,
  type AIConnectionCheck,
  type AIConnectionProfile,
  type AIConnectionView,
  type AIModel,
  type AIModelPrice,
  type AIUsageSummary,
  type AgentBackendBinding,
  type GraphLayout,
  type PlanDraft,
  type ProjectSnapshot,
  type ActivityItem,
  type Agent,
  type AgentView,
  type Approval,
  type ApprovalView,
  type Artifact,
  type CollaborationSnapshot,
  type DeliveryStatus,
  type Decision,
  type Handoff,
  type HandoffView,
  type InboxItem,
  type InboxItemView,
  type KnowledgeEntry,
  type LifecycleGate,
  type Message,
  type MessageView,
  type Milestone,
  type Project,
  type ProjectEvent,
  type ProjectOverview,
  type ProjectStage,
  type ProjectStats,
  type ProjectSummary,
  type Requirement,
  type Run,
  type RunDetail,
  type RunSummary,
  type Session,
  type SessionDetail,
  type SessionSummary,
  type Task,
  type TaskBoard,
  type TaskCard,
  type TaskDetail,
  type TaskDependency,
  type ToolCall,
  type RunStep,
} from '@projectos/contracts'
import { evaluateStageGates, summarizeProjectEvent } from '@projectos/domain'
import {
  parseUnknown,
  toAIConnection,
  toAIConnectionCheck,
  toAIModel,
  toAIModelPrice,
  toAgentBackendBinding,
  toGraphLayout,
  toPlanRevision,
  toProjectSnapshot,
  toAgent,
  toApproval,
  toArtifact,
  toDecision,
  toEvent,
  toHandoff,
  toInboxItem,
  toKnowledge,
  toMessage,
  toMilestone,
  toProject,
  toRequirement,
  toRun,
  toRunStep,
  toSession,
  toStage,
  toTask,
  toToolCall,
  type AIConnectionCheckRow,
  type AIConnectionRow,
  type AIModelRow,
  type AIModelPriceRow,
  type AgentBackendBindingRow,
  type ProjectBudgetRow,
  type GraphLayoutRow,
  type PlanRevisionRow,
  type ProjectSnapshotRow,
  type AgentRow,
  type ApprovalRow,
  type ArtifactRow,
  type DecisionRow,
  type EventRow,
  type HandoffRow,
  type InboxRow,
  type KnowledgeRow,
  type MessageRow,
  type MilestoneRow,
  type ProjectRow,
  type RequirementRow,
  type RunRow,
  type RunStepRow,
  type SessionRow,
  type StageRow,
  type TaskRow,
  type ToolCallRow,
} from './rows.js'

type SqlValue = string | number | null
export type OverviewBase = Omit<ProjectOverview, 'git'>

const ACTIVE_RUN_STATUSES = `('queued','running','waiting_tool','waiting_approval','verifying','suspended')`

export class ReadModels {
  constructor(private readonly db: DatabaseSync) {}

  private all<T>(sql: string, ...params: SqlValue[]): T[] {
    return this.db.prepare(sql).all(...params) as unknown as T[]
  }

  private get<T>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as unknown as T | undefined
  }

  getProject(id: string): Project | null {
    const row = this.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id)
    return row ? toProject(row) : null
  }

  listProjects(includeArchived = false): Project[] {
    const rows = includeArchived
      ? this.all<ProjectRow>('SELECT * FROM projects ORDER BY updated_at DESC')
      : this.all<ProjectRow>("SELECT * FROM projects WHERE status <> 'archived' ORDER BY updated_at DESC")
    return rows.map(toProject)
  }

  getStages(projectId: string): ProjectStage[] {
    return this.all<StageRow>(
      'SELECT * FROM project_stages WHERE project_id = ? ORDER BY position ASC',
      projectId,
    ).map(toStage)
  }

  getProjectStats(projectId: string): ProjectStats {
    const row = this.get<{
      tasks_total: number
      tasks_done: number
      tasks_cancelled: number
      tasks_running: number
      tasks_review: number
      requirements_approved: number
      milestones_total: number
      milestones_completed: number
      artifacts: number
      active_runs: number
      pending_approvals: number
      sessions: number
    }>(
      `SELECT
        (SELECT COUNT(*) FROM tasks WHERE project_id = ?) AS tasks_total,
        (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND status = 'done') AS tasks_done,
        (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND status = 'cancelled') AS tasks_cancelled,
        (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND status = 'running') AS tasks_running,
        (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND status = 'review') AS tasks_review,
        (SELECT COUNT(*) FROM requirements WHERE project_id = ? AND status = 'approved') AS requirements_approved,
        (SELECT COUNT(*) FROM milestones WHERE project_id = ?) AS milestones_total,
        (SELECT COUNT(*) FROM milestones WHERE project_id = ? AND status = 'completed') AS milestones_completed,
        (SELECT COUNT(*) FROM artifacts WHERE project_id = ?) AS artifacts,
        (SELECT COUNT(*) FROM agent_runs WHERE project_id = ? AND status IN ${ACTIVE_RUN_STATUSES}) AS active_runs,
        (SELECT COUNT(*) FROM approvals WHERE project_id = ? AND status = 'pending') AS pending_approvals,
        (SELECT COUNT(*) FROM sessions WHERE project_id = ? AND status <> 'archived') AS sessions`,
      projectId,
      projectId,
      projectId,
      projectId,
      projectId,
      projectId,
      projectId,
      projectId,
      projectId,
      projectId,
      projectId,
      projectId,
    )
    const total = Number(row?.tasks_total ?? 0)
    const done = Number(row?.tasks_done ?? 0)
    const cancelled = Number(row?.tasks_cancelled ?? 0)
    return {
      tasksTotal: total,
      tasksDone: done,
      tasksCancelled: cancelled,
      tasksRunning: Number(row?.tasks_running ?? 0),
      tasksReview: Number(row?.tasks_review ?? 0),
      progress: total === 0 ? 0 : (done + cancelled) / total,
      requirementsApproved: Number(row?.requirements_approved ?? 0),
      milestonesTotal: Number(row?.milestones_total ?? 0),
      milestonesCompleted: Number(row?.milestones_completed ?? 0),
      artifacts: Number(row?.artifacts ?? 0),
      activeRuns: Number(row?.active_runs ?? 0),
      pendingApprovals: Number(row?.pending_approvals ?? 0),
      sessions: Number(row?.sessions ?? 0),
    }
  }

  getGlobalStats(): ProjectStats {
    const row = this.get<{
      tasks_total: number
      tasks_done: number
      tasks_cancelled: number
      tasks_running: number
      tasks_review: number
      requirements_approved: number
      milestones_total: number
      milestones_completed: number
      artifacts: number
      active_runs: number
      pending_approvals: number
      sessions: number
    }>(
      `SELECT
        (SELECT COUNT(*) FROM tasks) AS tasks_total,
        (SELECT COUNT(*) FROM tasks WHERE status = 'done') AS tasks_done,
        (SELECT COUNT(*) FROM tasks WHERE status = 'cancelled') AS tasks_cancelled,
        (SELECT COUNT(*) FROM tasks WHERE status = 'running') AS tasks_running,
        (SELECT COUNT(*) FROM tasks WHERE status = 'review') AS tasks_review,
        (SELECT COUNT(*) FROM requirements WHERE status = 'approved') AS requirements_approved,
        (SELECT COUNT(*) FROM milestones) AS milestones_total,
        (SELECT COUNT(*) FROM milestones WHERE status = 'completed') AS milestones_completed,
        (SELECT COUNT(*) FROM artifacts) AS artifacts,
        (SELECT COUNT(*) FROM agent_runs WHERE status IN ${ACTIVE_RUN_STATUSES}) AS active_runs,
        (SELECT COUNT(*) FROM approvals WHERE status = 'pending') AS pending_approvals,
        (SELECT COUNT(*) FROM sessions WHERE status <> 'archived') AS sessions`,
    )
    const total = Number(row?.tasks_total ?? 0)
    const done = Number(row?.tasks_done ?? 0)
    const cancelled = Number(row?.tasks_cancelled ?? 0)
    return {
      tasksTotal: total,
      tasksDone: done,
      tasksCancelled: cancelled,
      tasksRunning: Number(row?.tasks_running ?? 0),
      tasksReview: Number(row?.tasks_review ?? 0),
      progress: total === 0 ? 0 : (done + cancelled) / total,
      requirementsApproved: Number(row?.requirements_approved ?? 0),
      milestonesTotal: Number(row?.milestones_total ?? 0),
      milestonesCompleted: Number(row?.milestones_completed ?? 0),
      artifacts: Number(row?.artifacts ?? 0),
      activeRuns: Number(row?.active_runs ?? 0),
      pendingApprovals: Number(row?.pending_approvals ?? 0),
      sessions: Number(row?.sessions ?? 0),
    }
  }

  getProjectLastActivity(projectId: string): number {
    const row = this.get<{ last_activity: number | null; updated_at: number }>(
      `SELECT
        (SELECT MAX(created_at) FROM project_events WHERE project_id = ?) AS last_activity,
        updated_at
       FROM projects WHERE id = ?`,
      projectId,
      projectId,
    )
    return Number(row?.last_activity ?? row?.updated_at ?? 0)
  }

  getProjectSummary(project: Project): ProjectSummary {
    const stats = this.getProjectStats(project.id)
    const activeAgents = this.get<{ count: number }>(
      `SELECT COUNT(DISTINCT agent_id) AS count FROM agent_runs
       WHERE project_id = ? AND status IN ${ACTIVE_RUN_STATUSES}`,
      project.id,
    )
    return {
      ...project,
      stats,
      activeAgents: Number(activeAgents?.count ?? 0),
      lastActivityAt: this.getProjectLastActivity(project.id),
    }
  }

  listProjectSummaries(includeArchived = false): ProjectSummary[] {
    return this.listProjects(includeArchived).map((project) => this.getProjectSummary(project))
  }

  getProjectByName(name: string): Project | null {
    const row = this.get<ProjectRow>('SELECT * FROM projects WHERE name = ? LIMIT 1', name)
    return row ? toProject(row) : null
  }

  getRequirement(id: string): Requirement | null {
    const row = this.get<RequirementRow>('SELECT * FROM requirements WHERE id = ?', id)
    return row ? toRequirement(row) : null
  }

  getMilestone(id: string): Milestone | null {
    const row = this.get<MilestoneRow>('SELECT * FROM milestones WHERE id = ?', id)
    return row ? toMilestone(row) : null
  }

  getDecision(id: string): Decision | null {
    const row = this.get<DecisionRow>('SELECT * FROM decisions WHERE id = ?', id)
    return row ? toDecision(row) : null
  }

  listRequirements(projectId: string): Requirement[] {
    return this.all<RequirementRow>(
      'SELECT * FROM requirements WHERE project_id = ? ORDER BY created_at ASC',
      projectId,
    ).map(toRequirement)
  }

  listMilestones(projectId: string): Milestone[] {
    return this.all<MilestoneRow>(
      "SELECT * FROM milestones WHERE project_id = ? ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END, due_at ASC, created_at ASC",
      projectId,
    ).map(toMilestone)
  }

  listDecisions(projectId: string): Decision[] {
    return this.all<DecisionRow>(
      "SELECT * FROM decisions WHERE project_id = ? ORDER BY CASE status WHEN 'accepted' THEN 0 WHEN 'proposed' THEN 1 ELSE 2 END, updated_at DESC",
      projectId,
    ).map(toDecision)
  }

  listArtifacts(projectId: string, taskId: string | null = null): Artifact[] {
    const rows = taskId
      ? this.all<ArtifactRow>(
          'SELECT * FROM artifacts WHERE project_id = ? AND task_id = ? ORDER BY created_at DESC',
          projectId,
          taskId,
        )
      : this.all<ArtifactRow>(
          'SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at DESC',
          projectId,
        )
    return rows.map(toArtifact)
  }

  getArtifact(id: string): Artifact | null {
    const row = this.get<ArtifactRow>('SELECT * FROM artifacts WHERE id = ?', id)
    return row ? toArtifact(row) : null
  }

  listKnowledge(projectId: string): KnowledgeEntry[] {
    return this.all<KnowledgeRow>(
      "SELECT * FROM knowledge_entries WHERE project_id = ? AND status = 'active' ORDER BY updated_at DESC",
      projectId,
    ).map(toKnowledge)
  }

  searchKnowledge(projectId: string, query: string, limit = 30): KnowledgeEntry[] {
    const tokens = query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 12) ?? []
    if (tokens.length === 0) return this.listKnowledge(projectId).slice(0, limit)
    const ftsQuery = tokens.map((token) => `"${token.replace(/"/g, '')}"*`).join(' OR ')
    return this.all<KnowledgeRow>(
      `SELECT k.* FROM knowledge_fts
       JOIN knowledge_entries k ON k.rowid = knowledge_fts.rowid
       WHERE knowledge_fts MATCH ? AND k.project_id = ? AND k.status = 'active'
       ORDER BY rank LIMIT ?`,
      ftsQuery,
      projectId,
      limit,
    ).map(toKnowledge)
  }

  listAgents(): Agent[] {
    return this.all<AgentRow>('SELECT * FROM agents ORDER BY builtin DESC, created_at ASC').map(toAgent)
  }

  getAgent(id: string): Agent | null {
    const row = this.get<AgentRow>('SELECT * FROM agents WHERE id = ?', id)
    return row ? toAgent(row) : null
  }

  getTask(id: string): Task | null {
    const row = this.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id)
    return row ? toTask(row) : null
  }

  listTasks(projectId: string): Task[] {
    return this.all<TaskRow>(
      'SELECT * FROM tasks WHERE project_id = ? ORDER BY priority ASC, rowid ASC',
      projectId,
    ).map(toTask)
  }

  listTaskRows(projectId: string): TaskRow[] {
    return this.all<TaskRow>(
      'SELECT * FROM tasks WHERE project_id = ? ORDER BY priority ASC, rowid ASC',
      projectId,
    )
  }

  listDependencies(projectId: string): TaskDependency[] {
    return this.all<{ task_id: string; depends_on_id: string }>(
      `SELECT d.task_id, d.depends_on_id
       FROM task_dependencies d JOIN tasks t ON t.id = d.task_id
       WHERE t.project_id = ?`,
      projectId,
    ).map((row) => ({ taskId: row.task_id, dependsOnId: row.depends_on_id }))
  }

  getTaskDependencies(taskId: string): TaskDependency[] {
    return this.all<{ task_id: string; depends_on_id: string }>(
      'SELECT task_id, depends_on_id FROM task_dependencies WHERE task_id = ?',
      taskId,
    ).map((row) => ({ taskId: row.task_id, dependsOnId: row.depends_on_id }))
  }

  getTaskDependents(taskId: string): TaskDependency[] {
    return this.all<{ task_id: string; depends_on_id: string }>(
      'SELECT task_id, depends_on_id FROM task_dependencies WHERE depends_on_id = ?',
      taskId,
    ).map((row) => ({ taskId: row.task_id, dependsOnId: row.depends_on_id }))
  }

  getTaskCard(taskId: string): TaskCard | null {
    const task = this.getTask(taskId)
    if (!task) return null
    return this.taskToCard(task)
  }

  private taskToCard(task: Task): TaskCard {
    const assignee = task.assigneeAgentId
      ? this.get<{ name: string }>('SELECT name FROM agents WHERE id = ?', task.assigneeAgentId)
      : undefined
    const dependencies = this.getTaskDependencies(task.id)
    const blockedBy: string[] = []
    for (const dependency of dependencies) {
      const row = this.get<{ status: string }>('SELECT status FROM tasks WHERE id = ?', dependency.dependsOnId)
      if (row && row.status !== 'done') blockedBy.push(dependency.dependsOnId)
    }
    const runCount = this.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM agent_runs WHERE task_id = ?',
      task.id,
    )
    const artifactCount = this.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM artifacts WHERE task_id = ?',
      task.id,
    )
    const latestRun = this.get<{ status: string }>(
      'SELECT status FROM agent_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1',
      task.id,
    )
    return {
      ...task,
      assigneeName: assignee?.name ?? null,
      dependencyIds: dependencies.map((dependency) => dependency.dependsOnId),
      blockedBy,
      runCount: Number(runCount?.count ?? 0),
      artifactCount: Number(artifactCount?.count ?? 0),
      latestRunStatus: (latestRun?.status as TaskCard['latestRunStatus']) ?? null,
    }
  }

  listTaskCards(projectId: string): TaskCard[] {
    return this.listTasks(projectId).map((task) => this.taskToCard(task))
  }

  getTaskBoard(projectId: string): TaskBoard {
    const tasks = this.listTaskCards(projectId)
    return {
      projectId,
      tasks,
      columns: TASK_COLUMNS.map((status) => ({
        status,
        taskIds: tasks.filter((task) => task.status === status).map((task) => task.id),
      })),
    }
  }

  listTaskAttempts(taskId: string) {
    return this.all<{
      id: string
      task_id: string
      attempt_no: number
      agent_id: string
      run_id: string | null
      status: string
      created_at: number
    }>('SELECT * FROM task_attempts WHERE task_id = ? ORDER BY attempt_no ASC', taskId).map((row) => ({
      id: row.id,
      taskId: row.task_id,
      attemptNo: Number(row.attempt_no),
      agentId: row.agent_id,
      runId: row.run_id,
      status: row.status,
      createdAt: Number(row.created_at),
    }))
  }

  getRun(id: string): Run | null {
    const row = this.get<RunRow>('SELECT * FROM agent_runs WHERE id = ?', id)
    return row ? toRun(row) : null
  }

  getRunSummary(runId: string): RunSummary | null {
    const row = this.get<
      RunRow & {
        agent_name: string
        session_title: string
        task_title: string | null
        pending_approvals: number
      }
    >(
      `SELECT r.*, a.name AS agent_name, s.title AS session_title, t.title AS task_title,
        (SELECT COUNT(*) FROM approvals ap WHERE ap.run_id = r.id AND ap.status = 'pending') AS pending_approvals
       FROM agent_runs r
       JOIN agents a ON a.id = r.agent_id
       JOIN sessions s ON s.id = r.session_id
       LEFT JOIN tasks t ON t.id = r.task_id
       WHERE r.id = ?`,
      runId,
    )
    if (!row) return null
    return {
      ...toRun(row),
      agentName: row.agent_name,
      sessionTitle: row.session_title,
      taskTitle: row.task_title,
      pendingApprovals: Number(row.pending_approvals ?? 0),
    }
  }

  listRunSummaries(projectId: string, limit = 50): RunSummary[] {
    const rows = this.all<
      RunRow & {
        agent_name: string
        session_title: string
        task_title: string | null
        pending_approvals: number
      }
    >(
      `SELECT r.*, a.name AS agent_name, s.title AS session_title, t.title AS task_title,
        (SELECT COUNT(*) FROM approvals ap WHERE ap.run_id = r.id AND ap.status = 'pending') AS pending_approvals
       FROM agent_runs r
       JOIN agents a ON a.id = r.agent_id
       JOIN sessions s ON s.id = r.session_id
       LEFT JOIN tasks t ON t.id = r.task_id
       WHERE r.project_id = ?
       ORDER BY r.created_at DESC LIMIT ?`,
      projectId,
      limit,
    )
    return rows.map((row) => ({
      ...toRun(row),
      agentName: row.agent_name,
      sessionTitle: row.session_title,
      taskTitle: row.task_title,
      pendingApprovals: Number(row.pending_approvals ?? 0),
    }))
  }

  listTaskRuns(taskId: string): RunSummary[] {
    const rows = this.all<
      RunRow & {
        agent_name: string
        session_title: string
        task_title: string | null
        pending_approvals: number
      }
    >(
      `SELECT r.*, a.name AS agent_name, s.title AS session_title, t.title AS task_title,
        (SELECT COUNT(*) FROM approvals ap WHERE ap.run_id = r.id AND ap.status = 'pending') AS pending_approvals
       FROM agent_runs r
       JOIN agents a ON a.id = r.agent_id
       JOIN sessions s ON s.id = r.session_id
       LEFT JOIN tasks t ON t.id = r.task_id
       WHERE r.task_id = ? ORDER BY r.created_at DESC`,
      taskId,
    )
    return rows.map((row) => ({
      ...toRun(row),
      agentName: row.agent_name,
      sessionTitle: row.session_title,
      taskTitle: row.task_title,
      pendingApprovals: Number(row.pending_approvals ?? 0),
    }))
  }

  getRunSteps(runId: string): RunStep[] {
    return this.all<RunStepRow>('SELECT * FROM run_steps WHERE run_id = ? ORDER BY seq ASC', runId).map(
      toRunStep,
    )
  }

  getToolCalls(runId: string): ToolCall[] {
    return this.all<ToolCallRow>('SELECT * FROM tool_calls WHERE run_id = ? ORDER BY created_at ASC', runId).map(
      toToolCall,
    )
  }

  getApproval(id: string): Approval | null {
    const row = this.get<ApprovalRow>('SELECT * FROM approvals WHERE id = ?', id)
    return row ? toApproval(row) : null
  }

  getApprovalView(id: string): ApprovalView | null {
    const row = this.get<
      ApprovalRow & {
        run_status: string
        session_id: string
        task_id: string | null
        task_title: string | null
        agent_name: string
      }
    >(
      `SELECT ap.*, r.status AS run_status, r.session_id, r.task_id, t.title AS task_title, a.name AS agent_name
       FROM approvals ap
       JOIN agent_runs r ON r.id = ap.run_id
       JOIN agents a ON a.id = r.agent_id
       LEFT JOIN tasks t ON t.id = r.task_id
       WHERE ap.id = ?`,
      id,
    )
    if (!row) return null
    return this.approvalRowToView(row)
  }

  private approvalRowToView(
    row: ApprovalRow & {
      run_status: string
      session_id: string
      task_id: string | null
      task_title: string | null
      agent_name: string
    },
  ): ApprovalView {
    return {
      ...toApproval(row),
      runStatus: row.run_status as ApprovalView['runStatus'],
      sessionId: row.session_id,
      taskId: row.task_id,
      taskTitle: row.task_title,
      agentName: row.agent_name,
    }
  }

  listApprovalViews(projectId: string | null = null, runId: string | null = null): ApprovalView[] {
    const clauses: string[] = []
    const params: SqlValue[] = []
    if (projectId) {
      clauses.push('ap.project_id = ?')
      params.push(projectId)
    }
    if (runId) {
      clauses.push('ap.run_id = ?')
      params.push(runId)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.all<
      ApprovalRow & {
        run_status: string
        session_id: string
        task_id: string | null
        task_title: string | null
        agent_name: string
      }
    >(
      `SELECT ap.*, r.status AS run_status, r.session_id, r.task_id, t.title AS task_title, a.name AS agent_name
       FROM approvals ap
       JOIN agent_runs r ON r.id = ap.run_id
       JOIN agents a ON a.id = r.agent_id
       LEFT JOIN tasks t ON t.id = r.task_id
       ${where}
       ORDER BY CASE ap.status WHEN 'pending' THEN 0 ELSE 1 END, ap.requested_at DESC`,
      ...params,
    )
    return rows.map((row) => this.approvalRowToView(row))
  }

  listPendingApprovalViews(limit = 50): ApprovalView[] {
    const rows = this.all<
      ApprovalRow & {
        run_status: string
        session_id: string
        task_id: string | null
        task_title: string | null
        agent_name: string
      }
    >(
      `SELECT ap.*, r.status AS run_status, r.session_id, r.task_id, t.title AS task_title, a.name AS agent_name
       FROM approvals ap
       JOIN agent_runs r ON r.id = ap.run_id
       JOIN agents a ON a.id = r.agent_id
       LEFT JOIN tasks t ON t.id = r.task_id
       WHERE ap.status = 'pending'
       ORDER BY ap.requested_at ASC LIMIT ?`,
      limit,
    )
    return rows.map((row) => this.approvalRowToView(row))
  }

  getRunDetail(runId: string): RunDetail | null {
    const run = this.getRunSummary(runId)
    if (!run) return null
    const sessionRow = this.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', run.sessionId)
    if (!sessionRow) return null
    const task = run.taskId ? this.getTask(run.taskId) : null
    return {
      run,
      steps: this.getRunSteps(runId),
      toolCalls: this.getToolCalls(runId),
      approvals: this.listApprovalViews(null, runId),
      session: toSession(sessionRow),
      task,
    }
  }

  listTaskArtifactViews(taskId: string): Artifact[] {
    return this.all<ArtifactRow>(
      'SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at DESC',
      taskId,
    ).map(toArtifact)
  }

  getTaskDetail(taskId: string): TaskDetail | null {
    const task = this.getTaskCard(taskId)
    if (!task) return null
    const dependencies = task.dependencyIds
      .map((id) => this.getTaskCard(id))
      .filter((card): card is TaskCard => card !== null)
    const dependents = this.getTaskDependents(taskId)
      .map((dependency) => this.getTaskCard(dependency.taskId))
      .filter((card): card is TaskCard => card !== null)
    const approvals = this.all<ApprovalRow & { run_status: string; session_id: string; task_id: string | null; task_title: string | null; agent_name: string }>(
      `SELECT ap.*, r.status AS run_status, r.session_id, r.task_id, t.title AS task_title, a.name AS agent_name
       FROM approvals ap
       JOIN agent_runs r ON r.id = ap.run_id
       JOIN agents a ON a.id = r.agent_id
       LEFT JOIN tasks t ON t.id = r.task_id
       WHERE r.task_id = ? ORDER BY ap.requested_at DESC`,
      taskId,
    ).map((row) => this.approvalRowToView(row))
    return {
      task,
      dependencies,
      dependents,
      attempts: this.listTaskAttempts(taskId),
      runs: this.listTaskRuns(taskId),
      artifacts: this.listTaskArtifactViews(taskId),
      approvals,
    }
  }

  getSession(id: string): Session | null {
    const row = this.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', id)
    return row ? toSession(row) : null
  }

  listSessions(projectId: string): Session[] {
    return this.all<SessionRow>(
      'SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC',
      projectId,
    ).map(toSession)
  }

  getMessages(sessionId: string, limit = 200, afterSeq?: number): Message[] {
    if (afterSeq !== undefined) {
      return this.all<MessageRow>(
        'SELECT * FROM messages WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
        sessionId,
        afterSeq,
        limit,
      ).map(toMessage)
    }
    const rows = this.all<MessageRow>(
      `SELECT * FROM (
         SELECT * FROM messages WHERE session_id = ? ORDER BY seq DESC LIMIT ?
       ) ORDER BY seq ASC`,
      sessionId,
      limit,
    )
    return rows.map(toMessage)
  }

  getSessionSummary(session: Session): SessionSummary {
    const row = this.get<
      SessionRow & {
        agent_name: string
        agent_role: string
        agent_accent: string
        message_count: number
        last_message_at: number | null
        latest_run_status: string | null
        pending_approvals: number
      }
    >(
      `SELECT s.*, a.name AS agent_name, a.role AS agent_role, a.accent AS agent_accent,
        (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
        (SELECT MAX(created_at) FROM messages m WHERE m.session_id = s.id) AS last_message_at,
        (SELECT status FROM agent_runs r WHERE r.session_id = s.id ORDER BY r.created_at DESC LIMIT 1) AS latest_run_status,
        (SELECT COUNT(*) FROM approvals ap JOIN agent_runs r ON r.id = ap.run_id WHERE r.session_id = s.id AND ap.status = 'pending') AS pending_approvals
       FROM sessions s JOIN agents a ON a.id = s.agent_id WHERE s.id = ?`,
      session.id,
    )
    return {
      ...session,
      agentName: row?.agent_name ?? 'Unknown',
      agentRole: row?.agent_role ?? '',
      agentAccent: row?.agent_accent ?? '#4C8DFF',
      messageCount: Number(row?.message_count ?? 0),
      lastMessageAt: row?.last_message_at === null || row?.last_message_at === undefined ? null : Number(row.last_message_at),
      latestRunStatus: (row?.latest_run_status as SessionSummary['latestRunStatus']) ?? null,
      pendingApprovals: Number(row?.pending_approvals ?? 0),
    }
  }

  listSessionSummaries(projectId: string): SessionSummary[] {
    return this.listSessions(projectId).map((session) => this.getSessionSummary(session))
  }

  getSessionDetail(sessionId: string, messageLimit = 200): SessionDetail | null {
    const session = this.getSession(sessionId)
    if (!session) return null
    const agent = this.getAgent(session.agentId)
    if (!agent) return null
    const messages = this.getMessages(sessionId, messageLimit)
    const messageViews: MessageView[] = messages.map((message) => ({
      ...message,
      agentName: message.role === 'assistant' ? agent.name : null,
    }))
    const activeRow = this.get<RunRow>(
      `SELECT * FROM agent_runs WHERE session_id = ? AND status IN ${ACTIVE_RUN_STATUSES}
       ORDER BY created_at DESC LIMIT 1`,
      sessionId,
    )
    return {
      session,
      agent,
      messages: messageViews,
      activeRun: activeRow ? this.getRunSummary(activeRow.id) : null,
    }
  }

  getAgentViews(projectId: string): AgentView[] {
    const agents = this.listAgents()
    return agents.map((agent) => {
      const activeRun = this.get<RunRow>(
        `SELECT * FROM agent_runs WHERE project_id = ? AND agent_id = ? AND status IN ${ACTIVE_RUN_STATUSES}
         ORDER BY created_at DESC LIMIT 1`,
        projectId,
        agent.id,
      )
      const sessionCount = this.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sessions WHERE project_id = ? AND agent_id = ? AND status <> 'archived'",
        projectId,
        agent.id,
      )
      const completedRuns = this.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM agent_runs WHERE project_id = ? AND agent_id = ? AND status = 'completed'",
        projectId,
        agent.id,
      )
      return {
        agent,
        status: activeRun ? 'working' : 'idle',
        sessionCount: Number(sessionCount?.count ?? 0),
        activeRunId: activeRun?.id ?? null,
        activeSessionId: activeRun?.session_id ?? null,
        completedRuns: Number(completedRuns?.count ?? 0),
      }
    })
  }

  getStageSignals(projectId: string) {
    const stats = this.getProjectStats(projectId)
    const acceptedDecisions = this.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM decisions WHERE project_id = ? AND status = 'accepted'",
      projectId,
    )
    const readyTasks = this.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM tasks WHERE project_id = ? AND status IN ('ready','running')",
      projectId,
    )
    const reviewOrDone = this.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM tasks WHERE project_id = ? AND status IN ('review','done')",
      projectId,
    )
    const verifiedArtifacts = this.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM artifacts WHERE project_id = ? AND verified_at IS NOT NULL',
      projectId,
    )
    const releaseArtifacts = this.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM artifacts WHERE project_id = ? AND kind = 'release-note'",
      projectId,
    )
    return {
      approvedRequirements: stats.requirementsApproved,
      acceptedDecisions: Number(acceptedDecisions?.count ?? 0),
      milestones: stats.milestonesTotal,
      readyTasks: Number(readyTasks?.count ?? 0),
      reviewOrDoneTasks: Number(reviewOrDone?.count ?? 0),
      verifiedArtifacts: Number(verifiedArtifacts?.count ?? 0),
      releaseArtifacts: Number(releaseArtifacts?.count ?? 0),
    }
  }

  getLifecycleGates(projectId: string): LifecycleGate[] {
    const signals = this.getStageSignals(projectId)
    const gates = evaluateStageGates(this.getStages(projectId), signals)
    return gates.map((gate) => ({
      stage: gate.stage,
      status: gate.status,
      ready: gate.ready,
      requirement: gate.requirement,
      blockers: gate.blockers,
    }))
  }

  getProjectActivity(projectId: string, limit = 50): ActivityItem[] {
    const rows = this.all<EventRow>(
      'SELECT * FROM project_events WHERE project_id = ? ORDER BY seq DESC LIMIT ?',
      projectId,
      limit,
    )
    return rows.map((row) => {
      const event = toEvent(row)
      const presentation = summarizeProjectEvent(event)
      return {
        id: event.id,
        seq: event.seq,
        eventType: event.eventType,
        summary: presentation.summary,
        actorName: presentation.actorName,
        tone: presentation.tone,
        createdAt: event.createdAt,
      }
    })
  }

  listEventViews(
    projectId: string,
    limit = 100,
    offset = 0,
    sinceSeq?: number,
  ): Array<ProjectEvent & { summary: string }> {
    const rows =
      sinceSeq === undefined
        ? this.all<EventRow>(
            'SELECT * FROM project_events WHERE project_id = ? ORDER BY seq DESC LIMIT ? OFFSET ?',
            projectId,
            limit,
            offset,
          )
        : this.all<EventRow>(
            'SELECT * FROM project_events WHERE project_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
            projectId,
            sinceSeq,
            limit,
          )
    return rows.map((row) => {
      const event = toEvent(row)
      return { ...event, summary: summarizeProjectEvent(event).summary }
    })
  }

  getRecentActivity(limit = 30): ActivityItem[] {
    const rows = this.all<EventRow & { project_name: string }>(
      `SELECT e.*, p.name AS project_name FROM project_events e
       JOIN projects p ON p.id = e.project_id
       ORDER BY e.created_at DESC, e.seq DESC LIMIT ?`,
      limit,
    )
    return rows.map((row) => {
      const event = toEvent(row)
      const presentation = summarizeProjectEvent(event)
      return {
        id: event.id,
        seq: event.seq,
        eventType: event.eventType,
        summary: `${row.project_name} · ${presentation.summary}`,
        actorName: presentation.actorName,
        tone: presentation.tone,
        createdAt: event.createdAt,
      }
    })
  }

  getOverviewBase(projectId: string): OverviewBase | null {
    const project = this.getProject(projectId)
    if (!project) return null
    const stats = this.getProjectStats(projectId)
    return {
      project,
      stages: this.getStages(projectId),
      stats,
      milestones: this.listMilestones(projectId),
      requirements: this.listRequirements(projectId),
      decisions: this.listDecisions(projectId),
      activity: this.getProjectActivity(projectId, 12),
      agents: this.getAgentViews(projectId),
      gates: this.getLifecycleGates(projectId),
    }
  }

  getInbox(id: string): InboxItem | null {
    const row = this.get<InboxRow>('SELECT * FROM agent_inbox WHERE id = ?', id)
    return row ? toInboxItem(row) : null
  }

  getInboxByMessageId(messageId: string): InboxItem | null {
    const row = this.get<InboxRow>('SELECT * FROM agent_inbox WHERE message_id = ?', messageId)
    return row ? toInboxItem(row) : null
  }

  listInbox(projectId: string, sessionId: string | null = null, limit = 100): InboxItem[] {
    const rows = sessionId
      ? this.all<InboxRow>(
          'SELECT * FROM agent_inbox WHERE project_id = ? AND recipient_session_id = ? ORDER BY created_at DESC LIMIT ?',
          projectId,
          sessionId,
          limit,
        )
      : this.all<InboxRow>(
          'SELECT * FROM agent_inbox WHERE project_id = ? ORDER BY created_at DESC LIMIT ?',
          projectId,
          limit,
        )
    return rows.map(toInboxItem)
  }

  getInboxItemView(item: InboxItem): InboxItemView {
    const senderAgent = this.getAgent(item.envelope.sender.agentId)
    const senderSession = this.getSession(item.envelope.sender.sessionId)
    const recipientAgent = this.getAgent(item.recipientAgentId)
    const task = item.envelope.taskId ? this.getTask(item.envelope.taskId) : null
    const payload = item.envelope.payload
    let preview = ''
    if (payload && typeof payload === 'object' && typeof (payload as { body?: unknown }).body === 'string') {
      preview = (payload as { body: string }).body
    } else if (typeof payload === 'string') {
      preview = payload
    } else {
      preview = JSON.stringify(payload ?? '')
    }
    return {
      ...item,
      senderAgentName: senderAgent?.name ?? '未知 Agent',
      senderSessionTitle: senderSession?.title ?? '未知会话',
      recipientAgentName: recipientAgent?.name ?? '未知 Agent',
      type: item.envelope.type,
      preview: preview.length > 220 ? `${preview.slice(0, 220)}…` : preview,
      taskTitle: task?.title ?? null,
    }
  }

  listInboxViews(projectId: string, sessionId: string | null = null, limit = 100): InboxItemView[] {
    return this.listInbox(projectId, sessionId, limit).map((item) => this.getInboxItemView(item))
  }

  getDeliveryStats(projectId: string): Record<DeliveryStatus, number> {
    const stats: Record<DeliveryStatus, number> = {
      stored: 0,
      delivered: 0,
      accepted: 0,
      completed: 0,
      failed: 0,
      unknown: 0,
    }
    const rows = this.all<{ status: string; count: number }>(
      'SELECT status, COUNT(*) AS count FROM agent_inbox WHERE project_id = ? GROUP BY status',
      projectId,
    )
    for (const row of rows) {
      if (row.status in stats) stats[row.status as DeliveryStatus] = Number(row.count)
    }
    return stats
  }

  getHandoff(id: string): Handoff | null {
    const row = this.get<HandoffRow>('SELECT * FROM handoffs WHERE id = ?', id)
    return row ? toHandoff(row) : null
  }

  getHandoffView(id: string): HandoffView | null {
    const row = this.get<
      HandoffRow & {
        from_agent_name: string
        to_agent_name: string
        task_title: string
        from_session_title: string
      }
    >(
      `SELECT h.*, fa.name AS from_agent_name, ta.name AS to_agent_name, t.title AS task_title, fs.title AS from_session_title
       FROM handoffs h
       JOIN agents fa ON fa.id = h.from_agent_id
       JOIN agents ta ON ta.id = h.to_agent_id
       JOIN tasks t ON t.id = h.task_id
       JOIN sessions fs ON fs.id = h.from_session_id
       WHERE h.id = ?`,
      id,
    )
    return row ? this.handoffRowToView(row) : null
  }

  private handoffRowToView(
    row: HandoffRow & {
      from_agent_name: string
      to_agent_name: string
      task_title: string
      from_session_title: string
    },
  ): HandoffView {
    return {
      ...toHandoff(row),
      fromAgentName: row.from_agent_name,
      toAgentName: row.to_agent_name,
      taskTitle: row.task_title,
      fromSessionTitle: row.from_session_title,
    }
  }

  listHandoffViews(projectId: string): HandoffView[] {
    const rows = this.all<
      HandoffRow & {
        from_agent_name: string
        to_agent_name: string
        task_title: string
        from_session_title: string
      }
    >(
      `SELECT h.*, fa.name AS from_agent_name, ta.name AS to_agent_name, t.title AS task_title, fs.title AS from_session_title
       FROM handoffs h
       JOIN agents fa ON fa.id = h.from_agent_id
       JOIN agents ta ON ta.id = h.to_agent_id
       JOIN tasks t ON t.id = h.task_id
       JOIN sessions fs ON fs.id = h.from_session_id
       WHERE h.project_id = ?
       ORDER BY h.requested_at DESC`,
      projectId,
    )
    return rows.map((row) => this.handoffRowToView(row))
  }

  getCollaborationSnapshot(projectId: string): CollaborationSnapshot {
    const agents = this.getAgentViews(projectId)
    const sessions = this.listSessionSummaries(projectId)
    const inbox = this.listInboxViews(projectId)
    const handoffs = this.listHandoffViews(projectId)
    return {
      agents,
      sessions,
      inbox,
      handoffs,
      deliveryStats: this.getDeliveryStats(projectId),
    }
  }

  getTaskLease(taskId: string): { taskId: string; holderId: string; fencingToken: number; expiresAt: number } | null {
    const row = this.get<{
      task_id: string
      holder_id: string
      fencing_token: number
      expires_at: number
    }>('SELECT * FROM task_leases WHERE task_id = ?', taskId)
    return row
      ? {
          taskId: row.task_id,
          holderId: row.holder_id,
          fencingToken: Number(row.fencing_token),
          expiresAt: Number(row.expires_at),
        }
      : null
  }

  getCheckpoint(id: string): { state: unknown; schemaVersion: number } | null {
    const row = this.get<{ state_json: string; schema_version: number }>(
      'SELECT * FROM checkpoints WHERE id = ?',
      id,
    )
    if (!row) return null
    return { state: parseUnknown(row.state_json), schemaVersion: Number(row.schema_version) }
  }

  countActiveRuns(): number {
    return Number(
      this.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM agent_runs WHERE status IN ${ACTIVE_RUN_STATUSES}`,
      )?.count ?? 0,
    )
  }

  listUnfinishedRuns(limit = 100): Run[] {
    return this.all<RunRow>(
      `SELECT * FROM agent_runs WHERE status NOT IN ('completed','failed','cancelled')
       ORDER BY created_at ASC LIMIT ?`,
      limit,
    ).map(toRun)
  }

  getActiveRunForSession(sessionId: string): Run | null {
    const row = this.get<RunRow>(
      `SELECT * FROM agent_runs WHERE session_id = ? AND status IN ${ACTIVE_RUN_STATUSES}
       ORDER BY created_at DESC LIMIT 1`,
      sessionId,
    )
    return row ? toRun(row) : null
  }

  countPendingApprovals(): number {
    return Number(
      this.get<{ count: number }>("SELECT COUNT(*) AS count FROM approvals WHERE status = 'pending'")?.count ?? 0,
    )
  }

  listAIConnections(): AIConnectionProfile[] {
    return this.all<AIConnectionRow>(
      'SELECT * FROM ai_connection_profiles ORDER BY is_default DESC, updated_at DESC',
    ).map(toAIConnection)
  }

  listAgentBackendBindings(): AgentBackendBinding[] {
    return this.all<AgentBackendBindingRow>(
      'SELECT * FROM agent_backend_bindings ORDER BY priority DESC, updated_at DESC',
    ).map(toAgentBackendBinding)
  }

  listAIModelPrices(connectionId?: string): AIModelPrice[] {
    return connectionId
      ? this.all<AIModelPriceRow>(
          'SELECT * FROM ai_model_prices WHERE connection_id = ? ORDER BY model_id',
          connectionId,
        ).map(toAIModelPrice)
      : this.all<AIModelPriceRow>('SELECT * FROM ai_model_prices ORDER BY connection_id, model_id').map(toAIModelPrice)
  }

  getAIModelPrice(connectionId: string, modelId: string): AIModelPrice | null {
    const row = this.get<AIModelPriceRow>(
      'SELECT * FROM ai_model_prices WHERE connection_id = ? AND model_id = ?',
      connectionId,
      modelId,
    )
    return row ? toAIModelPrice(row) : null
  }

  getProjectBudget(projectId: string): { projectId: string; softLimit: number; currency: string; updatedAt: number } | null {
    const row = this.get<ProjectBudgetRow>('SELECT * FROM project_budgets WHERE project_id = ?', projectId)
    return row
      ? {
          projectId: row.project_id,
          softLimit: Number(row.soft_limit),
          currency: row.currency,
          updatedAt: Number(row.updated_at),
        }
      : null
  }

  summarizeAIUsage(projectId?: string): AIUsageSummary {
    const where = projectId ? 'WHERE r.project_id = ?' : ''
    const params = projectId ? [projectId] : []
    const rows = this.all<{
      connection_id: string | null
      model_id: string | null
      runs: number
      input_tokens: number | null
      output_tokens: number | null
      estimated_cost: number | null
    }>(
      `SELECT u.connection_id, u.model_id, COUNT(DISTINCT u.run_id) AS runs,
              SUM(u.input_tokens) AS input_tokens, SUM(u.output_tokens) AS output_tokens,
              SUM(u.estimated_cost) AS estimated_cost
       FROM ai_usage_records u JOIN agent_runs r ON r.id = u.run_id
       ${where}
       GROUP BY u.connection_id, u.model_id
       ORDER BY runs DESC`,
      ...params,
    )
    const byConnection = rows.map((row) => ({
      connectionId: row.connection_id,
      modelId: row.model_id,
      runs: Number(row.runs),
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      estimatedCost: Number(row.estimated_cost ?? 0),
    }))
    return {
      runs: byConnection.reduce((sum, row) => sum + row.runs, 0),
      inputTokens: byConnection.reduce((sum, row) => sum + row.inputTokens, 0),
      outputTokens: byConnection.reduce((sum, row) => sum + row.outputTokens, 0),
      estimatedCost: byConnection.reduce((sum, row) => sum + row.estimatedCost, 0),
      byConnection,
    }
  }

  getAIConnection(id: string): AIConnectionProfile | null {
    const row = this.get<AIConnectionRow>('SELECT * FROM ai_connection_profiles WHERE id = ?', id)
    return row ? toAIConnection(row) : null
  }

  getDefaultAIConnection(): AIConnectionProfile | null {
    const row = this.get<AIConnectionRow>('SELECT * FROM ai_connection_profiles WHERE is_default = 1 LIMIT 1')
    return row ? toAIConnection(row) : null
  }

  getAIConnectionView(id: string): AIConnectionView | null {
    const profile = this.getAIConnection(id)
    return profile ? this.toAIConnectionView(profile) : null
  }

  listAIConnectionViews(): AIConnectionView[] {
    return this.listAIConnections().map((profile) => this.toAIConnectionView(profile))
  }

  private toAIConnectionView(profile: AIConnectionProfile): AIConnectionView {
    const count = this.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM ai_models WHERE connection_id = ?',
      profile.id,
    )?.count
    return {
      ...profile,
      hasSecret: Boolean(profile.secretRef),
      modelCount: Number(count ?? 0),
      lastCheck: this.getLatestAIConnectionCheck(profile.id),
    }
  }

  listAIModels(connectionId: string): AIModel[] {
    return this.all<AIModelRow>(
      'SELECT * FROM ai_models WHERE connection_id = ? ORDER BY display_name COLLATE NOCASE ASC',
      connectionId,
    ).map(toAIModel)
  }

  getAIModel(connectionId: string, modelId: string): AIModel | null {
    const row = this.get<AIModelRow>(
      'SELECT * FROM ai_models WHERE connection_id = ? AND model_id = ?',
      connectionId,
      modelId,
    )
    return row ? toAIModel(row) : null
  }

  listAIConnectionChecks(connectionId: string, limit = 30): AIConnectionCheck[] {
    return this.all<AIConnectionCheckRow>(
      'SELECT * FROM ai_connection_checks WHERE connection_id = ? ORDER BY checked_at DESC LIMIT ?',
      connectionId,
      limit,
    ).map(toAIConnectionCheck)
  }

  getLatestAIConnectionCheck(connectionId: string): AIConnectionCheck | null {
    const row = this.get<AIConnectionCheckRow>(
      'SELECT * FROM ai_connection_checks WHERE connection_id = ? ORDER BY checked_at DESC LIMIT 1',
      connectionId,
    )
    return row ? toAIConnectionCheck(row) : null
  }

  getLatestProjectSnapshot(projectId: string): ProjectSnapshot | null {
    const row = this.get<ProjectSnapshotRow>(
      'SELECT * FROM project_snapshots WHERE project_id = ? ORDER BY scanned_at DESC LIMIT 1',
      projectId,
    )
    return row ? toProjectSnapshot(row) : null
  }

  listPlanRevisions(projectId: string): PlanDraft[] {
    return this.all<PlanRevisionRow>(
      'SELECT * FROM plan_revisions WHERE project_id = ? ORDER BY revision DESC',
      projectId,
    ).map(toPlanRevision)
  }

  listAllPlanRevisions(): PlanDraft[] {
    return this.all<PlanRevisionRow>('SELECT * FROM plan_revisions ORDER BY updated_at DESC').map(toPlanRevision)
  }

  getPlanRevision(id: string): PlanDraft | null {
    const row = this.get<PlanRevisionRow>('SELECT * FROM plan_revisions WHERE id = ?', id)
    return row ? toPlanRevision(row) : null
  }

  getNextPlanRevision(projectId: string): number {
    const row = this.get<{ revision: number | null }>(
      'SELECT MAX(revision) AS revision FROM plan_revisions WHERE project_id = ?',
      projectId,
    )
    return Number(row?.revision ?? 0) + 1
  }

  getGraphLayout(projectId: string, viewId = 'default'): GraphLayout | null {
    const row = this.get<GraphLayoutRow>(
      'SELECT * FROM graph_layouts WHERE project_id = ? AND view_id = ?',
      projectId,
      viewId,
    )
    return row ? toGraphLayout(row) : null
  }

  getLastEventSeq(projectId: string): number {
    return Number(
      this.get<{ seq: number | null }>(
        'SELECT MAX(seq) AS seq FROM project_events WHERE project_id = ?',
        projectId,
      )?.seq ?? 0,
    )
  }

  getLatestRunForTask(taskId: string): Run | null {
    const row = this.get<RunRow>(
      'SELECT * FROM agent_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1',
      taskId,
    )
    return row ? toRun(row) : null
  }

  getActiveRunForTask(taskId: string): Run | null {
    const row = this.get<RunRow>(
      `SELECT * FROM agent_runs WHERE task_id = ? AND status IN ${ACTIVE_RUN_STATUSES}
       ORDER BY created_at DESC LIMIT 1`,
      taskId,
    )
    return row ? toRun(row) : null
  }
}

