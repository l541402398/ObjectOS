import crossSpawn from 'cross-spawn'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

export interface WorktreeRef {
  path: string
  branch: string
  baseHead: string | null
}

export interface WorktreeChangedFile {
  path: string
  status: string
  sensitive: boolean
  allowed: boolean
}

const SENSITIVE_NAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.npmrc',
  '.netrc',
  'id_rsa',
  'id_ed25519',
  'ai-secrets.vault.json',
])

const SENSITIVE_PATTERNS = [
  /(^|\/)\.env\./i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.vault\.json$/i,
  /(^|\/)\.ssh\//i,
  /(^|\/)\.aws\//i,
  /(^|\/)secrets?\./i,
]

const GENERATED_PREFIXES = ['node_modules/', '.git/', 'dist/', 'out/', 'release/']

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

export function isSensitiveWorktreePath(path: string): boolean {
  const normalized = normalizePath(path)
  const lower = normalized.toLowerCase()
  if (SENSITIVE_NAMES.has(basename(lower))) return true
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized))) return true
  return GENERATED_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

function isAllowedPath(path: string, allowedPaths: string[]): boolean {
  const normalized = normalizePath(path)
  const allowed = allowedPaths.map(normalizePath).filter(Boolean)
  if (allowed.length === 0 || allowed.includes('.') || allowed.includes('')) return true
  return allowed.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`))
}

function parsePorcelain(output: string): Array<{ path: string; status: string }> {
  const files: Array<{ path: string; status: string }> = []
  for (const raw of output.split('\0')) {
    if (!raw) continue
    const status = raw.slice(0, 2)
    const path = raw.slice(3)
    if (path) files.push({ path: normalizePath(path), status })
  }
  return files
}

function runGit(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = crossSpawn('git', ['--literal-pathspecs', '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', ...args], { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: error.message }))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

const WRITE_CONFIG = ['-c', 'core.hooksPath=.git', '-c', 'commit.gpgSign=false', '-c', 'merge.gpgSign=false', '-c', 'user.name=ProjectOS', '-c', 'user.email=projectos@local']
function samePath(a: string, b: string) {
  const canonical = (path: string) => existsSync(path) ? realpathSync.native(path) : resolve(path)
  return process.platform === 'win32' ? canonical(a).toLowerCase() === canonical(b).toLowerCase() : canonical(a) === canonical(b)
}

async function gitIdentity(root: string) {
  const result = await runGit(['rev-parse', '--show-toplevel', '--path-format=absolute', '--git-common-dir', '--absolute-git-dir', 'HEAD', '--abbrev-ref', 'HEAD'], root)
  const [top, common, gitDir, head, branch] = result.stdout.trim().split(/\r?\n/)
  if (result.code !== 0 || !top || !common || !gitDir || !head || !branch || !samePath(top, root) || lstatSync(root).isSymbolicLink()) {
    throw new Error('工作区根目录或仓库身份不匹配，请人工核对')
  }
  return { top, common, gitDir, head, branch }
}

function assertIdleGit(gitDir: string) {
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG', 'index.lock']) {
    if (existsSync(`${gitDir}/${marker}`)) throw new Error('工作区有未结束的 Git 操作，请先人工处理')
  }
}

async function assertPlainGitAttributes(root: string, paths: string[]) {
  if (!paths.length) return
  const result = await runGit(['check-attr', '-z', 'filter', 'merge', '--', ...paths], root)
  if (result.code !== 0) throw new Error('无法核对 Git 过滤器和合并驱动，请人工处理')
  const values = result.stdout.split('\0')
  for (let i = 0; i + 2 < values.length; i += 3) {
    const allowed = values[i + 1] === 'filter' ? ['unspecified', 'unset'] : ['unspecified', 'unset', 'set', 'text', 'binary']
    if (!allowed.includes(values[i + 2]!)) throw new Error(`文件启用了自定义过滤器或自动合并驱动，请人工处理：${values[i]}`)
  }
}

/**
 * ADR-0050 — a repository without any commit cannot host a worktree.
 *
 * Real failure: `git worktree add -b <branch> <path> HEAD` fails on an unborn HEAD, and the old
 * fallback then ran `git worktree add <path> <branch>` with a branch that was never created, so the
 * user saw `fatal: invalid reference: projectos/plan-…` — a git internal that names neither the cause
 * nor the fix.
 */
export class WorktreeBaseMissingError extends Error {
  constructor(readonly repoRoot: string) {
    super(
      `项目仓库还没有任何提交，无法创建隔离 Worktree。请在 ${repoRoot} 完成一次 git commit，或让 ProjectOS 自动建立基线提交（基线提交只包含当前目录内容）。`,
    )
    this.name = 'WorktreeBaseMissingError'
  }
}

/** The commit id a repository's worktrees can start from, or null when HEAD is unborn. */
export async function resolveBaseCommit(repoRoot: string): Promise<string | null> {
  const head = await runGit(['rev-parse', '--verify', 'HEAD'], repoRoot)
  return head.code === 0 ? head.stdout.trim() || null : null
}

/**
 * Create the first commit of a repository that has none, so isolated worktrees become possible.
 *
 * Returns the new commit id, or null when the repository already had a commit (no-op). The commit is
 * only created for an unborn HEAD; existing history is never rewritten.
 */
export async function ensureBaselineCommit(
  repoRoot: string,
  options: { message?: string; authorName?: string; authorEmail?: string } = {},
): Promise<{ commit: string; files: number } | null> {
  if (!existsSync(`${repoRoot}/.git`)) {
    const init = await runGit(['init', '-q'], repoRoot)
    if (init.code !== 0) throw new Error(init.stderr.trim() || '无法初始化 Git 仓库')
  }
  const existing = await resolveBaseCommit(repoRoot)
  if (existing) return null
  const status = await runGit(['status', '--porcelain=v1', '-uall'], repoRoot)
  if (status.code !== 0) throw new Error(status.stderr.trim() || '无法读取仓库状态')
  const files = status.stdout.split(/\r?\n/).filter((line) => line.trim()).length
  if (files > 0) {
    const add = await runGit(['add', '-A'], repoRoot)
    if (add.code !== 0) throw new Error(add.stderr.trim() || '无法暂存初始文件')
  }
  const args = [
    '-c',
    `user.name=${options.authorName ?? 'ProjectOS'}`,
    '-c',
    `user.email=${options.authorEmail ?? 'projectos@local'}`,
    'commit',
    '--no-verify',
    '-m',
    options.message ?? 'chore: initial commit (ProjectOS baseline)',
  ]
  if (files === 0) args.splice(args.length - 2, 0, '--allow-empty')
  const commit = await runGit(args, repoRoot)
  if (commit.code !== 0) throw new Error(commit.stderr.trim() || '无法创建基线提交')
  const head = await runGit(['rev-parse', 'HEAD'], repoRoot)
  return { commit: head.stdout.trim(), files }
}

export interface IsolatedWorktreeInput {
  /** The main working tree of the project (never auto-allowed). */
  projectRoot: string
  /** The directory a Run is about to write into or execute in. */
  workspaceRoot: string
  /** The worktree ObjectOS registered for this plan (persisted `plan.execution.workspaceRef`). */
  registeredPath: string | null | undefined
  /** The branch ObjectOS created for it (persisted `plan.execution.branch`). */
  expectedBranch?: string | null
}

export interface IsolatedWorktreeCheck {
  name: 'exists' | 'not-symlink' | 'registered' | 'not-main-root' | 'git-toplevel' | 'linked-git-dir' | 'same-repository' | 'listed' | 'branch'
  ok: boolean
  detail: string
}

export interface IsolatedWorktreeResult {
  ok: boolean
  reason: string
  checks: IsolatedWorktreeCheck[]
}

function realOrNull(path: string): string | null {
  try {
    return realpathSync.native(resolve(path))
  } catch {
    return null
  }
}

function sameReal(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function gitSync(args: string[], cwd: string): { code: number; stdout: string } {
  const result = crossSpawn.sync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, windowsHide: true, encoding: 'utf8', timeout: 5000 })
  return { code: typeof result.status === 'number' ? result.status : -1, stdout: typeof result.stdout === 'string' ? result.stdout : '' }
}

/**
 * ADR-0089 — prove that a workspace is an isolated, ObjectOS-registered linked worktree of this
 * project before anything is auto-allowed in it. Every check must pass; the first failure is the
 * reason, and the caller falls back to per-call human approval. Synchronous on purpose: the tool
 * policy path is synchronous and must not race a concurrent `git worktree remove`.
 */
export function verifyIsolatedWorktree(input: IsolatedWorktreeInput): IsolatedWorktreeResult {
  const checks: IsolatedWorktreeCheck[] = []
  const fail = (name: IsolatedWorktreeCheck['name'], detail: string): IsolatedWorktreeResult => {
    checks.push({ name, ok: false, detail })
    return { ok: false, reason: detail, checks }
  }
  const pass = (name: IsolatedWorktreeCheck['name'], detail: string) => checks.push({ name, ok: true, detail })

  const workspaceAbs = resolve(input.workspaceRoot)
  const workspaceReal = realOrNull(workspaceAbs)
  const projectReal = realOrNull(input.projectRoot)
  if (!workspaceReal || !projectReal) return fail('exists', '工作区或项目根目录不存在')
  pass('exists', workspaceReal)

  try {
    if (lstatSync(workspaceAbs).isSymbolicLink()) return fail('not-symlink', '工作区本身是符号链接，可能逃逸到主工作区')
  } catch {
    return fail('not-symlink', '无法读取工作区属性')
  }
  pass('not-symlink', '工作区不是符号链接')

  if (sameReal(workspaceReal, projectReal)) return fail('not-main-root', '工作区就是项目主工作区，不能自动放行')
  pass('not-main-root', '与主工作区不同')

  const registeredReal = input.registeredPath ? realOrNull(input.registeredPath) : null
  if (!registeredReal) return fail('registered', '该计划没有 ObjectOS 登记的隔离工作区')
  if (!sameReal(registeredReal, workspaceReal)) return fail('registered', '工作区与该计划登记的 Worktree 不一致')
  pass('registered', registeredReal)

  const identity = gitSync(['rev-parse', '--path-format=absolute', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'], workspaceReal)
  const [top, gitDir, commonDir] = identity.stdout.trim().split(/\r?\n/)
  if (identity.code !== 0 || !top || !gitDir || !commonDir) return fail('git-toplevel', '工作区不是可读取的 Git 工作树')
  if (!sameReal(realOrNull(top), workspaceReal)) return fail('git-toplevel', '工作区不是 Git 工作树的根目录')
  pass('git-toplevel', top)

  const gitDirReal = realOrNull(gitDir)
  const commonReal = realOrNull(commonDir)
  if (!gitDirReal || !commonReal || sameReal(gitDirReal, commonReal)) {
    return fail('linked-git-dir', 'git-dir 与 common-dir 相同：这是主工作树，不是隔离 Worktree')
  }
  pass('linked-git-dir', gitDirReal)

  const parent = gitSync(['rev-parse', '--path-format=absolute', '--git-common-dir'], projectReal)
  if (parent.code !== 0 || !sameReal(realOrNull(parent.stdout.trim()), commonReal)) {
    return fail('same-repository', '工作区不属于该项目的 Git 仓库')
  }
  pass('same-repository', commonReal)

  const listed = gitSync(['worktree', 'list', '--porcelain'], projectReal)
  if (listed.code !== 0) return fail('listed', '无法读取 git worktree list')
  let entryBranch: string | null = null
  let found = false
  let currentPath: string | null = null
  let currentBranch: string | null = null
  const flush = () => {
    if (currentPath && sameReal(realOrNull(currentPath), workspaceReal)) {
      found = true
      entryBranch = currentBranch
    }
  }
  for (const line of listed.stdout.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      flush()
      currentPath = line.slice('worktree '.length)
      currentBranch = null
    } else if (line.startsWith('branch ')) {
      currentBranch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    }
  }
  flush()
  if (!found) return fail('listed', '工作区不在 git worktree list 中')
  pass('listed', '已登记在 git worktree list')

  if (input.expectedBranch) {
    if (entryBranch !== input.expectedBranch) return fail('branch', `Worktree 分支不是计划分支 ${input.expectedBranch}`)
    pass('branch', input.expectedBranch)
  }
  return { ok: true, reason: '已验证为该计划登记的隔离 Git Worktree', checks }
}

export class WorktreeManager {
  async create(repoRoot: string, worktreePath: string, branch: string, baseCommit?: string): Promise<WorktreeRef> {
    if (!existsSync(`${repoRoot}/.git`)) {
      throw new Error('项目不是 Git 仓库，无法创建工作树')
    }
    // A pinned creation is a one-shot approved operation, never an adoption/retry.
    if (baseCommit) {
      if (!/^[a-f0-9]{40,64}$/i.test(baseCommit)) throw new Error('工作区必须使用明确的提交版本')
      if (existsSync(worktreePath)) throw new Error('目标工作区已存在，请先人工核对')
      const branchExists = await runGit(['rev-parse', '--verify', `refs/heads/${branch}`], repoRoot)
      if (branchExists.code === 0) throw new Error('目标分支已存在，请先人工核对')
      mkdirSync(dirname(worktreePath), { recursive: true })
      const created = await runGit(['worktree', 'add', '-b', branch, worktreePath, baseCommit], repoRoot)
      if (created.code !== 0) throw new Error(created.stderr.trim() || '工作区创建结果不确定，请人工核对')
      return { path: worktreePath, branch, baseHead: await this.head(worktreePath) }
    }
    const reuse = async (): Promise<WorktreeRef | null> => {
      if (!existsSync(worktreePath)) return null
      const head = await this.head(worktreePath)
      const parent = await gitIdentity(repoRoot)
      const identity = await gitIdentity(worktreePath)
      const registered = (await this.list(repoRoot)).some(entry => samePath(entry.path, worktreePath) && entry.branch === branch)
      if (!head || !registered || !samePath(parent.common, identity.common) || identity.branch !== branch || samePath(identity.gitDir, identity.common)) {
        throw new Error('已有目录不属于此项目的指定 Worktree 分支，请人工核对')
      }
      return { path: worktreePath, branch, baseHead: head }
    }
    const existing = await reuse()
    if (existing) return existing
    mkdirSync(dirname(worktreePath), { recursive: true })
    if (!(await resolveBaseCommit(repoRoot))) throw new WorktreeBaseMissingError(repoRoot)
    let result = await runGit(['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], repoRoot)
    if (result.code !== 0) {
      // Only adopt an *existing* branch; passing a name that was never created is what produced
      // "invalid reference: projectos/plan-…" and hid the real cause.
      const branchExists = await runGit(['rev-parse', '--verify', `refs/heads/${branch}`], repoRoot)
      if (branchExists.code === 0) {
        result = await runGit(['worktree', 'add', worktreePath, branch], repoRoot)
      }
    }
    if (result.code === 0) return { path: worktreePath, branch, baseHead: await this.head(worktreePath) }
    // Two plan starts (or a restart racing a tick) can both reach `worktree add`.
    // The loser sees "already exists"; adopt the winner's worktree instead of failing
    // the whole plan, but only when it really is a checked-out worktree.
    const adopted = await reuse()
    if (adopted) return adopted
    await runGit(['worktree', 'prune'], repoRoot)
    throw new Error(result.stderr.trim() || 'git worktree add 失败')
  }

  async head(worktreePath: string): Promise<string | null> {
    const result = await runGit(['rev-parse', 'HEAD'], worktreePath)
    return result.code === 0 ? result.stdout.trim() : null
  }

  async changedFiles(worktreePath: string, allowedPaths: string[] = ['.']): Promise<WorktreeChangedFile[]> {
    const status = await runGit(['status', '--porcelain=v1', '--no-renames', '-z', '-uall'], worktreePath)
    if (status.code !== 0) throw new Error(status.stderr.trim() || '无法读取 Worktree 状态')
    return parsePorcelain(status.stdout).map((entry) => ({
      ...entry,
      sensitive: isSensitiveWorktreePath(entry.path),
      allowed: isAllowedPath(entry.path, allowedPaths),
    }))
  }

  async diff(worktreePath: string): Promise<string> {
    // Never stage or mutate the index from a read path. Tracked changes come
    // from `git diff HEAD`; untracked files are appended as bounded text so a
    // reviewer can see legitimate new files without `git add -N .`.
    const status = await runGit(['status', '--porcelain=v1', '--no-renames', '-z', '-uall'], worktreePath)
    const diff = await runGit(['diff', 'HEAD', '--no-ext-diff', '--unified=3'], worktreePath)
    const untracked = parsePorcelain(status.stdout).filter((entry) => entry.status === '??')
    const untrackedParts: string[] = []
    for (const entry of untracked) {
      const absolute = `${worktreePath}/${entry.path}`
      try {
        if (!existsSync(absolute) || statSync(absolute).size > 200_000) continue
        const content = readFileSync(absolute, 'utf8')
        if (content.includes('\u0000')) continue
        untrackedParts.push(`# untracked file: ${entry.path}\n${content.slice(0, 40_000)}`)
      } catch {
        // A file can disappear between status and read; omit it deterministically.
      }
    }
    const parts = [`# git status\n${status.stdout.replace(/\0/g, '\n').trim()}`, '# git diff', diff.stdout.trim()]
    if (untrackedParts.length) parts.push('# untracked files', ...untrackedParts)
    return parts.join('\n\n').slice(0, 120_000)
  }

  async merge(
    repoRoot: string,
    branch: string,
    message: string,
    authorizedPaths: string[] = ['.'],
  ): Promise<{ ok: boolean; message: string; files?: WorktreeChangedFile[] }> {
    const targetIdentity = await gitIdentity(repoRoot)
    assertIdleGit(targetIdentity.gitDir)
    if (targetIdentity.branch === 'HEAD') return { ok: false, message: '目标处于游离提交，请先人工选择目标分支' }
    const clean = await runGit(['status', '--porcelain=v1'], repoRoot)
    if (clean.code !== 0) return { ok: false, message: clean.stderr.trim() || '无法读取主工作区状态' }
    if (clean.stdout.trim()) return { ok: false, message: '主工作区存在未提交改动，拒绝合并' }

    const worktree = (await this.list(repoRoot)).find((entry) => entry.branch === branch)
    if (!worktree) return { ok: false, message: '任务分支的 Worktree 不可用，请人工核对' }
    const sourceIdentity = await gitIdentity(worktree.path)
    assertIdleGit(sourceIdentity.gitDir)
    if (sourceIdentity.branch !== branch || !samePath(sourceIdentity.common, targetIdentity.common) || samePath(sourceIdentity.top, targetIdentity.top)) {
      return { ok: false, message: '任务工作区归属或分支已改变，请人工核对' }
    }
    // Pending status alone misses changes that an agent has already committed.
    const committed = await runGit(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', `${targetIdentity.head}...${sourceIdentity.head}`, '--'], repoRoot)
    if (committed.code !== 0) return { ok: false, message: '无法核对任务分支的完整提交范围，请人工处理' }
    const committedFiles = committed.stdout.split('\0').filter(Boolean).map(path => ({ path, status: 'committed', sensitive: isSensitiveWorktreePath(path), allowed: isAllowedPath(path, authorizedPaths) }))
    const blockedCommits = committedFiles.filter(file => file.sensitive || !file.allowed)
    if (blockedCommits.length) return { ok: false, message: `任务分支已提交敏感或未授权文件，拒绝合并：\n${blockedCommits.map(file => file.path).join('\n')}`, files: committedFiles }
    if (worktree) {
      const files = await this.changedFiles(worktree.path, authorizedPaths)
      const blocked = files.filter((file) => file.sensitive || !file.allowed)
      if (blocked.length) {
        return {
          ok: false,
          message: `Worktree 包含敏感或未授权文件，已拒绝自动提交/合并：\n${blocked
            .map((file) => `${file.sensitive ? '敏感' : '未授权'} ${file.path}`)
            .join('\n')}`,
          files,
        }
      }
      const paths = [...new Set([...committedFiles, ...files].map(file => file.path))]
      await assertPlainGitAttributes(worktree.path, paths)
      await assertPlainGitAttributes(repoRoot, paths)
      if (files.length) {
        const add = await runGit(['add', '--', ...files.map((file) => file.path)], worktree.path)
        if (add.code !== 0) return { ok: false, message: add.stderr.trim() || 'Worktree 暂存失败', files }
        const commit = await runGit(
          [...WRITE_CONFIG, 'commit', '--no-verify', '-m', message],
          worktree.path,
        )
        if (commit.code !== 0) {
          return { ok: false, message: (commit.stderr || commit.stdout).trim() || 'Worktree 提交失败', files }
        }
      }
    }

    const sourceHead = await this.head(worktree.path)
    if (!sourceHead) return { ok: false, message: '无法读取任务提交，请人工核对' }
    const finalDiff = await runGit(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', `${targetIdentity.head}...${sourceHead}`, '--'], repoRoot)
    if (finalDiff.code !== 0 || finalDiff.stdout.split('\0').filter(Boolean).some(path => isSensitiveWorktreePath(path) || !isAllowedPath(path, authorizedPaths))) {
      return { ok: false, message: '任务最终提交包含敏感或未授权文件，停止合并并请人工核对' }
    }
    const preview = await runGit(['merge-tree', '--write-tree', targetIdentity.head, sourceHead], repoRoot)
    if (preview.code !== 0) return { ok: false, message: `合并预检未通过，请人工解决冲突后重新审查和验证：\n${(preview.stdout + preview.stderr).slice(0, 3500)}` }
    const currentTarget = await gitIdentity(repoRoot)
    const currentSource = await gitIdentity(worktree.path)
    const targetStatus = await runGit(['status', '--porcelain=v1', '-uall'], repoRoot)
    const sourceStatus = await runGit(['status', '--porcelain=v1', '-uall'], worktree.path)
    assertIdleGit(currentTarget.gitDir)
    assertIdleGit(currentSource.gitDir)
    if (currentTarget.head !== targetIdentity.head || currentTarget.branch !== targetIdentity.branch || currentSource.head !== sourceHead || currentSource.branch !== branch || targetStatus.code !== 0 || sourceStatus.code !== 0 || targetStatus.stdout || sourceStatus.stdout) {
      return { ok: false, message: '合并前工作区或分支发生变化，请重新审查和验证' }
    }
    const result = await runGit(
      [...WRITE_CONFIG, 'merge', '--no-ff', '--no-edit', sourceHead, '-m', message],
      repoRoot,
    )
    if (result.code === 0) {
      return { ok: true, message: result.stdout.trim().slice(0, 4000), files: worktree ? await this.changedFiles(worktree.path, authorizedPaths) : [] }
    }
    // Never leave the main workspace in a half-merged state; restore it and report the conflict.
    const conflicts = await runGit(['diff', '--name-only', '--diff-filter=U'], repoRoot)
    if (!existsSync(`${targetIdentity.gitDir}/MERGE_HEAD`) || await this.head(repoRoot) !== targetIdentity.head) {
      return { ok: false, message: '合并结果未知，请人工核对；系统未尝试清理或重试' }
    }
    const aborted = await runGit([...WRITE_CONFIG, 'merge', '--abort'], repoRoot)
    const restored = await runGit(['status', '--porcelain=v1', '-uall'], repoRoot)
    if (aborted.code !== 0 || restored.code !== 0 || restored.stdout || await this.head(repoRoot) !== targetIdentity.head) {
      return { ok: false, message: '无法证明合并前状态已恢复，请人工核对；系统不会自动重试' }
    }
    const files = conflicts.stdout.trim()
    return {
      ok: false,
      message: (files ? `合并冲突，已中止合并：\n${files}` : (result.stderr || result.stdout).trim()).slice(0, 4000),
    }
  }

  async remove(repoRoot: string, worktreePath: string): Promise<void> {
    await runGit(['worktree', 'remove', '--force', worktreePath], repoRoot)
  }

  async list(repoRoot: string): Promise<Array<{ path: string; branch: string }>> {
    const result = await runGit(['worktree', 'list', '--porcelain'], repoRoot)
    if (result.code !== 0) return []
    const entries: Array<{ path: string; branch: string }> = []
    let current: { path: string; branch: string } | null = null
    for (const line of result.stdout.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        if (current) entries.push(current)
        current = { path: line.slice('worktree '.length), branch: '' }
      } else if (line.startsWith('branch ') && current) {
        current.branch = line.slice('branch '.length).replace('refs/heads/', '')
      }
    }
    if (current) entries.push(current)
    return entries
  }
}
