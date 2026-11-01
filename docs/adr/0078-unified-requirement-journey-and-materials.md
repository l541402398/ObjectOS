# ADR-0078: 统一需求流程旅程与资料阅读（多任务聚合、并行节点与过期审核区分）

- 状态：Accepted
- 日期：2026-10-31
- 关联：`docs/v2/PROJECTOS_HANDOFF_2026-10-30.md`（第二批）、ADR-0076、ADR-0077

## 背景

在移除 UC 并确立“需求 → 任务 → 流程节点及负责 Agent”主线后，界面仍存在三项割裂：

1. **顶部旅程并存且不互通**：`RequirementWorkPage` 内嵌了需求流程条 `.rq-flow-journey`，而概览、任务看板、Agent 协作画布仍只展示旧的固定九阶段 `GoalJourneyBar`，跨页时丢失当前所选需求上下文。
2. **多任务与并行节点的阶段状态过度简化**：同一需求下的多个任务同时处于同一阶段或并行分支时，阶段按钮仅显示简单的“正在进行”或“已完成”，且任务列表只取首个匹配步骤，无法如实反映同阶段的进行中、待审核、待授权、失败、已过期与未开始数量，也无法在阶段弹窗内按任务筛选资料。
3. **资料详情缺少完整溯源与过期审核区分**：`RequirementMaterial` 仅返回标题、Agent 名称、执行次数和基础状态，缺少所属需求/任务名称、流程节点、运行记录入口（`runId`）及对应审核结论；当需求文档或前置产物被更新后，依据旧内容通过的审核仍显示为“当前版本”，未与重试替换产生的“废弃版本（`superseded`）”区分。

## 决策

### 1. 同一时刻只显示一种主旅程条，跨页携带所选需求上下文

- 在 `useUiStore` 中按 `projectId` 记录当前选中的需求 `selectedRequirementByProject[projectId]`，并与路由查询参数 `?requirement=<id>` 双向同步（仅当该需求属于当前 `projectId` 时生效）。
- 顶栏子头部（`AppShell.subheader`）通过 `TopJourneyBar` 决策：
  - 当项目存在已绑定流程的需求时，在项目概览（`overview` / `home` / `work`）、任务看板（`tasks`）、Agent 协作（`agents`）、运行审计（`runs`）等页面显示统一的需求流程旅程条 `RequirementJourneyBar`，复用同一套阶段轨迹 `RequirementJourneyTrack` 与资料弹窗 `RequirementMaterials`。
  - 在需求工作台（`requirements`）内，由工作区直接渲染同一 `RequirementJourneyTrack`，顶栏不重复渲染子头部，确保页面中始终只有一个主旅程条。
  - 当项目仅使用旧计划流程（无绑定流程的需求）或用户显式切换至目标视图时，保留 `GoalJourneyBar` 兼容。

### 2. 多任务阶段聚合与并行节点真实表达

- 阶段状态完全由持久化的 `TaskFlow` 与 `RequirementFlowStep` 聚合计算，绝不从画布坐标推断：
  - 统计每个流程节点在当前需求全部任务下的真实数量：`completed`（有效完成且未过期）、`running`（启动中/执行中）、`waitingApproval`（待授权）、`waitingReview`（审核节点待执行/执行中）、`failed`（失败/待核对）、`stale`（文档或范围更新后已过期）、`notStarted`（未开始）。
  - **禁止以单个任务完成冒充阶段全部完成**：仅当 `total > 0 && completed === total` 时，阶段节点才标记为 `is-complete`（`✓`）；部分完成标记为 `is-partial` 并展示真实分母（如 `已完成 1/3`）。
  - **保留并行节点的全部进行中事实**：当流程 DAG 存在并行分支或多个任务处于不同活跃节点时，旅程头部与任务行同时列出所有活跃节点，不强行用单一阶段序号解释所有状态。

### 3. 资料详情完整溯源与“废弃版本 (`superseded`)” / “已过期失效 (`stale`)”区分

- 扩展 `RequirementMaterialSchema` 与 `RequirementFlowStepSchema`（向后兼容默认值）：
  - `RequirementMaterial` 包含：`requirementTitle`、`taskTitle`、`nodeId`、`stepTitle`、`agentId`、`agentName`、`runId`、`attempt`、`status`（`'draft' | 'current' | 'superseded' | 'rejected' | 'stale'`）、`statusReason`、`reviewVerdict`（`'approved' | 'rejected' | 'pending' | 'stale' | null`）、`reviewNote`、`reviewedByAgentName`、`reviewedAt`。
  - **废弃版本 (`superseded`)**：当节点显式重试（`requirement.flow.retry`）产生新一轮执行时，旧版本产物在数据库中标记为 `superseded`，表示已被新版本替代的历史记录。
  - **已过期失效 (`stale`)**：当已完成节点的 `input_json` 中记录的 `scope`（含 `requirement.version`、任务范围）或前置输入文档哈希（`documents[i].hash`）与当前持久化状态不一致时，运行时将其投影为 `stale`（且关联审核结论标记为 `reviewVerdict: 'stale'`），明确提示“关联文档或需求范围已更新，旧审核结论已失效”，并允许对该过期节点直接发起重试。
- `RequirementMaterials` 支持按任务筛选资料（展示该需求下每个任务在当前阶段的状态与文档），并在切换项目、切换需求或深链接（`?requirement=...&stage=...&task=...`）时按 `${projectId}:${requirementId}:${stageNodeId}` 隔离状态与过滤数据，绝不读取前一项目或前一需求的缓存资料。

## 后果

- 概览、任务看板、需求工作台与 Agent 协作画布共享一致的需求流程进度与资料阅读体验。
- 多任务与并行分支下的阶段状态、任务筛选、文档正文、审核结论与运行记录跳转均可由真实持久化数据直接验证。
