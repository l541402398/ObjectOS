import { describe, expect, it } from 'vitest'
import { readOnlyCommandFamily } from '../apps/runtime/src/plan-grant.js'

/**
 * ADR-0032 — only *strictly* read-only commands are grouped into a reusable family. Anything that
 * can write, execute arbitrary code, redirect output or chain another command must keep its own
 * per-call approval.
 */
describe('ADR-0032 read-only command families', () => {
  it('groups inspection commands into a family', () => {
    expect(readOnlyCommandFamily('git status --porcelain')).toBe('git-status')
    expect(readOnlyCommandFamily('git diff --stat')).toBe('git-diff')
    expect(readOnlyCommandFamily('git log -1 --format=%H')).toBe('git-log')
    expect(readOnlyCommandFamily('grep -rn sums src tests')).toBe('grep')
    expect(readOnlyCommandFamily('node --check src/a.mjs')).toBe('node-check')
    expect(readOnlyCommandFamily('node --version')).toBe('node-version')
  })

  it('never groups anything with side effects, chaining or code execution', () => {
    expect(readOnlyCommandFamily('node -e "require(\'fs\').writeFileSync(\'a\',\'b\')"')).toBeNull()
    expect(readOnlyCommandFamily('npm test')).toBeNull()
    expect(readOnlyCommandFamily('git status && rm -rf src')).toBeNull()
    expect(readOnlyCommandFamily('git status; git push')).toBeNull()
    expect(readOnlyCommandFamily('git status > out.txt')).toBeNull()
    expect(readOnlyCommandFamily('git diff $(git rev-parse HEAD)')).toBeNull()
    expect(readOnlyCommandFamily('git commit -m x')).toBeNull()
    expect(readOnlyCommandFamily('git checkout -- .')).toBeNull()
    expect(readOnlyCommandFamily('curl https://example.com')).toBeNull()
    expect(readOnlyCommandFamily('')).toBeNull()
  })
})
