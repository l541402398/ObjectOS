import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PlanGrantService } from '../apps/runtime/src/plan-grant.js'
import { setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length > 0) cleanups.pop()?.() })

function workspace(pkg: object, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'p286-script-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'tests'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
  for (const [path, body] of Object.entries(files)) writeFileSync(join(dir, path), body)
  return dir
}
function service() { const h = setup(); cleanups.push(h.close); return new PlanGrantService(h.store) }

describe('Phase 2.8.6 npm script indirect execution coverage', () => {
  it('changes when the script body changes', () => {
    const svc = service()
    const root = workspace({ scripts: { test: 'node --test tests/a.test.mjs' } })
    const before = svc.executionContextFingerprint(root, 'run_tests', 'npm test')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test tests/b.test.mjs' } }))
    expect(svc.executionContextFingerprint(root, 'run_tests', 'npm test')).not.toBe(before)
  })

  it('changes when a file referenced by the script changes', () => {
    const svc = service()
    const root = workspace({ scripts: { test: 'node tests/a.test.mjs' } }, { 'tests/a.test.mjs': 'export const a = 1\n' })
    const before = svc.executionContextFingerprint(root, 'run_tests', 'npm test')
    writeFileSync(join(root, 'tests/a.test.mjs'), 'export const a = 2\n')
    expect(svc.executionContextFingerprint(root, 'run_tests', 'npm test')).not.toBe(before)
  })

  it('still fingerprints a script with no referenced files deterministically', () => {
    const svc = service()
    const root = workspace({ scripts: { test: 'echo ok' } })
    expect(svc.executionContextFingerprint(root, 'run_tests', 'npm test'))
      .toBe(svc.executionContextFingerprint(root, 'run_tests', 'npm test'))
  })
})
