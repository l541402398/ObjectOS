# Acceptance report — Agent overview P0 + P1-C visual masters

- Branch: `fix/agent-overview-ux-recovery`
- P0 implementation commit: `58e8c2845f675a1e4c5f8634243080ca0b466b71`
- P1-C visual commit: `4bc1997b240b5ffa1d11bb4c9ab5ccccfacfd03d`
- Remote verification: `git ls-remote` returned the same SHA at push time
- Base: `v2.0-agent-overview` / `b4d400330819390a8876683b57e108136024cd34`
- Scope: **P0-A, P0-B and P1-C visual masters**. P1-C awaits user visual review before rollout.
- Evidence root: `docs/agent-overview/evidence/`, `docs/ui-recovery/`

## Status matrix

| ID | Requirement | Result | Evidence |
|---|---|---|---|
| G01 | Real relationship lines visibly rendered; pixel proof, not DOM count | **PASS** | screenshot diff 3,903 visible pixels; 11/11 endpoints within node bounds; 11/11 after real zoom to 1.4 |
| G02 | Idle agents leave main graph; standby dock expandable | **PASS** | 4 graph agents / 1 standby; `overview-1440-standby.png`; focus projection unit test |
| G03 | In-node approval via existing API, risk confirmation, duplicate rejection | **PASS** | real `approval.decide`; approved persisted; duplicate rejected “授权请求已被处理” |
| G04 | Navigation closure: sessions, plan DAG, approval, runs | **PASS WITH GAPS** | sessions and plan DAG return verified; approval center has no explicit graph-return button; runs/tasks only history back |
| G05 | Three production visual masters, distinct compositions | **PASS (awaiting visual review)** | Agent Command Deck, editorial project home, document review room; Light/Dark/1440/1024/125 screenshots |
| G06 | Planner/Scheduler/AgentRunner/Gate/Worktree not rewritten | **PASS** | no changes in those modules; diff limited to renderer, orchestrator return button, tests |
| G07 | Push complete SHA + evidence | **PASS after push** | branch SHA + git ls-remote recorded below |

## Commands actually run

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS (0 errors) |
| `pnpm eslint apps/desktop/src/renderer/src/features/collaboration-overview scripts/agent-overview-e2e.mjs tests/collaboration-focus.test.ts` | PASS (0 errors) |
| `pnpm vitest run tests/collaboration-focus.test.ts` | PASS (2 tests) |
| `node scripts/agent-overview-e2e.mjs` | **30 PASS / 0 FAIL** (real Electron, isolated data dir, local fake provider) |
| `pnpm build:desktop` | PASS |
| `pnpm lint` | PASS (0 errors; pre-existing warnings; dependency boundaries OK) |
| `pnpm test` | **FAIL (pre-existing flake)** — 494 passed / 1 failed / 4 skipped; failure `tests/r1-budgets.test.ts`. Earlier run 495/0/4; latest real run reported. |
| `pnpm package:dir` + `pnpm test:package` | **PASS** — packaged EXE creates project, writes starter and recovers after restart |

## Real Electron checks (30 PASS)

1. Real projection: 1 pending approval, 2 working agents, 2 artifacts, 1 handoff.
2. Plan has 4 tasks and `plan.taskIds`.
3. 4 active graph agents / 1 standby; standby expands and is selectable.
4. 11 relationship edges: assignment, dependency, artifact, approval, handoff.
5. Screenshot diff proves edge pixels visible (3,903).
6. Endpoint alignment 11/11 at rest and 11/11 at zoom 1.4.
7. No horizontal overflow at 1440 or 1024.
8. Artifact inspector opens real persisted body.
9. Agent inspector opens real Run/approval details.
10. Approval node opens real request parameters; risk checkbox blocks approval until checked.
11. Approval writes real status and refreshes; duplicate decision is rejected.
12. Session workspace opens from an agent with a session; “返回协作总览” returns and restores the selected agent.
13. Plan DAG opens and “返回协作图” returns.
14. Activity drill-down reaches a real route.
15. Dark token applies; 1024 keeps the same graph (not three columns).
16. 125% zoom is real and no overflow.
17. Reduced-motion disables the handoff animation.
18. Runtime restart restores agents, artifacts, tasks and the approved status.

## Explicit FAIL / SKIP / BLOCKED

- **FAIL**: none in the executed P0 E2E.
- **BLOCKED**: permission-insufficient approval. This local app has no role/permission denial path to exercise; backend enforcement exists but cannot be honestly simulated from the UI.
- **SKIP**: expired approval TTL, because the fixture does not create a short-TTL approval; not claimed.
- **FAIL (known flake)**: latest full suite 494 passed / 1 failed (1-budgets timing) / 4 skipped; package smoke PASS on the final P1 tree.
- **PENDING USER REVIEW**: P1-C three visual masters are implemented as real routes and screenshots, but not yet approved or rolled out to every page.

## Known gaps

1. Native React Flow edges still do not render because node measurement is empty; the same-viewport SVG layer is retained with pixel proof and a mask. This is a documented workaround, not native Edge acceptance.
2. `/runs` has no explicit “return to graph” control and relies on shell/history. `/approvals` now has a visible “返回协作图” button.
3. Graph selection/filter/viewport are restored through sessionStorage for the current window, not encoded in a shareable URL.
4. Old Agent session workspace is an explicit legacy route, not fully migrated into graph-native drawers.
5. E2E uses a local fake provider and seeded artifact/handoff rows; it does not prove real model delivery.
6. `r1-budgets` full-suite timing failure remains pre-existing.

## Screenshot evidence

`docs/agent-overview/evidence/screenshots/`:

- `overview-1440-light.png`
- `overview-1440-dark.png`
- `overview-1440-standby.png`
- `overview-1440-zoom.png`
- `overview-1440-light-125.png`
- `overview-1024-all.png`
- `overview-1024-agents.png`
- `overview-1024-tasks.png`
- `approval-inline-confirm.png`
- `overview-1440-approved.png`
- `agent-inspector-1440-light.png`
- `artifact-inspector-1440-light.png`
- `overview-1440-restart-light.png`

Raw checks: `docs/agent-overview/evidence/electron-checks.json`.

P1-C visual masters (same folder):

- `studio-project-home-1440-light.png`
- `studio-project-home-1440-dark.png`
- `studio-project-home-1024-light.png`
- `studio-project-home-1024-dark.png`
- `studio-project-home-1440-125.png`
- `studio-review-1440-light.png`
- `studio-review-1440-dark.png`
- `studio-review-1024-light.png`
- `studio-review-1024-dark.png`
- `studio-review-1440-125.png`

P1-C checks in Electron E2E: project home renders real project/plan/pending approval; review room renders a real pending queue and request evidence. Both are screenshotted at 1440/1024, light/dark and 125%.

