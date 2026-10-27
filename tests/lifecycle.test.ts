import { afterEach, describe, expect, it } from 'vitest'
import { LifecycleService } from '../apps/runtime/src/lifecycle.js'
import { createGitProject, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

describe('V25 lifecycle domain', () => {
  it('creates default product/version/environment/focus with a project', async () => {
    const harness = setup()
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'Lifecycle Defaults')
    const lifecycle = new LifecycleService(harness.store)
    const overview = lifecycle.overview(project.id)
    expect(overview.products).toHaveLength(1)
    expect(overview.versions).toHaveLength(1)
    expect(overview.versions[0]?.version).toBe('0.1.0')
    expect(overview.versions[0]?.isDefault).toBe(true)
    expect(overview.environments.map((item) => item.key)).toContain('local')
    expect(overview.focus?.subjectType).toBe('version')
    expect(overview.focus?.subjectId).toBe(overview.versions[0]?.id)
    expect(overview.posture.productCount).toBe(1)
    expect(overview.posture.activeVersionCount).toBe(1)
  })

  it('supports parallel versions, iterations, environments and focus without currentStage', async () => {
    const harness = setup()
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'Lifecycle Parallel')
    const lifecycle = new LifecycleService(harness.store)
    const overview = lifecycle.overview(project.id)
    const productId = overview.products[0]!.id
    const v2 = lifecycle.createVersion({
      projectId: project.id,
      productId,
      version: '1.1.0',
      phase: 'planned',
      isDefault: true,
    })
    const v3 = lifecycle.createVersion({
      projectId: project.id,
      productId,
      version: '2.0.0',
      phase: 'planned',
      isDefault: false,
    })
    const discovery = lifecycle.transitionVersion({ versionId: v2.id, to: 'discovery' })
    expect(discovery.phase).toBe('discovery')
    expect(() => lifecycle.transitionVersion({ versionId: v2.id, to: 'released' })).toThrow(/不能从/)
    const iteration = lifecycle.createIteration({
      projectId: project.id,
      versionId: v2.id,
      name: 'M1 slice',
      goal: 'Ship one real workflow',
    })
    expect(iteration.status).toBe('planned')
    const active = lifecycle.setIterationStatus(iteration.id, 'active')
    expect(active.status).toBe('active')
    const staging = lifecycle.createEnvironment({
      projectId: project.id,
      key: 'staging',
      name: 'Staging',
      kind: 'staging',
      protected: true,
    })
    expect(staging.protected).toBe(true)
    const focus = lifecycle.setFocus({
      projectId: project.id,
      subjectType: 'version',
      subjectId: v3.id,
    })
    expect(focus.subjectId).toBe(v3.id)
    const next = lifecycle.overview(project.id)
    expect(next.versions).toHaveLength(3)
    expect(next.iterations).toHaveLength(1)
    expect(next.environments).toHaveLength(2)
    expect(next.posture.iterationCount).toBe(1)
    expect(next.posture.environmentCount).toBe(2)
    expect(harness.store.read.getProject(project.id)?.currentStage).toBe(project.currentStage)
  })
})
