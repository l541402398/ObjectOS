# 第二批：统一顶部旅程与资料阅读（ADR-0078）

工作分支 `codex/premium-system`，HEAD `f71d33e8acd70ec579501873c327e5b1180ee02a`，在未提交工作区上增量实施。
未提交、未推送、未合并、未发布。契约见 [ADR-0078](../../../adr/0078-unified-requirement-journey-and-materials.md)。

## 解决了什么问题

| 以前 | 现在 |
|---|---|
| 需求工作台顶部流程节点只统计单一活跃任务，多任务并行推进时用户看不到每个阶段下的任务进度分布 | 需求级顶部流程条聚合所有任务的节点状态（`summarizeParallelStages`），展示 `活跃 / 完成 / 总数` 计数、进行中阶段高亮与任务负责人；单任务聚焦时切换为当前任务节点链 |
| 进入需求后，顶部全局旅程条与需求内流程条重复并存，且离开需求去任务看板/Agent 协作时容易丢掉当前需求与任务上下文 | 项目已有需求时，顶部 `AppLayout` 升级为单条统一需求上下文条（`RequirementJourneyBar`），显示当前需求、流程阶段摘要、活跃任务药丸，以及一键切换 `概览 / 需求与流程 / 任务看板 / Agent 协作 / 资料与交付`；从需求跳转至任务看板或 Agent 协作再点返回（`.po-crumb-back`）可精确回到原需求及原选中任务 |
| 阶段资料弹窗只按节点罗列文档，多任务在同一阶段产出或重试产生多份文档时难以区分归属、有效性及过期原因 | 阶段资料阅读器与 `RequirementMaterials` 完整展示真实溯源元数据（产出任务、阶段、负责 Agent、Run ID、时间、版本号），提供按任务筛选与历史版本折叠开关，并明确区分三种失效/非当前状态：**需重做（Stale）**、**历史版本（Superseded）**、**范围已变（Scope Changed）** |

## 实现要点

1. **契约与 Runtime 溯源投影**（[requirement-flow.ts](../../../../packages/contracts/src/requirement-flow.ts)、[requirement-flow.ts](../../../../apps/runtime/src/requirement-flow.ts)）：
   - `RequirementStageMaterialSchema` 新增溯源字段：`taskTitle`、`agentId`、`agentName`、`version`、`superseded`、`stale`、`staleReason`。
   - Runtime 按 `(taskId, nodeId)` 时间序计算版本号 `v1..vN`，最新记录标记 `superseded = false`，同任务同节点旧记录标记 `superseded = true`。
   - 当上游阶段重跑或关联文档/需求范围（`scopeRevision`）变更导致下游阶段被置为 `stale`（`upstream_updated`）时，下游阶段已产出的材料同步投影 `stale = true` 与具体原因（如 `前序阶段已更新，当前阶段需重新核对`）。
   - `RequirementFlowService.retry()` 支持直接重跑 `stale` 节点或其上游源节点（`affected.has(step.nodeId) && step.stale`）。
2. **统一顶部需求上下文条**（[RequirementJourneyBar.tsx](../../../../apps/desktop/src/renderer/src/components/RequirementJourneyBar.tsx)、[AppLayout.tsx](../../../../apps/desktop/src/renderer/src/components/AppLayout.tsx)）：
   - 当项目存在需求时，`AppLayout` 渲染统一的 `RequirementJourneyBar`，自动同步并持久化 `activeRequirementId` 与 `selectedTaskId`（[ui.ts](../../../../apps/desktop/src/renderer/src/stores/ui.ts)）。
   - `route-readiness.ts` 预加载当前项目的需求列表与绑定流程，消除切页闪烁。
3. **阶段资料阅读器与多版本/过期治理**（[RequirementWorkPage.tsx](../../../../apps/desktop/src/renderer/src/pages/RequirementWorkPage.tsx)、[RequirementMaterials.tsx](../../../../apps/desktop/src/renderer/src/pages/RequirementMaterials.tsx)）：
   - 需求工作台内取消顶部重复的 `项目全部资料` 入口，保留阶段内 `阶段资料 (N)` 抽屉与顶部统一 `资料与交付` 视图。
   - 阶段资料弹窗顶部提供 `全部任务 (N)` / 各任务过滤切换，以及 `显示历史版本 (N)` 显隐开关；选中版本自动拉取最新 `artifacts` 内容，并在右侧正文区顶部展示完整溯源头与过期/历史版本告警。

## 检查记录（本次实际运行）

| 命令 | 结果 | 输出 |
|---|---|---|
| `pnpm lint` | PASS（0 error） | 依赖边界与 ESLint 通过 |
| `pnpm typecheck` | PASS（0 error） | 全仓 TypeScript 类型检查通过 |
| `npx vitest run tests/requirement-journey-materials.test.ts tests/requirement-flow.test.ts tests/requirement-defaults-start.test.ts` | PASS（23/23） | 单测覆盖多任务并行阶段聚合、材料版本演进、上游变更致下游 `stale` 及重跑恢复 |
| `pnpm build` | PASS | `build:runtime`、`build:desktop`、`build:server` 通过 |
| `node scripts/requirement-journey-materials-e2e.mjs` | **PASS（37/37 项检查，14 张真实桌面截图）** | [checks.json](desktop/checks.json) |

## 真实桌面截图（Electron `capturePage`）

- **多任务并行阶段聚合**：[需求工作台多任务流程条 1440 浅色](desktop/requirements-multi-task-journey-1440-light.png)
- **跨视图统一顶部需求上下文条**：
  - [概览页 1440 浅色](desktop/unified-journey-overview-1440-light.png)
  - [任务看板 1440 浅色](desktop/unified-journey-tasks-1440-light.png)
  - [Agent 协作 1440 浅色](desktop/unified-journey-agents-1440-light.png)
- **阶段资料溯源与任务筛选**：
  - [阶段资料溯源详情 1440 浅色](desktop/stage-materials-provenance-1440-light.png)
  - [按未产出任务筛选空状态 1440 浅色](desktop/stage-materials-task-filter-empty-1440-light.png)
  - [未开始阶段独立空状态 1440 浅色](desktop/stage-materials-empty-isolated-1440-light.png)
- **上游变更致下游 `需重做 (Stale)` vs 重试产生 `历史版本 (Superseded)`**：
  - [下游审查阶段标记需重做 1440 浅色](desktop/stage-materials-stale-review-1440-light.png)
  - [重跑后 v2 当前版本与 v1 历史版本对照 1440 浅色](desktop/stage-materials-superseded-vs-current-1440-light.png)
- **多视口、深浅主题与无障碍缩放矩阵**：
  - [1440 浅色](desktop/tasks-journey-1440-light.png)、[1440 深色](desktop/tasks-journey-1440-dark.png)
  - [1024 浅色](desktop/tasks-journey-1024-light.png)、[1024 深色](desktop/tasks-journey-1024-dark.png)
  - [1024 深色 125% 缩放 + 减少动效](desktop/tasks-journey-1024-dark-125-reduced.png)

## 未完成与未验证

1. 第三至五批（外部 CLI 流程、已准备工作区追基线、整体验收收口）尚未开始。
2. 用户主观视觉验收、系统级 OS 125% DPI、屏幕阅读器实机朗读未验证。
