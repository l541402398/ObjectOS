import crossSpawn from 'cross-spawn'
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export interface WorktreeRef {
  path: string
  branch: string
  baseHead: string | null
}

export interface IsolationCheckInput {
  /** Candidate workspace path (agent cwd / run workspaceRoot). */
  candidatePath: string
  /** Project main working tree rootPath. */
  projectRootPath: string
  /**
   * Extra registered paths for this plan/run (e.g. plan.execution.workspaceRef).
   * Combined with the process-local ObjectOS worktree registry.
   */
  registeredPaths?: readonly string[]
}

export interface IsolationCheckResult {
  ok: boolean
  reason: string
  details?: {
    candidateReal?: string
    projectReal?: string
    gitDir?: string
    gitCommonDir?: string
    listed?: boolean
    registered?: boolean
  }
}

/** Process-local registry of worktrees ObjectOS created for a project root. */
const registeredByProject = new Map<string, Set<string>>()

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

function tryRealpath(value: string): string | null {
  try {
    if (!existsSync(value)) return null
    return normalizePath(realpathSync(value))
  } catch {
    return null
  }
}

function registryKey(projectRootPath: string): string {
  return tryRealpath(projectRootPath) ?? normalizePath(resolve(projectRootPath))
}

export function registerWorktree(projectRootPath: string, worktreePath: string): void {
  const key = registryKey(projectRootPath)
  const set = registeredByProject.get(key) ?? new Set<string>()
  const real = tryRealpath(worktreePath) ?? normalizePath(resolve(worktreePath))
  set.add(real)
  set.add(normalizePath(resolve(worktreePath)))
  registeredByProject.set(key, set)
}

export function unregisterWorktree(projectRootPath: string, worktreePath: string): void {
  const key = registryKey(projectRootPath)
  const set = registeredByProject.get(key)
  if (!set) return
  const real = tryRealpath(worktreePath) ?? normalizePath(resolve(worktreePath))
  set.delete(real)
  set.delete(normalizePath(resolve(worktreePath)))
  if (set.size === 0) registeredByProject.delete(key)
}

export function listRegisteredWorktrees(projectRootPath: string): string[] {
  const key = registryKey(projectRootPath)
  return [...(registeredByProject.get(key) ?? [])]
}

/** Test helper: clear the in-process registry. */
export function clearWorktreeRegistry(): void {
  registeredByProject.clear()
}

function runGit(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = crossSpawn('git', args, { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => resolvePromise({ code: -1, stdout, stderr: error.message }))
    child.on('close', (code) => resolvePromise({ code: code ?? -1, stdout, stderr }))
  })
}

function parsePorcelainWorktrees(stdout: string): Array<{ path: string; branch: string }> {
  const entries: Array<{ path: string; branch: string }> = []
  let current: { path: string; branch: string } | null = null
  for (const line of stdout.split(/\r?\n/)) {
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


/** ObjectOS-managed worktree path conventions (survives process restart). */
export function isObjectOsWorktreePath(candidateReal: string, projectReal: string): boolean {
  const path = normalizePath(candidateReal)
  const project = normalizePath(projectReal)
  // runtime-run: <project>/.projectos/runtime-worktrees/<runId>
  if (path.startsWith(project + '/.projectos/runtime-worktrees/')) {
    const rest = path.slice((project + '/.projectos/runtime-worktrees/').length)
    return Boolean(rest) && !rest.includes('..') && !rest.includes('/')
  }
  // orchestrator: <dataDir>/worktrees/<projectId>/<planId> — accept */worktrees/*/* outside project root
  if (!path.startsWith(project + '/') && /\/worktrees\/[^/]+\/[^/]+$/.test(path)) {
    return true
  }
  return false
}

/**
 * Verify that candidatePath is a genuine isolated git worktree of the project,
 * registered by ObjectOS, with no symlink escape into the main root.
 * Any check failure → ok:false (caller must fall back to require_approval).
 */
export async function verifyIsolatedWorktree(input: IsolationCheckInput): Promise<IsolationCheckResult> {
  const { candidatePath, projectRootPath } = input
  if (!candidatePath || !projectRootPath) {
    return { ok: false, reason: '缺少候选路径或项目根路径' }
  }

  const projectReal = tryRealpath(projectRootPath)
  if (!projectReal) {
    return { ok: false, reason: '无法解析项目根路径（realpath）' }
  }

  let candidateStat
  try {
    candidateStat = lstatSync(candidatePath)
  } catch {
    return { ok: false, reason: '候选工作区不存在' }
  }

  // Reject if the path itself is a symlink that resolves into the main project root
  // without being a listed worktree (checked below after realpath).
  const candidateReal = tryRealpath(candidatePath)
  if (!candidateReal) {
    return { ok: false, reason: '无法解析候选工作区（realpath）' }
  }

  if (candidateReal === projectReal) {
    return {
      ok: false,
      reason: '候选路径解析后等于主工作区根路径（拒绝自动放行）',
      details: { candidateReal, projectReal },
    }
  }

  // Symlink that escapes into main tree (e.g. symlink pointing at project root or inside it
  // while claiming to be a separate workspace) — only allowed if still a distinct worktree path
  // listed by git. A symlink whose realpath equals project root was already rejected above.
  if (candidateStat.isSymbolicLink() && (candidateReal === projectReal || candidateReal.startsWith(projectReal + '/'))) {
    // Symlink into main repo content is never an isolated worktree cwd.
    return {
      ok: false,
      reason: '候选路径是指向主仓库的符号链接（拒绝自动放行）',
      details: { candidateReal, projectReal },
    }
  }

  const gitDirResult = await runGit(['rev-parse', '--git-dir'], candidatePath)
  const commonDirResult = await runGit(['rev-parse', '--git-common-dir'], candidatePath)
  if (gitDirResult.code !== 0 || commonDirResult.code !== 0) {
    return {
      ok: false,
      reason: '候选路径不是可用的 Git 工作区',
      details: { candidateReal, projectReal },
    }
  }

  const gitDir = normalizePath(resolve(candidatePath, gitDirResult.stdout.trim()))
  const gitCommonDir = normalizePath(resolve(candidatePath, commonDirResult.stdout.trim()))
  // Linked worktrees have .git as a file pointing at common/worktrees/<name>,
  // so --git-dir !== --git-common-dir. The main working tree has them equal.
  if (gitDir === gitCommonDir) {
    return {
      ok: false,
      reason: 'git-dir 与 git-common-dir 相同：不是隔离的 linked worktree',
      details: { candidateReal, projectReal, gitDir, gitCommonDir },
    }
  }

  const listResult = await runGit(['worktree', 'list', '--porcelain'], projectRootPath)
  if (listResult.code !== 0) {
    return {
      ok: false,
      reason: '无法列出项目的 git worktree',
      details: { candidateReal, projectReal, gitDir, gitCommonDir },
    }
  }

  const listed = parsePorcelainWorktrees(listResult.stdout)
  const listedMatch = listed.some((entry) => {
    const entryReal = tryRealpath(entry.path) ?? normalizePath(resolve(entry.path))
    return entryReal === candidateReal
  })
  if (!listedMatch) {
    return {
      ok: false,
      reason: '候选路径未出现在项目的 git worktree list 中',
      details: { candidateReal, projectReal, gitDir, gitCommonDir, listed: false },
    }
  }

  const registered = new Set<string>([
    ...listRegisteredWorktrees(projectRootPath),
    ...(input.registeredPaths ?? []).map((p) => tryRealpath(p) ?? normalizePath(resolve(p))),
  ])
  const isRegistered =
    registered.has(candidateReal) ||
    registered.has(normalizePath(resolve(candidatePath))) ||
    isObjectOsWorktreePath(candidateReal, projectReal)
  if (!isRegistered) {
    return {
      ok: false,
      reason: '候选路径未在 ObjectOS worktree 注册表中登记',
      details: { candidateReal, projectReal, gitDir, gitCommonDir, listed: true, registered: false },
    }
  }

  return {
    ok: true,
    reason: '已验证为 ObjectOS 登记的隔离 Git worktree',
    details: { candidateReal, projectReal, gitDir, gitCommonDir, listed: true, registered: true },
  }
}

export class WorktreeManager {
  async create(repoRoot: string, worktreePath: string, branch: string): Promise<WorktreeRef> {
    if (!existsSync(`${repoRoot}/.git`) && !existsSync(repoRoot)) {
      throw new Error('项目不是 Git 仓库，无法创建工作树')
    }
    // .git may be a file (worktree) or directory; rev-parse is the source of truth later.
    const gitCheck = await runGit(['rev-parse', '--is-inside-work-tree'], repoRoot)
    if (gitCheck.code !== 0 || gitCheck.stdout.trim() !== 'true') {
      if (!existsSync(`${repoRoot}/.git`)) {
        throw new Error('项目不是 Git 仓库，无法创建工作树')
      }
    }
    if (existsSync(worktreePath)) {
      registerWorktree(repoRoot, worktreePath)
      return { path: worktreePath, branch, baseHead: await this.head(worktreePath) }
    }
    mkdirSync(dirname(worktreePath), { recursive: true })
    let result = await runGit(['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], repoRoot)
    if (result.code !== 0) {
      result = await runGit(['worktree', 'add', worktreePath, branch], repoRoot)
    }
    if (result.code !== 0) throw new Error(result.stderr.trim() || 'git worktree add 失败')
    registerWorktree(repoRoot, worktreePath)
    return { path: worktreePath, branch, baseHead: await this.head(worktreePath) }
  }

  async head(worktreePath: string): Promise<string | null> {
    const result = await runGit(['rev-parse', 'HEAD'], worktreePath)
    return result.code === 0 ? result.stdout.trim() : null
  }

  async diff(worktreePath: string): Promise<string> {
    const diff = await runGit(['diff', 'HEAD', '--no-ext-diff', '--unified=3'], worktreePath)
    const status = await runGit(['status', '--porcelain=v1'], worktreePath)
    return [`# git status\n${status.stdout.trim()}`, '# git diff', diff.stdout.trim()].join('\n\n').slice(0, 120_000)
  }

  async merge(repoRoot: string, branch: string, message: string): Promise<{ ok: boolean; message: string }> {
    const clean = await runGit(['status', '--porcelain=v1'], repoRoot)
    if (clean.code !== 0) return { ok: false, message: clean.stderr.trim() || '无法读取主工作区状态' }
    if (clean.stdout.trim()) return { ok: false, message: '主工作区存在未提交改动，拒绝合并' }
    const result = await runGit(['merge', '--no-ff', branch, '-m', message], repoRoot)
    if (result.code === 0) return { ok: true, message: result.stdout.trim().slice(0, 4000) }
    // Never leave the main workspace in a half-merged state; restore it and report the conflict.
    const conflicts = await runGit(['diff', '--name-only', '--diff-filter=U'], repoRoot)
    await runGit(['merge', '--abort'], repoRoot)
    const files = conflicts.stdout.trim()
    return {
      ok: false,
      message: (files ? `合并冲突，已中止合并：\n${files}` : (result.stderr || result.stdout).trim()).slice(0, 4000),
    }
  }

  async remove(repoRoot: string, worktreePath: string): Promise<void> {
    await runGit(['worktree', 'remove', '--force', worktreePath], repoRoot)
    unregisterWorktree(repoRoot, worktreePath)
  }

  async list(repoRoot: string): Promise<Array<{ path: string; branch: string }>> {
    const result = await runGit(['worktree', 'list', '--porcelain'], repoRoot)
    if (result.code !== 0) return []
    return parsePorcelainWorktrees(result.stdout)
  }
}
