# UX polish 4 — type scale & information hierarchy (ADR-0092)

Branch `feature/ux-polish-4` (stacked on `feature/ux-polish-3`, PR #5).

## Checks (vs base `feature/ux-polish-3`)
- `pnpm lint`: 0 errors; warnings 50 → 51 (the extra one is `collapsed` in `docs/v2/evidence/ux-polish-3/tools/capture.mjs`, inherited from the base; the `releaseVersion` warning introduced mid-pass was fixed).
- `pnpm typecheck`, desktop `tsc --noEmit`: pass.
- vitest: 727/732 passing, same as base; the only failure is the pre-existing `tests/workspace.test.ts > rejects traversal and absolute paths`.
- `pnpm build`: pass.

## Screenshots
1440×900 light/dark and 1100×800 light, captured with `PROJECTOS_SEED_DEMO_REVIEW_HISTORY=1 PROJECTOS_SEED_DEMO_RESOURCES=1`. Before/after pairs in `docs/ux/v5/`.
