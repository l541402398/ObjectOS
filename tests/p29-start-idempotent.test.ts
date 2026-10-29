import { afterEach, describe, expect, it } from 'vitest'
import { now } from '@projectos/contracts'
import { PlanGrantService } from '../apps/runtime/src/plan-grant.js'
import { createGitProject, logger, planWithTasks, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function task(key: string) {
  return {
    key,
    title: `任务 ${key}`,
    description: `完成 ${key}`,
    role: 'developer',
    dependsOn: [],
    acceptanceCriteria: ['完成'],
    expectedArtifacts: ['代码 diff'],
    rationale: 'fixture',
    requiresApproval: false,
  }
}

/**
 * ADR-0060 — the autonomous starter and a manual click can race. A second start while the plan is
 * already running must be a no-op that returns the running plan, never a second execution.
 */
describe('ADR-0060 start is idempotent while a plan is running', () => {
  it('returns the running plan instead of throwing or starting again', async () => {
    const harness = setup(undefined, { providerConfig: {} })
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'p29-idempotent-start')
    const grants = new PlanGrantService(harness.store, logger)
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('impl')])
    grants.issue({
      planId: plan.id,
      actions: ['plan.start'],
      allowedPaths: [],
      maxRuns: 2,
      maxToolCalls: 40,
      ttlHours: 1,
      allowOverBudget: false,
      note: 'fixture',
      confirm: true,
    })
    const approved = harness.store.read.getPlanRevision(plan.id)!
    harness.store.updatePlanRevision({
      ...approved,
      execution: {
        ...(approved.execution ?? {}),
        status: 'running',
        concurrency: 1,
        startedAt: now(),
        updatedAt: now(),
        error: null,
        runIds: [],
        workspaceRef: '/tmp/ws',
        branch: 'projectos/plan-x',
        baseBranch: 'master',
        baseCommit: 'abc',
        allowedPaths: ['.'],
        diffArtifactId: null,
        mergedAt: null,
        maxRetries: 1,
        retries: {},
        nextAttemptAt: {},
        retryForRun: {},
        maxEvidenceRetries: 1,
        evidenceRetries: {},
        deadlineAt: 0,
        budgetExhausted: null,
        maxWallClockMs: 0,
        deliveryStatus: 'none',
      },
      updatedAt: now(),
    } as never)

    const result = await harness.scheduler.start(plan.id, 1, 0)
    expect(result.id).toBe(plan.id)
    expect(result.execution?.status).toBe('running')
    // No duplicate run was added by the no-op start.
    expect(result.execution?.runIds ?? []).toHaveLength(0)
  })
})
