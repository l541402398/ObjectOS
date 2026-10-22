# ProjectOS V1.6 — AI 计划审核台重构报告

## 1. 审计结论

原计划审核是一个高密度编辑器：

- `PlanDraft.tasks` 全部展开，验收/产物/能力/依赖/Agent 全部内联；
- 没有阶段或依赖可视化；
- 生成来源、耗时、上下文、纠错历史与任务内容混在一起；
- 底部审批按钮跟随内容滚动，弹窗可以顶满整个屏幕；
- 任务详情与任务列表没有层级分离。

本次保留原有数据和真实审批接口，只重构信息层级与交互。

## 2. 新组件结构

| 文件 | 作用 |
|---|---|
| `apps/desktop/src/renderer/src/features/orchestration/components/PlanReviewWorkbench.tsx` | 审核台：概览、阶段路线、任务依赖 DAG、风险摘要、精简任务列表、任务详情 Drawer |
| `.../components/plan-review-logic.ts` | 纯数据逻辑：依赖层级、阶段、循环/缺失依赖、阻塞判断 |
| `.../pages/OrchestrationWorkspace.tsx` | 接入审核台；保留原有批准、拒绝、修订、授权、执行控制；底部审批栏使用 Modal footer |
| `.../pages/orchestration.css` | 审核台、阶段卡、DAG、精简任务行、Drawer、固定底栏、响应式与浅深主题 |
| `apps/desktop/src/renderer/src/components/AgentStudioModal.tsx` | 计划任务选择“自定义”时真正打开 Agent Studio；创建后回填 |
| `tests/plan-review.test.ts` | 单任务/多阶段/并行/无依赖/循环/缺失依赖/阻塞判断 |
| `scripts/plan-review-ui-e2e.mjs` | 真实 Electron UI：概览、阶段、DAG、风险、详情编辑、批准创建任务、弹窗高度 |
| `scripts/custom-agent-from-plan-ui-e2e.mjs` | 从计划任务打开并创建自定义 Agent，再回填 |

## 3. 数据映射

### 阶段

不引入伪阶段字段。阶段由真实依赖计算：

1. 对每个任务沿 `dependsOn` 求最长拓扑层级；
2. 同一层的任务归入同一阶段（真实可并行）；
3. 阶段标题来自该层任务的真实 `role`：
   - 单角色：`架构阶段/开发阶段/审查阶段/测试阶段/自定义阶段`；
   - 混合角色：`阶段 N`；
4. 无依赖的计划只有一个阶段，不伪造多阶段；
5. 阶段数量、任务数量、风险标记均来自实际任务。

### DAG

- 一个节点 = `PlanDraft.tasks` 中的一个真实任务；
- 一条有向边 = `task.dependsOn` 中真实存在的依赖；
- 缺失依赖不画假边，进入风险列表并阻塞批准；
- 循环依赖由 DFS 检测，进入风险列表并阻塞批准；
- 选中节点高亮直接前置/下游；
- 使用项目已有 `@xyflow/react`，支持缩放、平移、fitView；
- 大量任务使用层级横向布局，节点不伪造执行状态。

### 风险

- **阻塞**：`assignmentBlocked`、缺失依赖、循环依赖；底部批准按钮禁用并显示原因提示。
- **非阻塞提醒**：`draft.risks`（模型给出的计划级风险）；只显示在风险摘要中，不会禁用批准。
- **历史异常**：`draft.generation.warnings`、纠错次数、耗时、上下文来源全部收进「生成详情」，默认折叠。
- 风险列表中的任务级风险可点击定位并打开任务详情；计划级风险明确标注“计划级”，不伪装成任务。

### 编辑与审批

- 任务详情 Drawer 保留并可编辑：
  - 名称、描述、任务类型/角色；
  - Agent 分配、自定义 Agent；
  - 前置依赖；
  - 验收标准、预期交付物；
  - 能力需求、硬性能力；
  - 执行前人工审批；
  - 删除任务。
- 所有修改只改本地 draft；点击「批准并创建任务」时仍调用原有：
  - `plans.update`
  - `plans.approve`
- 依赖/能力/Agent 校验仍由原有后端执行；前端只对确定的阻塞问题禁用按钮。
- 拒绝仍调用 `plans.reject`。
- 审批后 PlanGrant / Replan / 执行控制原样保留在审核台下方。

## 4. 交互与视觉

- 顶部概览约一屏 15%，包含目标、任务数、阶段数、风险数、版本；生成详情折叠。
- 中部阶段路线/任务依赖切换；阶段卡片支持 hover 摘要、点击高亮并滚动到任务组。
- 任务列表默认只显示序号、标题、Agent 简称、风险/前置数量；点击打开 Drawer。
- 底部审批栏为 Modal footer，固定可见；审核弹窗最大高度 760px，不再从顶到底铺满。
- 任务 Drawer 设置较高 z-index，位于审核弹窗之上；不覆盖底部审批栏高度区域。
- 沿用 Liquid Glass、低饱和色、细边框、柔和阴影；风险色只用于真实风险。
- 支持宽屏、窄屏，阶段区域横向滚动，DAG 自适应缩放。

## 5. 保留的原有业务功能

- 计划生成（AI / 本地规则）、生成来源标识、失败提示、改用本地规则；
- 计划编辑、添加/删除任务、依赖编辑、能力编辑；
- Agent 自动分配/硬能力匹配；
- 计划批准、拒绝、修订为新版本；
- PlanGrant 签发/撤销/开始/恢复；
- Replan 提案、应用、拒绝；
- Run/Task/Artifact/Worktree/Diff/合并/取消；
- 自定义 Agent Studio；
- 已有主题、设置、托盘等。

## 6. 实际测试

| 测试 | 结果 |
|---|---|
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | **265 passed / 3 skipped** |
| `plan-review-ui-e2e` | **10 checks PASS** |
| `custom-agent-from-plan-ui-e2e` | **3 checks PASS** |
| `r2b1-planner-ui-e2e` | **10 checks PASS**（已适配新审核台） |
| `r2b1` 截图 | 浅色/深色/失败/本地回退 |
| `V1.8 teamwork` | 7 checks PASS |
| `V1.3 orchestration` | 4-task 完成，5 runs，worktree 合并 |
| `R2.1 UI regression` | 16 checks PASS |
| `pnpm test:package` | PASS |

关键 UI 证据：

- `test-results/plan-review/plan-review-overview.png`
- `test-results/plan-review/plan-review-dag.png`
- `test-results/plan-review/plan-review-risks.png`
- `test-results/plan-review/plan-review-task-detail.png`
- `test-results/plan-review/plan-review-final.png`
- `test-results/custom-agent-plan/custom-agent-from-plan.png`
- `test-results/custom-agent-plan/custom-agent-assigned.png`

## 7. 未完成/明确边界

1. **自然语言局部调整未实现**：当前后端只有 `plans.revise`（整份计划修订）和 `plans.update`（结构化编辑），没有“按自然语言局部修改并保留用户编辑”的接口。没有做只能展示、不能真正执行的假 AI 调整。
2. **已有 V1.7 通知 E2E**：`scripts/v17-plan-notification-e2e.mjs` 仍等待旧的 `.ant-notification-notice`，当前审批成功只发 message；该脚本未作为本轮通过项。审批创建任务本身由 `plan-review-ui-e2e` 验证。
3. **循环/缺失依赖 UI**：逻辑单测覆盖；正常保存的计划通常已被后端校验，未构造真实损坏计划做 E2E。
4. **任务 Drawer 遮挡**：Drawer 高度已收缩到审批栏上方；更小的窗口下仍需关闭 Drawer 后操作底部按钮。
5. **大计划 DAG 的可读性**：fitView 后节点文本会缩小，可缩放/平移查看；没有做节点聚合。

## 8. 结论

审核台现在优先回答“目标是什么、分几个阶段、哪里要复核”，任务细节进入 Drawer，依赖关系进入 DAG。审批仍走真实计划接口，未破坏 Agent 路由、计划校验、授权与执行链路。

不进入 Phase 2B-4；不做 Agent 路由恢复。
