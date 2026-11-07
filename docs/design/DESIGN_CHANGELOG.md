# ProjectOS UI Design Changelog

## 2026-11-05 — Audited delivery and readable code comparison

- User requested functional delivery, then explicitly rejected command fields and unreadable/plain code previews. Git/project/task verification now uses a direct action; Runtime selects the actual project test configuration. The workspace terminal is removed from the primary flow; execution parameters remain under audit details.
- Reused the approved overlay, typography, semantic palette and Motion behavior. Added a full-window Monaco comparison with per-file selection, split/inline views, wrap, synchronized scrolling, change navigation and text/line highlights. Conflict base/target/source originals remain available after staging. Manual edits still create separate write approvals. File models are released after editor disposal.
- Inspected the actual Design Lab, `approved-dag.png`, `OpticalGlass.tsx`, Aurora attribution, installed `liquid-glass-react` 1.1.1 and Monaco diff/editor sources. No graph composition, ambient effect, brand asset or global palette migration is introduced. Existing Liquid Glass Electron fallback is preserved; this change does not claim a new effect/performance qualification.
- Loaded local SKILL sources for UI UX Pro Max (`28b3b8d`), Vercel composition/React practices (`1a2c79d`), and Impeccable (`02523ae`). Runtime exposes no separate skill-loading tool; files were read directly. Queried typography, color and UX accessibility/motion. Rejected suggested font/palette replacements because the frozen ProjectOS screenshot/tokens win. Applied composition, named actions, focus and reduced-motion guidance.
- Consulted Sim Studio editor context-menu source at `a52fc509` (`apps/sim/app/workspace/[workspaceId]/files/components/file-viewer/editor-context-menu.tsx`); no assets copied. Initial restricted fetch failed; the actual source was subsequently read. Apache-2.0, React Bits attribution and installed MIT licenses remain intact.
- Impeccable context allowed a scoped incumbent refinement without PRODUCT.md invention. Manual detector reports no regex findings, but cannot evaluate TSX contrast; real Electron screenshots, axe results and remaining manual checks are recorded in `docs/v2/evidence/delivery-organization-closure/`. Unit tests alone are not visual acceptance.
- Real desktop acceptance exposed a nested-select Escape issue, missing editor labels and a Monaco model-disposal error. These were corrected and are included in the final EXE checks. Historical failures and the earlier timeout report remain in evidence; the new report records the final status.
- Final contrast inspection found secondary comment text at 4.3:1 over the inserted-line background. Editor comments now use the existing primary-text token; the global palette and approved DAG remain unchanged. Monaco rgba tokens are converted to supported hex to avoid red scrollbar fallbacks.

## 2026-10-31 — visible glass shell (user-directed) and requirement start controls

- User asked to prioritise UI: refined, commercial glass; fewer flat white rectangles. Chosen scope: global shell first, glass strength close to the approved Design Lab. Added `styles/glass-system.css` (Lab recipes, frozen blue/cyan palette): coloured static light field, translucent workspace/rail, translucent content sheets with hairline + highlight, glass controls, frosted overlays, reduced-transparency fallbacks.
- Live backdrop blur on the scrolling workspace measured 61 → 10 fps and was removed there; kept only on overlays/popups. Composited pixel contrast 24/24 ≥ 4.5:1. [Evidence](../v2/evidence/glass-shell/REPORT.md).
- Round 2 de-carding: unified 4-card stat grids (`.po-metric-grid`, `.v16-stat-grid`) into a single hairline-divided glass telemetry strip without boxy corner icon badges; converted nested boxed rows (`.po-milestone`, `.po-requirement`, `.po-decision`, `.po-gate`, `.wc-task-row`, `.wc-agent`, `.v16-team-row`) into hairline-divided ledger rows; transformed `.v16-project-visual` into a compact horizontal glass card (removing the 108px blank cover box and redundant quick-action/placeholder chart cards); flattened `.po-board-toolbar` and fixed the `.ant-input-affix-wrapper > input.ant-input` white inner box on `TaskBoardPage`.
- Round 3 optical refraction & Batch 2 unified journey/materials (ADR-0078): ported Design Lab's radial indigo/cyan/violet refraction recipes (`--gl-optical`, `--gl-canvas`, `--gl-lane`) to eliminate flat white-on-white translucency; de-boxed `.nx-center-hero` and `.po-lifecycle-card` headers; restructured `RequirementWorkPage` header with `.rq-eyebrow` and borderless right-hand tabular metrics (`任务项 / 流程阶段 / 产出资料`) matching `.pdl-plan-head`; styled `.rq-flow-journey` and `.po-journey` with `.pdl-stop-orb`-style glass markers; replaced opaque `#F4F7FD` on `.aco-deck.pw-theme` with Design Lab's radial optical canvas + `22px` dot grid; unified top-bar requirement journey (`RequirementJourneyBar`) and stage material provenance/stale/superseded reader (`RequirementMaterials`). [Glass evidence](../v2/evidence/glass-shell/REPORT.md), [Batch 2 evidence](../v2/evidence/requirement-journey-materials/REPORT.md).
- Requirement workbench gained one state-driven primary action, a task-arrangement dialog and start results (ADR-0077). [Evidence](../v2/evidence/requirement-defaults-start/REPORT.md).
- Round 4 UX & 3D Avatar Polish: compacted `TaskBoardPage` header and `RequirementJourneyBar` (`compact` variant) with folded filter popover; upgraded `.ant-switch` transitions and fixed `.pui-overlay-surface` button reset specificity; styled `WorkCenterPage` `...` popover with `.po-glass-action-menu`; unified `WorkCenterPage` `+ 提出需求` with `RequirementWorkPage` modal (`?create=1`); reordered left sidebar navigation in lifecycle execution order and promoted `项目档案与配置` to a pinned top trigger beneath the project switcher with a right-hand glass secondary menu popover (`.po-project-hub-popover`); upgraded `AgentAvatar3D` (`packages/ui/src/components/AgentAvatar3D.tsx`) to 52px Doubao-AI style 3D anthropomorphic portraits (`packages/ui/src/components/agent-portraits-data.ts`) with natural blinking (`po-avatar-eye-blink`) and occasional side glances (`po-avatar-look-left` / `po-avatar-look-right`), preserving original Gaussian blur (`backdrop-filter`) and drop-shadow effects while memoizing `WorkEditor` options and pausing `.po-shell` background animations when a modal backdrop is active.
- Round 5 Multi-Agent Six-Stage Governance & Coverage UI/UX (`ObjectOS-MultiAgent-Plan-20261101`): added the Premium Liquid Glass `.rq-governance-strip` (`.rq-gov-pill`, `.rq-criteria-matrix`) on `RequirementWorkPage.tsx` surfacing full-text context contract (`全文装载`), interactive Acceptance Coverage Matrix (`C-01..C-NN` mapped to tasks with one-click workbench navigation), executor capability preflight (`结构化预检就绪`), and per-check verification isolation (`逐项验证隔离`); enhanced `TaskFlowDetails` Agent selector with runtime capability badges (`内置结构化` vs external CLI/ACP); enriched `RequirementPlanDialog.tsx` with full-text & acceptance coverage pills and governance audit alerts; added triple-gate status pills (`.rq-integration-gates`) to `RequirementIntegrationDialog.tsx`.
- Round 6 Requirement Workbench Full-Width Layout, Dependency DAG & 3D Avatar Bust Upgrade: added `RequirementDependencyGraph.tsx` (`阶段路线 / 任务依赖` merged viewbar with ELK layered layout and React Flow custom solid/focused edges); promoted `.rq-requirements` to a horizontal full-width switcher bar and aligned `TaskFlowDetails` into a 4-column stage-deliverable-agent row (`rq-unified-step-row`); fixed `.rq-layout` inheriting `align-items: start` from `requirement-work.css` when switched to `flex-direction: column` (which caused `.rq-content` and `.rq-dl-dag-wrap` to shrink-to-fit on the horizontal cross-axis and leave a blank area on the right side in `任务依赖` DAG view) by enforcing `align-items: stretch !important`, `width: 100% !important` on `.rq-layout`/`.rq-content`/`.rq-workspace` and `po-page-wide` on `.rq-page`.
- Round 7 AI Task Splitting Workspace Context, Version Gate Filtering & Anti-Replay Progress UX: added `.rq-plan-context-bar` (distinguishing `全新空白项目 · 从零构建` vs scanned existing repositories with an inline `扫描项目代码 / 重新扫描项目` action) and `.rq-plan-progress-card` (4-step live stage progression + elapsed second counter + synchronous `useRef` anti-replay button lock and `重新拆分` button) in `RequirementPlanDialog.tsx`; filtered internal planner telemetry (`项目尚未扫描`, `有界纠错`) from user-facing alerts; gated `LifecycleService.blockedGates` and `ActionCenter.tick` on `hasActiveVersionGateContext` so untouched default `v0.1.0` rows no longer hijack `NextStepPanel` in `研发工作中心`; added startup/view self-healing for interrupted `AI 分配未完成%` blocks and deterministic stage-role fallback assignment on stream truncation in `RequirementFlowService`, plus decoupled `assignAIMutation` and `startingTaskId` button loading states in `RequirementWorkPage.tsx`.

## 2026-10-30 — requirement-owned workflows, without UC grouping

- The user's latest instruction supersedes the earlier UC design. Requirements directly contain tasks;
  each task inherits the requirement's versioned workflow. Legacy group documents and links are preserved.
- Retain the approved blue/cyan optical theme. Reuse the existing guarded overlay for inline workflow
  creation, real React Flow editing, keyboard alternatives, compact task rows and contextual approvals.
  Named stage navigation and Agent details open actual stored materials; no placeholder progress.
- Native AI assignment respects manual choices during automatic completion. Real node execution,
  document review, testing and recovery retain existing Runtime and human-approval boundaries.
- Consulted local UI UX Pro Max, Vercel, Impeccable, actual Sim source and installed React Flow;
  unavailable skill loaders and unchanged optical-effect limits are explicitly recorded.
- [Evidence](../v2/evidence/requirement-guided-flow/REPORT.md): 74 native checks, 41 final screenshots,
  light/dark and 1440/1280/1024 plus app zoom/reduced motion. Full tests: 613 PASS / 1 timeout / 4 SKIP;
  the entire timed-out test module separately passes 15/15, and final flow/coordinator tests pass 18/18.
  Build, typecheck, lint and packaged EXE smoke pass. No claim of full-suite or user visual acceptance.

## 2026-10-30 — A3.2a reviewed task results and requirement integration

- Keep the restored blue/cyan optical materials and shared guarded DialogShell. Add a real result
  review surface with code first, current verification and human review alongside, and Git details
  collapsed. Narrow windows use one reading column with the primary action still reachable.
- Distinguish task acceptance from result review. Verification, Git permission, task acceptance and
  requirement delivery remain separate facts. No static progress or implicit blanket authorization.
- Native screenshots, command results, source references and remaining limits are recorded in
  [A3.2a evidence](../v2/evidence/requirement-integration/REPORT.md). Earlier screenshots stay intact.

## 2026-10-30 — A3.1 real requirement workbench, UC groups and isolated task workspaces

- Extend the restored blue/cyan optical system with one real requirement route; reuse semantic tokens,
  bundled Chinese typography and shared guarded overlays. No palette replacement or graph redesign.
- Wide requirement rail becomes a named selector in narrow windows; UC sections contain real task
  rows and explicit workspace/approval/error states. Draft documents never imply review approval.
- New requirement scope does not display the legacy plan journey, which incorrectly implied AI work
  while the user was editing a draft. All existing plan journeys/routes remain.
- Actual Sim source, local UI UX Pro Max/Vercel/Impeccable files and queries, unavailable loader and
  retained optical-effect limitations are recorded with [A3.1 evidence](../v2/evidence/requirement-work/REPORT.md).
- 17 final native screenshots, six viewport/theme axe checks, 30 real desktop checks and full command
  results accompany that report. No final aesthetic approval, OS-DPI or live-model acceptance claimed.

## 2026-10-30 — restore blue/cyan optical glass after user rejection of Soft Studio

- Explicit user correction supersedes the new package: restore the pre-package optical theme,
  navigation and page composition, retaining earlier source adaptations and uncommitted work.
- Reconstruct the pre-package snapshot from HEAD `f71d33e` plus the saved existing diff. No repository
  reset, database edit, remote push or rollback of the completed font/startup/journey work.
- Remove the Soft Studio activation and palette preference from production. The alternative token,
  layout helper and tests are archived locally; ADR-0072 is withdrawn. The original UI contract remains.
- Real restored-app screenshots, source hashes and command status: [restoration report](optical-restore/REPORT.md).

## 2026-10-30 — restore optical startup and the visible global journey

- User feedback supersedes the overly compact global journey: nine named stages are visible, the
  current phase and state are explicit, and the completed count is labelled in details. Native
  resize/zoom uses a compact node-above-label path, with wrapping only below the supported narrow
  viewport. The protected Design Lab icon route is unchanged.
- Reuse one authored static boot fragment in early HTML and React fallbacks. Restore the complete
  brand/orbit composition in the approved cool optical material. Saved theme/motion preferences
  apply before React; no plain dark text screen, forced delay, fake progress or backend change.
- Keep local typography readiness. The font is defined once by the early stylesheet; React waits
  for real loading and FontFaceSet readiness. Native checks inspect actual Noto Sans SC glyphs.
- Consulted UI UX Pro Max typography/color/layout/accessibility/motion sources, Vercel composition
  and React hydration/performance rules, Impeccable craft/animate/audit, and installed Motion.
  Query outputs are in `startup-journey/sources/`. Reject the generic teal/orange palette and online
  font imports because the frozen screenshot and local font baseline take precedence. Use an external
  preference script instead of Vercel's inline-script example to preserve the production CSP.
- Existing Sim/Liquid Glass/Aurora source and compatibility evidence remains in the previous report;
  graph composition and shader integration are not changed. Static optical material remains the
  default under the recorded 7/8 fps constraints. No new source adoption or performance claim for them.
- No dedicated skill loading tool is exposed; SKILL files were read directly. Impeccable source
  detection returns `[]`; native axe/contrast/frame checks are separate. No PRODUCT.md is invented.
- Evidence and exact command status: [startup/journey report](startup-journey/REPORT.md). Tests and
  screenshots support review, not a claim of the user's subjective aesthetic approval.

## 2026-10-30 — follow-up: actual font fallback and complete first frames

- User specifically identified sharp, inconsistent type beside flat white surfaces and separate
  component/text painting. This authorizes a typography refinement within the approved DAG aesthetic.
  Packaged the complete OFL Noto Sans SC variable font locally; no remote font dependency. Exact
  Google Fonts source revision, source/output hashes and license are included with the asset.
- Native CDP proved missing historical `--pw-font`/`--pw-mono` aliases rendered approval code in
  NSimSun. Mapped those aliases to the shared fonts, with explicit Chinese fallback for code. This
  finding is preserved in `system-premium/diagnostics/font-fallback-reproduction.json`.
- Softened reading and overlay surfaces with opaque cool gradients; removed residual 12.5px task
  titles; use real 400/550/600 variable weights. Do not blur text or lower its opacity.
- Wait for the local font before first product mount. Align route preparation with actual reads
  (including the 100-record run list, files, resources and dependent plan/model data). Settings and
  task/run detail keep previous content until ready; late requests cannot reopen a closed dialog or
  replace a newer choice. Removed the task inspector's delayed clear race.
- Eight deferred-read tests exercise ordering, cancellation and failure retention; native checks
  inspect cold frames at 4x CPU load plus actual fonts. `readiness/checks.json` and the full matrix
  record final results. The first probe's file resource-timing assertion was replaced by actual
  loaded font-face source + platform font inspection because local file timing entries were empty.
- Required design sources remain as recorded below; local font refinement supersedes only the old
  font stack, not the approved optical composition. Test success does not imply aesthetic acceptance.

## 2026-10-30 — one approved optical system; guided work and consistent reading rhythm

- Implemented ADR-0070/0071 in Renderer and shared UI only. The user-confirmed DAG screenshot stays
  authoritative. Actual project navigation replaces prototype menu entries; Settings remains global.
- Completed the five Lab implementation fixes: shared curve/icon coordinates, readable type and native
  contrast sampling, solid focused DAG edges, complete shared task inspector, and durable evidence.
  A ResizeObserver fits the DAG again after resizing/zooming without resetting it on text edits.
- Unified the shell, page surfaces, buttons, forms, menus and dialogs with the cool optical material.
  Removed conflicting historical global overrides, including forced white primary-button text in dark
  mode. Body/secondary/title hierarchy and control dimensions now share tokens. Light secondary ink
  was deepened to `#4B5A73` after native ambient-background samples fell just below 4.5:1.
- Visual review removed the remaining Overview photo/34px hero override and moved Knowledge to
  the shared PageHeader. Collaboration hints/legend/pause now occupy their own toolbar, never the
  node viewport. Settings overview no longer displays decorative implementation branding.
- Full overlay regression exposed intermittently unmeasured/hidden plan nodes. Initial dimensions
  now match ELK/CSS; each real-plan matrix state also asserts node visibility. The failed full run,
  passing isolated replay and final full recheck are preserved separately in the report.
- Retained assisted/autonomous/managed modes and persisted permissions. Home and journey show the
  actual next action. Prepared route reads avoid components painting before their text. Versions own
  iterations; environments are project-wide deployment destinations; empty deployment has real steps.
- Collaboration remains a graph. Bounded directional pulses are pausable and respect live reduced
  motion. Native investigation isolated the previous ~10 fps bottleneck to the detail sheet's full
  backdrop blur; a nonmodal inspector restores interactive performance. No shader is enabled.
- Imperative decisions use the shared dialog system. Only the top layer dismisses, nested decisions
  retain their parent, one backdrop is used, and keyboard focus returns to the invoking control.
- Actual sources, commands, intermediate failures, comparison images and remaining limits are recorded
  in [the implementation report](system-premium/REPORT.md) and its evidence manifest. UI UX Pro Max,
  Vercel, Impeccable, Sim, installed Liquid Glass/Motion and Aurora sources were consulted; unavailable
  dedicated skill-tool/native Impeccable features are explicitly distinguished from source checks.
  Engineering test results do not establish the user's subjective visual acceptance.

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

## 2026-11-05 — Functional desktop audit; renderer unchanged

- Preserved the existing renderer work and approved visual direction. This batch changes Runtime/Worktree behavior and test tooling only; it is not a page migration or new visual acceptance.
- Actual Electron UI verified personal project/requirement/task creation, restart recovery, manual system-browser PKCE login, organization/shared project/member views, worker enrollment/pause/resume and sign-out.
- Real DeepSeek completed all six workflow stages, separately approved file writes and tests, content-bound human review/independent verification, explicit requirement-branch integration and restart recovery. The project main branch remained unchanged.
- A real Windows deep-path failure was preserved as needs_reconciliation; compact new destinations and no unaudited preview commits are documented in ADR-0080. Full logs, 35 screenshots, commit lineage, file hashes and remaining gaps are in `docs/v2/evidence/2026-11-05-functional-audit/`.
- Computer-use skill/guidance were actually read. Windows capture/geometry failed, so real Electron UI locators were used; no business API seeding, fake browser login or mocked native confirmation was counted. Native project consent, physical mouse input, GUI conflict resolution and a new visual/a11y matrix remain unverified.
- Required regression/package checks pass; the full suite contains one 30-second integration timeout, which passes when isolated without changing the limit. Do not report the full suite as green.
## 2026-11-07 — K2 organization knowledge and requirement references

- Extend the existing organization Settings with an inline knowledge list/detail/editor/version history;
  add source selection to the current requirement workspace. Preserve the approved DAG, global palette,
  packaged Noto Sans SC, semantic controls and the existing Motion transition. No graph composition,
  new Aurora shader or Liquid Glass filter is introduced.
- Consulted all root UI contracts, current migration/recovery/issues and approved baseline images,
  actual DesignLabPage/StageJourney/TaskInspector/OpticalGlass/Aurora source, shared organization controls
  and unified tokens. Existing five-fix history is retained; this additive feature does not migrate pages.
- Read local `ui-ux-pro-max/.claude/skills/ui-ux-pro-max/SKILL.md`, Vercel composition and React skills
  (including async parallelism, cached-query deduplication and explicit component variants), and
  Impeccable context/craft-floor. No skill-loader tool is exposed, so no tool-based loading is claimed.
  The Impeccable context command ran against OrganizationPanel; no PRODUCT.md exists. The existing
  approved implementation is the authority for this scoped extension; no product facts were invented.
- Actual UI UX Pro Max queries: typography `Chinese desktop readable labels`; color `semantic contrast
  glass workspace`; UX `responsive settings form`, `keyboard focus validation`, `reduced motion
  interruptible`. Accepted Noto Sans SC/readability, labels, focus and reduced motion. Rejected the
  unrelated photography/gray spatial palettes, remote font imports and generic type-size replacement
  because they conflict with the frozen local Premium Liquid Glass system. Reuse TanStack Query rather
  than introducing SWR solely for the Vercel deduplication example.
- Inspected installed `liquid-glass-react` 1.1.1 package/dist and MIT license, current Electron optical
  fallback, and React Bits Aurora attribution (MIT + Commons Clause). Existing compatibility/low-FPS
  limitations remain; this feature does not enable the library effect or claim new GPU qualification.
- Read actual Sim Studio editor menu source at `a52fc509`,
  `apps/sim/app/workspace/[workspaceId]/files/components/file-viewer/editor-context-menu.tsx`
  (Apache-2.0; no assets copied), and official Motion accessibility guidance
  <https://motion.dev/docs/react-accessibility>. Explicit actions, disabled states and local focus
  ownership inform the existing form/navigation controls. No canvas changes are made.
- Actual command output, native screenshot matrix, a11y, failed fixture investigations and remaining
  verification boundaries are recorded in `docs/v2/evidence/organization-knowledge-k2/` as they run.
- Final K2 evidence: 676 tests PASS / 4 SKIP; root-required lint/typecheck/build, four desktop E2Es and actual Windows EXE smoke PASS. New UI: 97 desktop checks, 40 axe states with no violations, plus 137 supplemental checks / 568 native-composited text samples (minimum 4.944:1).
- Current approved-DAG regression: 32/32 PASS, before/after PNGs byte-identical. Two obsolete stage-first visual entry points FAIL and remain recorded; the new K2 coordinator now invokes the approved DAG and native-contrast wrappers. Existing light-theme “待批准” badge diagnostic is 4.46:1, tracked in OPEN_ISSUES for separate visual review. No protected baseline restyling. See docs/v2/evidence/organization-knowledge-k2/REPORT.md for exact scopes, source manifests, failures and remaining limits.
