import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_RUNTIME_SETTINGS,
  mergeRuntimeSettings,
  normalizeRuntimeSettings,
} from '@projectos/contracts'
import { RuntimeSettingsService, runtimeLimitsFromSettings } from '../apps/runtime/src/runtime-settings.js'
import { setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

describe('runtime settings', () => {
  it('ships a higher Planner budget and clamps invalid persisted values', () => {
    expect(DEFAULT_RUNTIME_SETTINGS.plannerMaxOutputTokens).toBe(12_288)
    expect(normalizeRuntimeSettings({ plannerMaxOutputTokens: 999_999 })).toEqual(DEFAULT_RUNTIME_SETTINGS)
    expect(normalizeRuntimeSettings({ plannerMaxOutputTokens: 16_384 }).plannerMaxOutputTokens).toBe(16_384)
  })

  it('merges partial updates without dropping unrelated limits', () => {
    const merged = mergeRuntimeSettings(DEFAULT_RUNTIME_SETTINGS, { agentMaxSteps: 64 })
    expect(merged.agentMaxSteps).toBe(64)
    expect(merged.plannerMaxOutputTokens).toBe(12_288)
  })

  it('maps Planner/Agent settings onto the Runtime hard limits', () => {
    const limits = runtimeLimitsFromSettings(DEFAULT_RUNTIME_SETTINGS, {
      runWallClockMs: 1,
      planWallClockMs: 1,
      maxAgentSteps: 1,
      maxToolCalls: 1,
      agentSlotTtlMs: 30_000,
      taskLeaseTtlMs: 30_000,
    })
    expect(limits.maxAgentSteps).toBe(32)
    expect(limits.maxToolCalls).toBe(64)
    expect(limits.runWallClockMs).toBe(30 * 60_000)
    expect(limits.planWallClockMs).toBe(120 * 60_000)
  })

  it('persists settings and applies new limits to the AgentRunner', () => {
    const harness = setup()
    cleanups.push(harness.close)
    const service = new RuntimeSettingsService(harness.store, (limits) => harness.runner.setLimits(limits))
    const next = service.update({
      plannerMaxOutputTokens: 16_384,
      agentMaxSteps: 80,
      agentMaxToolCalls: 160,
      agentRunTimeoutMinutes: 45,
      planTimeoutMinutes: 240,
    })
    expect(service.get()).toEqual(next)
    expect(harness.runner.getLimits().maxAgentSteps).toBe(80)
    expect(harness.runner.getLimits().maxToolCalls).toBe(160)
    expect(harness.runner.getLimits().runWallClockMs).toBe(45 * 60_000)
    expect(harness.runner.getLimits().planWallClockMs).toBe(240 * 60_000)
  })
})
