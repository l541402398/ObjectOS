import type { PlanDraft } from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'

/**
 * ADR-0029 — a revision budget belongs to a *goal lineage*, not to a moving time window.
 *
 * Phase 2.8.7 patched two loop holes (bounded event window, superseded source plan) but the budget
 * was still counted per project over the last 24h. That has exactly the wrong semantics:
 *
 *   - a new revision (new plan id) never inherits the count, so a chain can run forever;
 *   - a restart or 24h of silence silently refills the budget;
 *   - a flood of unrelated events can hide earlier applies;
 *   - two independent goals in one project compete for the same quota.
 *
 * The lineage is derived from the persisted plan chain (`supersededByPlanId`), so it needs no
 * schema change and survives restarts: the root plan of the chain is the stable goal identity.
 */

export interface LineageIndex {
  /** planId → root plan id of its revision chain. */
  rootOf: Map<string, string>
}

/** Builds planId → lineage root by following `supersededByPlanId` forward from each revision. */
export function buildLineageIndex(plans: PlanDraft[]): LineageIndex {
  const byId = new Map(plans.map((plan) => [plan.id, plan]))
  const rootOf = new Map<string, string>()
  const resolveRoot = (planId: string): string => {
    let current = planId
    const seen = new Set<string>()
    while (true) {
      if (seen.has(current)) return current
      seen.add(current)
      const plan = byId.get(current)
      // A revision knows the plan it replaced, not the one that replaced it; walk backwards by
      // asking every plan for its `supersededByPlanId` pointer.
      const parent = plan
        ? plans.find((candidate) => candidate.supersededByPlanId === current)
        : undefined
      if (!parent) return current
      current = parent.id
    }
  }
  for (const plan of plans) {
    if (!rootOf.has(plan.id)) rootOf.set(plan.id, resolveRoot(plan.id))
  }
  return { rootOf }
}

export function lineageRootOf(index: LineageIndex, planId: string): string {
  return index.rootOf.get(planId) ?? planId
}

export interface ReplanBudget {
  lineageRoot: string
  used: number
  limit: number
  remaining: number
  /** Applied revisions counted, newest first (for diagnostics). */
  appliedPlanIds: string[]
}

/**
 * Counts policy-authorized revisions of one lineage. The count is a SQL query over events whose
 * payload names the applied plan, mapped back to the lineage root — no time window, no event cap.
 */
export function replanBudgetOf(input: {
  store: SqliteStore
  projectId: string
  plans: PlanDraft[]
  planId: string
  limit: number
}): ReplanBudget {
  const index = buildLineageIndex(input.plans)
  const lineageRoot = lineageRootOf(index, input.planId)
  const rows = input.store.db
    .prepare(
      "SELECT payload_json FROM project_events WHERE project_id = ? AND event_type = 'plan.replan.applied'",
    )
    .all(input.projectId) as Array<{ payload_json: string }>
  const appliedPlanIds: string[] = []
  for (const row of rows) {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(row.payload_json) as Record<string, unknown>
    } catch {
      continue
    }
    if (payload.authorizedBy !== 'policy') continue
    const appliedPlanId = typeof payload.appliedPlanId === 'string' ? payload.appliedPlanId : null
    const sourcePlanId = typeof payload.sourcePlanId === 'string' ? payload.sourcePlanId : null
    // Prefer the persisted lineage hint; otherwise map the plan (applied or source) to its root.
    const declaredRoot = typeof payload.lineageRoot === 'string' ? payload.lineageRoot : null
    const root = declaredRoot
      ?? (appliedPlanId ? lineageRootOf(index, appliedPlanId) : sourcePlanId ? lineageRootOf(index, sourcePlanId) : null)
    if (root !== lineageRoot) continue
    appliedPlanIds.push(appliedPlanId ?? sourcePlanId ?? '')
  }
  const used = appliedPlanIds.length
  return {
    lineageRoot,
    used,
    limit: input.limit,
    remaining: Math.max(0, input.limit - used),
    appliedPlanIds,
  }
}
