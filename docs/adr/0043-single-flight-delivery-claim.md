# ADR-0043 — Single-flight delivery claim (preventive)

- Status: Accepted (Phase 2.8.8)
- Related: ADR-0030 (delivery), ADR-0042 (completion drives a pass)

## Context

While collecting closure evidence I saw two `Merge ProjectOS plan …` lines close together in
`git log --graph` and concluded that the same plan had been merged twice. That conclusion was
**wrong**: `git rev-list --merges --count HEAD` is `1` in both the run where I saw it and the final
run. The second line is the plan branch's own commit — the scheduler commits the worktree with the
same message, so a branch tip looks like a merge subject.

The retraction still leaves a real gap worth closing: delivery had **no atomic guard**.
`autoDeliverCompleted` selects completed plans whose `execution.mergedAt` is null, checks the
preconditions, and merges. Two passes (a scheduler tick and an autonomy pass, or two event-driven
passes) can both select the same plan before either writes `mergedAt`, and nothing in SQLite prevents
two merges.

## Decision

Add a compare-and-set claim before the merge:

- `claimPlanDelivery(planId, at, staleMs = 10min)` performs one `UPDATE … WHERE id = ? AND
  json_extract(plan_json, '$.execution.mergedAt') IS NULL AND COALESCE(deliveryClaimedAt, 0) < at - staleMs`,
  so exactly one caller observes `changes === 1`;
- a pass that loses the claim skips the plan;
- a failed merge releases the claim (`releasePlanDelivery`) so a later pass may retry;
- a claim older than the grace window may be taken over, so a crashed process cannot block delivery
  forever;
- `PlanExecution` carries `deliveryClaimedAt` (JSON only, no migration).

## Consequences

- At most one merge per plan even with concurrent passes; once merged, a plan can no longer be
  claimed, so delivery stays idempotent.
- The claim is visible in plan JSON, which makes a stuck delivery diagnosable.
- Cost: one extra write per attempt. A merge that somehow ran longer than the 10-minute takeover
  window could in theory overlap; that would have to exceed the post-merge verification timeout
  (5 minutes per command) to matter.

## Tests

`tests/p288-delivery-claim.test.ts`: exactly one of two claims wins; a one-second-later claim loses; a
claim may be taken over after eleven minutes; a merged plan refuses new claims; release allows retry.
