import { execFileSync } from 'node:child_process'
import type { PlanDraft } from '@projectos/contracts'
import { resolveReviewEvidence, type ReviewEvidenceResolution } from '@projectos/application'
import type { SqliteStore } from '@projectos/persistence'
import { recollectForReview } from './review-snapshot-collector.js'

/**
 * Shared plan-level evidence helpers (ADR-0024/0025).
 *
 * The scheduler and the autonomy pipeline must reach the same conclusion about "does this plan
 * have a current approving review and no failing check?". Keeping the collection here means a
 * second consumer cannot drift into its own, weaker rule.
 */

export interface ReviewCandidate {
  id: string
  title: string
  metadata: Record<string, unknown>
}

export function collectPlanReviewCandidates(store: SqliteStore, plan: PlanDraft): ReviewCandidate[] {
  const candidates: ReviewCandidate[] = []
  for (const taskId of plan.createdTaskIds) {
    for (const artifact of store.read.listArtifacts(plan.projectId, taskId)) {
      const metadata = (artifact.metadata ?? {}) as Record<string, unknown>
      if (metadata.artifactType !== 'review') continue
      candidates.push({ id: artifact.id, title: artifact.title, metadata })
    }
  }
  return candidates
}

export function planReviewEvidence(store: SqliteStore, plan: PlanDraft): ReviewEvidenceResolution {
  const root = plan.execution?.workspaceRef
  return resolveReviewEvidence(collectPlanReviewCandidates(store, plan), {
    currentRevision: workspaceRevision(root),
    snapshotFor: root ? (metadata) => recollectForReview(root, metadata) : undefined,
  })
}

/** HEAD of the plan's workspace, when it can be read. */
export function workspaceRevision(root: string | null | undefined): string | null {
  if (!root) return null
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

/**
 * Real, recorded check failures across the plan's runs. Only calls that actually executed and
 * reported an exit code count; a later passing run of the same command supersedes the older
 * failure so a genuine fix clears the signal.
 */
export function failingVerifications(store: SqliteStore, plan: PlanDraft): Array<{ command: string; exitCode: number }> {
  const latest = new Map<string, { command: string; exitCode: number; at: number }>()
  const runs = store.db
    .prepare("SELECT id, created_at FROM agent_runs WHERE task_id IN (SELECT value FROM json_each(?)) ORDER BY created_at ASC")
    .all(JSON.stringify(plan.createdTaskIds)) as Array<{ id: string; created_at: number }>
  for (const runRow of runs) {
    for (const call of store.read.getToolCalls(runRow.id)) {
      if (call.status !== 'completed') continue
      if (call.toolName !== 'run_tests' && call.toolName !== 'run_command') continue
      const cmdText = typeof call.args?.command === 'string' ? call.args.command.trim() : ''
      const isVerification =
        call.toolName === 'run_tests' ||
        /^(npm|pnpm|yarn)\s+(run\s+)?test\b/i.test(cmdText) ||
        /^(npx\s+)?(vitest|jest|mocha)\b/i.test(cmdText) ||
        /^node\s+--test\b/i.test(cmdText) ||
        /^(npm|pnpm|yarn)\s+run\s+(build|typecheck|lint)\b/i.test(cmdText) ||
        /^(npx\s+)?tsc\b/i.test(cmdText)
      if (!isVerification) continue
      const result = (call.result ?? {}) as Record<string, unknown>
      const exitCode = typeof result.exitCode === 'number' ? result.exitCode : typeof result.code === 'number' ? result.code : null
      if (exitCode === null) continue
      const command = typeof call.args?.command === 'string' ? call.args.command : call.toolName
      latest.set(command, { command, exitCode, at: call.startedAt ?? call.finishedAt ?? 0 })
    }
  }
  return [...latest.values()]
    .filter((item) => item.exitCode !== 0)
    .map(({ command, exitCode }) => ({ command, exitCode }))
}
