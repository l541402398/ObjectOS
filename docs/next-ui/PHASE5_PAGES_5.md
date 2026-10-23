# Phase 5 — Run Audit & Health Slice

Date: 2026-10-23  
Branch: `feature_dev_ux`  
Status: **fifth Phase 5 slice implemented; remaining routes not started**  
Approved reference: `0686c41` / `APPROVED_design_lab_DAG.jpeg`

## Scope

- **Run Audit** (`/projects/:id/runs`)
- **Project Health** (`/projects/:id/health`)

Both keep real run lists, run detail, approvals, project events, metrics and
agent execution data.

## What changed

### Run Audit

Files:

```text
apps/desktop/src/renderer/src/pages/RunsPage.tsx
apps/desktop/src/renderer/src/styles/runs-workspace.css
```

- New `RUN AUDIT` optical header with real run/active/approval counts.
- Real refresh action retained.
- Pending authorization section retains the real ApprovalCard actions.
- Run/event tabs, filters, table and detail sheet restyled with Design Lab
  surfaces; real status, agent, task, duration and approval data preserved.
- `useResolvedTheme()` drives light/dark.

### Project Health

Files:

```text
apps/desktop/src/renderer/src/pages/ProjectHealthPage.tsx
apps/desktop/src/renderer/src/styles/health-workspace.css
```

- New `PROJECT HEALTH` signal-board header.
- Real "open orchestration" action retained.
- Four real metric cards and Agent execution / critical path panels restyled.
- Empty critical-path state kept as product truth.
- `useResolvedTheme()` drives light/dark.

## Screenshots

| State | File |
|---|---|
| Run Audit before | [runs-before.png](visual-regression/phase5-pages/runs-before.png) |
| Run Audit 1440 light | [runs-1440-light.png](visual-regression/phase5-pages/runs-1440-light.png) |
| Run Audit 1440 dark | [runs-1440-dark.png](visual-regression/phase5-pages/runs-1440-dark.png) |
| Project Health before | [health-before.png](visual-regression/phase5-pages/health-before.png) |
| Project Health 1440 light | [health-1440-light.png](visual-regression/phase5-pages/health-1440-light.png) |
| Project Health 1440 dark | [health-1440-dark.png](visual-regression/phase5-pages/health-1440-dark.png) |

## Verification

```text
pnpm lint       PASS
pnpm typecheck  PASS
pnpm test       PASS — 48 files, 266 passed, 3 skipped
pnpm build      PASS
node scripts/phase5-pages-e2e.mjs
                PASS — 34 checks
```

New checks:

- Run Audit header, real table rows and pending approval card.
- Project Health header, four real metric cards and two panels.
- All prior eight pages remain green.
- No page errors.

## Package

```text
release/win-phase5-pages/ProjectOS-1.7.0-win-x64-portable.exe
commit:   cbf146b
size:     98,512,203 bytes
SHA256:   DB221E4DDBF3F91C81C30C1BA0E2CD756D74527DE5F2EAB4928DFB0737C560DB
```

Unsigned portable build; `pnpm test:package` passed.

## Known limitations

1. Run detail sheet retains the business ToolTrace/approval components; only
   the audit shell and table were migrated.
2. Health's empty critical path is the real product state.
3. 1100px / 125% captures for these pages are not done.
4. Remaining routes: Orchestration canvas, Workspace, Knowledge, Settings.
5. No stable merge.

## Stop condition

This slice stops for user visual confirmation of Run Audit and Project Health
before the final route group.

