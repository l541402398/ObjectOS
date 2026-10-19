# V1.2 现状审计与最小改动计划

日期：2026-10-19  
范围：`ProjectOS_V1.2.1_Design.md` 对 V1.1 代码的增量审计。  
原则：先复用现有稳定模块；不新建与 `provider-interfaces`、`agent-runtime`、`persistence` 重复的抽象。

> 本文记录**开工前**的真实状态；本期已实现部分见 `docs/v1.2/acceptance-report.md`。

## 1. 现有实现（代码证据）

| 能力 | 代码位置 | 实际状态 |
|---|---|---|
| 单 Provider 配置 | `apps/desktop/src/main/provider-config.ts` | 只有一份 `provider.json`；Base URL/模型/温度/加密 API Key |
| 密钥保护 | `provider-config.ts` + Electron `safeStorage` | Key 只在 Main 解密，经 stdio 配置给 Runtime；不进入 SQLite/Renderer |
| Provider IPC | `apps/desktop/src/main/ipc.ts` (`settings.*`, `provider.*`) | 保存、清除、测试；Runtime 不可用时返回错误 |
| Runtime Provider | `apps/runtime/src/provider-manager.ts` | 单例配置；只支持 `openai-compatible` |
| 流式实现 | `packages/provider-openai-compatible/src/index.ts` | SSE 文本、tool calls、usage；测试请求为最小 chat completion |
| Agent 循环 | `apps/runtime/src/agent-runner.ts` | 流式、工具、审批、恢复、取消；运行开始时从 ProviderManager 创建 Provider |
| 数据库 | `packages/persistence/src/migrations.ts` | 只有 v1 生命周期 schema；没有 AI 连接/模型/检查/用量表 |
| 合约 | `packages/contracts/src/api.ts`, `entities.ts` | 只有单 `ProviderInfo` / `ProviderTestResult`；没有连接与模型类型 |
| 设置 UI | `apps/desktop/src/renderer/src/pages/SettingsPage.tsx` | 独立路由 `/settings` 内页，单 Provider 表单 + 外观 + Runtime/安全 |
| 侧栏折叠 | `packages/ui/src/styles.css`, `apps/desktop/src/renderer/src/styles/app.css` | 宽度变量会切到 76px；但显式折叠时文本隐藏仅由 `max-width:1179px` 媒体查询控制 |
| 测试 | `tests/provider.test.ts`, `tests/agent-loop.test.ts`, `scripts/agent-e2e.mjs`, `scripts/command-e2e.mjs` | 真实流式/审批/命令闭环有验证；无多连接测试 |

## 2. 与 V1.2 需求的差距

| V1.2 需求 | 状态 | 差距 |
|---|---|---|
| 多 AI 连接档案 | 未实现 | 只有单配置；无 CRUD、默认连接、启停 |
| 连接测试分层/错误分类 | 部分 | 只有一次 chat completion；错误为文本，未分类 HTTP/网络/模型 |
| 模型目录 | 未实现 | 无 `/models` 发现、手动模型、能力状态 |
| SecretVault | 部分 | 只有单 Key 的 safeStorage 文件；无按连接 ID 的引用 |
| 旧配置迁移 | 未实现 | 没有迁移为默认连接 |
| 原生执行闭环 | 已实现 | 流式/工具/审批/取消/恢复均有；但只使用单默认 Provider |
| 外部 Agent | 未实现 | 无 CLI 检测/执行 |
| 路由 | 未实现 | 无角色/项目/任务绑定 |
| 用量/费用 | 部分 | Run 有 input/output tokens；无 usage 明细/费用/未知标记 |
| 连接中心 UI | 未实现 | 设置是内页；无连接列表/模型目录/诊断 |
| 文案去解释化 | 部分 | 现有页面有较多说明性副标题 |
| 侧栏折叠 | 有缺陷 | 显式折叠时项目切换器和文本未隐藏，导致窄侧栏内换行错位 |

## 3. 本期最小兼容实现（P0 核心）

按“先契约与迁移、再后端、再 UI”的顺序：

1. **SQLite v2**
   - `ai_connection_profiles`
   - `ai_models`
   - `ai_connection_checks`
   - 后续预留 `ai_usage_records` / `agent_backend_bindings`（本期只建表，不伪造路由/费用）
2. **SecretVault（Main）**
   - `ConnectionSecretStore`：按连接 ID 加密保存/读取/删除；safeStorage 不可用时明确报错，不退化明文。
   - 旧 `provider.json` Key 在首次迁移时复制到 Vault，旧配置保留为兼容回退。
3. **多连接服务（Runtime）**
   - Profile CRUD、启停、默认唯一、模型 CRUD、检查记录。
   - 旧配置迁移为 `Legacy OpenAI-compatible`（幂等）。
   - 默认连接同步到现有 `ProviderManager`，因此 AgentRunner 不需要重写。
4. **连接测试与模型发现**
   - L1 URL/字段；L2 `/models` 可达性；L3 最小 chat completion。
   - 错误分类：INVALID_KEY / INSUFFICIENT_QUOTA / RATE_LIMITED / MODEL_NOT_FOUND / PROTOCOL_MISMATCH / TLS_ERROR / PROXY_ERROR / TIMEOUT / NETWORK_UNREACHABLE / UNKNOWN。
   - `/models` 成功不当作推理成功；L3 单独判定。
5. **设置弹层**
   - 全局 Modal：AI 连接 / 模型目录 / 通用 / 运行时 / 外部 Agent / 关于。
   - 连接 CRUD、测试、默认、模型发现、手动模型；密钥始终遮挡。
6. **Agent 工作台**
   - 展示当前默认连接/模型；运行时仍使用默认连接。
7. **UI 修复**
   - 显式折叠与窗口窄屏共用一套折叠样式，项目切换器/品牌文字/底部文字全部隐藏。
   - 页面级冗余说明文案清理。
8. **外部 Agent**
   - 只做安装/版本检测（Claude Code、Codex），不实现执行；UI 明确标注“仅检测”。
9. **验收**
   - 新增 Vitest：迁移/CRUD/默认唯一/模型/错误分类。
   - 扩展 Electron E2E/打包冒烟：设置弹层创建连接、测试连接（mock）、默认同步、侧栏折叠截图。

## 4. 明确不做（本期）

- Claude Code/Codex 任务执行（只检测）。
- 按 Agent 角色/项目的后端路由绑定执行。
- 费用表、预算审批、真实账单。
- Anthropic/OpenAI Responses 原生协议；本期只执行 OpenAI-compatible。
- 外部 OCS adapter、MCP 扩展。

## 5. 兼容与回滚

- V1.1 `settings.*` API 保留；旧 Agent E2E 仍可运行。
- 迁移 v2 只新增表，不修改 v1 表；checksum 机制不变。
- 默认连接同步失败时保留旧 Provider 配置，不影响已有 Agent 运行。
- 删除默认连接时优先选择其他启用连接；没有候选则清空 Provider 配置，不静默运行。
