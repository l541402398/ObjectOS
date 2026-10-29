import { execFileSync } from 'node:child_process'
import type { PlanDraft } from '@projectos/contracts'
import {
  isVerificationCommand,
  resolveReviewEvidence,
  resolveTestEvidence,
  type EvidenceArtifactInput,
  type MutationMark,
  type TestEvidenceResolution,
  type VerificationCheck,
  type ReviewEvidenceResolution,
} from '@projectos/application'
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
 * ADR-0047 — collect the raw verification facts of a plan once, then let the shared resolver decide.
 *
 * Checks are real completed `run_tests`/verification `run_command` calls with a numeric exit code;
 * mutations are completed `write_file` calls (a later pass that predates a write tested older code);
 * artifacts carry the fingerprint they claimed, and `currentFingerprintFor` recomputes that same
 * scope against the workspace as it exists now (the ReviewSnapshot machinery, ADR-0025).
 */
export interface PlanVerificationFacts {
  checks: VerificationCheck[]
  mutations: MutationMark[]
  artifacts: EvidenceArtifactInput[]
}

export function collectPlanVerification(store: SqliteStore, plan: PlanDraft): PlanVerificationFacts {
  const checks: VerificationCheck[] = []
  const mutations: MutationMark[] = []
  const runs = store.db
    .prepare("SELECT id, created_at FROM agent_runs WHERE task_id IN (SELECT value FROM json_each(?)) ORDER BY created_at ASC")
    .all(JSON.stringify(plan.createdTaskIds)) as Array<{ id: string; created_at: number }>
  for (const runRow of runs) {
    for (const call of store.read.getToolCalls(runRow.id)) {
      if (call.status !== 'completed') continue
      const at = (call.finishedAt ?? call.startedAt ?? call.createdAt ?? runRow.created_at) as number
      const command = typeof call.args?.command === 'string' ? call.args.command.trim() : ''
      if (call.toolName === 'write_file') {
        mutations.push({ kind: 'write', at, detail: typeof call.args?.path === 'string' ? call.args.path : undefined })
        continue
      }
      if (!command || !isVerificationCommand(call.toolName, command)) continue
      const result = (call.result ?? {}) as Record<string, unknown>
      const exitCode = typeof result.exitCode === 'number' ? result.exitCode : typeof result.code === 'number' ? result.code : null
      if (exitCode === null) continue
      checks.push({ id: call.id, runId: runRow.id, toolName: call.toolName as VerificationCheck['toolName'], command, exitCode, at })
    }
  }

  const artifacts: EvidenceArtifactInput[] = []
  for (const taskId of plan.createdTaskIds) {
    for (const artifact of store.read.listArtifacts(plan.projectId, taskId)) {
      if (artifact.kind !== 'test-report') continue
      const metadata = (artifact.metadata ?? {}) as Record<string, unknown>
      const snapshot = metadata.reviewSnapshot as { fingerprint?: unknown } | undefined
      const declaredBy =
        metadata.createdBy === 'user'
          ? 'user'
          : metadata.createdBy === 'model' || metadata.declaredBy === 'model'
            ? 'model'
            : artifact.runId
              ? 'execution'
              : 'unknown'
      const commands = Array.isArray(metadata.commands)
        ? metadata.commands.filter((item): item is string => typeof item === 'string')
        : typeof metadata.command === 'string'
          ? [metadata.command]
          : []
      artifacts.push({
        id: artifact.id,
        kind: artifact.kind,
        runId: artifact.runId,
        verifiedAt: artifact.verifiedAt,
        createdAt: artifact.createdAt,
        contentFingerprint:
          typeof snapshot?.fingerprint === 'string'
            ? snapshot.fingerprint
            : typeof metadata.contentFingerprint === 'string'
              ? metadata.contentFingerprint
              : null,
        declaredBy: declaredBy as EvidenceArtifactInput['declaredBy'],
        commands,
        metadata,
      } as EvidenceArtifactInput & { metadata: Record<string, unknown> })
    }
  }

  return { checks, mutations, artifacts }
}

/** Trusted test evidence for the plan, resolved against the workspace as it exists now. */
export function planTestEvidence(store: SqliteStore, plan: PlanDraft): TestEvidenceResolution {
  const facts = collectPlanVerification(store, plan)
  const root = plan.execution?.workspaceRef ?? null
  return resolveTestEvidence({
    checks: facts.checks,
    mutations: facts.mutations,
    artifacts: facts.artifacts,
    currentFingerprintFor: (artifact) => {
      const metadata = (artifact as EvidenceArtifactInput & { metadata?: Record<string, unknown> }).metadata ?? {}
      if (!root) return null
      const snapshot = recollectForReview(root, metadata)
      return snapshot?.fingerprint ?? null
    },
  })
}

/**
 * Real check failures that still describe the current content. Kept as a thin projection of the
 * shared resolver so the scheduler, autopilot and delivery gate cannot disagree about "failing".
 */
export function failingVerifications(store: SqliteStore, plan: PlanDraft): Array<{ command: string; exitCode: number }> {
  const resolution = planTestEvidence(store, plan)
  if (resolution.state !== 'failed' || !resolution.lastFailure) return []
  return [{ command: resolution.lastFailure.command, exitCode: resolution.lastFailure.exitCode }]
}
