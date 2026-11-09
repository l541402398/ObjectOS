import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { now, type PlanDraft } from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'

/**
 * ADR-0089 fixture: create the isolated Worktree ObjectOS itself would create for a plan
 * (`<dataDir>/worktrees/<projectId>/<planId>` on branch `projectos/plan-<planId>`) and persist it
 * on the plan execution, exactly like Orchestrator.ensureWorkspace does.
 */
export function attachPlanWorktree(store: SqliteStore, planId: string, projectRoot: string, dataDir: string): string {
  const plan = store.read.getPlanRevision(planId) as PlanDraft
  const worktree = join(dataDir, 'worktrees', plan.projectId, plan.id)
  const branch = `projectos/plan-${plan.id}`
  mkdirSync(dirname(worktree), { recursive: true })
  execFileSync('git', ['worktree', 'add', '-q', '-b', branch, worktree, 'HEAD'], { cwd: projectRoot })
  store.updatePlanRevision({
    ...plan,
    execution: {
      status: 'running',
      concurrency: 1,
      startedAt: now(),
      updatedAt: now(),
      error: null,
      runIds: [],
      allowedPaths: ['.'],
      diffArtifactId: null,
      mergedAt: null,
      maxRetries: 2,
      retries: {},
      nextAttemptAt: {},
      retryForRun: {},
      maxEvidenceRetries: 1,
      evidenceRetries: {},
      evidenceRetryForRun: {},
      requireWorktree: true,
      qualityReport: null,
      qualityGate: null,
      ...(plan.execution ?? {}),
      workspaceRef: worktree,
      branch,
    } as never,
  })
  return worktree
}
