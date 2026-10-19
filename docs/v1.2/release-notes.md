# ProjectOS V1.2 核心增量 Release Notes

## 新增

- **AI 连接中心**：多连接 CRUD、启停、默认连接、测试、删除。
- **连接诊断**：L1 配置 / L2 可达性 / L3 真实推理；错误分类与建议。
- **模型目录**：OpenAI-compatible `/models` 发现、手动录入、默认模型、能力状态。
- **SecretVault**：按连接 ID 的 safeStorage 加密密钥文件；数据库只存引用。
- **旧配置迁移**：单 Provider 自动迁移为 `Legacy OpenAI-compatible`，幂等。
- **默认连接执行**：默认连接同步现有 ProviderManager，Agent 工具循环无需重写。
- **设置弹层**：AI 连接 / 模型目录 / 通用 / 运行时 / 外部 Agent / 关于，不再打开内页。
- **外部 Agent 检测**：Claude Code / Codex 安装路径与版本（不执行）。
- **侧栏折叠修复**：宽屏显式折叠与窄窗口共用紧凑样式，不再出现竖排文字/错位。
- **文案精简**：主要页面去掉营销式副标题与重复解释。

## 数据库

迁移 v2 新增：

- `ai_connection_profiles`
- `ai_models`
- `ai_connection_checks`
- `ai_usage_records`（预留）
- `agent_backend_bindings`（预留）
- `external_agent_installations`（预留）

## 兼容性

- V1.1 `settings.*` IPC、`provider.json` 和旧数据库继续可用。
- V1.1 Agent E2E、命令 E2E、项目创建/重启 E2E 全部回归。
- 默认连接变更会同步 Runtime Provider；旧配置 Key 迁移到 Vault。

## 未包含

- 角色/项目/任务路由执行。
- Claude Code / Codex 任务执行与授权状态。
- Anthropic / OpenAI Responses 原生协议。
- 费用表、预算审批、用量聚合 UI。
- 安装器、签名、自动更新。

## 升级

1. 备份 `%APPDATA%\ProjectOS`（或自定义 `PROJECTOS_DATA_DIR`）。
2. 安装/替换新版本。
3. 启动后打开设置 → AI 连接；旧配置显示为 `Legacy OpenAI-compatible`。
4. 若旧密钥不可解密，状态显示“未配置密钥”，重新输入即可；不会静默明文保存。
