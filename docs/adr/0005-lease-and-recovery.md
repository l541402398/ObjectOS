# ADR-0005：Task Lease fencing 与未知副作用不自动重试

- 状态：已接受
- 日期：2026-10-19

## 背景

同一任务可能被多个 Agent/Run 争抢；崩溃恢复时，工具可能已经产生外部副作用但结果未落盘。

## 决策

- `task_leases` 每任务最多一行；`fencing_token` 单调递增。
- 释放租约不删除行，只把 `expires_at=0`，防止 token 回退。
- 获取者必须在有效期内、且 holder 不同则拒绝；续约/释放校验 holder + token。
- Run 在工具执行前写 ToolCall 意图与 argsHash/idempotencyKey，执行后写结果。
- 崩溃后：
  - `waiting_approval` 保留可恢复；
  - `running/waiting_tool` 进入 `needs_reconciliation`，任务置为 `blocked`；
  - 不自动重试未知副作用。
- 无副作用或明确幂等的工具可以安全重试（当前尚未实现自动重试器）。

## 后果

- 不会出现两个执行者同时提交同一任务；旧 token 无法“复活”。
- 恢复需要人工核对，牺牲全自动恢复换取不重复执行危险操作。
- 数据库可能保留过期租约行，但逻辑上已失效；清理是后续维护任务。
