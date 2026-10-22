# ProjectOS Next UI — Open Issues

Last updated: 2026-10-22  
Severity: P0 data/business loss, P1 migration blocker, P2 quality, P3 polish.

For the complete post-migration residual list, package status and verification gaps, see
[`REMAINING_ISSUES.md`](REMAINING_ISSUES.md).

## P0 — protection / data

| ID | Issue | Evidence | Status |
|---|---|---|---|
| P0-1 | Another worktree (`C:\...\ProjectOS`, branch `feature/v1.6-ux`, `98cd5a3`) exists and may be another AI session. | `git worktree list` | **Open — isolated migration worktree created; never modify the other worktree.** |
| P0-2 | Functional baseline job finished. e2e/agent/v13/teamwork/package pass; v12 now passes after overlay migration. | `v12-e2e.mjs` | **Closed.** |
| P0-3 | Baseline checkpoint committed at `e58fbd2`. | `git log` | **Closed.** |

## P1 — blockers

| ID | Issue | Evidence | Status |
|---|---|---|---|
| P1-1 | Formal Task Inspector duplicate (`PlanReviewNext`) migrated to shared `InspectorShell`. | `OVERLAY_AUDIT.md` #6, `PlanReviewNext.tsx` | **Closed.** |
| P1-7 | Last Ant Modal/Drawer removed from renderer; legacy `PlanReviewWorkbench` deleted after extracting its helper import. | `PlanReviewWorkbench.tsx` deletion | **Closed.** |
| P1-2 | Settings nested modals/drawers migrated to DialogShell/InspectorShell; v12 passes. Content-level duplicate detail styling remains. | audit #7–#14 | **Overlay migration closed; polish open.** |
| P1-3 | Task Board Drawer + create/edit/acceptance migrated to InspectorShell / DialogShell; board composition retained. | audit #15–#18 | **Closed.** |
| P1-4 | `AppLayout` still uses Ant primitives internally, but the shell, rail, topbar and navigation are visually migrated and all bootstrap/shortcut tests pass. | `components/AppLayout.tsx` | **Accepted** — internal Ant primitives only. |
| P1-5 | Formal task/agent actions use real preload APIs; prototypes must not be mistaken for migrated business flows. | `PlanReviewNext`, `TaskBoardPage`, `AgentWorkbenchPage` | **Closed** — v12/v13/e2e/agent/package all pass. |
| P1-6 | Settings top-level migrated to `DialogShell`; v12 passes after updating the legacy close selector. | `SettingsModal.tsx`, `v12-e2e` | **Closed.** |

## P2 — visual / engineering

| ID | Issue | Evidence | Status |
|---|---|---|---|
| P2-1 | Legacy Ant pages use 10–12px text and dense default forms. | `docs/design/OVERLAY_AUDIT.md` | **Resolved for body copy**; chart micro-labels remain 9–11px. |
| P2-2 | `SheetShell` is implemented but not yet exercised by a real page. | `docs/design/OVERLAY_SYSTEM.md` | **Closed** — Runs, Agent Studio, group chat and Worktree Diff use it. |
| P2-3 | Liquid Glass React SVG filter / forced Aurora are not production-safe. | Design Lab perf evidence | Accepted limitation; static fallback. |
| P2-4 | 125% Electron capture can crop the right edge while DOM width is correct. | prior Design Lab evidence | Known; document per screenshot. |
| P2-7 | Task Board full-page capture can look like an empty card; DOM measurement shows the card is shorter than its column, with all text present. | `docs/next-ui/screens/pages/task-board.png` | **Closed as misdiagnosis**; no missing content. |
| P2-8 | Workspace code editor long lines clipped at 1100px. | `docs/next-ui/screens/pages/workspace-1100.png` | **Resolved** with Monaco word wrap + compact file pane; token contrast still under review. |
| P2-5 | Agent Lab save and approval Lab are local-only. | `OVERLAY_SYSTEM.md` | **Closed** — formal pages use real mutations; Lab remains a prototype route. |
| P2-6 | Settings uses `DialogShell modal={false}` so Ant Select/Dropdown portals do not fight the Radix focus scope. | `SettingsModal.tsx`, `DialogShell` | **Resolved behaviourally**: non-modal focus guard contains Tab focus (40/40 tabs) while allowing Ant portals. Radix modal remains false. |

## P3 — polish

| ID | Issue | Status |
|---|---|---|
| P3-1 | Some legacy icons use Ant Design outlined set; migrate to Lucide with page. | Open |
| P3-2 | Legacy `.po-*` CSS remains after page migration; remove only when no references. | Open |
| P3-3 | Tooltip/popover layering outside the overlay stack needs a formal focus-stack check. | Open |

## Closed / verified

- [x] Five Design Lab fixes completed and accepted as visual baseline.
- [x] Overlay primitives and three samples implemented (31/31 Design Lab checks).
- [x] Dirty-close guard, focus/Escape, backdrop z-index and Electron ghost workaround.
- [x] Baseline lint/typecheck/unit/build pass (265 tests).




