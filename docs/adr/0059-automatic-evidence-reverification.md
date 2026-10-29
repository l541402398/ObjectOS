# ADR-0059 — Automatic evidence re-collection and one-click re-verify

- Status: Accepted (Phase 2.9-P0)
- Related: ADR-0047 (trusted test evidence), ADR-0048 (verification states), ADR-0053 (journey)

## Context

A real DeepSeek run wrote the files, ran `node --test` (exit 0) and then changed the code again. The
completion gate correctly refused to accept the older test run ("测试证据已过期"), the plan paused, and
the user saw "需要重新验证" — but nothing happened unless a human found the task and clicked something.
The automatic retry that existed was a generic "补证任务" prompt that still allowed writes, so the agent
could invalidate the evidence again, and it had a single attempt.

## Decision

1. **Verification-only retry.** When the unsatisfied requirement is `test`, the retry Run gets a
   verification prompt: run the real tests *now*, create a `test-report` artifact with command, exit
   code and output summary, and **do not modify source or tests**. If a code change is unavoidable, the
   agent must stop and explain instead of editing and testing again.
2. **One extra attempt for test evidence** (`max(configured, 2)`), so a single slip does not end the
   plan. Budgets, grants and approvals are unchanged.
3. **One-click re-verify.** The journey's next action carries `action: 'reverify'` plus the real task
   id; the global bar renders a 重新验证 button that calls `verification.request(projectId, taskId)` —
   the same bounded verification Run the runs page uses. It never edits code, never marks the task done
   and still goes through CompletionDecision.
4. Everything remains evidence-gated: a re-verify that fails to produce a real test run leaves the plan
   paused with the same honest state.

## Verification

- `tests/p29-goal-journey.test.ts`: a pause caused by stale evidence exposes `action: 'reverify'` with
  the task id, not just a link.
- `scripts/p29-real-ai-journey-e2e.mjs` (real DeepSeek): the retry Run is started automatically after a
  stale-evidence completion failure; results recorded in the Phase 2.9-P0 addendum.
