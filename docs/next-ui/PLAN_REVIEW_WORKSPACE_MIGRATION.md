# Formal Plan Review 鈫?Approved Design Lab Workspace

Date: 2026-10-23  
Status: **Phase 0鈥? implemented in an isolated integration worktree; Phase 5 not started**  
Approved baseline: `0686c41` / `visual-baseline-approved-0686c41`  
Integration branch: `feature/plan-review-design-lab-integration`  
Integration worktree: `C:\Users\Administrator\Desktop\workplace\ProjectOS-plan-review-integration`  
Integration HEAD: `9090465`  
Final package commit: `9090465`  
Stable branch: untouched  
Main migration branch: untouched

## 1. Approved source preserved

The approved Design Lab is read-only reference:

```text
C:\Users\Administrator\Desktop\workplace\ProjectOS-visual-baseline-0686c41
commit 0686c41
tag    visual-baseline-approved-0686c41
```

No development was performed in that worktree.

The integration branch restored the exact approved Design Lab files from `0686c41`
before building the formal workspace:

```text
features/design-lab/DesignLabPage.tsx
features/design-lab/StageJourney.tsx
features/design-lab/TaskGraph.tsx
features/design-lab/TaskInspector.tsx
features/design-lab/design-lab.css
features/design-lab/data.ts
features/design-lab/OpticalGlass.tsx
```

## 2. New integration branch

```text
branch:   feature/plan-review-design-lab-integration
worktree: C:\Users\Administrator\Desktop\workplace\ProjectOS-plan-review-integration
base:     acfd86f (protected investigation state)
HEAD:     fefe062
```

Existing work is preserved in:

```text
backup/next-ui-before-restore-20261022 @ ef7bfee
backup/formal-plan-review-20261023 @ 85f2ae5
```

No reset, clean, force push, automatic merge or deletion was used.

## 3. Formal route change

Before:

```text
OrchestrationWorkspace
  鈫?DialogShell
      鈫?PlanReviewNext
```

After, for a draft plan:

```text
OrchestrationWorkspace
  鈫?PlanReviewWorkspace
      鈫?LabStageJourney          (approved component)
      鈫?LabTaskGraph             (approved component)
      鈫?TaskInspector            (approved component)
      鈫?design-lab.css           (approved materials, type, motion)
```

The generation dialog (`plan-workbench-dialog`) remains the entry point.
Once generation succeeds, the dialog closes and the full-screen workspace opens.

The old `PlanReviewNext` remains in the codebase for approved/non-draft plan
states and as a rollback path, but it is no longer the draft-review shell.

## 4. Components and files

New:

```text
apps/desktop/src/renderer/src/features/orchestration/components/PlanReviewWorkspace.tsx
scripts/plan-review-workspace-e2e.mjs
scripts/plan-review-workspace-shots.mjs
```

Changed:

```text
apps/desktop/src/renderer/src/features/orchestration/pages/OrchestrationWorkspace.tsx
apps/desktop/src/renderer/src/styles/next-ui-app.css
apps/desktop/src/renderer/src/features/design-lab/TaskInspector.tsx   (optional real delete callback)
```

## 5. Real business data mapping

`PlanReviewWorkspace` does not use `features/design-lab/data.ts` demo data.
It adapts real `PlanDraft`:

| Design Lab visual | Real business field |
|---|---|
| task id/code | `PlannedTask.key` + real index |
| title/description | `PlannedTask.title/description` |
| stage | derived by `mergeStagesByRole(computeStages(tasks))` |
| role | `roleLabels[task.role]` |
| agent chip | `agentOptions` + `task.agentId` |
| dependencies | real `task.dependsOn` |
| acceptance criteria | real `acceptanceCriteria` |
| expected artifacts | real `expectedArtifacts` |
| capability needs | real `requiredCapabilities` |
| risk | real `assignmentBlocked` + `assignmentReasons` |
| approval requirement | real `requiresApproval` |
| readiness | real dependency issues / assignment blockers |
| approve / reject | existing `window.projectos.plans.approve/reject` |

Editing in the approved Inspector is wired back to the existing draft update
handler (title, description, role, agent, dependencies, criteria, artifacts,
capabilities, approval toggle), and deletion uses the existing
`removeDraftTask`.

No Planner / Scheduler / Runtime / Teamwork / database contract was changed.
No mock approval logic was copied into the formal route.

## 6. Visual evidence

All screenshots are from a real Electron run of the packaged build.

| State | File |
|---|---|
| 1440 light, stage route | [1440-light-route-final.png](visual-regression/plan-workspace/1440-light-route-final.png) |
| 1440 light, DAG | [1440-light-dag.png](visual-regression/plan-workspace/1440-light-dag.png) |
| 1440 light, DAG focus | [1440-light-dag-focus-final.png](visual-regression/plan-workspace/1440-light-dag-focus-final.png) |
| 1440 light, Inspector | [1440-light-inspector.png](visual-regression/plan-workspace/1440-light-inspector.png) |
| 1440 dark, stage route | [1440-dark-route-final.png](visual-regression/plan-workspace/1440-dark-route-final.png) |
| 1100 light (responsive) | [1100-light-route-final.png](visual-regression/plan-workspace/1100-light-route-final.png) |
| 125% zoom (known clipping) | [125-light-route-final.png](visual-regression/plan-workspace/125-light-route-final.png) |
| packaged EXE | [packaged-1440-route.png](visual-regression/plan-workspace/packaged-1440-route.png) |
| screen recording | [plan-workspace-tour.mp4](visual-regression/plan-workspace/plan-workspace-tour.mp4) |

## 7. Engineering verification

Run in the integration worktree:

```text
pnpm lint       PASS (0 errors, 2 existing warnings in old PlanReviewNext)
pnpm typecheck  PASS
pnpm test       PASS 鈥?48 files, 266 passed, 3 skipped
pnpm build      PASS
```

New real Electron E2E:

```text
node scripts/plan-review-workspace-e2e.mjs
PASS 脳10
```

It verifies:

- full-screen workspace replaces the draft dialog
- approved metrics and stage route
- real task rows and stage grouping
- approved Inspector opens
- Inspector title edit reaches the real draft
- approved DAG and edges render
- real approve closes the workspace

Packaged smoke:

```text
PACKAGE SMOKE PASS
```

## 8. Package

```text
release/win-plan-workspace/ProjectOS-1.7.0-win-x64-portable.exe
size:   98,506,650 bytes
SHA256: 3C6AB6C37C1F8FFF0C885B17B351F082260692760586452FF7799B84E1A7EA9D
```

Unsigned (`NotSigned`), portable target only.

## 9. Known issues / not yet accepted

1. **125% zoom**: the responsive rule hides the right readiness column, but the
   fourth stage still clips at the right edge in the captured Electron zoom.
   The 100% and 1100px layouts are usable; 125% needs another responsive pass
   before visual acceptance.
2. **Nine-task density**: ELK layout is dynamic and real dependencies drive it,
   but the largest local-rules draft generated in this environment is four
   tasks. A real nine-task/eight-level draft has not yet been visually captured
   in the migrated workspace.
3. **Post-approval authorization UI**: approval still hands off to the existing
   grant/authorization flow. That flow is intentionally outside this Phase 0鈥?
   page migration and was not restyled here.
4. **Inspector extras**: the approved Inspector's agent menu and dependency
   picker are wired to real fields; the demo-only delete button now requires a
   real delete callback, which the formal workspace supplies. Design Lab keeps
   its demo callback.
5. **Top bar**: the workspace hides the normal app titlebar/sidebar while open,
   and restores them on close. The approved Design Lab "DESIGN LAB" label is
   intentionally not copied; the formal page is labelled `PROJECTOS PLAN REVIEW`.

## 10. Stop condition

This round stops after the formal plan review workspace migration.

- Phase 5 (other business pages) not started.
- No stable merge.
- No automatic merge into the main migration branch.
- User visual/functional confirmation is required before continuing.


