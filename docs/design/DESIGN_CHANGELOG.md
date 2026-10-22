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




## 2026-10-22 — Overlay system, audit and three samples

- Added `docs/design/OVERLAY_AUDIT.md`: 27 renderer surfaces audited by path, purpose,
  library, nesting, clipping/scroll, typography and migration status.
- Added `docs/design/OVERLAY_SYSTEM.md` and the shared primitives under
  `apps/desktop/src/renderer/src/next-ui/overlay/`:
  `OverlayRoot`, `InspectorShell`, `DialogShell`, `SheetShell`, `PopoverShell`,
  `OverlayHeader`, `OverlayFooter`, `OverlayScrollArea`, `InspectorSection`.
- `OverlayRoot` wraps the router in `main.tsx`; z-index base is 6000 with a
  registered layer per surface.
- Task Inspector refactored onto `InspectorShell`; it is still the same accepted
  inspector, not a second implementation.
- Added Agent config sample (`AgentInspector`) and approval/delete-style
  confirmation sample (`ApprovalDialog`).
- Unsaved changes close guard, focus restore, Escape, single backdrop and
  220ms close presence verified in Electron.
- Agent sample calls the real `agentDefinitions.list()` read path when opened and
  falls back to the local sample. Saving remains local-only and is labelled.
- Approval sample is local-only; formal plan approval is not called.
- E2E extended to 31/31 checks. Formal pages are not migrated yet.


- Fixed Electron/Chromium ghosting under the non-modal Inspector: while an overlay is
  open the Lab drops only the workspace `backdrop-filter` (`.pdl-root.is-overlay-open`)
  and keeps the inspector surface opaque. Verified with 1200ms Electron captures.



## 2026-10-22 — Round 8/9 workspace, grid and information surfaces

- Consulted the loaded `ui-ux-pro-max`, `impeccable`,
  `vercel-composition-patterns` and `vercel-react-best-practices` guidance for
  responsive layout, focus/keyboard behavior, composition and render cost. The
  frozen Premium Liquid Glass tokens and accepted Design Lab direction still win.
- Orchestration now uses a real CSS Grid: canvas + 390px node inspector at
  desktop, single column below 1280px. No backdrop, no fixed inspector.
- Agent Workbench defaults the run inspector open at >=1280px and reserves a
  384px column so chat/composer are never covered.
- Approvals, Operations, Health and Notifications use content-driven card heights
  and compact bordered rows instead of equal-height empty dashboard boxes.
- Workspace narrows the tree/diff panes at <=1180px and enables Monaco word wrap,
  removing the clipped-line state at 1100px.
- Full 15-page matrix: 60 Electron captures at 1440 light/dark, 1100 and 125%;
  0 horizontal document overflows, 0 page errors.
- Motion walkthrough: 8 real frames in
  `docs/next-ui/screens/projectos-next-ui-tour.gif`; raw MP4 still open.

## 2026-10-22 — Stage journey follows contract fix 2

- Stage route displays only the four designed icons (Layers/Code/Eye/Flask) on
  the shared curve; stage names, descriptions and repeated task counts moved to
  the selected-stage summary.
- Each icon keeps an aria-label and native hover/focus tooltip.
- Stops are centered in equal grid cells and route anchors use the same centers,
  fixing the left/bottom drift in the earlier implementation.
- Plan review screenshot: `docs/next-ui/screens/plan-workbench.png`.
