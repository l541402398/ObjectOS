import { createHash } from 'node:crypto'

/**
 * ADR-0025 — a review must be bound to the *content* it reviewed, not to a commit.
 *
 * An Agent working in a worktree can rewrite files without committing; `git rev-parse HEAD`
 * then stays identical while the actual code changes. A trusted ReviewSnapshot records, for
 * the reviewed scope only:
 *
 *   - which project/plan/task/run and worktree root the review belongs to,
 *   - the git baseline commit (informational: committing unchanged content must not
 *     invalidate a review, so the commit is NOT part of the fingerprint),
 *   - every reviewed path with the SHA-256 of its bytes (or `null` when it does not exist),
 *   - the staged / unstaged / untracked / deleted / renamed changes of that worktree,
 *   - the Diff / Artifact / Evidence objects the review refers to,
 *   - the reviewer identity,
 *   - one fingerprint over the reviewed file hashes.
 *
 * The snapshot is produced by the runtime by reading real files. Agents never supply
 * hashes: whatever an Agent writes into `metadata.reviewSnapshot` is discarded and replaced.
 */

/** ADR-0025 snapshot schema version; v1 (no `schemaVersion`) records are still readable. */
export const REVIEW_SNAPSHOT_SCHEMA_VERSION = 2

export type ReviewSnapshotFileState = 'tracked' | 'untracked'

export interface ReviewSnapshotFile {
  /** Path relative to the workspace root, using forward slashes. */
  path: string
  /** SHA-256 of the file bytes, or null when the file does not exist (deleted/never created). */
  sha256: string | null
  /** Git tracking state at capture time; `untracked` files still count as reviewed content. */
  state?: ReviewSnapshotFileState
  /** Byte length, when the file existed. */
  size?: number | null
}

/** The trusted workspace identity a snapshot was taken in. */
export interface ReviewWorktreeIdentity {
  /** Absolute, real (symlink-resolved) workspace root. */
  root: string
  branch: string | null
  head: string | null
  /** True when the root is a linked `git worktree`, not the main checkout. */
  isWorktree: boolean
}

/** What changed in the worktree at capture time. Paths are workspace-relative. */
export interface ReviewSnapshotChanges {
  staged: string[]
  unstaged: string[]
  untracked: string[]
  deleted: string[]
  renamed: Array<{ from: string; to: string }>
  /** Paths refused by the path-safety rules (escape, absolute, symlink). */
  rejected: string[]
}

/** Objects the review claims to be about; ids are validated for real existence elsewhere. */
export interface ReviewSnapshotRefs {
  diffArtifactId: string | null
  artifactIds: string[]
  evidenceIds: string[]
}

export interface ReviewReviewerIdentity {
  agentId: string
  name: string
}

/** The reviewed scope, so unrelated file changes do not invalidate the whole project. */
export interface ReviewSnapshotScope {
  /** Workspace-relative roots covered by the review (`['.']` only when explicitly project-wide). */
  roots: string[]
  /** Exactly the objects the reviewer listed. */
  reviewedObjects: string[]
  /** True when the scope was explicitly widened (cross-file dependency / whole-project review). */
  expanded: boolean
}

export interface ReviewSnapshot {
  schemaVersion: number
  projectId: string | null
  planId: string | null
  taskId: string | null
  runId: string | null
  worktree: ReviewWorktreeIdentity | null
  baselineCommit: string | null
  scope: ReviewSnapshotScope
  files: ReviewSnapshotFile[]
  changes: ReviewSnapshotChanges
  refs: ReviewSnapshotRefs
  reviewer: ReviewReviewerIdentity | null
  capturedAt: number
  fingerprint: string
}

export interface ReviewSnapshotInput {
  projectId?: string | null
  planId?: string | null
  taskId?: string | null
  runId?: string | null
  worktree?: ReviewWorktreeIdentity | null
  baselineCommit?: string | null
  scope?: ReviewSnapshotScope | null
  files: ReviewSnapshotFile[]
  changes?: ReviewSnapshotChanges | null
  refs?: ReviewSnapshotRefs | null
  reviewer?: ReviewReviewerIdentity | null
  capturedAt?: number
}

function sortFiles(files: ReviewSnapshotFile[]): ReviewSnapshotFile[] {
  return [...files]
    .map((file) => ({
      path: file.path.replace(/\\/g, '/'),
      sha256: file.sha256 ?? null,
      ...(file.state ? { state: file.state } : {}),
      ...(file.size === undefined ? {} : { size: file.size }),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/**
 * Deterministic fingerprint over the reviewed *content* only.
 *
 * Deliberately excludes the commit id, timestamps and worktree path: re-committing
 * unchanged bytes, or copying the same bytes into another checkout, is the same review
 * subject. Any byte change (or a file appearing/disappearing) changes the fingerprint.
 */
export function snapshotFingerprint(files: ReviewSnapshotFile[]): string {
  const normalized = sortFiles(files).map((file) => [file.path, file.sha256])
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

export function emptyChanges(): ReviewSnapshotChanges {
  return { staged: [], unstaged: [], untracked: [], deleted: [], renamed: [], rejected: [] }
}

export function emptyRefs(): ReviewSnapshotRefs {
  return { diffArtifactId: null, artifactIds: [], evidenceIds: [] }
}

export function emptyScope(): ReviewSnapshotScope {
  return { roots: [], reviewedObjects: [], expanded: false }
}

/** Full v2 snapshot builder. */
export function buildReviewSnapshot(input: ReviewSnapshotInput): ReviewSnapshot {
  const files = sortFiles(input.files)
  return {
    schemaVersion: REVIEW_SNAPSHOT_SCHEMA_VERSION,
    projectId: input.projectId ?? null,
    planId: input.planId ?? null,
    taskId: input.taskId ?? null,
    runId: input.runId ?? null,
    worktree: input.worktree ?? null,
    baselineCommit: input.baselineCommit ?? null,
    scope: input.scope ?? emptyScope(),
    files,
    changes: input.changes ?? emptyChanges(),
    refs: input.refs ?? emptyRefs(),
    reviewer: input.reviewer ?? null,
    capturedAt: input.capturedAt ?? Date.now(),
    fingerprint: snapshotFingerprint(files),
  }
}

/** Back-compat helper kept for callers that only have a commit and a file list. */
export function buildSnapshot(baselineCommit: string | null, files: ReviewSnapshotFile[]): ReviewSnapshot {
  return buildReviewSnapshot({ baselineCommit, files })
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readChanges(value: unknown): ReviewSnapshotChanges {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const renamed = Array.isArray(record.renamed)
    ? record.renamed
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => ({ from: typeof item.from === 'string' ? item.from : '', to: typeof item.to === 'string' ? item.to : '' }))
    : []
  return {
    staged: stringArray(record.staged),
    unstaged: stringArray(record.unstaged),
    untracked: stringArray(record.untracked),
    deleted: stringArray(record.deleted),
    renamed,
    rejected: stringArray(record.rejected),
  }
}

function readRefs(value: unknown): ReviewSnapshotRefs {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    diffArtifactId: typeof record.diffArtifactId === 'string' ? record.diffArtifactId : null,
    artifactIds: stringArray(record.artifactIds),
    evidenceIds: stringArray(record.evidenceIds),
  }
}

function readWorktree(value: unknown): ReviewWorktreeIdentity | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.root !== 'string' || !record.root) return null
  return {
    root: record.root,
    branch: typeof record.branch === 'string' ? record.branch : null,
    head: typeof record.head === 'string' ? record.head : null,
    isWorktree: record.isWorktree === true,
  }
}

function readReviewer(value: unknown): ReviewReviewerIdentity | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.agentId !== 'string' || !record.agentId) return null
  return { agentId: record.agentId, name: typeof record.name === 'string' ? record.name : record.agentId }
}

function readScope(value: unknown): ReviewSnapshotScope {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    roots: stringArray(record.roots),
    reviewedObjects: stringArray(record.reviewedObjects),
    expanded: record.expanded === true,
  }
}

/** Parses a stored (possibly v1) snapshot. Returns null when it is not a snapshot at all. */
export function readSnapshot(value: unknown): ReviewSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.fingerprint !== 'string') return null
  const files = Array.isArray(record.files)
    ? record.files
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => ({
          path: typeof item.path === 'string' ? item.path : '',
          sha256: typeof item.sha256 === 'string' ? item.sha256 : null,
          ...(item.state === 'tracked' || item.state === 'untracked' ? { state: item.state as ReviewSnapshotFileState } : {}),
          ...(typeof item.size === 'number' ? { size: item.size } : {}),
        }))
        .filter((item) => item.path.length > 0)
    : []
  return {
    schemaVersion: typeof record.schemaVersion === 'number' ? record.schemaVersion : 1,
    projectId: typeof record.projectId === 'string' ? record.projectId : null,
    planId: typeof record.planId === 'string' ? record.planId : null,
    taskId: typeof record.taskId === 'string' ? record.taskId : null,
    runId: typeof record.runId === 'string' ? record.runId : null,
    worktree: readWorktree(record.worktree),
    baselineCommit: typeof record.baselineCommit === 'string' ? record.baselineCommit : null,
    scope: readScope(record.scope),
    files,
    changes: readChanges(record.changes),
    refs: readRefs(record.refs),
    reviewer: readReviewer(record.reviewer),
    capturedAt: typeof record.capturedAt === 'number' ? record.capturedAt : 0,
    fingerprint: record.fingerprint,
  }
}

/**
 * True only when the stored snapshot still describes the current content.
 * A missing or malformed snapshot never matches — fail closed.
 */
export function snapshotMatches(stored: unknown, current: ReviewSnapshot | null): boolean {
  const left = readSnapshot(stored)
  if (!left || !current) return false
  return left.fingerprint === current.fingerprint
}

/**
 * Explains *why* a stored snapshot no longer matches, for diagnostics and the UI.
 * Returns `null` when it matches or when the stored value is not a snapshot.
 */
export function snapshotMismatch(stored: unknown, current: ReviewSnapshot | null): string | null {
  const left = readSnapshot(stored)
  if (!left) return '审查没有可校验的内容快照'
  if (!current) return '无法重新采集当前内容快照'
  if (left.fingerprint === current.fingerprint) return null
  const before = new Map(left.files.map((file) => [file.path, file.sha256]))
  const after = new Map(current.files.map((file) => [file.path, file.sha256]))
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
    (path) => (before.get(path) ?? null) !== (after.get(path) ?? null),
  )
  if (changed.length === 0) return '审查快照指纹与当前内容不一致'
  return `审查内容已变化：${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ` 等 ${changed.length} 个文件` : ''}`
}

/** Short human-readable label, e.g. `3 files · a1b2c3d`. */
export function describeSnapshot(snapshot: ReviewSnapshot | null): string {
  if (!snapshot) return '无快照'
  const dirty = snapshot.changes.untracked.length + snapshot.changes.unstaged.length + snapshot.changes.staged.length
  return `${snapshot.files.length} files · ${snapshot.fingerprint.slice(0, 8)}${dirty > 0 ? ` · ${dirty} dirty` : ''}`
}
