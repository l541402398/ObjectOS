# Phase 5 — Orchestration Workspace Slice

Date: 2026-10-23  
Branch: `feature_dev_ux`  
Status: **orchestration canvas migrated; global Settings modal is the only remaining legacy surface**  
Approved reference: `0686c41` / `APPROVED_design_lab_DAG.jpeg`

## Scope

- **Orchestration Workspace** (`/projects/:id/orchestration`)
- Global Settings modal remains legacy (documented in `PHASE5_PAGES_7.md`)

## What changed

Files:

```text
apps/desktop/src/renderer/src/features/orchestration/pages/OrchestrationWorkspace.tsx
apps/desktop/src/renderer/src/styles/orchestration-workspace.css
```

- New Design Lab optical orchestration header:
  - project identity, current stage, project key, scan time
  - real Agents / Tasks / Active / Blocked metrics
  - real scan, Agent, generate-plan actions
- Progress strip restyled with optical material; real project progress kept.
- Real dependency canvas, filters, node search, save-layout, fit and minimap
  retained.
- Canvas toolbar and card use Design Lab border/material/type.
- Existing real DAG/ELK topology and `dependsOn` remain the source of truth.
- Real plan workflow still opens the approved full-screen Plan Review
  workspace.
- `useResolvedTheme()` drives light/dark.

## Screenshots

| State | File |
|---|---|
| Orchestration before | [orchestration-before.png](visual-regression/phase5-pages/orchestration-before.png) |
| Orchestration 1440 light | [orchestration-1440-light.png](visual-regression/phase5-pages/orchestration-1440-light.png) |
| Orchestration 1440 dark | [orchestration-1440-dark.png](visual-regression/phase5-pages/orchestration-1440-dark.png) |

## Verification

```text
pnpm lint       PASS
pnpm typecheck  PASS
pnpm test       PASS — 48 files, 266 passed, 3 skipped
pnpm build      PASS
node scripts/phase5-pages-e2e.mjs
                PASS — 48 checks
```

New checks:

- Orchestration header renders real project identity.
- Four real metrics remain.
- Real dependency canvas remains.
- All prior thirteen pages remain green.
- No page errors.

## Known limitations

1. Graph node internals still use the existing business graph component; the
   canvas shell, header and toolbar were migrated.
2. Global Settings modal remains legacy due the text-ghosting problem found in
   the optical attempt.
3. 1100px / 125% captures remain outstanding for the final audit.
4. No stable merge.

## Stop condition

This completes the orchestration business page. The only legacy surface still
tracked is the global Settings modal; no further page migration should start
without user confirmation.
