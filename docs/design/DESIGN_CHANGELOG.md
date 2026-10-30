# ProjectOS UI Design Changelog

## 2026-10-29 — A2.2a device consent; system direction reaffirmed

- Added actual device/heartbeat/state and native-confirmed local project consent inside Settings.
  Compact account context; semantic device rows, inline forms, conservative defaults, visible
  offline revoke and real recovery. No prototype job data or enabled-execution claim.
- Actual axe fixed duplicate banner and insufficient badge contrast; live reduced-motion preference
  now follows both system and app settings after inspecting installed Motion's initial-value latch.
- 563 tests PASS / 4 external SKIP; 77 real PG/Electron checks; all required desktop/package checks
  PASS. 43 final native captures plus 5 baseline comparisons and 1 labelled diagnostic. Ten axe
  states have 0 violations / 2 manual-review contrast items. OS-native button pixels/input, screen
  reader and FPS remain unverified. See `docs/org-upgrade/reports/A2.2a-report.md` and UI source log.
- User explicitly reaffirmed the supplied approved DAG aesthetic for all product routes and asked
  the left menus to match real functions. Preserved the new supplied image as
  `baselines/2026-10-29-user-confirmed-DAG.png` (SHA256
  `9461548a137c95c44b2f07b76382a8da4e76a671d0df8c0585b7fe2d7419c9af`). ADR-0070 records the
  authorized rollout and five Lab prerequisites. No claim that the global rollout is done here.

## 2026-10-29 — A2.1 organization asset catalog

- Extended A1's actual Settings tab with searchable Agent/Skill/MCP/Tool rows, inline drafts,
  immutable publication confirmation, version differences, deprecation/revocation and explicit
  project pins. No new page, nested modal, palette, shader or graph composition.
- Kept the approved semantic tokens, common organization controls, shared Settings scroll/focus
  system and bounded/reduced Motion. MCP labels separate registered definition from verified use.
- Project reads now distinguish loading/failure from missing permission, with an explicit retry;
  a one-shot 503 fixture exercises recovery. Read-only controls and forged IPC denial are verified.
- Sources, skill-tool limitation and UI UX search decisions: `docs/org-upgrade/design/A2_ASSET_UI.md`.
  Real command results, screenshots and remaining A2.2 boundaries: `docs/org-upgrade/reports/A2.1-report.md`.
  The protected Lab's five-fix inconsistency remains separate; no claim that those fixes were completed.
- Actual results: 551 tests PASS / 4 external cases SKIP, lint 0 errors / 29 existing warnings,
  typecheck/build/package smoke and all four required E2Es PASS; organization asset journey 77/77.
  Source detector `[]`; rendered CDP detector SKIP. Body text measured 12.89:1 on the actual opaque
  light Settings surface; this is not an all-label or full WCAG acceptance claim.

## 2026-10-29 — A1 organization settings and approved palette correction

- User explicitly selected the approved Premium Liquid Glass direction. Semantic palette values in
  `packages/design-tokens/src/{index.ts,tokens.css,unified.css}` now follow the blue-violet/cyan
  optical baseline; legacy aliases and page structures remain. Shell surfaces consume those same
  glass values instead of hardcoded warm colors. Token/contrast checks: 20/20 with unchanged assertions.
- Added a real `账号与组织` Settings sub-view, sidebar/command entry, browser login/cancel,
  account/connection states, organization creation/switching, shared project metadata, members,
  invitations and role operations through the typed preload API. Forms/confirmations are inline
  inside the existing global DialogShell; no nested modal/backdrop.
- Data is scoped by server/account/organization; scope caches are removed before switching and
  scoped content is hidden while changing. No demonstration rows, fake project execution, token
  fields or renderer HTTP access. Shared-project/local-workspace boundary is visible.
- Actual source guidance, exact reference commits, detector result, font/contrast choices and
  limitations are in `docs/org-upgrade/design/A1_ORGANIZATION_UI.md`. Dedicated skill-loader tools
  were unavailable; actual checked-out guidance was read instead. Impeccable source detector: `[]`.
- No new Liquid Glass React or Aurora effect is enabled; foreground FPS and full axe are not
  claimed here. Real Electron matrix and visual acceptance remain tied to the A1 evidence report.
- Baseline audit limitation: current Lab source still contains constant stage labels/counts and
  looping dashed active-edge CSS. Protected Lab/graph files were not modified in this settings
  slice. An old “five fixes complete” checklist is not evidence of their current rendered state.

### Agent collaboration follow-up — keep the drawing canvas, remove the chat inner page

- User explicitly requested the existing graph/connection implementation remain and the chat-style
  inner page be removed. Actual clear video frames were inspected for Agent→aggregation→artifact
  semantics. External video brand assets were not copied or committed.
- `CollaborationGraph.tsx` / `focus-projection.ts` are unchanged. The full-page legacy chat branch
  and its “会话工作台/打开会话” entry points were removed. Existing session/message storage remains.
- Agent details now contain a compact context selector/create action, instruction form, real Run
  state/stop action and collapsed read-only latest output. Existing in-node approval and audit
  actions are retained. Old session/pro links resolve back to the same graph context.
- Agent management now renders beside the graph instead of being hidden by the former early return.
- Context-scope/deep-link + graph-focus unit checks: 5/5 PASS. Relevant ESLint: 0 errors/warnings.
  Graph Electron harness retains real data/pixel/endpoint/approval/restart assertions and writes
  this round's screenshots to a separate evidence directory. Final results belong to that run.
- Final A1 checks: whole-repo lint 0 errors / 29 existing warnings, typecheck/build PASS,
  536 tests PASS / 4 external-infrastructure cases SKIP, four required desktop E2Es PASS,
  organization journey 30/30 and graph journey 30/30, packaged EXE smoke PASS. See
  `docs/org-upgrade/reports/A1-report.md` and its adjacent evidence manifest.
- Native graph capture now waits for overlay opacity 1 plus 1200ms compositor settle. The earlier
  apparent sheet transparency was a captured entrance-animation frame; settled screenshots were
  inspected and are opaque. The product overlay and drawing implementation remain unchanged.

## 2026-10-29 — A1 Agent 协作总览（全画布图，非三栏）

- 用户否定了首版固定三栏（Agent/计划/成果），要求“整页都是图，点击图上的对象再加载信息”。
  本版改为全宽可缩放协作画布：Agent、任务、审批、产物、交接都是真实节点/边，详情从右侧抽屉按需加载。
- 保留现有 AppShell、GoalJourneyBar、Liquid Glass 外壳与 `[协作总览][专业编排]` 双向切换；页面内部使用
  A0 Precision token（`.pw-theme`），未修改全局壳。
- 新增只读投影 `collaboration.overview`：Agent 状态来自活动 Run，审批只展示 pending，产物显示
  `verifiedAt`/`contentHash`/`gitCommit`，Handoff 只在真实行存在时连线；空项目不填充演示数据。
- React Flow 12.12 在本机出现节点测量缺失（DOM 有 Handle、内部 `measured` 为空、原生边层为空），
  因此节点/缩放/选择仍由 React Flow 负责，关系边改为同坐标系 SVG 层，由真实数据生成；作为已知限制记录。
- 修复快速重启时 Runtime stdin `EPIPE` 未捕获导致 Main 进程错误框的真实缺陷。
- 证据：`docs/agent-overview/reports/A1-agent-overview-report.md`、`docs/agent-overview/reference-comparison.md`、
  `docs/agent-overview/evidence/`（16 PASS / 0 FAIL、9 张产品截图 + 参考拼图）。1024 仍是同一张图，不切成三栏。

## 2026-10-29 — A0 Precision Workspace 设计母版（独立原型路由，生产基线未变）

- 新增 `#/precision-lab`（`DEV_ONLY`，不在产品菜单）：组织/项目总览、需求工作台、流程模板设计器三张母版，
  以及组织资产/成员/运行等次级视图；全部标注 `DESIGN PROTOTYPE`，使用演示数据，不写 SQLite、不启动 Agent。
- 新增候选 token 层 `packages/design-tokens/src/precision.css`（仅 `.pw-theme` 作用域，生产仍用 Liquid Glass）。
  内容字号下限 12px，正文 13px；主文字/辅助文字在亮暗两套主题下均 ≥4.5:1（`scripts/a0-contrast.mjs` 实测）。
- 真实技术实现：React Flow 12 + ELK 分层纵向 DAG（9 节点/10 连线）、Radix Dialog/Popover、真实校验
  （起点数量、交付节点、门禁角色、循环依赖）、真实发布版本状态。
- 修正参考原型的缺陷：组织选择器 caption 与标题同行碰撞；移除标题上方装饰性眉标；流程从绝对定位假图改为真实 DAG。
- 真实 Electron 证据：`docs/org-upgrade/evidence/A0/`，45 项 PASS / 0 FAIL / 1 SKIP；截图覆盖 1440×900、1024×768、
  125%、亮/暗、空态、错误、审批抽屉、命令面板、发布对话框。采集脚本 `scripts/a0-precision-shots.mjs`。
- 过程中发现并修复两个真实缺陷：① Radix Portal 在 `.pw-root` 之外导致 light token 丢失，弹层无背景/无遮罩；
  ② 创建需求弹窗 `projects` 数组每次渲染都变引用，`useEffect` 反复清空输入。二者均有 Electron 复测。
- 参考来源与限制：使用 Radix 1.3.1 / React Flow 12.12 / ELK 0.12 / Lucide 1.61（均已安装，许可证见设计文档）；
  ui-ux-pro-max 的 landing 模式与紫色调色板被拒绝（与资料包 Precision 方向冲突）；Motion 未在本原型使用；
  Sim Studio / Liquid Glass / React Bits 本轮未检查，不作为已参考来源。详见 `docs/org-upgrade/design/PRECISION_DESIGN_SYSTEM.md`。
- 未验证：1024 覆盖式流程检查器的自动化开关、拖拽连线 E2E、axe 全量审计、reduced-motion 开启后的截图。

## 2026-10-29 — Breadcrumb navigation with history back

- 缺陷：内页之间无法回到上一个内页；标题栏的路径看起来像装饰（三级色、无层级语义），也没有返回控件。
- 修复（ADR-0045）：标题栏路径升级为 `项目中心 › 项目名 › 分组 › 当前页`（`<nav aria-label="导航路径">`，
  当前页 `aria-current="page"`），前两级可点击；新增「返回上一页」按钮（应用内历史存在时可用，`navigate(-1)`）；
  字号 12.5px，分组改用二级文字色（三级色实测 3.86:1 不达标）。
- 位置保持标题栏内，不占页面高度：避免把 `height:100%` 页面（审批 / 资源与连接）重新撑出整页滚动条（ADR-0037）。
- 真实 Electron 证据（真实项目，1440×900；1100×700 与 1440@125% 复核）：
  - 亮色：返回/层级/分组 6.57:1，当前页 13.96:1；
  - 暗色：返回/层级/分组 12.75:1，当前页 18.42:1；
  - 侧栏 运行审计 → 审批 →「返回」→ 运行审计；点项目层级回到项目页；标题栏高度保持 45px，无横向溢出。
  - `scripts/p288-breadcrumb-e2e.mjs` → `PASS=11 FAIL=0`。
- 截图：`docs/screenshots/p288-breadcrumb-{runs,light,dark,1100x700,1440x125}.png`。
- 未验证项：`#/settings`、`#/design-lab` 等非项目路由下退化为 `项目中心 › 当前页`，未单列验收。

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

## 2026-10-29 — Design Lab material, batch 4 (lifecycle / release / deploy / resources / settings)

- `pages-design-lab.css` completes the page migration: lifecycle metrics and version cards,
  release columns/rows, release workbench and deployment console shells, resource center, and the
  global Settings dialog (`.po-settings-dialog` + antd modal surface).
- antd v6 controls inside these surfaces (default/outlined buttons, `ant-select` root and selector)
  now follow the dark optical tokens; a computed-style probe had shown a white select root on the dark
  canvas, which is fixed.
- Sweep expanded to 13 pages + Settings: light 28/28, dark 29/29 (1440/1024, computed font-size floor,
  no overflow, journey bar present, real heading assertions).
- Evidence: `docs/adr/0066-…`, `docs/v2/evidence/p29-task1-task2-evidence.md`,
  `docs/screenshots/p29-sweep-{versions,releases,deployments,connections,resources,settings}-*.png`.

## 2026-10-29 — Design Lab material, batch 2 (work center + task board)

- `apps/desktop/src/renderer/src/styles/pages-design-lab.css` applies the approved
  Design Lab optical recipe to the shared card primitives (`po-card`, `po-metric`)
  and to 研发工作中心 (`wc-focus`, `wc-goal-state`, callouts, task/agent rows) and
  任务看板 (columns, tiles, next-step banners). Structure, hierarchy and behaviour
  are unchanged; the Design Lab page keeps its own `.pdl-root` scope.
- 真实测试 tile now maps `passed/failed/stale/verifying` (was the retired
  `passing/failing` strings) to success/warning/active/neutral.
- Work center no longer says "无需操作" while a paused run is parked on an expired
  approval.
- Evidence: `docs/screenshots/p29-sweep-work-1440.png`, `p29-sweep-tasks-1440.png`
  (plus 1024 variants), `docs/adr/0061-design-lab-batch-2-work-center-and-board.md`,
  `docs/v2/evidence/p29-task1-task2-evidence.md`.

## 2026-10-22 — Stage journey follows contract fix 2

- Stage route displays only the four designed icons (Layers/Code/Eye/Flask) on
  the shared curve; stage names, descriptions and repeated task counts moved to
  the selected-stage summary.
- Each icon keeps an aria-label and native hover/focus tooltip.
- Stops are centered in equal grid cells and route anchors use the same centers,
  fixing the left/bottom drift in the earlier implementation.
- Plan review screenshot: `docs/next-ui/screens/plan-workbench.png`.
