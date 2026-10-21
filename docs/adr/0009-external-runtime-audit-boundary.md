# ADR-0009：外部 Runtime 的审批与审计边界

- 状态：已接受
- 日期：2026-10-21

## 背景

ProjectOS 同时支持三种执行路径：内置 Agent Loop、CLI/ACP Runtime、外部 Agent CLI。
后两者的工具由外部进程执行，ProjectOS 无法可靠地逐工具拦截。此前 ACP
`session/request_permission` 直接按 Agent 权限返回 allow，CLI Runtime 直接 spawn，
外部 Agent 直接写工作区，绕过了 ToolCall、Approval 和 Task Lease。

## 决策

1. **内置 Agent Loop** 继续使用完整的逐工具 ToolCall + Approval + Policy。
2. **ACP Runtime**：
   - `session/request_permission` 必须创建 ProjectOS ToolCall + Approval；
   - Run 进入 `waiting_approval`，用户在 UI 批准后才返回 selected option；
   - 拒绝返回 cancelled；
   - Runtime 重启后未决 ACP 授权标记 `needs_reconciliation`，不自动恢复。
3. **CLI Runtime**：
   - 启动前必须有一次 run 级 Approval；
   - 执行记录一个 `runtime.execute` ToolCall（开始/结束/退出码/输出摘要）；
   - 写模式要求隔离 Worktree；未批准的运行不得 spawn。
4. **外部 Agent CLI**：
   - 记录 `external.<adapter>` run 级 ToolCall；
   - task 级执行必须获取 Task Lease、创建 TaskAttempt，结束/取消时释放；
   - 写模式必须绑定已创建的隔离 Worktree；
   - ProjectOS 不声称能逐工具审计外部 CLI 内部工具；该限制必须在 UI/文档中保持可见。
5. **禁止静默降级**：显式绑定 Runtime 的 Agent 在 Runtime 不可用/不兼容时阻断，
   不得静默改用 Provider；没有 Runtime 绑定的旧 Agent 保留兼容回退。

## 后果

- 所有 ProjectOS 发起的执行至少有 run 级 ToolCall；ACP 有逐权限 Approval。
- CLI/外部 CLI 的内部文件操作仍由外部进程完成，ProjectOS 通过 Worktree、run 级审批、
  输出与 diff 审计降低风险，但不宣称逐工具审计。
- 需要按 ADR-0005 保持 lease-first、fencing 和 `needs_reconciliation` 语义。
