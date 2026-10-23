# Phase 5 — Project Settings Slice

Date: 2026-10-23  
Branch: `feature_dev_ux`  
Status: **project settings migrated; global settings modal intentionally left legacy for now**  
Approved reference: `0686c41` / `APPROVED_design_lab_DAG.jpeg`

## Scope

- **Project Settings** (`/projects/:id/project-settings`)
- **Global Settings modal** investigated but not migrated in this slice

## What changed

### Project Settings

Files:

```text
apps/desktop/src/renderer/src/pages/ProjectSettingsPage.tsx
apps/desktop/src/renderer/src/styles/project-settings-workspace.css
```

- New `PROJECT SETTINGS` optical header with current stage.
- Real project name/description/status form and save mutation retained.
- Real root path, stage, version, Git status and open-directory action
  retained.
- Inputs/selects restyled with visible optical borders; light and dark both
  verified.
- `useResolvedTheme()` drives light/dark.

### Global Settings modal — not migrated

An initial optical shell was applied and then reverted because it caused
subpixel text ghosting in the Electron modal for nav labels and action
buttons. The legacy settings dialog is therefore kept as-is rather than
shipping a degraded surface.

Evidence of the reverted state:

[global-settings-legacy.png](visual-regression/phase5-pages/global-settings-legacy.png)

The existing real settings sections, AI connection actions and focus behavior
are unchanged.

## Screenshots

| State | File |
|---|---|
| Project Settings before | [project-settings-before.png](visual-regression/phase5-pages/project-settings-before.png) |
| Project Settings 1440 light | [project-settings-1440-light.png](visual-regression/phase5-pages/project-settings-1440-light.png) |
| Project Settings 1440 dark | [project-settings-1440-dark.png](visual-regression/phase5-pages/project-settings-1440-dark.png) |
| Global Settings legacy | [global-settings-legacy.png](visual-regression/phase5-pages/global-settings-legacy.png) |

## Verification

```text
pnpm lint       PASS
pnpm typecheck  PASS
pnpm test       PASS — 48 files, 266 passed, 3 skipped
pnpm build      PASS
node scripts/phase5-pages-e2e.mjs
                PASS — 45 checks
```

New checks:

- Project Settings header, real project-name field and save action.
- Global Settings modal still opens with all real sections.
- Prior twelve pages remain green.
- No page errors.

## Package

```text
release/win-phase5-pages/ProjectOS-1.7.0-win-x64-portable.exe
commit:   01d658c
size:     98,515,285 bytes
SHA256:   7902BC9090F604C8123DD76E52E36EBAE08CF398DA1541F9040135A4AB87A2E2
```

Unsigned portable build; `pnpm test:package` passed.

## Known limitations

1. **Global Settings modal remains legacy.** The optical attempt caused text
   ghosting and was reverted; it needs a different overlay-specific treatment.
2. Final 1100px / 125% captures remain outstanding.
3. Orchestration canvas remains the last unmigrated business page.
4. No stable merge.

## Stop condition

This slice stops for user visual confirmation of Project Settings and for a
decision on how to handle the global Settings modal safely.

