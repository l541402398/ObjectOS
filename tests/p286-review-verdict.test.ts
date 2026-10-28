import { describe, expect, it } from 'vitest'
import { blockingItems, reviewVerdictOf } from '../packages/application/src/review-verdict.js'

/**
 * ADR-0024 deterministic contract:
 *  - no "default approve" — anything unclear is `inconclusive`
 *  - a real blocking item always wins
 *  - an approval only counts for the revision it was written against
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

describe('ADR-0024 review verdict', () => {
  it('approves only an explicit positive conclusion', () => {
    expect(reviewVerdictOf(review())).toBe('approved')
    expect(reviewVerdictOf(review({ conclusion: '通过：未发现问题' }))).toBe('approved')
    expect(reviewVerdictOf(review({ conclusion: 'LGTM' }))).toBe('approved')
  })

  it('never approves an ambiguous or empty conclusion', () => {
    expect(reviewVerdictOf(review({ conclusion: '' }))).toBe('inconclusive')
    expect(reviewVerdictOf(review({ conclusion: '看起来还行吧' }))).toBe('inconclusive')
    expect(reviewVerdictOf(review({ conclusion: '待确认' }))).toBe('inconclusive')
    expect(reviewVerdictOf(review({ conclusion: undefined }))).toBe('inconclusive')
  })

  it('treats a contradictory conclusion as inconclusive, never approved', () => {
    expect(reviewVerdictOf(review({ conclusion: '通过，但阻断项仍未解决' }))).toBe('inconclusive')
  })

  it('reports changes_requested for a fix request', () => {
    expect(reviewVerdictOf(review({ conclusion: '需要修改：owner 规则缺失' }))).toBe('changes_requested')
    expect(reviewVerdictOf(review({ conclusion: 'changes requested' }))).toBe('changes_requested')
  })

  it('lets a real blocking item win over a positive conclusion', () => {
    expect(reviewVerdictOf(review({ blockers: ['owner 规则缺失'] }))).toBe('blocked')
    expect(reviewVerdictOf(review({ blockers: ['无', 'owner 规则缺失'], conclusion: '通过' }))).toBe('blocked')
  })

  it('ignores placeholder blockers', () => {
    expect(blockingItems(['无', 'none', 'No blockers', '—'])).toHaveLength(0)
    expect(reviewVerdictOf(review({ blockers: ['无'] }))).toBe('approved')
  })

  it('honours an explicit structured verdict field', () => {
    expect(reviewVerdictOf(review({ verdict: 'approved' }))).toBe('approved')
    expect(reviewVerdictOf(review({ verdict: 'changes_requested' }))).toBe('changes_requested')
    expect(reviewVerdictOf(review({ verdict: 'blocked' }))).toBe('blocked')
    // An unknown structured value is not an approval.
    expect(reviewVerdictOf(review({ verdict: 'maybe' }))).toBe('inconclusive')
    // ...and cannot contradict a rejection written in the conclusion.
    expect(reviewVerdictOf(review({ verdict: 'approved', conclusion: '需要修改' }))).toBe('inconclusive')
  })

  it('invalidates an approval written against another revision', () => {
    const approved = review({ conclusion: '通过', reviewedRevision: 'aaa111' })
    expect(reviewVerdictOf(approved, { currentRevision: 'aaa111' })).toBe('approved')
    expect(reviewVerdictOf(approved, { currentRevision: 'bbb222' })).toBe('inconclusive')
  })

  it('keeps legacy reviews without a revision as-is instead of auto-approving them', () => {
    // No revision recorded: the approval text still has to be explicit.
    expect(reviewVerdictOf(review({ reviewedRevision: undefined }), { currentRevision: 'bbb222' })).toBe('approved')
    expect(reviewVerdictOf(review({ conclusion: '未确认', reviewedRevision: undefined }))).toBe('inconclusive')
  })

  it('never mutates the metadata it reads', () => {
    const metadata = review({ blockers: ['owner 规则缺失'] })
    const snapshot = JSON.stringify(metadata)
    reviewVerdictOf(metadata)
    expect(JSON.stringify(metadata)).toBe(snapshot)
  })
})
