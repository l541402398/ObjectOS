import { describe, expect, it } from 'vitest'
import { shouldRestartOnMissedPong } from '../apps/desktop/src/main/runtime-supervisor.js'

/**
 * ADR-0064 — one slow pong is not a dead runtime. Real evidence: a delivery run was interrupted by
 * `heartbeat missed; restarting` while git/diff/sqlite work blocked the loop briefly.
 */
describe('ADR-0064 runtime heartbeat tolerance', () => {
  it('never restarts on a zero miss count', () => {
    expect(shouldRestartOnMissedPong({ missed: 0, pendingRequests: 0 })).toBe(false)
  })

  it('tolerates the first missed pong even with requests in flight', () => {
    expect(shouldRestartOnMissedPong({ missed: 1, pendingRequests: 3 })).toBe(false)
  })

  it('restarts after two consecutive misses', () => {
    expect(shouldRestartOnMissedPong({ missed: 2, pendingRequests: 0 })).toBe(true)
    expect(shouldRestartOnMissedPong({ missed: 3, pendingRequests: 1 })).toBe(true)
  })
})
