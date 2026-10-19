# ADR-0004：本地持久化邮箱是跨会话权威

- 状态：已接受
- 日期：2026-10-19

## 背景

跨 Agent 会话需要离线持久、唤醒、幂等和审计。外部 OCS 类系统适合跨进程/跨机器桥接，但
如果把它当作 ProjectOS 的权威数据库，会引入外部依赖、双重真相和恢复歧义。

## 决策

- 本地 `agent_inbox` + `messages` + `handoffs` + `outbox` 是权威状态。
- 消息至少一次投递；`project_id + idempotencyKey` 唯一；消费者幂等。
- 状态只表达真实语义：`delivered/accepted/completed/failed/unknown`，不把发送当完成。
- `agent.wake` 是唤醒请求；接收方启动 Run 后才变为 `accepted`。
- 外部 OCS 仅通过 `CrossSessionTransport` Adapter 接入；在核实真实 API 前不实现。
- Handoff 需要显式接受；接收成功不等于任务完成。

## 后果

- 重启、离线、UI 刷新都不丢消息；外部桥接失败不会损坏本地事实。
- 与外部系统之间不承诺 exactly-once；未知结果保留为 `unknown` 并人工核对。
- 需要未来单独实现 OCS 身份映射、LAN 加密与唤醒结果语义。
