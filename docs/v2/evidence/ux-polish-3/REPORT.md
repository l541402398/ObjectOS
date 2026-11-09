# UX polish 3 — evidence (ADR-0091)

Branch `feature/ux-polish-3`, stacked on `feature/ux-consolidation` (PR #4).

Screenshots (1440×900, light + dark): `docs/ux/v4/` — `before-*` from the base branch, the rest after.
Populated states use the opt-in seeds:

    PROJECTOS_SEED_DEMO_REVIEW_HISTORY=1 PROJECTOS_SEED_DEMO_RESOURCES=1 \
      xvfb-run -a node tools/capture.mjs <repo> after tools/routes-seeded.json

Empty states (`02-connections-empty`, `03a-approvals-history-default-demo`) use the default demo.

## Checks
- `pnpm lint`, `pnpm typecheck`, desktop `tsc --noEmit`, `pnpm build`: pass.
- `vitest run`: 727/732 passed (+2 new seed tests). Only failure: `tests/workspace.test.ts › rejects traversal
  and absolute paths`, identical on the base branch. No new failures.
