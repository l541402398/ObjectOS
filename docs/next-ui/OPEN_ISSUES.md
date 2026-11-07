# ProjectOS Next UI — Open Issues

2026-11-07 K2: the existing `design-lab-e2e.mjs` and `design-lab-contrast.mjs` still target the old
stage-first surface; the former also requires a rejected approval modal. Keep their actual failures
in the K2 report and use `premium-lab-e2e.mjs` for the approved DAG (32/32 PASS in this run).
Its native-composited diagnostic finds one existing light-theme `待批准` / `.pdl-state` sample at
4.46:1; dark DAG and both inspector samples are above 4.5:1. The approved before/after DAG PNGs
are byte-identical. Track this badge for separate visual review; do not restyle the protected baseline
as part of organization knowledge. Axe contrast is incomplete on glass, so K2 adds explicit native
compositor sampling for its new surfaces. Actual commands, scopes and results:
[`organization-knowledge-k2/REPORT.md`](../v2/evidence/organization-knowledge-k2/REPORT.md).

2026-10-31: open — (1) full Vitest has the same requirement-integration timeout (module alone 15/15); (2) requirement-integration-e2e times out waiting for the truncated-diff notice, cause not located; (3) plan execution grants are not linked to requirement start intents; (4) page-level card structure still reads as generic cards (overview stat row, lifecycle block); (5) glass frame frame-rate is a rough rAF sample (48–61 fps), no GPU profile; OS DPI/screen reader/user visual acceptance unverified.

2026-10-30 requirement-owned workflows supersede the configurable-workflow / UC gaps below. Live UC
types, APIs and storage grouping are removed with document-preserving migration. Task workflow inheritance,
drag/drop templates, document gates, native node execution and automatic Agent assignment are implemented.
Remaining: per-task explicit start before continuous execution; no external CLI workflow adapter; the
clickable material journey is currently on the requirement workbench, not every global route. Requirement-wide
acceptance/delivery, bulk manual assignment, Agent composition, settings consolidation, prepared-workspace
base synchronization, conflict UI and A2.2b remote jobs remain open. Final full test run has one timeout
(613 PASS / 4 SKIP); its entire module passes separately 15/15, final flow tests 18/18. Do not call that run
all green. See [current report, screenshots and command output](../v2/evidence/requirement-guided-flow/REPORT.md).

2026-10-30 A3.2a supersedes the integration gap in the A3.1 note below: task integration and preparation
of new dependent workspaces are implemented. Remaining: requirement-wide verification/delivery,
automatic synchronization of an already-prepared task base, conflict-resolution UI, managed autonomous
scheduling, Agent composition, configurable document gates/workflows, settings consolidation and A2.2b
remote jobs. Details and actual acceptance status: [A3.2a report](../v2/evidence/requirement-integration/REPORT.md).

2026-10-30 A3.1: new requirement workbench evidence is in
[requirement-work/REPORT.md](../v2/evidence/requirement-work/REPORT.md). Requirement/UC/task grouping,
independent worktree approvals and local native execution are real. Integration of reviewed task
outputs, dependent-task baselines, requirement-level verification/delivery, Agent composition,
workflow configuration and settings consolidation remain open. New managed tasks with prerequisites
are explicitly blocked until integration is connected; old plan paths are retained. The requirement
page uses its own actual state instead of the legacy plan journey, which could imply nonexistent AI work.

2026-10-30 current system migration: the five Lab fixes and shared shell/page/overlay implementation
are in this working branch. See the current [report and validation](../design/system-premium/REPORT.md)
for actual PASS/FAIL/SKIP, including defects found by the full native matrix and their rechecks.
Latest typography feedback uses packaged Noto Sans SC and explicit legacy/code font aliases;
cold route/detail/settings readiness now has separate frame and platform-font evidence. See the
report's font-fallback reproduction and Electron test-launch investigation rather than inferring
the Windows popup was a confirmed product runtime crash.
Remaining acceptance boundaries: user aesthetic approval, manual screen-reader listening, other OS
renderers, external-service deployment and newly logged-in organization state combinations. The
organization execution work (A2.2b) remains separate; this UI change does not enable it.

2026-10-29: A2.2a adds real registered devices / expiring native-confirmed local consent. Job leases,
Run asset adoption and execution are still A2.2b. Its ten axe states report 0 violations / 2 manual
review items; native OS dialog pixels/input and final aesthetic acceptance are unverified. The
user has authorized a system-wide adoption of the approved DAG screenshot with real-menu mapping
(ADR-0070); first resolve and verify the Lab's five contract prerequisites, then audit every route.

Current organization extension (2026-10-29): A2.1's Settings asset catalog is independently
reviewable; Worker grants/leases, local linking and Run binding resolver remain A2.2. Rendered
Impeccable CDP detection did not complete; source `[]` and focused Electron keyboard/label/contrast/
overflow checks are separate evidence. Full axe/screen-reader and final aesthetic acceptance are
not claimed. Historical five-fix completion notes below conflict with current Lab source; see the
A1/A2 UI reports and preserve the user-approved screenshot authority.

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




