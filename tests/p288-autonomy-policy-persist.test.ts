import { afterEach, describe, expect, it } from 'vitest'
import { ActionCenter, autonomyPolicyUpdate } from '../apps/runtime/src/action-center.js'
import { LifecycleService } from '../apps/runtime/src/lifecycle.js'
import { createGitProject, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

/**
 * ADR-0041 — the autonomy policy API must persist every field it accepts.
 *
 * A real closure run enabled auto-delivery through `action.autonomy.set` and the setting silently
 * stayed `false`: the dispatcher forwarded only `mode` and `autoAdvancePhases`, so `autoDeliver`,
 * `autoStartPlans`, `autoApplyReplans` and `maxAutoReplans` were accepted by the contract and then
 * dropped. The plan then completed with no delivery attempt at all.
 */
describe('ADR-0041 autonomy policy persists all fields', () => {
  it('stores autoDeliver, autoStartPlans, autoApplyReplans and maxAutoReplans', async () => {
    const harness = setup(undefined, { providerConfig: {} })
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'p288-policy')
    const actions = new ActionCenter(harness.store, new LifecycleService(harness.store))

    const saved = actions.setAutonomySettings(project.id, {
      mode: 'autonomous',
      autoStartPlans: true,
      autoApplyReplans: true,
      autoDeliver: true,
      maxAutoReplans: 2,
    })
    expect(saved.autoDeliver).toBe(true)
    expect(saved.autoStartPlans).toBe(true)
    expect(saved.autoApplyReplans).toBe(true)
    expect(saved.maxAutoReplans).toBe(2)

    // Reading it back must be the same values the scheduler uses, not a default.
    const read = actions.autonomySettings(project.id)
    expect(read.autoDeliver).toBe(true)
    expect(read.maxAutoReplans).toBe(2)

    // Turning it off is also persisted (no stale true).
    const off = actions.setAutonomySettings(project.id, { mode: 'autonomous', autoDeliver: false })
    expect(off.autoDeliver).toBe(false)
    expect(actions.autonomySettings(project.id).autoDeliver).toBe(false)
  })
})

/**
 * The transport layer must forward the whole policy. This is the exact defect that made a real
 * closure run finish with `autoDeliver=false` while the user had enabled it.
 */
describe('ADR-0041 the policy update mapping forwards every accepted field', () => {
  it('keeps autoDeliver / autoStartPlans / autoApplyReplans / maxAutoReplans', () => {
    const update = autonomyPolicyUpdate({
      mode: 'autonomous',
      autoStartPlans: true,
      autoApplyReplans: true,
      autoDeliver: true,
      maxAutoReplans: 3,
    })
    expect(update).toEqual({
      mode: 'autonomous',
      autoStartPlans: true,
      autoApplyReplans: true,
      autoDeliver: true,
      maxAutoReplans: 3,
    })
  })

  it('does not invent fields that were not sent (partial updates stay partial)', () => {
    const update = autonomyPolicyUpdate({ mode: 'assist', autoDeliver: false })
    expect(update).toEqual({ mode: 'assist', autoDeliver: false })
    expect('autoStartPlans' in update).toBe(false)
    expect('maxAutoReplans' in update).toBe(false)
  })
})
