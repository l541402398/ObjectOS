# ADR-0066 — Design Lab material, batch 4: 版本与迭代、发布、部署、资源、设置

- Status: Accepted (Phase 2.9-P0, batch 4 — completes the page-level migration)
- Related: ADR-0054 (shell), ADR-0061 (batch 2), ADR-0063 (batch 3), ADR-0058 (12px floor)

## Context

Batches 1–3 covered the shell, work center/task board and approvals/runs. The remaining business
surfaces — 版本与迭代, 发布工作台, 部署控制台, 资源与连接, and the global Settings overlay — still used the
old flat card style, so the product still read as two design systems.

## Decision

Extend `pages-design-lab.css` with the same optical recipe for:

- lifecycle metrics/version cards (`.lc-*`), release columns and rows (`.rel-*`), the release workbench and
  deployment console shells (`.rw-*`, `.dc-*`), the resource center (`.rc-*`), and the Settings dialog
  (`.po-settings-dialog` plus the antd modal surface).
- antd v6 controls inside these surfaces: default/outlined buttons and `ant-select` roots/selectors get the
  dark optical tokens. Without this, the release header kept a white control on the dark canvas (verified
  with a computed-style probe: select root `rgb(255,255,255)` → now the pdl surface with light ink).

Only materials change; layout, hierarchy and behaviour are untouched, and every page keeps its real data.

## Verification

- `scripts/p29-visual-sweep.mjs` now covers 13 pages (`versions`, `releases`, `deployments`, `connections`,
  `resources` added) plus the Settings modal at both sizes:
  **light 28/28 PASS, dark 29/29 PASS** (dark also asserts `--pdl-ink=#eff4ff`).
- Every check measures real computed styles: a real page heading, no “页面不存在”, no horizontal overflow,
  the journey bar present, **zero content text below 12px**; the Settings check opens the product's own
  modal (Ctrl+,) and asserts it rendered.
- Screenshots (real Electron, 1440/1024, light + dark) for every page incl.
  `p29-sweep-releases-*-dark.png`, `p29-sweep-deployments-*`, `p29-sweep-resources-*`,
  `p29-sweep-settings-*`.
- `pnpm test`: **461 passed / 4 skipped / 0 failed** at this commit.

## Consequences

- The page-level design migration is complete; the Design Lab remains the single visual source of truth.
- Future UI work can rely on one stylesheet layering (tokens → shell → pages) instead of per-page one-offs.
