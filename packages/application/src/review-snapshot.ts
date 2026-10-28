import { createHash } from 'node:crypto'

/**
 * ADR-0025 — a review must be bound to the *content* it reviewed, not just to a commit.
 *
 * An Agent working in a worktree can rewrite files without committing; `git rev-parse HEAD`
 * then stays identical while the actual code changes. A trusted ReviewSnapshot therefore
 * records, for the reviewed scope only:
 *
 *   - the git baseline commit (informational),
 *   - every reviewed path with the SHA-256 of its bytes (or `null` when it does not exist),
 *   - a single fingerprint over those entries.
 *
 * The snapshot is produced by the runtime by reading real files. Agents never supply
 * hashes: whatever an Agent writes into `metadata.reviewSnapshot` is ignored and replaced.
 */

export interface ReviewSnapshotFile {
  /** Path relative to the workspace root, using forward slashes. */
  path: string
  /** SHA-256 of the file bytes, or null when the file does not exist (deleted/never created). */
  sha256: string | null
}

export interface ReviewSnapshot {
  baselineCommit: string | null
  files: ReviewSnapshotFile[]
  fingerprint: string
}

/** Deterministic fingerprint over baseline commit + reviewed file hashes. */
export function snapshotFingerprint(baselineCommit: string | null, files: ReviewSnapshotFile[]): string {
  const normalized = [...files]
    .map((file) => ({ path: file.path.replace(/\\/g, '/'), sha256: file.sha256 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const payload = JSON.stringify({ baselineCommit: baselineCommit ?? null, files: normalized })
  return createHash('sha256').update(payload).digest('hex')
}

export function buildSnapshot(baselineCommit: string | null, files: ReviewSnapshotFile[]): ReviewSnapshot {
  const normalized = files
    .map((file) => ({ path: file.path.replace(/\\/g, '/'), sha256: file.sha256 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { baselineCommit, files: normalized, fingerprint: snapshotFingerprint(baselineCommit, normalized) }
}

function readSnapshot(value: unknown): ReviewSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.fingerprint !== 'string') return null
  const files = Array.isArray(record.files)
    ? record.files
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => ({
          path: typeof item.path === 'string' ? item.path : '',
          sha256: typeof item.sha256 === 'string' ? item.sha256 : null,
        }))
    : []
  return {
    baselineCommit: typeof record.baselineCommit === 'string' ? record.baselineCommit : null,
    files,
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

/** Short human-readable label, e.g. `3 files · a1b2c3d`. */
export function describeSnapshot(snapshot: ReviewSnapshot | null): string {
  if (!snapshot) return '无快照'
  return `${snapshot.files.length} files · ${snapshot.fingerprint.slice(0, 8)}`
}
