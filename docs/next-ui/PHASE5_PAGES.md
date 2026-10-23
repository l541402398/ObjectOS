# Phase 5 — Project Workspace Slice

Date: 2026-10-23  
Branch: `feature_dev_ux`  
Base: `9dd12f1` (approved Plan Review workspace)  
Status: **first Phase 5 slice implemented; remaining pages not started**  
Stable branch: untouched  
Approved visual reference: `0686c41` / `APPROVED_design_lab_DAG.jpeg`

## Scope of this slice

Two highest-traffic project pages:

1. **Project Overview** (`/projects/:id`)
2. **Task Board** (`/projects/:id/tasks`)

Both keep their real queries, mutations, filters, drag/drop and overlays.
No Planner, Scheduler, Runtime, Teamwork, IPC or database contract changed.

## What changed

### Project Overview

Files:

```text
apps/desktop/src/renderer/src/pages/ProjectOverviewPage.tsx
apps/desktop/src/renderer/src/styles/overview-workspace.css
```

- Removed the V1.6 photographic mountain hero.
- Added a Design Lab optical workspace header:
  - `PROJECT WORKSPACE` eyebrow with current stage
  - 30px project title, demo badge retained
  - path / Git / updated metadata
  - real actions: open folder, new task, advance stage
- Lifecycle is now an optical 8-stage route with a single connection line,
  completed/current/pending states and a compact gate footer.
- MetricCards are retuned with Design Lab glass materials, typography and
  signal colors while keeping their real click actions.
- Milestones / requirements / agent activity use the same optical surface,
  border, shadow and type scale; real status actions remain.

### Task Board

Files:

```text
apps/desktop/src/renderer/src/pages/TaskBoardPage.tsx
apps/desktop/src/renderer/src/styles/board-workspace.css
```

- Replaced the old PageHeader with an `EXECUTION BOARD` workspace header.
- Real signals shown as running / review / approval indicators.
- Search-agent-priority toolbar restyled to optical glass.
- Five real status columns restyled with distinct signal dots, counts and
  Design Lab surfaces.
- Real `TaskTile` cards restyled without replacing DnD or task actions.
- Drag target, dragging and keyboard focus states retained.
- Task Inspector remains the existing real InspectorShell.

Theme:

- Both pages use `useResolvedTheme()` instead of a hard-coded light theme.
- Light and dark captures both verified.

## Screenshots

| State | File |
|---|---|
| Overview before | [overview-before.png](visual-regression/phase5-pages/overview-before.png) |
| Overview 1440 light | [overview-1440-light.png](visual-regression/phase5-pages/overview-1440-light.png) |
| Overview 1440 dark | [overview-1440-dark.png](visual-regression/phase5-pages/overview-1440-dark.png) |
| Overview 1100 light | [overview-1100-light.png](visual-regression/phase5-pages/overview-1100-light.png) |
| Board before | [board-before.png](visual-regression/phase5-pages/board-before.png) |
| Board 1440 light | [board-1440-light.png](visual-regression/phase5-pages/board-1440-light.png) |
| Board 1440 dark | [board-1440-dark.png](visual-regression/phase5-pages/board-1440-dark.png) |
| Board 1100 light | [board-1100-light.png](visual-regression/phase5-pages/board-1100-light.png) |

## Verification

```text
pnpm lint       PASS (0 errors, 2 existing warnings in old PlanReviewNext)
pnpm typecheck  PASS
pnpm test       PASS — 48 files, 266 passed, 3 skipped
pnpm build      PASS
node scripts/phase5-pages-e2e.mjs
                PASS — 10 checks
```

E2E checks:

- Overview header renders.
- 8 lifecycle stages remain.
- 4 real metric cards remain.
- Real milestones remain.
- Board header and five columns render.
- Real task cards render.
- Search filters real tasks.
- Task Inspector opens.
- No page errors.

## Known issues / next pages

1. **Task Board horizontal density** — at 1100px the five-column board still
   overflows horizontally by design (`min-width: 1040px`). The page itself
   does not clip, but the fifth column requires horizontal scroll.
2. **125% zoom** — not yet recaptured for these two pages.
3. **Remaining routes** — Project Center, Orchestration canvas (except Plan
   Review), Agent Workbench, Collaboration, Workspace, Knowledge, Operations,
   Resources, Approvals, Settings, Health, Runs.
4. **No stable merge** and no automatic continuation to other pages.

## Stop condition

This slice stops for user visual confirmation of Project Overview and Task Board
before migrating the next route group.
