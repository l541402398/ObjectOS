import { existsSync } from 'node:fs'
import { z } from 'zod'
import { AppError, newId, now, TaskIntegrationOperationSchema, type ApiParsedInput, type TaskIntegrationOperation, type TaskIntegrationPreview } from '@projectos/contracts'
import { resolveReviewEvidence, type ReviewSnapshot } from '@projectos/application'
import type { SqliteStore } from '@projectos/persistence'
import { evaluateToolPolicy } from '@projectos/policy'
import { runApprovedCommand } from '@projectos/workspace'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import { managedTaskRoot } from './requirement-work.js'
import { recollectForReview } from './review-snapshot-collector.js'
import { assertSafeGitAttributes, assertIntegratedDependencies, gitPaths, gitText, hash, integrationDiff, integrationRoot, requirementGit, taskContent } from './requirement-git.js'

const COLUMNS = `id,task_id AS taskId,requirement_id AS requirementId,kind,approval_id AS approvalId,
  run_id AS runId,status,error,result_commit AS resultCommit,created_at AS createdAt`
const SnapshotSchema = z.object({
  projectId: z.string(), requirementId: z.string(), taskId: z.string(), taskVersion: z.number(),
  requirementVersion: z.number(), sourceRoot: z.string(), targetRoot: z.string(),
  sourceBranch: z.string(), targetBranch: z.string(), sourceHead: z.string(), targetHead: z.string(),
  baseCommit: z.string(), contentFingerprint: z.string(),
  files: z.array(z.object({ path: z.string(), status: z.string() })),
  dependencies: z.array(z.object({ taskId: z.string(), version: z.number(), commit: z.string() })),
  command: z.string().nullable(),
})
type Snapshot = z.infer<typeof SnapshotSchema>
const busyStatuses = "('waiting_approval','executing','needs_reconciliation')"
const TOOL_NAMES = { verify: 'run_tests', integrate: 'integrate_requirement_task' } as const
const TITLES = { verify: '验证任务成果', integrate: '合入需求分支' } as const
const WRITE_CONFIG = ['-c', 'core.hooksPath=.git', '-c', 'commit.gpgSign=false', '-c', 'merge.gpgSign=false', '-c', 'user.name=ProjectOS', '-c', 'user.email=projectos@local']

export class RequirementIntegrationService {
  constructor(private readonly store: SqliteStore) {
    for (const row of store.db.prepare("SELECT id FROM task_integration_operations WHERE status='executing'").all())
      this.finish(String(row.id), 'needs_reconciliation', '操作被中断，结果未知；请人工核对，系统不会自动重试')
  }

  list(requirementId: string): TaskIntegrationOperation[] {
    this.refreshPending()
    return this.store.db.prepare(`SELECT ${COLUMNS} FROM task_integration_operations WHERE requirement_id=? ORDER BY created_at DESC,id DESC LIMIT 200`).all(requirementId).map(row => TaskIntegrationOperationSchema.parse(row))
  }

  private capture(taskId: string, ownRunId?: string) {
    const task = this.store.read.getTask(taskId)
    if (!task?.requirementId) throw new AppError('BAD_REQUEST', '请选择需求中的开发任务')
    const sourceRoot = managedTaskRoot(this.store, task)!
    const workspace = this.store.read.getTaskWorkspace(task.id)!
    const target = integrationRoot(this.store, task)
    const requirement = this.store.read.getRequirement(task.requirementId)!
    if (!requirement || requirement.projectId !== task.projectId) throw new AppError('CONFLICT', '需求与任务归属不一致')
    const content = taskContent(sourceRoot, workspace.baseCommit, task)
    const dependencies = assertIntegratedDependencies(this.store, task, sourceRoot)
    const active = this.store.read.getActiveRunForTask(task.id)
    const lease = this.store.read.getTaskLease(task.id)
    const blockers: string[] = []
    if ((active && active.id !== ownRunId) || (lease && lease.expiresAt > now())) blockers.push('任务仍有运行、写入租约或待核对操作，请先处理')
    assertSafeGitAttributes(target.root, content.files.map(file => file.path))
    if (task.status !== 'done') blockers.push('请先在任务详情完成任务验收')
    if (requirement.status === 'implemented') blockers.push('需求已经交付，不能继续合入')
    if (gitText(target.root, 'status', '--porcelain=v1', '-uall')) blockers.push('需求集成工作区存在未提交修改，请先处理')
    if (content.files.length === 0) blockers.push('当前任务没有可合入的改动')
    const snapshot: Snapshot = {
      projectId: task.projectId, requirementId: task.requirementId, taskId: task.id, taskVersion: task.version,
      requirementVersion: requirement.version,
      sourceRoot, targetRoot: target.root, sourceBranch: workspace.branch, targetBranch: target.branch,
      sourceHead: content.snapshot.baselineCommit!, targetHead: target.head,
      baseCommit: workspace.baseCommit, contentFingerprint: content.fingerprint, files: content.files, dependencies, command: null,
    }
    // A manually rewritten task history must not import unrelated repository history.
    try { requirementGit(sourceRoot, 'merge-base', '--is-ancestor', workspace.baseCommit, 'HEAD') }
    catch { blockers.push('任务分支不再基于已登记版本，请先人工核对') }
    return { task, snapshot, content, blockers, integrated: this.isCurrentlyIntegrated(snapshot) }
  }

  private isCurrentlyIntegrated(snapshot: Snapshot): boolean {
    const row = this.store.db.prepare("SELECT snapshot_json,source_commit,result_commit FROM task_integration_operations WHERE task_id=? AND kind='integrate' AND status='completed' ORDER BY created_at DESC,id DESC LIMIT 1").get(snapshot.taskId)
    if (!row?.result_commit || row.source_commit !== snapshot.sourceHead) return false
    const before = SnapshotSchema.parse(JSON.parse(String(row.snapshot_json)))
    if (before.contentFingerprint !== snapshot.contentFingerprint || before.taskVersion !== snapshot.taskVersion || before.requirementVersion !== snapshot.requirementVersion) return false
    try { requirementGit(snapshot.targetRoot, 'merge-base', '--is-ancestor', String(row.result_commit), snapshot.targetHead); return true }
    catch { return false }
  }

  private review(snapshot: Snapshot, currentContent?: ReviewSnapshot) {
    const candidates = this.store.read.listArtifacts(snapshot.projectId, snapshot.taskId)
      .filter(artifact => artifact.metadata?.artifactType === 'review')
      .map(artifact => ({ id: artifact.id, title: artifact.title, metadata: artifact.metadata ?? {} }))
    const trustedReviews = this.store.db.prepare('SELECT * FROM task_integration_reviews WHERE task_id=?').all(snapshot.taskId)
    const ownMetadata = new Set(candidates.filter(candidate => trustedReviews.some(row => row.artifact_id === candidate.id)).map(candidate => candidate.metadata))
    const resolution = resolveReviewEvidence(candidates, { snapshotFor: metadata => ownMetadata.has(metadata) && currentContent ? currentContent : recollectForReview(snapshot.sourceRoot, metadata) })
    const covered = new Set<string>()
    for (const item of resolution.current.filter(item => item.verdict === 'approved')) {
      const metadata = candidates.find(c => c.id === item.id)!.metadata
      const recorded = metadata.reviewSnapshot as unknown as ReviewSnapshot | undefined
      // Renderer-created/free-form artifacts cannot stand in for trusted runtime collection.
      if (recorded?.taskId !== snapshot.taskId || recorded.projectId !== snapshot.projectId || recorded.worktree?.root !== snapshot.sourceRoot || !recorded.integrity.complete) continue
      const trusted = this.store.db.prepare('SELECT * FROM task_integration_reviews WHERE artifact_id=? AND task_id=?').get(item.id, snapshot.taskId)
      if (!trusted || trusted.content_fingerprint !== snapshot.contentFingerprint || trusted.requirement_version !== snapshot.requirementVersion || trusted.task_version !== snapshot.taskVersion) continue
      for (const file of recorded.files) covered.add(file.path)
    }
    const missing = snapshot.files.filter(file => !covered.has(file.path))
    return { approved: resolution.approved && missing.length === 0 && snapshot.files.length > 0,
      reasons: [...(resolution.performed ? resolution.reasons : ['尚未记录当前改动的审查结论']), ...(missing.length ? [`还有 ${missing.length} 个改动文件缺少当前审查：${missing.slice(0, 3).map(f => f.path).join('、')}`] : [])] }
  }

  private verification(snapshot: Snapshot): TaskIntegrationPreview['verification'] {
    const row = this.store.db.prepare("SELECT run_id,tool_call_id,status,snapshot_json FROM task_integration_operations WHERE task_id=? AND kind='verify' ORDER BY created_at DESC,id DESC LIMIT 1").get(snapshot.taskId)
    if (!row) return { passed: false, reason: '尚未运行与当前代码绑定的验证', command: null, runId: null }
    const call = this.store.read.getToolCalls(String(row.run_id)).find(item => item.id === row.tool_call_id)
    const before = SnapshotSchema.parse(JSON.parse(String(row.snapshot_json)))
    const result = call?.result as { exitCode?: number; contentFingerprint?: string; unchanged?: boolean } | null
    const current = before.taskVersion === snapshot.taskVersion && before.requirementVersion === snapshot.requirementVersion && before.contentFingerprint === snapshot.contentFingerprint && result?.contentFingerprint === snapshot.contentFingerprint && result?.unchanged === true
    const passed = row.status === 'completed' && result?.exitCode === 0 && current
    return { passed, reason: passed ? '当前代码已通过实际验证' : row.status === 'needs_reconciliation' ? '验证结果未知，请人工核对运行' : !current ? '代码已变化或验证中修改了源文件，请重新验证' : '最近一次验证未通过，请查看运行记录', command: before.command, runId: String(row.run_id) }
  }

  preview(taskId: string): TaskIntegrationPreview {
    this.refreshPending()
    return this.makePreview(this.capture(taskId))
  }

  private makePreview({ task, snapshot, content, blockers, integrated }: ReturnType<RequirementIntegrationService['capture']>): TaskIntegrationPreview {
    const taskId = task.id
    return { taskId, taskVersion: task.version, requirementId: snapshot.requirementId, title: task.title,
      fingerprint: hash(snapshot), sourceHead: snapshot.sourceHead, targetHead: snapshot.targetHead,
      sourceBranch: snapshot.sourceBranch, targetBranch: snapshot.targetBranch, files: snapshot.files,
      ...integrationDiff(snapshot.sourceRoot, snapshot.baseCommit, snapshot.files),
      review: this.review(snapshot, content.snapshot), verification: this.verification(snapshot), blockers, integrated,
      operations: this.list(snapshot.requirementId).filter(op => op.taskId === taskId),
    }
  }

  recordReview(input: ApiParsedInput<'task.integration.review'>): TaskIntegrationPreview {
    const captured = this.capture(input.taskId)
    const { task, snapshot, content } = captured
    if (hash(snapshot) !== input.fingerprint) throw new AppError('CONFLICT', '任务、文档或代码已变化，请刷新改动后重新审查')
    if (this.store.read.getActiveRunForTask(task.id) || (this.store.read.getTaskLease(task.id)?.expiresAt ?? 0) > now()) throw new AppError('CONFLICT', '任务仍有活动运行或写入租约，请结束后审查')
    const timestamp = now()
    const artifactId = newId('art')
    this.store.transaction(() => {
    this.store.createArtifact({ id: artifactId, projectId: task.projectId, taskId: task.id, runId: null,
      kind: 'document', title: `人工审查 · ${task.title}`.slice(0, 240), body: input.note, uri: null,
      contentHash: content.snapshot.fingerprint, gitCommit: snapshot.sourceHead, verifiedAt: null, isDemo: false, createdAt: timestamp,
      metadata: { artifactType: 'review', verdict: 'approved', conclusion: input.note, blockers: [], scope: 'task',
        reviewedObjects: content.paths, reviewSnapshot: JSON.parse(JSON.stringify(content.snapshot)), reviewedRevision: snapshot.sourceHead,
        reviewerAgentId: 'local-user', reviewerName: '本机所有者', createdBy: 'user',
        requirementVersion: snapshot.requirementVersion },
    })
    this.store.db.prepare('INSERT INTO task_integration_reviews(artifact_id,task_id,content_fingerprint,requirement_version,task_version) VALUES(?,?,?,?,?)')
      .run(artifactId, task.id, snapshot.contentFingerprint, snapshot.requirementVersion, snapshot.taskVersion)
    this.event(snapshot, 'task.integration.reviewed', '已记录人工内容审查，尚未授权合入')
    })
    return this.makePreview(captured)
  }

  request(input: ApiParsedInput<'task.integration.request'>): TaskIntegrationOperation {
    this.refreshPending()
    const { task, snapshot, content, blockers, integrated } = this.capture(input.taskId)
    if (hash(snapshot) !== input.fingerprint) throw new AppError('CONFLICT', '工作区、任务或文档已变化，请刷新后重新申请')
    const pending = this.store.db.prepare(`SELECT ${COLUMNS} FROM task_integration_operations WHERE requirement_id=? AND status IN ${busyStatuses}`).get(snapshot.requirementId)
    if (pending) {
      if (pending.taskId === task.id && pending.kind === input.kind) return TaskIntegrationOperationSchema.parse(pending)
      throw new AppError('CONFLICT', '此需求还有待审批、执行或核对的成果操作，请先处理')
    }
    if (this.store.read.getActiveRunForTask(task.id) || (this.store.read.getTaskLease(task.id)?.expiresAt ?? 0) > now()) throw new AppError('CONFLICT', '任务仍有活动运行或写入租约，请先处理')
    if (input.kind === 'integrate') {
      if (integrated) throw new AppError('CONFLICT', '当前成果已合入需求，无需重复申请')
      if (!this.review(snapshot, content.snapshot).approved) blockers.push('当前代码尚未通过完整审查')
      if (!this.verification(snapshot).passed) blockers.push('当前代码尚未通过实际验证')
      if (blockers.length) throw new AppError('CONFLICT', blockers.join('；'))
    } else {
      if (!input.command?.trim()) throw new AppError('BAD_REQUEST', '请填写实际验证命令')
      if (task.status === 'cancelled') throw new AppError('CONFLICT', '已取消任务不能验证')
      snapshot.command = input.command
    }
    const toolName = TOOL_NAMES[input.kind]
    if (evaluateToolPolicy({ rootPath: snapshot.sourceRoot, toolName, args: { ...snapshot, command: snapshot.command } }).decision !== 'require_approval') throw new AppError('POLICY_DENIED', '此操作需要独立人工授权')
    return this.store.transaction(() => {
      const timestamp = now(), id = newId('wsp'), runId = newId('run'), sessionId = newId('ses')
      this.store.createSession({ id: sessionId, projectId: task.projectId, agentId: 'agt_product', title: TITLES[input.kind], status: 'active', createdAt: timestamp, updatedAt: timestamp })
      this.store.createRun({ id: runId, projectId: task.projectId, taskId: task.id, sessionId, agentId: 'agt_product', attempt: 1,
        status: 'waiting_approval', error: null, summary: `等待批准${TITLES[input.kind]}（系统操作，不调用模型）`, inputTokens: 0, outputTokens: 0,
        checkpointId: null, startedAt: timestamp, finishedAt: null, createdAt: timestamp })
      const args = { ...snapshot, operation: input.kind }
      const tool = this.store.createToolCall({ runId, toolName, idempotencyKey: id, status: 'waiting_approval', argsHash: hash(args), args })
      const approval = this.store.createApproval({ projectId: task.projectId, runId, toolCallId: tool.id, title: `${TITLES[input.kind]} · ${task.title}`.slice(0, 240),
        detail: input.kind === 'verify' ? `在任务独立目录执行：${snapshot.command}。命令可能修改文件；只有源内容保持一致且退出成功才算验证通过。`
          : `提交本次审查的 ${snapshot.files.length} 个改动文件，并合入需求分支 ${snapshot.targetBranch}。合并冲突时中止本次合并；不修改项目主分支，不推送，不交付需求。`,
        request: { toolName, args, risk: input.kind === 'verify' ? 'process' : 'git-write', reason: '仅授权本次固定内容和目标的操作' }, expiresAt: timestamp + 10 * 60_000 })
      this.store.db.prepare(`INSERT INTO task_integration_operations(id,task_id,requirement_id,kind,approval_id,run_id,tool_call_id,status,snapshot_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'waiting_approval',?,?,?)`)
        .run(id, task.id, task.requirementId!, input.kind, approval.id, runId, tool.id, JSON.stringify(snapshot), timestamp, timestamp)
      this.event(snapshot, 'task.integration.requested', `等待批准${TITLES[input.kind]}`)
      return this.operation(id)
    })
  }

  ownsApproval(id: string) { return Boolean(this.store.db.prepare('SELECT id FROM task_integration_operations WHERE approval_id=?').get(id)) }

  async decide(approvalId: string, decision: 'approved' | 'rejected', note: string): Promise<void> {
    this.refreshPending()
    const row = this.store.db.prepare('SELECT * FROM task_integration_operations WHERE approval_id=?').get(approvalId)
    if (!row || row.status !== 'waiting_approval' || this.store.getApprovalById(approvalId)?.status !== 'pending') throw new AppError('CONFLICT', '此操作已处理或授权已过期')
    const id = String(row.id), snapshot = SnapshotSchema.parse(JSON.parse(String(row.snapshot_json)))
    if (decision === 'rejected') { this.store.decideApproval(approvalId, decision, note); this.finish(id, 'rejected', '已拒绝本次操作'); return }
    try {
      const current = this.capture(snapshot.taskId, String(row.run_id))
      current.snapshot.command = snapshot.command
      if ((this.store.read.getTaskLease(snapshot.taskId)?.expiresAt ?? 0) > now()) throw new AppError('CONFLICT', '任务仍有写入租约，请先处理')
      if (hash(current.snapshot) !== hash(snapshot)) throw new AppError('CONFLICT', '审批期间代码、目标分支或任务内容已变化，请重新申请')
      if (row.kind === 'integrate') {
        if (!this.review(snapshot, current.content.snapshot).approved || !this.verification(snapshot).passed) current.blockers.push('当前审查或验证不再有效')
        if (current.blockers.length) throw new AppError('CONFLICT', current.blockers.join('；'))
      }
      if (this.store.db.prepare("SELECT id FROM task_workspace_preparations WHERE requirement_id=? AND status IN ('executing','needs_reconciliation')").get(snapshot.requirementId)) throw new AppError('CONFLICT', '需求工作区仍在准备或待核对')
      const toolName = TOOL_NAMES[row.kind as TaskIntegrationOperation['kind']]
      if (evaluateToolPolicy({ rootPath: snapshot.sourceRoot, toolName, args: { ...snapshot } }).decision !== 'require_approval') throw new AppError('POLICY_DENIED', '策略已变化，请重新申请')
      this.store.transaction(() => {
        this.store.decideApproval(approvalId, decision, note)
        this.store.db.prepare("UPDATE task_integration_operations SET status='executing',updated_at=? WHERE id=?").run(now(), id)
        this.store.updateRun(String(row.run_id), { status: 'running' })
        this.store.updateToolCall(String(row.tool_call_id), { status: 'running', startedAt: now() })
      })
    } catch (error) {
      this.store.expireApproval(approvalId, '操作条件已变化')
      this.finish(id, 'failed', error instanceof Error ? error.message : String(error)); throw error
    }
    try {
      if (row.kind === 'verify') void this.verifyOperation(id, snapshot, String(row.run_id), String(row.tool_call_id))
      else this.integrate(id, snapshot)
    } catch (error) {
      this.finish(id, 'needs_reconciliation', `操作结果待核对：${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }

  // Approval acknowledges the authorized operation promptly; command execution is tracked by Run.
  // A long verification must not time out the desktop's 30-second IPC request.
  private async verifyOperation(id: string, snapshot: Snapshot, runId: string, toolCallId: string) {
    try {
      const result = await runApprovedCommand(snapshot.sourceRoot, snapshot.command!, 120_000)
      if (/^命令超时（\d+ms）/.test(result.stderr)) {
        this.store.updateToolCall(toolCallId, { result: { ...result, unchanged: false } })
        this.finish(id, 'needs_reconciliation', '验证命令超时，进程结果需要人工核对；不会自动重试')
        return
      }
      const after = this.capture(snapshot.taskId, runId).snapshot
      after.command = snapshot.command
      const unchanged = hash(after) === hash(snapshot) && this.store.read.getRun(runId)?.status === 'running'
      this.store.updateToolCall(toolCallId, { result: { ...result, unchanged, contentFingerprint: after.contentFingerprint } })
      this.finish(id, result.exitCode === 0 && unchanged ? 'completed' : 'failed', result.exitCode !== 0 ? `验证失败（退出码 ${result.exitCode}），请查看运行输出` : !unchanged ? '验证期间源文件、任务范围或运行状态发生变化，请检查后重新验证' : null)
    } catch (error) {
      this.finish(id, 'needs_reconciliation', `验证结果待核对：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private integrate(id: string, snapshot: Snapshot) {
    const source = snapshot.sourceRoot, target = snapshot.targetRoot
    const sourceMessage = `ProjectOS task ${snapshot.taskId} [${id}]`
    const mergeMessage = `ProjectOS integrate ${snapshot.taskId} [${id}]`
    const pendingPaths = [...new Set([...gitPaths(source, 'diff', '--no-renames', '--name-only', '-z', 'HEAD', '--'), ...gitPaths(source, 'ls-files', '--others', '--exclude-standard', '-z')])]
    if (pendingPaths.some(path => !snapshot.files.some(file => file.path === path))) throw new AppError('CONFLICT', '出现未审查的改动文件，停止提交')
    if (pendingPaths.length) {
      requirementGit(source, ...WRITE_CONFIG, 'add', '--', ...pendingPaths)
      const content = taskContent(source, snapshot.baseCommit, this.store.read.getTask(snapshot.taskId)!)
      if (content.fingerprint !== snapshot.contentFingerprint || gitText(source, 'rev-parse', 'HEAD') !== snapshot.sourceHead) throw new AppError('CONFLICT', '暂存期间内容发生变化，请人工核对')
      // Every staged blob must still match the reviewed worktree; no unrelated staged changes.
      requirementGit(source, 'diff', '--exit-code', '--no-ext-diff', '--no-textconv', '--')
      requirementGit(source, ...WRITE_CONFIG, 'commit', '--no-verify', '-m', sourceMessage)
    }
    const sourceCommit = gitText(source, 'rev-parse', 'HEAD')
    if (taskContent(source, snapshot.baseCommit, this.store.read.getTask(snapshot.taskId)!).fingerprint !== snapshot.contentFingerprint || gitText(source, 'status', '--porcelain=v1', '-uall')) throw new AppError('CONFLICT', '提交后内容与审批不一致，请人工核对')
    this.store.db.prepare('UPDATE task_integration_operations SET source_commit=? WHERE id=?').run(sourceCommit, id)
    if (gitText(target, 'rev-parse', 'HEAD') !== snapshot.targetHead || gitText(target, 'status', '--porcelain=v1', '-uall')) throw new AppError('CONFLICT', '目标分支已变化，停止合入')
    try { requirementGit(target, ...WRITE_CONFIG, 'merge', '--no-ff', '--no-edit', '-m', mergeMessage, sourceCommit) }
    catch (error) {
      const mergeHead = gitText(target, 'rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD')
      const conflicts = gitPaths(target, 'diff', '--name-only', '--diff-filter=U', '-z')
      if (existsSync(mergeHead) && gitText(target, 'rev-parse', 'HEAD') === snapshot.targetHead) {
        requirementGit(target, ...WRITE_CONFIG, 'merge', '--abort')
        if (gitText(target, 'rev-parse', 'HEAD') === snapshot.targetHead && !gitText(target, 'status', '--porcelain=v1', '-uall')) {
          this.finish(id, 'failed', `合并冲突，已中止本次合并，任务提交已保留。${conflicts.join('、')}`)
          return
        }
      }
      throw error
    }
    const resultCommit = gitText(target, 'rev-parse', 'HEAD')
    requirementGit(target, 'merge-base', '--is-ancestor', sourceCommit, resultCommit)
    if (gitText(target, 'status', '--porcelain=v1', '-uall')) throw new AppError('CONFLICT', '合入后工作区存在额外改动，请人工核对')
    this.store.db.prepare('UPDATE task_integration_operations SET result_commit=? WHERE id=?').run(resultCommit, id)
    this.finish(id, 'completed', null)
  }

  /** Human-triggered, read-only reconciliation; never retries a commit, merge or command. */
  reconcile(id: string): TaskIntegrationOperation {
    const row = this.store.db.prepare('SELECT * FROM task_integration_operations WHERE id=?').get(id)
    if (!row || row.status !== 'needs_reconciliation') throw new AppError('CONFLICT', '仅待核对操作可以核对')
    if (row.kind !== 'integrate') {
      const run = this.store.read.getRun(String(row.run_id))
      if (!run || !['completed', 'failed', 'cancelled'].includes(run.status)) throw new AppError('CONFLICT', '请先在运行记录中完成人工核对，再解除验证阻塞；不会自动重跑')
      this.finish(id, 'failed', '已人工核对未知验证运行；原验证不计为通过，可重新申请')
      return this.operation(id)
    }
    if (this.store.getApprovalById(String(row.approval_id))?.status !== 'approved') throw new AppError('CONFLICT', '原操作没有人工批准')
    const snapshot = SnapshotSchema.parse(JSON.parse(String(row.snapshot_json)))
    const current = this.capture(snapshot.taskId, String(row.run_id)).snapshot
    if (current.sourceRoot !== snapshot.sourceRoot || current.targetRoot !== snapshot.targetRoot || current.sourceBranch !== snapshot.sourceBranch || current.targetBranch !== snapshot.targetBranch || current.contentFingerprint !== snapshot.contentFingerprint)
      throw new AppError('CONFLICT', '目录、分支或内容与审批不一致，请人工处理')
    if (current.sourceHead === snapshot.sourceHead && current.targetHead === snapshot.targetHead && !gitText(snapshot.targetRoot, 'status', '--porcelain=v1', '-uall')) {
      this.finish(id, 'failed', '已核对：源提交与需求分支均未变化，原任务文件与暂存区保留；可重新申请')
      this.store.appendRunStep({ runId: String(row.run_id), kind: 'status', title: '人工核对确认尚未提交或合入', payload: { gitMutated: false } })
      return this.operation(id)
    }
    if (gitText(snapshot.sourceRoot, 'status', '--porcelain=v1', '-uall') || gitText(snapshot.targetRoot, 'status', '--porcelain=v1', '-uall')) throw new AppError('CONFLICT', '工作区存在未提交或冲突内容，请人工处理后核对')
    const sourceCommit = row.source_commit ? String(row.source_commit) : current.sourceHead
    if (sourceCommit !== current.sourceHead) throw new AppError('CONFLICT', '任务分支已被继续修改，请人工核对')
    if (sourceCommit !== snapshot.sourceHead) {
      if (gitText(snapshot.sourceRoot, 'show', '-s', '--format=%P', sourceCommit) !== snapshot.sourceHead || gitText(snapshot.sourceRoot, 'show', '-s', '--format=%s', sourceCommit) !== `ProjectOS task ${snapshot.taskId} [${id}]`)
        throw new AppError('CONFLICT', '任务提交不匹配原操作，不能登记')
    }
    if (current.targetHead === snapshot.targetHead) {
      this.finish(id, 'failed', '已核对：需求分支未发生合入，已有任务提交保留；可重新申请')
    } else {
      if (gitText(snapshot.targetRoot, 'show', '-s', '--format=%P', current.targetHead) !== `${snapshot.targetHead} ${sourceCommit}` || gitText(snapshot.targetRoot, 'show', '-s', '--format=%s', current.targetHead) !== `ProjectOS integrate ${snapshot.taskId} [${id}]`)
        throw new AppError('CONFLICT', '需求分支结果不匹配原合入操作，请人工核对')
      this.store.db.prepare('UPDATE task_integration_operations SET source_commit=?,result_commit=? WHERE id=?').run(sourceCommit, current.targetHead, id)
      this.finish(id, 'completed', null)
    }
    this.store.appendRunStep({ runId: String(row.run_id), kind: 'status', title: '人工发起合入结果核对', payload: { gitMutated: false, sourceCommit, targetCommit: current.targetHead } })
    return this.operation(id)
  }

  private operation(id: string) { return TaskIntegrationOperationSchema.parse(this.store.db.prepare(`SELECT ${COLUMNS} FROM task_integration_operations WHERE id=?`).get(id)) }

  private finish(id: string, status: TaskIntegrationOperation['status'], error: string | null) {
    const row = this.store.db.prepare('SELECT * FROM task_integration_operations WHERE id=?').get(id)
    if (!row) return
    const snapshot = SnapshotSchema.parse(JSON.parse(String(row.snapshot_json)))
    this.store.transaction(() => {
      this.store.db.prepare('UPDATE task_integration_operations SET status=?,error=?,updated_at=? WHERE id=?').run(status, error, now(), id)
      this.store.updateToolCall(String(row.tool_call_id), { status: status === 'completed' ? 'completed' : 'failed', error, finishedAt: now(), ...(row.kind === 'integrate' ? { result: { sourceCommit: row.source_commit, resultCommit: row.result_commit, status } } : {}) })
      this.store.updateRun(String(row.run_id), { status: status === 'completed' ? 'completed' : status === 'needs_reconciliation' ? 'needs_reconciliation' : status === 'rejected' ? 'cancelled' : 'failed', error, summary: status === 'completed' ? `${TITLES[row.kind as TaskIntegrationOperation['kind']]}已完成` : error, finishedAt: now() })
      this.event(snapshot, 'task.integration.updated', error ?? `${TITLES[row.kind as TaskIntegrationOperation['kind']]}已完成`)
    })
  }

  private refreshPending() {
    for (const row of this.store.db.prepare("SELECT id,approval_id,run_id FROM task_integration_operations WHERE status='waiting_approval'").all()) {
      const approval = this.store.getApprovalById(String(row.approval_id)), run = this.store.read.getRun(String(row.run_id))
      if (!approval || approval.status !== 'pending' || (approval.expiresAt && approval.expiresAt <= now()) || run?.status !== 'waiting_approval') {
        if (approval?.status === 'pending') this.store.expireApproval(approval.id, '授权已过期或运行已取消')
        this.finish(String(row.id), 'failed', '授权已失效，请重新申请')
      }
    }
  }

  private event(snapshot: Snapshot, kind: string, summary: string) { this.store.appendEvent(snapshot.projectId, snapshot.taskId, PROJECT_EVENT_TYPES.custom, { kind, summary }) }
}
