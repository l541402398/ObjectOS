# ProjectOS V1.2 — AI 连接与多 Agent 执行能力增强实施设计说明书

> 版本：1.2.0 ｜ 类型：V1.1 增量开发规范 ｜ 状态：待实施 ｜ 适用：AI 编程 Agent、工程开发者、测试人员

## 0. 使用方式与执行优先级

本文件是 V1.1 的增量规范，不替代 V1.1 的核心架构与 UI 规范。开发 Agent 必须先读取 V1.1、仓库实际代码、数据库迁移和现有测试，生成 `docs/v1.2/baseline-audit.md`，明确“已实现 / 部分实现 / 未实现 / 无法确认”。禁止仅依据截图推断 API 已经可用。已有功能优先复用和升级，禁止为了匹配本文件而重构已稳定运行的模块。

**实施顺序**：现状审计 → 契约与迁移 → 多连接管理 → 模型发现与能力管理 → 原生模型执行闭环 → 外部 Agent 适配 → 路由与故障诊断 → 用量统计 → 端到端验收。

**完成定义**：UI 可配置、配置可持久化、连接可验证、实际任务可运行、异常可诊断、关闭重启可恢复，且旧版配置可迁移。任何功能不能仅凭界面存在判定完成。

## 1. 现有基础与增量边界

根据 V1.1 页面截图，已有“本地运行时与偏好”页面、OpenAI-compatible Base URL、模型 ID、API Key、Temperature、保存配置、测试连接按钮，以及 Runtime 健康信息。截图不能证明后端功能均已通过测试。

### 1.1 必须保留

- Electron Main / Preload / Renderer 隔离与现有类型化 IPC。
- 独立 Node.js Runtime、SQLite、已有项目/会话/任务模型。
- API Key 的安全存储机制（若已有）；不得迁移为明文 SQLite、日志或项目文件。
- V1.1 的 Apple 式现代极简、深浅色、克制玻璃拟态 UI 设计规范。
- 旧的 OpenAI-compatible 配置入口，升级时迁移到多连接模型并保留用户设置。

### 1.2 本版本目标（P0）

1. 多 AI 连接档案：创建、编辑、启停、测试、设置默认、删除。
2. 原生 API Provider：OpenAI-compatible 作为基础实现；OpenAI、Anthropic、DeepSeek 可通过对应原生或兼容适配器配置，不强制共用相同协议。
3. 模型目录：自动发现（如提供商支持）+ 手动录入 + 能力标记与验证状态。
4. 真实执行闭环：流式文本、工具调用、工具结果回传、取消、错误处理、事件持久化。
5. 外部 Agent：Claude Code、Codex CLI 的安装检测、版本检测、授权状态诊断、启动/取消/事件映射；仅使用实际支持的 CLI/SDK 能力。
6. Agent/任务路由：按角色、项目、任务类型选择连接与执行后端，失败时按策略处理。
7. 连接诊断、基础 Token/费用统计、敏感信息保护、跨会话运行验证。

### 1.3 非目标

不开发云端账户同步、多人 SaaS、支付充值系统、自动绕过提供商鉴权、自动获取第三方网页登录凭据、任意外部 CLI 内部状态精确恢复，也不承诺不同模型 API 能力完全一致。

## 2. 总体架构与数据流

```text
React Settings / Agent Workbench (Ant Design + Ant Design X)
  -> Preload typed IPC -> Electron Main (authorization + schema validation)
  -> Local Runtime (application services)
     -> AI Connection Service -> Secret Vault (OS-protected)
     -> Model Catalog / Capability Registry
     -> Agent Backend Router
          -> Native LLM Driver -> Provider Adapter -> API endpoint
          -> External Agent Driver -> supervised CLI child process
     -> Tool Dispatcher -> Policy Approval -> Workspace / MCP / Git
     -> Event Store / Sessions / Runs / Usage / Diagnostics (SQLite)
  -> streamed normalized events -> IPC -> UI
```

**职责边界**：Renderer 不读取密钥、不直接启动 CLI、不直接访问 SQLite；Runtime 不 import React/Electron UI；Provider Adapter 不更新项目任务状态；外部 CLI 通过进程管理器隔离并校验输出。API 请求仅由 Runtime 发出。

## 3. Monorepo 增量目录

```text
packages/
  ai-connections/        # profile CRUD, defaults, health, validation
  model-catalog/         # discovery, manual models, capability metadata
  provider-interfaces/   # unified model/driver interfaces
  provider-openai-compatible/
  provider-openai/       # optional native API semantics
  provider-anthropic/    # optional native API semantics
  agent-backend-router/  # policy-driven backend selection
  agent-runtime/         # existing: extend stream/tool loop
  adapter-claude-code/   # process/SDK adapter
  adapter-codex/         # process/SDK adapter
  usage-metering/        # usage events, price snapshots, aggregation
  connection-diagnostics/# error classification, connectivity checks
  secret-vault/          # OS credential abstraction
apps/desktop/src/renderer/features/
  ai-connections/
  model-catalog/
  agent-routing/
  usage/
  diagnostics/
docs/v1.2/
  baseline-audit.md
  provider-compatibility.md
  migration-report.md
  acceptance-report.md
```

**实施约束**：仅在现有包不存在时新增；已有同等职责模块直接扩展，避免重复抽象和循环依赖。

## 4. 核心类型契约（TypeScript）

```ts
export type BackendKind = 'native-llm' | 'external-agent';
export type ProviderProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'external-cli';
export interface AIConnectionProfile {
  id: string; name: string; backendKind: BackendKind;
  providerId: string; protocol: ProviderProtocol;
  baseUrl?: string; defaultModelId?: string;
  secretRef?: string; // never actual secret
  enabled: boolean; isDefault: boolean;
  proxyProfileId?: string; timeoutMs: number;
  createdAt: number; updatedAt: number;
}
export interface ModelDescriptor {
  connectionId: string; modelId: string; displayName: string;
  source: 'discovered' | 'manual';
  capabilities: {
    streaming: 'yes' | 'no' | 'unknown';
    toolCalling: 'yes' | 'no' | 'unknown';
    vision: 'yes' | 'no' | 'unknown';
    reasoning: 'yes' | 'no' | 'unknown';
  };
  contextWindow?: number; maxOutputTokens?: number;
  verifiedAt?: number;
}
export interface ModelRunInput {
  runId: string; connectionId: string; modelId: string;
  messages: NormalizedMessage[]; tools?: ToolDefinition[];
  temperature?: number; signal: AbortSignal;
}
export interface AIBackendDriver {
  id: string; kind: BackendKind;
  probe(): Promise<BackendProbe>;
  run(input: ModelRunInput): AsyncIterable<NormalizedRunEvent>;
  cancel(runId: string): Promise<void>;
}
export type NormalizedRunEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'text.delta'; runId: string; text: string }
  | { type: 'tool.request'; runId: string; callId: string; name: string; arguments: unknown }
  | { type: 'tool.result'; runId: string; callId: string; result: unknown }
  | { type: 'usage'; runId: string; inputTokens?: number; outputTokens?: number; source: 'provider' | 'estimate' }
  | { type: 'run.completed'; runId: string }
  | { type: 'run.failed'; runId: string; code: string; message: string };
```

具体代码应与 V1.1 既有 `AgentDriver` / `RunEvent` 对齐；避免平行维护两个互不兼容的运行时接口。工具调用由 Runtime 执行、审批、回传模型，并继续循环，直到完成/取消/达到预算。

## 5. SQLite 增量迁移

新增或扩展下列表（使用既有 Drizzle migration 体系，不直接破坏生产数据）：

| 表 | 主要字段 | 约束 |
|---|---|---|
| ai_connection_profiles | id, name, provider_id, backend_kind, protocol, base_url, secret_ref, enabled, is_default, timeout_ms, created_at, updated_at | 只存密钥引用；默认连接唯一性由事务/部分索引保证 |
| ai_models | connection_id, model_id, display_name, source, capabilities_json, verified_at | UNIQUE(connection_id, model_id) |
| agent_backend_bindings | id, scope_type, scope_id, agent_role, task_type, connection_id, model_id, priority | scope 可为 global/project/agent/task |
| ai_connection_checks | id, connection_id, stage, status, error_code, latency_ms, checked_at | 禁止记录 key 和敏感请求体 |
| ai_usage_records | id, run_id, connection_id, model_id, input_tokens, output_tokens, usage_source, estimated_cost, currency, pricing_version, created_at | 同一次供应商 usage 事件去重 |
| external_agent_installations | id, adapter_id, executable_path, detected_version, auth_state, last_checked_at | 路径需校验 |

旧版单 Provider 设置迁移规则：先备份数据库；如不存在多连接档案则创建 `Legacy OpenAI-compatible`；把原安全存储项转换为 `secret_ref`（优先复用原位置）；验证旧配置可读取；迁移可重复执行且幂等。不可读密钥显示“需重新授权”，不得静默丢弃。提供回滚与迁移报告。

## 6. AI 连接中心（前端 + 后端）

页面信息架构：设置 → AI 连接中心。包含连接列表、连接编辑抽屉、模型管理、连接测试结果、默认连接、代理与高级设置。展示连接名称、协议、当前模型、连接状态、上次检测时间，不展示完整密钥。

### 6.1 创建连接

字段：名称、连接类型、协议、Base URL（适用时）、API Key（适用时）、模型 ID、超时、可选代理配置。URL 必须校验协议/地址并对重定向与本地敏感地址设置访问策略；不能直接允许不可信配置访问本地元数据服务。保存和测试分开，未通过测试也可保存为“未验证”。

### 6.2 测试连接分层

- L1 配置校验：URL、必填字段、密钥引用可用。
- L2 服务可达性：TLS、DNS、超时、代理诊断。
- L3 鉴权与模型验证：最小请求，确认实际 API 响应。
- L4 能力探测：流式输出、工具调用（用户主动触发，可能产生费用）。

**不得把 /models 返回成功等同于能进行推理**。错误分类至少包括 INVALID_KEY、INSUFFICIENT_QUOTA、RATE_LIMITED、MODEL_NOT_FOUND、PROTOCOL_MISMATCH、TLS_ERROR、PROXY_ERROR、TIMEOUT、NETWORK_UNREACHABLE、UNKNOWN。返回用户可理解的处理建议；诊断日志必须脱敏。

### 6.3 模型目录

有发现接口时同步模型列表；不支持时允许手动录入。能力信息分为官方声明、用户设置、实际探测三类来源，显示未知而非猜测。模型不存在时不能自动切换到任意其他模型。

## 7. 原生 API 执行闭环（P0）

执行顺序：选择连接 → 获取模型能力 → 构建上下文 → 发起流式请求 → 规范化 delta → 处理 tool calls → Policy Engine 审批 → 工具执行并持久化结果 → 将结果回传模型 → 直到完成 → 写入 Run/Session/Usage。

必须支持：取消（AbortSignal）、请求超时、并发限制、上下文超限处理、重试退避（仅安全可重试请求）、事件序号、断流标记、运行状态恢复。禁止对已产生不可逆副作用的工具调用自动重放。若 Provider 不支持工具调用，应明确降级为纯对话或提示用户切换模型。

验收：同一项目内完成真实问答、流式显示、一次只读工具调用、一次需审批的写入操作、用户取消、网络断开、重启后查看历史与执行结果。

## 8. 外部 Agent 适配（P0/P1）

优先支持 Claude Code 与 Codex CLI，先实现检测与启动，再逐步实现任务执行。不得依赖未经验证的命令行参数；实际开发时检查已安装 CLI 的 help/version 与官方文档，记录兼容版本矩阵。

### 8.1 ExternalAgentDriver

- `probe`：可执行文件定位、版本、授权状态（仅调用官方支持的检查方式）、功能可用性。
- `run`：启动受监管子进程，传入任务/工作目录/环境变量白名单，读取结构化输出（若可用），转换为统一事件。
- `cancel`：终止进程树并清理临时资源。
- `resume`：仅在外部 Agent 明确提供恢复语义时支持；否则新建执行并使用 ProjectOS Handoff 上下文。

默认不把 API Key 写入 CLI 参数、日志或任务提示词。不能自动读取浏览器 Cookie、绕过授权或假设订阅权益与 API 额度互通。

### 8.2 任务执行隔离

外部 Agent 需要显式工作目录和受限环境；涉及并行代码写入时优先使用 Git Worktree。Agent 对项目文件的修改必须可审计，运行完成后记录 diff、commit（若有）、Artifact 与测试结果。CLI 的进程退出码为 0 不代表业务验收通过。

## 9. Agent 路由与降级策略

路由优先级：任务显式指定 > Agent 角色配置 > 项目默认 > 全局默认。每层指定 connectionId/modelId、能力要求、预算、并发上限、失败策略。候选连接必须启用、配置完整、能力匹配；不可用时提示或按用户事先批准的策略回退。

示例：项目经理 → 原生 LLM；开发 → Claude Code；审查 → Codex；测试 → 原生 LLM + 工具。路由决定写入 `agent_runs` 快照，确保历史任务可复现配置选择（不保存密钥）。禁止无提示地切换到可能产生额外费用的 Provider。

## 10. Token、成本与运行观测

优先使用 Provider 返回的实际 Token 用量；没有时标记为估算或未知。成本按连接、模型、任务、项目、日期汇总，价格表带版本与生效日期；不应把估算费用表述为实际账单。外部 CLI 无法提供 Token 时显示“未提供”，不虚构数据。支持按项目设定软预算与超限审批。

观测指标：连接成功率、P50/P95 首 Token 延迟、请求耗时、错误码分布、运行成功率、工具审批次数、Token 及费用估算。日志、追踪和异常消息必须隐藏密钥、Authorization、敏感头、用户提示词中的秘密。

## 11. UI/UX V1.2 规范（继承 V1.1）

延续 Apple 官网式现代简约 + 克制玻璃拟态。新页面与现有 AppShell 一致，避免重新创建第二套视觉语言。

- 左侧导航新增“AI 连接”，默认展示连接卡片、健康状态和默认标记；卡片支持搜索/过滤。
- 连接编辑采用清晰分组：基础、认证、模型、网络、高级；危险操作有确认。
- 状态不只依赖颜色：未配置、未验证、可用、降级、异常均有文字与图标。
- API Key 默认遮挡，允许替换但不从后端返回原文；不提供“查看明文”功能。
- 运行工作台可见当前 Agent、连接、模型、任务、流式状态、工具调用、审批、错误与重试入口。
- UI 动效 150–250ms 为主，尊重 reduced-motion；半透明层不影响正文对比度。
- 在 1280×800、1440×900 和常见高 DPI 缩放下检查溢出、抽屉、滚动、键盘操作和深浅色模式。
- 连接测试和保存都要有加载、成功、失败、取消、空状态，不允许假按钮。

## 12. 安全与稳定性

1. SecretVault 提供 `put/get/delete`，持久化时只写 `secretRef`；OS 保护不可用时明确提示用户，不静默退化为明文存储。
2. 自定义 Base URL 需防 SSRF、重定向绕过和恶意代理配置；允许用户明确选择本地模型服务，但必须有受控例外。
3. Renderer 仅持有连接元数据，所有请求由 Runtime 发出。
4. CLI 路径及参数必须校验，不拼接 Shell 字符串执行；使用 spawn 参数数组与进程树清理。
5. 请求、工具、消息和日志采用稳定 ID 与幂等策略；取消与重试不可重复执行写操作。
6. 失败状态和密钥迁移需提供明确恢复流程；数据库升级前备份。

## 13. 实施计划与任务清单

### M1.2-01 现状审计与兼容性基线（必须先完成）

检查现有 Provider 页面、设置存储、IPC、Runtime、AgentDriver、RunEvent、数据库迁移、测试覆盖；输出差距清单及复用方案。验收：每个需求标注代码路径与验证证据，旧功能回归通过。

### M1.2-02 多连接模型与迁移

实现 Profile CRUD、SecretVault 引用、迁移、默认连接、Zod 契约与单元测试。验收：至少 2 个连接共存；旧配置可用；重启后保留；数据库无密钥明文。

### M1.2-03 连接测试与模型目录

实现 L1–L4 检测、错误分类、模型发现/手动录入、能力标记。验收：成功、错误密钥、错误模型、超时、无网络、代理失败都有正确反馈。

### M1.2-04 原生模型执行闭环

实现流式输出、Tool Dispatcher、审批、工具结果回传、取消和持久化。验收：真实 API 端到端通过；模型不支持工具时正确提示；重启后可查历史。

### M1.2-05 外部 Agent 适配

Claude Code/Codex 检测、版本兼容、授权状态、执行与取消；不支持的能力显式标记。验收：在已安装/未安装、已授权/未授权状态下均正确表现；可审计进程与输出。

### M1.2-06 路由、用量与 UI

实现路由优先级、项目默认、角色绑定、费用估算、连接中心与运行工作台 UI。验收：可指定不同 Agent 后端，查看真实执行结果，错误与成本状态准确。

### M1.2-07 全量回归与发布

执行 V1.1 回归、跨会话恢复、Windows/macOS（条件允许时 Linux）兼容、故障注入、UI 截图评审。输出 `docs/v1.2/acceptance-report.md` 和发布说明。

## 14. 必须执行的验收用例

| ID | 场景 | 通过标准 |
|---|---|---|
| AI-001 | 从 V1.1 升级 | 原配置与安全凭据仍可用，迁移幂等 |
| AI-002 | 保存两个 Provider | 配置独立、可切换默认、重启不丢失 |
| AI-003 | 错误 API Key | 明确提示认证失败，日志不泄露密钥 |
| AI-004 | 错误模型 ID | 报 MODEL_NOT_FOUND，不伪装成功 |
| AI-005 | 流式回答 | 文本增量更新、结束事件准确 |
| AI-006 | 工具调用 | 工具请求→审批→执行→结果回传→继续模型循环 |
| AI-007 | 取消运行 | 网络/CLI 中断，状态正确，无僵尸进程 |
| AI-008 | 运行中崩溃 | 可查看事件与安全恢复点，不重复副作用 |
| AI-009 | 外部 CLI 不存在 | 清晰提示安装/配置，不导致 Runtime 崩溃 |
| AI-010 | Agent 角色路由 | 不同角色选中正确 Provider 与模型 |
| AI-011 | 预算与用量 | 实际/估算/未知有明确区分 |
| AI-012 | UI 验收 | 深浅色、键盘、缩放、滚动、对比度通过 |
| AI-013 | 无网络 | 离线状态可诊断，既有项目与历史仍可访问 |
| AI-014 | 跨会话交接 | 新 Session 可读取任务状态与已确认交付物 |

## 15. AI 开发 Agent 强制执行指令

1. **先审计后开发**：不得直接照抄本文件创建重复包；先列出现有实现、差距、迁移风险。
2. **小步提交**：每个 M1.2-XX 独立完成并验证，禁止一次性重写架构。
3. **先契约后 UI**：先写 Schema、Service、测试，再连接界面；所有按钮都必须有真实逻辑。
4. **严禁虚构验证**：没有真实 API Key 或 CLI 环境时，用 Mock 完成自动化测试，并明确列出未完成的真实联调项。
5. **安全优先**：不输出密钥、不提交凭据、不关闭既有安全隔离。
6. **验收证据**：每项任务输出代码文件列表、迁移文件、测试命令和结果、截图、已知限制。
7. **兼容 V1.1**：必须运行既有回归测试；发现冲突先记录 ADR 并选择最小兼容修改。
8. **完成判定**：只有验收用例通过且产出 `acceptance-report.md` 才允许宣称 V1.2 完成。

### 推荐交给编码 Agent 的首条任务

> 阅读 `docs/ProjectOS_AI开发实施设计说明书_v1.1.md` 与本 V1.2 文档，扫描仓库实际实现。只执行 M1.2-01：生成 `docs/v1.2/baseline-audit.md`，列出现有 AI 配置、IPC、Runtime、Provider、密钥存储、数据库及测试的代码位置和真实运行状态；输出 V1.2 最小改动实施计划。不要在完成审计前大规模修改代码。

## 16. 交付物清单

- `docs/v1.2/baseline-audit.md`
- `docs/v1.2/provider-compatibility.md`
- 数据库迁移与回滚说明、迁移测试
- Provider/Driver/IPC TypeScript 契约与契约测试
- 多连接中心、模型目录、路由与用量界面
- 原生 API 与外部 Agent 集成测试
- `docs/v1.2/migration-report.md`
- `docs/v1.2/acceptance-report.md`
- V1.2 Release Notes、已知限制与后续迭代建议

**版本关系**：V1.0（核心架构）→ V1.1（核心功能与 UI/UX）→ V1.2（AI 连接、模型运行、多 Agent 后端增强）。V1.2 不应被视为对 V1.1 已实现内容的否定或替换。


---

## 17. 强制 UI 文案规范：工具界面去解释化（V1.2 增补）

**原则：界面是工具，不是产品说明书。** ProjectOS 所有页面应以操作、数据、状态为核心。禁止 AI 在界面上自动添加无实际必要的说明性段落、营销式副标题、重复解释、欢迎语、技术实现介绍及填充式空状态文案。该规范适用于新页面，也要求审查并精简现有页面。

### 17.1 必须删除或迁移

- 页面标题下重复描述页面用途的副标题，如“在这里您可以轻松管理所有项目与智能体”。
- 卡片标题下解释显而易见功能的说明，如“点击此按钮即可新建项目”。
- 首页大幅欢迎语、口号、产品愿景和空洞宣传文字。
- 面向普通用户的技术实现描述，如“基于 Electron safeStorage 加密，数据不会进入 SQLite”。必要时迁移至安全详情或帮助文档。
- 仅为填充留白而加入的文字、冗长提示、重复的操作步骤。
- 每个表单字段下与标签或占位符含义重复的辅助说明。

### 17.2 必须保留

- 清晰的字段标签、按钮文字、菜单名称、必要单位与数据状态。
- 会导致数据丢失、覆盖、付费、权限变更或外部执行的明确风险提示与确认。
- 可操作的错误反馈：说明问题及恢复方法，不能仅显示错误码。
- 必要的首次授权、隐私告知、复杂操作的按需帮助和无障碍标签。
- 无数据状态的最简行动提示，例如“暂无项目”与“新建项目”。

### 17.3 文案密度与展示规则

1. 默认只显示：标题、关键数据、状态、操作。辅助说明按需显示在 tooltip、详情抽屉、帮助入口或首次引导中。
2. 页面标题原则上不附加解释性副标题；表单占位符只提供输入格式或实例，不重复字段名称。
3. 按钮使用动作动词，例如“创建项目”“测试连接”“保存”；避免“立即开始您的智能项目之旅”。
4. 信息卡片若标题与数值已足够表达含义，不再增加描述段落。
5. 空状态优先呈现状态 + 一个主要操作，不展示长篇教程。
6. 危险操作、鉴权异常、权限申请、费用提醒不受“去解释化”限制；清晰性和安全性优先。
7. 不通过删掉标签、缩小字体、降低对比度来制造“极简”。

### 17.4 改写示例

| 位置 | 禁止的冗余文案 | 推荐文案 |
|---|---|---|
| 设置页 | 本地运行时与偏好；配置模型、外观与本地数据边界…… | 设置 / AI 模型 / 外观 / 运行时 |
| 项目页 | 在这里可以查看和管理您的所有项目 | 项目 |
| Agent 页 | 通过强大的智能体协作能力帮助您完成开发 | Agent |
| 空项目 | 您还没有创建任何项目，快来开启精彩旅程 | 暂无项目 · 新建项目 |
| API 配置 | 在此输入您从服务提供商获取的 API 密钥 | API Key |
| 删除确认 | 点击确定后系统将执行不可撤销的数据删除操作…… | 删除项目？此操作不可撤销。 |

### 17.5 对 AI 编码 Agent 的执行指令

- 实施任何 UI 任务前，先检查页面已有文案；删除冗余解释，但不得改变业务逻辑、权限流程或错误反馈。
- 设计稿和代码评审均增加 `copy-density-review` 检查项。
- 新增说明性文字时必须回答：用户是否必须现在知道？是否可以通过标签、状态或按需帮助表达？如果否，则不添加。
- 不允许为了让页面显得丰富而增加标题副文案、装饰性段落或无意义占位文本。
- 不允许将安全说明一概删除；应根据风险保留在正确的操作时机。
- 截图验收须覆盖：项目首页、AI 连接中心、Agent 工作台、任务看板、设置页、空状态与错误状态。

### 17.6 验收标准

- [ ] 主要页面没有与标题重复的解释性副标题。
- [ ] 主要卡片没有无意义的功能介绍段落。
- [ ] 新增表单字段不存在重复标签含义的辅助文案。
- [ ] 关键操作、数据、状态仍可快速识别。
- [ ] 风险提示、错误恢复、权限说明完整可用。
- [ ] 亮色与暗色主题下布局紧凑、层级清晰，未因删文案出现失衡留白。
- [ ] AI 提供修改前后截图与精简文案清单，说明保留的重要提示。

**优先级：P0，适用于 V1.2 所有 UI 增量开发和现有界面的文案清理。**
