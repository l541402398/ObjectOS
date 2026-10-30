# ProjectOS 架构说明

## A2.1 组织资产增量（2026-10-29）

PostgreSQL 迁移 2 追加组织资产、不可变版本和显式项目绑定；保留迁移 1 的字节与校验和。
发布内容按规范 JSON 计算 SHA256，更新草稿/项目绑定使用版本条件，服务端写入与成员权限变更
共享组织锁。Renderer 仅使用具名资产 IPC，Main 保留凭据和有界 HTTP 读取。
资产绑定当前是共享配置记录；本地项目关联、Worker 租约及现有 Runner 的版本解析由 A2.2 实现。
旧本地 SQLite、Agent 定义和 Run 不迁移。ADR-0068 和 A2.1 报告记录验证与边界。

## A1 组织控制面增量（2026-10-29）

独立启动的 `apps/server` 使用 PostgreSQL 保存账号、组织、成员和共享项目元数据。桌面 Main
通过系统浏览器 / PKCE / 一次性 loopback 回调登录；会话密钥只进 Main 的安全存储，Renderer
仅使用具名 `organization.*` preload API。个人模式继续使用既有本地 Runtime 和 SQLite。
本次不会把服务端组织角色转换为本机文件、命令、Git 或 Worker 执行权；共享项目也不自动上传
或关联本地项目。组织资产/Worker、需求独立工作区和流程实例由后续切片实现。

`contracts` 可复用平台无关的 `organization-contracts` Schema 以定义脱敏 IPC 视图；二者均不访问
Node/Electron/数据库。服务端不能依赖本地执行内核。迁移、授权和回滚决策见 ADR-0067，真实结果见
`docs/org-upgrade/reports/A1-report.md`。下面的 Runtime 单写者与无 TCP 规则仍用于本地执行内核；
组织 HTTP 服务是独立进程，桌面只在登录期间打开一次性 127.0.0.1 回调监听。

## 1. 进程与信任边界

```text
┌─────────────────────────────────────────────────────────────┐
│ React Renderer（不可信 UI）                                  │
│  - 无 nodeIntegration / 无 Node、FS、DB、Shell 访问           │
│  - 仅通过 preload 暴露的命名、类型化 API                      │
└───────────────┬─────────────────────────────────────────────┘
                │ ipcRenderer.invoke('projectos:request', method, input)
┌───────────────▼─────────────────────────────────────────────┐
│ Electron Main（可信边界）                                     │
│  - BrowserWindow / 安全策略 / CSP / 窗口控制                  │
│  - safeStorage 加密 Provider Key                             │
│  - preload 白名单 + Zod 二次校验                             │
│  - RuntimeSupervisor：spawn / handshake / heartbeat / restart│
└───────────────┬─────────────────────────────────────────────┘
                │ NDJSON frames over stdin/stdout
┌───────────────▼─────────────────────────────────────────────┐
│ Node Runtime（独立子进程，业务唯一写者）                       │
│  - RuntimeDispatcher（白名单 + Zod 校验）                     │
│  - Application services / Agent loop / Tool dispatcher        │
│  - SQLite (node:sqlite, WAL, FK, migrations)                 │
│  - 本地工作区 FS/Git，受策略和审批约束                         │
│  - OpenAI-compatible Provider（HTTP 出站）                    │
└─────────────────────────────────────────────────────────────┘
```

- Main 与 Renderer 的 IPC 只有一个 `projectos:request` channel；方法名、参数都在 Main
  校验，Runtime 再次校验，不信任单次边界校验。
- Runtime 不监听 TCP 端口。Main ↔ Runtime 使用 requestId、协议版本、超时、错误码和
  单调递增事件序号。
- Runtime 崩溃时 Main 按指数退避重启（60 秒内最多 5 次），期间向 UI 广播状态。
- 事件先写 SQLite 再广播；高频 token delta 允许批量持久化并明确降级，最终文本与步骤会落盘。

## 2. Monorepo 包与依赖方向

```text
contracts ──► domain ──► application ──► persistence
     │            │             │
     │            ├──► context-engine
     │            ├──► session-manager ──► collaboration
     │            ├──► skills
     │            └──► tools / policy / workspace
     │
     ├──► provider-interfaces ──► provider-openai-compatible
     ├──► kernel
     ├──► agent-runtime
     ├──► design-tokens ──► ui ──► ai-ui
     └──► apps/runtime ──► apps/desktop
```

- `contracts` 只包含类型、Zod Schema、ID 与纯协议，不依赖平台。
- `domain` 只包含状态机、DAG、生命周期门禁和事件摘要，不依赖数据库/Electron。
- `application` 依赖 domain、ports；不 import Electron/Drizzle/模型 SDK。
- `persistence` 实现 `CoreStore` 端口；是唯一直接操作 SQLite 的包。
- `connection-diagnostics` 只做错误分类，不访问网络或数据库。
- `agent-runtime` 的 `runAgentLoop` 不依赖数据库；Runtime 负责持久化和审批钩子。
- `ui`/`ai-ui` 不依赖 Node/Electron；通过 props 与 API 客户端交互。
- `scripts/check-boundaries.mjs` 在 `pnpm lint` 中强制这些规则，并禁止 Renderer 导入
  `node:*`、`electron`、`persistence`、`workspace`。

## 3. 数据模型

SQLite 表（迁移 v1）覆盖：

- 项目与生命周期：`projects`, `project_stages`, `requirements`, `milestones`, `decisions`
- 任务：`tasks`, `task_dependencies`, `task_attempts`, `task_leases`
- Agent：`agents`, `agent_instances`, `sessions`, `messages`
- 运行：`agent_runs`, `run_snapshots`, `run_steps`, `checkpoints`, `tool_calls`, `approvals`
- 协作：`agent_inbox`, `handoffs`, `outbox`
- 交付与知识：`artifacts`, `knowledge_entries`
- AI 连接（v2）：`ai_connection_profiles`, `ai_models`, `ai_connection_checks`,
  `ai_usage_records`（预留）, `agent_backend_bindings`（预留）, `external_agent_installations`（预留）
- 事件与基础设施：`project_events`, `schema_migrations`, `app_settings`, `plugin_installations`

约定：

- 时间统一 UTC 毫秒整数；ID 使用带前缀的 ULID。
- 所有 FK 显式建立；启动执行 `PRAGMA foreign_keys=ON`、WAL、busy_timeout、迁移校验。
- JSON 字段在写入前经 Zod/类型化输入校验；密钥不写入 SQLite。
- `project_events` 序号在 `BEGIN IMMEDIATE` 事务内分配；写事件同时写 Outbox。
- 任务更新使用 `expected_version` 乐观并发；租约使用单调 `fencing_token`。
- Run 创建时冻结 `run_snapshots`（Agent/Persona/Skills/Runtime/权限/模型），运行中不再读取
  可变 AgentDefinition，见 ADR-0010。
- `schema_migrations` 保存 checksum；版本不匹配时拒绝启动迁移。

## 4. 运行生命周期

```text
created → queued → running ─┬─ waiting_tool
                             ├─ waiting_approval → running
                             ├─ verifying → completed
                             ├─ suspended
                             ├─ needs_reconciliation
                             └─ failed / cancelled
```

1. `run.start` 校验会话/任务/Provider，创建 Run、RunStep(status) 与 TaskAttempt。
2. 若有任务，获取 Task Lease，状态迁移到 running，组装 Context Bundle。
3. Driver（native loop）流式产生文本与工具请求；文本按 step 持久化并广播 delta。
4. Tool Dispatcher 先评估 policy：
   - 只读：直接执行；
   - 写入/命令：创建 Approval，Run 进入 `waiting_approval`；
   - 拒绝：记录 ToolCall 为 denied。
5. 人工批准/拒绝后，批准路径执行工具、写 ToolCall 结果，再恢复模型循环；拒绝路径把
   错误作为 tool result 反馈给模型。
6. 完成后 Task 进入 review；失败 Task 进入 blocked；取消回 ready。
7. 每个 assistant turn 写 checkpoint（schemaVersion + 状态摘要）；恢复时重建 transcript。

### 恢复原则

- 启动扫描非终态 Run、过期 Lease、待处理 Outbox 和未决 ToolCall。
- `running/waiting_tool` 的未知外部副作用 → `needs_reconciliation`，不自动重试。
- `waiting_approval` 保留可恢复：审批仍有效，配置 Provider 后可继续。
- 失去 Lease 的执行者不得提交状态；token 只增不减（释放只是将租约置为过期）。

## 5. Agent 与上下文

- Context Builder 按优先级组装：Agent 角色 → 项目 → 当前任务/验收 → Handoff → AGENTS.md →
  已接受 ADR → 已批准需求 → Artifacts → Knowledge → Skills。
- 输出带来源、字符数、截断标记和预算，便于审计。
- Skill Router 依据能力、任务关键词和标签选择最多 2 个 Skill，并记录理由。
- 工具目录按 Agent capability 过滤；Server 端 policy 再次限制工具权限。
- Provider 接口只暴露流式文本、tool call、usage、done；OpenAI-compatible 实现负责 SSE 解析。
- 未配置 Provider 时，消息仍持久化，但不会伪造 Agent 运行或完成。

## 6. 跨会话

- `CrossSessionEnvelope` 版本 1，包含 project/task/run、sender/recipient、类型、幂等键、关联 ID。
- 本地 `agent_inbox` 是权威；Outbox 表为未来外部 transport 保留。
- 消息至少一次投递；消费方幂等；状态 `delivered → accepted → completed`。
- `agent.wake` 只启动一次运行，不等于任务完成；`completed` 才代表运行完成。
- Handoff 状态为 `requested → accepted/rejected/expired/cancelled`；接收方可获得会话和任务责任。
- OCS 只作为可选 adapter，不参与本地真相；当前未接入，见 ADR-0004。

## 7. V1.2 AI 连接与模型目录

```text
Settings Modal (Renderer)
  → typed preload
Electron Main: ConnectionSecretStore (safeStorage) + legacy migration
  → internal runtime.ai.registry / runtime.ai.probe / runtime.ai.discover
Runtime: AIConnectionService
  → SQLite: ai_connection_profiles / ai_models / ai_connection_checks
  → default profile + secret from Main → ProviderManager
  → existing AgentRunner native loop
```

- 连接元数据与模型目录由 Runtime 写入 SQLite；密钥只在 Main 的 Vault。
- 默认连接由 Main 同步给既有 ProviderManager，Agent 循环保持单一入口。
- 连接测试 L1/L2/L3 在 Runtime 发请求；错误由 `connection-diagnostics` 分类并落检查表。
- 设置是全局 Modal，不改变路由；模型目录支持发现与手动录入。
- 外部 Agent 可执行，但以 run 级 ToolCall、Task Lease 和 Worktree 为审计边界；ACP 权限请求
  必须经过 ProjectOS Approval。详见 ADR-0009。

## 8. V1.3 项目扫描、计划与图投影

```text
Runtime OrchestrationService
  ├─ project-analyzer: scan workspace → ProjectSnapshot → project_snapshots
  ├─ planning: local PlanDraft + DAG validation → plan_revisions
  ├─ approve: TaskService creates real tasks/dependencies (same transaction)
  └─ graph-projection: tasks + dependencies + agents + latest runs + graph_layouts
        → GraphSnapshot (React Flow consumes; UI only)
```

- 图布局不参与调度；任务 DAG 仍是唯一依赖真相。
- 计划审批失败不会留下半套任务；图每秒轮询/事件刷新，不是模拟状态。
- 设置弹层中的连接编辑是内容区子视图（`ConnectionEditor`），不是第二个 Modal。
- 自动 Orchestrator 调度、Worktree、质量门禁报告已实现基础版本；计划级并行、失败重试和
  人工核对仍按 `docs/status.md` 的边界执行。

## 9. 安全与审计

- 窗口：`contextIsolation`、`sandbox`、`nodeIntegration:false`、禁用 webview、拒绝新窗口/
  导航/权限请求。
- CSP 区分 dev/prod；生产禁止 eval、外部脚本和任意 connect。
- 路径：`realpath` + `relative` 校验；拒绝 `..`、绝对路径、工作区外符号链接、`.git`/`.env`。
- 命令：默认审批；无 shell 管道/重定向；超时、输出上限、环境变量白名单；Windows 使用
  `cross-spawn` 正确解析 `.cmd`。
- 审计：RunStep、ToolCall、Approval、ProjectEvent 都可回溯；错误信息与参数做敏感信息脱敏。
- 数据备份、插件隔离、签名与更新属于后续里程碑。

## 10. 已知偏差

- 未使用 Drizzle ORM，使用 `node:sqlite` + 手写 SQL/类型仓储，见 ADR-0002。
- 未实现外部 Agent Driver、OCS LAN、Worktree 自动合并与安装包签名，见 `docs/status.md`。
