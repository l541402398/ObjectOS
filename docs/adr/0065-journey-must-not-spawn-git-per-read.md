# ADR-0065 — The journey projection must not spawn git on every read

- Status: Accepted (fixes the stall from ADR-0064)
- Related: ADR-0064 (heartbeat tolerance and the stall), ADR-0053 (journey), ADR-0050 (baseline commit)

## Context

ADR-0064 recorded a runtime stall: `pendingRequests` grew 27 → 56 while heartbeats were missed and the
supervisor restarted the runtime, interrupting three real delivery attempts. The journey projection was
spawning **synchronous** `git rev-parse --verify HEAD` on every `work.journey` read, and the bar polls every
5s plus refreshes on business events. During a run these reads queued; each blocked the event loop for a
full process spawn (worse on Windows with AV scanning).

## Decision

1. `gitHasCommit(root)` is cached for 20s per project root; `resetJourneyGitCache()` exists for tests.
   A workspace's "has a commit" state changes at most once (the ADR-0050 baseline commit), so the cache
   cannot hide a real transition for long.
2. When the plan execution already has a `workspaceRef`, the git question is answered without spawning at
   all (`commit = true`): the worktree proves a commit exists.

## Verification

- `tests/p29-goal-journey.test.ts` still passes (6 tests) and resets the cache between cases.
- Real DeepSeek delivery attempt with the fix (run 9): **PASS=20 FAIL=0**, no heartbeat misses in the
  desktop log, and the chain completed — plan running → completed + verify done + review done →
  **delivery `verified`**, merge commit `8ced21b7d2975b85e169f902b569b0930619cd6f`, delivery evidence
  `art_01m63ka6cprrck428aczpds5pq`, three runs (developer, tester, reviewer) and six real approvals.
- Timeline and stage facts: `docs/v2/p29-real-ai-timeline.json`;
  screenshot `docs/screenshots/p29-real-ai-journey.png` (all nine stages done, “已完成交付并验证”).

## Consequences

- The journey bar is cheap enough to poll from every page.
- A genuine runtime hang still restarts after two missed pongs (ADR-0064), and the grace path logs the
  in-flight request count.
