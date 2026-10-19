# V1.2 迁移报告

## 1. 数据库迁移

新增迁移 `v2: ai connections and model catalog`，只新增表，不修改 V1 表：

- `ai_connection_profiles`：连接元数据，部分唯一索引保证全局最多一个 `is_default=1`
- `ai_models`：`UNIQUE(connection_id, model_id)`
- `ai_connection_checks`：L1–L3 检查记录，最多保留每连接 100 条
- `ai_usage_records`：预留用量表（本期未写入）
- `agent_backend_bindings`：预留路由表（本期未启用）
- `external_agent_installations`：预留外部 Agent 检测表（本期检测结果不落库）

迁移由 `schema_migrations` + SHA-256 checksum 管理；已有 V1 数据库启动时自动应用 v2，失败会回滚该迁移事务。

## 2. 旧版单 Provider 迁移

旧配置源：`electron userData/data/provider.json`（字段 baseUrl/model/temperature/encryptedApiKey）。

流程：

1. Main 启动后 `app.bootstrap` 调用 `ensureLegacyConnection()`。
2. 若连接表非空 → 标记迁移完成，不重复创建。
3. 若连接表为空且存在旧 provider 配置或环境变量 Key → 创建 `Legacy OpenAI-compatible`，设为默认。
4. 旧 Key 写入 `ai-secrets.vault.json`（safeStorage 加密），连接表只写 `secret_ref = vault:<id>`。
5. 通过新连接同步 ProviderManager；旧 `provider.json` 继续保存一份加密配置用于 V1.1 API 兼容。
6. 迁移标记 `connectionsMigrated` 写入 `provider.json`；用户清空全部连接后不会再次自动重建旧连接。

## 3. 密钥边界

- 密钥不进入 Renderer、SQLite、日志、项目目录。
- 只有 `ConnectionSecretStore` 解密；测试请求时通过私有 stdio 传给 Runtime 内存。
- `safeStorage` 不可用时保存新密钥会返回 `SECRET_STORAGE_UNAVAILABLE`，不静默退化为明文。
- 迁移验证：扫描 `projectos.db`、`ai-secrets.vault.json`、日志，未发现测试 Key 明文。

## 4. 回滚

- 应用回滚到 V1.1：旧 `provider.json` 仍保留，V1.1 的 `settings.*` IPC 保留；新增表不影响旧读路径。
- 数据库回滚：删除 v2 新增表并移除 `schema_migrations` 的 version 2 行；V1 表与数据未变。
- 密钥回滚：`ai-secrets.vault.json` 可保留；V1.1 使用 `provider.json` 的加密 Key。
- 不提供自动删除用户连接的迁移；删除需显式操作。

## 5. 已验证

- 旧环境变量 Provider 配置在首次启动后生成默认连接；`hasSecret=true`；数据库/JSON/日志无 Key 明文。
- 连接、模型、默认值、密钥在应用重启后恢复。
- V1.1 `settings.update` 仍能驱动 Agent E2E，未破坏旧回归。

## 6. 未验证

- 从真实 V1.1 生产数据库升级的故障注入（迁移中断、磁盘满）。
- 多版本连续升级（v1→v2→未来 v3）。
- safeStorage 不可用的真实企业策略环境（只做了代码路径与错误返回）。
