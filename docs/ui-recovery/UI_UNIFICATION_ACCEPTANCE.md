# UI unification acceptance — token layer, shell, three core pages

- Branch: `feat/ui-unification`
- Base: `43451e2eddbd11fd199d59af57b32b6d61f002df`
- Date: 2026-10-29
- Scope: unified semantic tokens, AppShell, StudioProjectHome, CollaborationOverview, StudioReviewRoom.
- Not in scope: business-page composition migration (waits for visual approval).

## Status matrix

| ID | Requirement | Result | Evidence |
|---|---|---|---|
| U01 | Single semantic token source; legacy families become aliases | PASS | `packages/design-tokens/src/unified.css`; `--pdl-*`, `--nx-*`, `--studio-*`, `--pw-*` alias to `--ui-*`; `tokens.css` synced |
| U02 | Light/Dark tokens and Ant Design theme share values | PASS | `lightPalette` / `darkPalette`; design-token tests 20/20 |
| U03 | Shell and core pages have no cold/warm break | PASS | pixel samples: light sidebar/main `(249,243,231)/(251,246,236)`; dark `(19,27,37)/(19,27,36)`; `shell-pixels.json` |
| U04 | Remove blue shell field and blue local action/nav accents | PASS | v16/v17 field replaced; journey action/nav active now copper; screenshots |
| U05 | Project home + Agent graph + Review room use the same system while keeping different compositions | PASS | `three-pages-light.png`, `three-pages-dark.png` |
| U06 | Real Electron, 1440/1024, Light/Dark, 125% | PASS | E2E 30 PASS; screenshots listed below |
| U07 | No regression to real graph/approval/navigation | PASS | same 30-check Electron E2E as P0/P1 |
| U08 | Global business-page migration | **NOT IN SCOPE / PENDING REVIEW** | token-aligned only; layouts still old |
| U09 | Full overlay/modal visual sweep | **PARTIAL** | tokens apply; not every overlay screenshotted |
| U10 | Performance benchmark of glass | **SKIP** | no FPS/memory run this round; no new blur layer added |
| U11 | Full axe audit | **SKIP** | not executed |
| U12 | Permission/expiry negative approval tests | **BLOCKED / SKIP** | same limitation as P0: no role-denial path or short-TTL fixture |

## Commands (actual)

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS, 0 errors, 29 pre-existing warnings; boundaries OK |
| `pnpm vitest run tests/design-tokens.test.ts` | P23? see output: 20 passed |
| `pnpm test` | **495 passed / 0 failed / 4 skipped** |
| `node scripts/agent-overview-e2e.mjs` | **30 PASS / 0 FAIL** |
| `pnpm build` + `package:dir` | PASS |
| `pnpm test:package` | PASS — packaged EXE creates project, writes starter, restart recovery |

## Visual evidence

`docs/ui-recovery/screenshots/`:

- `three-pages-light.png` — home / graph / review side by side
- `three-pages-dark.png` — same in dark
- `shell-before-after.png` — P1 cold-blue shell vs unified shell
- `shell-pixels.json` — measured pixels
- Cross-page shell baseline: `unification-tasks-1440-light.png`, `unification-runs-1440-light.png`, `unification-approval-center-1440-light.png`, `unification-settings-1440-light.png` — shell only; inner business layouts are still old.
- Core page screenshots in `docs/agent-overview/evidence/screenshots/`:
  - `studio-project-home-{1440-light,1440-dark,1024-light,1024-dark,1440-125}.png`
  - `overview-{1440-light,1440-dark,1024-all,1440-light-125}.png`
  - `studio-review-{1440-light,1440-dark,1024-light,1024-dark,1440-125}.png`

## Known failures / limitations

1. Business page compositions are intentionally unchanged; only tokens/shell reach them. Cross-page captures exist for tasks/runs/approval center/project settings, but inner cards still use old local blue status accents. Full business-page visual migration is the next batch.
2. Dense graph metadata includes some 9–11px labels; the main body/action floor is 12px, but every micro-label is not yet raised.
3. Overlay states (modal/drawer/dropdown) are token-aligned but not all visually captured.
4. No performance benchmark or axe run.
5. E2E fixture is a local fake provider, not a real model delivery.

## Review request

Review the three-page light/dark composites and the before/after shell image. If approved, continue with business-page batches, starting with project center/task board/orchestration and then approvals/runs/settings.
