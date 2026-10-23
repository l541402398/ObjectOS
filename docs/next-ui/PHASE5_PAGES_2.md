# Phase 5 — Portfolio & Approval Slice

Date: 2026-10-23  
Branch: `feature_dev_ux`  
Status: **second Phase 5 slice implemented; remaining routes not started**  
Approved reference: `0686c41` / `APPROVED_design_lab_DAG.jpeg`

## Scope

- **Project Center** (`/`)
- **Approvals** (`/projects/:id/approvals`)

Both keep real bootstrap/project/approval data and mutations.

## What changed

### Project Center

Files:

```text
apps/desktop/src/renderer/src/pages/ProjectCenterPage.tsx
apps/desktop/src/renderer/src/styles/center-workspace.css
```

- New `PROJECT PORTFOLIO` optical workspace header.
- Real actions retained: load sample, import, create project.
- Resume-work hero restyled; real lifecycle progress and "open workspace"
  action retained.
- Portfolio stats use Design Lab glass surfaces and type scale.
- Recent project cards keep the real project data and open route; card
  material and border match the approved language.
- Quick actions retained.
- Uses `useResolvedTheme()` for light/dark.

### Approvals

Files:

```text
apps/desktop/src/renderer/src/pages/ApprovalsPage.tsx
apps/desktop/src/renderer/src/styles/approvals-workspace.css
```

- New `APPROVAL QUEUE` header with real pending count.
- Filter tabs retain pending/all behavior.
- Approval cards restyled: identity, agent, task, detail block, status and
  real approve/reject actions.
- Empty state retained.
- Uses `useResolvedTheme()` for light/dark.

## Screenshots

| State | File |
|---|---|
| Project Center before | [center-before.png](visual-regression/phase5-pages/center-before.png) |
| Project Center 1440 light | [center-1440-light.png](visual-regression/phase5-pages/center-1440-light.png) |
| Project Center 1440 dark | [center-1440-dark.png](visual-regression/phase5-pages/center-1440-dark.png) |
| Approvals before | [approvals-before.png](visual-regression/phase5-pages/approvals-before.png) |
| Approvals 1440 light | [approvals-1440-light.png](visual-regression/phase5-pages/approvals-1440-light.png) |
| Approvals 1440 dark | [approvals-1440-dark.png](visual-regression/phase5-pages/approvals-1440-dark.png) |

## Verification

```text
pnpm lint       PASS (0 errors; one pre-existing PlanReviewNext warning)
pnpm typecheck  PASS
pnpm test       PASS — 48 files, 266 passed, 3 skipped
pnpm build      PASS
node scripts/phase5-pages-e2e.mjs
                PASS — 16 checks
```

E2E additions verify:

- Project Center header, project cards and four portfolio stats.
- Approvals header, real approval card and filter switching.
- Overview/board checks from the first Phase 5 slice remain green.
- No page errors.

## Package

```text
release/win-phase5-pages/ProjectOS-1.7.0-win-x64-portable.exe
commit:   ff8be37
size:     98,511,257 bytes
SHA256:   F2E5470FF0145CF341378C56FD9CD3AB4CFD90B56CFD4AA9238FE0DD1ABBA48A
```

Unsigned portable build; `pnpm test:package` passed.

## Known limitations

1. The app-shell mountain background remains behind Project Center; only the
   page content surfaces were migrated in this slice.
2. 1100px and 125% screenshots for Center/Approvals were not captured yet.
3. Remaining Phase 5 routes: Orchestration canvas, Agent Workbench,
   Collaboration, Workspace, Knowledge, Operations, Resources, Settings,
   Health, Runs.
4. No stable merge, no automatic migration of further pages.

## Stop condition

This slice stops for user visual confirmation of Project Center and Approvals
before the next route group.

