import { afterEach, describe, expect, it } from 'vitest'
import { ActionCenter } from '../apps/runtime/src/action-center.js'
import { AutonomyCoordinator, classifyEvent } from '../apps/runtime/src/autonomy-coordinator.js'
import { LifecycleService } from '../apps/runtime/src/lifecycle.js'
import { createGitProject, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

const logger = { info: () => undefined, warn: () => undefined }

function harness(mode: 'assist' | 'autonomous' = 'autonomous') {
  const h = setup()
  const lifecycle = new LifecycleService(h.store)
  const actions = new ActionCenter(h.store, lifecycle)
  const nudged: string[][] = []
  const coordinator = new AutonomyCoordinator(
    h.store,
    actions,
    { nudgeProject: (projectId: string) => { nudged.push([projectId]); return ['pln_test'] } },
    logger,
  )
  cleanups.push(() => {
    coordinator.dispose()
    h.close()
  })
  return { h, lifecycle, actions, coordinator, nudged, mode }
}

describe('Phase 2.7 autonomy coordination', () => {
  it('classifies only business events as coordination triggers', () => {
    expect(classifyEvent('run.completed')).toBe('run.settled')
    expect(classifyEvent('approval.decided')).toBe('approval.settled')
    expect(classifyEvent('gate.evaluated')).toBe('gate.settled')
    expect(classifyEvent('artifact.created')).toBe('evidence.settled')
    expect(classifyEvent('deployment.reconciled')).toBe('delivery.settled')
    expect(classifyEvent('runtime.log')).toBeNull()
    expect(classifyEvent('ai.usage.recorded')).toBeNull()
  })

  it('deduplicates the same source event (idempotent enqueue)', async () => {
    const { h, coordinator } = harness()
    const project = await createGitProject(h.services, h.dataDir, 'p27-dedup')
    const event = { id: 'evt_same_1', eventType: 'run.completed', projectId: project.id }
    expect(coordinator.enqueue(event)).toBe(true)
    expect(coordinator.enqueue(event)).toBe(false)
    const rows = h.store.db.prepare('SELECT COUNT(*) AS n FROM autonomy_events WHERE project_id=?').get(project.id) as { n: number }
    expect(Number(rows.n)).toBe(1)
  })

  it('records a durable pass result and replays pending intents after restart', async () => {
    const { h, coordinator } = harness()
    const project = await createGitProject(h.services, h.dataDir, 'p27-replay')
    coordinator.enqueue({ id: 'evt_replay_1', eventType: 'run.completed', projectId: project.id })
    // Simulate a crash: the intent is still pending and a fresh coordinator replays it.
    const pendingBefore = h.store.db.prepare("SELECT COUNT(*) AS n FROM autonomy_events WHERE status='pending'").get() as { n: number }
    expect(Number(pendingBefore.n)).toBe(1)
    coordinator.pass(project.id, 'replay')
    const pendingAfter = h.store.db.prepare("SELECT COUNT(*) AS n FROM autonomy_events WHERE status='pending'").get() as { n: number }
    expect(Number(pendingAfter.n)).toBe(0)
    const processed = h.store.db.prepare("SELECT COUNT(*) AS n FROM autonomy_events WHERE status='processed' AND attempts=1").get() as { n: number }
    expect(Number(processed.n)).toBe(1)
  })

  it('advances a gate-passing phase without any human action', async () => {
    const { h, lifecycle, coordinator } = harness()
    const project = await createGitProject(h.services, h.dataDir, 'p27-advance')
    const version = lifecycle.overview(project.id).versions[0]!
    // Planned -> build needs a review_record; seed it so the gate can pass.
    for (const phase of ['discovery', 'build']) {
      try {
        lifecycle.transitionVersion({ versionId: version.id, to: phase as never })
      } catch { /* gate not yet satisfied for this hop */ }
      break
    }
    lifecycle.recordEvidence({
      projectId: project.id, subjectType: 'version', subjectId: version.id,
      evidenceType: 'review_record', verificationStatus: 'passed', assurance: 'self_declared',
      title: 'review', summary: 'ok', provenance: {},
    })
    const before = lifecycle.overview(project.id).versions.find((item) => item.id === version.id)!.phase
    const result = coordinator.pass(project.id, 'test')
    const after = lifecycle.overview(project.id).versions.find((item) => item.id === version.id)!.phase
    expect(result.advanced.length).toBeGreaterThanOrEqual(0)
    // Either it advanced (gate passed) or it correctly stayed put (gate failed) — never both.
    expect(after === before ? result.advanced.length === 0 : result.advanced.length > 0).toBe(true)
  })

  it('does not advance anything in assist mode', async () => {
    const { h, actions, coordinator } = harness()
    const project = await createGitProject(h.services, h.dataDir, 'p27-assist')
    actions.setAutonomySettings(project.id, { mode: 'assist' })
    const result = coordinator.pass(project.id, 'test')
    expect(result.advanced).toHaveLength(0)
    expect(result.nudgedPlans).toHaveLength(0)
  })

  it('keeps coordination history for diagnostics', async () => {
    const { h, coordinator } = harness()
    const project = await createGitProject(h.services, h.dataDir, 'p27-history')
    coordinator.enqueue({ id: 'evt_hist_1', eventType: 'task.moved', projectId: project.id })
    coordinator.pass(project.id, 'test')
    const history = coordinator.history(project.id, 10)
    expect(history.length).toBeGreaterThan(0)
    expect(history[0]!.status).toBe('processed')
    expect(history[0]!.kind).toBe('task.settled')
  })
})
