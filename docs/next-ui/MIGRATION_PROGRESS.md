# ProjectOS Next UI — Migration Progress

Last updated: 2026-10-22  
Branch: `feature/projectos-next-ui-full-migration`  
Base: `fa75923` (accepted Design Lab + overlay system)  
Latest checkpoint: `ffafadf` after workspace wrap, motion walkthrough and full 15-page matrix

This file is the recovery entry point. If a session is compacted or a new Agent
starts, read this file, `BASELINE_AND_RECOVERY.md`, `OPEN_ISSUES.md`,
`docs/design/PROJECTOS_DESIGN_SYSTEM.md` and the current Design Lab before
editing UI.

## Current stage

**Phase 2 — global shell + Settings slice.** Baseline is protected at `e58fbd2`; slice checkpoint `28fc994`.
The global Premium Liquid Glass app skin and the Settings DialogShell migration
are in progress; page-specific composition migration follows.

Baseline checks completed:

- [x] isolated worktree + branch
- [x] source worktrees identified and untouched
- [x] dependency install in isolated worktree
- [x] lint / typecheck / unit / build
- [x] Design Lab 31/31
- [x] package smoke + e2e/agent/v13/teamwork baseline
- [x] v12 baseline executed; pre-existing settings failure recorded
- [x] baseline checkpoint commit (`e58fbd2`)

## Page migration matrix

Status legend: `not-started`, `in-progress`, `migrated`, `blocked`, `not-applicable`.

| # | Surface / route | Source | Real business path | Overlay surfaces | Status |
|---:|---|---|---|---|---|
| 1 | App shell / navigation | `components/AppLayout.tsx` | bootstrap, runtime status, project select, command palette | settings, command palette | in-progress — global glass skin, collapsed rail fixed |
| 2 | Project Center `/` | `pages/ProjectCenterPage.tsx` | `projects.list`, create/import/delete | shared DialogShell create/import | in-progress — hero migrated; lower-page IA polish pending |
| 3 | Notifications `/notifications` | `pages/NotificationsPage.tsx` | notifications queries | none / row actions | in-progress (global skin) |
| 4 | Project Overview `/projects/:id` | `pages/ProjectOverviewPage.tsx` | overview, lifecycle mutations | shared DialogShell create/advance | in-progress — overlays migrated, page composition pending |
| 5 | Task Board `/projects/:id/tasks` | `pages/TaskBoardPage.tsx` | board, task CRUD, acceptance | shared DialogShell editors + InspectorShell detail | in-progress — overlays migrated; board IA still legacy |
| 6 | Orchestration / plan review `/orchestration` | `OrchestrationWorkspace.tsx`, `PlanReviewNext.tsx` | plan generate/validate/approve/reject, real DAG | plan modal, worktree SheetShell, formal task InspectorShell | in-progress — task sheet + diff migrated; plan workspace/graph pending |
| 7 | Agent Workbench `/agents` | `pages/AgentWorkbenchPage.tsx` | sessions, approvals, agent execution | DialogShell session, SheetShell group chat | in-progress — overlays migrated; three-column composition pending |
| 8 | Teamwork / Collaboration `/collaboration` | `pages/CollaborationPage.tsx` | inbox, handoff, cross-session messages | shared DialogShell send message | in-progress — overlay migrated; page composition pending |
| 9 | Workspace `/workspace` | `pages/WorkspacePage.tsx` | files, editor, preview, git | file/preview panels | in-progress (global skin) |
| 10 | Knowledge `/knowledge` | `pages/KnowledgePage.tsx` | knowledge search/entries | detail/actions | in-progress (global skin) |
| 11 | Operations `/operations` | `pages/OperationsPage.tsx` | operations snapshot, repair proposals | proposal detail | in-progress — compact operational cards, localized findings |
| 12 | Resources `/resources` | `pages/ResourcesPage.tsx` | resource inventory | row actions | in-progress (global skin) |
| 13 | Approvals `/approvals` | `pages/ApprovalsPage.tsx` | approval decisions | approval detail | in-progress — full-width decision surface |
| 14 | Project Settings `/project-settings` | `pages/ProjectSettingsPage.tsx` | project config, policy | forms | in-progress (global skin) |
| 15 | Project Health `/health` | `pages/ProjectHealthPage.tsx` | health checks, repair | repair dialogs | in-progress (global skin) |
| 16 | Runs `/runs` | `pages/RunsPage.tsx` | run list/detail, reconcile | SheetShell detail, DialogShell reconcile | in-progress — overlays migrated; page composition pending |
| 17 | Settings (global modal) | `features/settings/SettingsModal.tsx` + panels | AI connections, models, runtime, skills, tools | shared DialogShell + InspectorShell | in-progress — overlays migrated; content composition polish pending |
| 18 | Design Lab `#/design-lab` | `features/design-lab/` | prototype | Inspector, Agent, Approval | migrated baseline |

## Overlay migration inventory

The full 27-surface audit is in `docs/design/OVERLAY_AUDIT.md`. This checklist
tracks actual migration:

- [x] `OverlayRoot` / `DialogShell` / `SheetShell` / `InspectorShell` / `PopoverShell`
- [x] Task Inspector sample on `InspectorShell`
- [x] Agent config sample on `InspectorShell` + `PopoverShell`
- [x] Approval sample on `DialogShell`
- [x] dirty-close guard, focus/Escape, light/dark, reduced-motion
- [x] Settings top-level moved to DialogShell; v12 pass
- [x] Settings nested drawers/editors
- [x] formal `PlanReviewNext` task sheet → InspectorShell
- [x] settings detail drawers (Model/Skill/Runtime)
- [x] settings nested editors (model/Runtime/ACP)
- [x] Task Board detail drawer and 3 modals
- [ ] Runs detail/reconcile
- [x] Agent Studio + run-test modal
- [ ] remaining project/collaboration overlays
- [ ] legacy `PlanReviewWorkbench` removal

## Known baseline facts

- 15 routed pages + global settings + Design Lab.
- Accepted visual baseline: `docs/design/baselines/` and
  `docs/design-system/v1.6-commercial-ui/design-lab/`.
- Node/Electron baseline: Electron 43.8.2, React 19.3.1, Tailwind 4.
- `liquid-glass-react` SVG filter is not production-safe in this environment;
  static optical fallback remains.
- Forced Aurora WebGL is not production-safe; static fallback remains.
- `pnpm test`: 265 passed / 3 skipped.
- Design Lab E2E: 31/31.

## Next steps

1. Finish functional baseline job, record exits.
2. If clean, commit baseline docs (`bac...` checkpoint).
3. Migrate `AppLayout` + Project Center as the first visual slice while preserving
   real queries/navigation and `CommandPalette` behavior.
4. Then `ProjectOverview` + `TaskBoard`, then formal `PlanReviewNext`/overlays.
5. Update this file and `OPEN_ISSUES.md` after every checkpoint; never rely on
   chat memory.



## Slice 1 — global shell + Settings DialogShell

Status: implemented, engineering checks pass, visual review pending.

Changed:

- `apps/desktop/src/renderer/src/styles/next-ui-app.css` — global Premium
  Liquid Glass shell, floating workspace, compact rail, Ant control material.
- `main.tsx` — load the new app skin after legacy styles.
- `features/settings/SettingsModal.tsx` — Ant Modal replaced by `DialogShell`;
  top-level settings close is now a real header action.
- settings CSS, v12/v13 selectors updated for the new accessible close button.

Verified:

- `pnpm lint` / `typecheck` / `build` pass.
- `scripts/e2e.mjs` pass.
- `scripts/v12-e2e.mjs` **PASS** (baseline failed here; top-level settings fixed).
- `scripts/v13-e2e.mjs` **PASS**.
- `scripts/design-lab-e2e.mjs` 31/31.
- 1440 project center, 1440 task board, 1100 project center, settings dialog
  captured in `docs/next-ui/screens/`.

Known in this slice:

- Task Board cards still use the legacy composition; only material and density
  are skinned.
- Settings uses `modal={false}` because remaining Ant Select/Dropdown portals
  fight Radix focus scope. This must be replaced by Radix controls or a custom
  focus guard.
- A full-page Electron capture can leave one board tile stale until hovered;
  element capture is correct. The evidence shot uses a hover-forced repaint.
- Project Center and Task Board page-specific IA still need a real migration.

## Slice 2 — formal plan inspector + Task Board overlays

- `PlanReviewNext` task sheet now uses `InspectorShell`; the private Radix
  `po-plan-task-detail` sheet is gone. Real plan mutations, approval flow and
  compact ledger remain.
- Selected plan DAG paths are solid gradient-blue; the legacy dashed / flowing
  edge rule is overridden.
- Task Board create/edit/acceptance use `DialogShell`.
- Task Board detail drawer uses `InspectorShell`; selected task clearing is
  delayed 320ms so the closing surface never flashes “任务不存在”.
- Task Board tests updated to the accessible shared-surface contract; the
  outside-click assertion was changed to the intentional non-modal behavior
  (close via header, workspace stays available).
- Evidence: `docs/next-ui/screens/plan-task-inspector.png`,
  `task-detail-inspector.png`, `task-create-dialog.png`.
- Checks: plan-review UI 10/10; task-drawer UI 10/10; v12 PASS; v13 PASS;
  e2e PASS.


## Slice 3 — Settings nested overlays

- Model detail, Skill detail, Runtime detail → `InspectorShell`.
- Custom Runtime, ACP auth, Runtime edit, Add Model → `DialogShell`.
- Nested surfaces close when the Settings dialog closes via `settingsOpen`.
- Model detail carries a stable test id; v12 closes it explicitly before closing
  Settings (the non-modal inspector correctly sits above the settings dialog).
- v12 PASS; v13 PASS; Design Lab 31/31.

## Slice 4 — Project Center composition

- Added a real current-project hero (recent project, stage, completion, active
  Agents, last activity, progress, open action) above the metric grid.
- Removed the redundant “· 项目中心” suffix in the project switcher so it no
  longer truncates at 1440.
- Hero is pure data from `bootstrap`/`useProjectOverview`; no invented project or
  fake metrics.
- Evidence: `docs/next-ui/screens/project-center-1440.png`.
- Real task creation through the migrated DialogShell was exercised with a
  temporary project (title + acceptance criterion → task appears on the board).


## Slice 5 — Project Center create/import + Overview gates

- Project Center create/import moved from Ant Modal to `DialogShell`; e2e
  project creation still passes.
- Project Overview lifecycle create and stage advance moved to `DialogShell`;
  real lifecycle mutations retained.
- Project Center now has a real current-project hero above the metric grid.
- Evidence: `docs/next-ui/screens/project-center-1440.png`.


## Slice 6 — Collaboration send dialog

- Cross-session message composer moved to `DialogShell`.
- Real send mutation, wake switch and delivery semantics retained.
- `v17-collaboration-link-e2e.mjs` PASS.


## Slice 7 — Run audit Sheet + reconcile Dialog

- Run detail moved from a 920px Ant Modal to `SheetShell`; the audit timeline,
  approval block and artifacts retain real data.
- Human reconciliation moved to `DialogShell`; the original Run/ToolCall/Step
  records are preserved and no side effect is retried automatically.
- `v17-run-audit-modal-e2e.mjs` PASS.
- Evidence: `docs/next-ui/screens/run-detail-sheet.png`.


## Slice 8 — Agent Workbench overlays

- New Agent session → `DialogShell`.
- Plan group chat → `SheetShell`; transcript, participants, team progress and
  composer retained.
- Agent Studio itself is still the separate Ant surface; not claimed migrated.


## Round checkpoint — 2026-10-22

Current head: `d837656`.

Completed this round:

- protected baseline + worktree isolation
- full unit/build baseline and functional baseline
- global optical shell and compact rail
- Settings top-level + all nested editors/details
- Project Center hero + create/import
- Project Overview lifecycle dialogs
- Task Board create/edit/acceptance + task InspectorShell
- formal plan task InspectorShell + solid selected DAG edges
- Runs SheetShell + reconcile DialogShell
- Collaboration composer DialogShell
- Agent session DialogShell + group SheetShell
- 265 unit tests, 31/31 Design Lab, v12/v13/e2e/plan/task/runs checks

Remaining overlays: Agent Studio + run test, Orchestration plan generator
and worktree diff, Command Palette, legacy PlanReviewWorkbench. Page
composition for Orchestration, Agent Workbench, Runs, Knowledge, Operations,
Resources, Approvals, Workspace, Health, Project Settings, Notifications,
Project Center lower half is not final.


## Slice 9 — Command Palette + Worktree Diff

- Command Palette moved to `DialogShell`; keyboard selection/execution retained.
- Worktree Diff moved to `SheetShell`; real workspace diff/artifact metadata
  retained.
- Remaining orchestration Ant surface: the plan generation/review modal; it is
  tightly coupled to its existing `.po-plan-modal` styles and will be migrated
  together with the orchestration page composition, not by a blind wrapper swap.


## Round 2 checkpoint — 2026-10-22

Current head: `139acee`.

Additional overlays migrated this round:

- Command Palette → `DialogShell`
- Worktree Diff → `SheetShell`
- Project Center create/import → `DialogShell`
- Project Overview lifecycle create/advance → `DialogShell`
- Collaboration composer → `DialogShell`
- Agent session → `DialogShell`; plan group chat → `SheetShell`
- Run audit → `SheetShell`; reconcile → `DialogShell`
- Settings nested detail/editors → `InspectorShell` / `DialogShell`

Remaining Ant surfaces:

- Agent Studio main surface + run-test modal
- Orchestration plan generation/review modal (tightly coupled to
  `.po-plan-modal`; migrate with page composition)
- Legacy `PlanReviewWorkbench` helper still provides `hasPlanBlockingIssues`
  and cannot be deleted until that helper is extracted.

Remaining page-level composition work is unchanged and listed by the page matrix.



## Slice 10 — Agent Studio Sheet + run test

- Agent Studio main → `SheetShell` at 1280px; three-column template/editor/preview
  layout is preserved and now actually receives its width (SheetShell previously
  ignored the width prop for sheets).
- Run test → nested `DialogShell`.
- Real Agent creation E2E PASS (`v16-agent-studio-e2e`), including task run.
- Evidence: `docs/next-ui/screens/agent-studio-sheet.png`.
- This also fixed the shared `SheetShell` width bug for Run audit and group chat.


## Slice 11 — Orchestration canvas skin

- Header, metric cells, canvas frame, node surfaces and edges now use the
  Premium Liquid Glass tokens instead of flat white cards.
- Real graph topology, ELK-like layout, inspector and bottom dependency rail are
  untouched.
- This is a visual layer only; the orchestration plan modal and full canvas-first
  re-composition are still open.


## Slice 12 — Plan workbench Dialog + legacy removal

- Orchestration plan generation/review is now a `DialogShell` with the internal
  `PlanReviewNext` workspace, a real close action and an OverlayScrollArea.
- The last Ant `Modal`/`Drawer` in the renderer has been removed:
  `PlanReviewWorkbench.tsx` was only used for a re-export of
  `hasPlanBlockingIssues`; the import now points directly to
  `plan-review-logic.ts` and the legacy file is deleted.
- No `<Modal>` or `<Drawer>` remains in production renderer source.
- Evidence: `docs/next-ui/screens/plan-workbench.png`.
- `plan-review-ui-e2e` 10/10, `v13-e2e` PASS.


## Slice 13 — All page inventory + full overlay removal

- Every existing route captured through one real Electron session:
  `docs/next-ui/screens/pages/` — 15 pages, 0 renderer errors.
- All production renderer `<Modal>`/`<Drawer>` call sites are gone. The only
  remaining `ModalShell` strings are the shared primitives themselves.
- Orchestration plan modal migrated to `DialogShell`; real plan approval passed.
- Legacy `PlanReviewWorkbench` deleted after extracting its re-exported helper.
- Remaining work is page-level composition, not a remaining Ant overlay.

Page inventory:

`project-center`, `project-overview`, `task-board`, `orchestration`,
`agent-workbench`, `collaboration`, `knowledge`, `operations`, `resources`,
`approvals`, `project-settings`, `health`, `workspace`, `runs`, `notifications`.


## Round 4 checkpoint — 2026-10-22

Head: `8023df5`.

- Agent Studio → SheetShell; run test → DialogShell.
- Orchestration canvas optical skin.
- Orchestration plan workbench → DialogShell; real approval pass.
- All production renderer Modal/Drawer call sites removed.
- Legacy PlanReviewWorkbench deleted after helper import extraction.
- 15-page Electron inventory captured, 0 errors.
- 265 unit tests, plan-review 10/10, v13 PASS.


## Slice 14 — Information-page composition

- Approvals: request decision surface is full-width, status labels localized, raw
  detail is an inset evidence block rather than a flat grey paragraph box.
- Operations: three equal empty columns reduced to content-sized operational
  cards; labels localized (`发现`), no giant placeholder height.
- Screenshots refreshed in `docs/next-ui/screens/pages/approvals.png` and
  `operations.png`.


## Slice 15 — Cross-size/theme regression

- New `scripts/next-ui-regression.mjs` captures five representative pages:
  Project Center, Task Board, Orchestration, Approvals, Runs.
- Conditions: 1440 light, 1440 dark, 1100px, 125%; 60 captures across all 15 routed pages.
- Result: 0 horizontal overflows, 0 page errors.
- Evidence: `docs/next-ui/screens/regression/`.
- Known capture issue: one Task Board tile can be painted blank in a full-page
  Electron capture until the tile is individually repainted; DOM text is present
  and element capture is correct. Tracked as a P2 visual-evidence defect.


## Slice 16 — Canvas inspector + Agent three-column

- Orchestration node inspector is now a floating **non-modal** workspace panel:
  no backdrop, no aria-modal, canvas remains interactive; panel starts below the
  project header and keeps its Tabs/logs/dependency content.
- Agent Workbench opens the run inspector by default at >=1280px and reserves a
  384px right column, so the chat/composer is not covered.
- Evidence: `docs/next-ui/screens/orchestration-inspector.png`,
  `agent-workbench.png`.
- `v16-agent-studio-e2e` PASS; plan-review/v13 PASS; build/typecheck PASS.



## Slice 17 — Orchestration content column

- When a node is selected, the canvas card reserves a 406px right column for the
  non-modal inspector instead of letting the panel cover graph nodes.
- Canvas toolbar wraps at the narrower width instead of breaking labels into
  vertical characters.
- Graph topology, controls, minimap and inspector data stay unchanged.
- Evidence: `docs/next-ui/screens/orchestration-inspector.png`.


## Slice 18 — Expanded regression matrix

- Regression routes extended from 5 to 8 pages: added Agent Workbench,
  Knowledge and Health.
- Conditions: 1440 light, 1440 dark, 1100 and 125% — 60 captures (all 15 pages).
- Result: 0 horizontal overflow, 0 page errors.
- Agent Workbench keeps the run inspector as a reserved column at 1440 and a
  deliberate overlay below 1280.



## Slice 19 — True orchestration grid

- Canvas and node inspector now share `.po-orch-main` CSS Grid:
  `minmax(0,1fr) 390px` at desktop when a node is selected.
- Inspector is a normal grid child with no fixed positioning or backdrop.
- At <1280px the grid collapses to one column and the inspector becomes a
  520px section below the canvas, not an overlay.
- Canvas toolbar wraps instead of collapsing labels.
- Evidence: `docs/next-ui/screens/orchestration-inspector.png`.


## Slice 20 — Health and Notifications

- Health agent rows are compact bordered rows; metric/card grid uses the optical
  surface tokens.
- Notifications uses the same card material and row rhythm.
- No data/mutation changes.
- Screenshots refreshed in `docs/next-ui/screens/pages/health.png` and
  `notifications.png`.




## Slice 21 — Workspace compact layout

- At <=1180px the file tree narrows to 200px and the diff pane to 200px, giving
  the read-only Monaco surface the primary width.
- Monaco `wordWrap` is now `on`, so long Markdown/source lines wrap instead of
  being clipped behind a horizontal scrollbar.
- Evidence: `docs/next-ui/screens/pages/workspace-1100.png`.


## Slice 22 — Electron motion walkthrough

- `scripts/next-ui-tour.mjs` drives one real Electron session through:
  Project Center → Task Board → task inspector → Orchestration → node inspector →
  Agent Workbench → Knowledge → Settings.
- Eight real 1440×900 frames assembled into
  `docs/next-ui/screens/projectos-next-ui-tour.gif` (9.6s, 2.4 MB).
- A real desktop-capture MP4 was added in Slice 24; the GIF remains as a
  lightweight preview.


## Slice 23 — Settings keyboard containment

- `DialogShell` now installs a focus guard only for `modal={false}` surfaces.
- Focus is redirected to the first control when it tries to escape the settings
  surface; Ant Select/Dropdown/Popover portals remain allowed.
- Verified with 40 consecutive Tab presses: 0 escapes, focus stayed in the
  Settings surface or its Ant portal.
- `v12-e2e` still passes with Settings connection CRUD/test/restart.


## Slice 24 — Real Electron MP4 walkthrough

- `scripts/next-ui-record.mjs` uses Electron `desktopCapturer` +
  `setDisplayMediaRequestHandler` + MediaRecorder to record the real window.
- The 1440×900 VP9 WebM was converted to H.264:
  `docs/next-ui/screens/projectos-next-ui-walkthrough.mp4` — 11.53s, 4.9 MB.
- The recording covers Project Center, Task Board, task inspector, Orchestration,
  node inspector and Agent Workbench.
- ffmpeg is used only as a temporary conversion tool under `test-results/tools`;
  no runtime or package dependency was added.
