/**
 * ADR-0024 / ADR-0025 — the single source of truth for review verdicts.
 *
 * Four explicit verdicts, no "default approve":
 *   approved           the reviewer stated an unambiguous pass
 *   changes_requested  the reviewer asked for a fix
 *   blocked            the reviewer recorded a real blocking item
 *   inconclusive       missing, contradictory, ambiguous or stale evidence
 *
 * Only `approved` may unlock a quality gate. Everything else still allows the review
 * *task* to complete (reporting a defect is a finished review), but never a pass.
 */

import { readSnapshot, snapshotMismatch, type ReviewSnapshot } from './review-snapshot.js'

export type ReviewVerdict = 'approved' | 'changes_requested' | 'blocked' | 'inconclusive'

/**
 * How well a review is bound to the content that exists now.
 *
 *  current       the review names content that still matches the workspace
 *  stale         the review names content that has since changed
 *  unverifiable  there is no trustworthy binding, so nothing can be concluded
 */
export type ReviewFreshness = 'current' | 'stale' | 'unverifiable'

export interface ReviewVerdictOptions {
  /** Git revision the reviewed code is at right now, when known. */
  currentRevision?: string | null
  /** When provided, the stored review snapshot must match it exactly. */
  currentSnapshot?: ReviewSnapshot | null
  /**
   * `enforce` (default) refuses to approve anything it cannot bind to current content.
   * `report` returns the review's own stated verdict for display only; callers must never
   * use it to unlock a gate.
   */
  mode?: 'enforce' | 'report'
}

export interface ReviewFreshnessResult {
  freshness: ReviewFreshness
  reason: string | null
}

const NON_BLOCKING = /^(无|none|no blockers?|没有|-|—|n\/a)$/i

/**
 * ADR-0033 — real reviews are prose, so the verdict parser must read prose without inventing one.
 *
 * Two defects were found by a real run:
 *   1. rejection matched "fail" inside "tests 2 / pass 2 / fail 0", so a clean review became
 *      `inconclusive`;
 *   2. approval was anchored at the start (`^通过`), so "根据…当前工作区…判定为通过（PASS）" was not
 *      recognised even though the reviewer clearly approved.
 *
 * Rejection now ignores *zero counts* ("fail 0", "0 failures", "no errors") and recognises explicit
 * negative verdict words; approval accepts an explicit positive verdict token at a word boundary
 * anywhere in the conclusion. A conclusion containing both is still `inconclusive`.
 */
const ZERO_COUNT =
  /\b(?:fail(?:ed|ure|ing|s)?|errors?)\b\s*[:：=]?\s*0\b|\b0\s*(?:fail(?:ed|ure|ing|s)?|errors?)\b|no\s+(?:failures?|errors?)|0\s*个?\s*(?:失败|错误)/gi

const REJECTION =
  /阻断|不可放行|必须修改|打回|拒绝|需要修改|不通过|未通过|没有通过|changes?\s*requested|reject(?:ed)?|blocking|blocked/i

/** Explicit positive verdict, at a word boundary (start, punctuation or whitespace). */
const APPROVAL_TOKENS =
  /(?:^|[\s：:（(【\[])(通过|放行|批准|同意|审核通过|审查通过|approve(?:d)?|pass(?:ed)?|lgtm|conditionally passed|no issues)/i
const POSITIVE_FIELD = /^(approved|pass|passed|通过|放行)$/i
const REJECT_FIELD = /^(changes_requested|changes-requested|reject|rejected|需要修改|不通过)$/i
const BLOCK_FIELD = /^(blocked|block|阻断)$/i

/** Rejection signal, ignoring zero-count phrases such as "fail 0" or "0 failures". */
function hasRejection(text: string): boolean {
  if (!text) return false
  return REJECTION.test(text.replace(ZERO_COUNT, ' '))
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** Real blocking items, ignoring the usual "no blockers" placeholders. */
export function blockingItems(blockers: unknown): string[] {
  return asStringArray(blockers).filter((item) => !NON_BLOCKING.test(item.trim()))
}

/**
 * Whether a stored review is still bound to the content it claims to have reviewed.
 *
 * Content wins over commits: a review whose file hashes still match stays current even
 * if the code was committed (or copied) afterwards, because the reviewed bytes did not
 * change. A review with no snapshot and no revision cannot be verified at all.
 */
export function classifyReviewFreshness(
  metadata: Record<string, unknown>,
  options: ReviewVerdictOptions = {},
): ReviewFreshnessResult {
  const stored = readSnapshot(metadata.reviewSnapshot)
  const reviewedRevision = asString(metadata.reviewedRevision)
  const currentRevision = asString(options.currentRevision)

  if (stored) {
    if (options.currentSnapshot === undefined || options.currentSnapshot === null) {
      return { freshness: 'unverifiable', reason: '审查带有内容快照，但当前无法重新采集快照进行校验' }
    }
    const mismatch = snapshotMismatch(stored, options.currentSnapshot)
    return mismatch === null
      ? { freshness: 'current', reason: null }
      : { freshness: 'stale', reason: mismatch }
  }

  if (reviewedRevision) {
    if (!currentRevision) {
      return { freshness: 'unverifiable', reason: `审查绑定 revision ${reviewedRevision.slice(0, 12)}，当前无法取得工作区 revision` }
    }
    return reviewedRevision === currentRevision
      ? { freshness: 'current', reason: null }
      : {
          freshness: 'stale',
          reason: `审查针对 revision ${reviewedRevision.slice(0, 12)}，当前为 ${currentRevision.slice(0, 12)}`,
        }
  }

  return { freshness: 'unverifiable', reason: '审查既没有内容快照也没有绑定 revision，无法证明它审查的是当前内容' }
}

/**
 * Resolves the verdict of a review artifact's metadata. Free text is only ever used to
 * *downgrade* certainty: an approval needs an explicit positive token, and anything the
 * parser cannot read confidently becomes `inconclusive` rather than approved.
 */
export function reviewVerdictOf(
  metadata: Record<string, unknown>,
  options: ReviewVerdictOptions = {},
): ReviewVerdict {
  const blocking = blockingItems(metadata.blockers)

  // 1. A recorded blocking item always wins: nothing may pass while a real blocker stands.
  if (blocking.length > 0) return 'blocked'

  // 2. Staleness gate runs BEFORE any approval path. A structured `verdict: 'approved'`
  //    must not be able to skip the revision/snapshot check (ADR-0024 regression).
  if ((options.mode ?? 'enforce') === 'enforce') {
    const { freshness } = classifyReviewFreshness(metadata, options)
    if (freshness !== 'current') return 'inconclusive'
  }

  return statedVerdictOf(metadata)
}

/** The verdict the reviewer wrote, without any freshness enforcement. Display only. */
export function statedVerdictOf(metadata: Record<string, unknown>): ReviewVerdict {
  const conclusion = asString(metadata.conclusion)
  const explicit = asString(metadata.verdict ?? metadata.reviewVerdict)
  const rejectedText = hasRejection(conclusion)

  // 3. An explicit structured verdict field is authoritative when it is one we understand.
  if (explicit) {
    if (POSITIVE_FIELD.test(explicit)) {
      // ...but it may not contradict a rejection written into the conclusion.
      return rejectedText ? 'inconclusive' : 'approved'
    }
    if (BLOCK_FIELD.test(explicit)) return 'blocked'
    if (REJECT_FIELD.test(explicit)) return 'changes_requested'
    return 'inconclusive'
  }

  // 4. Free-text conclusion. Both directions present at once is contradictory.
  if (!conclusion) return 'inconclusive'
  const approvedText = APPROVAL_TOKENS.test(conclusion)
  if (approvedText && rejectedText) return 'inconclusive'
  if (rejectedText) return 'changes_requested'
  if (!approvedText) return 'inconclusive'

  return 'approved'
}

/** Convenience: only an explicit, current approval counts. */
export function isReviewApproved(
  metadata: Record<string, unknown>,
  options: ReviewVerdictOptions = {},
): boolean {
  return reviewVerdictOf(metadata, options) === 'approved'
}
