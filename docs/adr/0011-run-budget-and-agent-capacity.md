# ADR-0011：Run 硬预算终态、全局 Agent 容量槽与计划节点分配来源

- 状态：已接受
- 日期：2026-10-21
- 关联：R1-A / P0-08B、R1-C / P0-08D、R1-D / P0-07

## 背景

R1 之前，Run 只有 `failed/cancelled` 两种失败终态，无法区分“用户取消”“墙钟超时”“步骤/工具预算耗尽”；
Plan 没有总执行时间上限；同一 Agent 的全局并发只靠 `countActiveRunsForAgent` 计数，检查与占用不在同一事务；
Plan 节点被自动分配 Agent 后，`assignmentReasons` 在批准时会被二次解析改写为“显式指定”，
导致 Scheduler 无法判断用户是否真的显式选人，从而无法做安全的 Handoff 替代。

这些都属于核心契约（Run 状态机、Plan 执行契约、Agent 分配语义），需要先记录决策再实现。

## 决策

1. **新增 Run 终态**：`timed_out`、`budget_exhausted`，并加入 `TERMINAL_RUN_STATUSES` 与状态机。
   - `timed_out`：Run 墙钟或所属 Plan 墙钟到期。
   - `budget_exhausted`：模型轮次或工具调用次数预算耗尽。
   - 取消仍为 `cancelled`；执行错误仍为 `failed`。UI 文案为“超时终止/预算耗尽”。
2. **持久化预算**：迁移 V20 为 `agent_runs` 增加 `deadline_at`、`budget_json`。
   `PlanExecution` 增加 `maxWallClockMs/deadlineAt/budgetExhausted`（计划 JSON，无需 SQL 迁移）。
   重启后按持久化截止时间继续计算，不重新发放预算。
3. **全局 Agent 容量槽**：迁移 V19 新增 `agent_execution_slots`，`agent_id` 主键、
   `fencing_token` 单调递增。检查与占用在同一个 `BEGIN IMMEDIATE` 事务内；
   过期/取消/进程死亡可释放；旧 token 续约失败即停止旧 Run。
4. **委派来源可追踪**：`PlannedTask.assignmentMode = auto | explicit` 持久化在计划 JSON。
   自动分配节点允许 Scheduler 在 Handoff 接收方启动失败且低风险、无权限扩大时自动换人；
   用户显式指定节点必须先写提议、要求确认，确认接口为 `orchestration.reassign`。
5. **启动权不变**：Handoff/替代逻辑只改 Task assignee 与状态，启动仍由统一 Scheduler 的 ready 循环完成。

## 后果

- 旧计划无 `assignmentMode` 时按“有 agentId 即 explicit”处理，属于保守回退，不会静默换人。
- 旧 Run 无预算字段时，恢复时按 `startedAt + 当前配置上限` 推导，并以 Run 已有 tool_result 数补计数。
- 新增终态需要所有“终态判断”使用 `isTerminalRunStatus`；已同步 Runtime 与 UI 文案。
- 失败 Run 仍进入 `needs_reconciliation` 人工核对路径；预算终态不会自动重试。
- 计划因等待替代确认而 `paused`，由用户确认后恢复，不会误判为失败。
