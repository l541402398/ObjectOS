/**
 * ADR-0024 / ADR-0025 — one shared rule for "is there a current, approving review?".
 *
 * Before this module, three places decided review approval with three different rules:
 * `CompletionDecision` (any approved artifact wins), `OrchestrationScheduler.negativeReviews`
 * (any review that is not approved blocks) and `GateEvaluation` (a self-declared
 * `review_record` evidence row counts). A second, contradictory review could therefore be
 * ignored by one module and block another.
 *
 * Everything now funnels through `resolveReviewEvidence`:
 *
 *  1. A real blocker recorded against current content always blocks.
 *  2. A review that is not bound to current content is *historical*: kept for audit, never
 *     decisive. Historical negative reviews therefore do not permanently block a version
 *     that was legitimately re-reviewed.
 *  3. Approval requires at least one review of the current content and agreement among all
 *     current reviews. One positive review cannot override an unresolved negative review of
 *     the same content, and an ambiguous ("inconclusive") current review cannot be overridden
 *     either.
 *  4. No current review means no approval, even if older reviews said pass.
 */

import { blockingItems, classifyReviewFreshness, statedVerdictOf, type ReviewFreshness, type ReviewVerdict } from './review-verdict.js'
import type { ReviewSnapshot } from './review-snapshot.js'

export interface ReviewEvidenceCandidate {
  id: string
  title: string
  metadata: Record<string, unknown>
}

export interface ReviewEvidenceContext {
  /** Current git revision of the workspace, when known. */
  currentRevision?: string | null
  /** Current snapshot for a single-scope caller. */
  currentSnapshot?: ReviewSnapshot | null
  /**
   * Resolve the current content snapshot for one review's own scope. Each review may cover
   * different files, so a single global snapshot is not enough for plan-level evaluation.
   */
  snapshotFor?: (metadata: Record<string, unknown>) => ReviewSnapshot | null
  /** Grouping key for "same object/scope"; defaults to the review's own `scope` field. */
  scopeOf?: (metadata: Record<string, unknown>) => string
}

export interface ReviewEvidenceItem {
  id: string
  title: string
  verdict: ReviewVerdict
  freshness: ReviewFreshness
  freshnessReason: string | null
  blocking: string[]
  conclusion: string
  scope: string
}

export interface ReviewEvidenceResolution {
  /** A structurally valid review artifact exists (the review *task* may complete). */
  performed: boolean
  /** A current review approves the current content and nothing current contradicts it. */
  approved: boolean
  /** Decisive verdict for the current content. */
  verdict: ReviewVerdict
  /** Blocking findings that are still unresolved against current content. */
  blockingFindings: number
  current: ReviewEvidenceItem[]
  historical: ReviewEvidenceItem[]
  unverifiable: ReviewEvidenceItem[]
  /** Number of current reviews whose verdict differs from the decisive one. */
  conflicts: number
  stale: number
  reasons: string[]
}

function defaultScope(metadata: Record<string, unknown>): string {
  const scope = metadata.scope
  if (typeof scope === 'string' && scope.trim()) return scope.trim()
  const objects = Array.isArray(metadata.reviewedObjects)
    ? metadata.reviewedObjects.filter((item): item is string => typeof item === 'string').sort()
    : []
  return objects.join(',')
}

function snapshotFor(
  metadata: Record<string, unknown>,
  context: ReviewEvidenceContext,
): ReviewSnapshot | null {
  if (context.snapshotFor) return context.snapshotFor(metadata)
  if (context.currentSnapshot !== undefined) return context.currentSnapshot
  return null
}

/**
 * Whether the caller supplied any way to verify current content. Without one, nothing can
 * be approved (fail closed) — callers that cannot verify must say so, not assume a pass.
 */
export function canVerifyReviewContent(context: ReviewEvidenceContext): boolean {
  return Boolean(context.snapshotFor) || context.currentSnapshot !== undefined || Boolean(context.currentRevision)
}

export function resolveReviewEvidence(
  candidates: ReviewEvidenceCandidate[],
  context: ReviewEvidenceContext = {},
): ReviewEvidenceResolution {
  const reasons: string[] = []
  if (candidates.length === 0) {
    return {
      performed: false,
      approved: false,
      verdict: 'inconclusive',
      blockingFindings: 0,
      current: [],
      historical: [],
      unverifiable: [],
      conflicts: 0,
      stale: 0,
      reasons: ['没有审查 Artifact'],
    }
  }

  const verified = canVerifyReviewContent(context)
  const items: ReviewEvidenceItem[] = candidates.map((candidate) => {
    const metadata = candidate.metadata
    const currentSnapshot = snapshotFor(metadata, context)
    const freshness = classifyReviewFreshness(metadata, {
      currentRevision: context.currentRevision,
      currentSnapshot,
    })
    return {
      id: candidate.id,
      title: candidate.title,
      // In enforce mode an unbound review reports `inconclusive`; the stated verdict is kept
      // separately through `statedVerdictOf` only for the decisive-verdict computation.
      verdict: freshness.freshness === 'current' ? statedVerdictOf(metadata) : 'inconclusive',
      freshness: verified ? freshness.freshness : 'unverifiable',
      freshnessReason: verified ? freshness.reason : '调用方没有提供可校验的当前内容快照/revision',
      blocking: blockingItems(metadata.blockers),
      conclusion: typeof metadata.conclusion === 'string' ? metadata.conclusion.trim() : '',
      scope: (context.scopeOf ?? defaultScope)(metadata),
    }
  })

  const current = items.filter((item) => item.freshness === 'current')
  const historical = items.filter((item) => item.freshness === 'stale')
  const unverifiable = items.filter((item) => item.freshness === 'unverifiable')

  // 1. Unresolved blockers win. A blocker from an unverifiable review is treated as
  //    unresolved (fail closed): we cannot prove it was addressed.
  const blockingReviews = [...current, ...unverifiable].filter((item) => item.blocking.length > 0)
  const blockingFindings = blockingReviews.reduce((sum, item) => sum + item.blocking.length, 0)
  if (blockingReviews.length > 0) {
    reasons.push(
      `存在未解决的阻断项（${blockingReviews
        .map((item) => `${item.title}：${item.blocking.slice(0, 2).join('、')}`)
        .join('；')}）`,
    )
    return {
      performed: true,
      approved: false,
      verdict: 'blocked',
      blockingFindings,
      current,
      historical,
      unverifiable,
      conflicts: 0,
      stale: historical.length,
      reasons,
    }
  }

  if (current.length === 0) {
    reasons.push(
      historical.length > 0
        ? `只有针对旧内容的审查（${historical.length} 份），当前内容没有审查，不能放行`
        : '没有可校验的当前审查',
    )
    return {
      performed: true,
      approved: false,
      verdict: 'inconclusive',
      blockingFindings,
      current,
      historical,
      unverifiable,
      conflicts: 0,
      stale: historical.length,
      reasons,
    }
  }

  // 2. Every current review must agree on a pass. A positive review cannot override an
  //    unresolved negative or ambiguous review of the same content.
  const decisive: ReviewEvidenceItem =
    current.find((item) => item.verdict === 'changes_requested')
    ?? current.find((item) => item.verdict === 'inconclusive')
    ?? current[0]!
  const approved = current.every((item) => item.verdict === 'approved')
  const conflicts = approved ? 0 : current.filter((item) => item.verdict !== decisive.verdict).length
  if (!approved) {
    reasons.push(
      decisive.verdict === 'changes_requested'
        ? `当前审查要求修改：${decisive.title}（${decisive.conclusion || '未给出结论'}）`
        : `当前审查结论不确定：${decisive.title}（${decisive.conclusion || '未给出结论'}）`,
    )
    if (conflicts > 0) reasons.push(`当前存在 ${conflicts} 份结论不一致的审查，不能择一放行`)
  } else {
    reasons.push(`当前内容审查通过（${current.length} 份，结论一致）`)
    if (historical.length > 0) reasons.push(`已忽略 ${historical.length} 份针对旧内容的审查（保留为审计记录）`)
  }

  return {
    performed: true,
    approved,
    verdict: approved ? 'approved' : decisive.verdict === 'changes_requested' ? 'changes_requested' : 'inconclusive',
    blockingFindings,
    current,
    historical,
    unverifiable,
    conflicts,
    stale: historical.length,
    reasons,
  }
}

/**
 * GateEvaluation reads persisted `review_record` evidence rows. Such a row is only a pass
 * when it names the exact review artifact, plan revision and content fingerprint that are
 * current now. This keeps the lifecycle gate on the same rule as the scheduler.
 */
export interface ReviewRecordBinding {
  reviewArtifactId: string
  planId: string
  planRevision: number
  snapshotFingerprint: string
  verdict: ReviewVerdict
  reviewedRevision: string | null
}

export function reviewRecordBindingOf(provenance: unknown): ReviewRecordBinding | null {
  if (!provenance || typeof provenance !== 'object') return null
  const record = provenance as Record<string, unknown>
  const reviewArtifactId = typeof record.reviewArtifactId === 'string' ? record.reviewArtifactId : ''
  const planId = typeof record.planId === 'string' ? record.planId : ''
  const planRevision = typeof record.planRevision === 'number' ? record.planRevision : Number(record.planRevision)
  const snapshotFingerprint = typeof record.snapshotFingerprint === 'string' ? record.snapshotFingerprint : ''
  const verdict = record.verdict
  if (!reviewArtifactId || !planId || !Number.isFinite(planRevision) || planRevision <= 0) return null
  if (!snapshotFingerprint) return null
  if (verdict !== 'approved' && verdict !== 'changes_requested' && verdict !== 'blocked' && verdict !== 'inconclusive') {
    return null
  }
  return {
    reviewArtifactId,
    planId,
    planRevision,
    snapshotFingerprint,
    verdict,
    reviewedRevision: typeof record.reviewedRevision === 'string' ? record.reviewedRevision : null,
  }
}

/**
 * True when a stored review record still describes the current plan revision and content.
 * Anything unverifiable fails closed with a reason the action center can show.
 */
export function reviewRecordStillCurrent(
  binding: ReviewRecordBinding | null,
  current: { planId: string | null; planRevision: number | null; snapshotFingerprint: string | null },
): { current: boolean; reason: string } {
  if (!binding) return { current: false, reason: '缺少与审查 Artifact 绑定的来源信息' }
  if (binding.verdict !== 'approved') return { current: false, reason: `审查结论为 ${binding.verdict}` }
  if (!current.planId || binding.planId !== current.planId) {
    return { current: false, reason: '审查记录不属于当前计划' }
  }
  if (current.planRevision === null || binding.planRevision !== current.planRevision) {
    return { current: false, reason: '审查记录属于旧的计划 revision' }
  }
  if (!current.snapshotFingerprint || binding.snapshotFingerprint !== current.snapshotFingerprint) {
    return { current: false, reason: '审查记录的内容快照与当前代码不一致' }
  }
  return { current: true, reason: '审查记录与当前 revision 和内容快照一致' }
}

/** Provenance payload written together with a derived `review_record` evidence row. */
export function reviewRecordProvenance(binding: ReviewRecordBinding): Record<string, unknown> {
  return {
    kind: 'review-record',
    reviewArtifactId: binding.reviewArtifactId,
    planId: binding.planId,
    planRevision: binding.planRevision,
    snapshotFingerprint: binding.snapshotFingerprint,
    verdict: binding.verdict,
    reviewedRevision: binding.reviewedRevision,
  }
}
