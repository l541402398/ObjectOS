# 跨 Agent 会话协议

## 目标

- 同一项目中的独立 Agent 会话可以持久化地互发消息、唤醒和交接。
- 消息先落盘，再唤醒；发送成功不等于接收方已读，更不等于任务完成。
- 断线、重启或接收方离线时不丢消息；消费者幂等。
- 当前实现为本地应用内协议；外部 OCS 仅作为可选 Adapter，不作为权威存储。

## Envelope

```ts
interface CrossSessionEnvelope<T = unknown> {
  protocol: 'projectos.cross-session'
  version: 1
  messageId: string
  idempotencyKey: string
  projectId: string
  taskId?: string
  runId?: string
  sender: { agentId: string; sessionId: string }
  recipient: { agentId: string; sessionId?: string }
  type:
    | 'agent.message' | 'task.delegate' | 'task.accept' | 'task.result'
    | 'task.reject' | 'handoff.request' | 'handoff.accept'
    | 'agent.wake' | 'approval.request'
  correlationId?: string
  causationId?: string
  sequence?: number
  createdAt: string
  expiresAt?: string
  payload: T
}
```

`payload.body` 是用户可见正文；其余字段由调用方扩展。所有 Envelope 经 Zod 校验，过期消息拒绝。

## 投递状态

| 状态 | 含义 | 不是 |
|---|---|---|
| `delivered` | 已写入接收方持久化收件箱 | 不是已读 |
| `accepted` | 接收方 Agent 已被唤醒/已开始处理 | 不是完成 |
| `completed` | 对应 Run 完成 | 不代表任务验收通过 |
| `failed` | 唤醒/运行失败 | 消息仍可由人工重试 |
| `unknown` | 外部副作用结果未知 | 不应自动重发 |

本实现使用 `agent_inbox` 的 `project_id + idempotency_key` 唯一约束去重；重复投递返回原条目，
不重复写入消息。消息同时作为一条接收会话消息出现，便于 Agent 上下文与 UI 展示。

## 唤醒

1. `inbox.send` 先持久化消息与收件箱条目。
2. 若 `wake=true` 且 Provider 已配置、接收会话空闲，则启动一次 Run。
3. Run 启动后条目变为 `accepted`；Run 终止时变为 `completed` 或 `failed`。
4. Provider 未配置时保持 `delivered`，UI 可稍后“唤醒”；不会伪造 Agent 回复。

唤醒是至少一次语义：如果进程在启动 Run 前崩溃，重启后可以手动恢复；不会因为重启自动执行
未知副作用。

## Handoff

Handoff 是把任务上下文结构化交接给另一个 Agent：

- `requested`：包含任务、来源 Agent/会话、摘要和 payload。
- `accepted`：创建/选择接收会话，更新任务责任人，写入系统消息与事件。
- `rejected`：保留记录，不改变责任人。
- 接收成功不等于任务完成；任务仍需验收。

## 外部 Adapter

`packages/collaboration` 定义了 `CrossSessionTransport` 接口。未来接入
`leeguooooo/open-cross-session` 时：

- 只通过 Adapter 传输入/出 Envelope；本地 `agent_inbox` 仍是 ProjectOS 的权威。
- 明确外部会话身份映射、认证、LAN 加密（Ed25519/X25519/AES-GCM）与 wake 结果。
- 不把 OCS 的 JSONL 日志当作 ProjectOS 数据库。
- 目前**未接入**，因为不能凭空假设其真实 API/版本；需要先核对仓库与协议。

## 不变量

- 不向自身发送消息。
- 发送/接收会话必须属于同一项目。
- `agent.wake` 不代表任务完成。
- 同一 Task 最多一个有效 Lease；旧 fencing token 不能提交。
- 消息正文与状态都持久化；聊天记录不是真相。
