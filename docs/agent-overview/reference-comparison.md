# Agent 协作总览 — 参考实现对照与许可证

本文件记录本次 UI 参考了哪些真实开源产品、具体参考了什么、没有采用什么，以及许可证边界。
视觉对照见 `evidence/comparison-sheet.png`。

## 1. 资料包与真实截图

用户资料包 `ProjectOS_Agent_Overview_Visual_References/` 提供了：

- `index.html`：资料索引与对照说明。
- `video_frames/Lancer_7_5s.jpg` 等 4 帧：用户提供的视频布局基准。
- `01_开源项目与真实截图.md`、`02_精确还原规范与数据绑定.md`、`03_交给开发AI的执行提示词.md`。

本地另行拉取了以下真实产品截图用于对照（仅用于分析，不进入产品代码）：

- `eigent-single.png`：Eigent 单 Agent 运行界面。
- `angy-kanban.png` / `angy-graph.png`：Angy 看板与实时执行图。
- `dify-flow.png` / `dify-trace.png`：Dify 工作流与右侧执行追踪。

Eigent 主界面曾尝试从其官网抓取，返回 400；改用官方仓库 README 中的 `eigent-single.png`，不伪造截图。

## 2. 逐项对照

### 2.1 Lancer 7.5s（布局基准）

**观察**：左侧 Agent 卡片按区域分组并带状态；中间协调者与执行计划；右侧成果/交付；底部一条实时活动带；关系线以虚线/流动点表达。

**采用**：

- 保留从左到右的阅读顺序：Agent → 任务 → 成果/审批。
- 保留底部真实活动带，显示事件、相对时间、当前状态与下钻按钮。
- 保留“同一张图内看全协作”的目标。

**调整**：

- 不保留三个固定面板。用户明确要求“整页都是图”，因此三个区域变成同一画布上的节点簇，没有面板边框和独立滚动区。
- 虚线改为低饱和实线 + 真实关系类型（依赖、分配、产物、审批、交接）；只有交接在待处理时使用虚线动画，并在 reduced-motion 下停止。
- Agent 不再按“国内/海外”等无业务依据的区域分组（项目里没有该数据），只按真实状态排序。

### 2.2 Eigent（Agent 运行卡片）

**观察**：单 Agent 任务卡显示 Working on tasks、Progress、Execution Context、Agent Folder；产物按 Run 组织；有 Stop Task 等真实操作。

**采用**：

- Agent 节点显示姓名、角色、当前任务、活动 Run ID、待审批数/完成数。
- 详情抽屉展示当前任务、Run 状态、会话数、完成 Run 数、最近活动，并提供“打开会话/运行审计”。
- 产物详情展示关联任务、Run、URI、hash、Git commit、核验状态与正文快照。

**未采用**：

- 没有复制其品牌、图标、插画、文案或布局像素。
- 没有引入它的任务执行器；ProjectOS 仍复用现有 Planner / Scheduler / AgentRunner / Approval。
- 没有伪造 Stop/Retry 按钮；本页只读，真实操作跳到已有的运行中心/审批路由。

许可证：Eigent 为 Apache-2.0。仅做信息架构与交互参考，未复制源代码。

### 2.3 Angy（实时图与头像堆叠）

**观察**：紧凑的 Agent 头像栈、运行中数量、实时执行图、节点状态色。

**采用**：

- Agent 头像 + 状态 pill + 运行中计数。
- 真实关系图 + 图内筛选（全部/Agent/任务/成果与审批）。
- 活动状态使用短标签（工作中/等待审批/空闲/离线），不只靠颜色。

**未采用**：

- 没有使用其 Logo、头像素材、插画或 Vue 组件代码。
- 没有做“模拟运行动画”；所有状态来自 SQLite 行。

许可证：Angy 为 Apache-2.0。仅参考交互与信息密度。

### 2.4 Dify（执行追踪）

**观察**：右侧 Tracing 面板按节点列出 START / IF/ELSE / LLM / TEMPLATE / END、耗时与成功状态；工作流图与追踪联动。

**采用**：

- 审批/任务详情中的 Run 状态、审批请求参数、真实 ID。
- 关系边按类型区分：任务依赖、Agent 分配、产物、审批、交接。
- 点击边或节点加载详情，而不是把所有信息堆在常驻侧栏。

**未采用**：

- Dify 使用自定义许可证（非 OSI 开源）。本实现**没有复制任何 Dify 代码、样式文件、图标、截图资产或品牌元素**，只参考“图 + 追踪面板”的通用交互模式。
- 没有复制其节点视觉或配色。

## 3. 与现有 ProjectOS 设计系统的关系

- 保留现有 AppShell、GoalJourneyBar、页面路由、命令面板与 Liquid Glass 外壳。
- 页面内部使用 A0 的 Precision token（`.pw-theme`、`@projectos/design-tokens/precision.css`），不修改全局 token，不覆盖 AppShell。
- 字体、间距、状态色沿用 Precision 语义；深色/浅色均由 token 切换。
- 没有把 A0 原型路由或演示数据搬进生产页。

## 4. 真实数据绑定边界

| 视觉 | 真实来源 | 不允许的行为 |
|---|---|---|
| Agent 工作中 | 活动 Run 行（`ACTIVE_RUN_STATUSES`） | 定时器/动画伪造进度 |
| 等待审批 | `approvals.status === 'pending'` | 用静态文案假装审批 |
| 任务状态 | `TaskCard.status` / `blockedBy` | 用计划文本推断完成 |
| 关系线 | `dependencyIds` / `taskId` / `handoff` 行 | 画无数据依据的装饰线 |
| 产物已核验 | `artifact.verifiedAt` | 默认显示“已验证” |
| 交接 | `listHandoffViews` | 用 Agent 对话文本伪造 Handoff |
| 完成度 | 真实 `done` 任务数 / 非取消任务数 | 把 Run 完成当作任务通过 |

## 5. 未使用/未验证的参考

- Sim Studio、Liquid Glass React、React Bits 本轮未引入新效果；它们已在 A0 设计系统评估中记录，不在本页重复使用。
- 未复制任何第三方 Logo、插画、截图或品牌色。
- 参考截图只存在于本地分析目录，已通过 `.gitignore` 排除；产品仓库只保留对照拼图与文字说明。
