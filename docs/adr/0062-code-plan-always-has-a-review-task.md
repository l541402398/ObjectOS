# ADR-0062 — A code plan always carries a review task

- Status: Accepted (Phase 2.9-P0)
- Related: ADR-0033 (review is read-only, prose verdicts), ADR-0047 (trusted evidence), ADR-0059

## Context

The delivery gate requires review evidence for the current content (ADR-0033). A real DeepSeek plan
contained only a developer and a tester task: it completed, its tests really passed, and then delivery
could never happen — the journey honestly said "计划已完成，但当前内容还没有通过的审查". The local rule
template already had a reviewer; model plans were not guaranteed to.

## Decision

`ensureReviewTask(goal, tasks)` (packages/planning) appends exactly one reviewer task when a plan has
developer work and no reviewer:

- it depends on **every** developer task;
- `expectedArtifacts: ['审查报告']`;
- the description states the review-artifact contract explicitly
  (`artifactType: 'review'`, `reviewedObjects`, `findings`, `conclusion`, `blockers`, `changedFiles`) and
  forbids modifying the reviewed code;
- it is idempotent (no second reviewer) and does nothing for plans without developer work.

It is applied to model-generated plans in `OrchestrationService.generateAIPlan`. The local template is
unchanged (it already ships reviewer + tester).

## Consequences

- Model plans can now satisfy the review gate; delivery is still gated by real review evidence, a merge
  commit and post-merge verification.
- Plan task counts may be one higher than the model proposed; the review task is visible in the plan and
  can be edited/rejected like any other task before approval.

## Verification

- `tests/p29-review-coverage.test.ts`: appends one reviewer depending on all developers, carries the
  artifact contract, is idempotent, ignores plans without developer work.
- Real DeepSeek run (post-change): generated plan had **3 tasks** (developer, tester, reviewer).
  Delivery progress is recorded in `docs/v2/evidence/p29-task1-task2-evidence.md`.
