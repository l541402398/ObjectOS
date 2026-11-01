# 全局玻璃外壳与页面去卡片化（第一轮 + 第二轮 + 第三轮光学折射升级）

日期 2026-10-31。用户指示：优先改 UI/UX，要玻璃质感、精致、不花哨、有商业成熟度；当前大量矩形卡片与寡淡白色显得突兀。
用户选择：**全局外壳先行**、**明显的玻璃力度（接近 Design Lab 批准稿）**、第一批遗留失败先记录后查；随后指示继续推进第二轮页面去卡片化与第三轮深层光学折射升级。

## 改了什么

单一新样式表 [glass-system.css](../../../../apps/desktop/src/renderer/src/styles/glass-system.css)，在 [main.tsx](../../../../apps/desktop/src/renderer/src/main.tsx) 最末加载；配方取自批准的 Design Lab（`.pdl-workspace` / `.pdl-rail` / `.pdl-review-panel` / `.pdl-ledger`），保持冻结的蓝青色调，没有换主题、没有改业务逻辑或 E2E DOM 选择器。

### 第一轮（全局玻璃外壳与通用材质）
- **光场**：工作区背后的静态背景改为带紫、青、靛色光晕的冷色光场，玻璃层才有可透出的颜色。
- **工作区框与侧栏**：由近乎不透明的白色改为半透明渐变 + 白色描边 + 顶部高光 + 柔和投影。
- **内容层**：卡片/面板/需求页各区块由白色实底改为半透明“玻璃片”：一条发丝描边、一道顶部高光、很轻的投影；选中行改为浅色光带而不是实色块；分隔线变浅。
- **控件**：默认按钮、输入框、下拉框为半透明玻璃；主按钮为克制的靛蓝渐变 + 内高光。
- **弹层**：对话框、侧板、检查器为磨砂玻璃（仅弹层与下拉保留实时模糊），背后页面变暗并轻度模糊。
- **降级**：`prefers-reduced-transparency` 与应用内“减少透明”回退为实底且关闭模糊；减少动效关闭过渡。

### 第二轮（页面结构去“AI 卡片墙”）
- **四宫格统计卡收敛为单条光学台账带（Telemetry Strip）**：`ProjectCenterPage`（`.v16-stat-grid`）与 `ProjectOverviewPage` / `CollaborationPage`（`.po-metric-grid`）不再渲染 4 个独立圆角盒 + 彩色方块图标角标，改为单条连贯玻璃台账带，内部以发丝竖线（`1px solid var(--gl-sheet-line)`）分栏，字号收敛为 `22px` 等宽数字，角标退化为无底框轻量图标。
- **项目中心去冗余卡片**：
  - `.v16-project-visual` 去掉原 `108px` 空白封皮顶盒与 5 列窄条排布，改为紧凑横向玻璃卡（左侧项目徽标、右侧标题/阶段/进度、右上角箭头）。
  - 隐藏与页头/主卡重复的三宫格快捷入口（`.v16-quick-grid`）及无额外信息的占位柱状图/环图卡（`.v16-chart-card:has(.v16-bars, .v16-donut-wrap)`），让 `最近动态` 台账舒展占满主列。
- **嵌套“盒中盒”改为发丝分隔台账行**：`ProjectOverviewPage` 内的 `.po-lifecycle-strip`、`.po-milestone`、`.po-requirement`、`.po-decision`、`.po-gate` 及 `.wc-task-row` / `.wc-agent` / `.v16-team-row` 去掉独立圆角边框与实底，改为父玻璃片内的发丝分隔行。
- **任务看板去框与搜索框白底修复**：
  - 修复 `:is(...)` 特异性导致的 `.ant-input-affix-wrapper > input.ant-input` 内部白色矩形底框，搜索框恢复通透一体玻璃。
  - `.po-board-toolbar` 去掉外层大圆角盒，改为底部分隔线行内过滤条；空列去掉内部虚线框（`.po-column-empty`），任务卡去掉底部分割线（`.po-task-tile-footer`）。

### 第三轮（Design Lab 内部色散折射、页头去外框与画布光学网格）
- **根治“白叠白发灰发白”**：分析发现多层纯白半透明叠加（`0.48 + 0.60`）会合成为近 80% 寡淡实白。直接引入批准稿 `APPROVED-design-lab-dag.png`（`design-lab.css` `.pdl-optical-warp` / `.pdl-dag`）的径向靛青紫光学折射渐变（`--gl-optical`、`--gl-canvas`、`--gl-lane`），配合 `1px` 高光镜面描边与顶部反光带，使每一块玻璃容器自带冷调光学通透感。
- **页头彻底去大白框（对齐 `.pdl-plan-head`）**：
  - 去掉 `ProjectCenterPage`（`.nx-center-hero`）与 `ProjectOverviewPage`（`.po-lifecycle-card`）的独立外层大卡片框，直接融入主光学工作区并以 `1px` 发丝线分隔。
  - 重构 `RequirementWorkPage` 页头（`.rq-heading`），左侧采用 Design Lab 风格大写眉标（`REQUIREMENT FLOW · N 个阶段 · M 项任务`）+ 标题 + 状态胶囊，右侧采用无边框等宽指标组（`任务项 / 流程阶段 / 产出资料`）。
- **流程旅程条与节点徽标（对齐 `.pdl-stop-orb`）**：
  - `.rq-flow-journey` 与 `.po-journey` 升级为冷色光学胶囊轨道，阶段序号采用 `24×24` 圆角方晶徽标（`.rq-journey-mark`），当前激活阶段带靛青渐变光晕。
- **Agent 协作画布与任务看板泳道**：
  - 修复 `unified.css` 中 `body .aco-deck.pw-theme { --pw-surface: #F4F7FD }` 导致的纯白画布底色；`.aco-canvas-wrap` 现采用 Design Lab 同款径向冷光场 + `22px` 光学微点阵网格，顶部工具条（`.aco-canvas-bar`）与视图切换胶囊透明化。
  - 任务看板四列泳道（`.po-board-column`）改为内凹冷色玻璃槽（`--gl-lane`），任务卡片（`.po-task-tile`）对齐 `.pdl-node` 紧凑光学卡。

## 性能取舍（实测）

工作区框和侧栏最初按 Lab 使用实时 `backdrop-filter`，滚动时 rAF 帧率从 **61 降到 10 fps**（1440×900，需求页）。
光场是平滑的静态渐变，模糊几乎没有可见差异，因此这两层去掉实时模糊，只靠半透明呈现玻璃；第二轮完成后实测滚动帧率为 **59–60 fps**（rAF 计数，非 GPU 剖析）。实时模糊只保留在弹层和下拉这类静止的小面积层。

## 检查（本次实际运行）

| 检查 | 结果 | 输出 |
|---|---|---|
| 透明层合成对比度（隐藏文字、采样真实像素） | 24/24 ≥ 4.5:1（最低 4.89:1） | [contrast.json](after/contrast.json) |
| axe（5 个页面 × 浅/深） | 无新增违规；改前改后都存在同一项原有 `label-content-name-mismatch`（全局旅程/命令按钮）。透明背景使 axe 无法判定的对比度项增加，故另做像素采样 | [before](before/checks.json)、[after](after/checks.json) |
| 横向溢出 | 10/10 页面与主题组合 0 横向溢出 | 同上 |
| 第一批需求流程桌面回归（玻璃样式下） | PASS 53 项 | [log](logs/regression-defaults-e2e.txt) |
| `pnpm lint` / `pnpm typecheck` | PASS（24 项原有 warning） | [lint](logs/lint.txt)、[typecheck](logs/typecheck.txt) |
| Impeccable detect（`glass-system.css`） | `[]`（0 项命中） | — |

## 对比截图（同一数据、同一窗口，Electron `capturePage`）

| 页面 | 改前 | 改后（含第二轮去卡片化） |
|---|---|---|
| 项目中心 1440 浅/深 | [before 浅色](before/home-1440-light.png)、[before 深色](before/home-1440-dark.png) | [after 浅色](after/home-1440-light.png)、[after 深色](after/home-1440-dark.png) |
| 项目概览 1440 浅/深 | [before 浅色](before/overview-1440-light.png)、[before 深色](before/overview-1440-dark.png) | [after 浅色](after/overview-1440-light.png)、[after 深色](after/overview-1440-dark.png) |
| 任务看板 1440 浅/深 | [before 浅色](before/tasks-1440-light.png)、[before 深色](before/tasks-1440-dark.png) | [after 浅色](after/tasks-1440-light.png)、[after 深色](after/tasks-1440-dark.png) |
| 需求工作台 1440 浅/深 | [before 浅色](before/requirements-1440-light.png)、[before 深色](before/requirements-1440-dark.png) | [after 浅色](after/requirements-1440-light.png)、[after 深色](after/requirements-1440-dark.png) |
| Agent 协作 1440 浅/深 | [before 浅色](before/agents-1440-light.png)、[before 深色](before/agents-1440-dark.png) | [after 浅色](after/agents-1440-light.png)、[after 深色](after/agents-1440-dark.png) |
| 1024 浅/深 | [before](before/requirements-1024-light.png) | [after 浅色](after/requirements-1024-light.png)、[深色](after/requirements-1024-dark.png) |
| 任务安排弹层 | — | [浅色](after/dialog-arrangement-1440-light.png)、[深色](after/dialog-arrangement-1440-dark.png) |
| 1024 / 125% 应用缩放 / 减少动效 | — | [after](after/requirements-1024-light-125-reduced.png) |

## 设计来源

UI UX Pro Max 本地检索（批量操作、加载反馈、状态不只靠颜色）；Impeccable context/craft-floor/detect（窄范围改造，以现有实现为权威，未杜撰 PRODUCT.md；按其规则把 Unicode 感叹号换为图标）；Design Lab 源码材质配方。Liquid Glass React / Aurora 仍未启用（以前测得约 7–8 fps）。没有专用技能加载工具，以上为直接读取本地技能文件与脚本。

## 未完成与未验证项

1. 其余次级路由页（如 `ProjectHealthPage`、`OperationsPage`、`LifecyclePage`）已自动继承统一玻璃台账带与去框规则，但尚未逐页做专项布局裁剪。
2. 用户主观审美验收、系统级 OS DPI 125%、屏幕阅读器实机朗读、跨 GPU 性能未验证；帧率是粗略 rAF 采样。
3. 未修改被保护的 Design Lab 页面本身（`#/design-lab`）。
4. 第一批遗留的 2 项测试超时（全量并发下 `tests/requirement-integration.test.ts` 单测 30s 超时但单跑 15/15 PASS，以及 `scripts/requirement-integration-e2e.mjs` 审查弹窗长 diff 提示等待超时）按用户选择暂未排查。

---

## Round 4 — 任务看板紧凑重排、6 项交互打磨与豆包风格 3D 拟人动态头像

- **任务看板紧凑化与筛选收纳**（`TaskBoardPage.tsx`、`RequirementJourneyBar.tsx`）：移除内页重复的需求旅程横幅，为顶部全局 `RequirementJourneyBar` 增加 `compact` 紧凑单行模式，将 5 个筛选下拉框折叠至“筛选”玻璃气泡中，使看板泳道占屏比提升至约 65%。
- **6 项全系统交互与导航体验修复**：
  1. 修复 `.pui-overlay-surface` 对 `button.ant-switch` 的样式重置冲突，优化全局开关与按钮过渡曲线。
  2. 为研发工作中心 `...` 弹出菜单统一挂载 `.po-glass-action-menu` 液态玻璃样式。
  3. 统一研发工作中心 `+ 提出需求` 与需求工作台的新建需求弹窗（`?create=1`），消除取消后跳变到空白内联页面的割裂感。
  4. 按真实生命周期执行顺序重排左侧导航栏（`研发工作中心 -> 需求工作台 -> 任务看板 -> Agent 协作 -> 审批 -> 运行审计`，`资源与连接 -> 发布中心 -> 部署中心`）。
  5. 将原底部“项目”分组提炼为常驻顶部项目名称下方的“项目档案与配置”入口（`.po-project-hub-trigger`），点击在右侧弹出二级玻璃菜单（`.po-project-hub-popover`）。
- **豆包 AI 风格 3D 拟人动态头像**（`AgentAvatar3D.tsx`、`agent-portraits-data.ts`）：升级为 52px 高清 3D 拟人半身像，移除外圈旋转光环与脚标遮挡，实现自然眨眼（`po-avatar-eye-blink`）+ 偶尔左右侧目打量（`po-avatar-look-left` / `po-avatar-look-right`）的拟人微表情。
- **保留全部原有高斯模糊与特效 + 代码级防重绘优化**：保留 `--gl-overlay` / `--gl-popup` 半透明渐变与 `backdrop-filter: blur(...)`；对 `RequirementWorkPage` 新建需求弹窗的 `WorkEditor` 下拉选项做 `useMemo` 缓存与 `onValuesChange` 守卫，并在模态框开启时自动暂停底层 `.po-shell` 背景动画（`body:has(.pui-overlay-backdrop) .po-shell * { animation-play-state: paused !important; }`）。
- **验证命令与结果**：
  - `pnpm typecheck`：PASS
  - `pnpm lint`：PASS（0 errors）
  - `pnpm package:dir && pnpm test:package`：PASS（`PACKAGE SMOKE PASS`）
