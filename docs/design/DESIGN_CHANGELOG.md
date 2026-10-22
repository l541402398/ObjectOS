# ProjectOS UI Design Changelog

## 2026-10-22 — Design Lab accepted as visual baseline

- User accepted `feature/v1.6-liquid-glass-design-lab` as the Premium Liquid Glass
  visual direction.
- Frozen contract added at `docs/design/PROJECTOS_UI_CONTRACT.md`.
- Approved screenshots copied to `docs/design/baselines/`; post-fix captures are
  also stored there.
- Root `AGENTS.md` references the contract, `DESIGN.md`, this changelog, Design
  Lab and baselines.
- The host DSH harness demonstrably loads root `AGENTS.md`; the UI contract block
  is part of session instructions. The available skills list is injected by the
  runtime.
- Skills actually installed and loaded: `ui-ux-pro-max`,
  `vercel-composition-patterns`, `vercel-react-best-practices`, `impeccable`.
  `impeccable` engine `0.1.16` was installed and run in context/detect mode.
- Mandatory source table added to `AGENTS.md`: UI UX Pro Max, Vercel Agent Skills,
  Impeccable, Sim Studio, Liquid Glass React, React Bits and Motion.

## Five mandatory fixes — implementation log

| Fix | Status | Evidence |
|---|---|---|
| 1. Durability / contract / baselines / AGENTS | Complete | contract, DESIGN.md, baselines, AGENTS, this changelog |
| 2. Stage journey: icons only, exact anchors, tooltip/aria | Complete | `StageJourney.tsx`; E2E max anchor delta 0.01px at 1440, 1100 and 125%; `lab-stage-tooltip.png` |
| 3. Typography and contrast | Complete for measured surfaces | 14px body, 12.5px secondary, 16px section, 26px title; composited contrast pass light/dark, no blur/filter on text surfaces |
| 4. Premium custom DAG edges | Complete | `PremiumDependencyEdge.tsx`; solid neutral default, gradient focus, no dash animation, ELK/React Flow unchanged |
| 5. Inspector view/edit architecture | Complete | `TaskInspector.tsx`; read-first view, explicit edit, all fields preserved, focus trap and Escape |

## Required fix details

### 1. Durability

`AGENTS.md` is the harness-native project instruction entry. It now requires every
new session to read the contract, tokens, changelog, accepted implementation and
baselines before UI work. The DSH system injects that file and reports the loaded
skill catalog; this session verified both after installation.

### 2. Stage journey

- Removed permanent title, subtitle, count and role text around icons.
- Kept icon, route, selected halo, hover/focus tooltip and accessible names.
- Orbs are absolutely positioned from the same 1000×140 anchor coordinate space
  used by the SVG path; E2E measured 0.01px max delta at 1440, 1100 and 125%.
- Stage summary remains in the separate `架构阶段 · 2 项工作` context and ledger.

### 3. Typography / contrast

- Page title 26px, section 16px, body 14px, secondary 12.5px, labels 12px.
- Light composited contrast: task title 12.5:1, secondary 5.96:1, plan meta
  5.34:1, inspector body/label 6.14:1.
- Dark composited contrast: all sampled text ≥4.5:1 (task title 15.42:1,
  secondary 6.26:1, plan meta 6.89:1, inspector body 9.55:1).
- Removed `backdrop-filter` from the review rail and inspector; ledger and
  inspector are opaque text surfaces.
- Impeccable craft-floor was read before editing; its detector returned `[]` on
  the final changed UI files.

### 4. DAG edges

- Custom React Flow edge via `BaseEdge` + `getSmoothStepPath`.
- Default: solid neutral `#93a7c4`, 1.45px, rounded 16px corners, no dash.
- Focus: path gradient `#738df0 → #8e9cf5 → #58c3d2`, 1.9px, static drop shadow.
- No continuous graph-wide animation and no dashed defaults.
- Real `dependsOn` topology and ELK layout retained; split/join branch visible.
- Selection clears when entering the DAG view so the default capture is neutral;
  clicking a node establishes the focused path.

### 5. Inspector

- Read-first view: identity/status, summary, dependencies, acceptance checklist,
  artifacts, capabilities, risk.
- Explicit `编辑` mode: structured controls, all original fields, add/delete
  acceptance, add/remove dependencies/artifacts, capability toggles, approval
  switch, danger zone.
- Header save/cancel; footer repetition removed.
- Focus trap, `inert` workspace, Escape closes edit or the inspector, focus
  restored on close.

## Verification

- `pnpm lint` — PASS
- `pnpm typecheck` — PASS
- `pnpm test` — 265 passed / 3 skipped
- `pnpm build` — PASS
- `pnpm package:dir` / `pnpm test:package` — PASS
- `scripts/design-lab-e2e.mjs` — 24/24 checks PASS
- `scripts/design-lab-contrast.mjs` — light/dark CONTRAST PASS
- `impeccable detect` — `[]` (no findings)
- `scripts/design-lab-perf.mjs` — forced Aurora 8fps, library probe 7fps; default
  optical fallback measured 61–69fps in controlled foreground runs; occluded Electron windows sometimes report 6–7fps and are surfaced as a warning, not used as a pass.

## Remaining limits

- Electron `capturePage()` at 125% crops the right edge; DOM reports
  `clientWidth=880`, `scrollWidth=880`, anchors aligned 0.01px.
- Minimum Electron window width is 1024px; an 880px native window could not be
  created.
- Liquid Glass React filter remains broken/dark and 7fps in this Electron build;
  the reproducible optical fallback is default.
- Visual acceptance is still the user's decision. No other ProjectOS page was
  migrated.



