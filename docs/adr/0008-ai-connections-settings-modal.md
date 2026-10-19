# ADR-0008：多 AI 连接、SecretVault 与设置弹层

- 状态：已接受
- 日期：2026-10-19

## 背景

V1.1 只有单 Provider JSON 配置与独立设置页。V1.2 需要多连接、模型目录、连接诊断、默认连接
执行，同时保持 Main/Runtime 隔离和密钥安全。设置页作为路由内页也会打断当前工作上下文。

## 决策

- 连接元数据、模型、检查记录写入 Runtime 的 SQLite（迁移 v2）；密钥只写入 Main 的
  `ConnectionSecretStore`（safeStorage 加密文件），SQLite 只存 `secret_ref`。
- Main 负责连接编排与 Secret：CRUD 元数据通过内部 `runtime.ai.registry`；测试/发现通过
  `runtime.ai.probe` / `runtime.ai.discover`，密钥只在内存与私有 stdio 中出现。
- 默认连接由 Main 同步给既有 `ProviderManager`，避免为多连接重写 Agent 循环；Agent 运行
  仍然只有一个活动执行配置。
- 旧 `provider.json` 幂等迁移为默认连接，并在迁移后镜像旧配置以保持 V1.1 API 兼容。
- 设置改为全局 Modal（AI 连接 / 模型目录 / 通用 / 运行时 / 外部 Agent / 关于），点击侧栏
  设置不改变路由。
- 外部 CLI 只检测安装与版本，不执行、不读凭据。

## 后果

- 多连接不会污染 Renderer；密钥不进入 SQLite/Renderer/日志。
- Agent 运行暂不支持按角色路由；所有 Agent 使用默认连接，路由留待后续。
- Main 需要额外编排与同步；失败时保留旧配置，不破坏已有运行。
- 设置弹层保持当前页面上下文；深链接 `/settings` 重定向到项目中心（不再有内页）。
