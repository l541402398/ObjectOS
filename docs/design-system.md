# 设计系统与 UI 验收

> 2026-10-30：当前基线为用户再次确认的 Design Lab DAG，见 `docs/design/system-premium/REPORT.md`、ADR-0070/0071。
> 新界面的主观视觉验收仍由用户确认。以下尺寸与令牌已同步至本轮实现。

> ProjectOS 的视觉目标是“现代极简、层次清晰、克制玻璃拟态的专业工作台”，不是套用
> Ant Design 默认主题。所有页面必须使用 `packages/design-tokens` 与 `packages/ui`。

## 1. 页面结构

- 顶部 58px 轻量标题栏：拖拽区域、面包屑、命令面板、Runtime 状态、主题、窗口控制。
- 左侧 228px 可展开导航（默认及窄窗口 60px 图标栏），仅在侧栏、顶栏、悬浮/弹层使用玻璃材质。
- 中央内容区：不透明卡片与代码/表格/终端表面。
- 右侧检查器：按需展开对象详情，窄窗口使用同一浮动面板，不删除功能。
- 底部状态栏：项目路径、Git 分支/变更、阶段、Runtime、端口安全提示。

## 2. 令牌

来源：`packages/design-tokens/src/index.ts`、`tokens.css` 与统一兼容层 `unified.css`。

- Light canvas `#EFF4FC`，surface `#F4F7FD`，accent `#4F64D9`；空间背景使用批准稿的紫蓝/青色静态光学层，阅读面与弹层使用轻微冷色渐层。
- Dark 使用 `unified.css` 的同一语义层，保留冷色光学空间与清晰工作面。
- 控件 36px / 10px 圆角；内容面 14–18px、浮层 20–22px、工作区 28px。间距以 4px 为基准。
- 字体依据用户后续反馈统一为本地 Noto Sans SC 可变字体；26px 页标题、24px 目标标题、16px 段落标题、14px 正文、13px 辅助和 12px 标签。代码中文亦显式回退至该字体。保持批准 Lab 的构图与材质方向。
- Light/Dark 由 `data-theme` 驱动；`reduceTransparency` / `reduceMotion` 写入根节点属性，
  并提供 `prefers-reduced-transparency`、`prefers-reduced-motion`、`forced-colors` 回退。
- 玻璃仅用于 `AppShell` 侧栏、顶栏、检查器、弹层；编辑区、表格、终端保持高对比实体背景。

## 3. 组件

`packages/ui`：AppShell、SidebarNavigation、PageHeader、SectionCard、MetricCard、StatusPill、
AgentAvatar、ProgressBar、EmptyState、ErrorState、LoadingBlock、InspectorPanel、KeyValueList。

`packages/ai-ui`：Ant Design X Bubble.List、Sender、Prompts、ThoughtChain 封装；ToolTrace、
ApprovalCard、RichText（安全 Markdown 子集）。

规则：

- 页面不得散落玻璃 CSS、硬编码品牌色或独立阴影；新增样式优先使用 CSS variables。
- 所有交互状态：hover、focus-visible、active、disabled、loading、empty、error。
- 大段代码、Diff、终端使用等宽字体和稳定背景；不在玻璃上放长表格。
- 动效尊重实时减少动效设置；用户明确要求的协作关系流向脉冲有暂停控制并限定数量，计划 DAG 本身不循环流动。
- 键盘可达；焦点清晰；窗口控制与命令面板可见。

## 4. 页面清单

| 路由 | 页面 | 真实数据 |
|---|---|---|
| `/` | 项目中心 | 项目、统计、近期活动、创建/加载示例 |
| `/projects/:id` | 研发工作中心 | 当前目标、工作模式、下一步、任务与运行；直接提出需求 |
| `/projects/:id/tasks` | 任务看板 | 拖拽、筛选、DAG、验收、运行/交付物/审批 |
| `/projects/:id/orchestration` | 编排工作台 | React Flow 图、Agent/任务节点、Inspector、布局保存 |
| `/projects/:id/agents` | Agent 协作图 | 真实 Agent/任务/成果连线，按需打开上下文、审批与运行检查器；无聊天式内页 |
| `/projects/:id/collaboration` | 跨会话中心 | 收件箱状态、唤醒、交接、Agent 阵容 |
| `/projects/:id/workspace` | 工作区 | 文件树、Monaco、Git diff、只读终端 |
| `/projects/:id/runs` | 运行审计 | 运行表、步骤、工具、审批、事件流 |
| 全局弹层 | 设置 | AI 连接、模型目录、通用、运行时、外部 Agent、关于 |

设置使用全局 Modal（`features/settings/SettingsModal.tsx`），点击侧栏“设置”不改变路由。
左侧 188px 分类导航 + 右侧滚动内容；1024px 下最大宽度 `100vw-40px`，高度 `100vh-72px`。
AI 连接卡片展示状态、默认标记、模型数、密钥状态与测试结果；密钥永远不回显。

## 5. 响应式与截图验收

至少检查：

- 1440×900 三栏：侧栏 + 内容 + 检查器。
- 1024×768：侧栏折叠、检查器隐藏、看板横向滚动但页面无横向溢出。
- Light / Dark 两套主题。
- 关键页面无布局溢出、错位、低对比；Toast 不遮挡主操作。

自动检查（`scripts/screenshots.mjs`）：

- 每张截图检查 `document.documentElement.scrollWidth <= innerWidth + 1`。
- 截图文件小于 8KB 视为空白失败。
- 截图保存为 `docs/screenshots/{width}x{height}-{theme}-{page}.png`。

实际生成（示例）：

- `1440x900-light-project-center.png`
- `1440x900-light-overview.png`
- `1440x900-light-tasks.png`
- `1440x900-light-knowledge.png`
- `1440x900-light-orchestration.png`
- `1440x900-dark-orchestration.png`
- `1440x900-dark-agent-workbench.png`
- `1440x900-light-cross-session.png`
- `1440x900-light-workspace.png`
- `1440x900-light-runs.png`
- `1440x900-light-settings.png`
- `1440x900-light-settings-connection-editor.png`
- `1440x900-dark-settings.png`
- `1440x900-light-settings-models.png`
- `1440x900-light-settings-routing.png`
- `1440x900-light-sidebar-collapsed.png`
- `1440x900-dark-sidebar-collapsed.png`
- `1024x768-light-orchestration.png`
- `1024x768-dark-orchestration.png`
- `1024x768-light-settings.png`
- `1024x768-dark-settings.png`
- `1024x768-light-sidebar-collapsed.png`
- `1024x768-light-overview.png`
- `1024x768-dark-tasks.png`

共 43 张；`scripts/screenshots.mjs` 自动检查空白与横向溢出。

## 6. 已知视觉取舍

- 1024px 下侧栏强制折叠为图标，避免内容被挤压；标签通过原生 title 提供提示。
- 宽屏显式折叠与窄窗口共用 `is-collapsed` 紧凑样式；项目切换器文字、品牌文字、分组标题、
  底部状态文字全部隐藏，宽度 76px，不产生竖排/横向溢出。
- 任务看板在 1024px 保持 5 列横向滚动，而非压缩卡片导致不可读。
- 设置弹层在 1024px 使用 `calc(100vw - 40px)`，实测 982×696，四周 21/36px 留白。
- 连接新增/编辑是设置内容区子视图（`.po-ai-editor`），不出现第二层 Modal 遮罩。
- 编排工作台 1440px 为画布 + 320px Inspector；1024px Inspector 下移，画布保留缩放/平移与 MiniMap。
  图节点使用状态色 + 文案双重编码，依赖实线、委派虚线。
- 示例项目使用明确“示例数据”标签；真实功能不依赖示例数据。





