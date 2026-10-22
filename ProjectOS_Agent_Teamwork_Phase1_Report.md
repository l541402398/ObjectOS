# ProjectOS Agent Teamwork — 第一阶段整改报告

> 基线：`phase1-baseline-a9cba63`（HEAD `a9cba63`，`fix(runtime): enforce execution audit, leases and run snapshots`）
> 实现提交：`4964770` `feat(teamwork): serialize group turns, agent tasks and assignments`（分支 `feature/v1.6-ux`）
> 范围：只修 Teamwork 执行基础（群聊回合、同 Agent 并发、最小自动分配、回归测试）。未做全系统 UI 重设计，未新建重复业务页面。
> 安全：未删除历史任务、未重置数据库、未绕过审批、未扩大 Agent 权限；所有 E2E 使用本地假模型 + 临时数据目录。

---

## 1. 修改文件列表与核心代码说明

| 文件 | 类型 | 核心改动 |
|---|---|---|
| `packages/planning/src/assignment.ts` | 新增 | 纯函数 `resolveAgentAssignment`：显式指定优先；未指定时按角色默认、能力、分类、Skill、Runtime 可用性、当前负载打分；归档/缺 Skill/Runtime 不可用直接拒绝；无候选返回 `blocked` + 原因 + 被拒列表。 |
| `packages/planning/src/index.ts` | 修改 | 导出 resolver；生成计划节点补齐 `assignmentReasons` / `assignmentBlocked` 默认值。 |
| `apps/runtime/src/orchestration.ts` | 修改 | 从现有 Agent Registry / Skill / RuntimeProfile / 活跃 Run / Task 构建候选；`assignPlanAgents` 在生成、编辑、修订、批准时解析；批准时严格校验（Runtime 不可用/Agent 归档/无候选会阻断并给出原因）；计划群聊只纳入已分配节点；候选负载包含 `needs_reconciliation`。 |
| `apps/runtime/src/agent-runner.ts` | 修改 | 新增 `awaitRunTerminal(runId, {timeoutMs,pollMs})`：等待 Run 到 `completed/failed/cancelled/needs_reconciliation`；超时会调用 `cancel()`，返回 `{run,timedOut}`，保证不留下忙 Session。 |
| `apps/runtime/src/dispatcher.ts` | 修改 | 群聊改为可靠回合队列：`groupDiscussions` 防重复；按 `planGroupTitle` 精确找群（保留前缀兼容）；逐 Agent `startRun → awaitRunTerminal`；处理超时/取消/失败/`needs_reconciliation`；检查可见回复；追加 `group-summary` 系统消息（真实 `succeeded/failed/cancelled/skipped` + 每 Agent 结果）；`plan.discuss` 返回 `{groupSessionId,participants,status:'started'}`，不再返回虚假 `queued`。 |
| `apps/runtime/src/orchestrator.ts` | 修改 | 新增 `selectStartableTasks`：每个 tick 每个 Agent 最多启动一个 ready 任务（同 Agent 串行排队）；启动失败只把该任务 `blocked` + 记录错误，不再整计划立刻 `failed`；增加“无可继续任务”终止条件，并识别重试退避中的任务（`hasPendingRetry`），避免误杀重试。 |
| `packages/contracts/src/orchestration.ts` | 修改 | `PlannedTask` 增加 `assignmentReasons`、`assignmentBlocked`（plan JSON 持久化，旧计划由读模型补默认）。 |
| `packages/contracts/src/api.ts` | 修改 | `plan.discuss` 输出改为 `{groupSessionId,participants,status}`；真实成功/失败统计由群聊 summary 消息承载。 |
| `packages/persistence/src/rows.ts` | 修改 | `toPlanRevision` 为旧 plan JSON 补 `assignmentReasons/assignmentBlocked` 默认值，避免历史计划 undefined。 |
| `apps/desktop/src/renderer/src/pages/AgentWorkbenchPage.tsx` | 修改 | 群聊发起提示改为真实的 `participants` 数，并说明“完成后显示成功/失败统计”。 |
| `apps/desktop/src/renderer/src/features/orchestration/pages/OrchestrationWorkspace.tsx` | 修改 | 计划节点显示“自动分配/手动指定/待分配”标签与分配原因；用户改选 Agent 时写入 `用户手动指定`；新增节点补齐字段。 |
| `tests/assignment-resolver.test.ts` | 新增 | 显式优先、角色默认/能力匹配、Skill+负载、归档/Runtime/Skill 拒绝、显式不可用阻断、确定性。 |
| `tests/orchestrator-selection.test.ts` | 新增 | 同 Agent 只选一个、不同 Agent 并行、活跃 Agent 跳过、槽位/无 assignee 处理。 |
| `tests/group-discussion.test.ts` | 新增 | 4 Agent 全部发言且真实 4/0；重复讨论被拒；超时取消且群 Session 不忙。 |
| `tests/agent-runner-guards.test.ts` | 修改 | 新增 `awaitRunTerminal` 超时取消、已完成立即返回。 |
| `scripts/v18-teamwork-e2e.mjs` | 新增 | Electron E2E：群聊 4/0、同 Agent 串行、不同 Agent 并行 + DAG 门禁、Runtime 不可用阻断。 |
| `package.json` | 修改 | 新增 `test:teamwork` 脚本。 |

**没有新增第二套 Agent Registry / Orchestrator / Task 系统。** 新代码复用现有的 `agents`、`agent_runtime_bindings`、`runtime_profiles`、`skills`、`tasks`、`task_dependencies`、`OrchestrationScheduler`、`AgentRunner`。

---

## 2. 修复前后对比

| 场景 | 修复前（实测） | 修复后（实测） |
|---|---|---|
| 4 Agent 群聊 | `plan.discuss` 返回 `queued=4`；最终 `assistant=1`、`failed turns=3`；Kai/Nova/Iris 收到「该会话已有运行中的 Agent」；群聊只有 Sage 一条 Run | 返回 `{participants:4,status:'started'}`；4 条 assistant、4 个不同 Agent；summary `succeeded=4 failed=0`；无 Session 互斥错误；4 条 Run 全部 `completed` |
| 同一 Agent 两个并行 ready 任务 | 计划立即 `failed`，错误「该会话已有运行中的 Agent」；`A=running`、`B=ready`；1 条 Run | 计划 `completed`；A、B 都 `done`；2 条 Run 都 `completed`；B 在 A 释放 Session 后由下一 tick 启动 |
| 不同 Agent 并行 + DAG | 原有能力可用 | 回归通过：两 Run 重叠约 750–806ms；依赖任务在两个前置都完成后才启动 |
| 未指定 Agent | 角色硬编码/手工选择；无原因记录；无候选时可能静默跳过 | 按角色默认、能力、分类、Skill、Runtime、负载打分；显式选择保留；无候选/不可用标记 `assignmentBlocked` 并给出原因；批准时阻断 |
| 启动失败 | 单个任务启动异常 → 整个计划 `failed` 并 disarm | 该任务 `blocked` + 记录原因；取消可能残留的运行；其他分支继续；只有确实无可继续任务才失败 |
| 重试退避 | 原有重试可用 | 保持可用；新增的“无进展”保护最初会误杀退避中的任务，已通过 `hasPendingRetry` 修正，并用 V1.3 E2E 回归 |
| `plan.discuss` 返回值 | `queued = agents.length`（虚假） | `participants` + `status`；真实统计在 `group-summary` 消息中 |
| 旧计划兼容 | `PlannedTask` 无分配字段 | 读模型为旧 plan JSON 补默认 `[]/false`；旧计划仍按角色默认执行 |

---

## 3. 实际测试命令与结果

### 3.1 静态与单元测试

```text
pnpm lint       → PASS（eslint + dependency boundaries）
pnpm typecheck  → PASS
pnpm test       → 30 files / 145 tests PASS
pnpm build      → PASS（runtime + desktop）
```

> 说明：在一次与 V1.4 Electron E2E 并发运行的 `pnpm test` 中出现过 1 个失败（输出只保留了末尾，未记录失败用例名）；随后单独重跑 `30 files / 145 tests` 全部通过，未复现。最终结果以单独重跑为准。

新增/覆盖的测试：

```text
tests/assignment-resolver.test.ts       6 tests
tests/orchestrator-selection.test.ts    4 tests
tests/group-discussion.test.ts          2 tests（4 Agent 成功 + 超时取消）
tests/agent-runner-guards.test.ts       +2 tests（awaitRunTerminal 超时/已完成）
```

### 3.2 新 Teamwork E2E（本地假模型，无真实凭据）

```text
pnpm test:teamwork
→ V1.8 TEAMWORK E2E PASS — 7 checks, 9 provider requests

PASS  group chat starts with truthful participants — {"participants":4,"status":"started"}
PASS  four Agents speak and summary reports 4/0 — succeeded=4 failed=0 assistant=4
PASS  no Agent turn was rejected by the session mutex — clean transcript
PASS  same-Agent tasks serialize without failing the plan — status=completed tasks=done,done runs=completed,completed
PASS  different-Agent tasks overlap and the dependent task waits — overlapMs=806
PASS  missing Runtime is detected as unavailable — status=unavailable
PASS  unavailable Runtime blocks approval and creates no done task — done=0
```

### 3.3 V1.3 / V1.4 回归

```text
node .tmp/v13-orchestration-e2e-isolated.mjs
→ V1.3 ORCHESTRATION E2E PASS
  4-task plan auto-executed to done
  5 runs / retry 1 / quality reports 2
  worktree created and merged

node .tmp/v14-e2e-isolated.mjs
→ V1.4 E2E PASS
  health checks create evidence-backed findings
  proposals approve and survive restart
  mode: propose
```

`scripts/v13-orchestration-e2e.mjs` 原脚本未直接运行：本机已有打包版 ProjectOS 持有单实例锁，脚本未传 `--user-data-dir`；使用仅增加 `--user-data-dir` 的隔离副本跑通，断言未改。

### 3.4 未运行 / 未验证

- 真实付费模型 / 真实 DSH、OpenCode、Claude Code 的群聊与 DAG 连续执行（需要真实凭据/已认证 CLI；本轮按要求未使用）。
- `pnpm test:package` / 打包 EXE smoke：源码构建与 E2E 通过，但当前运行的打包产物仍未重建。
- 全量 UI 截图/视觉回归（本阶段不做 UI 重设计）。
- 真实 ACP/CLI 群聊回合中的“等待审批”路径：代码会在超时后取消该回合，但没有群聊专用审批 UI 的 E2E。

---

## 4. 仍然缺失的 Teamwork 能力

1. **自动交接**：`handoff` 仍需要人工接受，接受后不自动启动接收方；没有自动“失败换人/重分配”。
2. **上游产物传递**：下游任务不会自动拿到上游 Artifact/diff/测试报告；仍主要依赖共享 Worktree 文件系统。
3. **智能规划**：Planner 仍是 `local-rules` 固定 4 节点模板；没有模型生成、计划批判/重规划。
4. **计划级权限策略**：逐工具审批仍会让无人值守计划停在第一次写盘；`PlannedTask.requiresApproval` 仍未消费；没有“批准计划内写操作”的策略。
5. **质量门禁严格性**：无脚本时 `skipped` 仍可能被算作通过；reviewer/architect/custom 任务仍无独立质量校验。
6. **恢复闭环**：`needs_reconciliation` 仍没有 `run.reconcile` API/UI；计划会暂停，需要人工取消运行后 resume。
7. **计划修订**：新 revision 仍会创建一套新 Task，旧 Task 不 supersede。
8. **Agent 级并发**：同 Agent 串行只覆盖“同一计划”；两个计划仍可同时用同一个 Agent（不同 Session）。
9. **分配范围/历史**：候选来自当前 Agent 列表，未按项目可见性过滤；分配原因保存在 plan JSON，未单独建历史表；没有“任务级能力要求”字段。
10. **群聊自治**：仍需用户发起第一轮；没有 Agent 主动定期发起群聊；群聊仍是单 Session 顺序发言，不是独立执行实例。

---

## 5. 下一阶段集成建议

### Phase 2A：自动交接 + 上游产物（优先）

- 扩展 handoff payload：`completed[] / remaining[] / risks[] / artifacts[] / upstreamRunIds[]`，复用 `buildTaskHandoffSummary`。
- 接受策略：`manual`（默认）/ `auto`（低风险自动接受并启动接收方 Run）；高风险仍人工。
- 在 `buildContext` 中注入直接前置任务的 Artifact（diff/test-report/design）+ 最近 Run summary，按现有上下文预算截断。
- 给 Agent 增加 `list_agents` / `list_sessions` 工具，解决“有 handoff_task 但找不到目标 Session”的实际不可达问题。

### Phase 2B：智能规划 + 计划级权限

- 新增 provider-backed Planner（`generatedBy: 'provider'`），保留 `local-rules` 回退；Schema 校验 + 失败回退。
- 计划审批时展示“将执行哪些写操作/命令”，提供计划级授权；仍保留逐工具审批作为高风险兜底。
- 消费 `PlannedTask.requiresApproval`：节点级审批或自动批准策略。
- 计划修订 supersede 旧 Task（取消或标记 superseded），避免双套任务。

### Phase 2C：质量与恢复

- 质量门禁 strict：`skipped` 不算 pass；reviewer/custom 至少要求审查/测试 Artifact；reviewer 结论未落 Artifact 不允许自动 done。
- `run.reconcile` + UI；计划 resume 支持“核对后继续/放弃”。
- 全局 per-Agent 并发限制/队列；跨计划同 Agent 排队。
- 重新构建打包产物，纳入 v14/v15 迁移与本阶段修复；运行 `pnpm test:package`。

### 建议顺序

1. 自动交接 + `list_agents/list_sessions`（解决 Agent 实际无法委派）。
2. 上游 Artifact 注入（解决下游看不到上游成果）。
3. 计划级权限 + `requiresApproval`（解决自动执行被逐工具审批阻断）。
4. 模型 Planner + 计划修订 supersede。
5. 质量门禁 strict、reconcile、全局并发、打包一致性。

---

## 6. 安全与可恢复性

- 基线分支：`phase1-baseline-a9cba63`；实现提交：`4964770`。
- 本轮未重置数据库、未删除历史任务、未绕过审批、未扩大 Agent 权限；E2E 使用临时数据目录 + 本地假模型。
- 审计期间另一会话曾并发修改工作区；本轮开始前已确认其提交 `a9cba63`，并基于该干净基线实现。当前工作区仅剩审计报告与临时文件未跟踪。
