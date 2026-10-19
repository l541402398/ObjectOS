# ADR-0002：使用 node:sqlite + 类型仓储，而不是 Drizzle ORM

- 状态：已接受（替代设计说明书中的 Drizzle 初选）
- 日期：2026-10-19

## 背景

设计基线选择 SQLite + Drizzle。实际运行环境为 Electron 打包的 Node 24；引入
`better-sqlite3` 需要针对 Electron ABI 重编译，增加 Windows 首装与 CI 失败风险。
Node 24 已内置 `node:sqlite`（`DatabaseSync`），可避免原生 addon。

## 决策

- M1–M4 使用 Node 内置 `node:sqlite`，WAL、FK、busy_timeout、同步事务。
- `packages/persistence` 提供类型化仓储和手写 SQL；读模型集中，避免上层直接拼 SQL。
- 迁移由 `schema_migrations` + checksum 管理；事务内应用。
- 设计说明书的 Drizzle 目标保留为后续可替换实现；`application` 只依赖 Store 端口。

## 后果

- 无原生依赖，开发机与 Electron 内置 Node 都能直接运行。
- 失去 Drizzle 的类型化查询 DSL 与自动迁移生成；通过严格 Row 类型、Zod 输入和测试补偿。
- 若未来引入 Drizzle，应先定义兼容 Store 端口并提交新的 ADR。
