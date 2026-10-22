import { newId, now } from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'
import type { PlannerAttemptUsage } from './planner.js'

/**
 * Planner usage is recorded per model attempt, not per saved plan.
 *
 * - Only provider-reported tokens are stored. Missing tokens stay NULL and are
 *   reported as unknown, never as zero.
 * - Cost is computed only when the existing model-price catalog has a real
 *   price. Otherwise estimated_cost/currency stay NULL.
 * - `(request_id, attempt)` is unique, so retries/repair attempts are counted
 *   exactly once and duplicate recording cannot inflate totals.
 */
export class PlannerUsageService {
  constructor(private readonly store: SqliteStore) {}

  record(usage: PlannerAttemptUsage): void {
    const price =
      usage.connectionId && usage.modelId
        ? this.store.read.getAIModelPrice(usage.connectionId, usage.modelId)
        : null
    const hasTokens = usage.inputTokens !== null || usage.outputTokens !== null
    const estimatedCost =
      price && hasTokens
        ? (Number(usage.inputTokens ?? 0) / 1_000_000) * price.inputPerMillion +
          (Number(usage.outputTokens ?? 0) / 1_000_000) * price.outputPerMillion
        : null
    this.store.recordPlannerUsage({
      id: newId('usg'),
      requestId: usage.requestId,
      projectId: usage.projectId,
      planId: usage.planId,
      planRevision: usage.revision,
      attempt: usage.attempt,
      connectionId: usage.connectionId,
      modelId: usage.modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      usageSource: hasTokens ? 'provider' : 'unknown',
      estimatedCost,
      currency: estimatedCost === null ? null : (price?.currency ?? null),
      pricingVersion: price?.version ?? null,
      outcome: usage.outcome,
      createdAt: now(),
    })
  }
}
