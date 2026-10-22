# ProjectOS Next UI — Migration Progress

Last updated: 2026-10-22  
Branch: `feature/projectos-next-ui-full-migration`  
Base: `fa75923` (accepted Design Lab + overlay system)  
Latest checkpoint: baseline commit (see `git log`)

This file is the recovery entry point. If a session is compacted or a new Agent
starts, read this file, `BASELINE_AND_RECOVERY.md`, `OPEN_ISSUES.md`,
`docs/design/PROJECTOS_DESIGN_SYSTEM.md` and the current Design Lab before
editing UI.

## Current stage

**Phase 1 — baseline protection.** No page replacement is allowed until the
functional baseline job and the first clean checkpoint are confirmed.

Baseline checks completed:

- [x] isolated worktree + branch
- [x] source worktrees identified and untouched
- [x] dependency install in isolated worktree
- [x] lint / typecheck / unit / build
- [x] Design Lab 31/31
- [x] package smoke + e2e/agent/v13/teamwork baseline
- [x] v12 baseline executed; pre-existing settings failure recorded
- [ ] baseline checkpoint commit

## Page migration matrix

Status legend: `not-started`, `in-progress`, `migrated`, `blocked`, `not-applicable`.

| # | Surface / route | Source | Real business path | Overlay surfaces | Status |
|---:|---|---|---|---|---|
| 1 | App shell / navigation | `components/AppLayout.tsx` | bootstrap, runtime status, project select, command palette | settings, command palette | not-started |
| 2 | Project Center `/` | `pages/ProjectCenterPage.tsx` | `projects.list`, create/import/delete | create/import modal | not-started |
| 3 | Notifications `/notifications` | `pages/NotificationsPage.tsx` | notifications queries | none / row actions | not-started |
| 4 | Project Overview `/projects/:id` | `pages/ProjectOverviewPage.tsx` | overview, lifecycle mutations | create item, advance stage | not-started |
| 5 | Task Board `/projects/:id/tasks` | `pages/TaskBoardPage.tsx` | board, task CRUD, acceptance | create/edit/acceptance modal, detail drawer | not-started |
| 6 | Orchestration / plan review `/orchestration` | `features/orchestration/pages/OrchestrationWorkspace.tsx`, `PlanReviewNext.tsx` | plan generate/validate/approve/reject, real DAG | plan modal, worktree diff, Radix task sheet | not-started |
| 7 | Agent Workbench `/agents` | `pages/AgentWorkbenchPage.tsx` | sessions, approvals, agent execution | new session modal, group drawer | not-started |
| 8 | Teamwork / Collaboration `/collaboration` | `pages/CollaborationPage.tsx` | inbox, handoff, cross-session messages | send message modal | not-started |
| 9 | Workspace `/workspace` | `pages/WorkspacePage.tsx` | files, editor, preview, git | file/preview panels | not-started |
| 10 | Knowledge `/knowledge` | `pages/KnowledgePage.tsx` | knowledge search/entries | detail/actions | not-started |
| 11 | Operations `/operations` | `pages/OperationsPage.tsx` | operations snapshot, repair proposals | proposal detail | not-started |
| 12 | Resources `/resources` | `pages/ResourcesPage.tsx` | resource inventory | row actions | not-started |
| 13 | Approvals `/approvals` | `pages/ApprovalsPage.tsx` | approval decisions | approval detail | not-started |
| 14 | Project Settings `/project-settings` | `pages/ProjectSettingsPage.tsx` | project config, policy | forms | not-started |
| 15 | Project Health `/health` | `pages/ProjectHealthPage.tsx` | health checks, repair | repair dialogs | not-started |
| 16 | Runs `/runs` | `pages/RunsPage.tsx` | run list/detail, reconcile | run detail modal, reconcile modal | not-started |
| 17 | Settings (global modal) | `features/settings/SettingsModal.tsx` + panels | AI connections, models, runtime, skills, tools | nested modals/drawers | not-started |
| 18 | Design Lab `#/design-lab` | `features/design-lab/` | prototype | Inspector, Agent, Approval | migrated baseline |

## Overlay migration inventory

The full 27-surface audit is in `docs/design/OVERLAY_AUDIT.md`. This checklist
tracks actual migration:

- [x] `OverlayRoot` / `DialogShell` / `SheetShell` / `InspectorShell` / `PopoverShell`
- [x] Task Inspector sample on `InspectorShell`
- [x] Agent config sample on `InspectorShell` + `PopoverShell`
- [x] Approval sample on `DialogShell`
- [x] dirty-close guard, focus/Escape, light/dark, reduced-motion
- [ ] formal `PlanReviewNext` task sheet
- [ ] settings detail drawers (Model/Skill/Runtime)
- [ ] settings nested editors (model/Runtime/ACP)
- [ ] Task Board detail drawer and 3 modals
- [ ] Runs detail/reconcile
- [ ] Agent Studio + run-test modal
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

