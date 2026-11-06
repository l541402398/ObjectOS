import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import { AppError, newId, now, TaskWorkspaceSchema, WorkspacePreparationSchema, TaskIntegrationOperationSchema,
  type ApiParsedInput, type Task, type RequirementWorkView, type WorkspacePreparation,
} from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import { evaluateToolPolicy } from '@projectos/policy'
import { WorktreeManager } from '@projectos/worktree'
import { assertIntegratedDependencies, repositoryIdentity } from './requirement-git.js'

const WORKSPACE_COLUMNS = `id, project_id AS projectId, requirement_id AS requirementId, task_id AS taskId,
  kind, root_path AS rootPath, branch, base_commit AS baseCommit, requirement_version AS requirementVersion,
  created_at AS createdAt`
const OP_COLUMNS = `id, task_id AS taskId, requirement_id AS requirementId, approval_id AS approvalId,
  run_id AS runId, status, error, created_at AS createdAt`
const SnapshotSchema = z.object({
  projectId: z.string(), requirementId: z.string(), taskId: z.string(), taskVersion: z.number(),
  requirementVersion: z.number(), projectRoot: z.string(),
  integrationRoot: z.string(), integrationBranch: z.string(), integrationExists: z.boolean(),
  taskRoot: z.string(), taskBranch: z.string(), baseCommit: z.string(),
  dependencies: z.array(z.object({ taskId: z.string(), version: z.number(), commit: z.string() })).default([]),
})

function git(root: string, ...args: string[]): string {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 10_000, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).trim()
  } catch { throw new AppError('CONFLICT', '无法读取 Git 工作区，请确认仓库完整且已有初始提交') }
}
function canonical(path: string): string { return realpathSync.native(path) }
function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)
}

/** Stored bindings are authoritative; neither a caller nor a legacy plan can override this root. */
export function managedTaskWorkspace(store: SqliteStore, task: Task, requestedRoot?: string) {
  if (!task.requirementId) return null
  const record = store.read.getTaskWorkspace(task.id)
  if (!record) throw new AppError('CONFLICT', '请在需求工作台准备并批准此任务的独立工作区')
  const project = store.read.getProject(task.projectId)
  if (!project || record.projectId !== task.projectId || record.requirementId !== task.requirementId || !existsSync(record.rootPath))
    throw new AppError('CONFLICT', '任务工作区缺失或归属不一致，请先核对')
  const root = canonical(record.rootPath)
  if (!samePath(root, record.rootPath) || (requestedRoot && !samePath(requestedRoot, root)))
    throw new AppError('CONFLICT', '任务只能在已登记的独立工作区执行')
  const identity = repositoryIdentity(root), expected = repositoryIdentity(project.rootPath)
  if (!samePath(identity.commonDir, expected.commonDir) || identity.branch !== record.branch)
    throw new AppError('CONFLICT', '任务工作区的仓库或分支已改变，请先核对')
  return { root, identity, projectIdentity: expected }
}

export function managedTaskRoot(store: SqliteStore, task: Task, requestedRoot?: string): string | null {
  return managedTaskWorkspace(store, task, requestedRoot)?.root ?? null
}

export class RequirementWorkService {
  constructor(private readonly store: SqliteStore, private readonly dataDir: string, private readonly worktrees = new WorktreeManager()) {
    // A preparation is not an LLM run and must never be replayed by restart recovery.
    for (const row of store.db.prepare("SELECT id FROM task_workspace_preparations WHERE status='executing'").all()) {
      this.finish(String(row.id), 'needs_reconciliation', '上次工作区准备被中断，请人工核对目录和分支；系统不会重复执行')
    }
  }

  private requirement(id: string) {
    const value = this.store.read.getRequirement(id)
    if (!value) throw new AppError('NOT_FOUND', '需求不存在')
    return value
  }

  view(requirementId: string): RequirementWorkView {
    const requirement = this.requirement(requirementId)
    this.refreshPending()
    return {
      requirement,
      tasks: this.store.read.listTaskCards(requirement.projectId).filter(task => task.requirementId === requirementId),
      workspaces: this.store.db.prepare(`SELECT ${WORKSPACE_COLUMNS} FROM requirement_workspaces WHERE requirement_id=?`)
        .all(requirementId).map(row => TaskWorkspaceSchema.parse(row)),
      preparations: this.store.db.prepare(`SELECT ${OP_COLUMNS} FROM task_workspace_preparations WHERE requirement_id=? ORDER BY created_at DESC LIMIT 200`)
        .all(requirementId).map(row => WorkspacePreparationSchema.parse(row)),
      integrations: this.store.db.prepare(`SELECT id,task_id AS taskId,requirement_id AS requirementId,kind,
        approval_id AS approvalId,run_id AS runId,status,error,result_commit AS resultCommit,created_at AS createdAt
        FROM task_integration_operations WHERE requirement_id=? AND (
          id IN (SELECT id FROM task_integration_operations WHERE requirement_id=? ORDER BY created_at DESC,id DESC LIMIT 200)
          OR id IN (SELECT id FROM (SELECT id,ROW_NUMBER() OVER(PARTITION BY task_id ORDER BY created_at DESC,id DESC) AS position
            FROM task_integration_operations WHERE requirement_id=? AND kind='integrate' AND status='completed') WHERE position=1)
        ) ORDER BY created_at DESC,id DESC`)
        .all(requirementId,requirementId,requirementId).map(row => TaskIntegrationOperationSchema.parse(row)),
    }
  }

  update(input: ApiParsedInput<'requirement.update'>) {
    const current = this.requirement(input.requirementId)
    if (current.status === 'implemented') throw new AppError('CONFLICT', '已交付需求不能直接修改文档，请创建后续需求')
    return this.store.transaction(() => {
      const result = this.store.db.prepare(`UPDATE requirements SET title=?,body=?,technical_design=?,acceptance_json=?,
        design_version=design_version+?,version=version+1,status='draft',updated_at=? WHERE id=? AND version=?`)
        .run(input.title, input.body, input.technicalDesign, JSON.stringify(input.acceptanceCriteria),
          input.technicalDesign === current.technicalDesign ? 0 : 1, now(), current.id, input.expectedVersion)
      if (!result.changes) throw new AppError('CONFLICT', '需求已被更新，请刷新后再保存')
      this.event(current.projectId, current.id, 'requirement.documents.updated', '需求文档已保存，需重新确认需求')
      return this.requirement(current.id)
    })
  }

  private safeDestination(path: string): void {
    const root = canonical(this.dataDir)
    let parent = path
    while (!existsSync(parent)) {
      const next = dirname(parent)
      if (next === parent) throw new AppError('CONFLICT', '工作区目录无效')
      parent = next
    }
    const rel = relative(root, canonical(parent))
    if (rel.startsWith('..') || isAbsolute(rel)) throw new AppError('CONFLICT', '工作区目录越界或经过外部链接')
    // A junction inside the data directory must not redirect a reserved workspace either.
    if (!samePath(parent, canonical(parent))) throw new AppError('CONFLICT', '工作区目录包含链接，请先核对')
  }

  private snapshot(taskId: string, expectedVersion: number, preparationRunId?: string) {
    const task = this.store.read.getTask(taskId)
    if (!task || !task.requirementId) throw new AppError('BAD_REQUEST', '请选择需求中的开发任务')
    if (task.version !== expectedVersion) throw new AppError('CONFLICT', '任务已变化，请刷新后重新准备')
    if (task.status === 'done' || task.status === 'cancelled' || task.workType !== 'development') throw new AppError('CONFLICT', '此任务当前不能准备开发工作区')
    if (this.store.read.getTaskWorkspace(task.id)) throw new AppError('CONFLICT', '此任务已有独立工作区')
    const activeRun = this.store.read.getActiveRunForTask(task.id)
    if (activeRun && activeRun.id !== preparationRunId) throw new AppError('CONFLICT', '任务存在未结束的运行，请先处理')
    const requirement = this.requirement(task.requirementId)
    if (requirement.projectId !== task.projectId) throw new AppError('CONFLICT', '需求与任务归属不一致')
    const project = this.store.read.getProject(task.projectId)!
    for (const id of [project.id, requirement.id, task.id]) if (!/^[\w-]+$/.test(id)) throw new AppError('BAD_REQUEST', '工作项标识不能用作目录')
    const projectRoot = canonical(project.rootPath)
    const integration = this.store.db.prepare(`SELECT ${WORKSPACE_COLUMNS} FROM requirement_workspaces WHERE requirement_id=? AND kind='integration'`).get(requirement.id)
    const existing = integration ? TaskWorkspaceSchema.parse(integration) : null
    let projectIdentity: ReturnType<typeof repositoryIdentity>
    try { projectIdentity=repositoryIdentity(projectRoot) }
    catch { throw new AppError('CONFLICT', '项目尚无有效代码基线，请先完成项目初始化后重试；准备预览不会自动提交文件') }
    // Full IDs stay in SQLite/approvals; compact filesystem names avoid Windows Git path limits.
    const scope = createHash('sha256').update(JSON.stringify([project.id, requirement.id])).digest('hex').slice(0, 24)
    const taskKey = createHash('sha256').update(task.id).digest('hex').slice(0, 24)
    const parent = join(canonical(this.dataDir), 'w', scope)
    const integrationRoot = existing?.rootPath ?? join(parent, 'i')
    const taskRoot = join(parent, `t-${taskKey}`)
    if (process.platform === 'win32' && Math.max(integrationRoot.length, taskRoot.length) > 240) {
      throw new AppError('CONFLICT', '工作区路径过长，请将数据目录放到较短路径后重新申请；没有创建目录或分支')
    }
    this.safeDestination(integrationRoot); this.safeDestination(taskRoot)
    if (existsSync(taskRoot) || (!existing && existsSync(integrationRoot))) throw new AppError('CONFLICT', '目标目录已存在但未登记，请先核对，不会覆盖已有文件')
    const source = existing ? integrationRoot : projectRoot
    const dependencies = assertIntegratedDependencies(this.store, task, source)
    if(existing&&!existsSync(source))throw new AppError('CONFLICT','需求集成工作区缺失，请先核对')
    const sourceIdentity=existing?repositoryIdentity(source):projectIdentity
    if (existing && sourceIdentity.branch !== existing.branch) throw new AppError('CONFLICT', '需求集成工作区缺失或分支已改变')
    if (existing && !samePath(sourceIdentity.commonDir,projectIdentity.commonDir))
      throw new AppError('CONFLICT', '需求集成工作区不属于当前仓库')
    if (git(projectRoot, 'branch', '--list', `projectos/task-${task.id}`,...(!existing?[`projectos/requirement-${requirement.id}`]:[])))
      throw new AppError('CONFLICT', '目标分支已存在但未登记，请先核对，不会复用未知分支')
    if (git(source, 'status', '--porcelain').length) throw new AppError('CONFLICT', '代码基线存在未提交修改，请先处理后准备任务工作区')
    const baseCommit = sourceIdentity.head
    return { projectId: project.id, requirementId: requirement.id, taskId: task.id, taskVersion: task.version,
      requirementVersion: requirement.version, projectRoot, integrationRoot,
      integrationBranch: existing?.branch ?? `projectos/requirement-${requirement.id}`, integrationExists: Boolean(existing),
      taskRoot, taskBranch: `projectos/task-${task.id}`, baseCommit, dependencies,
    }
  }

  request(input: ApiParsedInput<'task.workspace.request'>): WorkspacePreparation {
    this.refreshPending()
    const pending = this.store.db.prepare(`SELECT ${OP_COLUMNS} FROM task_workspace_preparations WHERE task_id=? AND status IN ('waiting_approval','executing','needs_reconciliation')`).get(input.taskId)
    if (pending) return WorkspacePreparationSchema.parse(pending)
    const snapshot = this.snapshot(input.taskId, input.expectedVersion)
    const policy = evaluateToolPolicy({ rootPath: snapshot.projectRoot, toolName: 'prepare_task_workspace', args: snapshot })
    if (policy.decision !== 'require_approval') throw new AppError('POLICY_DENIED', '工作区准备必须经过独立人工审批')
    return this.store.transaction(() => {
      const timestamp = now(), id = newId('wsp'), runId = newId('run'), sessionId = newId('ses')
      this.store.createSession({ id: sessionId, projectId: snapshot.projectId, agentId: 'agt_product', title: '任务工作区准备', status: 'active', createdAt: timestamp, updatedAt: timestamp })
      this.store.createRun({ id: runId, projectId: snapshot.projectId, taskId: snapshot.taskId, sessionId, agentId: 'agt_product', attempt: 1,
        status: 'waiting_approval', error: null, summary: '等待批准创建任务分支与工作区（系统操作，不调用模型）', inputTokens: 0, outputTokens: 0,
        checkpointId: null, startedAt: timestamp, finishedAt: null, createdAt: timestamp,
      })
      const tool = this.store.createToolCall({ runId, toolName: 'prepare_task_workspace', idempotencyKey: id, status: 'waiting_approval',
        argsHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), args: snapshot })
      const task = this.store.read.getTask(snapshot.taskId)!
      const approval = this.store.createApproval({ projectId: snapshot.projectId, runId, toolCallId: tool.id,
        title: `准备工作区 · ${task.title}`,
        detail: `创建独立开发目录与 Git 分支。基线：${snapshot.baseCommit.slice(0, 12)}。此授权仅用于工作区准备；后续写文件、执行命令和合并仍遵循原有审批。`,
        request: { toolName: 'prepare_task_workspace', args: snapshot, risk: 'git-write', reason: '创建需求集成与任务分支需要人工授权' }, expiresAt: timestamp + 10 * 60_000,
      })
      this.store.db.prepare(`INSERT INTO task_workspace_preparations(id,task_id,requirement_id,approval_id,run_id,tool_call_id,status,snapshot_json,created_at,updated_at) VALUES(?,?,?,?,?,?,'waiting_approval',?,?,?)`)
        .run(id, snapshot.taskId, snapshot.requirementId, approval.id, runId, tool.id, JSON.stringify(snapshot), timestamp, timestamp)
      this.event(snapshot.projectId, snapshot.taskId, 'task.workspace.requested', `等待批准准备「${task.title}」工作区`)
      return this.operation(id)
    })
  }

  ownsApproval(approvalId: string): boolean {
    return Boolean(this.store.db.prepare('SELECT id FROM task_workspace_preparations WHERE approval_id=?').get(approvalId))
  }

  async decide(approvalId: string, decision: 'approved' | 'rejected', note: string): Promise<void> {
    this.refreshPending()
    const row = this.store.db.prepare('SELECT * FROM task_workspace_preparations WHERE approval_id=?').get(approvalId)
    if (!row) throw new AppError('NOT_FOUND', '工作区准备请求不存在')
    const approval = this.store.getApprovalById(approvalId)!, id = String(row.id)
    if (row.status !== 'waiting_approval' || approval.status !== 'pending') throw new AppError('CONFLICT', '此工作区准备请求已处理')
    if (approval.expiresAt && approval.expiresAt <= now()) {
      this.store.expireApproval(approval.id, '工作区准备授权已过期')
      this.finish(id, 'failed', '授权已过期，请重新准备')
      throw new AppError('CONFLICT', '授权已过期，请重新准备')
    }
    if (decision === 'rejected') {
      this.store.transaction(() => { this.store.decideApproval(approvalId, decision, note); this.finish(id, 'rejected', '已拒绝准备工作区') })
      return
    }
    const snapshot = SnapshotSchema.parse(JSON.parse(String(row.snapshot_json)))
    if (this.store.db.prepare("SELECT id FROM task_workspace_preparations WHERE requirement_id=? AND status='executing'").get(snapshot.requirementId))
      throw new AppError('CONFLICT', '此需求正在准备另一个工作区，请稍后重试')
    if (this.store.db.prepare("SELECT id FROM task_integration_operations WHERE requirement_id=? AND status IN ('executing','needs_reconciliation')").get(snapshot.requirementId))
      throw new AppError('CONFLICT', '此需求正在合入或验证成果，或有待核对操作，请先处理')
    try {
      this.store.transaction(() => {
        const current = this.snapshot(snapshot.taskId, snapshot.taskVersion, String(row.run_id))
        if (JSON.stringify(SnapshotSchema.parse(current)) !== JSON.stringify(snapshot)) throw new AppError('CONFLICT', '代码基线或需求已变化，请重新提交工作区准备')
        if (evaluateToolPolicy({ rootPath: current.projectRoot, toolName: 'prepare_task_workspace', args: current }).decision !== 'require_approval')
          throw new AppError('POLICY_DENIED', '工作区准备策略已改变，请重新确认')
        this.store.decideApproval(approvalId, decision, note)
        this.store.db.prepare("UPDATE task_workspace_preparations SET status='executing',updated_at=? WHERE id=?").run(now(), id)
        this.store.updateRun(String(row.run_id), { status: 'running' })
        this.store.updateToolCall(String(row.tool_call_id), { status: 'running', startedAt: now() })
      })
    } catch (error) {
      this.store.expireApproval(approvalId, '准备条件已改变')
      this.finish(id, 'failed', error instanceof Error ? error.message : String(error))
      throw error
    }
    try {
      if (!snapshot.integrationExists) {
        await this.worktrees.create(snapshot.projectRoot, snapshot.integrationRoot, snapshot.integrationBranch, snapshot.baseCommit)
        this.saveWorkspace(snapshot, null, snapshot.integrationRoot, snapshot.integrationBranch)
      }
      await this.worktrees.create(snapshot.projectRoot, snapshot.taskRoot, snapshot.taskBranch, snapshot.baseCommit)
      this.saveWorkspace(snapshot, snapshot.taskId, snapshot.taskRoot, snapshot.taskBranch)
      this.finish(id, 'completed', null)
    } catch (error) {
      this.finish(id, 'needs_reconciliation', `准备中断，请核对已创建的目录和分支：${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }

  /** Explicit human action: inspect exact outcomes and record facts, never repeat Git writes. */
  reconcile(id: string): WorkspacePreparation {
    const row = this.store.db.prepare('SELECT * FROM task_workspace_preparations WHERE id=?').get(id)
    if (!row || row.status !== 'needs_reconciliation') throw new AppError('CONFLICT', '仅待核对的工作区准备可以核对')
    if (this.store.getApprovalById(String(row.approval_id))?.status !== 'approved') throw new AppError('CONFLICT', '原操作没有有效的人工批准，不能登记未知目录')
    const snapshot = SnapshotSchema.parse(JSON.parse(String(row.snapshot_json)))
    const project = this.store.read.getProject(snapshot.projectId)
    if (!project || !samePath(canonical(project.rootPath), snapshot.projectRoot)) throw new AppError('CONFLICT', '项目目录已变化，请先人工核对')
    const inspect = (root: string, branch: string) => {
      this.safeDestination(root)
      if (!existsSync(root)) {
        if (git(snapshot.projectRoot, 'branch', '--list', branch)) throw new AppError('CONFLICT', '分支存在但目录缺失，请先在 Git 中人工核对；不会自动删除分支')
        return false
      }
      if (!samePath(canonical(root), root)
        || !samePath(git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir'), git(snapshot.projectRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir'))
        || git(root, 'branch', '--show-current') !== branch || git(root, 'rev-parse', 'HEAD') !== snapshot.baseCommit
        || git(root, 'status', '--porcelain')) throw new AppError('CONFLICT', '实际目录、分支或内容与原审批不一致，请人工核对；不会自动修复或覆盖')
      return true
    }
    const integrationExists = inspect(snapshot.integrationRoot, snapshot.integrationBranch)
    const taskExists = inspect(snapshot.taskRoot, snapshot.taskBranch)
    if (taskExists && !integrationExists) throw new AppError('CONFLICT', '任务目录存在但需求集成目录缺失，请先人工核对')
    const registered = this.store.db.prepare(`SELECT ${WORKSPACE_COLUMNS} FROM requirement_workspaces WHERE requirement_id=?`).all(snapshot.requirementId).map(r => TaskWorkspaceSchema.parse(r))
    const integration = registered.find(w => w.kind === 'integration'), task = registered.find(w => w.taskId === snapshot.taskId)
    if ((integration && (!integrationExists || !samePath(integration.rootPath, snapshot.integrationRoot) || integration.branch !== snapshot.integrationBranch))
      || (task && (!taskExists || !samePath(task.rootPath, snapshot.taskRoot) || task.branch !== snapshot.taskBranch)))
      throw new AppError('CONFLICT', '已登记工作区与实际结果不一致，请人工核对')
    this.store.transaction(() => {
      if (integrationExists && !integration) this.saveWorkspace(snapshot, null, snapshot.integrationRoot, snapshot.integrationBranch)
      if (taskExists && !task) this.saveWorkspace(snapshot, snapshot.taskId, snapshot.taskRoot, snapshot.taskBranch)
      this.store.appendRunStep({ runId: String(row.run_id), kind: 'status', title: '人工发起工作区核对', payload: { integrationExists, taskExists, gitMutated: false } })
      this.finish(id, taskExists ? 'completed' : 'failed', taskExists ? null : '核对确认任务工作区尚未创建，可重新申请准备；已有需求集成目录已保留')
    })
    return this.operation(id)
  }

  private saveWorkspace(snapshot: z.infer<typeof SnapshotSchema>, taskId: string | null, root: string, branch: string): void {
    if (git(root, 'rev-parse', 'HEAD') !== snapshot.baseCommit || git(root, 'branch', '--show-current') !== branch)
      throw new AppError('CONFLICT', '新工作区未匹配已授权的基线与分支')
    this.store.db.prepare(`INSERT INTO requirement_workspaces(id,project_id,requirement_id,task_id,kind,root_path,branch,base_commit,requirement_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(newId('tws'), snapshot.projectId, snapshot.requirementId, taskId, taskId ? 'development' : 'integration', canonical(root), branch, snapshot.baseCommit, snapshot.requirementVersion, now())
  }

  private operation(id: string): WorkspacePreparation {
    return WorkspacePreparationSchema.parse(this.store.db.prepare(`SELECT ${OP_COLUMNS} FROM task_workspace_preparations WHERE id=?`).get(id))
  }

  private finish(id: string, status: WorkspacePreparation['status'], error: string | null): void {
    const row = this.store.db.prepare('SELECT * FROM task_workspace_preparations WHERE id=?').get(id)
    if (!row) return
    const task = this.store.read.getTask(String(row.task_id))!
    this.store.transaction(() => {
      this.store.db.prepare('UPDATE task_workspace_preparations SET status=?,error=?,updated_at=? WHERE id=?').run(status, error, now(), id)
      this.store.updateToolCall(String(row.tool_call_id), { status: status === 'completed' ? 'completed' : 'failed', error, finishedAt: now(), result: { status } })
      this.store.updateRun(String(row.run_id), { status: status === 'completed' ? 'completed' : status === 'needs_reconciliation' ? 'needs_reconciliation' : status === 'rejected' ? 'cancelled' : 'failed', error, summary: status === 'completed' ? '任务独立工作区已准备完成' : error, finishedAt: now() })
      this.event(task.projectId, task.id, 'task.workspace.updated', status === 'completed' ? '任务独立工作区已就绪' : error ?? status)
    })
  }

  private refreshPending(): void {
    const rows = this.store.db.prepare("SELECT id,approval_id,run_id FROM task_workspace_preparations WHERE status='waiting_approval'").all()
    for (const row of rows) {
      const approval = this.store.getApprovalById(String(row.approval_id))
      const run = this.store.read.getRun(String(row.run_id))
      if (run?.status !== 'waiting_approval') {
        if (approval?.status === 'pending') this.store.expireApproval(approval.id, '工作区准备运行已结束')
        this.finish(String(row.id), 'failed', '工作区准备已取消，请重新提交')
      } else if (!approval || approval.status !== 'pending') this.finish(String(row.id), 'failed', '准备审批已失效，请重新提交')
      else if (approval.expiresAt && approval.expiresAt <= now()) {
        this.store.expireApproval(approval.id, '工作区准备审批已过期')
        this.finish(String(row.id), 'failed', '准备审批已过期，请重新提交')
      }
    }
  }

  private event(projectId: string, aggregateId: string, kind: string, summary: string): void {
    this.store.appendEvent(projectId, aggregateId, PROJECT_EVENT_TYPES.custom, { kind, summary })
  }
}
