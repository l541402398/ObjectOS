import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { AppError, type Task } from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'
import { isProtectedPath } from '@projectos/policy'
import { isSensitiveWorktreePath } from '@projectos/worktree'
import { buildReviewSnapshot, type ReviewSnapshotFile } from '@projectos/application'

export function requirementGit(root: string, ...args: string[]): string {
  try {
    return execFileSync('git', ['--literal-pathspecs', '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', '-C', root, ...args], {
      encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    })
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr
    throw new AppError('CONFLICT', `Git 操作未完成：${String(stderr || '请检查工作区状态').trim().slice(0, 1500)}`)
  }
}

export const gitText = (root: string, ...args: string[]) => requirementGit(root, ...args).trim()
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]))
  return value
}
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
export const sameRoot = (a: string, b: string) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)
export const gitPaths = (root: string, ...args: string[]) => requirementGit(root, ...args).split('\0').filter(Boolean)

export function repositoryIdentity(root: string) {
  const [gitDir, commonDir, head, branch] = gitText(root, 'rev-parse', '--absolute-git-dir', '--path-format=absolute', '--git-common-dir', 'HEAD', '--abbrev-ref', 'HEAD').split(/\r?\n/)
  if (!gitDir || !commonDir || !head || !branch) throw new AppError('CONFLICT', '无法完整读取仓库与分支')
  return { gitDir, commonDir, head, branch }
}

export function assertIdleGit(root: string, gitDir = repositoryIdentity(root).gitDir) {
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG', 'index.lock']) {
    if (existsSync(join(gitDir, marker))) throw new AppError('CONFLICT', '工作区有未结束的 Git 操作，请先人工处理')
  }
}

/** One complete capture. Git supplies paths/identity; Runtime hashes real bytes once. */
export function taskContent(root: string, baseCommit: string, task: Task) {
  const identity = repositoryIdentity(root)
  assertIdleGit(root, identity.gitDir)
  const entries = gitPaths(root, 'ls-files', '--cached', '--others', '--exclude-standard', '--stage', '-z')
  const modes = new Map<string, string>(), untracked = new Set<string>()
  for (const entry of entries) {
    const parsed = /^(\d{6}) [a-f0-9]+ (\d)\t([\s\S]+)$/.exec(entry)
    if (parsed) {
      if (parsed[2] !== '0' || ['120000', '160000'].includes(parsed[1]!)) throw new AppError('CONFLICT', '任务包含冲突、符号链接或子模块，请先人工处理')
      modes.set(parsed[3]!, parsed[1]!)
    } else untracked.add(entry)
  }
  assertSafeGitAttributes(root, [...modes.keys(), ...untracked])
  const changed = gitPaths(root, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', baseCommit, '--')
  const files = [...new Set([...changed, ...untracked])].sort()
  const paths = [...new Set([...modes.keys(), ...files])].sort()
  if (paths.length > 10_000) throw new AppError('CONFLICT', '工作区超过当前完整审查的 10,000 文件上限，请缩小任务范围')
  for (const path of files) {
    if (isSensitiveWorktreePath(path) || isProtectedPath(path)) throw new AppError('POLICY_DENIED', `改动包含受保护或生成文件，不能自动集成：${path}`)
  }
  let totalBytes = 0
  const snapshotFiles: ReviewSnapshotFile[] = paths.map(path => {
    if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw new AppError('CONFLICT', '文件路径超出任务工作区')
    const absolute = resolve(root, path), fileState = untracked.has(path) ? 'untracked' as const : 'tracked' as const
    const file = { path, state: fileState, required: true }
    // Inspect each segment before reading: a parent directory junction must not be followed.
    let current = root
    for (const part of relative(root, absolute).split(sep)) {
      current = join(current, part)
      if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new AppError('CONFLICT', `文件路径包含链接：${path}`)
    }
    if (!existsSync(absolute)) {
      if (untracked.has(path)) throw new AppError('CONFLICT', '读取期间文件已消失，请刷新')
      return { ...file, sha256: null, presence: 'deleted', size: null }
    }
    const stat = lstatSync(absolute), rel = relative(realpathSync.native(root), realpathSync.native(absolute))
    if (!stat.isFile() || rel.startsWith('..') || isAbsolute(rel)) throw new AppError('CONFLICT', `不能完整读取任务文件：${path}`)
    totalBytes += stat.size
    if (stat.size > 64 * 1024 * 1024 || totalBytes > 256 * 1024 * 1024) throw new AppError('CONFLICT', '任务内容超过完整审查大小上限，请先缩小范围')
    return { ...file, sha256: createHash('sha256').update(readFileSync(absolute)).digest('hex'), presence: 'present', size: stat.size }
  })
  const snapshot = buildReviewSnapshot({ projectId: task.projectId, taskId: task.id,
    worktree: { root, head: identity.head, branch: identity.branch, isWorktree: !sameRoot(identity.gitDir, identity.commonDir) },
    baselineCommit: identity.head, scope: { roots: [], reviewedObjects: paths, expanded: false }, files: snapshotFiles })
  const fingerprint = hash({ files: snapshotFiles.map(f => [f.path, f.sha256]), modes: paths.map(path => [path, modes.get(path) ?? '100644']) })
  const statuses = new Map(snapshotFiles.map(file => [file.path, file.presence === 'deleted' ? '删除' : untracked.has(file.path) ? '新增' : '修改']))
  return { snapshot, fingerprint, files: files.map(path => ({ path, status: statuses.get(path) ?? '修改' })), paths }
}

export function assertSafeGitAttributes(root: string, paths: string[]) {
  if (!paths.length) return
  const attributes = execFileSync('git', ['-C', root, 'check-attr', '-z', '--stdin', 'filter', 'merge'], {
    encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 8 * 1024 * 1024,
    input: paths.join('\0') + '\0', stdio: ['pipe', 'pipe', 'pipe'],
  }).split('\0')
  for (let index = 0; index + 2 < attributes.length; index += 3) {
    const [path, attribute, value] = attributes.slice(index, index + 3)
    const allowed = attribute === 'filter' ? ['unspecified', 'unset'] : ['unspecified', 'unset', 'set', 'text', 'binary', 'union']
    if (!allowed.includes(value!)) throw new AppError('CONFLICT', `文件启用了自定义 Git 过滤器或合并驱动，请先人工处理集成：${path}`)
  }
}

export function integrationRoot(store: SqliteStore, task: Task) {
  const row = store.db.prepare("SELECT root_path,branch FROM requirement_workspaces WHERE requirement_id=? AND kind='integration'").get(task.requirementId!)
  if (!row || !existsSync(String(row.root_path))) throw new AppError('CONFLICT', '需求集成工作区缺失，请先核对')
  const root = String(row.root_path), project = store.read.getProject(task.projectId)!
  const identity = repositoryIdentity(root), projectIdentity = repositoryIdentity(project.rootPath)
  if (!sameRoot(root, realpathSync.native(root)) || identity.branch !== row.branch || !sameRoot(identity.commonDir, projectIdentity.commonDir))
    throw new AppError('CONFLICT', '需求集成工作区归属、目录或分支已改变')
  assertIdleGit(root, identity.gitDir)
  return { root, branch: String(row.branch), head: identity.head }
}

/** A cancelled Run cannot release a workspace while its approved operation still has unknown effects. */
export function assertNoTaskIntegrationOperation(store: SqliteStore, task: Task): void {
  if (!task.requirementId) return
  const active = store.db.prepare("SELECT id FROM task_integration_operations WHERE task_id=? AND status IN ('waiting_approval','executing','needs_reconciliation')").get(task.id)
  if (active) throw new AppError('CONFLICT', '此任务仍有成果审批、执行或待核对操作，请先在成果审查中处理')
}

/** Accepted predecessor output must be an ancestor of the exact workspace being prepared/run. */
export function assertIntegratedDependencies(store: SqliteStore, task: Task, baselineRoot: string): Array<{ taskId: string; commit: string; version: number }> {
  if (!task.requirementId) return []
  return store.read.getTaskCard(task.id)!.dependencyIds.slice().sort().map(id => {
    const dependency = store.read.getTask(id)
    if (!dependency || dependency.requirementId !== task.requirementId) throw new AppError('CONFLICT', '前置依赖必须属于同一需求；跨需求成果请先经过单独交付')
    const row = store.db.prepare("SELECT snapshot_json,result_commit FROM task_integration_operations WHERE task_id=? AND kind='integrate' AND status='completed' ORDER BY created_at DESC,id DESC LIMIT 1").get(id)
    if (dependency.status !== 'done' || !row || !row.result_commit) throw new AppError('CONFLICT', `前置依赖「${dependency.title}」尚未验收并合入需求分支`)
    const snapshot = JSON.parse(String(row.snapshot_json)) as { taskVersion: number }
    if (snapshot.taskVersion !== dependency.version) throw new AppError('CONFLICT', `前置依赖「${dependency.title}」已变化，需要重新审查和合入`)
    try { requirementGit(baselineRoot, 'merge-base', '--is-ancestor', String(row.result_commit), 'HEAD') }
    catch { throw new AppError('CONFLICT', `工作区基线尚未包含前置依赖「${dependency.title}」的成果；已有工作区需先人工同步后重新验证`) }
    return { taskId: id, commit: String(row.result_commit), version: dependency.version }
  })
}

export function integrationDiff(root: string, base: string, files: Array<{ path: string }>): { diff: string; diffTruncated: boolean } {
  let diff = requirementGit(root, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=3', base, '--')
  const untracked = new Set(gitPaths(root, 'ls-files', '--others', '--exclude-standard', '-z'))
  for (const file of files) {
    if (!untracked.has(file.path)) continue
    const bytes = readFileSync(join(root, file.path))
    diff += `\n新增文件：${file.path}\n${bytes.includes(0) ? '二进制文件；请在任务工作区检查内容' : bytes.toString('utf8').slice(0, 80_001)}\n`
  }
  return { diff: diff.slice(0, 80_000), diffTruncated: diff.length > 80_000 }
}
