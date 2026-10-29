# ProjectOS UI Design Changelog

## 2026-10-29 — Overlays follow the app theme (task drawer readability)

- 缺陷：任务详情抽屉面板是浅色（`data-theme` 缺失 → 走 light token），而抽屉内容用的是应用级主题 token；
  暗色主题下浅灰字压白底，正文与字段名几乎不可读（用户报告截图）。
- 修复（ADR-0044）：`next-ui/overlay` 的 Dialog / Sheet / Inspector 三种外壳在调用方未显式指定时，
  默认使用 `useResolvedTheme()`，抽屉与弹窗跟随应用明暗主题；材质、token 与动效未变，只纠正主题归属。
- 真实 Electron 证据（真实项目 6 个任务，真实点击任务卡）：
  - 亮色：`data-theme=light`，背景 `rgb(251,253,255)`，标题 12.89:1 · 眉标/元信息 5.05:1 · 正文 16.04:1；
  - 暗色：`data-theme=dark`，背景 `rgb(17,27,48)`，标题 15.58:1 · 眉标/元信息 6.33:1 · 正文 16.02:1；
  - `scripts/p288-drawer-contrast-e2e.mjs` → `PASS=6 FAIL=0`，截图 `docs/screenshots/p288-drawer-{light,dark}.png`。
- 未验证项：仅采样面板标题、眉标、元信息、正文 4 类节点；表格单元格与按钮悬浮态未逐一采样。

## 2026-10-29 — Pane-owned scrolling and readable activity copy (Phase 2.8.8)

- 「审批」工作台与「交付 · 资源与连接」改为**栏内滚动**：页面根 `height:100%`、主区域
  `flex:1 / min-height:0`、每个栏 `min-height:0` + `overflow-y:auto` + `overscroll-behavior:contain`。
  长列表不再产生整页滚动条，620px 高窗口同样成立。纯布局改动，未改 token、材质、动效或业务状态；
  普通页面仍由 `.po-main` 滚动。ADR-0037。
- 真实 Electron 证据（56 条真实审批 / 12 条真实资源，1440×900、1100×700、1024×700、620h）：
  `mainScrolls=0` 全部成立，列表 `4105/585|260|260|385`、`648/504|306|306|304`，
  滚轮在栏内生效且页面不动；截图 `docs/screenshots/p288-scroll-*.png`。
- 「项目中心 · 最近动态」把死文字「全部」改为真实按钮：`aria-expanded` 切换「全部/收起」，
  展开后列表在卡片内 320px 内滚动（`docScrolls=0`），少于 6 条时显示「N 条」而非假控件；
  bootstrap 每个项目取 20 条、总量 40 条，控件有真实内容。字号遵守 12px 下限。ADR-0038。
- 动态与运行审计事件流不再显示 `run.status.changed` 等原始类型：`summarizeProjectEvent` 覆盖全部
  已知事件并翻译内部枚举（`quality_gate` → 质量门禁未通过；`project.event` 按 kind 映射），
  事件流徽标改为中文分类、原始类型只保留在 `title` tooltip。
- 1100 宽与真实 125% 缩放（`webContents.setZoomFactor`）下：`overflowX=0`，「全部」可点，字号 12px；
  截图 `docs/screenshots/p288-activity-1100x700.png`、`p288-activity-1440x900125.png`。
- 未验证项：资源与连接的长度验收使用产品 API 在隔离测试档案中创建的 12 条真实资源记录（非用户数据）；
  真实用户项目若资源更多，结论同样成立（同一 CSS 规则），但未在用户库上复测。

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
