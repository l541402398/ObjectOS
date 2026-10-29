# ADR-0029 — A revision budget belongs to a goal lineage

- Status: Accepted (Phase 2.8.8)
- Supersedes: the "project + last 24h" counting from Phase 2.8.7
- Related: ADR-0026 (policy-authorized autonomy), ADR-0028 (re-review)

## Context

Phase 2.8.7 fixed two ways the `maxAutoReplans` cap could be bypassed (a bounded 500-event window
and applying proposals against a superseded plan), but the budget itself was still counted **per
project over the last 24 hours**. That has the wrong semantics in every direction:

- a new revision (new plan id) does not inherit the count, so a chain could run forever;
- a restart or 24h of silence silently refills the quota;
- an event flood pushes earlier applies out of view;
- two independent goals in one project compete for one quota.

## Decision

The budget is bound to the **goal lineage**: the chain of plan revisions derived from the persisted
`supersededByPlanId` pointers. The root of the chain is the stable goal identity.

1. `buildLineageIndex` maps every plan id to its lineage root; `lineageRootOf` resolves one plan.
2. `replanBudgetOf` counts `plan.replan.applied` events whose `authorizedBy === 'policy'` and whose
   applied/source plan belongs to the same lineage root. The query has **no time window and no event
   cap**; the count is a SQL aggregate over the whole project history.
3. The applied event persists `lineageRoot`, so an audit does not need to reconstruct the chain.
4. Re-authorizing more budget is a deliberate, auditable act (a recorded policy change). Nothing in
   the product raises the cap, recreates the goal or clears history to get around it.

## Consequences

- A revision chain can never exceed the user's budget, regardless of restarts, time, or event volume.
- Two goals created independently in the same project have independent quotas.
- Changing the policy value changes the limit for future decisions; it does not retroactively refund
  used revisions.
- The lineage walk is O(plans) per decision and plans are few; no schema change was needed
  (`plan_json` already carried `supersededByPlanId`).

## Tests

`tests/p288-delivery-lineage.test.ts`: root derivation across three revisions, cumulative counting
across the chain with year-old events and an 800-event flood, and independence of a second goal.
