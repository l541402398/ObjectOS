import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import { AppError, GitOperationSchema, newId, now, type ApiParsedInput, type GitSubject, type GitOperation, type GitResolution } from '@projectos/contracts'
import { evaluateToolPolicy, isProtectedPath, redactSecrets } from '@projectos/policy'
import { WorktreeManager, isSensitiveWorktreePath } from '@projectos/worktree'
import { createArtifactRecord, type SqliteStore } from '@projectos/persistence'
import { runApprovedCommand, resolveWorkspacePath, writeTextFile } from '@projectos/workspace'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import { assertIdleGit, assertSafeGitAttributes, gitText, gitPaths, hash, repositoryIdentity, taskContent, integrationRoot, requirementGit } from './requirement-git.js'
import { managedTaskWorkspace } from './requirement-work.js'
import { planReviewEvidence, planTestEvidence } from './review-evidence-runtime.js'
import { recordedVerificationCommands, verifyAfterMerge } from './delivery-verifier.js'
import type { AgentRunner } from './agent-runner.js'
import type { RequirementIntegrationService } from './requirement-integration.js'
import { projectVerification } from './verification-choice.js'

const WRITE = ['-c', 'core.hooksPath=.git', '-c', 'commit.gpgSign=false', '-c', 'merge.gpgSign=false', '-c', 'user.name=ProjectOS', '-c', 'user.email=projectos@local']
const TITLES = { fetch: '获取远端代码', pull: '同步远端提交', push: '推送已审查提交', merge_plan: '合入计划成果', open_resolution: '准备冲突解决工作区', resolve_file: '保存人工解决内容', verify_project: '验证待推送代码', verify_resolution: '验证冲突解决结果', integrate_resolution: '合入冲突解决结果' }
type Request = ApiParsedInput<'gitDelivery.request'>
type Row = { id: string; project_id: string; kind: GitOperation['kind']; subject_json: string; snapshot_json: string; parent_id: string | null; run_id: string; tool_call_id: string; approval_id: string; status: GitOperation['status']; result_json: string | null; error: string | null; created_at: number }
type Snapshot = ReturnType<GitDeliveryService['capture']> & { request: Request; remoteHead: string | null; remoteRef: string; remoteUrlHash: string; resolutionFingerprint: string | null; taskEvidence?: ReturnType<RequirementIntegrationService['resolvedGate']> }
const parse = <T>(text: string | null): T => JSON.parse(text ?? '{}') as T
const message = (error: unknown) => redactSecrets(error instanceof Error ? error.message : String(error)).replace(/https?:\/\/[^\s@]+@/g, 'https://[redacted]@').slice(0, 4000)

/** Network Git is asynchronous, bounded and never invokes a shell or an interactive credential UI. */
function gitAsync(root: string, args: string[], operationId: string): Promise<{ code: number; out: string; timedOut: boolean }> {
  return new Promise((resolveResult) => {
    const child = spawn('git', ['--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=.git', '-c', 'core.sshCommand=ssh', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always', '-c', 'protocol.file.allow=always', '-C', root, ...args], {
      windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_REFLOG_ACTION: `ProjectOS ${operationId}` },
    })
    let out = '', timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32' && child.pid) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
      else child.kill('SIGKILL')
    }, 60_000)
    const append = (chunk: Buffer) => { out = (out + chunk.toString('utf8')).slice(-120_000) }
    child.stdout.on('data', append); child.stderr.on('data', append)
    child.once('error', error => { clearTimeout(timer); resolveResult({ code: -1, out: message(error), timedOut }) })
    child.once('close', code => { clearTimeout(timer); resolveResult({ code: code ?? -1, out: message(out), timedOut }) })
  })
}

export class GitDeliveryService {
  private readonly worktrees = new WorktreeManager()
  constructor(private readonly store: SqliteStore, private readonly dataDir: string, private readonly runner: AgentRunner,
    private readonly assertPlanGrant: (planId: string) => void,
    private readonly assertVersionGate: (projectId: string, versionId: string) => void = () => {}, private readonly taskIntegration?: RequirementIntegrationService) {
    for (const row of store.db.prepare("SELECT id FROM git_delivery_operations WHERE status='executing'").all())
      this.finish(String(row.id), 'needs_reconciliation', '操作被中断，结果未知；请只读核对，不会自动重试')
  }

  private rows(projectId: string) { return this.store.db.prepare('SELECT * FROM git_delivery_operations WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 200').all(projectId) as unknown as Row[] }
  private row(id: string) {
    const row = this.store.db.prepare('SELECT * FROM git_delivery_operations WHERE id=?').get(id) as unknown as Row | undefined
    if (!row) throw new AppError('NOT_FOUND', 'Git 操作不存在')
    return row
  }
  private view(row: Row): GitOperation {
    return GitOperationSchema.parse({ id: row.id, projectId: row.project_id, kind: row.kind, status: row.status,
      approvalId: row.approval_id, runId: row.run_id, parentId: row.parent_id, resultCommit: parse<{ resultCommit?: string }>(row.result_json).resultCommit ?? null, error: row.error, createdAt: row.created_at })
  }
  private saveResult(id: string, result: Record<string, unknown>) {
    const previous = parse<Record<string, unknown>>(this.row(id).result_json)
    this.store.db.prepare('UPDATE git_delivery_operations SET result_json=?,updated_at=? WHERE id=?').run(JSON.stringify({ ...previous, ...result }), now(), id)
  }

  capture(subject: GitSubject) {
    const project = this.store.read.getProject(subject.projectId)
    if (!project || project.status === 'archived') throw new AppError('NOT_FOUND', '项目不可用')
    const projectRoot = realpathSync.native(project.rootPath)
    let targetRoot = projectRoot, sourceRoot: string | null = null, sourceHead: string | null = null, sourceFingerprint: string | null = null, baseCommit: string | null = null
    if (subject.taskId) {
      const task = this.store.read.getTask(subject.taskId)
      if (!task || task.projectId !== project.id || !task.requirementId) throw new AppError('CONFLICT', '任务不属于此需求项目')
      const managed = managedTaskWorkspace(this.store, task)!
      sourceRoot = managed.root; targetRoot = integrationRoot(this.store, task, managed.projectIdentity).root
      baseCommit = this.store.read.getTaskWorkspace(task.id)!.baseCommit
      sourceHead = managed.identity.head; sourceFingerprint = taskContent(sourceRoot, baseCommit, task, managed.identity).fingerprint
    } else if (subject.planId) {
      const plan = this.store.read.getPlanRevision(subject.planId)
      if (!plan || plan.projectId !== project.id || !plan.execution?.workspaceRef || !plan.execution.branch) throw new AppError('CONFLICT', '计划没有有效工作区')
      sourceRoot = plan.execution.workspaceRef; const identity = repositoryIdentity(sourceRoot)
      if (identity.branch !== plan.execution.branch || identity.commonDir !== repositoryIdentity(projectRoot).commonDir) throw new AppError('CONFLICT', '计划工作区归属已改变')
      sourceHead = identity.head; baseCommit = plan.execution.baseCommit ?? gitText(projectRoot, 'merge-base', 'HEAD', sourceHead)
      sourceFingerprint = taskContent(sourceRoot, baseCommit, { id: plan.id, projectId: project.id }, identity).fingerprint
    }
    const identity = repositoryIdentity(targetRoot)
    assertIdleGit(targetRoot, identity.gitDir)
    if (identity.branch === 'HEAD') throw new AppError('CONFLICT', '目标必须位于明确分支')
    const targetFingerprint = taskContent(targetRoot, identity.head, { id: subject.planId ?? subject.taskId ?? project.id, projectId: project.id }, identity).fingerprint
    return { subject, projectRoot, targetRoot, targetHead: identity.head, targetBranch: identity.branch, targetFingerprint,
      sourceRoot, sourceHead, sourceFingerprint, baseCommit,
      fingerprint: hash({ subject, targetRoot, targetHead: identity.head, targetBranch: identity.branch, targetFingerprint, sourceRoot, sourceHead, sourceFingerprint }) }
  }

  private remote(root: string, name: string, branch: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(name) || !branch || branch.startsWith('-') || /[\s\x00-\x1f]/.test(branch)) throw new AppError('BAD_REQUEST', '远端或分支名称不合法')
    gitText(root, 'check-ref-format', `refs/heads/${branch}`)
    const url = gitText(root, 'remote', 'get-url', name)
    if (!url || /^(ext|fd)::/i.test(url) || /[\r\n\0]/.test(url)) throw new AppError('POLICY_DENIED', '此远端协议不能自动操作')
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^(https|ssh|file):\/\//i.test(url)) throw new AppError('POLICY_DENIED','只支持 HTTPS、SSH 或本机远端')
    const pushUrls=gitText(root,'remote','get-url','--push','--all',name).split(/\r?\n/)
    if(pushUrls.length!==1||pushUrls[0]!==url)throw new AppError('POLICY_DENIED','读取和推送远端不一致，请先人工核对配置')
    for (const key of ['uploadpack', 'receivepack', 'proxy']) {
      let custom = ''; try { custom = gitText(root, 'config', '--get', `remote.${name}.${key}`) } catch { /* unset */ }
      if (custom) throw new AppError('POLICY_DENIED', '远端启用了自定义执行器，请人工处理')
    }
    const ref = `refs/remotes/${name}/${branch}`
    let head: string | null = null; try { head = gitText(root, 'rev-parse', '--verify', ref) } catch { /* not fetched */ }
    let location = '本机仓库'; try { location = new URL(url).host || location } catch { if (/^[^@]+@[^:]+:/.test(url)) location = url.split('@')[1]!.split(':')[0]! }
    return { name, branch, head, ref, urlHash: hash(url), location }
  }
  private contentReview(key: string, fingerprint: string) {
    return !!this.store.db.prepare('SELECT resolution_id FROM git_resolution_reviews WHERE resolution_id=? AND fingerprint=?').get(key, fingerprint)
  }
  private verified(projectId: string, key: string, fingerprint: string) {
    const latest = this.rows(projectId).find(row => row.kind === (key.startsWith('project:') ? 'verify_project' : 'verify_resolution') && (row.parent_id ?? `project:${projectId}`) === key)
    const result = latest ? parse<{ fingerprint?: string; exitCode?: number; command?: string }>(latest.result_json) : null
    return { passed: latest?.status === 'completed' && result?.fingerprint === fingerprint && result.exitCode === 0, command: result?.command ?? null }
  }

  private resolution(row: Row): GitResolution {
    if (row.kind !== 'open_resolution' || row.status !== 'completed') throw new AppError('CONFLICT', '解决工作区尚未准备完成')
    const snapshot = parse<Snapshot>(row.snapshot_json), result = parse<{ root: string; branch: string; paths: string[]; originals?: Record<string, { base: string | null; ours: string | null; theirs: string | null }>; agentRunId?: string }>(row.result_json)
    const identity = repositoryIdentity(result.root)
    if (identity.branch !== result.branch || identity.commonDir !== repositoryIdentity(snapshot.projectRoot).commonDir) throw new AppError('CONFLICT', '解决工作区归属已改变')
    const entries = gitPaths(result.root, 'ls-files', '--cached', '--others', '--exclude-standard', '--stage', '-z')
    const paths = [...new Set(entries.map(entry => /^\d{6} [a-f0-9]+ \d\t([\s\S]+)$/.exec(entry)?.[1] ?? entry))].sort()
    if (paths.length > 10_000) throw new AppError('CONFLICT', '解决工作区超过完整审查文件上限')
    assertSafeGitAttributes(result.root, paths)
    let total = 0
    const blobs = paths.map(path => {
      if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw new AppError('POLICY_DENIED', '文件路径越界')
      const absolute = resolveWorkspacePath(result.root, path,{forWrite:true})
      if (!existsSync(absolute)) return [path, null]
      if (!lstatSync(absolute).isFile()) throw new AppError('POLICY_DENIED', '解决工作区不能包含链接或子模块')
      const bytes = readFileSync(absolute); total += bytes.length
      if (bytes.length > 64 * 1024 * 1024 || total > 256 * 1024 * 1024) throw new AppError('CONFLICT', '解决内容超过完整审查大小上限')
      return [path, createHash('sha256').update(bytes).digest('hex')]
    })
    const unresolved = new Set(gitPaths(result.root, 'diff', '--name-only', '--diff-filter=U', '-z'))
    const content = (path: string) => {
      const absolute = resolveWorkspacePath(result.root, path,{forWrite:true})
      if (!existsSync(absolute)) return null
      const bytes = readFileSync(absolute)
      if (bytes.length > 200_000 || bytes.includes(0)) throw new AppError('CONFLICT', `文件需要使用本机编辑器处理：${path}`)
      return bytes.toString('utf8')
    }
    const fingerprint = hash({ head: identity.head, branch: identity.branch, targetHead: snapshot.targetHead, sourceHead: snapshot.sourceHead, entries, blobs })
    const diff=requirementGit(result.root,'diff','--no-ext-diff','--no-textconv',snapshot.targetHead,'--')
    return { id: row.id, mode: snapshot.request.mode, root: result.root, branch: result.branch, fingerprint,
      diff:diff.slice(0,1_000_000),diffTruncated:diff.length>1_000_000,
      targetHead: snapshot.targetHead, sourceHead: snapshot.sourceHead!, agentRunId: result.agentRunId ?? null,
      files: result.paths.map(path => ({ path, base: result.originals?.[path]?.base ?? null, ours: result.originals?.[path]?.ours ?? null, theirs: result.originals?.[path]?.theirs ?? null, content: content(path), conflict: unresolved.has(path) })),
      reviewCurrent: this.contentReview(row.id, fingerprint), verificationCurrent: this.verified(row.project_id, row.id, fingerprint).passed,
      verificationCommand: this.verified(row.project_id, row.id, fingerprint).command }
  }

  state(subject: GitSubject) {
    this.expirePending()
    const capture = this.capture(subject), rows = this.rows(subject.projectId)
    const remotes = gitText(capture.projectRoot, 'remote').split(/\r?\n/).filter(Boolean).map(name => {
      const remote = this.remote(capture.projectRoot, name, capture.targetBranch)
      return { name, branch: remote.branch, trackingHead: remote.head, location: remote.location }
    })
    const latestResolution = rows.find(row => row.kind === 'open_resolution' && row.status === 'completed' && hash(parse<GitSubject>(row.subject_json)) === hash(subject))
    const resolution=latestResolution&&!rows.some(op=>op.kind==='integrate_resolution'&&op.parent_id===latestResolution.id&&!!parse<{resultCommit?:string}>(op.result_json).resultCommit)?latestResolution:undefined
    const compared = capture.sourceRoot ? capture.sourceHead! : remotes[0]?.trackingHead
    const diff = compared ? gitText(capture.targetRoot, 'diff', '--no-ext-diff', '--no-textconv', compared, capture.targetHead, '--') : gitText(capture.targetRoot,'show','--format=fuller','--no-ext-diff','--no-textconv',capture.targetHead,'--')
    return { subject, root: capture.targetRoot, branch: capture.targetBranch, head: capture.targetHead, fingerprint: capture.fingerprint, remotes,
      diff: diff.slice(0,1_000_000), diffTruncated: diff.length > 1_000_000,
      operations: rows.filter(row => hash(parse<GitSubject>(row.subject_json)) === hash(subject)).map(row => this.view(row)),
      resolution: resolution ? this.resolution(resolution) : null,
      contentReviewed: this.contentReview(`project:${subject.projectId}`, capture.fingerprint), contentVerified: this.verified(subject.projectId, `project:${subject.projectId}`, capture.fingerprint).passed }
  }

  private assertPlan(subject: GitSubject) {
    if (!subject.planId) throw new AppError('BAD_REQUEST', '请选择计划')
    const plan = this.store.read.getPlanRevision(subject.planId)!
    if (plan.execution?.status !== 'completed' || plan.execution.mergedAt) throw new AppError('CONFLICT', '计划尚未完成或已经合入')
    this.assertPlanGrant(plan.id)
    if (!planReviewEvidence(this.store, plan).approved || !planTestEvidence(this.store, plan).trusted || !recordedVerificationCommands(this.store, plan).length)
      throw new AppError('CONFLICT', '计划需要当前内容的完整审查和真实测试证据')
    if (plan.versionId) this.assertVersionGate(plan.projectId, plan.versionId)
    return plan
  }

  changes(input:ApiParsedInput<'gitDelivery.changes'>) {
    const capture=this.capture(input.subject)
    const resolution=input.resolutionId?this.resolution(this.row(input.resolutionId)):null
    if(input.resolutionId && hash(parse<GitSubject>(this.row(input.resolutionId).subject_json))!==hash(input.subject))throw new AppError('FORBIDDEN','解决工作区不属于本次项目或任务')
    const root=resolution?.root??capture.sourceRoot??capture.targetRoot
    let base=resolution?.targetHead??capture.baseCommit,emptyBase=false
    if(!base){
      const remotes=gitText(capture.projectRoot,'remote').split(/\r?\n/).filter(Boolean)
      const tracking=remotes.length?this.remote(capture.projectRoot,remotes[0]!,capture.targetBranch).head:null
      if(tracking)base=gitText(root,'merge-base',capture.targetHead,tracking)
      else {try{base=gitText(root,'rev-parse','HEAD^')}catch{base=capture.targetHead;emptyBase=true}}
    }
    const paths=[...new Set([...(emptyBase?gitPaths(root,'ls-files','-z'):gitPaths(root,'diff','--name-only','--no-renames','-z',base,'--')),...gitPaths(root,'ls-files','--others','--exclude-standard','-z')])].sort()
    let total=0,truncated=paths.length>200
    const text=(bytes:Buffer|null)=>{
      if(!bytes)return {value:null,binary:false,truncated:false}
      const binary=bytes.includes(0);total+=Math.min(bytes.length,512_000)
      const cut=bytes.length>512_000||total>4_000_000
      return {value:binary?null:bytes.subarray(0,cut?Math.min(512_000,Math.max(0,4_000_000-total)):bytes.length).toString('utf8'),binary,truncated:cut}
    }
    const files=paths.slice(0,200).map(path=>{
      let beforeBytes:Buffer|null=null
      if(!emptyBase)try{beforeBytes=Buffer.from(requirementGit(root,'show',`${base}:${path}`),'utf8')}catch{/* added or unavailable; size limits are disclosed below */}
      const absolute=resolveWorkspacePath(root,path,{forWrite:true}),afterBytes=existsSync(absolute)?readFileSync(absolute):null
      const before=text(beforeBytes),after=text(afterBytes),conflict=resolution?.files.find(file=>file.path===path)
      truncated ||= before.truncated||after.truncated
      return {path,before:before.value,after:after.value,status:beforeBytes===null?'added' as const:afterBytes===null?'deleted' as const:'modified' as const,binary:before.binary||after.binary,truncated:before.truncated||after.truncated,conflict:conflict?.conflict??false,base:conflict?.base??null,ours:conflict?.ours??null,theirs:conflict?.theirs??null}
    })
    return {fingerprint:resolution?.fingerprint??capture.fingerprint,files,truncated}
  }

  request(input: Request): GitOperation {
    this.expirePending()
    const capture = this.capture(input.subject)
    if (capture.fingerprint !== input.fingerprint) throw new AppError('CONFLICT', '代码或分支已变化，请刷新后重新申请')
    const pending = this.rows(input.subject.projectId).find(row => ['waiting_approval', 'executing', 'needs_reconciliation'].includes(row.status))
    if (pending) throw new AppError('CONFLICT', '此项目仍有 Git 审批、执行或待核对操作，请先处理')
    if (['fetch', 'pull', 'push', 'verify_project'].includes(input.kind) && (input.subject.planId || input.subject.taskId)) throw new AppError('BAD_REQUEST', '远端同步从项目工作区申请')
    if (gitText(capture.targetRoot, 'status', '--porcelain=v1', '-uall')) throw new AppError('CONFLICT', '目标工作区存在未提交修改，请先处理')
    const remote = ['fetch', 'pull', 'push', 'open_resolution'].includes(input.kind) && !capture.sourceRoot
      ? this.remote(capture.projectRoot, input.remote, input.branch ?? capture.targetBranch) : null
    if (['pull', 'push', 'open_resolution'].includes(input.kind) && !capture.sourceRoot && !remote?.head) throw new AppError('CONFLICT', '请先获取远端代码')
    if (input.kind === 'merge_plan') this.assertPlan(input.subject)
    if (input.kind === 'push' && (!this.contentReview(`project:${input.subject.projectId}`, capture.fingerprint) || !this.verified(input.subject.projectId, `project:${input.subject.projectId}`, capture.fingerprint).passed)) throw new AppError('CONFLICT', '推送需要当前提交的审查和独立验证')
    if (['verify_project', 'verify_resolution'].includes(input.kind) && !input.command?.trim()) {
      const verifyRoot=input.resolutionId?this.resolution(this.row(input.resolutionId)).root:capture.targetRoot
      input={...input,command:projectVerification(verifyRoot).command}
    }
    let resolutionFingerprint: string | null = null
    if (['resolve_file', 'verify_resolution', 'integrate_resolution'].includes(input.kind)) {
      if (!input.resolutionId) throw new AppError('BAD_REQUEST', '请选择冲突解决记录')
      const resolution = this.resolution(this.row(input.resolutionId))
      if (hash(parse<GitSubject>(this.row(input.resolutionId).subject_json))!==hash(input.subject)) throw new AppError('FORBIDDEN', '解决记录不属于此项目或任务')
      if (resolution.agentRunId && !['completed', 'failed', 'cancelled', 'timed_out', 'budget_exhausted'].includes(this.store.read.getRun(resolution.agentRunId)?.status ?? '')) throw new AppError('CONFLICT', 'Agent 仍在处理，请等待或取消运行')
      resolutionFingerprint = resolution.fingerprint
      if(input.resolutionFingerprint && input.resolutionFingerprint!==resolution.fingerprint)throw new AppError('CONFLICT','显示的解决内容已经变化，请重新打开对比')
      if (input.kind === 'resolve_file' && (!input.path || input.content === undefined || !resolution.files.some(file => file.path === input.path))) throw new AppError('BAD_REQUEST', '请选择本次冲突中的文件并填写解决内容')
      if (input.kind === 'integrate_resolution' && (!resolution.reviewCurrent || !resolution.verificationCurrent || resolution.files.some(file => file.conflict))) throw new AppError('CONFLICT', '需完成冲突解决、当前审查与真实验证后再合入')
    }
    const original = input.resolutionId ? parse<Snapshot>(this.row(input.resolutionId).snapshot_json) : null
    const taskEvidence = input.kind === 'integrate_resolution' && input.subject.taskId ? this.taskIntegration?.resolvedGate(input.subject.taskId) : undefined
    if (input.kind === 'integrate_resolution' && input.subject.taskId && !taskEvidence) throw new AppError('POLICY_DENIED','任务验收服务不可用')
    if (input.kind === 'integrate_resolution' && input.subject.planId) this.assertPlan(input.subject)
    const snapshot: Snapshot = { ...capture, taskEvidence, sourceHead: capture.sourceHead ?? remote?.head ?? original?.sourceHead ?? null, request: input,
      remoteHead: remote?.head ?? null, remoteRef: remote?.ref ?? '', remoteUrlHash: remote?.urlHash ?? '', resolutionFingerprint }
    if (evaluateToolPolicy({ rootPath: capture.projectRoot, toolName: 'git_delivery', args: snapshot }).decision !== 'require_approval') throw new AppError('POLICY_DENIED', 'Git 操作需要独立审批')
    return this.store.transaction(() => {
      const id = `gop_${newId('run').slice(4)}`, runId = newId('run'), sessionId = newId('ses'), timestamp = now()
      this.store.createSession({ id: sessionId, projectId: input.subject.projectId, agentId: 'agt_product', title: TITLES[input.kind], status: 'active', createdAt: timestamp, updatedAt: timestamp })
      this.store.createRun({ id: runId, projectId: input.subject.projectId, taskId: null, sessionId, agentId: 'agt_product', attempt: 1, status: 'waiting_approval', error: null, summary: TITLES[input.kind], inputTokens: 0, outputTokens: 0, checkpointId: null, startedAt: timestamp, finishedAt: null, createdAt: timestamp })
      const tool = this.store.createToolCall({ runId, toolName: 'git_delivery', idempotencyKey: id, status: 'waiting_approval', argsHash: hash(snapshot), args: snapshot })
      const approval = this.store.createApproval({ projectId: input.subject.projectId, runId, toolCallId: tool.id, title: TITLES[input.kind],
        detail: `${TITLES[input.kind]}。目标 ${capture.targetBranch}@${capture.targetHead.slice(0, 12)}；来源 ${(snapshot.sourceHead ?? remote?.head ?? '远端读取').slice(0, 12)}。${input.command ? '运行项目自动测试，具体程序与目录可在执行详情中核对。' : ''}${input.kind === 'push' ? '向已配置远端推送此固定提交，不允许强推。' : '不推送或发布；结果未知时停止并人工核对。'}`,
        request: { toolName: 'git_delivery', args: snapshot, risk: input.kind.startsWith('verify') ? 'process' : 'git-write', reason: '固定目标、内容和操作的独立授权' }, expiresAt: timestamp + 10 * 60_000 })
      this.store.db.prepare("INSERT INTO git_delivery_operations(id,project_id,kind,subject_json,snapshot_json,parent_id,run_id,tool_call_id,approval_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'waiting_approval',?,?)")
        .run(id, input.subject.projectId, input.kind, JSON.stringify(input.subject), JSON.stringify(snapshot), input.resolutionId ?? null, runId, tool.id, approval.id, timestamp, timestamp)
      return this.view(this.row(id))
    })
  }

  ownsApproval(id: string) { return !!this.store.db.prepare('SELECT id FROM git_delivery_operations WHERE approval_id=?').get(id) }
  async decide(id: string, decision: 'approved' | 'rejected', note: string) {
    this.expirePending()
    const row = this.store.db.prepare('SELECT * FROM git_delivery_operations WHERE approval_id=?').get(id) as unknown as Row | undefined
    if (!row || row.status !== 'waiting_approval') throw new AppError('CONFLICT', '此 Git 审批已处理或过期')
    if (decision === 'rejected') { this.store.decideApproval(id, decision, note); this.finish(row.id, 'rejected', '已拒绝本次操作'); return }
    const frozen = parse<Snapshot>(row.snapshot_json), current = this.capture(frozen.subject)
    try {
      if (current.fingerprint !== frozen.fingerprint) throw new AppError('CONFLICT', '审批期间代码或目标已变化，请重新申请')
      if (frozen.remoteRef) {
        const remote = this.remote(frozen.projectRoot, frozen.request.remote, frozen.request.branch ?? frozen.targetBranch)
        if (remote.urlHash !== frozen.remoteUrlHash || remote.head !== frozen.remoteHead) throw new AppError('CONFLICT', '远端配置或已获取提交已变化')
      }
      if (frozen.request.resolutionId && this.resolution(this.row(frozen.request.resolutionId)).fingerprint !== frozen.resolutionFingerprint) throw new AppError('CONFLICT', '审批期间解决内容已变化')
      if (row.kind === 'merge_plan') this.assertPlan(frozen.subject)
      if (row.kind === 'integrate_resolution' && frozen.subject.planId) this.assertPlan(frozen.subject)
      if (frozen.taskEvidence && hash(this.taskIntegration!.resolvedGate(frozen.taskEvidence.taskId)) !== hash(frozen.taskEvidence)) throw new AppError('CONFLICT','任务验收、审查或验证已变化')
      if (this.rows(row.project_id).some(other => other.id !== row.id && ['executing', 'needs_reconciliation'].includes(other.status))) throw new AppError('CONFLICT', '项目还有执行或待核对操作')
      if (this.store.db.prepare("SELECT id FROM agent_runs WHERE project_id=? AND id<>? AND status IN ('running','waiting_tool','waiting_approval','queued','needs_reconciliation') LIMIT 1").get(row.project_id, row.run_id)) throw new AppError('CONFLICT', '项目仍有活动或待核对运行，请先处理')
      if (evaluateToolPolicy({ rootPath: frozen.projectRoot, toolName: 'git_delivery', args: frozen }).decision !== 'require_approval') throw new AppError('POLICY_DENIED', '策略已变化')
    } catch (error) { this.store.expireApproval(id, '条件已变化'); this.finish(row.id, 'failed', message(error)); throw error }
    this.store.transaction(() => {
      this.store.decideApproval(id, decision, note)
      this.store.db.prepare("UPDATE git_delivery_operations SET status='executing',updated_at=? WHERE id=?").run(now(), row.id)
      this.store.updateRun(row.run_id, { status: 'running' }); this.store.updateToolCall(row.tool_call_id, { status: 'running', startedAt: now() })
    })
    void this.execute(row, frozen).catch(error => this.finish(row.id, 'needs_reconciliation', `操作结果待核对：${message(error)}`))
  }

  private async remoteHead(snapshot: Snapshot, id: string) {
    const result = await gitAsync(snapshot.projectRoot, ['ls-remote', '--exit-code', snapshot.request.remote, `refs/heads/${snapshot.request.branch ?? snapshot.targetBranch}`], id)
    if (result.code !== 0) throw new AppError('CONFLICT', '无法核对远端当前提交，请检查连接后重新申请')
    const head = result.out.split(/\s/)[0]
    if (!head || !/^[a-f0-9]{40,64}$/.test(head)) throw new AppError('CONFLICT', '远端没有明确的目标分支')
    return head
  }
  private assertSameTarget(snapshot: Snapshot) {
    const identity = repositoryIdentity(snapshot.targetRoot); assertIdleGit(snapshot.targetRoot, identity.gitDir)
    if (identity.head !== snapshot.targetHead || identity.branch !== snapshot.targetBranch || gitText(snapshot.targetRoot, 'status', '--porcelain=v1', '-uall')) throw new AppError('CONFLICT', '目标已变化，停止本次操作')
  }

  private async execute(row: Row, snapshot: Snapshot) {
    const input = snapshot.request, root = snapshot.targetRoot
    this.assertSameTarget(snapshot)
    if (row.kind === 'fetch') {
      const result = await gitAsync(root, ['fetch', '--no-tags', input.remote, `+refs/heads/${input.branch ?? snapshot.targetBranch}:${snapshot.remoteRef}`], row.id)
      if (result.code !== 0) throw new Error(result.out || '获取远端结果未知')
      this.saveResult(row.id, { remoteHead: gitText(root, 'rev-parse', snapshot.remoteRef), output: result.out })
    } else if (row.kind === 'pull') {
      if (await this.remoteHead(snapshot, row.id) !== snapshot.remoteHead) throw new AppError('CONFLICT', '远端已更新，请重新获取后再同步')
      this.assertSameTarget(snapshot)
      try { gitText(root, 'merge-base', '--is-ancestor', snapshot.targetHead, snapshot.remoteHead!) }
      catch { this.finish(row.id, 'failed', '本地与远端分支已分叉，请选择 Agent 自动处理或全人工解决'); return }
      gitText(root, ...WRITE, 'merge', '--ff-only', snapshot.remoteHead!)
      this.saveResult(row.id, { resultCommit: gitText(root, 'rev-parse', 'HEAD') })
    } else if (row.kind === 'push') {
      if (await this.remoteHead(snapshot, row.id) !== snapshot.remoteHead) throw new AppError('CONFLICT', '远端已变化，请先获取、同步并重新验证')
      gitText(root, 'merge-base', '--is-ancestor', snapshot.remoteHead!, snapshot.targetHead)
      this.assertSameTarget(snapshot)
      const result = await gitAsync(root, ['push', '--porcelain', input.remote, `${snapshot.targetHead}:refs/heads/${input.branch ?? snapshot.targetBranch}`], row.id)
      if (result.code !== 0) throw new Error(result.out || '推送结果未知')
      this.saveResult(row.id, { resultCommit: snapshot.targetHead, output: result.out })
      if (await this.remoteHead(snapshot, row.id) !== snapshot.targetHead) throw new Error('推送后远端提交未能确认，请人工核对')
    } else if (row.kind === 'merge_plan') {
      const plan = this.assertPlan(input.subject)
      const result = await this.worktrees.merge(root, plan.execution!.branch!, `ProjectOS approved merge ${row.id}`, plan.execution!.allowedPaths ?? ['.'])
      if (!result.ok) { this.finish(row.id, 'failed', result.message); return }
      const resultCommit = gitText(root, 'rev-parse', 'HEAD')
      this.saveResult(row.id, { resultCommit, sourceCommit: gitText(snapshot.sourceRoot!, 'rev-parse', 'HEAD') })
      this.store.updatePlanRevision({ ...plan, execution: { ...plan.execution!, mergedAt: now(), mergeCommit: resultCommit, deliveryStatus: 'merged' }, updatedAt: now() })
      const verification = await verifyAfterMerge({ rootPath: root, commands: recordedVerificationCommands(this.store, plan), timeoutMs: 300_000 })
      const evidence = this.store.createArtifact(createArtifactRecord({ projectId: row.project_id, kind: 'test-report', title: '合入后验证与审计', body: JSON.stringify({ operationId: row.id, snapshot, resultCommit, verification }), verified: verification.passed }))
      const latest = this.store.read.getPlanRevision(plan.id)!
      this.store.updatePlanRevision({ ...latest, execution: { ...latest.execution!, deliveryStatus: verification.passed ? 'verified' : 'merged_verification_failed', deliveryEvidenceId: evidence.id, deliveryVerifiedAt: verification.passed ? now() : null, deliveryError: verification.passed ? null : verification.reason }, updatedAt: now() })
      this.saveResult(row.id, { verification, evidenceId: evidence.id })
      if (!verification.passed) { this.finish(row.id, 'failed', '合并已发生，但合入后验证失败，请人工处理'); return }
    } else if (row.kind === 'open_resolution') {
      if (!snapshot.sourceHead) throw new AppError('CONFLICT', '没有明确的来源提交')
      if (snapshot.sourceRoot && gitText(snapshot.sourceRoot, 'status', '--porcelain=v1', '-uall')) throw new AppError('CONFLICT', '请先通过成果审查提交任务改动，再解决分支冲突')
      if (!snapshot.sourceRoot && await this.remoteHead(snapshot, row.id) !== snapshot.remoteHead) throw new AppError('CONFLICT', '远端已更新，请重新获取')
      const incoming = gitPaths(root, 'diff', '--name-only', '-z', snapshot.targetHead, snapshot.sourceHead, '--')
      assertSafeGitAttributes(root, incoming)
      for (const path of incoming) {
        if (isProtectedPath(path) || isSensitiveWorktreePath(path)) throw new AppError('POLICY_DENIED', '来源包含受保护文件，需人工核对')
        if (input.subject.planId) {
          const allowed = this.store.read.getPlanRevision(input.subject.planId)?.execution?.allowedPaths ?? []
          if (!allowed.some(prefix=>prefix==='.' || path===prefix || path.startsWith(prefix.replace(/\/$/,'')+'/'))) throw new AppError('POLICY_DENIED','来源文件超出计划授权范围')
        }
      }
      // Inspect incoming attributes/modes before checkout can invoke a configured filter or driver.
      const tree = gitPaths(root, 'ls-tree', '-r', '-z', snapshot.sourceHead)
      for (const entry of tree) {
        const match = /^(\d+) \w+ [a-f0-9]+\t([\s\S]+)$/.exec(entry)
        if (!match || !incoming.includes(match[2]!)) continue
        if (!['100644', '100755'].includes(match[1]!)) throw new AppError('POLICY_DENIED', '来源包含链接或子模块')
        if (match[2]!.endsWith('.gitattributes') && /(?:filter|merge)\s*(?:=|$)/m.test(gitText(root, 'show', `${snapshot.sourceHead}:${match[2]}`))) throw new AppError('POLICY_DENIED', '来源包含自定义 Git 属性，请人工处理')
      }
      if (input.mode === 'agent' && !this.store.read.getAgent(input.agentId)) throw new AppError('NOT_FOUND', '请选择可用 Agent')
      const resolutionRoot = join(realpathSync.native(this.dataDir), 'g', hash(row.id).slice(0, 24)), branch = `projectos/resolve-${row.id}`
      await this.worktrees.create(snapshot.projectRoot, resolutionRoot, branch, snapshot.targetHead)
      this.saveResult(row.id, { root: resolutionRoot, branch, paths: [] })
      const merge = await gitAsync(resolutionRoot, [...WRITE, 'merge', '--no-ff', '--no-commit', '--no-edit', snapshot.sourceHead], row.id)
      const paths = gitPaths(resolutionRoot, 'diff', '--name-only', '--diff-filter=U', '-z')
      if (merge.code !== 0 && !paths.length) throw new Error(merge.out)
      for (const path of paths) if (isProtectedPath(path) || isSensitiveWorktreePath(path)) throw new AppError('POLICY_DENIED', '冲突包含受保护文件，只能人工核对')
      const stage = (n: number, path: string) => { try { return requirementGit(resolutionRoot, 'show', `:${n}:${path}`) } catch { return null } }
      const originals=Object.fromEntries(paths.map(path => [path, { base: stage(1, path), ours: stage(2, path), theirs: stage(3, path) }]))
      this.saveResult(row.id, { paths, originals, output: merge.out })
      if (input.mode === 'agent' && paths.length) {
        const threeWay=JSON.stringify(originals)
        if(threeWay.length>80_000)throw new AppError('CONFLICT','三方冲突内容超过 Agent 完整上下文上限，请选择全人工解决')
        const timestamp = now(), sessionId = newId('ses')
        this.store.createSession({ id: sessionId, projectId: row.project_id, agentId: input.agentId, title: 'Agent 自动解决冲突', status: 'active', createdAt: timestamp, updatedAt: timestamp })
        const result = await this.runner.startRun({ projectId: row.project_id, sessionId, workspaceRoot: resolutionRoot,
          prompt: `解决此隔离工作区中的 Git 冲突。仅可修改这些文件：${JSON.stringify(paths)}。可读取工作区内普通代码与测试作为上下文。以下是完整的三方原文，base 是共同基线，ours 是目标分支，theirs 是来源分支：${threeWay}。先分别比较 ours/base 与 theirs/base，保留双方独立改动；不能简单整份采用某一侧。如果两侧意图矛盾，停止写入并请求人工判断。不要执行 Git、Shell、推送或部署。写入仍需审批。完成后说明逐文件解决理由，不能宣称已合入或发布。`,
          authority: { kind: 'git-resolution', reference: row.id, allowedTools: ['list_directory', 'read_file', 'write_file'], maxToolCalls: 30, provenance: { targetHead: snapshot.targetHead, sourceHead: snapshot.sourceHead, paths }, isolatedContext: true,
            check: async invocation => {
              this.assertSameTarget(snapshot)
              if (!['list_directory', 'read_file', 'write_file'].includes(invocation.name)) throw new AppError('POLICY_DENIED', '冲突 Agent 不能执行此工具')
              const path = String(invocation.args.path ?? '.')
              const absolute = resolveWorkspacePath(resolutionRoot, path, { forWrite: true })
              const rel = relative(resolutionRoot, absolute).replace(/\\/g, '/')
              if (invocation.name === 'write_file' && !paths.includes(rel)) throw new AppError('POLICY_DENIED', '文件不在本次冲突写入授权内')
              if(isProtectedPath(rel)||isSensitiveWorktreePath(rel))throw new AppError('POLICY_DENIED','受保护文件不能作为冲突上下文读取或写入')
            } },
        })
        this.saveResult(row.id, { agentRunId: result.runId })
      }
    } else if (row.kind === 'resolve_file') {
      const resolution = this.resolution(this.row(input.resolutionId!))
      if (resolution.fingerprint !== snapshot.resolutionFingerprint) throw new AppError('CONFLICT', '解决内容已变化')
      if (/^(<{7}|>{7})/m.test(input.content!)) throw new AppError('CONFLICT', '解决内容仍有冲突标记')
      writeTextFile(resolution.root, input.path!, input.content!)
      gitText(resolution.root, ...WRITE, 'add', '--', input.path!)
      this.saveResult(row.id, { path: input.path, author: 'local-user', contentHash: hash(input.content) })
    } else if (row.kind === 'verify_project' || row.kind === 'verify_resolution') {
      let verifyRoot = root, before = this.capture(input.subject).fingerprint
      if (input.resolutionId) {
        const resolution = this.resolution(this.row(input.resolutionId))
        if (resolution.fingerprint !== snapshot.resolutionFingerprint) throw new AppError('CONFLICT', '解决内容已变化')
        for (const file of resolution.files) if (file.content && /^(<{7}|>{7})/m.test(file.content)) throw new AppError('CONFLICT', '仍有未解决的冲突标记')
        if (resolution.files.length) gitText(resolution.root, ...WRITE, 'add', '--', ...resolution.files.map(file => file.path))
        const staged = this.resolution(this.row(input.resolutionId))
        if (staged.files.some(file => file.conflict)) throw new AppError('CONFLICT', '仍有未解决的冲突')
        verifyRoot = resolution.root; before = staged.fingerprint
      }
      const result = await runApprovedCommand(verifyRoot, input.command!, 120_000)
      const after = input.resolutionId ? this.resolution(this.row(input.resolutionId)).fingerprint : this.capture(input.subject).fingerprint
      this.saveResult(row.id, { ...result, fingerprint: before === after ? after : null, command: input.command, unchanged: before === after })
      if (/命令超时/.test(result.stderr)) { this.finish(row.id,'needs_reconciliation','验证命令超时，已请求停止；请人工核对副作用，不自动重跑'); return }
      if (result.exitCode !== 0 || before !== after) { this.finish(row.id, 'failed', '验证失败或验证期间源内容变化，请检查输出'); return }
    } else if (row.kind === 'integrate_resolution') {
      const resolution = this.resolution(this.row(input.resolutionId!)), original = parse<Snapshot>(this.row(input.resolutionId!).snapshot_json)
      if (!resolution.reviewCurrent || !resolution.verificationCurrent || resolution.fingerprint !== snapshot.resolutionFingerprint) throw new AppError('CONFLICT', '解决结果的审查或验证已失效')
      if (original.targetRoot!==snapshot.targetRoot||original.targetBranch!==snapshot.targetBranch||original.targetHead !== snapshot.targetHead || original.sourceHead !== snapshot.sourceHead) throw new AppError('CONFLICT', '双方分支已变化，请重新解决')
      if (!original.sourceRoot) {
        const remote = this.remote(original.projectRoot, original.request.remote, original.request.branch ?? original.targetBranch)
        if (remote.urlHash !== original.remoteUrlHash || await this.remoteHead(original, row.id) !== original.sourceHead) throw new AppError('CONFLICT', '远端来源已经变化，请重新获取和解决')
      }
      this.assertSameTarget(original)
      gitText(resolution.root, 'diff', '--exit-code', '--no-ext-diff', '--no-textconv', '--')
      gitText(resolution.root, ...WRITE, 'commit', '--no-verify', '-m', `ProjectOS conflict resolution ${row.id}`)
      const resolvedCommit = gitText(resolution.root, 'rev-parse', 'HEAD')
      this.saveResult(row.id, { sourceCommit: resolvedCommit })
      this.assertSameTarget(original)
      if (snapshot.taskEvidence && hash(this.taskIntegration!.resolvedGate(snapshot.taskEvidence.taskId)) !== hash(snapshot.taskEvidence)) throw new AppError('CONFLICT','任务证据已经变化')
      gitText(root, ...WRITE, 'merge', '--ff-only', resolvedCommit)
      const resultCommit=gitText(root,'rev-parse','HEAD')
      this.saveResult(row.id, { resultCommit, reviewFingerprint: resolution.fingerprint })
      if(snapshot.taskEvidence)this.taskIntegration!.recordResolved(snapshot.taskEvidence,{id:row.id,approvalId:row.approval_id,runId:row.run_id,toolCallId:row.tool_call_id},resultCommit)
      if(input.subject.planId){
        const plan=this.store.read.getPlanRevision(input.subject.planId)!
        this.store.updatePlanRevision({...plan,execution:{...plan.execution!,mergedAt:now(),mergeCommit:resultCommit,deliveryStatus:'merged'},updatedAt:now()})
        const verification=await verifyAfterMerge({rootPath:root,commands:recordedVerificationCommands(this.store,plan),timeoutMs:120_000})
        const evidence=this.store.createArtifact(createArtifactRecord({projectId:row.project_id,kind:'test-report',title:'冲突解决合入后验证',body:JSON.stringify({operationId:row.id,resultCommit,verification}),verified:verification.passed}))
        const latest=this.store.read.getPlanRevision(plan.id)!
        this.store.updatePlanRevision({...latest,execution:{...latest.execution!,deliveryStatus:verification.passed?'verified':'merged_verification_failed',deliveryEvidenceId:evidence.id,deliveryVerifiedAt:verification.passed?now():null,deliveryError:verification.passed?null:verification.reason},updatedAt:now()})
        this.saveResult(row.id,{verification,evidenceId:evidence.id})
        if(!verification.passed){this.finish(row.id,'failed','已合入，但合入后验证失败，需要人工处理');return}
      }
    }
    this.finish(row.id, 'completed', null)
  }

  review(input: ApiParsedInput<'gitDelivery.review'>) {
    const projectReview = input.resolutionId === 'project'
    const current = projectReview ? { fingerprint: this.capture(input.subject).fingerprint } : this.resolution(this.row(input.resolutionId))
    if (current.fingerprint !== input.fingerprint) throw new AppError('CONFLICT', '审查内容已变化，请刷新')
    if (!projectReview && hash(parse<GitSubject>(this.row(input.resolutionId).subject_json))!==hash(input.subject)) throw new AppError('FORBIDDEN', '记录不属于此项目或任务')
    if (!projectReview) {
      const resolution = current as GitResolution
      if (resolution.files.some(file => file.conflict)) throw new AppError('CONFLICT', '请先验证并暂存解决内容后审查')
      if (resolution.agentRunId && !['completed', 'failed', 'cancelled', 'timed_out', 'budget_exhausted'].includes(this.store.read.getRun(resolution.agentRunId)?.status ?? '')) throw new AppError('CONFLICT', '请先等待 Agent 完成')
    }
    const key = projectReview ? `project:${input.subject.projectId}` : input.resolutionId
    const artifact = this.store.createArtifact(createArtifactRecord({ projectId: input.subject.projectId, kind: 'document', title: 'Git 内容人工审查', body: JSON.stringify({ fingerprint: current.fingerprint, note: input.note, reviewer: 'local-user', scope: key }) }))
    this.store.db.prepare('INSERT INTO git_resolution_reviews(resolution_id,fingerprint,artifact_id,note,created_at) VALUES(?,?,?,?,?) ON CONFLICT(resolution_id) DO UPDATE SET fingerprint=excluded.fingerprint,artifact_id=excluded.artifact_id,note=excluded.note,created_at=excluded.created_at')
      .run(key, current.fingerprint, artifact.id, input.note, now())
    return { ok: true as const }
  }

  async reconcile(operationId: string, note: string) {
    const row = this.row(operationId)
    if (row.status !== 'needs_reconciliation') throw new AppError('CONFLICT', '只有未知结果可以核对')
    const snapshot = parse<Snapshot>(row.snapshot_json), result = parse<{ resultCommit?: string; sourceCommit?: string }>(row.result_json)
    if (row.kind === 'push') {
      if (await this.remoteHead(snapshot, row.id) !== snapshot.targetHead) throw new AppError('CONFLICT', '远端没有该固定提交，不能宣称推送完成')
      this.saveResult(row.id, { resultCommit: snapshot.targetHead, reconciledBy: 'local-user', note })
      this.finish(row.id, 'completed', null)
    } else if (result.resultCommit && gitText(snapshot.targetRoot, 'rev-parse', 'HEAD') === result.resultCommit) {
      this.saveResult(row.id, { reconciledBy: 'local-user', note }); this.finish(row.id, 'failed', '已确认合入提交；中断后的验证未完成，需要人工验证，不自动重跑')
    } else {
      this.assertSameTarget(snapshot)
      // Proven unchanged target is recorded as failed, not silently retried. Source-side facts remain.
      this.saveResult(row.id, { reconciledBy: 'local-user', note, targetUnchanged: true })
      this.finish(row.id, 'failed', '已核对目标未合入；保留已有来源/目录事实，需要新的明确操作')
    }
    return this.view(this.row(operationId))
  }

  private finish(id: string, status: GitOperation['status'], error: string | null) {
    const row = this.row(id)
    this.store.transaction(() => {
      this.store.db.prepare('UPDATE git_delivery_operations SET status=?,error=?,updated_at=? WHERE id=?').run(status, error, now(), id)
      this.store.updateToolCall(row.tool_call_id, { status: status === 'completed' ? 'completed' : 'failed', result: { ...parse<Record<string, unknown>>(row.result_json), operationId: id, status }, error, finishedAt: now() })
      this.store.updateRun(row.run_id, { status: status === 'completed' ? 'completed' : status === 'needs_reconciliation' ? 'needs_reconciliation' : status === 'rejected' ? 'cancelled' : 'failed', error, summary: error ?? `${TITLES[row.kind]}完成`, finishedAt: now() })
      this.store.appendEvent(row.project_id, id, PROJECT_EVENT_TYPES.custom, { kind: 'git.delivery.updated', operationId: id, status, summary: error ?? TITLES[row.kind] })
    })
  }
  private expirePending() {
    for (const row of this.store.db.prepare("SELECT * FROM git_delivery_operations WHERE status='waiting_approval'").all() as unknown as Row[]) {
      const approval = this.store.getApprovalById(row.approval_id)
      if (!approval || approval.status !== 'pending' || (approval.expiresAt && approval.expiresAt <= now()) || this.store.read.getRun(row.run_id)?.status !== 'waiting_approval') {
        if (approval?.status === 'pending') this.store.expireApproval(approval.id, 'Git 审批已过期或取消')
        this.finish(row.id, 'failed', 'Git 授权已失效，请重新申请')
      }
    }
  }
}
