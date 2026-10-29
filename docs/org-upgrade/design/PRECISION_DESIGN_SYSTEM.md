# Precision Workspace 设计系统（A0 候选基线）

- 状态：A0 候选方向，**尚未替换生产视觉基线**；生产仍是已批准的 Premium Liquid Glass
- 原型入口：`#/precision-lab`（`page-registry` 状态 `DEV_ONLY`，不出现在产品菜单）
- 数据性质：受控演示数据，页面持续标注 `DESIGN PROTOTYPE`；不读 SQLite、不写后端、不启动 Agent
- 真实证据：`docs/org-upgrade/evidence/A0/`（45 项 Electron 检查 + 33 张真实截图）
- 关联：`ADR-ORG-0001-architecture.md`、`reports/A0-report.md`

## 1. 设计方向

Precision Workspace 是“精密工作台”，不是营销页或玻璃拟态演示：

- 中性纸面 + 1px 发丝线组织层级；阴影只用于浮层，不用装饰性模糊/渐变。
- 单一低饱和靛青强调色（`#4F60D4` / 暗色 `#9AA6FF`）；状态永远同时有文字或图标，不只靠颜色。
- 高信息密度但可扫描：13px 正文、12px 辅助信息、等宽数字用于 ID/hash/时间。
- 真实交互：组织切换、筛选、搜索、审批、流程节点编辑、连线、校验、发布版本都改变真实 UI 状态。
- 真实 DAG：React Flow 12 + ELK 分层布局，不是 SVG 假连线。

### 与资料包参考的关系

`reference-ui/precision-workspace.html` 作为构图与操作参考，而非直接复刻。保留其侧栏 + 旅程条 + 密集表格 + 右侧上下文的骨架；
以下差异是**有意的实现决策**：

| 参考中的问题 | 本实现 | 原因 |
|---|---|---|
| 组织选择器 “星海研发中心Enterprise workspace” 两行文字挤在一行（`org-title`/`org-caption` 均 inline） | 两行独立，caption 独立截断 | 参考 HTML 的真实缺陷；商业产品不能保留文字碰撞 |
| 页面标题上方 `星海研发中心 / WORKSPACE` 眉标 | 移除眉标，组织上下文放到面包屑/侧栏 | 眉标是装饰性 kicker，标题本身已足够；减少噪音 |
| 流程图为 6 个绝对定位 div + SVG 曲线（无真实依赖） | React Flow 自定义节点 + ELK layered 布局 + 10 条真实边 + 检查器 | A0 硬性要求真实 DAG；参考图不可作为验收 |
| 4 张独立大 KPI 卡片 | 单面板 4 段指标（1px 分隔） | 降低“Dashboard 空卡”感，提高密度 |
| 演示文字多为 10–11px | 内容字号下限 12px，正文 13px | 资料包排版要求（辅助信息 ≥12px）与仓库 Phase 2.9 下限一致 |
| 横向 2 列假 DAG | 纵向分层 DAG（上→下），支持滚动、缩放、MiniMap | 9 节点顺序流程在 672px 画布内横向会不可读；纵向是真实编辑器的常见选择 |

## 2. Token 层

文件：`packages/design-tokens/src/precision.css`（仅 `.pw-theme` 作用域，不污染生产）。
仪表尺寸：`--pw-rail-width: 236px`、topbar 52、journey 58、status 26、inspector 300。

### 亮色

| 角色 | 值 | 用途 |
|---|---|---|
| canvas | `#F4F6F9` | 应用底色 |
| surface | `#FFFFFF` | 面板/表格/弹层 |
| surface-2 | `#F8FAFC` | 次级底色、表头 |
| surface-3 | `#EEF2F7` | 控件底、弱填充 |
| rail | `#FBFCFE` | 侧栏/检查器 |
| ink / ink-2 | `#18212F` / `#455365` | 主文字 / 正文 |
| muted / faint | `#556274` / `#667386` | 辅助 / 元信息 |
| accent / soft / ink | `#4F60D4` / `#EEF0FE` / `#3745AD` | 主操作 / 选中底 / 强调文字 |
| ok / warn / danger | `#137A63` / `#8D6212` / `#B33C4B` | 状态；均配套 soft 底 |
| line / strong | `#E2E7EE` / `#CFD7E2` | 发丝线 / 控件描边 |

### 暗色

canvas `#0C1119`、surface `#121A25`、rail `#0F1620`、ink `#E9EEF6`、muted `#9AA6B6`、faint `#8A96A7`、
accent `#9AA6FF`、line `#233044`。

### 对比度（sRGB 计算，脚本 `scripts/a0-contrast.mjs`）

| 组合 | 比值 | AA 正文 4.5:1 |
|---|---:|---|
| ink / surface | 16.19:1 | PASS |
| ink-2 / surface | 7.84:1 | PASS |
| muted / surface | 6.20:1 | PASS |
| muted / surface-2 | 5.93:1 | PASS |
| faint / surface | 4.81:1 | PASS |
| faint / surface-2 | 4.60:1 | PASS |
| accent / surface | 5.31:1 | PASS |
| ok on ok-soft | 4.68:1 | PASS |
| warn on warn-soft | 4.91:1 | PASS |
| danger on danger-soft | 5.03:1 | PASS |
| dark ink / surface | 15.02:1 | PASS |
| dark muted / surface | 7.09:1 | PASS |
| dark faint / surface | 5.83:1 | PASS |

状态色没有单独承担语义：徽标同时有 5px 圆点/图标与文字；禁用态同时降透明度并有 `disabled` 语义。

## 3. 排版

- 字体：`Inter, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui`。
  不打包未授权字体；无 Inter 时回退到系统 UI 字体。
- 等宽：`Cascadia Mono / Consolas`，用于 REQ ID、分支、hash、commit、数字与时间；`font-variant-numeric: tabular-nums`。
- 字号：页标题 25px / 需求标题 19px / 面板标题 13px / 正文 13px / 表格 12.5–13px / 辅助 12px；
  **内容区不出现 <12px 的文字**（45 项检查中的 typography audit 实测 tiny=0）。
- 字重：400/500/550/600/650；标题用 600 + 负字距（-0.02em），不用渐变文字或巨型数字。
- 行高：标题 1.2–1.3，正文 1.5–1.7，表格 1.35。

## 4. 间距、圆角、阴影、动效

- 间距：4/6/8/12/16/20/24/32；面板头 11–15，表格行 8–9，表单 10。
- 圆角：面板 12，控件 8，徽标 5，头像/圆点全圆。
- 阴影：`hairline 0 1px 2px rgba(16,24,40,.04)`；浮层 `0 14px 34px -18px`；抽屉左侧大阴影；无玻璃模糊。
- 动效：140–190ms，`cubic-bezier(.22,1,.36,1)`；只用于弹层/抽屉进入、toast、节点选中反馈；
  `prefers-reduced-motion` 下全局近似关闭（CSS 已实现；本轮未在系统设置中实测，见 §12）。

## 5. 组件清单（全部为真实 React 组件）

| 组件 | 文件 | 变体/状态 |
|---|---|---|
| Button / IconButton | `precision/ui.tsx` | primary/ghost/quiet/danger；sm/md；disabled/loading；图标按钮 aria-label |
| Badge / Dot / Avatar | 同上 | accent/ok/warn/danger/neutral；dot 与 icon 两种语义 |
| Surface / PageHeader | 同上 | 标题+副标题+toolbar；页面标题行、动作区 |
| Table | `precision/components.tsx` | 可键盘打开的行、紧凑模式、空态、列在窄屏隐藏 |
| Tabs / Segmented | `ui.tsx` | 键盘左右切换、计数、`aria-selected` |
| SearchInput | 同上 | 顶部全局搜索 + 面板内搜索 |
| Field / Input / Select / Textarea / Toggle | 同上 | 聚焦环、错误态 `aria-invalid`、开关 `role=switch` |
| Empty / Skeleton / Callout / KeyValue / Meter / CopyButton | 同上 | 空态/加载/说明/键值/容量/复制反馈 |
| Popover（组织/账号/通知） | `precision/shell.tsx` | Radix Popover，`Esc` 关闭，主题令牌通过 `.pw-theme` 带入 Portal |
| Dialog / Drawer / CommandPalette | `precision/overlays.tsx` | Radix Dialog；焦点陷阱；侧抽屉；命令面板 ↑↓/Enter/Esc |
| Toast | 同上 | `role=status aria-live=polite`，自动消失 + 手动关闭 |
| DAG 节点 / 检查器 | `precision/workflow/` | React Flow 自定义节点、连线、MiniMap、ELK 布局、节点配置表单 |

## 6. 三张母版与关键交互

### 6.1 组织/项目总览（`screen=overview`）

- 结构：页面标题/动作 → 4 段指标 → 需求表（5 行）→ 我的项目；右侧“需要你处理 / AI 与 Worker 状态”。
- 真实交互：组织切换（数据按组织过滤）、状态筛选、需求行打开工作台、待办打开审批抽屉、创建需求。
- 空态：指标归零、需求空态提供“创建需求”，Worker 运行数归零（不伪造运行中的 Agent）。

### 6.2 需求工作台（`screen=requirement&req=REQ-124`）

- 三栏：需求列表（按“需要你处理/全部”分组、搜索）→ 中心（概览/需求与设计/执行/证据）→ 右侧上下文。
- 概览：目标、范围/验收、阶段与门禁、最近事件；门禁条直接显示内容 hash 与审批角色。
- 文档：需求文档全文 / 设计文档 v1.2（冻结版本、关键决策表、影响面、测试与回滚）。
- 执行：门禁未过时明确显示“被阻塞，不会创建任务/Worktree/Run”；计划草稿 4 阶段 11 任务。
- 证据：证据项、hash、PASS/待执行；明确解释“开发证据为空是门禁行为，不是加载失败”。
- 审批抽屉：审批对象、内容 hash、审批范围、批准/要求修改（修改必须填原因）、审计说明。
- 审批后：门禁状态、旅程、需求状态、事件与 toast 同步更新；不写后端。

### 6.3 流程模板设计器（`screen=workflow`）

- 左：按业务阶段分组的节点库（可点击添加、可拖拽到画布）。
- 中：React Flow 画布 + ELK 分层纵向布局 + 点阵背景 + Controls + MiniMap + 画布工具（整理/适配）。
- 右：节点检查器（标题、类型、角色、输出契约、强制门禁、失败处理、上下游连线、二段式删除）。
- 顶部：版本、草稿/已保存、校验状态；校验真实计算起点数量、交付节点、角色、输出、循环依赖。
- 发布：阻塞时禁用；通过后弹出发布对话框（版本说明、检查清单），确认后版本 2.3 → 2.4 并提示“未写入服务器”。

## 7. 状态矩阵

| 状态 | 表现 |
|---|---|
| hover | 行/按钮/节点边框或底色 140ms 过渡，不位移布局 |
| focus | 2px accent outline + 2px offset；表格行 `outline-offset:-2px` |
| selected | tab 下划线、列表左侧 accent 底、节点外环 3px accent-soft |
| disabled | 50% 透明度 + `disabled`/`aria-disabled`，不隐藏原因（标题/A1 标签说明） |
| loading | 骨架行；空态/错误态均有独立布局 |
| empty | 图标 + 标题 + 说明 + 唯一动作；不显示假数据 |
| error | 顶部内联错误条（ORG_FORBIDDEN 语义）+ 重试；重试后恢复 |
| 权限不足 | 文案说明后端作用域，而不是空白页 |
| 长内容 | 表头/分支/hash 使用等宽与截断 + title；窄屏隐藏次要列 |

## 8. 响应式

- ≥1181px：三栏全展示；概览右栏 296px。
- ≤1180px（1024 及 125% 的 1152 CSS px）：
  - 侧栏 208px；顶栏搜索 142px，隐藏 Ctrl K 提示；
  - 旅程条隐藏非当前阶段文字，只保留圆点 + 当前阶段（不重叠，实测 overflow=0）；
  - 指标 2×2；概览右栏移到下方双列；需求列表隐藏，保留中心 + 280px 检查器；
  - 流程画布 742px，节点库收为 56px 图标列，检查器改为点击节点后的覆盖抽屉；
  - 表格隐藏模板/更新时间列。
- 125%：真实 Electron `setZoomFactor(1.25)`，CSS 视口 1152×720，无横向溢出。

## 9. 可访问性

- 12px 内容字号下限已实测（概览/需求/深色/1024/125% 均 tiny=0）。
- 所有可见按钮有文本或 `aria-label`；45 项检查中 missing=0。
- Radix Dialog 提供焦点陷阱、`Esc`、`aria-modal`；标题 `aria-describedby` 显式处理。
- Tabs 支持方向键；表格行可 `Enter/Space` 打开；命令面板支持 ↑↓/Enter。
- `prefers-reduced-motion` 在 CSS 中关闭动画；本轮只检测媒体查询可用性（系统未开启 → SKIP），未做开启后的截图。
- 颜色对比见 §2；状态不只靠颜色。
- 未做：全量 axe/WCAG 审计、屏幕阅读器实机走查、200% 缩放、键盘全流程（仅覆盖 Tab 焦点、命令面板、审批/发布）。

## 10. 参考来源、采纳与未采纳

| 来源 | 采纳 | 证据/说明 |
|---|---|---|
| 资料包 `design/01` + `reference-ui/precision-workspace.html` | 构图、密度、组织切换、旅程条、三栏需求、检查器 | 逐条对照并修正其缺陷（§1 表） |
| UI UX Pro Max skill | 查询产品/风格/配色/字号建议；采纳“中性+状态色、数据密集可扫描、聚焦可见、12px 下限” | 其返回的 landing page 模式与紫色系调色板被拒绝：与资料包 Precision 方向冲突 |
| Impeccable craft floor | 12px 正文/占位对比、状态齐全、浏览器表面（滚动条/选区/焦点）、禁止眉标 | `reference/craft-floor.md` 已读；眉标被移除 |
| Vercel Composition Patterns / React Best Practices | 组合式 `Surface`/`PageHeader`、variant 而非布尔堆叠；无 forwardRef（React 19） | 组件 API 按此实现 |
| Radix Primitives 1.3.1（MIT） | Dialog / Popover 的焦点、键盘、Portal | 已安装并实际使用 |
| React Flow 12.12（MIT）+ ELK 0.12（EPL-2.0 OR GPL-3.0+） | 真实 DAG、拖拽、缩放、MiniMap、分层布局 | 已安装并实际使用；ELK 通过 `elk.bundled.js` 引入，未修改其源码 |
| Lucide 1.61（ISC） | 统一 1.6–1.7 描边图标 | 已安装并实际使用 |
| Motion 14.6（MIT） | **未在本原型使用**；动效由 CSS transition 实现 | 诚实标注；生产迁移时可再评估 |
| Sim Studio / Liquid Glass React / React Bits | **本轮未检查/未使用** | 属于既有玻璃基线来源；A0 的 Precision 方向不使用玻璃与 Aurora。不得声称已参考 |
| shadcn/ui blocks | 结构参考（sidebar/table） | 未复制代码；仓库已有 Radix/Tailwind/AntD，避免重复引入 |

## 11. 晋升到生产组件的条件

1. 用户批准 Precision 方向后，将 `ui.tsx` 基元迁入 `packages/ui`，token 进入全局层并保留 `.glass-*` 兼容；
2. 用 1–2 个真实页面（非演示数据）做视觉回归与 125%/暗色验收；
3. 删除演示数据与 `DEV_ONLY` 路由，接入真实 IPC/服务端；
4. 在此之前，任何生产页面不得引用 `features/precision`。

## 12. 已知缺口（不得当作已完成）

- 原型数据全部是演示数据，**不是**真实组织/成员/需求；未接 IPC 或服务器。
- 组织/成员/项目 CRUD、真实登录、资产发布、真实 Run 均未实现（A1–A5 范围）。
- 流程“连线”支持拖拽连接，但本轮 E2E 未自动验证拖拽连线；只验证了节点添加、编辑、删除、校验与发布。
- 1024 下流程检查器为覆盖抽屉，未做“点击节点打开/收起”的自动化断言（截图在未选中状态）。
- 未跑 1920 宽、200% 缩放、屏幕阅读器、axe 全量审计。
- Motion 未使用；Sim Studio / Liquid Glass / React Bits 未在本轮核对。
- 品牌字标与状态栏使用 9.5–11px 的 chrome 字号（不属于内容区），如需严格全局面包屑下限需另行确认。

## 13. 证据索引

- 截图：`docs/org-upgrade/evidence/A0/screenshots/`（概览/需求/流程/审批/命令面板/空态/错误/1024/125%/暗色/发布）
- 检查结果：`docs/org-upgrade/evidence/A0/electron-ui-checks.json`（44 PASS / 0 FAIL / 1 SKIP）
- 构建清单：`docs/org-upgrade/evidence/A0/build-manifest.json`
- 采集脚本：`scripts/a0-precision-shots.mjs`（可用 `node scripts/a0-precision-shots.mjs` 重跑）
- 对比度脚本：`scripts/a0-contrast.mjs`
