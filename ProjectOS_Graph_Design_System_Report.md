# ProjectOS V1.6 — 商业级可视化图形设计系统报告

## 1. 审计结果

项目中实际存在两处图形画布，均使用已有的 `@xyflow/react`：

| 位置 | 用途 | 原问题 |
|---|---|---|
| `OrchestrationWorkspace` | 编排工作台：Orchestrator → Agent → Task 的真实执行图 | 节点信息平铺；delegation 边默认虚线；没有上下游聚焦；端口很小 |
| `PlanReviewWorkbench` | 计划审核：任务依赖 DAG | 默认矩形节点；fitView 把节点缩得很小；无边箭头；节点无内部层级 |

没有发现 AntV X6、ELK.js、dagre 或其它图形引擎；本次没有引入新图形依赖。

阶段路线不是 React Flow 画布，是 HTML/CSS 路线卡；它复用同一套表面、描边、字号和风险语言。

## 2. 设计语言

新增统一的 graph 视觉层（`orchestration.css`）：

- 节点：252px 宽、14px 圆角、12/13px 内边距、两级表面（surface / raised）；
- 描边：低对比 `color-mix` 边框，选中才提高对比；
- 节点内部层级：kicker → 标题 → 元信息栏；
- 颜色只表达语义：风险红、Agent 蓝、完成绿；不做全节点彩色；
- 端口：8px 圆点，2px 描边；
- 连线：1.1–1.5px 柔和土色，真实箭头，无默认虚线/发光/动画；
- 状态：Hover、Selected、Related、Dimmed、Risk、Focus 分别有克制样式；
- 动效：180–260ms；`prefers-reduced-motion` 下关闭 transform/transition；
- 设计变量：`--graph-node-width`、`--graph-node-radius`、`--graph-node-pad`，底层复用 `--plan-*` 表面/文字/风险 token。

## 3. 业务节点

已落地：

- **TaskNode**（计划 DAG）：`TASK 01 · 架构` kicker、两行标题、Agent、前置数量、风险 pill、左右端口。
- **AgentNode**（编排画布）：身份、角色、真实执行状态、当前任务、任务/完成数、真实完成比例。
- **OrchestratorNode**：编排者身份、真实状态。
- **StageNode**（阶段路线）：阶段名、任务数、并行标记、风险标记、Hover 摘要。
- **Group 语义**：阶段分组容器与任务分组列表。

没有伪造：
- 计划 DAG 不显示执行进度或时间，因为草稿任务尚未执行；
- Orchestration 只显示后端快照里的真实状态/数量；
- Decision、Milestone、Group 目前没有对应的真实数据源或页面，没有创建只能展示的假节点。

## 4. 连线与布局

### 计划 DAG

- 节点位置 = 最长依赖层级 × 330px，同层按顺序 × 128px；
- 并行任务同层纵向排列，分叉/合流由真实 `dependsOn` 生成；
- 边使用 `smoothstep`，箭头 `MarkerType.ArrowClosed`；
- 选中任务时：
  - 上游/下游节点高亮；
  - 相关边高亮；
  - 无关边淡化到 28%；
- 缺失依赖不画边；循环依赖不画假环，进入风险并阻塞批准；
- 默认 viewport 0.78，保持节点可读；可用 Controls 缩放/平移，Fit View 查看全局；
- 大计划依赖 React Flow 自身视口裁剪与缩放，不使用虚拟列表伪造。

### 编排画布

- delegation 边不再使用虚线；
- 箭头统一；
- 选中节点时相关边高亮、无关边淡化；
- 端口放大到 6px，节点 Hover 轻微上移；
- 保留原有手工布局、保存布局、缩放、平移、MiniMap。

## 5. 交互

- 节点 Hover：1px 上移 + 边框提亮；
- Selected：双层 ring，不发光；
- 点击计划节点打开任务详情 Drawer；
- 阶段点击高亮并滚动到任务列表；
- 视图切换：阶段路线 ↔ 任务依赖；
- 键盘：节点可通过 React Flow 默认 focus 操作，Focus-visible 有 outline；
- 减少动态：系统 `prefers-reduced-motion` 下关闭节点/边动效；
- 任务详情 Drawer 不覆盖底部审批栏（rootStyle 收缩高度）。

## 6. 模板差异

| 场景 | 表达 |
|---|---|
| 计划阶段图 | 横向路线卡，强调阶段、任务数、并行和风险 |
| 任务 DAG | 业务 TaskNode，强调前置关系、Agent、风险 |
| Agent 工作流 | 编排画布：Orchestrator/Agent/Task 分组和真实状态 |
| 层级/时间线 | 当前数据与页面没有真实需求，未新建假页面 |

## 7. 测试

| 测试 | 结果 |
|---|---|
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | **265 passed / 3 skipped** |
| `plan-review-ui-e2e` | **10 checks PASS** |
| `custom-agent-from-plan-ui-e2e` | 3 checks PASS |
| `r2b1-planner-ui-e2e` | 10 checks PASS |
| `V1.8 teamwork` | 7 checks PASS |
| `V1.3 orchestration` | 4-task 完成、5 runs、worktree 合并 |
| `R2.1 UI` | 16 checks PASS |
| `pnpm test:package` | PASS |

截图：
- `test-results/plan-review/plan-review-dag.png`
- `test-results/plan-review/plan-review-overview.png`
- `test-results/plan-review/plan-review-task-detail.png`

## 8. 未完成/边界

1. 没有独立的 Agent 工作流页面、树形层级页或时间线页；现有数据只有编排快照和计划 DAG，没有为了验收新建假图。
2. DecisionNode / MilestoneNode / GroupNode 的视觉原语未实例化；没有真实数据时不显示。
3. 计划 DAG 默认 0.78 视口下 4 节点链会横向超出，需拖动或用 Fit View；这是为了保持节点字号可读，而不是压缩成不可读小字。
4. 大图未做节点聚合/虚拟化；依赖 React Flow 视口裁剪。
5. 任务 Drawer 在更小窗口下可能仍覆盖部分任务列表，底部审批栏保留可见区域。
