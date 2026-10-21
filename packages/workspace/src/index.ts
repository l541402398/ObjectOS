import { execFile } from 'node:child_process'
import crossSpawn from 'cross-spawn'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { AppError, type CommandResult, type FileContent, type GitChange, type GitStatus, type WorkspaceEntry } from '@projectos/contracts'

const execFileAsync = promisify(execFile)

const IGNORED = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  'release',
  '.turbo',
  '.next',
  '.cache',
  'coverage',
  '.idea',
  '.vscode',
  '__pycache__',
  '.venv',
  'target',
])

const MAX_TREE_ENTRIES = 2500
const MAX_FILE_BYTES = 512 * 1024
const MAX_COMMAND_OUTPUT = 120 * 1024

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  if (rel === '') return true
  if (rel.startsWith('..') || isAbsolute(rel)) return false
  const rootLower = root.toLowerCase()
  const targetLower = target.toLowerCase()
  if (process.platform === 'win32') {
    return targetLower === rootLower || targetLower.startsWith(`${rootLower}${sep}`)
  }
  return target.startsWith(`${root}${sep}`)
}

function normalizeRoot(rootPath: string): string {
  if (!rootPath || !isAbsolute(rootPath)) {
    throw new AppError('BAD_REQUEST', '项目根目录必须是绝对路径')
  }
  if (!existsSync(rootPath)) {
    throw new AppError('NOT_FOUND', '项目根目录不存在')
  }
  const stats = statSync(rootPath)
  if (!stats.isDirectory()) {
    throw new AppError('BAD_REQUEST', '项目根目录不是文件夹')
  }
  return realpathSync.native(rootPath)
}

/** Resolve a user/agent supplied relative path and reject traversal + symlink escapes. */
export function resolveWorkspacePath(rootPath: string, relativePath: string, options?: { forWrite?: boolean }): string {
  const root = normalizeRoot(rootPath)
  if (!relativePath || relativePath === '.' || relativePath === './') return root
  if (isAbsolute(relativePath)) {
    throw new AppError('WORKSPACE_OUTSIDE_ROOT', '只允许项目内相对路径')
  }
  const normalized = relativePath.replace(/\\/g, '/')
  if (normalized.split('/').some((segment) => segment === '..')) {
    throw new AppError('WORKSPACE_OUTSIDE_ROOT', '路径不能包含 ..')
  }
  const target = resolve(root, normalized)
  if (!isWithin(root, target)) {
    throw new AppError('WORKSPACE_OUTSIDE_ROOT', '目标路径超出项目工作区')
  }
  if (existsSync(target)) {
    const real = realpathSync.native(target)
    if (!isWithin(root, real)) {
      throw new AppError('WORKSPACE_OUTSIDE_ROOT', '符号链接指向项目工作区之外')
    }
    return real
  }
  if (!options?.forWrite) {
    throw new AppError('NOT_FOUND', `文件不存在：${relativePath}`)
  }
  // For new files, verify the nearest existing ancestor is still inside the root.
  let ancestor = dirname(target)
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }
  if (existsSync(ancestor)) {
    const realAncestor = realpathSync.native(ancestor)
    if (!isWithin(root, realAncestor) || !isWithin(root, target)) {
      throw new AppError('WORKSPACE_OUTSIDE_ROOT', '目标路径超出项目工作区')
    }
  }
  return target
}

export function ensureProjectRoot(rootPath: string, createDirectory: boolean): string {
  if (!isAbsolute(rootPath)) throw new AppError('BAD_REQUEST', '项目根目录必须是绝对路径')
  const resolved = resolve(rootPath)
  if (existsSync(resolved)) {
    if (!statSync(resolved).isDirectory()) throw new AppError('BAD_REQUEST', '项目根目录不是文件夹')
    return realpathSync.native(resolved)
  }
  if (!createDirectory) {
    throw new AppError('NOT_FOUND', '项目根目录不存在，请选择已有文件夹或允许创建')
  }
  mkdirSync(resolved, { recursive: true })
  return realpathSync.native(resolved)
}

export interface TreeOptions {
  maxDepth?: number
  maxEntries?: number
}

export function readWorkspaceTree(rootPath: string, options: TreeOptions = {}): WorkspaceEntry[] {
  const root = normalizeRoot(rootPath)
  const maxDepth = options.maxDepth ?? 8
  const maxEntries = options.maxEntries ?? MAX_TREE_ENTRIES
  const entries: WorkspaceEntry[] = []
  const walk = (dir: string, depth: number): void => {
    if (entries.length >= maxEntries) return
    let names: string[]
    try {
      names = readdirSync(dir).sort((a, b) => {
        const aDir = statSync(join(dir, a)).isDirectory()
        const bDir = statSync(join(dir, b)).isDirectory()
        if (aDir !== bDir) return aDir ? -1 : 1
        return a.localeCompare(b, 'zh-CN')
      })
    } catch {
      return
    }
    for (const name of names) {
      if (entries.length >= maxEntries) return
      if (IGNORED.has(name)) continue
      const fullPath = join(dir, name)
      let stats
      try {
        stats = statSync(fullPath)
      } catch {
        continue
      }
      const rel = relative(root, fullPath).replace(/\\/g, '/')
      entries.push({
        path: rel,
        name,
        type: stats.isDirectory() ? 'directory' : 'file',
        size: stats.isDirectory() ? 0 : stats.size,
        depth,
      })
      if (stats.isDirectory() && depth < maxDepth) walk(fullPath, depth + 1)
    }
  }
  walk(root, 0)
  return entries
}

export function readTextFile(rootPath: string, relativePath: string): FileContent {
  const fullPath = resolveWorkspacePath(rootPath, relativePath)
  const stats = statSync(fullPath)
  if (!stats.isFile()) throw new AppError('BAD_REQUEST', '目标不是文件')
  const raw = readFileSync(fullPath)
  const truncated = raw.length > MAX_FILE_BYTES
  const slice = truncated ? raw.subarray(0, MAX_FILE_BYTES) : raw
  if (slice.includes(0)) throw new AppError('BAD_REQUEST', '二进制文件不能以文本方式打开')
  return {
    path: relativePath.replace(/\\/g, '/'),
    content: slice.toString('utf8'),
    size: stats.size,
    truncated,
    language: languageForPath(relativePath),
  }
}

export function writeTextFile(rootPath: string, relativePath: string, content: string): { path: string; bytes: number } {
  const target = resolveWorkspacePath(rootPath, relativePath, { forWrite: true })
  mkdirSync(dirname(target), { recursive: true })
  const temp = `${target}.projectos-${process.pid}.tmp`
  writeFileSync(temp, content, 'utf8')
  renameSync(temp, target)
  return { path: relativePath.replace(/\\/g, '/'), bytes: Buffer.byteLength(content, 'utf8') }
}

export function languageForPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    md: 'markdown',
    mdx: 'markdown',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    yml: 'yaml',
    yaml: 'yaml',
    sql: 'sql',
    sh: 'shell',
    ps1: 'powershell',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    toml: 'ini',
    xml: 'xml',
  }
  return map[ext] ?? 'plaintext'
}

async function runGit(root: string, args: string[], maxBuffer = 1024 * 1024): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await execFileAsync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      timeout: 8_000,
      maxBuffer,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' },
    })
    return { stdout: result.stdout, stderr: result.stderr, code: 0 }
  } catch (error) {
    const typed = error as { stdout?: string; stderr?: string; code?: number | string; message?: string }
    return {
      stdout: typed.stdout ?? '',
      stderr: typed.stderr ?? typed.message ?? '',
      code: typeof typed.code === 'number' ? typed.code : 1,
    }
  }
}

export async function getGitStatus(rootPath: string): Promise<GitStatus | null> {
  const root = normalizeRoot(rootPath)
  if (!existsSync(join(root, '.git'))) return null
  const status = await runGit(root, ['status', '--porcelain=v1', '--branch'])
  if (status.code !== 0) return null
  const lines = status.stdout.split(/\r?\n/).filter(Boolean)
  const branchLine = lines.find((line) => line.startsWith('## '))
  let branch = 'detached'
  let ahead = 0
  let behind = 0
  if (branchLine) {
    const body = branchLine.slice(3)
    const [namePart, tracking] = body.split('...')
    branch = namePart?.trim() || 'detached'
    const noCommits = /^No commits yet on (.+)$/.exec(branch)
    if (noCommits) branch = noCommits[1]!.trim()
    if (tracking) {
      const aheadMatch = tracking.match(/ahead (\d+)/)
      const behindMatch = tracking.match(/behind (\d+)/)
      ahead = aheadMatch ? Number(aheadMatch[1]) : 0
      behind = behindMatch ? Number(behindMatch[1]) : 0
    }
  }
  const changes: GitChange[] = []
  for (const line of lines) {
    if (line.startsWith('## ')) continue
    if (line.length < 4) continue
    const index = line[0] ?? ' '
    const worktree = line[1] ?? ' '
    let filePath = line.slice(3)
    if (filePath.includes(' -> ')) filePath = filePath.split(' -> ').pop() ?? filePath
    const statusCode = `${index}${worktree}`.trim() || '??'
    changes.push({
      path: filePath.replace(/\\/g, '/'),
      status: statusCode,
      staged: index !== ' ' && index !== '?',
    })
  }
  const last = await runGit(root, ['log', '-1', '--format=%H%x00%s%x00%an%x00%ct'])
  let lastCommit: GitStatus['lastCommit'] = null
  if (last.code === 0 && last.stdout.trim()) {
    const [hash, subject, author, seconds] = last.stdout.trim().split('\0')
    if (hash) {
      lastCommit = {
        hash,
        subject: subject ?? '',
        author: author ?? '',
        committedAt: Number(seconds ?? 0) * 1000,
      }
    }
  }
  return {
    branch,
    clean: changes.length === 0,
    changes,
    ahead,
    behind,
    lastCommit,
  }
}

export async function getGitDiff(rootPath: string, filePath?: string): Promise<{ patch: string; truncated: boolean }> {
  const root = normalizeRoot(rootPath)
  const args = ['diff', 'HEAD', '--no-color', '--no-ext-diff', '--']
  if (filePath) {
    const target = resolveWorkspacePath(root, filePath)
    args.push(relative(root, target).replace(/\\/g, '/'))
  }
  let result = await runGit(root, args, 4 * 1024 * 1024)
  if (result.code !== 0 || (!result.stdout && !existsSync(join(root, '.git', 'HEAD')))) {
    const fallback = await runGit(root, ['diff', '--no-color', '--no-ext-diff'], 4 * 1024 * 1024)
    if (fallback.code === 0 || fallback.stdout) result = fallback
  }
  const limit = 400 * 1024
  const truncated = result.stdout.length > limit
  return { patch: truncated ? result.stdout.slice(0, limit) : result.stdout, truncated }
}

export async function initGitRepository(rootPath: string): Promise<boolean> {
  const root = normalizeRoot(rootPath)
  if (existsSync(join(root, '.git'))) return false
  const result = await runGit(root, ['init'])
  return result.code === 0
}

const READONLY_COMMANDS = new Set([
  'git status',
  'git log',
  'git diff',
  'git show',
  'git branch',
  'git remote',
  'git rev-parse',
  'ls',
  'dir',
  'pwd',
  'node --version',
  'npm --version',
  'pnpm --version',
  'git --version',
])

const SHELL_META = /[|;&><`$\n\r]/

function tokenize(command: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '')
  }
  return tokens
}

function isAllowedReadonly(tokens: string[]): boolean {
  if (tokens.length === 0) return false
  const two = tokens.slice(0, 2).join(' ')
  if (!READONLY_COMMANDS.has(two)) return false
  if (two === 'git branch') {
    const safe = new Set(['', '-a', '-v', '-vv', '--list', '--show-current', '-r'])
    if (tokens.slice(2).some((token) => !safe.has(token))) return false
  }
  if (two === 'git remote') {
    if (tokens.slice(2).some((token) => token !== '-v' && token !== '--verbose')) return false
  }
  if (two === 'git show' || two === 'git log') {
    if (tokens.slice(2).some((token) => token.startsWith('--output') || token === '--edit')) return false
  }
  return true
}

export async function runReadonlyCommand(rootPath: string, command: string): Promise<CommandResult> {
  const root = normalizeRoot(rootPath)
  const trimmed = command.trim()
  if (!trimmed) throw new AppError('BAD_REQUEST', '命令不能为空')
  if (SHELL_META.test(trimmed)) throw new AppError('POLICY_DENIED', '终端只支持只读命令，不允许管道/重定向/命令串联')
  const tokens = tokenize(trimmed)
  if (!isAllowedReadonly(tokens)) {
    throw new AppError('POLICY_DENIED', '该命令不在只读白名单中')
  }
  return executeProcess(root, tokens, trimmed, 10_000)
}

async function executeProcess(
  cwd: string,
  tokens: string[],
  commandLabel: string,
  timeoutMs: number,
): Promise<CommandResult> {
  const startedAt = Date.now()
  const executable = tokens[0]!
  const args = tokens.slice(1)
  return new Promise<CommandResult>((resolve) => {
    let stdout = ''
    let stderr = ''
    let truncated = false
    let settled = false
    let child: ReturnType<typeof crossSpawn> | null = null
    const timerRef: { current: NodeJS.Timeout | undefined } = { current: undefined }
    const finish = (exitCode: number, prefixError?: string): void => {
      if (settled) return
      settled = true
      if (timerRef.current) clearTimeout(timerRef.current)
      resolve({
        command: commandLabel,
        exitCode,
        stdout: stdout.slice(0, MAX_COMMAND_OUTPUT),
        stderr: `${prefixError ? `${prefixError}\n` : ''}${stderr}`.slice(0, MAX_COMMAND_OUTPUT),
        durationMs: Date.now() - startedAt,
        truncated,
      })
    }
    const append = (target: 'stdout' | 'stderr', chunk: Buffer | string): void => {
      const text = chunk.toString()
      if (target === 'stdout') {
        if (stdout.length < MAX_COMMAND_OUTPUT) stdout += text
        else truncated = true
      } else if (stderr.length < MAX_COMMAND_OUTPUT) {
        stderr += text
      }
    }
    try {
      child = crossSpawn(executable, args, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          Path: process.env.Path,
          SystemRoot: process.env.SystemRoot,
          ComSpec: process.env.ComSpec,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          USERPROFILE: process.env.USERPROFILE,
          APPDATA: process.env.APPDATA,
          LOCALAPPDATA: process.env.LOCALAPPDATA,
          GIT_PAGER: 'cat',
          GIT_TERMINAL_PROMPT: '0',
          CI: '1',
          NO_COLOR: '1',
        },
      })
    } catch (error) {
      finish(1, error instanceof Error ? error.message : String(error))
      return
    }
    timerRef.current = setTimeout(() => {
      try {
        child?.kill()
      } catch {
        // ignore
      }
      finish(1, `命令超时（${timeoutMs}ms）`)
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => append('stdout', chunk))
    child.stderr?.on('data', (chunk) => append('stderr', chunk))
    child.on('error', (error) => finish(1, error.message))
    child.on('close', (code) => finish(typeof code === 'number' ? code : 1))
  })
}

/** Execute a command that passed an approval gate. No shell interpolation is allowed. */
export async function runApprovedCommand(
  rootPath: string,
  command: string,
  timeoutMs = 30_000,
): Promise<CommandResult> {
  const root = normalizeRoot(rootPath)
  const trimmed = command.trim()
  if (!trimmed) throw new AppError('BAD_REQUEST', '命令不能为空')
  if (SHELL_META.test(trimmed)) throw new AppError('POLICY_DENIED', '不允许管道、重定向或命令串联')
  const tokens = tokenize(trimmed)
  if (tokens.length === 0) throw new AppError('BAD_REQUEST', '命令不能为空')
  return executeProcess(root, tokens, trimmed, Math.min(Math.max(timeoutMs, 1_000), 120_000))
}

export function listProjectAgentsFile(rootPath: string): string | null {
  try {
    const target = resolveWorkspacePath(rootPath, 'AGENTS.md')
    return readFileSync(target, 'utf8')
  } catch {
    return null
  }
}

export function workspaceBasename(rootPath: string): string {
  return basename(rootPath)
}

// ---------------------------------------------------------------------------
// Per-Run file attribution
// ---------------------------------------------------------------------------

export interface FileFingerprint {
  path: string
  hash: string
}

export interface FileFingerprintChange {
  path: string
  changeType: 'added' | 'modified' | 'deleted'
  baselineHash: string | null
  afterHash: string | null
}

/**
 * Snapshot workspace file hashes. Used to attribute only the files that changed
 * during one external-Runtime Run; a pre-existing dirty file keeps its baseline
 * hash and is therefore never attributed to the Run.
 */
export function snapshotFileFingerprints(
  rootPath: string,
  options: { maxFiles?: number; maxBytes?: number } = {},
): FileFingerprint[] {
  const root = normalizeRoot(rootPath)
  const maxFiles = Math.max(1, Math.min(options.maxFiles ?? 4000, 20_000))
  const maxBytes = Math.max(1024, options.maxBytes ?? 2_000_000)
  const result: FileFingerprint[] = []
  const walk = (directory: string, depth: number): void => {
    if (depth > 24 || result.length >= maxFiles) return
    let entries: string[]
    try {
      entries = readdirSync(directory)
    } catch {
      return
    }
    for (const entry of entries) {
      if (result.length >= maxFiles) return
      if (IGNORED.has(entry)) continue
      const absolute = join(directory, entry)
      let stat: ReturnType<typeof statSync>
      try {
        stat = statSync(absolute)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(absolute, depth + 1)
        continue
      }
      if (!stat.isFile()) continue
      let hash: string
      if (stat.size > maxBytes) {
        // Huge files are fingerprinted by size to keep the scan bounded.
        hash = `size:${stat.size}`
      } else {
        try {
          hash = createHash('sha256').update(readFileSync(absolute)).digest('hex')
        } catch {
          continue
        }
      }
      result.push({ path: relative(root, absolute).split(sep).join('/'), hash })
    }
  }
  walk(root, 0)
  return result
}

export function diffFileFingerprints(
  before: readonly FileFingerprint[],
  after: readonly FileFingerprint[],
): FileFingerprintChange[] {
  const beforeMap = new Map(before.map((entry) => [entry.path, entry.hash]))
  const afterMap = new Map(after.map((entry) => [entry.path, entry.hash]))
  const changes: FileFingerprintChange[] = []
  for (const [path, hash] of afterMap) {
    const previous = beforeMap.get(path)
    if (previous === undefined) {
      changes.push({ path, changeType: 'added', baselineHash: null, afterHash: hash })
    } else if (previous !== hash) {
      changes.push({ path, changeType: 'modified', baselineHash: previous, afterHash: hash })
    }
  }
  for (const [path, hash] of beforeMap) {
    if (!afterMap.has(path)) {
      changes.push({ path, changeType: 'deleted', baselineHash: hash, afterHash: null })
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}
