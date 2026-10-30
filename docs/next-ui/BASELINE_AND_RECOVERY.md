# ProjectOS Next UI — Baseline and Recovery

Current recovery entry (2026-10-30): work continues in `ProjectOS-v2-phase2.4`, branch
`codex/premium-system`, based on `7746a49b53875ce33107f99623da0409dc1137f5`. Read
[`system-premium/REPORT.md`](../design/system-premium/REPORT.md), its command logs, screenshot manifest
and review commit record before further UI edits. The frozen visual authority remains the approved
DAG (`0686c41` and the user-confirmed PNG); older worktree paths/checklists below are historical.

Date: 2026-10-22  
Migration branch: `feature/projectos-next-ui-full-migration`  
Isolated worktree: `C:\Users\Administrator\Desktop\workplace\ProjectOS-next-ui-full-migration`

## 1. Repository state before migration

| Worktree | Branch | HEAD | Role |
|---|---|---|---|
| `C:\Users\Administrator\Desktop\workplace\ProjectOS` | `feature/v1.6-ux` | `98cd5a3` | **other active worktree — do not touch** |
| `C:\Users\Administrator\Desktop\workplace\ProjectOS-commercial-ui` | `feature/v1.6-liquid-glass-design-lab` | `fa75923` (historically; overlay branch) | source worktree, left intact |
| `C:\Users\Administrator\Desktop\workplace\ProjectOS-next-ui-full-migration` | `feature/projectos-next-ui-full-migration` | `fa75923` | **isolated migration worktree** |

The new worktree was created from the accepted Design Lab + overlay-system
commit, not from the unrelated `feature/v1.6-ux` worktree. No reset, clean,
force checkout or forced push was used.

Git attachments:

```text
C:/.../ProjectOS                    98cd5a3 [feature/v1.6-ux]
C:/.../ProjectOS-commercial-ui      fa75923 [feature/v1.6-liquid-glass-design-lab]
C:/.../ProjectOS-next-ui-full-migration  fa75923 [feature/projectos-next-ui-full-migration]
```

The source worktree's uncommitted files were not relevant to this baseline; the
new worktree starts from the committed Design Lab/overlay state. No untracked
asset from the legacy worktree was copied implicitly.

## 2. Baseline checks

Executed in the new worktree after `pnpm install --frozen-lockfile
--prefer-offline`:

| Check | Result |
|---|---|
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | 265 passed / 3 skipped (48 files passed, 1 skipped) |
| `pnpm build` | PASS |
| `scripts/design-lab-e2e.mjs` | 31/31 checks PASS |

The worktree initially had no `node_modules`; the isolated install was required.
Electron's postinstall binary was absent, so `node_modules/electron/dist` is a
junction to the existing verified Electron 43.8.2 binary. This is a local
development convenience and is **not** committed.

Functional baseline scripts (`package:dir`, package smoke, `e2e.mjs`,
`agent-e2e.mjs`, `v12-e2e.mjs`, `v13-e2e.mjs`, `v18-teamwork-e2e.mjs`) are run
in a background job; their actual exits are recorded in
`baseline-functional.log` and summarized in `MIGRATION_PROGRESS.md`. Do not mark
them passed until the job log has been inspected.

## 3. Functional surface inventory

The app has 15 routed pages (see `apps/desktop/src/renderer/src/router.tsx`):

- Project Center (`/`)
- Notifications
- Project Overview (`/projects/:id`)
- Task Board (`/projects/:id/tasks`)
- Orchestration / plan review
- Agent Workbench
- Collaboration / Teamwork
- Workspace
- Knowledge
- Operations
- Resources
- Approvals
- Project Settings
- Project Health
- Runs
- Settings (global modal, not a route)
- Design Lab (outside AppLayout)

Business capability matrix and migration status is maintained in
`docs/next-ui/MIGRATION_PROGRESS.md`. A page is not marked migrated until its real
data path, empty/error states and its overlays are exercised.

## 4. Recovery procedure

Stop the migration and restore the source worktree without touching unrelated
work:

```powershell
# Inspect before any action
git -C C:\Users\Administrator\Desktop\workplace\ProjectOS-next-ui-full-migration status --short
git worktree list

# Return to the last verified migration checkpoint
git -C ... merge --abort            # only if a merge is in progress
git -C ... reset --hard <last-checkpoint>  # ONLY on the migration worktree, after review

# Remove the isolated worktree only after its commits are pushed or intentionally discarded
git -C C:\Users\Administrator\Desktop\workplace\ProjectOS-commercial-ui worktree remove `
  C:\Users\Administrator\Desktop\workplace\ProjectOS-next-ui-full-migration
```

Do **not** run those destructive commands on `ProjectOS` (`feature/v1.6-ux`) or
the source Design Lab worktree. Never run `git clean -fd` in a directory with
uncommitted work.

Recovery points are Git commits on the migration branch. Each migration checkpoint
must have a clear commit message and a clean `git status`. If a checkpoint is
invalid, use `git revert <commit>` (preferred) or reset only this worktree after
saving a copy of any local changes.

## 5. Data and Electron isolation

- Every UI/E2E run uses a temporary `PROJECTOS_DATA_DIR` and temporary
  `--user-data-dir`.
- Do not point tests at the user's real ProjectOS SQLite database.
- Do not delete or migrate user data as part of a visual refactor.
- Do not copy API keys, tokens or credentials into backups/docs/screenshots.
- The runtime's single-writer rule remains in force; UI code must call the
  existing preload API only.
- The package smoke test uses its own temp project and is allowed to create
  starter files only under that temp data directory.

## 6. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Other AI worktree (`feature/v1.6-ux`) changes | P0 | never modify it; use isolated branch/worktree |
| Database contamination | P0 | temp data dirs for all Electron tests |
| Losing uncommitted source work | P0 | source worktree untouched; migration commits only |
| UI refactor changing business semantics | P0 | keep preload/IPC/backend; test real flows |
| Ant + Radix nested overlays | P1 | shared OverlayRoot; migrate in dependency order |
| Liquid Glass / Aurora performance | P1 | static optical fallback; measured opt-in |
| Font/contrast regressions | P1 | actual Electron screenshots + contrast script |
| Context loss | P1 | `MIGRATION_PROGRESS.md`, `OPEN_ISSUES.md`, AGENTS references |
| Package-only failures | P2 | package smoke after build checkpoints |

## 7. Baseline definition of done

The baseline is considered protected when:

1. this document and the migration progress file are committed;
2. the source worktree's Head and status are recorded;
3. the isolated branch builds and unit/E2E baseline results are known;
4. no user data or secrets are in the worktree;
5. a clean Git checkpoint exists before the first page replacement.

No page migration starts before this checkpoint.
