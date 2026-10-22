# ProjectOS Next UI — Open Issues

Last updated: 2026-10-22  
Severity: P0 data/business loss, P1 migration blocker, P2 quality, P3 polish.

## P0 — protection / data

| ID | Issue | Evidence | Status |
|---|---|---|---|
| P0-1 | Another worktree (`C:\...\ProjectOS`, branch `feature/v1.6-ux`, `98cd5a3`) exists and may be another AI session. | `git worktree list` | **Open — isolated migration worktree created; never modify the other worktree.** |
| P0-2 | Functional baseline job finished. e2e/agent/v13/teamwork/package pass; v12 fails on a pre-existing settings pointer-interception bug. | `baseline-functional.log` | **Closed for baseline; v12 defect tracked as P1-6.** |
| P0-3 | No baseline checkpoint commit yet. | `git log` | **Open — commit after baseline docs/tests.** |

## P1 — blockers

| ID | Issue | Evidence | Status |
|---|---|---|---|
| P1-1 | Formal Task Inspector duplicate (`PlanReviewNext`) still uses a private Radix sheet. | `OVERLAY_AUDIT.md` #6 | Open — migrate to InspectorShell after baseline. |
| P1-2 | Settings has nested Ant modals and three duplicate detail drawers. | audit #7–#14 | Open. |
| P1-3 | Task Board Drawer + three Modals remain Ant; nested overlay risk. | audit #15–#18 | Open. |
| P1-4 | `AppLayout` is Ant-based (`@projectos/ui`, Ant dropdown/tooltip/badge); page migration must preserve bootstrap/navigation/command shortcuts. | `components/AppLayout.tsx` | Open. |
| P1-5 | Formal task/agent actions use real preload APIs; prototypes must not be mistaken for migrated business flows. | `PlanReviewNext`, `TaskBoardPage`, `AgentWorkbenchPage` | Open — every migrated page needs a real-flow test. |
| P1-6 | `v12-e2e` baseline fails: Settings close button is covered by `.v16-setting-kv` content, so the modal cannot be closed by pointer. | `baseline-functional.log`, `features/settings` | Open — fix with unified settings overlay. |

## P2 — visual / engineering

| ID | Issue | Evidence | Status |
|---|---|---|---|
| P2-1 | Legacy Ant pages use 10–12px text and dense default forms. | `docs/design/OVERLAY_AUDIT.md` | Open. |
| P2-2 | `SheetShell` is implemented but not yet exercised by a real page. | `docs/design/OVERLAY_SYSTEM.md` | Open. |
| P2-3 | Liquid Glass React SVG filter / forced Aurora are not production-safe. | Design Lab perf evidence | Accepted limitation; static fallback. |
| P2-4 | 125% Electron capture can crop the right edge while DOM width is correct. | prior Design Lab evidence | Known; document per screenshot. |
| P2-5 | Agent Lab save and approval Lab are local-only. | `OVERLAY_SYSTEM.md` | Open — formal pages must use real mutations. |

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

