---
name: projectos-workflow-design
description: "ProjectOS 工作流/DAG/看板/Agent Team Work/Run 审计的实现规范。用于修改 React Flow DAG、ELK 布局、Plan Review、任务看板拖拽、协作与运行审计时；保护真实拓扑和业务 API，禁止把 DAG 降级为列表。"
tags: [projectos, workflow, dag, react-flow, elk, task-board, agent-team]
metadata:
  version: "1.0.0"
  owner: projectos
  source: docs/AI_TOOL_ROUTING.md
---

# ProjectOS Workflow Design

## 何时使用

- 改工作流 DAG、Plan Review、节点/边、缩放/拖拽/选择、ELK 布局。
- 改任务看板列/卡片/拖拽/筛选/任务详情。
- 改 Agent Team Work、跨会话、Inbox/Handoff、Run 审计。
- 用户说“DAG 重渲染/卡顿/布局不对/审批入口不对”。

## 必读

1. `AGENTS.md`
2. `docs/AI_TOOL_ROUTING.md` R-04 / R-05 / R-06 / R-07
3. `docs/design-system/v1.6-commercial-ui/DESIGN_LAB.md`
4. `docs/next-ui/PLAN_REVIEW_WORKSPACE_MIGRATION.md`
5. `docs/performance/PERFORMANCE_AUDIT.md`（DAG/IPC 部分）
6. 当前实现：
   - `features/orchestration/components/PlanReviewWorkspace.tsx`
   - `features/orchestration/components/PlanReviewNext.tsx`
   - `features/design-lab/TaskGraph.tsx`
   - `pages/TaskBoardPage.tsx`
   - `pages/OrchestrationWorkspace.tsx`

## 输入

- 真实 `PlanDraft`/`tasks`/`dependsOn` 或 API 路径。
- 目标交互（缩放/拖拽/选择/审批/筛选）。
- 当前性能证据（若有）。
- 是否改变业务状态；若改变，列出 API 与验收。

## 执行步骤

1. **确认数据源**：真实 API/preload；禁止用 mock 替代正式业务。
2. **确认组件边界**：
   - 草稿 Plan Review → `PlanReviewWorkspace`（全屏）。
   - 已批准/只读 → `PlanReviewNext`（状态来自真实 `plan.status`）。
   - 正式 DAG 依赖真实 `tasks/dependsOn`；画布不是真相源。
3. **DAG 实现**：
   - React Flow 12 + ELK 0.12；ELK 只在拓扑变化时重算。
   - 缩放/拖拽不要每个 viewport 事件 setState；用 ref/class 或节流。
   - 选择节点只更新必要的 selected/related；避免整页重渲染；memo 需有 profile 依据。
   - 默认边实线；选中静态高亮；无持续流动动画。
4. **Plan Review**：
   - 打开时暂停后台 runtime 事件对 graph/snapshot 的失效风暴；关闭/审批后显式刷新。
   - 批准/拒绝走真实 `onApprove/onReject`；已批准计划不显示审批。
   - 抽屉底部必须有真实计划操作；关闭/滚动/命中区域按 `projectos-ux-audit` 验证。
5. **看板**：保留原生 HTML5 DnD 与真实任务 API；不新增 dnd-kit（未安装/未证明）。
6. **团队/运行**：真实 sessions/handoffs/inbox/runs/tool_calls；不伪造状态。
7. **验证**：E2E + FPS/长任务 + 截图；记录前后数据。

## 关键错误（已验证）

- `PlanReviewNext` 旧 R1 Modal 不是正式方案；不要恢复。
- 已批准计划显示“待批准”是状态硬编码错误；必须读 `draft.status`。
- Plan Review 打开时全量 invalidate 会重复 12–13 次 snapshot/graph 查询。
- `onMove` 每次 setState 会造成无意义更新。
- 将 DAG 改为列表“优化性能”是禁止的。

## 工具依赖

- `@xyflow/react@12.12.0`
- `elkjs@0.12.0`
- TanStack Query 5
- `node scripts/plan-review-workspace-e2e.mjs`（13 checks）
- `node scripts/phase5-pages-e2e.mjs`（48 checks）
- `scripts/perf-benchmark.mjs`（DAG 场景）

## 禁止事项

- 改任务依赖/审批/调度契约；把客户端布局当真相。
- 删除节点交互/依赖边；把 DAG 降级为列表。
- 用 mock/假审批替代真实 API。
- 无 profiling 就大规模 memo/虚拟化/重写。
- 改 Runtime/Planner/Scheduler 只为视觉。

## 验收标准

- [ ] DAG 节点/边与真实数据一致；ELK 布局稳定。
- [ ] 缩放/拖拽/选择连续；无整页无意义重渲染（有 profile 证据）。
- [ ] 草稿审批真实可用；已批准状态正确只读。
- [ ] Plan E2E 13 checks + Phase5 48 checks 通过。
- [ ] DAG FPS 不低于优化后基线（本机 49.5 FPS，±噪声）。
- [ ] 视觉截图（默认/选中/1100/125%）与批准基线一致。
