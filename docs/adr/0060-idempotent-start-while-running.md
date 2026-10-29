# ADR-0060 — A second start while the plan runs is an idempotent no-op

- Status: Accepted (Phase 2.9-P0)
- Related: ADR-0033 (grant reservation), ADR-0056 (run-tests)

## Context

With `autoStartPlans` on, the autonomy pass can start an approved+authorized plan before the user's
click lands. In the real DeepSeek run, `orchestration.start` then failed with
"计划已经在执行中或暂停中；请使用继续执行", and the UI looked like the user's action broke something —
even though the plan was correctly running and no duplicate execution occurred.

## Decision

1. `orchestration.start` returns the already-running plan instead of throwing (idempotent). Nothing is
   started twice; the caller gets the truth (`execution.status = running`).
2. A paused plan is still not restartable: the message now explains that recovery is `continue`
   (resume), not a second start.
3. Grant reservation stays authoritative: it is checked before any new start, and a consumed reservation
   keeps the accounting honest.

## Verification

- `tests/p29-start-idempotent.test.ts`: with a running execution, `start` returns the same plan, keeps
  `running`, and adds no run ids.
- Real DeepSeek run (worktree evidence): 2 runs total — one developer run and one verification-only
  re-collection run — no duplicate execution from the manual start attempt.
- The E2E now classifies the race as `already-running` and passes, instead of failing on a correct
  product state.
