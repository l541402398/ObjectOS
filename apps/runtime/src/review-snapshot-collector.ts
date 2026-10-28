import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { isAbsolute, join, normalize, sep } from 'node:path'
import { buildSnapshot, type ReviewSnapshot, type ReviewSnapshotFile } from '@projectos/application'

/**
 * ADR-0025 — trusted snapshot collection.
 *
 * The runtime (never the Agent) reads the real workspace files behind `reviewedObjects`
 * and hashes their bytes. Anything the Agent put into `metadata.reviewSnapshot` is
 * discarded, so a forged hash or revision cannot make a stale review look current.
 */

/** Rejects absolute paths and any path escaping the workspace root. */
function safeRelativePath(root: string, candidate: string): string | null {
  const cleaned = candidate.trim()
  if (!cleaned) return null
  if (isAbsolute(cleaned)) return null
  const resolved = normalize(join(root, cleaned))
  const normalizedRoot = normalize(root)
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + sep)) return null
  return resolved.slice(normalizedRoot.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
}

function fileHash(path: string): string | null {
  try {
    if (!existsSync(path)) return null
    const stat = statSync(path)
    // Symbolic links are not followed: their target could live outside the workspace.
    if (!stat.isFile()) return null
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return null
  }
}

export interface CollectOptions {
  workspaceRoot: string
  reviewedObjects: unknown
  /** Extra paths to include when the review covers a whole project. */
  extraPaths?: string[]
}

export function collectReviewSnapshot(options: CollectOptions): ReviewSnapshot {
  const root = options.workspaceRoot
  const requested = [
    ...(Array.isArray(options.reviewedObjects)
      ? options.reviewedObjects.filter((item): item is string => typeof item === 'string')
      : []),
    ...(options.extraPaths ?? []),
  ]
  const paths = new Set<string>()
  for (const candidate of requested) {
    const relative = safeRelativePath(root, candidate)
    // Commits, artifacts and prose are not files; they simply do not contribute bytes.
    if (relative) paths.add(relative)
  }
  const files: ReviewSnapshotFile[] = [...paths]
    .sort()
    .map((path) => ({ path, sha256: fileHash(join(root, path)) }))
  return buildSnapshot(baseCommit(root), files)
}

function baseCommit(root: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}
