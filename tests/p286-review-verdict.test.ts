import { describe, expect, it } from 'vitest'
import { blockingItems, classifyReviewFreshness, reviewVerdictOf } from '../packages/application/src/review-verdict.js'

/**
 * ADR-0024 deterministic contract:
 *  - no "default approve" — anything unclear is `inconclusive`
 *  - a real blocking item always wins
 *  - an approval only counts for the content/revision it was written against
 *
 * `mode: 'report'` exercises the stated-verdict parser (what the reviewer wrote). The default
 * `enforce` mode additionally requires a trustworthy binding to current content; those cases are
 * covered here and in p287-review-snapshot.test.ts.
 */

const review = (extra: Record<string, unknown> = {}) => ({
  artifactType: 'review',
  reviewedObjects: ['src/visibility.mjs'],
  scope: 'canView owner 规则',
  findings: [],
  conclusion: '通过',
  blockers: [],
  ...extra,
})

const report = { mode: 'report' as const }

describe('ADR-0024 stated review verdict', () => {
  it('approves only an explicit positive conclusion', () => {
    expect(reviewVerdictOf(review(), report)).toBe('approved')
    expect(reviewVerdictOf(review({ conclusion: '通过：未发现问题' }), report)).toBe('approved')
    expect(reviewVerdictOf(review({ conclusion: 'LGTM' }), report)).toBe('approved')
  })

  it('never approves an ambiguous or empty conclusion', () => {
    expect(reviewVerdictOf(review({ conclusion: '' }), report)).toBe('inconclusive')
    expect(reviewVerdictOf(review({ conclusion: '看起来还行吧' }), report)).toBe('inconclusive')
    expect(reviewVerdictOf(review({ conclusion: '待确认' }), report)).toBe('inconclusive')
    expect(reviewVerdictOf(review({ conclusion: undefined }), report)).toBe('inconclusive')
  })

  it('treats a contradictory conclusion as inconclusive, never approved', () => {
    expect(reviewVerdictOf(review({ conclusion: '通过，但阻断项仍未解决' }), report)).toBe('inconclusive')
  })

  it('reports changes_requested for a fix request', () => {
    expect(reviewVerdictOf(review({ conclusion: '需要修改：owner 规则缺失' }), report)).toBe('changes_requested')
    expect(reviewVerdictOf(review({ conclusion: 'changes requested' }), report)).toBe('changes_requested')
  })

  it('lets a real blocking item win over a positive conclusion', () => {
    expect(reviewVerdictOf(review({ blockers: ['owner 规则缺失'] }), report)).toBe('blocked')
    expect(reviewVerdictOf(review({ blockers: ['无', 'owner 规则缺失'], conclusion: '通过' }), report)).toBe('blocked')
  })

  it('ignores placeholder blockers', () => {
    expect(blockingItems(['无', 'none', 'No blockers', '—'])).toHaveLength(0)
    expect(reviewVerdictOf(review({ blockers: ['无'] }), report)).toBe('approved')
  })

  it('honours an explicit structured verdict field', () => {
    expect(reviewVerdictOf(review({ verdict: 'approved' }), report)).toBe('approved')
    expect(reviewVerdictOf(review({ verdict: 'changes_requested' }), report)).toBe('changes_requested')
    expect(reviewVerdictOf(review({ verdict: 'blocked' }), report)).toBe('blocked')
    // An unknown structured value is not an approval.
    expect(reviewVerdictOf(review({ verdict: 'maybe' }), report)).toBe('inconclusive')
    // ...and cannot contradict a rejection written in the conclusion.
    expect(reviewVerdictOf(review({ verdict: 'approved', conclusion: '需要修改' }), report)).toBe('inconclusive')
  })

  it('never mutates the metadata it reads', () => {
    const metadata = review({ blockers: ['owner 规则缺失'] })
    const snapshot = JSON.stringify(metadata)
    reviewVerdictOf(metadata)
    expect(JSON.stringify(metadata)).toBe(snapshot)
  })
})

describe('ADR-0024 enforcement requires a binding to current content', () => {
  it('invalidates an approval written against another revision', () => {
    const approved = review({ conclusion: '通过', reviewedRevision: 'aaa111' })
    expect(reviewVerdictOf(approved, { currentRevision: 'aaa111' })).toBe('approved')
    expect(reviewVerdictOf(approved, { currentRevision: 'bbb222' })).toBe('inconclusive')
  })

  it('refuses a structured approved verdict with no verifiable binding', () => {
    // This is the bypass: `verdict: 'approved'` used to short-circuit before the version gate.
    expect(reviewVerdictOf(review({ verdict: 'approved' }))).toBe('inconclusive')
    expect(reviewVerdictOf(review({ verdict: 'approved' }), { currentRevision: 'bbb222' })).toBe('inconclusive')
  })

  it('keeps a legacy review without any binding unverifiable instead of auto-approving it', () => {
    expect(classifyReviewFreshness(review({ reviewedRevision: undefined })).freshness).toBe('unverifiable')
    expect(reviewVerdictOf(review({ reviewedRevision: undefined }), { currentRevision: 'bbb222' })).toBe('inconclusive')
    expect(reviewVerdictOf(review({ conclusion: '未确认', reviewedRevision: undefined }))).toBe('inconclusive')
  })

  it('still reports the stated verdict for display purposes', () => {
    expect(reviewVerdictOf(review({ verdict: 'changes_requested' }), report)).toBe('changes_requested')
    expect(reviewVerdictOf(review({ verdict: 'changes_requested' }))).toBe('inconclusive')
  })
})
