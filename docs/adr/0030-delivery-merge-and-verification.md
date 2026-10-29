# ADR-0030 — Delivery is a merge commit plus a post-merge verification

- Status: Accepted (Phase 2.8.8)
- Related: ADR-0026 (auto-delivery policy), ADR-0028 (re-review), ADR-0029 (budget)

## Context

Phase 2.8.7 added a delivery guard set, but `mergedAt` was the only delivery fact persisted. That is
not enough: `mergedAt` proves a Git merge happened, not that the merged result still passes. It also
made a partial outcome unrepresentable — a merge followed by a failed check had nowhere to live
except "merged" (claiming success) or "not merged" (hiding a real side effect).

## Decision

Delivery is two facts, recorded separately:

1. **Preconditions** (all evaluated before touching Git):
   complete plan; no `needs_reconciliation` Runs; a *current, approving* review from the shared
   resolver; no unsuperseded failing verification **and at least one real passing verification
   command**; the version gate (when the plan belongs to a version) evaluated through
   `LifecycleService`; a still-valid PlanGrant at merge time; every changed file inside the granted
   paths and non-sensitive; the recorded target branch unchanged; the recorded base commit still an
   ancestor of the target HEAD (no history rewrite); a `git merge-tree` dry run with no conflict; and
   a clean target working tree.
2. **Merge**: the existing `worktrees.merge` (authorized paths, sensitive-file refusal, `--no-ff`,
   abort-on-conflict). Immediately after it succeeds the **real merge commit** is read
   (`git rev-parse HEAD`) and persisted *before* any verification, so a later failure can never erase
   the fact that a merge happened.
3. **Post-merge verification**: the plan's own recorded passing verification commands (test / build /
   typecheck / lint only — the tool *name* is not proof) are re-run in the target workspace with a
   timeout and process-tree kill.
4. **State**: `deliveryStatus` is `merged` → `verified`, or `merged_verification_failed` with the
   reason in `deliveryError`. A `test-report` Artifact holds the merge commit, the review fingerprint,
   the pre-merge snapshot (branch/base/target head/changed files/diff preview) and every command's
   exit code and output tail. `deliveryEvidenceId` links it.

The delivery is only reported as delivered when `deliveryStatus === 'verified'`; a
`merged_verification_failed` outcome is reported as a blocked delivery that *did* merge, never as
success and never as "nothing happened".

## Consequences

- A report can always answer: which commit was merged, which review approved the exact content, what
  was re-verified afterwards, and with which evidence Artifact.
- A failing post-merge check does not roll back automatically (no reset/force-push); it produces an
  explicit, actionable failure state for a human.
- Verification re-runs only commands that already passed inside the plan, keeping the delivery
  check anchored to what the user's grant actually authorized.

## Tests

`tests/p288-delivery-lineage.test.ts`: only passing verification commands are selected, real post-merge
verification reports pass/fail/not-applicable, merge dry-run detects conflicts, and a rewritten history
is detected through the base-commit ancestor check.
