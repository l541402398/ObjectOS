import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'
import { AppError, newId, now } from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'

/**
 * Trusted file baselines for write approvals.
 *
 * The renderer diff is presentation only: it is rendered from whatever the workspace
 * looks like when the panel opens. These snapshots are what actually authorise a write.
 * A snapshot records, at approval creation time:
 *   - the baseline hash of the target file (null when the file does not exist)
 *   - the hash and content of what the tool intends to write
 * Both are re-verified before the decision is accepted and again right before the write.
 */

export const MAX_SNAPSHOT_BYTES = 512 * 1024

export interface FileTarget {
  path: string
  changeType: 'added' | 'modified' | 'deleted'
  baselineHash: string | null
  proposedHash: string
  truncated: boolean
}

export function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function hashFileOrNull(absolutePath: string): string | null {
  if (!existsSync(absolutePath)) return null
  try {
    return createHash('sha256').update(readFileSync(absolutePath)).digest('hex')
  } catch {
    return null
  }
}

export function resolveWriteTarget(projectRoot: string, rawPath: string): string {
  const rootResolved = resolve(projectRoot)
  const full = isAbsolute(rawPath) ? resolve(rawPath) : resolve(rootResolved, rawPath)
  if (full !== rootResolved && !full.startsWith(rootResolved + sep)) {
    throw new AppError('POLICY_DENIED', '写入路径越出项目根目录，拒绝生成审批快照')
  }
  return full
}

/** Stable identifier the approver sees; it pins baseline + proposed content. */
export function snapshotFingerprint(target: FileTarget): string {
  return createHash('sha256')
    .update(`${target.path}\u0000${target.baselineHash ?? 'absent'}\u0000${target.proposedHash}`)
    .digest('hex')
    .slice(0, 32)
}

type StoreLike = Pick<SqliteStore, 'db'>

export interface WritePlan {
  path: string
  content: string
  target: FileTarget
  fingerprint: string
  summary: Record<string, unknown>
}

/**
 * Computes what an approval would authorise, without touching the database yet.
 * Returns null when the invocation is not a plain workspace file write.
 */
export function planWriteSnapshot(projectRoot: string, args: Record<string, unknown>): WritePlan | null {
  if (typeof args.path !== 'string' || typeof args.content !== 'string') return null
  const absolute = resolveWriteTarget(projectRoot, args.path)
  const baselineHash = hashFileOrNull(absolute)
  const proposedHash = hashText(args.content)
  const target: FileTarget = {
    path: args.path,
    changeType: baselineHash === null ? 'added' : 'modified',
    baselineHash,
    proposedHash,
    truncated: args.content.length > MAX_SNAPSHOT_BYTES,
  }
  const fingerprint = snapshotFingerprint(target)
  return {
    path: args.path,
    content: args.content,
    target,
    fingerprint,
    summary: {
      fingerprint,
      path: target.path,
      changeType: target.changeType,
      baselineHash: target.baselineHash,
      proposedHash: target.proposedHash,
      truncated: target.truncated,
      proposedBytes: args.content.length,
    },
  }
}

/** Persists a previously planned snapshot against the approval that now exists. */
export function persistWriteSnapshot(
  store: StoreLike,
  approvalId: string,
  projectRoot: string,
  plan: WritePlan,
): void {
  const absolute = resolveWriteTarget(projectRoot, plan.path)
  const truncated = plan.content.length > MAX_SNAPSHOT_BYTES
  const baselineContent = plan.target.baselineHash === null || !existsSync(absolute)
    ? null
    : readFileSync(absolute, 'utf8').slice(0, MAX_SNAPSHOT_BYTES)
  const timestamp = now()
  store.db
    .prepare(
      `INSERT OR REPLACE INTO approval_file_targets
       (id, approval_id, path, change_type, baseline_hash, proposed_hash, baseline_bytes, proposed_bytes, truncated, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId('aft'),
      approvalId,
      plan.path,
      plan.target.changeType,
      plan.target.baselineHash,
      plan.target.proposedHash,
      baselineContent === null ? null : baselineContent.length,
      plan.content.length,
      truncated ? 1 : 0,
      timestamp,
    )
  store.db
    .prepare(
      `INSERT OR REPLACE INTO approval_file_snapshots (approval_id, path, baseline_content, proposed_content, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(approvalId, plan.path, baselineContent, plan.content.slice(0, MAX_SNAPSHOT_BYTES), timestamp)
}

/**
 * Records the baseline, the proposed content and a display snapshot for one write.
 * Returns the fingerprint that the approval request must carry.
 */
export function captureWriteSnapshot(
  store: StoreLike,
  input: { approvalId: string; projectRoot: string; path: string; content: string },
): { target: FileTarget; fingerprint: string } {
  const plan = planWriteSnapshot(input.projectRoot, { path: input.path, content: input.content })
  if (!plan) throw new AppError('BAD_REQUEST', '无法为写入生成审批快照')
  persistWriteSnapshot(store, input.approvalId, input.projectRoot, plan)
  return { target: plan.target, fingerprint: plan.fingerprint }
}

export interface StoredTarget {
  path: string
  changeType: string
  baselineHash: string | null
  proposedHash: string
  truncated: boolean
}

export function listApprovalFileTargets(store: StoreLike, approvalId: string): StoredTarget[] {
  const rows = store.db
    .prepare('SELECT path, change_type, baseline_hash, proposed_hash, truncated FROM approval_file_targets WHERE approval_id=? ORDER BY path')
    .all(approvalId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    path: String(row.path),
    changeType: String(row.change_type),
    baselineHash: row.baseline_hash ? String(row.baseline_hash) : null,
    proposedHash: String(row.proposed_hash),
    truncated: Number(row.truncated) === 1,
  }))
}

/**
 * Re-checks that every recorded target still matches the baseline the approver saw.
 * Throws when the workspace moved underneath the approval (TOCTOU).
 */
export function assertApprovalSnapshotValid(
  store: StoreLike,
  approvalId: string,
  projectRoot: string,
): void {
  const targets = listApprovalFileTargets(store, approvalId)
  if (targets.length === 0) return
  const drifted: string[] = []
  for (const target of targets) {
    const absolute = resolveWriteTarget(projectRoot, target.path)
    const current = hashFileOrNull(absolute)
    if (current !== target.baselineHash) drifted.push(target.path)
  }
  if (drifted.length > 0) {
    throw new AppError(
      'CONFLICT',
      `审批快照已过期：${drifted.join('、')} 在审批后被修改（或删除/新建），请重新发起审批`,
      { details: { driftedPaths: drifted } },
    )
  }
}
