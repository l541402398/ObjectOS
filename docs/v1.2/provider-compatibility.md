# V1.2 Provider 兼容性

## 1. 本期实际支持

| 服务 | 协议 | 连接测试 | 模型发现 | Agent 执行 |
|---|---|---|---|---|
| OpenAI | `openai-chat` | L1/L2/L3 | `GET /models` | 支持 |
| DeepSeek | `openai-chat` | L1/L2/L3 | `GET /models` | 支持 |
| 任意 OpenAI-compatible | `openai-chat` | L1/L2/L3 | 支持则同步，不支持可手动录入 | 支持 |
| Anthropic 原生 | `anthropic-messages` | 未实现 | 未实现 | 未实现 |
| OpenAI Responses | `openai-responses` | 未实现 | 未实现 | 未实现 |
| Claude Code CLI | `external-cli` | 仅安装/版本检测 | — | 未实现 |
| Codex CLI | `external-cli` | 仅安装/版本检测 | — | 未实现 |

UI 的“新增连接”目前只允许保存可执行的 `openai-chat` 连接；不使用假协议欺骗用户。

## 2. 测试分层

- **L1**：名称、Base URL、协议、默认模型、密钥是否存在。URL 只允许 http/https，拒绝 URL 内嵌账号密码，拒绝云元数据地址（169.254.169.254、metadata.google.internal 等）。
- **L2**：`GET {baseUrl}/models` 带 Bearer Token。401/403 → INVALID_KEY；404/405 视为“服务可达但未提供模型列表”，继续 L3；其他错误按状态分类。
- **L3**：`POST {baseUrl}/chat/completions`，`max_tokens: 8`，验证真实推理响应格式；不把 `/models` 成功当作推理成功。
- **L4**：工具调用能力探测未自动执行；现有 Agent 循环在真实运行时验证工具调用，能力目录保守显示“未知”。

## 3. 错误分类

| 错误 | 典型来源 |
|---|---|
| `INVALID_KEY` | HTTP 401/403 |
| `INSUFFICIENT_QUOTA` | HTTP 402 |
| `RATE_LIMITED` | HTTP 429 |
| `MODEL_NOT_FOUND` | HTTP 404 或模型不存在 |
| `PROTOCOL_MISMATCH` | HTTP 400/405/422，或响应不是 chat completion |
| `TLS_ERROR` | 证书/SSL 错误 |
| `PROXY_ERROR` | 代理/隧道错误 |
| `TIMEOUT` | AbortController 超时或超时错误 |
| `NETWORK_UNREACHABLE` | DNS、拒绝连接、网络不可达 |
| `UNKNOWN` | 其他 |

日志与 UI 展示的诊断消息对 `sk-*`、Bearer、api_key 等做脱敏；请求头与完整请求体不落库。

## 4. 已知限制

- 未实现代理配置档案（系统代理由 Electron/Node 环境继承）。
- 未实现自定义 CA、双向 TLS。
- 未实现 Anthropic Messages / OpenAI Responses 原生适配。
- 模型能力来自“未知/手动/部分发现”，不猜测 context window 与工具能力。
- 外部 CLI 只检测安装路径和 `--version`，不执行任务，不读取凭据，不判断订阅权益。
- 真实第三方 API 未在本地测试中调用；E2E 使用本地 OpenAI-compatible fake server，验证协议与执行路径。
