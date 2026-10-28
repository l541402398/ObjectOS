import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PlanGrantService } from '../apps/runtime/src/plan-grant.js'
import { setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'p283-ctx-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'w', scripts: { test: 'node --test' } }, null, 2))
  writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 1\n')
  return dir
}

function service() {
  const harness = setup()
  cleanups.push(harness.close)
  return new PlanGrantService(harness.store)
}

/**
 * Phase 2.8.3 / P0-3: an identical command string must not be treated as identical
 * execution. The context fingerprint must change whenever package.json or the entry
 * file changes, so a previously reused approval is invalidated instead of silently
 * authorising different work.
 */
describe('Phase 2.8.3 command approval execution context', () => {
  it('is stable while package.json and entry files are unchanged', () => {
    const svc = service()
    const root = workspace()
    const a = svc.executionContextFingerprint(root, 'run_tests', 'npm test')
    const b = svc.executionContextFingerprint(root, 'run_tests', 'npm test')
    expect(a).toBe(b)
  })

  it('changes when the package.json script definition changes', () => {
    const svc = service()
    const root = workspace()
    const before = svc.executionContextFingerprint(root, 'run_tests', 'npm test')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'w', scripts: { test: 'node --test tests/*.test.mjs' } }, null, 2))
    const after = svc.executionContextFingerprint(root, 'run_tests', 'npm test')
    expect(after).not.toBe(before)
  })

  it('changes when the entry file executed by node changes', () => {
    const svc = service()
    const root = workspace()
    const before = svc.executionContextFingerprint(root, 'run_command', 'node src/a.mjs')
    writeFileSync(join(root, 'src', 'a.mjs'), 'export const a = 2\n')
    const after = svc.executionContextFingerprint(root, 'run_command', 'node src/a.mjs')
    expect(after).not.toBe(before)
  })

  it('differs per tool and per command text', () => {
    const svc = service()
    const root = workspace()
    const tests = svc.executionContextFingerprint(root, 'run_tests', 'npm test')
    const run = svc.executionContextFingerprint(root, 'run_command', 'npm test')
    const other = svc.executionContextFingerprint(root, 'run_tests', 'npm run build')
    expect(tests).not.toBe(run)
    expect(tests).not.toBe(other)
  })
})
