import { describe, expect, it } from 'vitest'
import { setup } from './helpers/r1-fixture.js'

describe('ADR-0091 opt-in demo showcase seeds', () => {
  it('seeds decided approval history across days, idempotently, without touching pending ones', async () => {
    const { seedDemo, seedDemoReviewHistory } = await import('../apps/runtime/src/demo.js')
    const harness = setup()
    try {
      const seeded = await seedDemo({ store: harness.store, dataDir: harness.dataDir })
      const pendingBefore = harness.store.read.listApprovalViews(seeded.projectId).filter((a) => a.status === 'pending').length
      expect(seedDemoReviewHistory(harness.store, seeded.projectId)).toBe(9)
      expect(seedDemoReviewHistory(harness.store, seeded.projectId)).toBe(0)
      const views = harness.store.read.listApprovalViews(seeded.projectId)
      expect(views.filter((a) => a.status === 'pending').length).toBe(pendingBefore)
      const decided = views.filter((a) => a.status !== 'pending')
      expect(new Set(decided.map((a) => a.status))).toEqual(new Set(['approved', 'rejected', 'expired']))
      expect(decided.every((a) => a.decidedAt !== null && a.decidedAt > a.requestedAt)).toBe(true)
      const days = new Set(decided.map((a) => new Date(a.decidedAt!).toDateString()))
      expect(days.size).toBeGreaterThan(1)
      const delivery = harness.store.db.prepare("SELECT status FROM approval_requests WHERE project_id = ? AND status != 'pending'").all(seeded.projectId)
      expect(delivery).toHaveLength(2)
    } finally {
      harness.close()
    }
  })

  it('seeds resources with profiles and real-shaped test history, idempotently', async () => {
    const { seedDemo, seedDemoResources } = await import('../apps/runtime/src/demo.js')
    const harness = setup()
    try {
      const seeded = await seedDemo({ store: harness.store, dataDir: harness.dataDir })
      expect(seedDemoResources(harness.store, seeded.projectId)).toBe(5)
      expect(seedDemoResources(harness.store, seeded.projectId)).toBe(0)
      const profiles = harness.store.db.prepare('SELECT p.last_test_status AS s FROM connection_profiles p JOIN resources r ON r.id = p.resource_id WHERE r.project_id = ?').all(seeded.projectId) as Array<{ s: string }>
      expect(profiles.map((p) => p.s).sort()).toEqual(['connected', 'connected', 'host_key_mismatch'])
    } finally {
      harness.close()
    }
  })
  it('binds one untouched requirement to the standard flow without starting it (opt-in flow seed)', async () => {
    const { seedDemo, seedDemoFlow } = await import('../apps/runtime/src/demo.js')
    const harness = setup()
    try {
      const seeded = await seedDemo({ store: harness.store, dataDir: harness.dataDir })
      const calls: Array<{ method: string; input: Record<string, unknown> }> = []
      const dispatch = async (method: string, input: unknown): Promise<unknown> => {
        calls.push({ method, input: input as Record<string, unknown> })
        if (method === 'workflow.templates') return { templates: [{ versionId: 'wfv_review1' }, { versionId: 'wfv_standard1' }] }
        return {}
      }
      const requirementId = await seedDemoFlow(dispatch, harness.store, seeded.projectId)
      expect(requirementId).toBeTruthy()
      const busy = harness.store.read.listTasks(seeded.projectId)
        .filter((task) => task.requirementId === requirementId && ['done', 'running', 'review', 'blocked'].includes(task.status))
      expect(busy).toHaveLength(0)
      const bind = calls.find((call) => call.method === 'requirement.flow.bind')
      expect(bind?.input).toMatchObject({ requirementId, templateVersionId: 'wfv_standard1', assignmentMode: 'manual' })
      expect(calls.some((call) => /start|run|approve/.test(call.method))).toBe(false)
    } finally {
      harness.close()
    }
  })
})
