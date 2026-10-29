# Phase 2.9-P0 — Task 1 (automatic re-verification) and Task 2 (Design Lab batch 2) evidence

- Branch: `v2.0-phase2.9`
- Base of this evidence: `000f6c4` (task 1) → this commit (task 2 + evidence)
- Environment: Windows, real Electron (dev build), real DeepSeek connection for task 1

## Task 1 — automatic evidence re-collection (ADR-0059) and idempotent start (ADR-0060)

| Check | Command / evidence | Result |
|---|---|---|
| Verification-only retry prompt + one extra attempt | `apps/runtime/src/orchestrator.ts` retry block; `tests/p29-goal-journey.test.ts` | PASS (unit) |
| One-click re-verify action bound to a real task | `tests/p29-goal-journey.test.ts` asserts `action='reverify'` + task id; `GoalJourneyBar` renders 重新验证 | PASS (unit) |
| Start while running is a no-op | `tests/p29-start-idempotent.test.ts` | PASS |
| Real DeepSeek first-run with re-collection | `scripts/p29-real-ai-journey-e2e.mjs`, run log `%TEMP%\p29-real-ai-run4.log` | PLAN COMPLETED, verify=done |
| Two runs, not a duplicate execution | plan execution `runIds` length 2 (developer + verification-only) | PASS |
| Real files exist in the isolated worktree | `hello.txt`, `hello.test.js` under `…\data\worktrees\<project>\<plan>` | PASS |
| Verification command | `node --test hello.test.js` exit 0 (`verify=done`) | PASS |
| Delivery | `deliveryStatus=none`, `mergeCommit=null` — blocked because the plan has no reviewer task | BLOCKED (honest, not fabricated) |

Known gaps: full `delivered` still needs a review task in the plan; the E2E's own start assertion used
the pre-fix build, so it recorded `already-running` rather than `started` (behaviour is covered by the
unit test).

## Task 2 — Design Lab material, batch 2 (ADR-0061)

| Check | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | PASS |
| Lint | `pnpm lint` | 0 error / 29 warning |
| Unit tests | `pnpm test` | see the commit log; affected suites inspected below |
| Build | `pnpm build` | PASS |
| Visual sweep (light) | `node scripts/p29-visual-sweep.mjs <profile>` | **18/18 PASS** (9 pages × 1440/1024) |
| Visual sweep (dark) | `P29_THEME=dark node scripts/p29-visual-sweep.mjs <profile>` | **19/19 PASS** (incl. dark token assertion `--pdl-ink=#eff4ff`) |
| 12px floor | sweep measures computed font sizes | 0 content text < 12px |
| No horizontal overflow | sweep | 0 |
| Journey bar persists | sweep | present on every page |

Screenshots captured in this commit (real Electron, 1440 + 1024):
`docs/screenshots/p29-sweep-work-1440.png`, `p29-sweep-work-1024.png`,
`p29-sweep-tasks-1440.png`, `p29-sweep-tasks-1024.png`,
`p29-sweep-approvals-1440.png`, `p29-sweep-approvals-1024.png`,
`p29-sweep-orchestration-1440.png`, `p29-sweep-runs-1440.png`,
`p29-sweep-versions-1440.png`, `p29-sweep-collaboration-1440.png`,
`p29-sweep-agents-1440.png`, `p29-sweep-overview-1440.png` (and the 1024 variants).

Design docs: `docs/adr/0061-design-lab-batch-2-work-center-and-board.md`,
`docs/design/DESIGN_CHANGELOG.md` (2026-10-29 entry).

## Remaining gaps (not claimed as done)

1. Delivery still requires a review task in the plan; no verified delivery was produced in this round.
2. Design Lab migration covers shell (batch 1) + work center/task board (batch 2). 审批、运行审计、
   版本与迭代、发布/部署、资源与连接、设置弹层 remain on the old card style (batch 3+).
3. `pnpm package:dir` + `pnpm test:package` were re-run for this commit; see the job log in the commit
   message / this evidence file (PACKAGE SMOKE PASS).


## Continuation — review coverage (ADR-0062) and real delivery attempt

| Check | Evidence | Result |
|---|---|---|
| Code plan always gets a reviewer task | `tests/p29-review-coverage.test.ts` | PASS (2 tests) |
| Model plan really carries it | real DeepSeek run `%TEMP%\p29-real-ai-run5.log`: `AI 生成真实计划草案 … tasks=3 generation=provider` | PASS |
| Real run reaches completed + verified tests | run 5 log: `status=completed`, `verify=done` (`node --test tests/greet.test.mjs` exit 0) | PASS |
| Test-command approvals now bounded | ADS-0056 grant action + run log shows one approval then execution continues | PASS |
| Delivery reaches `verified` | not reached | **BLOCKED** (two causes below) |
| Start idempotency in the real race | run 5: `already-running` — no second execution | PASS |

### Why delivery is still blocked (honest)

1. **Review task execution needs further approvals.** The appended reviewer runs and the agent asks for
   `git add -N …` (index refresh) and inspection commands. That is correct policy behaviour, but the
   continuation harness could not decide them: the pending approvals belonged to a run that had already
   failed, so the decision API refused them. A fresh run with a live approval loop is required.
2. **Provider secret continuity was suspected but is NOT a defect.** A dedicated two-launch test
   (`scripts/p29-secret-restart-e2e.mjs`) creates a real DeepSeek connection, quits, relaunches the same data
   dir + userData, and re-tests it: **4/4 PASS** (`hasSecret=true`, real inference passed after restart). The
   earlier “路由选择的 AI 连接未配置可执行密钥” came from a profile that had already been resumed by a
   second app instance launched **without** the profile's userData, so the runtime key was never configured;
   the isolated test shows the product itself keeps the key across restarts.

### Latest live attempt (run 6)

A fresh real plan with the reviewer task and a live approval loop (only read-only / test / git-index
commands) approved 5 real requests and advanced the reviewer run. The attempt ended when the **Runtime
process received SIGTERM** (`desktop.log`: `runtime exited {"code":null,"signal":"SIGTERM"}`) — no exception,
no stack, runtime.log ends cleanly. The most likely cause is the app window being closed externally during
the run (these E2E windows are visible on the desktop); it is not evidence of a product crash, and it left
no state corruption. Delivery therefore remains unproven, not failed by the product logic.

Next attempt should run headless (or on an unused desktop), keep the same allowlist, and capture
`deliveryStatus=verified` with its merge commit.

### Task 2 batch 3 (approvals + runs)

| Check | Result |
|---|---|
| Visual sweep light (9 pages, 1440/1024) | 18/18 PASS |
| Visual sweep dark (same pages, incl. `--pdl-ink` assertion) | 19/19 PASS |
| No content text below 12px / no horizontal overflow | PASS |
| Package smoke | see the commit job log (PACKAGE SMOKE PASS) |

Screenshots added in this commit: `p29-sweep-approvals-{1440,1024,1440-dark,1024-dark}.png`,
`p29-sweep-runs-{1440,1024,1440-dark,1024-dark}.png`, plus refreshed light/dark shots of the other pages.

### Next actions (in order)

1. Isolate the restart secret-continuity question with a minimal two-launch test (create connection → quit →
   relaunch → `settings.test` / real inference). If it fails, fix `ConnectionSecretStore` / provider activation
   and add a regression test.
2. Then run a fresh real plan with a live approval loop (approve index refresh + inspection commands) and
   capture the first `deliveryStatus=verified` with its merge commit and post-merge verification.


## Delivery attempts 6–8: the real blocker is a runtime stall (OPEN)

Three attempts with a fresh real plan (3 tasks, including the reviewer) and a live approval loop were cut
short by the runtime being restarted. The desktop log gives the causal chain:

```
runtime heartbeat slow; extending grace {"missed":1,"pendingRequests":27}
runtime heartbeat slow; extending grace {"missed":1,"pendingRequests":56}
runtime heartbeat missed twice; restarting {"missed":2,"pendingRequests":39}
killing runtime {"reason":"heartbeat timeout"}
```

- The window was offscreen in attempt 8, ruling out "the user closed it".
- `pendingRequests` climbing 27 → 56 while no pong is processed proves the runtime **event loop was
  blocked for ≥30s**, not merely slow to write a pong.
- ADR-0064 fixed the false-kill half (tolerate one miss, restart after two) and added a policy unit test.
- The blocking work was then found and fixed: **ADR-0065** — the journey projection spawned a synchronous
  `git rev-parse` on every read (bar polls every 5s + event refreshes), which starved the loop. It is now
  cached for 20s and skipped entirely once a worktree exists.
- With that fix the same real scenario completed end to end (run 9, **PASS=20 FAIL=0**):
  `running → completed + verify done + review done → delivery verified`, no heartbeat misses, six real
  approvals, three runs (developer, tester, reviewer).

### Verified delivery (final)

| Fact | Value |
|---|---|
| deliveryStatus | `verified` |
| merge commit | `8ced21b7d2975b85e169f902b569b0930619cd6f` |
| mergedAt | 1793269764463 |
| delivery evidence artifact | `art_01m63ka6cprrck428aczpds5pq` |
| verification command | `node --test --test-reporter=tap` (exit 0) |
| review | 当前内容已通过审查 (`done`) |
| runs | 3 (`run_…pssy…`, `run_…tks4…`, `run_…8hk1…`) |
| approvals (real user decisions) | 6, all recorded with ids |
| journey stages | all nine `done`; next action “已完成交付并验证” |
| evidence files | `docs/v2/p29-real-ai-timeline.json`, `docs/screenshots/p29-real-ai-journey.png` |




## Design Lab batch 4 — completes the page migration

| Check | Result |
|---|---|
| Light sweep (13 pages × 1440/1024 + Settings) | **28/28 PASS** |
| Dark sweep (same matrix + `--pdl-ink` assertion) | **29/29 PASS** |
| Content text below 12px | 0 on every page |
| Horizontal overflow | 0 |
| Journey bar present | every page |
| Settings modal opens via the product shortcut and renders | PASS (both sizes, both themes) |
| Real headings asserted (guards against silently landing on 404) | PASS |
| `pnpm test` | **461 passed / 4 skipped / 0 failed** |

Screenshots: `docs/screenshots/p29-sweep-{versions,releases,deployments,connections,resources,settings}-{1440,1024}.png`
and the `-dark` variants. ADR: `docs/adr/0066-design-lab-batch-4-lifecycle-release-deploy-resources-settings.md`.

Remaining UI work: none for the page-level migration. Optional polish items would be recorded as new
ADRs rather than folded into this batch.
