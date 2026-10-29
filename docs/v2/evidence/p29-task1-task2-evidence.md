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
