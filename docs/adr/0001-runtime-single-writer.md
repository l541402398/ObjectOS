# ADR-0001：Runtime 单一写者与 stdio 分帧通信

- 状态：已接受
- 日期：2026-10-19

## 背景

Electron Renderer 与 Main 都可能直接访问 Node 能力；若它们写 SQLite，会破坏事务边界、权限和
可恢复性。需要明确的信任边界和唯一业务写者。

## 决策

- Electron Main 只负责窗口、IPC、密钥与 Runtime 监管。
- 独立 Node Runtime 子进程是业务 SQLite 的唯一写者。
- Main ↔ Runtime 使用 NDJSON 帧：`hello`、`request/response`、`event`、`ping/pong`。
- 事件序号单调递增；请求有 id、超时和结构化错误码。
- Runtime 崩溃由 Main 指数退避重启；未知副作用不自动重试。

## 后果

- 进程间需要序列化与协议版本管理；调试需要日志关联 requestId/runId。
- 单写者简化事务与事件序号分配，避免多进程写锁竞争。
- Renderer 无法直接写文件或数据库，所有操作经 Main/Runtime 双重校验。
