import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from './sqlite.js'
import {
  AppError,
  newId,
  now,
  type Agent,
  type AgentCapability,
  type AIConnectionCheck,
  type AIConnectionProfile,
  type AIModel,
  type AIModelCapabilities,
  type AIModelPrice,
  type AgentBackendBinding,
  type AIUsageRecord,
  type GraphLayout,
  type PlanDraft,
  type ProjectSnapshot,
  type Approval,
  type Artifact,
  type ArtifactKind,
  type CrossSessionEnvelope,
  type Decision,
  type Handoff,
  type InboxItem,
  type Message,
  type MessageRole,
  type Milestone,
  type Project,
  type ProjectEvent,
  type ProjectStage,
  type Requirement,
  type Run,
  type RunStatus,
  type RunStep,
  type RunStepKind,
  type Session,
  type SessionStatus,
  type Task,
  type TaskStatus,
  type ToolCall,
  type ToolCallStatus,
} from '@projectos/contracts'
import { applyMigrations } from './migrations.js'
import { ReadModels } from './read-models.js'
import {
  parseUnknown,
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
  type SessionRow,
  type TaskRow,
  type ToolCallRow,
} from './rows.js'

export interface SqliteStoreOptions {
  filePath: string
  onEvents?: (events: ProjectEvent[]) => void
  logger?: (message: string) => void
}

type SqlValue = string | number | null

const BUILTIN_AGENTS: Array<{
  id: string
  name: string
  role: string
  description: string
  capabilities: AgentCapability[]
  accent: string
  systemPrompt: string
}> = [
  {
    id: 'agt_product',
    name: 'Avery',
    role: '产品负责人',
    description: '把目标拆解为需求、里程碑与可验收任务，协调 Agent 交接。',
    capabilities: ['plan', 'analyze', 'coordinate'],
    accent: '#4C8DFF',
    systemPrompt:
      '你是 ProjectOS 的产品负责人。你负责澄清目标、提炼需求与验收标准、拆分里程碑，并在任务之间协调交接。优先使用 create_requirement、create_milestone、create_task、record_decision 与 handoff_task 工具。不要虚构项目事实；所有结论必须来自提供的上下文或工作区文件。',
  },
  {
    id: 'agt_architect',
    name: 'Sage',
    role: '架构师',
    description: '负责技术方案、架构决策与风险权衡，产出可追溯的 ADR。',
    capabilities: ['architect', 'analyze', 'review'],
    accent: '#9A7CFF',
    systemPrompt:
      '你是 ProjectOS 的架构师。你负责识别技术约束、比较方案、记录架构决策（ADR）并给出可执行的实施边界。使用 record_decision 记录决策，使用 read_file / list_directory 阅读真实代码。不要假设未经验证的 API 或依赖。',
  },
  {
    id: 'agt_engineer',
    name: 'Kai',
    role: '开发工程师',
    description: '在受控工作区内实现任务，执行测试并生成交付物。',
    capabilities: ['implement', 'analyze'],
    accent: '#22B8A0',
    systemPrompt:
      '你是 ProjectOS 的开发工程师。你只处理当前任务及其必要依赖。修改文件前先阅读相关代码；写文件与执行命令需要显式授权。完成实现后运行相关测试，并用 create_artifact 记录交付物与验证结果。不要声称未运行过的测试已经通过。',
  },
  {
    id: 'agt_reviewer',
    name: 'Nova',
    role: '代码审查员',
    description: '审查实现、验证验收标准并给出可执行结论。',
    capabilities: ['review', 'analyze'],
    accent: '#E0A23C',
    systemPrompt:
      '你是 ProjectOS 的代码审查员。你检查当前任务、Git 差异与验收标准，指出具体风险与缺失测试。你只读取工作区，不直接修改代码；结论通过 create_artifact 记录为审查报告，并可发起 handoff_task 交给测试 Agent。',
  },
  {
    id: 'agt_qa',
    name: 'Iris',
    role: '测试工程师',
    description: '设计并执行验收测试，记录真实结果与遗留风险。',
    capabilities: ['test', 'review'],
    accent: '#E36A8C',
    systemPrompt:
      '你是 ProjectOS 的测试工程师。你根据验收标准设计并执行测试，记录真实命令、退出码和输出。只读命令可以直接执行；修改或危险命令需要请求授权。测试结果通过 create_artifact 记录；失败时更新任务状态为受阻并说明原因。',
  },
]

export class SqliteStore {
  readonly db: DatabaseSync
  readonly read: ReadModels
  private readonly onEvents?: (events: ProjectEvent[]) => void
  private inTransaction = false
  private pendingEvents: ProjectEvent[] = []

  constructor(options: SqliteStoreOptions) {
    if (options.filePath !== ':memory:') {
      mkdirSync(dirname(options.filePath), { recursive: true })
    }
    this.db = new DatabaseSync(options.filePath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.exec('PRAGMA synchronous = NORMAL')
    applyMigrations(this.db, options.logger)
    this.read = new ReadModels(this.db)
    this.onEvents = options.onEvents
    this.ensureBuiltinAgents()
  }

  close(): void {
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      // checkpoint is best-effort
    }
    this.db.close()
  }

  private all<T>(sql: string, ...params: SqlValue[]): T[] {
    return this.db.prepare(sql).all(...params) as unknown as T[]
  }

  private get<T>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as unknown as T | undefined
  }

  private run(sql: string, ...params: SqlValue[]): void {
    this.db.prepare(sql).run(...params)
  }

  transaction<T>(fn: () => T): T {
    if (this.inTransaction) return fn()
    this.db.exec('BEGIN IMMEDIATE')
    this.inTransaction = true
    this.pendingEvents = []
    try {
      const result = fn()
      this.db.exec('COMMIT')
      this.inTransaction = false
      const events = this.pendingEvents
      this.pendingEvents = []
      if (events.length > 0) {
        try {
          this.onEvents?.(events)
          for (const event of events) {
            this.run(
              "UPDATE outbox SET status = 'dispatched', attempts = attempts + 1 WHERE event_id = ? AND status = 'pending'",
              event.id,
            )
          }
        } catch {
          // The event remains pending in the outbox; the committed projection is still correct.
        }
      }
      return result
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // ignore rollback failures; the original error is more useful
      }
      this.inTransaction = false
      this.pendingEvents = []
      throw error
    }
  }

  private write<T>(fn: () => T): T {
    return this.inTransaction ? fn() : this.transaction(fn)
  }

  ensureBuiltinAgents(): void {
    this.write(() => {
      for (const agent of BUILTIN_AGENTS) {
        this.run(
          `INSERT INTO agents (id, name, role, description, kind, driver_id, capabilities_json, accent, system_prompt, builtin, created_at)
           VALUES (?, ?, ?, ?, 'builtin', 'native', ?, ?, ?, 1, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, description = excluded.description,
             capabilities_json = excluded.capabilities_json, accent = excluded.accent, system_prompt = excluded.system_prompt`,
          agent.id,
          agent.name,
          agent.role,
          agent.description,
          JSON.stringify(agent.capabilities),
          agent.accent,
          agent.systemPrompt,
          now(),
        )
      }
    })
  }

  getAgent(id: string): Agent | null {
    return this.read.getAgent(id)
  }

  listAgents(): Agent[] {
    return this.read.listAgents()
  }

  createProject(project: Project, stages: ProjectStage[]): Project {
    return this.write(() => {
      this.run(
        `INSERT INTO projects (id, name, description, root_path, status, current_stage, version, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        project.id,
        project.name,
        project.description,
        project.rootPath,
        project.status,
        project.currentStage,
        project.version,
        project.isDemo ? 1 : 0,
        project.createdAt,
        project.updatedAt,
      )
      for (const stage of stages) {
        this.run(
          `INSERT INTO project_stages (project_id, stage, status, position, updated_at) VALUES (?, ?, ?, ?, ?)`,
          stage.projectId,
          stage.stage,
          stage.status,
          stage.position,
          stage.updatedAt,
        )
      }
      return project
    })
  }

  getProject(id: string): Project | null {
    return this.read.getProject(id)
  }

  getProjectByName(name: string): Project | null {
    return this.read.getProjectByName(name)
  }

  findProjectByRootPath(rootPath: string): Project | null {
    const row = this.get<ProjectRow>('SELECT * FROM projects WHERE root_path = ? LIMIT 1', rootPath)
    return row ? toProject(row) : null
  }

  updateProject(
    id: string,
    expectedVersion: number,
    patch: {
      name?: string
      description?: string
      status?: Project['status']
      currentStage?: Project['currentStage']
    },
  ): Project {
    return this.write(() => {
      const sets: string[] = []
      const params: SqlValue[] = []
      if (patch.name !== undefined) {
        sets.push('name = ?')
        params.push(patch.name)
      }
      if (patch.description !== undefined) {
        sets.push('description = ?')
        params.push(patch.description)
      }
      if (patch.status !== undefined) {
        sets.push('status = ?')
        params.push(patch.status)
      }
      if (patch.currentStage !== undefined) {
        sets.push('current_stage = ?')
        params.push(patch.currentStage)
      }
      sets.push('version = version + 1', 'updated_at = ?')
      params.push(now())
      params.push(id, expectedVersion)
      const result = this.db
        .prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND version = ?`)
        .run(...params)
      if (Number(result.changes) === 0) {
        const current = this.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id)
        if (!current) throw new AppError('NOT_FOUND', '项目不存在')
        throw new AppError('CONFLICT', '项目已被其他操作更新，请刷新后重试', {
          details: { expectedVersion, actualVersion: Number(current.version) },
        })
      }
      const updated = this.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id)
      if (!updated) throw new AppError('NOT_FOUND', '项目不存在')
      return toProject(updated)
    })
  }

  setStageStatus(projectId: string, stage: string, status: string): void {
    this.write(() => {
      this.run(
        'UPDATE project_stages SET status = ?, updated_at = ? WHERE project_id = ? AND stage = ?',
        status,
        now(),
        projectId,
        stage,
      )
    })
  }

  createRequirement(requirement: Requirement): Requirement {
    return this.write(() => {
      this.run(
        `INSERT INTO requirements (id, project_id, title, body, status, source, acceptance_json, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        requirement.id,
        requirement.projectId,
        requirement.title,
        requirement.body,
        requirement.status,
        requirement.source,
        JSON.stringify(requirement.acceptanceCriteria),
        requirement.version,
        requirement.createdAt,
        requirement.updatedAt,
      )
      return requirement
    })
  }

  setRequirementStatus(id: string, status: Requirement['status']): Requirement {
    return this.write(() => {
      const result = this.run2(
        'UPDATE requirements SET status = ?, version = version + 1, updated_at = ? WHERE id = ?',
        status,
        now(),
        id,
      )
      if (result === 0) throw new AppError('NOT_FOUND', '需求不存在')
      const row = this.get<RequirementRow>('SELECT * FROM requirements WHERE id = ?', id)
      if (!row) throw new AppError('NOT_FOUND', '需求不存在')
      return toRequirement(row)
    })
  }

  createMilestone(milestone: Milestone): Milestone {
    return this.write(() => {
      this.run(
        `INSERT INTO milestones (id, project_id, title, description, due_at, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        milestone.id,
        milestone.projectId,
        milestone.title,
        milestone.description,
        milestone.dueAt,
        milestone.status,
        milestone.createdAt,
        milestone.updatedAt,
      )
      return milestone
    })
  }

  setMilestoneStatus(id: string, status: Milestone['status']): Milestone {
    return this.write(() => {
      const changed = this.run2('UPDATE milestones SET status = ?, updated_at = ? WHERE id = ?', status, now(), id)
      if (changed === 0) throw new AppError('NOT_FOUND', '里程碑不存在')
      const row = this.get<MilestoneRow>('SELECT * FROM milestones WHERE id = ?', id)
      if (!row) throw new AppError('NOT_FOUND', '里程碑不存在')
      return toMilestone(row)
    })
  }

  createDecision(decision: Decision): Decision {
    return this.write(() => {
      this.run(
        `INSERT INTO decisions (id, project_id, title, body, status, supersedes_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        decision.id,
        decision.projectId,
        decision.title,
        decision.body,
        decision.status,
        decision.supersedesId,
        decision.createdAt,
        decision.updatedAt,
      )
      return decision
    })
  }

  setDecisionStatus(id: string, status: Decision['status']): Decision {
    return this.write(() => {
      const changed = this.run2('UPDATE decisions SET status = ?, updated_at = ? WHERE id = ?', status, now(), id)
      if (changed === 0) throw new AppError('NOT_FOUND', '决策不存在')
      const row = this.get<DecisionRow>('SELECT * FROM decisions WHERE id = ?', id)
      if (!row) throw new AppError('NOT_FOUND', '决策不存在')
      return toDecision(row)
    })
  }

  createArtifact(artifact: Artifact): Artifact {
    return this.write(() => {
      this.run(
        `INSERT INTO artifacts (id, project_id, task_id, run_id, kind, title, uri, content_hash, git_commit, verified_at, body, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        artifact.id,
        artifact.projectId,
        artifact.taskId,
        artifact.runId,
        artifact.kind,
        artifact.title,
        artifact.uri,
        artifact.contentHash,
        artifact.gitCommit,
        artifact.verifiedAt,
        artifact.body,
        artifact.isDemo ? 1 : 0,
        artifact.createdAt,
      )
      return artifact
    })
  }

  verifyArtifact(id: string): Artifact {
    return this.write(() => {
      const changed = this.run2('UPDATE artifacts SET verified_at = ? WHERE id = ?', now(), id)
      if (changed === 0) throw new AppError('NOT_FOUND', '交付物不存在')
      const row = this.get<ArtifactRow>('SELECT * FROM artifacts WHERE id = ?', id)
      if (!row) throw new AppError('NOT_FOUND', '交付物不存在')
      return toArtifact(row)
    })
  }

  createKnowledge(entry: {
    id: string
    projectId: string
    title: string
    body: string
    sourceUri: string | null
    sourceVersion: string | null
  }) {
    return this.write(() => {
      const timestamp = now()
      this.run(
        `INSERT INTO knowledge_entries (id, project_id, title, body, source_uri, source_version, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        entry.id,
        entry.projectId,
        entry.title,
        entry.body,
        entry.sourceUri,
        entry.sourceVersion,
        timestamp,
        timestamp,
      )
      const row = this.get<KnowledgeRow>('SELECT * FROM knowledge_entries WHERE id = ?', entry.id)
      if (!row) throw new AppError('INTERNAL', '知识条目写入失败')
      return toKnowledge(row)
    })
  }

  createTask(task: Task, dependencies: string[] = []): Task {
    return this.write(() => {
      this.run(
        `INSERT INTO tasks (id, project_id, parent_id, milestone_id, title, description, status, priority, assignee_agent_id, acceptance_json, labels_json, version, due_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        task.id,
        task.projectId,
        task.parentId,
        task.milestoneId,
        task.title,
        task.description,
        task.status,
        task.priority,
        task.assigneeAgentId,
        JSON.stringify(task.acceptanceCriteria),
        JSON.stringify(task.labels),
        task.version,
        task.dueAt,
        task.createdAt,
        task.updatedAt,
      )
      for (const dependency of dependencies) {
        this.run(
          'INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)',
          task.id,
          dependency,
        )
      }
      return task
    })
  }

  updateTask(
    taskId: string,
    expectedVersion: number,
    patch: {
      title?: string
      description?: string
      priority?: Task['priority']
      assigneeAgentId?: string | null
      acceptanceCriteria?: string[]
      labels?: string[]
      milestoneId?: string | null
      dueAt?: number | null
    },
  ): Task {
    return this.write(() => {
      const sets: string[] = []
      const params: SqlValue[] = []
      if (patch.title !== undefined) {
        sets.push('title = ?')
        params.push(patch.title)
      }
      if (patch.description !== undefined) {
        sets.push('description = ?')
        params.push(patch.description)
      }
      if (patch.priority !== undefined) {
        sets.push('priority = ?')
        params.push(patch.priority)
      }
      if (patch.assigneeAgentId !== undefined) {
        sets.push('assignee_agent_id = ?')
        params.push(patch.assigneeAgentId)
      }
      if (patch.acceptanceCriteria !== undefined) {
        sets.push('acceptance_json = ?')
        params.push(JSON.stringify(patch.acceptanceCriteria))
      }
      if (patch.labels !== undefined) {
        sets.push('labels_json = ?')
        params.push(JSON.stringify(patch.labels))
      }
      if (patch.milestoneId !== undefined) {
        sets.push('milestone_id = ?')
        params.push(patch.milestoneId)
      }
      if (patch.dueAt !== undefined) {
        sets.push('due_at = ?')
        params.push(patch.dueAt)
      }
      sets.push('version = version + 1', 'updated_at = ?')
      params.push(now())
      params.push(taskId, expectedVersion)
      const result = this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND version = ?`).run(...params)
      if (Number(result.changes) === 0) {
        const current = this.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', taskId)
        if (!current) throw new AppError('NOT_FOUND', '任务不存在')
        throw new AppError('CONFLICT', '任务已被其他操作更新，请刷新后重试', {
          details: { expectedVersion, actualVersion: Number(current.version) },
        })
      }
      const updated = this.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', taskId)
      if (!updated) throw new AppError('NOT_FOUND', '任务不存在')
      return toTask(updated)
    })
  }

  moveTask(taskId: string, expectedVersion: number, to: TaskStatus): Task {
    return this.write(() => {
      const result = this.db
        .prepare('UPDATE tasks SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
        .run(to, now(), taskId, expectedVersion)
      if (Number(result.changes) === 0) {
        const current = this.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', taskId)
        if (!current) throw new AppError('NOT_FOUND', '任务不存在')
        throw new AppError('CONFLICT', '任务已被其他操作更新，请刷新后重试', {
          details: { expectedVersion, actualVersion: Number(current.version) },
        })
      }
      const updated = this.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', taskId)
      if (!updated) throw new AppError('NOT_FOUND', '任务不存在')
      return toTask(updated)
    })
  }

  addDependency(taskId: string, dependsOnId: string): void {
    this.write(() => {
      this.run('INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)', taskId, dependsOnId)
    })
  }

  removeDependency(taskId: string, dependsOnId: string): void {
    this.write(() => {
      this.run('DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?', taskId, dependsOnId)
    })
  }

  nextAttemptNo(taskId: string): number {
    const row = this.get<{ value: number | null }>(
      'SELECT MAX(attempt_no) AS value FROM task_attempts WHERE task_id = ?',
      taskId,
    )
    return Number(row?.value ?? 0) + 1
  }

  createAttempt(input: {
    id: string
    taskId: string
    attemptNo: number
    agentId: string
    runId: string | null
    status: string
  }): void {
    this.write(() => {
      this.run(
        `INSERT INTO task_attempts (id, task_id, attempt_no, agent_id, run_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        input.id,
        input.taskId,
        input.attemptNo,
        input.agentId,
        input.runId,
        input.status,
        now(),
      )
    })
  }

  acquireTaskLease(taskId: string, holderId: string, ttlMs: number): { token: number; expiresAt: number } {
    return this.write(() => {
      const existing = this.get<{ fencing_token: number; expires_at: number; holder_id: string }>(
        'SELECT * FROM task_leases WHERE task_id = ?',
        taskId,
      )
      const timestamp = now()
      if (existing && Number(existing.expires_at) > timestamp && existing.holder_id !== holderId) {
        throw new AppError('CONFLICT', '任务已被其他执行者持有有效租约', {
          details: { holderId: existing.holder_id, expiresAt: existing.expires_at },
        })
      }
      const token = Number(existing?.fencing_token ?? 0) + 1
      const expiresAt = timestamp + ttlMs
      this.run(
        `INSERT INTO task_leases (task_id, holder_id, fencing_token, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET holder_id = excluded.holder_id, fencing_token = excluded.fencing_token, expires_at = excluded.expires_at`,
        taskId,
        holderId,
        token,
        expiresAt,
      )
      return { token, expiresAt }
    })
  }

  renewTaskLease(taskId: string, holderId: string, token: number, ttlMs: number): void {
    this.write(() => {
      const changed = this.run2(
        'UPDATE task_leases SET expires_at = ? WHERE task_id = ? AND holder_id = ? AND fencing_token = ?',
        now() + ttlMs,
        taskId,
        holderId,
        token,
      )
      if (changed === 0) throw new AppError('CONFLICT', '任务租约已失效，无法续约')
    })
  }

  releaseTaskLease(taskId: string, holderId: string, token: number): void {
    this.write(() => {
      // Keep the row so the fencing token never goes backwards; mark it expired.
      this.run(
        'UPDATE task_leases SET expires_at = 0 WHERE task_id = ? AND holder_id = ? AND fencing_token = ?',
        taskId,
        holderId,
        token,
      )
    })
  }

  createSession(session: Session): Session {
    return this.write(() => {
      this.run(
        `INSERT INTO sessions (id, project_id, agent_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        session.id,
        session.projectId,
        session.agentId,
        session.title,
        session.status,
        session.createdAt,
        session.updatedAt,
      )
      return session
    })
  }

  updateSession(id: string, patch: { title?: string; status?: SessionStatus }): Session {
    return this.write(() => {
      const sets: string[] = []
      const params: SqlValue[] = []
      if (patch.title !== undefined) {
        sets.push('title = ?')
        params.push(patch.title)
      }
      if (patch.status !== undefined) {
        sets.push('status = ?')
        params.push(patch.status)
      }
      sets.push('updated_at = ?')
      params.push(now(), id)
      const result = this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...params)
      if (Number(result.changes) === 0) throw new AppError('NOT_FOUND', '会话不存在')
      const row = this.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', id)
      if (!row) throw new AppError('NOT_FOUND', '会话不存在')
      return toSession(row)
    })
  }

  appendMessage(input: {
    sessionId: string
    role: MessageRole
    content: string
    runId?: string | null
    metadata?: Record<string, unknown>
    createdAt?: number
  }): Message {
    return this.write(() => {
      const seqRow = this.get<{ value: number | null }>(
        'SELECT MAX(seq) AS value FROM messages WHERE session_id = ?',
        input.sessionId,
      )
      const seq = Number(seqRow?.value ?? 0) + 1
      const message: Message = {
        id: newId('msg'),
        sessionId: input.sessionId,
        seq,
        role: input.role,
        content: input.content,
        runId: input.runId ?? null,
        metadata: input.metadata ?? {},
        createdAt: input.createdAt ?? now(),
      }
      this.run(
        `INSERT INTO messages (id, session_id, seq, role, content, run_id, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        message.id,
        message.sessionId,
        message.seq,
        message.role,
        message.content,
        message.runId,
        JSON.stringify(message.metadata),
        message.createdAt,
      )
      this.run('UPDATE sessions SET updated_at = ?, status = ? WHERE id = ?', now(), 'active', input.sessionId)
      return message
    })
  }

  createRun(run: Run): Run {
    return this.write(() => {
      this.run(
        `INSERT INTO agent_runs (id, project_id, task_id, session_id, agent_id, attempt, status, error, summary,
           input_tokens, output_tokens, checkpoint_id, started_at, finished_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        run.id,
        run.projectId,
        run.taskId,
        run.sessionId,
        run.agentId,
        run.attempt,
        run.status,
        run.error,
        run.summary,
        run.inputTokens,
        run.outputTokens,
        run.checkpointId,
        run.startedAt,
        run.finishedAt,
        run.createdAt,
      )
      return run
    })
  }

  nextRunAttempt(taskId: string): number {
    const row = this.get<{ value: number | null }>(
      'SELECT MAX(attempt) AS value FROM agent_runs WHERE task_id = ?',
      taskId,
    )
    return Number(row?.value ?? 0) + 1
  }

  updateRun(
    runId: string,
    patch: {
      status?: RunStatus
      error?: string | null
      summary?: string | null
      inputTokens?: number
      outputTokens?: number
      checkpointId?: string | null
      startedAt?: number | null
      finishedAt?: number | null
    },
  ): Run {
    return this.write(() => {
      const sets: string[] = []
      const params: SqlValue[] = []
      const mapping: Array<[keyof typeof patch, string]> = [
        ['status', 'status'],
        ['error', 'error'],
        ['summary', 'summary'],
        ['inputTokens', 'input_tokens'],
        ['outputTokens', 'output_tokens'],
        ['checkpointId', 'checkpoint_id'],
        ['startedAt', 'started_at'],
        ['finishedAt', 'finished_at'],
      ]
      for (const [key, column] of mapping) {
        if (patch[key] !== undefined) {
          sets.push(`${column} = ?`)
          params.push(patch[key] as SqlValue)
        }
      }
      if (sets.length > 0) {
        params.push(runId)
        this.run(`UPDATE agent_runs SET ${sets.join(', ')} WHERE id = ?`, ...params)
      }
      const row = this.get<RunRow>('SELECT * FROM agent_runs WHERE id = ?', runId)
      if (!row) throw new AppError('NOT_FOUND', '运行不存在')
      return toRun(row)
    })
  }

  appendRunStep(input: {
    runId: string
    kind: RunStepKind
    status?: string
    title?: string
    payload?: Record<string, unknown>
  }): RunStep {
    return this.write(() => {
      const seqRow = this.get<{ value: number | null }>(
        'SELECT MAX(seq) AS value FROM run_steps WHERE run_id = ?',
        input.runId,
      )
      const step: RunStep = {
        id: newId('stp'),
        runId: input.runId,
        seq: Number(seqRow?.value ?? 0) + 1,
        kind: input.kind,
        status: input.status ?? 'completed',
        title: input.title ?? '',
        payload: input.payload ?? {},
        createdAt: now(),
      }
      this.run(
        `INSERT INTO run_steps (id, run_id, seq, kind, status, title, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        step.id,
        step.runId,
        step.seq,
        step.kind,
        step.status,
        step.title,
        JSON.stringify(step.payload),
        step.createdAt,
      )
      return step
    })
  }

  updateRunStep(stepId: string, patch: { payload?: Record<string, unknown>; status?: string }): void {
    this.write(() => {
      const sets: string[] = []
      const params: SqlValue[] = []
      if (patch.payload !== undefined) {
        sets.push('payload_json = ?')
        params.push(JSON.stringify(patch.payload))
      }
      if (patch.status !== undefined) {
        sets.push('status = ?')
        params.push(patch.status)
      }
      if (sets.length === 0) return
      params.push(stepId)
      this.run(`UPDATE run_steps SET ${sets.join(', ')} WHERE id = ?`, ...params)
    })
  }

  createCheckpoint(input: { id: string; runId: string; seq: number; schemaVersion: number; state: unknown }) {
    this.write(() => {
      this.run(
        `INSERT INTO checkpoints (id, run_id, seq, schema_version, state_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        input.id,
        input.runId,
        input.seq,
        input.schemaVersion,
        JSON.stringify(input.state),
        now(),
      )
    })
  }

  createToolCall(input: {
    runId: string
    toolName: string
    idempotencyKey: string
    status: ToolCallStatus
    argsHash: string
    args: Record<string, unknown>
  }): ToolCall {
    return this.write(() => {
      const existing = this.get<ToolCallRow>(
        'SELECT * FROM tool_calls WHERE run_id = ? AND idempotency_key = ?',
        input.runId,
        input.idempotencyKey,
      )
      if (existing) return toToolCall(existing)
      const toolCall: ToolCall = {
        id: newId('tol'),
        runId: input.runId,
        toolName: input.toolName,
        idempotencyKey: input.idempotencyKey,
        status: input.status,
        argsHash: input.argsHash,
        args: input.args,
        result: null,
        error: null,
        createdAt: now(),
        startedAt: null,
        finishedAt: null,
      }
      this.run(
        `INSERT INTO tool_calls (id, run_id, tool_name, idempotency_key, status, args_hash, args_json, result_json, error, created_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL)`,
        toolCall.id,
        toolCall.runId,
        toolCall.toolName,
        toolCall.idempotencyKey,
        toolCall.status,
        toolCall.argsHash,
        JSON.stringify(toolCall.args),
        toolCall.createdAt,
      )
      return toolCall
    })
  }

  updateToolCall(
    id: string,
    patch: {
      status?: ToolCallStatus
      result?: unknown
      error?: string | null
      startedAt?: number | null
      finishedAt?: number | null
    },
  ): ToolCall {
    return this.write(() => {
      const sets: string[] = []
      const params: SqlValue[] = []
      if (patch.status !== undefined) {
        sets.push('status = ?')
        params.push(patch.status)
      }
      if (patch.result !== undefined) {
        sets.push('result_json = ?')
        params.push(JSON.stringify(patch.result))
      }
      if (patch.error !== undefined) {
        sets.push('error = ?')
        params.push(patch.error)
      }
      if (patch.startedAt !== undefined) {
        sets.push('started_at = ?')
        params.push(patch.startedAt)
      }
      if (patch.finishedAt !== undefined) {
        sets.push('finished_at = ?')
        params.push(patch.finishedAt)
      }
      if (sets.length === 0) {
        const row = this.get<ToolCallRow>('SELECT * FROM tool_calls WHERE id = ?', id)
        if (!row) throw new AppError('NOT_FOUND', '工具调用不存在')
        return toToolCall(row)
      }
      params.push(id)
      this.run(`UPDATE tool_calls SET ${sets.join(', ')} WHERE id = ?`, ...params)
      const row = this.get<ToolCallRow>('SELECT * FROM tool_calls WHERE id = ?', id)
      if (!row) throw new AppError('NOT_FOUND', '工具调用不存在')
      return toToolCall(row)
    })
  }

  createApproval(input: {
    projectId: string
    runId: string
    toolCallId: string | null
    title: string
    detail?: string
    request?: Record<string, unknown>
    expiresAt?: number | null
  }): Approval {
    return this.write(() => {
      const approval: Approval = {
        id: newId('apr'),
        projectId: input.projectId,
        runId: input.runId,
        toolCallId: input.toolCallId,
        status: 'pending',
        title: input.title,
        detail: input.detail ?? '',
        request: input.request ?? {},
        decision: null,
        requestedAt: now(),
        decidedAt: null,
        expiresAt: input.expiresAt ?? null,
      }
      this.run(
        `INSERT INTO approvals (id, project_id, run_id, tool_call_id, status, title, detail, request_json, decision, requested_at, decided_at, expires_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, NULL, ?, NULL, ?)`,
        approval.id,
        approval.projectId,
        approval.runId,
        approval.toolCallId,
        approval.title,
        approval.detail,
        JSON.stringify(approval.request),
        approval.requestedAt,
        approval.expiresAt,
      )
      return approval
    })
  }

  decideApproval(id: string, decision: 'approved' | 'rejected', note = ''): Approval {
    return this.write(() => {
      const changed = this.run2(
        `UPDATE approvals SET status = ?, decision = ?, decided_at = ? WHERE id = ? AND status = 'pending'`,
        decision,
        note,
        now(),
        id,
      )
      const row = this.get<ApprovalRow>('SELECT * FROM approvals WHERE id = ?', id)
      if (!row) throw new AppError('NOT_FOUND', '授权请求不存在')
      if (changed === 0) throw new AppError('CONFLICT', '该授权请求已被处理')
      return toApproval(row)
    })
  }

  createHandoff(handoff: Handoff): Handoff {
    return this.write(() => {
      this.run(
        `INSERT INTO handoffs (id, project_id, task_id, from_agent_id, from_session_id, to_agent_id, to_session_id, status, summary, payload_json, requested_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        handoff.id,
        handoff.projectId,
        handoff.taskId,
        handoff.fromAgentId,
        handoff.fromSessionId,
        handoff.toAgentId,
        handoff.toSessionId,
        handoff.status,
        handoff.summary,
        JSON.stringify(handoff.payload),
        handoff.requestedAt,
        handoff.decidedAt,
      )
      return handoff
    })
  }

  updateHandoff(
    id: string,
    patch: { status: Handoff['status']; toSessionId?: string | null; decidedAt?: number | null },
  ): Handoff {
    return this.write(() => {
      this.run(
        'UPDATE handoffs SET status = ?, to_session_id = COALESCE(?, to_session_id), decided_at = ? WHERE id = ?',
        patch.status,
        patch.toSessionId ?? null,
        patch.decidedAt ?? now(),
        id,
      )
      const row = this.get<HandoffRow>('SELECT * FROM handoffs WHERE id = ?', id)
      if (!row) throw new AppError('NOT_FOUND', '交接请求不存在')
      return toHandoff(row)
    })
  }

  insertInboxWithMessage(input: {
    projectId: string
    envelope: CrossSessionEnvelope
    recipientAgentId: string
    recipientSessionId: string
  }): { item: InboxItem; duplicate: boolean } {
    return this.write(() => {
      const existing = this.get<InboxRow>(
        'SELECT * FROM agent_inbox WHERE project_id = ? AND idempotency_key = ?',
        input.projectId,
        input.envelope.idempotencyKey,
      )
      if (existing) return { item: toInboxItem(existing), duplicate: true }
      const payload = input.envelope.payload
      const body =
        payload && typeof payload === 'object' && typeof (payload as { body?: unknown }).body === 'string'
          ? (payload as { body: string }).body
          : typeof payload === 'string'
            ? payload
            : JSON.stringify(payload ?? '')
      const message = this.appendMessage({
        sessionId: input.recipientSessionId,
        role: 'user',
        content: body,
        metadata: {
          crossSession: true,
          envelope: input.envelope,
          senderAgentId: input.envelope.sender.agentId,
          senderSessionId: input.envelope.sender.sessionId,
          type: input.envelope.type,
        },
      })
      const timestamp = now()
      const item: InboxItem = {
        id: newId('inb'),
        projectId: input.projectId,
        recipientAgentId: input.recipientAgentId,
        recipientSessionId: input.recipientSessionId,
        messageId: message.id,
        envelope: input.envelope,
        status: 'delivered',
        attempts: 1,
        error: null,
        createdAt: timestamp,
        deliveredAt: timestamp,
        acceptedAt: null,
        completedAt: null,
      }
      this.run(
        `INSERT INTO agent_inbox (id, project_id, recipient_agent_id, recipient_session_id, message_id, idempotency_key,
           envelope_json, status, attempts, error, created_at, delivered_at, accepted_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'delivered', 1, NULL, ?, ?, NULL, NULL)`,
        item.id,
        item.projectId,
        item.recipientAgentId,
        item.recipientSessionId,
        item.messageId,
        input.envelope.idempotencyKey,
        JSON.stringify(input.envelope),
        timestamp,
        timestamp,
      )
      return { item, duplicate: false }
    })
  }

  updateInboxStatus(
    id: string,
    status: InboxItem['status'],
    patch: { error?: string | null; incrementAttempts?: boolean } = {},
  ): InboxItem {
    return this.write(() => {
      const timestamp = now()
      const delivered = status === 'delivered' ? timestamp : null
      const accepted = status === 'accepted' ? timestamp : null
      const completed = status === 'completed' ? timestamp : null
      this.run(
        `UPDATE agent_inbox SET status = ?, error = COALESCE(?, error),
           attempts = attempts + ?, delivered_at = COALESCE(?, delivered_at),
           accepted_at = COALESCE(?, accepted_at), completed_at = COALESCE(?, completed_at)
         WHERE id = ?`,
        status,
        patch.error ?? null,
        patch.incrementAttempts ? 1 : 0,
        delivered,
        accepted,
        completed,
        id,
      )
      const row = this.get<InboxRow>('SELECT * FROM agent_inbox WHERE id = ?', id)
      if (!row) throw new AppError('NOT_FOUND', '收件箱条目不存在')
      return toInboxItem(row)
    })
  }

  appendEvent(
    projectId: string,
    aggregateId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): ProjectEvent {
    return this.write(() => {
      const seqRow = this.get<{ value: number | null }>(
        'SELECT MAX(seq) AS value FROM project_events WHERE project_id = ?',
        projectId,
      )
      const event: ProjectEvent = {
        id: newId('evt'),
        projectId,
        seq: Number(seqRow?.value ?? 0) + 1,
        aggregateId,
        eventType,
        payload,
        createdAt: now(),
      }
      this.run(
        `INSERT INTO project_events (id, project_id, seq, aggregate_id, event_type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        event.id,
        event.projectId,
        event.seq,
        event.aggregateId,
        event.eventType,
        JSON.stringify(event.payload),
        event.createdAt,
      )
      this.run(
        `INSERT INTO outbox (id, event_id, destination, payload_json, status, attempts, next_attempt_at, created_at)
         VALUES (?, ?, 'local:runtime', ?, 'pending', 0, ?, ?)`,
        newId('out'),
        event.id,
        JSON.stringify(event),
        event.createdAt,
        event.createdAt,
      )
      this.pendingEvents.push(event)
      return event
    })
  }

  listPendingOutbox(limit = 100): Array<{ id: string; eventId: string; payload: unknown; attempts: number }> {
    const rows = this.all<{ id: string; event_id: string; payload_json: string; attempts: number }>(
      "SELECT * FROM outbox WHERE status = 'pending' ORDER BY next_attempt_at ASC LIMIT ?",
      limit,
    )
    return rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      payload: parseUnknown(row.payload_json),
      attempts: Number(row.attempts),
    }))
  }

  getEventById(id: string): ProjectEvent | null {
    const row = this.get<EventRow>('SELECT * FROM project_events WHERE id = ?', id)
    return row ? toEvent(row) : null
  }

  getMessageById(id: string): Message | null {
    const row = this.get<MessageRow>('SELECT * FROM messages WHERE id = ?', id)
    return row ? toMessage(row) : null
  }

  getApprovalById(id: string): Approval | null {
    return this.read.getApproval(id)
  }

  getSessionById(id: string): Session | null {
    return this.read.getSession(id)
  }

  getRunById(id: string): Run | null {
    return this.read.getRun(id)
  }

  getHandoffById(id: string): Handoff | null {
    return this.read.getHandoff(id)
  }

  getProjectEventCount(projectId: string): number {
    return Number(
      this.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM project_events WHERE project_id = ?',
        projectId,
      )?.count ?? 0,
    )
  }

  deleteProject(id: string): void {
    this.write(() => {
      this.run('DELETE FROM projects WHERE id = ?', id)
    })
  }

  updateTaskAttemptStatus(runId: string, status: string): void {
    this.write(() => {
      this.run('UPDATE task_attempts SET status = ? WHERE run_id = ?', status, runId)
    })
  }

  cancelPendingApprovals(runId: string, note = '运行已取消'): void {
    this.write(() => {
      this.run(
        `UPDATE approvals SET status = 'cancelled', decision = ?, decided_at = ? WHERE run_id = ? AND status = 'pending'`,
        note,
        now(),
        runId,
      )
      this.run(
        `UPDATE tool_calls SET status = 'denied', error = ?, finished_at = ? WHERE run_id = ? AND status = 'waiting_approval'`,
        note,
        now(),
        runId,
      )
    })
  }

  private run2(sql: string, ...params: SqlValue[]): number {
    const result = this.db.prepare(sql).run(...params)
    return Number(result.changes)
  }

  createAIConnection(profile: AIConnectionProfile): AIConnectionProfile {
    this.write(() => {
      if (profile.isDefault) {
        this.run("UPDATE ai_connection_profiles SET is_default = 0, updated_at = ? WHERE is_default = 1", now())
      }
      this.run(
        `INSERT INTO ai_connection_profiles
         (id, name, backend_kind, provider_id, protocol, base_url, default_model_id, secret_ref,
          enabled, is_default, timeout_ms, temperature, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        profile.id,
        profile.name,
        profile.backendKind,
        profile.providerId,
        profile.protocol,
        profile.baseUrl,
        profile.defaultModelId,
        profile.secretRef,
        profile.enabled ? 1 : 0,
        profile.isDefault ? 1 : 0,
        profile.timeoutMs,
        profile.temperature,
        profile.createdAt,
        profile.updatedAt,
      )
    })
    return profile
  }

  updateAIConnection(profile: AIConnectionProfile): AIConnectionProfile {
    this.write(() => {
      const existing = this.get<{ id: string }>('SELECT id FROM ai_connection_profiles WHERE id = ?', profile.id)
      if (!existing) throw new AppError('NOT_FOUND', 'AI 连接不存在')
      if (profile.isDefault) {
        this.run(
          "UPDATE ai_connection_profiles SET is_default = 0, updated_at = ? WHERE is_default = 1 AND id <> ?",
          now(),
          profile.id,
        )
      }
      this.run(
        `UPDATE ai_connection_profiles SET
          name = ?, backend_kind = ?, provider_id = ?, protocol = ?, base_url = ?,
          default_model_id = ?, secret_ref = ?, enabled = ?, is_default = ?,
          timeout_ms = ?, temperature = ?, updated_at = ?
         WHERE id = ?`,
        profile.name,
        profile.backendKind,
        profile.providerId,
        profile.protocol,
        profile.baseUrl,
        profile.defaultModelId,
        profile.secretRef,
        profile.enabled ? 1 : 0,
        profile.isDefault ? 1 : 0,
        profile.timeoutMs,
        profile.temperature,
        profile.updatedAt,
        profile.id,
      )
    })
    return profile
  }

  deleteAIConnection(id: string): void {
    this.write(() => {
      const profile = this.get<{ is_default: number }>('SELECT is_default FROM ai_connection_profiles WHERE id = ?', id)
      if (!profile) throw new AppError('NOT_FOUND', 'AI 连接不存在')
      this.run('DELETE FROM ai_connection_profiles WHERE id = ?', id)
      if (Number(profile.is_default) === 1) {
        const next = this.get<{ id: string }>(
          `SELECT id FROM ai_connection_profiles WHERE enabled = 1
           ORDER BY updated_at DESC LIMIT 1`,
        )
        if (next) {
          this.run('UPDATE ai_connection_profiles SET is_default = 1, updated_at = ? WHERE id = ?', now(), next.id)
        }
      }
    })
  }

  setDefaultAIConnection(id: string): void {
    this.write(() => {
      const target = this.get<{ enabled: number }>('SELECT enabled FROM ai_connection_profiles WHERE id = ?', id)
      if (!target) throw new AppError('NOT_FOUND', 'AI 连接不存在')
      if (Number(target.enabled) !== 1) throw new AppError('CONFLICT', '禁用的连接不能设为默认')
      const timestamp = now()
      this.run('UPDATE ai_connection_profiles SET is_default = 0, updated_at = ? WHERE is_default = 1', timestamp)
      this.run('UPDATE ai_connection_profiles SET is_default = 1, updated_at = ? WHERE id = ?', timestamp, id)
    })
  }

  setAIConnectionSecretRef(id: string, secretRef: string | null): void {
    this.write(() => {
      this.run('UPDATE ai_connection_profiles SET secret_ref = ?, updated_at = ? WHERE id = ?', secretRef, now(), id)
    })
  }

  upsertAgentBackendBinding(binding: AgentBackendBinding): AgentBackendBinding {
    this.write(() => {
      this.run(
        `INSERT INTO agent_backend_bindings
         (id, scope_type, scope_id, agent_role, task_type, connection_id, model_id, priority,
          required_capabilities_json, max_concurrency, budget_limit, failure_policy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           scope_type = excluded.scope_type, scope_id = excluded.scope_id, agent_role = excluded.agent_role,
           task_type = excluded.task_type, connection_id = excluded.connection_id, model_id = excluded.model_id,
           priority = excluded.priority, required_capabilities_json = excluded.required_capabilities_json,
           max_concurrency = excluded.max_concurrency, budget_limit = excluded.budget_limit,
           failure_policy = excluded.failure_policy, updated_at = excluded.updated_at`,
        binding.id,
        binding.scopeType,
        binding.scopeId,
        binding.agentRole,
        binding.taskType,
        binding.connectionId,
        binding.modelId,
        binding.priority,
        JSON.stringify(binding.requiredCapabilities),
        binding.maxConcurrency,
        binding.budgetLimit,
        binding.failurePolicy,
        binding.createdAt,
        binding.updatedAt,
      )
    })
    return binding
  }

  deleteAgentBackendBinding(id: string): void {
    this.write(() => {
      this.run('DELETE FROM agent_backend_bindings WHERE id = ?', id)
    })
  }

  upsertAIModelPrice(price: AIModelPrice): AIModelPrice {
    this.write(() => {
      this.run(
        `INSERT INTO ai_model_prices
         (id, connection_id, model_id, input_per_million, output_per_million, currency, version, effective_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, model_id) DO UPDATE SET
           input_per_million = excluded.input_per_million,
           output_per_million = excluded.output_per_million,
           currency = excluded.currency,
           version = excluded.version,
           effective_at = excluded.effective_at,
           updated_at = excluded.updated_at`,
        price.id,
        price.connectionId,
        price.modelId,
        price.inputPerMillion,
        price.outputPerMillion,
        price.currency,
        price.version,
        price.effectiveAt,
        price.createdAt,
        price.updatedAt,
      )
    })
    return price
  }

  deleteAIModelPrice(id: string): void {
    this.write(() => {
      this.run('DELETE FROM ai_model_prices WHERE id = ?', id)
    })
  }

  createHealthCheckRun(run: {
    id: string
    projectId: string
    checkId: string
    sourceRevision: string | null
    status: string
    startedAt: number
    finishedAt: number | null
    result: Record<string, unknown>
  }): void {
    this.write(() => {
      this.run(
        `INSERT INTO health_check_runs (id, project_id, check_id, source_revision, status, started_at, finished_at, result_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        run.id, run.projectId, run.checkId, run.sourceRevision, run.status,
        run.startedAt, run.finishedAt, JSON.stringify(run.result),
      )
    })
  }

  recordFinding(input: {
    id: string
    projectId: string
    fingerprint: string
    category: string
    severity: string
    title: string
    checkRunId: string
    evidenceId: string
    sourceUri: string | null
    sourceRevision: string | null
    excerpt: string
    contentHash: string
    at: number
  }): void {
    this.write(() => {
      const existing = this.get<{ id: string; occurrence_count: number }>(
        'SELECT id, occurrence_count FROM findings WHERE project_id = ? AND fingerprint = ?',
        input.projectId, input.fingerprint,
      )
      if (existing) {
        this.run(
          "UPDATE findings SET last_seen_at = ?, occurrence_count = occurrence_count + 1, status = CASE WHEN status = 'resolved' THEN 'reopened' ELSE status END WHERE id = ?",
          input.at, existing.id,
        )
        this.run(
          `INSERT INTO finding_evidence (id, finding_id, check_run_id, source_uri, source_revision, excerpt, content_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          input.evidenceId, existing.id, input.checkRunId, input.sourceUri,
          input.sourceRevision, input.excerpt, input.contentHash, input.at,
        )
        return
      }
      this.run(
        `INSERT INTO findings (id, project_id, fingerprint, category, severity, status, title, first_seen_at, last_seen_at, occurrence_count)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, 1)`,
        input.id, input.projectId, input.fingerprint, input.category,
        input.severity, input.title, input.at, input.at,
      )
      this.run(
        `INSERT INTO finding_evidence (id, finding_id, check_run_id, source_uri, source_revision, excerpt, content_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        input.evidenceId, input.id, input.checkRunId, input.sourceUri,
        input.sourceRevision, input.excerpt, input.contentHash, input.at,
      )
    })
  }

  createRepairProposal(proposal: {
    id: string
    projectId: string
    status: string
    riskLevel: string
    scope: string[]
    acceptanceCriteria: string[]
    findingIds: string[]
    createdAt: number
  }): void {
    this.write(() => {
      this.run(
        `INSERT INTO repair_proposals (id, project_id, status, risk_level, scope_json, acceptance_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        proposal.id, proposal.projectId, proposal.status, proposal.riskLevel,
        JSON.stringify(proposal.scope), JSON.stringify(proposal.acceptanceCriteria),
        proposal.createdAt, proposal.createdAt,
      )
      for (const findingId of proposal.findingIds) {
        this.run('INSERT OR IGNORE INTO proposal_findings (proposal_id, finding_id) VALUES (?, ?)', proposal.id, findingId)
        this.run("UPDATE findings SET status = 'proposed' WHERE id = ?", findingId)
      }
    })
  }

  updateProposalStatus(id: string, status: string): void {
    this.write(() => {
      this.run('UPDATE repair_proposals SET status = ?, updated_at = ? WHERE id = ?', status, now(), id)
    })
  }

  setAutonomyMode(projectId: string, mode: string): void {
    this.write(() => {
      this.run(
        `INSERT INTO autonomy_settings (project_id, mode, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`,
        projectId, mode, now(),
      )
    })
  }
  upsertProjectBudget(input: { projectId: string; softLimit: number; currency: string }): void {
    this.write(() => {
      this.run(
        `INSERT INTO project_budgets (project_id, soft_limit, currency, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           soft_limit = excluded.soft_limit, currency = excluded.currency, updated_at = excluded.updated_at`,
        input.projectId,
        input.softLimit,
        input.currency,
        now(),
      )
    })
  }

  recordAIUsage(record: AIUsageRecord): void {
    this.write(() => {
      this.run(
        `INSERT INTO ai_usage_records
         (id, run_id, connection_id, model_id, input_tokens, output_tokens, usage_source,
          estimated_cost, currency, pricing_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, connection_id, model_id) DO UPDATE SET
           input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
           usage_source = excluded.usage_source, estimated_cost = excluded.estimated_cost`,
        record.id,
        record.runId,
        record.connectionId,
        record.modelId,
        record.inputTokens,
        record.outputTokens,
        record.usageSource,
        record.estimatedCost,
        record.currency,
        'v1',
        record.createdAt,
      )
    })
  }

  upsertAIModel(model: AIModel): AIModel {
    this.write(() => {
      this.run(
        `INSERT INTO ai_models
         (connection_id, model_id, display_name, source, capabilities_json,
          context_window, max_output_tokens, verified_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, model_id) DO UPDATE SET
          display_name = excluded.display_name,
          source = CASE WHEN ai_models.source = 'manual' THEN 'manual' ELSE excluded.source END,
          capabilities_json = excluded.capabilities_json,
          context_window = COALESCE(excluded.context_window, ai_models.context_window),
          max_output_tokens = COALESCE(excluded.max_output_tokens, ai_models.max_output_tokens),
          verified_at = COALESCE(excluded.verified_at, ai_models.verified_at),
          updated_at = excluded.updated_at`,
        model.connectionId,
        model.modelId,
        model.displayName,
        model.source,
        JSON.stringify(model.capabilities),
        model.contextWindow,
        model.maxOutputTokens,
        model.verifiedAt,
        model.createdAt,
        model.updatedAt,
      )
    })
    return model
  }

  upsertAIModelCapabilities(
    connectionId: string,
    modelId: string,
    capabilities: Partial<AIModelCapabilities>,
    verifiedAt: number,
  ): void {
    const existing = this.read.getAIModel(connectionId, modelId)
    if (!existing) return
    this.upsertAIModel({
      ...existing,
      capabilities: { ...existing.capabilities, ...capabilities },
      verifiedAt,
      updatedAt: now(),
    })
  }

  deleteAIModel(connectionId: string, modelId: string): void {
    this.write(() => {
      this.run('DELETE FROM ai_models WHERE connection_id = ? AND model_id = ?', connectionId, modelId)
      this.run(
        'UPDATE ai_connection_profiles SET default_model_id = NULL, updated_at = ? WHERE id = ? AND default_model_id = ?',
        now(),
        connectionId,
        modelId,
      )
    })
  }

  setDefaultAIModel(connectionId: string, modelId: string): void {
    this.write(() => {
      const model = this.get<{ model_id: string }>(
        'SELECT model_id FROM ai_models WHERE connection_id = ? AND model_id = ?',
        connectionId,
        modelId,
      )
      if (!model) throw new AppError('NOT_FOUND', '模型不存在')
      this.run(
        'UPDATE ai_connection_profiles SET default_model_id = ?, updated_at = ? WHERE id = ?',
        modelId,
        now(),
        connectionId,
      )
    })
  }

  recordAIConnectionCheck(check: AIConnectionCheck): void {
    this.write(() => {
      this.run(
        `INSERT INTO ai_connection_checks
         (id, connection_id, stage, status, error_code, message, latency_ms, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        check.id,
        check.connectionId,
        check.stage,
        check.status,
        check.errorCode,
        check.message,
        check.latencyMs,
        check.checkedAt,
      )
      this.run(
        `DELETE FROM ai_connection_checks
         WHERE connection_id = ? AND id NOT IN (
           SELECT id FROM ai_connection_checks WHERE connection_id = ? ORDER BY checked_at DESC LIMIT 100
         )`,
        check.connectionId,
        check.connectionId,
      )
    })
  }

  saveProjectSnapshot(snapshot: ProjectSnapshot): void {
    this.write(() => {
      this.run(
        `INSERT INTO project_snapshots (id, project_id, git_head, payload_json, index_version, scanned_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        snapshot.id,
        snapshot.projectId,
        snapshot.gitHead,
        JSON.stringify(snapshot),
        snapshot.indexVersion,
        snapshot.scannedAt,
      )
      this.run(
        `DELETE FROM project_snapshots WHERE project_id = ? AND id NOT IN (
          SELECT id FROM project_snapshots WHERE project_id = ? ORDER BY scanned_at DESC LIMIT 10
        )`,
        snapshot.projectId,
        snapshot.projectId,
      )
    })
  }

  createPlanRevision(plan: PlanDraft): void {
    this.write(() => {
      this.run(
        `INSERT INTO plan_revisions
         (id, project_id, revision, status, goal, plan_json, approved_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        plan.id,
        plan.projectId,
        plan.revision,
        plan.status,
        plan.goal,
        JSON.stringify(plan),
        plan.approvedAt,
        plan.createdAt,
        plan.updatedAt,
      )
    })
  }

  updatePlanRevision(plan: PlanDraft): void {
    this.write(() => {
      this.run(
        `UPDATE plan_revisions SET status = ?, goal = ?, plan_json = ?, approved_at = ?, updated_at = ?
         WHERE id = ?`,
        plan.status,
        plan.goal,
        JSON.stringify(plan),
        plan.approvedAt,
        plan.updatedAt,
        plan.id,
      )
    })
  }

  saveGraphLayout(layout: GraphLayout): void {
    this.write(() => {
      this.run(
        `INSERT INTO graph_layouts (project_id, view_id, layout_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, view_id) DO UPDATE SET
          layout_json = excluded.layout_json, updated_at = excluded.updated_at`,
        layout.projectId,
        layout.viewId,
        JSON.stringify({ positions: layout.positions }),
        layout.updatedAt,
      )
    })
  }
}

export function createArtifactRecord(input: {
  projectId: string
  taskId?: string | null
  runId?: string | null
  kind?: ArtifactKind
  title: string
  body?: string | null
  uri?: string | null
  verified?: boolean
  isDemo?: boolean
}): Artifact {
  const timestamp = now()
  return {
    id: newId('art'),
    projectId: input.projectId,
    taskId: input.taskId ?? null,
    runId: input.runId ?? null,
    kind: input.kind ?? 'document',
    title: input.title,
    uri: input.uri ?? null,
    contentHash: null,
    gitCommit: null,
    verifiedAt: input.verified ? timestamp : null,
    body: input.body ?? null,
    isDemo: input.isDemo ?? false,
    createdAt: timestamp,
  }
}

export { toProject, toTask, toSession, toMessage, toRun, toRunStep, toStage }


