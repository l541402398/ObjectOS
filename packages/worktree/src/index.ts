import crossSpawn from 'cross-spawn'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname } from 'node:path'

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
  /^\.env\./i,
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
  for (const raw of output.split(/\r?\n/)) {
    if (!raw.trim()) continue
    const status = raw.slice(0, 2)
    let path = raw.slice(3).trim()
    if (path.includes(' -> ')) path = path.split(' -> ').pop()!.trim()
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
    if (path) files.push({ path: normalizePath(path), status })
  }
  return files
}

function runGit(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = crossSpawn('git', args, { cwd, windowsHide: true })
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

export class WorktreeManager {
  async create(repoRoot: string, worktreePath: string, branch: string): Promise<WorktreeRef> {
    if (!existsSync(`${repoRoot}/.git`)) {
      throw new Error('项目不是 Git 仓库，无法创建工作树')
    }
    if (existsSync(worktreePath)) {
      return { path: worktreePath, branch, baseHead: await this.head(worktreePath) }
    }
    mkdirSync(dirname(worktreePath), { recursive: true })
    let result = await runGit(['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], repoRoot)
    if (result.code !== 0) {
      result = await runGit(['worktree', 'add', worktreePath, branch], repoRoot)
    }
    if (result.code !== 0) throw new Error(result.stderr.trim() || 'git worktree add 失败')
    return { path: worktreePath, branch, baseHead: await this.head(worktreePath) }
  }

  async head(worktreePath: string): Promise<string | null> {
    const result = await runGit(['rev-parse', 'HEAD'], worktreePath)
    return result.code === 0 ? result.stdout.trim() : null
  }

  async changedFiles(worktreePath: string, allowedPaths: string[] = ['.']): Promise<WorktreeChangedFile[]> {
    const status = await runGit(['status', '--porcelain=v1', '-uall'], worktreePath)
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
    const status = await runGit(['status', '--porcelain=v1', '-uall'], worktreePath)
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
    const parts = [`# git status\n${status.stdout.trim()}`, '# git diff', diff.stdout.trim()]
    if (untrackedParts.length) parts.push('# untracked files', ...untrackedParts)
    return parts.join('\n\n').slice(0, 120_000)
  }

  async merge(
    repoRoot: string,
    branch: string,
    message: string,
    authorizedPaths: string[] = ['.'],
  ): Promise<{ ok: boolean; message: string; files?: WorktreeChangedFile[] }> {
    const clean = await runGit(['status', '--porcelain=v1'], repoRoot)
    if (clean.code !== 0) return { ok: false, message: clean.stderr.trim() || '无法读取主工作区状态' }
    if (clean.stdout.trim()) return { ok: false, message: '主工作区存在未提交改动，拒绝合并' }

    const worktree = (await this.list(repoRoot)).find((entry) => entry.branch === branch)
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
      if (files.length) {
        const add = await runGit(['add', '--', ...files.map((file) => file.path)], worktree.path)
        if (add.code !== 0) return { ok: false, message: add.stderr.trim() || 'Worktree 暂存失败', files }
        const commit = await runGit(
          ['-c', 'user.name=ProjectOS', '-c', 'user.email=projectos@local', 'commit', '-m', message],
          worktree.path,
        )
        if (commit.code !== 0) {
          return { ok: false, message: (commit.stderr || commit.stdout).trim() || 'Worktree 提交失败', files }
        }
      }
    }

    const result = await runGit(
      ['-c', 'user.name=ProjectOS', '-c', 'user.email=projectos@local', 'merge', '--no-ff', branch, '-m', message],
      repoRoot,
    )
    if (result.code === 0) {
      return { ok: true, message: result.stdout.trim().slice(0, 4000), files: worktree ? await this.changedFiles(worktree.path, authorizedPaths) : [] }
    }
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
