import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { reviewVerdictOf } from '../packages/application/src/review-verdict.js'
import { buildSnapshot, snapshotMatches } from '../packages/application/src/review-snapshot.js'
import { collectReviewSnapshot } from '../apps/runtime/src/review-snapshot-collector.js'

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length > 0) cleanups.pop()?.() })

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'p287-snap-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'src'), { recursive: true })
  for (const [path, body] of Object.entries(files)) writeFileSync(join(dir, path), body)
  return dir
}

describe('ADR-0025 trusted review snapshot', () => {
  it('hashes the real reviewed file content', () => {
    const root = workspace({ 'src/a.mjs': 'export const a = 1\n' })
    const snapshot = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/a.mjs'] })
    expect(snapshot.files).toHaveLength(1)
    expect(snapshot.files[0].sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('invalidates an approval when the file changes but git HEAD does not', () => {
    const root = workspace({ 'src/a.mjs': 'export const a = 1\n' })
    const reviewedAt = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/a.mjs'] })
    // Uncommitted edit: HEAD is untouched, content is not.
    writeFileSync(join(root, 'src/a.mjs'), 'export const a = 2\n')
    const now = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/a.mjs'] })
    expect(now.baselineCommit).toBe(reviewedAt.baselineCommit)
    expect(now.fingerprint).not.toBe(reviewedAt.fingerprint)
    expect(snapshotMatches(reviewedAt, now)).toBe(false)
  })

  it('refuses a structured approved verdict once the content moved on', () => {
    const root = workspace({ 'src/a.mjs': 'export const a = 1\n' })
    const reviewedAt = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/a.mjs'] })
    const metadata = {
      artifactType: 'review', reviewedObjects: ['src/a.mjs'], scope: 'src/a.mjs',
      findings: [], conclusion: '通过', blockers: [], verdict: 'approved',
      reviewedRevision: reviewedAt.baselineCommit, reviewSnapshot: reviewedAt,
    }
    expect(reviewVerdictOf(metadata, { currentRevision: reviewedAt.baselineCommit, currentSnapshot: reviewedAt })).toBe('approved')
    writeFileSync(join(root, 'src/a.mjs'), 'export const a = 3\n')
    const later = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/a.mjs'] })
    expect(reviewVerdictOf(metadata, { currentRevision: reviewedAt.baselineCommit, currentSnapshot: later })).toBe('inconclusive')
  })

  it('fails closed when a review carries no snapshot at all', () => {
    const root = workspace({ 'src/a.mjs': 'x\n' })
    const current = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/a.mjs'] })
    const metadata = { artifactType: 'review', reviewedObjects: ['src/a.mjs'], scope: 'x', findings: [], conclusion: '通过', blockers: [], verdict: 'approved' }
    expect(reviewVerdictOf(metadata, { currentRevision: current.baselineCommit, currentSnapshot: current })).toBe('inconclusive')
  })

  it('ignores paths that escape the workspace', () => {
    const root = workspace({ 'src/a.mjs': 'x\n' })
    const snapshot = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['../outside.mjs', '/etc/passwd', 'src/a.mjs'] })
    expect(snapshot.files.map((file) => file.path)).toEqual(['src/a.mjs'])
  })

  it('records deleted files as null instead of pretending they exist', () => {
    const root = workspace({ 'src/a.mjs': 'x\n' })
    const snapshot = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/gone.mjs'] })
    expect(snapshot.files[0].sha256).toBeNull()
  })

  it('is order independent and deterministic', () => {
    const files = [{ path: 'b.mjs', sha256: '2' }, { path: 'a.mjs', sha256: '1' }]
    expect(buildSnapshot(null, files).fingerprint).toBe(buildSnapshot(null, [...files].reverse()).fingerprint)
  })
})
