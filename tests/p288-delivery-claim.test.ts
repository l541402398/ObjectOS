import { afterEach, describe, expect, it } from 'vitest'
import { createGitProject, planWithTasks, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

/**
 * ADR-0043 — one delivery per plan.
 *
 * A real closure run merged the same plan twice in one second (`fc846b5`, then `b352a3f`): two
 * autonomy passes both saw `execution.mergedAt === null`. The claim is an atomic compare-and-set, so
 * only one pass can win; a stale claim (crashed process) can be taken over after the grace window.
 */
describe('ADR-0043 single-flight delivery claim', () => {
  async function planWithExecution(status: 'completed' | 'running') {
    const harness = setup(undefined, { providerConfig: {} })
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'p288-claim')
    const created = planWithTasks(harness.orchestration, project.id, [
      {
        key: 'impl',
        title: '实现',
        description: '实现并使测试通过',
        role: 'developer',
        dependsOn: [],
        acceptanceCriteria: ['退出码 0'],
        expectedArtifacts: [],
        rationale: 'fixture',
        requiresApproval: false,
      },
    ])
    const revision = harness.store.read.getPlanRevision(created.plan.id)!
    const base = revision.execution ?? ({} as NonNullable<typeof revision.execution>)
    harness.store.updatePlanRevision({
      ...revision,
      execution: {
        ...base,
        status,
        concurrency: 2,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        error: null,
        runIds: [],
        workspaceRef: 'ws',
        branch: 'branch',
        baseBranch: 'master',
        baseCommit: 'abc',
        allowedPaths: ['.'],
        diffArtifactId: null,
        mergedAt: null,
        maxRetries: 2,
        retries: {},
        nextAttemptAt: {},
        retryForRun: {},
        maxEvidenceRetries: 1,
        evidenceRetries: {},
        deadlineAt: 0,
        budgetExhausted: null,
        maxWallClockMs: 0,
        deliveryStatus: 'none',
        deliveryClaimedAt: null,
        mergeCommit: null,
      },
      updatedAt: Date.now(),
    } as never)
    return { harness, plan: harness.store.read.getPlanRevision(created.plan.id)! }
  }

  it('lets exactly one claim win and blocks the second', async () => {
    const { harness, plan } = await planWithExecution('completed')
    const first = harness.store.claimPlanDelivery(plan.id)
    const second = harness.store.claimPlanDelivery(plan.id)
    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(harness.store.read.getPlanRevision(plan.id)!.execution?.deliveryClaimedAt).toBeTruthy()
  })

  it('allows a takeover only after the claim is stale', async () => {
    const { harness, plan } = await planWithExecution('completed')
    const claimedAt = Date.now()
    expect(harness.store.claimPlanDelivery(plan.id, claimedAt)).toBe(true)
    // A concurrent pass one second later loses.
    expect(harness.store.claimPlanDelivery(plan.id, claimedAt + 1_000)).toBe(false)
    // A pass eleven minutes later may take over.
    expect(harness.store.claimPlanDelivery(plan.id, claimedAt + 11 * 60_000)).toBe(true)
  })

  it('refuses to claim a plan that is already merged, and releases a failed attempt', async () => {
    const { harness, plan } = await planWithExecution('completed')
    expect(harness.store.claimPlanDelivery(plan.id)).toBe(true)
    harness.store.releasePlanDelivery(plan.id)
    expect(harness.store.read.getPlanRevision(plan.id)!.execution?.deliveryClaimedAt ?? null).toBeNull()
    expect(harness.store.claimPlanDelivery(plan.id)).toBe(true)

    const merged = harness.store.read.getPlanRevision(plan.id)!
    harness.store.updatePlanRevision({
      ...merged,
      execution: { ...merged.execution!, mergedAt: Date.now(), mergeCommit: 'abc123' },
      updatedAt: Date.now(),
    })
    harness.store.releasePlanDelivery(plan.id)
    expect(harness.store.claimPlanDelivery(plan.id)).toBe(false)
  })
})
