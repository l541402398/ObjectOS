# ADR-0028 — Autonomous re-review is a verification step, not a new plan

- Status: Accepted (Phase 2.8.8)
- Related: ADR-0024 (verdict), ADR-0025 (snapshot), ADR-0026 (autonomy), ADR-0030 (delivery)

## Context

Phase 2.8.7 closed the loop up to "developer fixed the code and the test passes", and then stopped:
the fix changed file content, so the existing review went stale, and the plan-level check concluded
"current content has no review". The only path out was the Replanner, which produced a whole new
plan revision (r3, r4, …), re-assigned Agents and re-ran work that had already been done. In one
real run that ended in 21 revisions.

The product already had everything needed: an approved plan with a reviewer task, a grant that
allowed the reviewer's Run, and a scheduler that starts Runs for `ready` tasks. What was missing was
the decision "this verification evidence expired — re-run the verification".

## Decision

`ReviewCoordinator` (runtime) runs inside the existing autonomy pass, before any new revision is
considered:

1. **Trigger** (all must hold): the plan is `paused`/`running`, there is no active Run, the shared
   review resolver reports *no current review* (historical/stale only), no verification is failing,
   the workspace exists, the plan has a review task, and the execution grant is valid and covers the
   reviewer's Agent.
2. **Reuse, do not replan**: the plan's own review task is reopened through legal domain transitions
   (`done → review → blocked → ready`), performed synchronously so no scheduler tick can observe the
   intermediate `review` state and complete the task with the stale Artifact. Every hop is a recorded
   `task.moved` event; the old Review Artifact is never overwritten or deleted.
3. **Idempotency by content**: the plan execution carries `reReview = { taskId, fingerprint,
   requestedAt }`. The same content fingerprint is never re-reviewed twice; a crash between the moves
   leaves the marker so the intent survives a restart.
4. **No new plan if none is needed**: proposals that only existed because the review went stale are
   rejected with an auditable reason (`auto-review superseded the revision`) and the revision budget
   is not consumed.
5. **Fallback**: if the plan has no review task, or no review scope can be recovered from a previous
   Artifact, the coordinator reports `needs-replan` and the existing Replanner path adds the minimal
   task.
6. **Authorization**: a re-review is a real Agent Run. Without a valid grant covering the reviewer it
   is `blocked`, never started "just this once".

## Consequences

- A code change no longer escalates to full replanning: the product re-verifies the current content
  with the plan it already has.
- Review history stays append-only: the stale review remains, the new review is a new Artifact bound
  to the new snapshot.
- A failed re-review is still a legal completion of the review task (a defect was reported); the gate
  refuses to pass and the fix path resumes.

## Tests

`tests/p288-auto-review.test.ts`: schedules on stale content, creates no new revision, resumes the
plan, is idempotent per fingerprint, refuses while a verification fails, reports `needs-replan`
without a review task, and refuses when the grant is revoked.
