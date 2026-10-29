import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'
import {
  buildReviewSnapshot,
  emptyChanges,
  emptyRefs,
  emptyScope,
  integrityOf,
  type ReviewFilePresence,
  type ReviewSnapshot,
  type ReviewSnapshotChanges,
  type ReviewSnapshotFile,
  type ReviewReviewerIdentity,
  type ReviewWorktreeIdentity,
} from '@projectos/application'

/**
 * ADR-0025 — trusted snapshot collection.
 *
 * The runtime (never the Agent) reads the real workspace files behind `reviewedObjects`
 * and hashes their bytes. Anything the Agent put into `metadata.reviewSnapshot` is
 * discarded, so a forged hash or revision cannot make a stale review look current.
 *
 * Path safety:
 *  - absolute paths and `..` escapes are rejected,
 *  - symbolic links are never followed (their target may live outside the workspace),
 *  - an existing file must resolve, through its real path, inside the real workspace root,
 *  - every rejected path is recorded instead of silently dropped.
 */

function realRoot(workspaceRoot: string): string {
  const absolute = resolve(workspaceRoot)
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/')
}

interface SafePath {
  relative: string | null
  rejected: string | null
}

/** Validates one requested path without touching the filesystem semantics of the caller. */
function safeRelativePath(root: string, candidate: string): SafePath {
  const cleaned = candidate.trim()
  if (!cleaned) return { relative: null, rejected: null }
  if (isAbsolute(cleaned) || /^[a-zA-Z]:/.test(cleaned)) {
    return { relative: null, rejected: `${cleaned}（绝对路径）` }
  }
  const candidatePosix = toPosix(cleaned)
  if (candidatePosix.split('/').some((segment) => segment === '..')) {
    return { relative: null, rejected: `${cleaned}（包含 ..）` }
  }
  const normalizedRoot = normalize(root)
  const target = normalize(resolve(root, candidatePosix))
  const rel = relative(normalizedRoot, target)
  if (!rel || rel === '') return { relative: null, rejected: null }
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return { relative: null, rejected: `${cleaned}（越出工作区）` }
  }
  return { relative: toPosix(rel), rejected: null }
}

interface HashedFile {
  file: ReviewSnapshotFile
  rejected: string | null
}

/** Paths Git currently tracks in this worktree (index), used to tell deletion from invention. */
function trackedPaths(root: string): Set<string> {
  try {
    const raw = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return new Set(raw.split('\0').filter(Boolean).map(toPosix))
  } catch {
    return new Set()
  }
}

/** True when Git has ever known this path, even if it is deleted from the working tree now. */
function gitKnowsPath(root: string, relativePath: string): boolean {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%H', '--', relativePath], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out.length > 0
  } catch {
    return false
  }
}

function hashFile(
  root: string,
  relativePath: string,
  options: { untracked: boolean; required: boolean; tracked: Set<string> },
): HashedFile {
  const absolute = resolve(root, relativePath)
  const baseState: ReviewSnapshotFile['state'] = options.untracked ? 'untracked' : 'tracked'
  const make = (
    presence: ReviewFilePresence,
    sha256: string | null,
    extra: { size?: number | null; detail?: string | null; rejected?: string | null } = {},
  ): HashedFile => ({
    file: {
      path: relativePath,
      sha256,
      state: baseState,
      size: extra.size ?? null,
      presence,
      required: options.required,
      detail: extra.detail ?? null,
    },
    rejected: extra.rejected ?? null,
  })

  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(absolute)
  } catch {
    // ADR-0028: "missing" is only a reviewable deletion when Git knows the path. A path that
    // never existed is not reviewed content, and must not silently contribute `sha256: null`.
    if (options.tracked.has(relativePath) || gitKnowsPath(root, relativePath)) {
      return make('deleted', null, { detail: 'Git 中存在的文件，当前工作区已删除' })
    }
    return make('never-existed', null, {
      detail: '文件从未存在，不能作为已审查的代码内容',
      rejected: `${relativePath}（文件从未存在）`,
    })
  }
  if (stat.isSymbolicLink()) {
    return make('rejected', null, { detail: '符号链接不跟随', rejected: `${relativePath}（符号链接不跟随）` })
  }
  if (!stat.isFile()) {
    return make('unreadable', null, { detail: '不是普通文件', rejected: `${relativePath}（不是普通文件）` })
  }
  try {
    const resolved = realpathSync.native(absolute)
    if (resolved !== resolve(root) && !resolved.startsWith(resolve(root) + sep)) {
      return make('rejected', null, {
        detail: '真实路径越出工作区',
        rejected: `${relativePath}（真实路径越出工作区）`,
      })
    }
    const bytes = readFileSync(resolved)
    return make('present', createHash('sha256').update(bytes).digest('hex'), { size: bytes.length })
  } catch (error) {
    return make('unreadable', null, {
      detail: `无法读取：${error instanceof Error ? error.message : String(error)}`,
      rejected: `${relativePath}（无法读取）`,
    })
  }
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

export function worktreeIdentity(root: string): ReviewWorktreeIdentity {
  const head = git(root, ['rev-parse', 'HEAD'])
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const commonDir = git(root, ['rev-parse', '--git-common-dir'])
  const gitDir = git(root, ['rev-parse', '--git-dir'])
  // A linked worktree has a git dir different from the common dir.
  const isWorktree = Boolean(commonDir && gitDir && resolve(root, commonDir) !== resolve(root, gitDir))
  return {
    root,
    branch: branch && branch !== 'HEAD' ? branch : null,
    head: head || null,
    isWorktree,
  }
}

interface StatusEntry {
  path: string
  state: 'staged' | 'unstaged' | 'untracked' | 'deleted' | 'renamed'
  renamedFrom?: string
}

/** Parses `git status --porcelain=v1 -z -uall` without losing renames or deleted files. */
function gitStatus(root: string): { entries: StatusEntry[]; available: boolean } {
  const raw = (() => {
    try {
      return execFileSync('git', ['status', '--porcelain=v1', '-z', '-uall'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      return null
    }
  })()
  if (raw === null) return { entries: [], available: false }
  const entries: StatusEntry[] = []
  const parts = raw.split('\0')
  for (let index = 0; index < parts.length; index += 1) {
    const token = parts[index]
    if (!token || token.length < 4) continue
    const indexStatus = token[0]
    const worktreeStatus = token[1]
    const path = toPosix(token.slice(3))
    if (indexStatus === 'R' || worktreeStatus === 'R') {
      const nextPart = parts[index + 1]
      const from = nextPart ? toPosix(nextPart) : ''
      index += 1
      entries.push({ path, state: 'renamed', renamedFrom: from })
      continue
    }
    if (indexStatus === '?' && worktreeStatus === '?') {
      entries.push({ path, state: 'untracked' })
      continue
    }
    if (indexStatus === 'D' || worktreeStatus === 'D') {
      entries.push({ path, state: 'deleted' })
      continue
    }
    if (indexStatus !== ' ' && indexStatus !== '?') entries.push({ path, state: 'staged' })
    if (worktreeStatus !== ' ' && worktreeStatus !== '?') entries.push({ path, state: 'unstaged' })
  }
  return { entries, available: true }
}

function changesFrom(entries: StatusEntry[], rejected: string[]): ReviewSnapshotChanges {
  const changes = emptyChanges()
  changes.rejected = rejected
  for (const entry of entries) {
    if (entry.state === 'staged') changes.staged.push(entry.path)
    else if (entry.state === 'unstaged') changes.unstaged.push(entry.path)
    else if (entry.state === 'untracked') changes.untracked.push(entry.path)
    else if (entry.state === 'deleted') changes.deleted.push(entry.path)
    else if (entry.state === 'renamed') changes.renamed.push({ from: entry.renamedFrom ?? '', to: entry.path })
  }
  const unique = (values: string[]): string[] => [...new Set(values)].sort()
  changes.staged = unique(changes.staged)
  changes.unstaged = unique(changes.unstaged)
  changes.untracked = unique(changes.untracked)
  changes.deleted = unique(changes.deleted)
  changes.rejected = unique(changes.rejected)
  return changes
}

const PROJECT_WIDE = /^(project|repository|repo|all|whole-project|\*)$/i

export interface CollectOptions {
  workspaceRoot: string
  reviewedObjects: unknown
  /** `project` / `*` widens the snapshot to every changed file (cross-file review). */
  scope?: unknown
  /** Additional reviewed roots (workspace-relative) when the review is dependency-wide. */
  scopeRoots?: unknown
  /** Extra paths to include when the review covers a whole project. */
  extraPaths?: string[]
  projectId?: string | null
  planId?: string | null
  taskId?: string | null
  runId?: string | null
  reviewer?: ReviewReviewerIdentity | null
  refs?: { diffArtifactId?: string | null; artifactIds?: string[]; evidenceIds?: string[] } | null
}

export function collectReviewSnapshot(options: CollectOptions): ReviewSnapshot {
  const root = realRoot(options.workspaceRoot)
  const status = gitStatus(root)
  const rejected: string[] = []

  const reviewedObjects = Array.isArray(options.reviewedObjects)
    ? options.reviewedObjects.filter((item): item is string => typeof item === 'string')
    : []
  const scopeRootsInput = Array.isArray(options.scopeRoots)
    ? options.scopeRoots.filter((item): item is string => typeof item === 'string')
    : typeof options.scopeRoots === 'string'
      ? [options.scopeRoots]
      : []
  const scopeText = typeof options.scope === 'string' ? options.scope.trim() : ''
  const expanded = PROJECT_WIDE.test(scopeText) || scopeRootsInput.length > 0

  const requested = [...reviewedObjects, ...(options.extraPaths ?? []), ...scopeRootsInput]
  // relative path -> { untracked, required }: the reviewer's own objects are required evidence,
  // scope-expanded extras are context and may not invalidate the review on their own.
  const paths = new Map<string, { untracked: boolean; required: boolean }>()
  const untrackedPaths = new Set(status.entries.filter((entry) => entry.state === 'untracked').map((entry) => entry.path))
  const tracked = trackedPaths(root)
  const reviewedSet = new Set(
    reviewedObjects
      .map((candidate) => safeRelativePath(root, candidate).relative)
      .filter((value): value is string => Boolean(value)),
  )

  const addPath = (candidate: string, required: boolean): void => {
    const safe = safeRelativePath(root, candidate)
    if (safe.rejected) {
      rejected.push(safe.rejected)
      return
    }
    if (!safe.relative) return
    paths.set(safe.relative, {
      untracked: untrackedPaths.has(safe.relative),
      required: required || reviewedSet.has(safe.relative),
    })
  }

  for (const candidate of requested) addPath(candidate, true)

  // Widening the scope is explicit: include every changed file under the given roots (or the
  // whole worktree for a project-wide review), so cross-file impact cannot escape the hash.
  if (expanded) {
    const roots = scopeRootsInput.length > 0 ? scopeRootsInput : ['.']
    for (const entry of status.entries) {
      const inScope = roots.some((candidateRoot) => {
        const safeRoot = safeRelativePath(root, candidateRoot)
        if (!safeRoot.relative) return candidateRoot.trim() === '.' || candidateRoot.trim() === ''
        return entry.path === safeRoot.relative || entry.path.startsWith(`${safeRoot.relative}/`)
      })
      if (!inScope) continue
      if (entry.state === 'renamed' && entry.renamedFrom) addPath(entry.renamedFrom, false)
      addPath(entry.path, false)
    }
  }

  const files: ReviewSnapshotFile[] = []
  for (const [path, meta] of [...paths.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const hashed = hashFile(root, path, { untracked: meta.untracked, required: meta.required, tracked })
    if (hashed.rejected) rejected.push(hashed.rejected)
    // A rejected/unreadable *required* object must still appear in the snapshot: dropping it
    // would let the remaining hashes look complete (ADR-0028).
    files.push(hashed.file)
  }
  const integrity = integrityOf(files)

  const identity = worktreeIdentity(root)
  const changes = changesFrom(status.entries, rejected)
  const baselineCommit = identity.head
  const scope = expanded
    ? {
        roots: (scopeRootsInput.length > 0 ? scopeRootsInput : ['.']).map((item) => toPosix(item.trim() || '.')),
        reviewedObjects,
        expanded: true,
      }
    : { ...emptyScope(), reviewedObjects }

  return buildReviewSnapshot({
    projectId: options.projectId ?? null,
    planId: options.planId ?? null,
    taskId: options.taskId ?? null,
    runId: options.runId ?? null,
    worktree: identity,
    baselineCommit,
    scope,
    files,
    changes,
    refs: options.refs
      ? {
          ...emptyRefs(),
          diffArtifactId: options.refs.diffArtifactId ?? null,
          artifactIds: options.refs.artifactIds ?? [],
          evidenceIds: options.refs.evidenceIds ?? [],
        }
      : emptyRefs(),
    reviewer: options.reviewer ?? null,
    integrity,
    capturedAt: Date.now(),
  })
}

/**
 * Re-collects the snapshot for exactly the scope a stored review claims, so an approval can
 * be re-validated against the current bytes. Returns null when the review has no file scope
 * at all (a review of only commits/artifacts cannot be content-verified).
 */
export function recollectForReview(
  workspaceRoot: string,
  metadata: Record<string, unknown>,
): ReviewSnapshot | null {
  const reviewedObjects = Array.isArray(metadata.reviewedObjects)
    ? metadata.reviewedObjects.filter((item): item is string => typeof item === 'string')
    : []
  const scope = typeof metadata.scope === 'string' ? metadata.scope : ''
  const scopeRoots = Array.isArray(metadata.scopeRoots) ? metadata.scopeRoots : undefined
  const hasFileScope =
    reviewedObjects.length > 0 || PROJECT_WIDE.test(scope.trim()) || Boolean(scopeRoots && scopeRoots.length)
  if (!hasFileScope) return null
  return collectReviewSnapshot({
    workspaceRoot,
    reviewedObjects,
    scope,
    scopeRoots,
  })
}

/** True when the path exists as a real workspace file (used by evidence authenticity checks). */
export function workspaceFileExists(workspaceRoot: string, candidate: string): boolean {
  const root = realRoot(workspaceRoot)
  const safe = safeRelativePath(root, candidate)
  if (!safe.relative) return false
  try {
    const absolute = resolve(root, safe.relative)
    if (!existsSync(absolute)) return false
    if (lstatSync(absolute).isSymbolicLink()) return false
    if (!statSync(absolute).isFile()) return false
    return realpathSync.native(absolute).startsWith(realRoot(root))
  } catch {
    return false
  }
}

