# ProjectOS — AI 可执行实施设计说明书

> 版本：1.1 | 日期：2026-10-19 | 状态：实施基线（MVP）  
> 目标读者：负责独立编码的 AI Coding Agent、架构审查 Agent、测试 Agent、人类项目负责人  
> 项目定位：本地桌面优先（Local-first）的 AI Native 项目全生命周期管理系统。

## 0. 如何使用本说明书（AI 必须先读）

本文件是工程实施的单一架构基线，**不是已完成代码的说明**。AI 开发者必须先读取本文件，再读取仓库内 `AGENTS.md`、`docs/adr/` 与当前任务。发现冲突时，遵循：用户最新明确要求 > 已批准 ADR > 本说明书 > 代码既有实现；若涉及数据迁移、安全、核心接口或技术栈冲突，先提出 ADR，不得静默改动。

**开发行为契约**：
1. 只完成当前里程碑/任务及其必要依赖；禁止为了“完整”提前实现远程云服务、复杂微服务或未经批准的功能。
2. 先写或更新契约（Zod Schema / TypeScript Interface）、迁移、测试，再写实现；每次提交提供变更文件、验证命令及结果。
3. 禁止将聊天记录视为项目状态真相；任务、会话、运行和交付物都必须持久化。
4. 不允许在 Electron Renderer 直接访问 Node.js、数据库、文件系统或 Shell。
5. 任何文件写入、进程执行、Git 修改均经过权限策略和审计；危险操作需人工批准。
6. 外部工具可能产生副作用，崩溃恢复不得盲目重试。
7. 未实现的功能要以明确的 `NOT_IMPLEMENTED` 或禁用入口表示，不得模拟成功。
8. UI/UX 是强制验收项：所有页面必须遵守第 17 章的 Apple 风格现代极简与克制玻璃拟态设计规范。
9. 不要凭空猜测外部开源项目的 API；集成前核对仓库代码、许可证、版本和平台支持。

**每个任务的输出格式**：任务 ID、目标、修改文件、设计取舍、测试与运行结果、风险/遗留、下一步；没有运行过的测试明确标为“未运行”。

## 1. 产品范围和非目标

### 1.1 目标
- 创建、导入和管理本地软件项目；跟踪构思、需求、设计、规划、开发、测试、发布和维护。
- 提供 React + Ant Design + Ant Design X 桌面工作台，含项目总览、任务看板、Agent 会话、文件树、执行审计。
- 支持原生 Agent Loop 与外部 Agent Driver 适配；模型、工具、Skill、Transport 可插拔。
- Agent 会话之间通过持久化消息、任务交接和结构化 Artifact 协作；应用重启后可恢复项目和任务状态。
- 本地单用户优先，Windows 11 为第一验收平台，兼容性设计覆盖 macOS/Linux。

### 1.2 MVP 不做
- 多租户、多人实时协同、云端控制台、远程 Worker、移动端、插件市场、完整 CI/CD 平台。
- 不承诺任意外部 Agent 内部状态的精确恢复；不承诺跨外部系统 Exactly-once 执行。
- 不默认允许第三方任意 JS 插件进程内运行。

### 1.3 MVP 成功标准
创建本地项目 → 生成需求/任务 → 指派开发 Agent → 经审批修改测试工作区 → 运行测试 → 产生交付物 → 将任务交接给另一 Agent/会话 → 关闭并重启应用 → 恢复会话、任务、事件和未完成工作；所有关键动作可审计。

## 2. 技术基线与 ADR

| 领域 | 选型 | 约束 |
|---|---|---|
| 语言 | TypeScript strict | Node.js LTS，版本以项目 `.nvmrc` 锁定 |
| 仓库 | pnpm workspace + Turborepo | lockfile 提交，依赖版本固定 |
| 桌面 | Electron + electron-vite | 主进程只负责窗口/IPC/Runtime 监管 |
| 前端 | React + Vite + Ant Design + Ant Design X | Zustand 本地 UI 状态，TanStack Query 服务状态 |
| 服务 | 独立 Node.js Runtime 子进程 | MVP 不开放 HTTP 端口；未来 Fastify 可选 |
| 数据 | SQLite + Drizzle ORM | 单 Runtime 写者，WAL、FK、迁移 |
| 验证 | Zod | IPC/消息/插件配置均校验 |
| 测试 | Vitest + Playwright | 集成测试使用临时 SQLite 和临时 Git 仓库 |
| 可观测 | Pino + OpenTelemetry 接口 | 日志脱敏、traceId/runId/taskId |
| 文件/Git | Node fs + Git CLI adapter | 路径规范化、工作区边界、Worktree |

**ADR-001**：业务数据库的唯一写者是 Runtime。  
**ADR-002**：Renderer 只能通过有限 Preload API 访问 Main。  
**ADR-003**：Domain/Application 不 import Electron、Drizzle 或模型 SDK。  
**ADR-004**：当前状态表 + 追加事件 + Outbox 的混合模型，不强制完整 Event Sourcing。  
**ADR-005**：本地持久化 Mailbox 是权威通信状态，OCS 仅作可选 Adapter。  
**ADR-006**：本地并发修改同一项目时使用 Task Lease + 独立 Git Worktree。  
**ADR-007**：所有外部副作用必须记录 ToolCall 的执行意图和执行结果。  
**ADR-008**：核心领域固定；LLM、Agent Driver、Tool、Skill、Transport 通过能力接口扩展。

## 3. 进程、信任边界与数据流

```text
React Renderer (untrusted)
    │ allowlisted typed preload API
    ▼
Electron Main (window / IPC / Runtime supervisor)
    │ framed request-response + event stream
    ▼
Node Runtime (application / domain / harness / scheduler)
    ├── SQLite (single writer, WAL)
    ├── Local Workspace (FS / Git / Worktree)
    ├── LLM Providers (remote API)
    └── Tool & External Agent Processes (permission-gated)
```

- Renderer 禁用 `nodeIntegration`，开启 `contextIsolation` 和 `sandbox`；Preload 不暴露通用 `invoke(channel, any)`，只暴露命名 API。
- Main 对 IPC 来源、命令和参数校验；Runtime 重新校验权限，不依赖 Main 的单次校验。
- Runtime 崩溃时 Main 可重启；任务恢复由 Runtime Recovery Coordinator 决定，不由 UI 猜测。
- 禁止默认监听 0.0.0.0；未来远程接口必须单独 ADR、认证、加密、审计。
- 插件或 MCP 的内容视为不可信数据，不能覆盖系统策略。

## 4. 完整 Monorepo 目录（目标结构）

```text
projectos/
├── apps/
│   ├── desktop/
│   │   ├── src/main/{bootstrap,ipc,runtime-supervisor,security,windows}/
│   │   ├── src/preload/index.ts
│   │   └── src/renderer/{app,routes,layouts,features,styles}/
│   ├── runtime/src/{main,bootstrap,transport,services,recovery,shutdown}/
│   ├── web/                    # future, not created in M1
│   ├── server/                 # future
│   └── worker/                 # future
├── packages/
│   ├── contracts/src/{commands,events,schemas,types}/
│   ├── domain/src/{project,requirement,milestone,task,artifact,decision,workflow}/
│   ├── application/src/{commands,queries,use-cases,ports}/
│   ├── kernel/src/{container,plugin-registry,capability-registry,lifecycle}/
│   ├── agent-runtime/src/{loop,scheduler,orchestrator,execution,verification,checkpoint}/
│   ├── context-engine/src/{assembler,retriever,budget,provenance}/
│   ├── session-manager/src/{session,message,handoff,resume}/
│   ├── collaboration/src/{protocol,mailbox,delivery,lease,transports}/
│   ├── skills/src/{discovery,manifest,matcher,loader,evaluator}/
│   ├── tools/src/{registry,dispatcher,approval,audit}/
│   ├── policy/src/{authorization,permissions,secrets}/
│   ├── workspace/src/{filesystem,git,worktree,terminal,watcher}/
│   ├── persistence/src/{db/schema,db/migrations,repositories,event-store,backup}/
│   ├── provider-interfaces/src/
│   ├── provider-openai/src/
│   ├── provider-anthropic/src/
│   ├── provider-openai-compatible/src/
│   ├── adapter-claude-code/src/
│   ├── adapter-codex/src/
│   ├── adapter-ocs/src/
│   ├── adapter-mcp/src/
│   ├── adapter-shell/src/
│   ├── adapter-git/src/
│   ├── design-tokens/
│   ├── src/
│   └── themes/
│
├── ui/src/
│   ├── ai-ui/src/
│   ├── editor/src/
│   ├── desktop-client/src/
│   ├── observability/src/
│   └── shared/src/
├── plugins/builtin/{project-manager,requirement-analyst,architect,developer,reviewer,tester}/
├── templates/{blank-project,typescript-project,java-spring-project,react-project}/
├── tooling/{eslint-config,tsconfig,test-config}/
├── tests/{integration,contract,recovery,e2e}/
├── docs/{architecture,adr,protocols,development}/
├── AGENTS.md
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
└── package.json
```

M1 仅创建必要包；其余目录按里程碑增量落地。包名约定 `@projectos/<name>`，使用 `exports` 显式暴露公共 API，不允许跨包 import `src/internal/*`。

### 4.1 依赖方向（必须自动检查）
- `contracts`、`domain`、`shared` 不依赖平台适配器。
- `application` → `domain` + Ports；`agent-runtime` → `contracts` + Ports + domain；`persistence` 实现 repository ports。
- `adapter-*` 实现 `provider-interfaces` / `tools` / `collaboration` 的接口；Core 不 import 具体 adapter。
- `desktop` 依赖 `desktop-client`、UI 与 contracts；不得 import persistence、workspace 或 adapter-shell。
- `kernel` 不依赖具体业务页面；`ui` / `ai-ui` 不依赖 Node/Electron。
- 用 ESLint import boundary + TypeScript project references + CI 检查禁止依赖。

## 5. 领域模型和状态机

### 5.1 聚合
- `Project`：项目根目录、状态、生命周期定义、版本。
- `Requirement`：内容、来源、验收标准、版本、审批状态。
- `Task`：父任务、优先级、状态、依赖、验收标准、执行尝试。
- `Artifact`：类型、位置、内容哈希、关联 Git Commit、验证状态。
- `AgentDefinition`：角色、能力、Driver 配置；`AgentInstance`：活跃进程/连接。
- `Session`：交互容器；`Run`：任务执行；`Turn`：一次处理；`Step`：模型/工具阶段。
- `Handoff`：结构化交接；`Decision`：架构决策；`ProjectEvent`：不可变事实。

### 5.2 状态
- Task：`backlog → ready → running → review → done`，可转 `blocked/cancelled`；失败后可重排到 `ready`，必须保留 Attempt。
- Run：`created → queued → running → verifying → completed`；中途可进入 `waiting_tool/waiting_approval/suspended`；终态 `failed/cancelled`；未知副作用进入 `needs_reconciliation`。
- Approval：`pending → approved/rejected/expired/cancelled`。
- Handoff：`requested → accepted/rejected/expired`，接收成功不等于任务完成。
- 生命周期：`ideation/requirements/architecture/planning/implementation/testing/release/maintenance` 是可配置阶段，不要求单向线性流转。

**不变量**：一个任务最多有一个有效写 Lease；Task 依赖不能形成环；已完成任务的验收条件必须通过；Artifact 引用必须可追溯；状态更新必须携带预期版本；跨项目 Task 依赖默认禁止。

## 6. SQLite 关系模型与迁移

### 6.1 表清单
| 表 | 关键字段 | 索引/约束 |
|---|---|---|
| projects | id,name,root_path,status,version,created_at,updated_at | id PK；root_path 允许按策略唯一 |
| project_stages | id,project_id,stage_key,status,version | project_id+stage_key |
| requirements | id,project_id,title,body,status,version | project_id+status |
| milestones | id,project_id,title,due_at,status | project_id |
| tasks | id,project_id,parent_id,title,description,status,priority,version | project_id+status |
| task_dependencies | task_id,depends_on_id | composite PK；禁止 self-edge；应用检查环 |
| task_attempts | id,task_id,attempt_no,agent_id,status | task_id+attempt_no unique |
| task_leases | task_id,holder_id,fencing_token,expires_at | task_id PK；token 单调递增 |
| artifacts | id,project_id,task_id,kind,uri,content_hash,git_commit,verified_at | project_id+task_id |
| decisions | id,project_id,title,body,status,supersedes_id | project_id+status |
| agents | id,role,driver_id,capabilities_json | id PK |
| agent_instances | id,agent_id,session_id,status,last_seen_at | agent_id+status |
| sessions | id,project_id,agent_id,status,created_at,updated_at | project_id+updated_at |
| messages | id,session_id,seq,role,content_json,created_at | session_id+seq unique |
| agent_runs | id,task_id,session_id,attempt,status,checkpoint_id | task_id+attempt unique |
| run_steps | id,run_id,seq,kind,status,payload_json | run_id+seq unique |
| checkpoints | id,run_id,seq,schema_version,state_json,created_at | run_id+seq unique |
| project_events | id,project_id,seq,aggregate_id,event_type,payload_json | project_id+seq unique |
| outbox | id,event_id,destination,payload_json,status,attempts,next_attempt_at | status+next_attempt_at |
| agent_inbox | id,recipient_id,message_id,envelope_json,status,attempts | recipient_id+message_id unique |
| handoffs | id,task_id,from_agent_id,to_agent_id,status,payload_json | task_id+status |
| tool_calls | id,run_id,tool_name,idempotency_key,status,args_hash,result_json | run_id+idempotency_key unique |
| approvals | id,run_id,tool_call_id,status,request_json,decided_at | status+run_id |
| knowledge_entries | id,project_id,source_uri,source_version,body,status | project_id+status |
| plugin_installations | id,version,enabled,config_json | id PK |
| schema_migrations | version,applied_at,checksum | version PK |

所有时间统一 UTC 毫秒整数；ID 使用 UUIDv7 或 ULID（选一种并固定）；JSON 字段必须经过 Zod 校验，敏感凭据不得存入 JSON 明文。所有 FK 显式建立，`PRAGMA foreign_keys=ON`；启动时执行 `busy_timeout`、WAL 和迁移检查。

### 6.2 第一批迁移 SQL（关键表，其他表在 M2/M3 补齐）
```sql
CREATE TABLE projects (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 root_path TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active',
 version INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE tasks (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 parent_id TEXT REFERENCES tasks(id),
 title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'backlog',
 priority INTEGER NOT NULL DEFAULT 3,
 version INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX idx_tasks_project_status ON tasks(project_id,status);
CREATE TABLE task_dependencies (
 task_id TEXT NOT NULL REFERENCES tasks(id),
 depends_on_id TEXT NOT NULL REFERENCES tasks(id),
 PRIMARY KEY(task_id,depends_on_id),
 CHECK(task_id <> depends_on_id)
);
CREATE TABLE task_leases (
 task_id TEXT PRIMARY KEY REFERENCES tasks(id),
 holder_id TEXT NOT NULL,
 fencing_token INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE TABLE sessions (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 agent_id TEXT NOT NULL,
 status TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE project_events (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 seq INTEGER NOT NULL,
 aggregate_id TEXT NOT NULL,
 event_type TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(project_id,seq)
);
```

**事务模式**：`BEGIN IMMEDIATE` → 校验 expectedVersion 和 Lease fencing token → 修改状态与 Artifact → 追加 ProjectEvent → 插入 Outbox → `COMMIT`。失败回滚；Dispatcher 提交后重试投递；重复消费靠消息 ID 和幂等键去重。项目事件序号在事务内分配，不能通过非原子“读取最大值 + 自增”并发写入。

## 7. TypeScript 核心接口契约

### 7.1 Application Ports
```ts
export interface ProjectRepository {
  get(id: string): Promise<Project | null>;
  create(input: CreateProject): Promise<Project>;
  update(input: ProjectUpdate, expectedVersion: number): Promise<Project>;
}
export interface UnitOfWork {
  transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
}
export interface TaskLeaseService {
  acquire(taskId: string, holderId: string, ttlMs: number): Promise<{ token: number; expiresAt: number }>;
  renew(taskId: string, holderId: string, token: number): Promise<void>;
  release(taskId: string, holderId: string, token: number): Promise<void>;
}
```

### 7.2 Agent Driver
```ts
export type AgentDriverEvent =
  | { type: 'text.delta'; text: string }
  | { type: 'tool.request'; callId: string; tool: string; args: unknown }
  | { type: 'checkpoint'; state: unknown; schemaVersion: number }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'completed'; output: unknown }
  | { type: 'failed'; code: string; message: string };

export interface AgentDriver {
  readonly id: string;
  readonly capabilities: {
    nativeCheckpoint: boolean;
    toolInterception: boolean;
    resumeSession: boolean;
  };
  execute(ctx: AgentExecutionContext, signal: AbortSignal): AsyncIterable<AgentDriverEvent>;
  submitToolResult?(runId: string, callId: string, result: unknown): Promise<void>;
}
```

对于 Native Loop，工具请求后由 Runtime 分发并回送结果；对于外部 CLI Driver，只有具备 `toolInterception` 能力才可以按同一模式处理。能力缺失时降级为外部进程事件/结果观察，不得伪造可控工具调用。

### 7.3 插件接口
```ts
export type CapabilityKind = 'llm'|'agent-driver'|'tool'|'skill'|'memory'|'transport'|'workflow';
export interface PluginManifest {
 id: string; version: string; apiVersion: string;
 capabilities: CapabilityKind[];
 dependencies?: Record<string,string>;
 permissions?: string[];
}
export interface Disposable { dispose(): Promise<void> | void; }
export interface ProjectOSPlugin {
 manifest: PluginManifest;
 setup(context: PluginContext): Promise<Disposable | void>;
}
```

插件状态：discovered → validated → resolved → loaded → active → stopping → unloaded；异常进入 failed。插件权限在启用时单独授权。第三方 JS 不得在无隔离的 Runtime 中执行。

### 7.4 跨会话 Envelope
```ts
export interface CrossSessionEnvelope<T = unknown> {
 protocol: 'projectos.cross-session'; version: 1;
 messageId: string; idempotencyKey: string;
 projectId: string; taskId?: string; runId?: string;
 sender: { agentId: string; sessionId: string };
 recipient: { agentId: string; sessionId?: string };
 type: 'agent.message'|'task.delegate'|'task.accept'|'task.result'|
       'task.reject'|'handoff.request'|'handoff.accept'|'agent.wake'|'approval.request';
 correlationId?: string; causationId?: string;
 sequence?: number; createdAt: string; expiresAt?: string;
 payload: T;
}
export interface CrossSessionTransport {
 send(message: CrossSessionEnvelope): Promise<void>;
 subscribe(handler: (message: CrossSessionEnvelope) => Promise<void>): Promise<Disposable>;
 wake(target: { agentId: string; sessionId?: string }): Promise<{ accepted: boolean }>;
}
```

所有外部 Envelope 经过版本校验、身份解析、项目权限、消息大小限制和类型化 payload 校验。`agent.wake` 仅表示唤醒请求，不等于已领取任务。消息投递为至少一次；消费者幂等；无全局 Exactly-once 承诺。

## 8. Runtime 执行流程

### 8.1 Run 的生命周期
1. 接收 `run.start`，校验 Task 状态和权限，幂等创建 Run。
2. Scheduler 分配任务，获得 Task Lease，独立 Worktree（涉及代码写入时）。
3. Context Builder 加载项目规范、当前任务、有效 ADR、相关 Artifact、Git 版本与会话摘要。
4. Driver 开始执行；每条事件先持久化后广播 UI（高频 delta 可批量持久化，但必须明确丢失边界）。
5. Tool Dispatcher 校验路径、权限、审批、超时和幂等键，写入 ToolCall 意图；执行后记录结果。
6. 验证器按任务验收标准执行测试/检查，生成 Artifact；失败进入修复或人工审查。
7. 更新 Task/Run，追加事件，释放 Lease，必要时发起 Handoff。

### 8.2 恢复原则
- Runtime 启动扫描非终态 Run、过期 Lease、未 ACK Inbox、待处理 Outbox 和未决 ToolCall。
- `tool_call=started` 且外部副作用未知时进入 `needs_reconciliation`；不得自动重试危险命令。
- 仅对无副作用或具备明确幂等键/状态查询能力的工具自动重试。
- Checkpoint 含 `schemaVersion`、run/step 序号、Driver 能力信息和工作区 Git 引用；版本不兼容时拒绝恢复并说明原因。
- 外部 Agent 如果只支持会话重连，则恢复为“重新连接会话 + 加载结构化 Handoff”，不宣称恢复其内部推理状态。

### 8.3 Task Lease 与 Git
- 租约 token 必须单调递增，任何状态提交时校验最新 token（fencing）。
- 长任务周期性续约；失去 Lease 的执行者不能再提交任务状态。
- 多 Agent 写代码使用独立 Worktree；合并前运行冲突检测、测试与审批。
- 工作区根路径必须规范化并校验 realpath，防止 `../`、符号链接和路径穿越。

## 9. IPC 契约与前端交互

### 9.1 Preload 命名 API
```ts
export interface DesktopApi {
 projects: {
  list(): Promise<ProjectSummary[]>;
  create(input: CreateProjectInput): Promise<ProjectSummary>;
  open(id: string): Promise<ProjectDetail>;
 };
 tasks: {
  list(projectId: string): Promise<TaskSummary[]>;
  create(input: CreateTaskInput): Promise<TaskSummary>;
 };
 runs: {
  start(input: StartRunInput): Promise<{ runId: string }>;
  cancel(runId: string): Promise<void>;
  subscribe(runId: string, cb: (event: RunEvent) => void): () => void;
 };
 approvals: { decide(id: string, decision: 'approved'|'rejected'): Promise<void> };
}
```

Renderer 不暴露任意文件路径写入、任意命令执行或任意 IPC channel。Main ↔ Runtime 采用 requestId、协议版本、超时、错误码、事件序号；事件订阅必须在页面卸载时释放。断线重连通过 `lastSeenSeq` 补发关键事件，流式 token 可允许降级。

### 9.2 UI 页面
- 项目中心：项目创建/导入、最近项目、生命周期进度。
- 项目工作台：左侧导航（需求/任务/文件/知识），中部任务/代码，右侧 Agent 活动。
- Agent 会话：Ant Design X 流式消息、工具调用、审批卡片、引用 Artifact。
- 任务看板：状态、依赖、负责人、验收、运行记录。
- 执行审计：Run 时间线、工具记录、失败与恢复操作。

## 10. Skill Router / Context Builder / Policy

### 10.1 Skill Router
`Task Analyze → Capability Resolve → Candidate Search → Permission Filter → Select → Execute → Evaluate`。Manifest 至少包含 id、version、description、capabilities、triggers、requires.tools、permissions、outputs。不能仅凭 Skill 名称关键词匹配；保留候选、选择理由和结果评分日志。

### 10.2 上下文顺序
系统策略与用户当前指令 > 当前 Task/验收标准 > 项目 AGENTS.md/规则 > 有效 ADR > 相关 Artifact/Git 差异 > 相关历史摘要 > 检索知识。Context Builder 输出带来源 ID、版本、时间和 token 预算；被取代的 ADR 不得作为有效事实。

### 10.3 工具安全
- `read` 可按工作区策略自动允许；`write`、`shell`、`git push`、`deploy` 分别独立授权。
- Shell 默认要求审批（后续可添加经过审查的低风险白名单）。
- 执行有超时、输出大小上限、环境变量白名单、敏感字段脱敏。
- API Key 存 OS Keychain / Credential Manager，不存项目仓库、普通日志或明文 SQLite。
- 运行时可取消命令，退出时清理子进程树；隔离能力不足时 UI 必须显示真实风险。

## 11. 可靠性、可观测性与测试矩阵

| 测试 ID | 场景 | 通过标准 |
|---|---|---|
| T-001 | 新建项目后重启应用 | 项目、路径、阶段不丢失 |
| T-002 | 两个 Run 争抢同一 Task | 仅一个有效 Lease；旧 token 无法提交 |
| T-003 | 创建环形 Task 依赖 | 被拒绝且事务回滚 |
| T-004 | Outbox 投递后 ACK 丢失 | 重投不造成重复业务动作 |
| T-005 | Tool 已执行但结果未持久化时崩溃 | 标记待核对，不自动重复危险动作 |
| T-006 | Runtime 在 Run 中途退出 | Main 重启 Runtime，恢复安全状态 |
| T-007 | Renderer 发送未授权命令 | Main/Runtime 拒绝，写审计 |
| T-008 | 文件路径穿越或符号链接越界 | 拒绝访问工作区外目标 |
| T-009 | 外部 Agent 不支持原生 Checkpoint | 正确降级，明确标注能力 |
| T-010 | 开发 Agent → 测试 Agent Handoff | 接收方读取 Task/Artifact/Git 引用并验收 |
| T-011 | 数据库迁移中断 | 可恢复/回滚，不损坏旧数据 |
| T-012 | 不可信 Skill 请求 Shell 权限 | 未授权前不能执行 |

测试分层：Domain/State Machine 单测；SQLite/IPC/Transport 契约测试；临时 Git 项目集成测试；Electron Playwright E2E；故障注入恢复测试。CI 必须运行 `lint`、`typecheck`、`test`、`build`，M4 起增加恢复测试。

## 12. 实施计划：按依赖顺序交付

### M1 — 工程骨架与本地项目持久化（P0）
**任务**：
- M1-01 初始化 pnpm workspace、Turbo、TypeScript strict、ESLint/Prettier、Vitest。
- M1-02 创建 Electron Main/Preload/React Renderer；完成 CSP、安全窗口配置。
- M1-03 创建 Node Runtime 子进程、Supervisor、握手/心跳/退出处理。
- M1-04 定义 `contracts`、Zod IPC Schema、错误码和 typed client。
- M1-05 SQLite 初始化、迁移、Project Repository 和 Create/List/Open Project。
- M1-06 项目中心 UI + 重启恢复 E2E。
**验收**：桌面应用可运行；无网络端口；新建项目重启后可见；Renderer 无 Node 权限；lint/typecheck/test/build 通过。

### M2 — 单 Agent 可审计执行（P0）
- M2-01 Task/Session/Run 数据表与状态机。
- M2-02 Native Agent Driver + 至少一个 LLM Provider；密钥安全存储。
- M2-03 Context Builder 最小实现；会话消息持久化。
- M2-04 Tool Registry + Policy + Approval；受控文件读写、Git、Shell。
- M2-05 Run Event/ToolCall/Checkpoint + 流式 AI UI。
- M2-06 任务执行/取消/超时/失败审计集成测试。
**验收**：Agent 能在临时测试项目完成经审批的文件修改和测试，记录所有执行步骤。

### M3 — 项目生命周期与交付物（P0）
- M3-01 Requirement、Milestone、Artifact、Decision 数据与页面。
- M3-02 Workflow Definition、Stage Guard、Quality Gate。
- M3-03 Task DAG、版本并发控制、验收检查。
- M3-04 知识条目、有效 ADR 与检索（先 SQLite FTS）。
**验收**：需求 → 任务 → 代码 → 测试 → Artifact → 审批有完整追踪链。

### M4 — 跨会话与多 Agent（P1）
- M4-01 Agent Identity/Instance/Session 区分。
- M4-02 Durable Inbox/Outbox、ACK、重试、幂等。
- M4-03 Handoff、Task Lease fencing、Worktree。
- M4-04 重启恢复与故障注入；外部 Agent Driver 的能力协商。
- M4-05 OCS Adapter（在核实平台支持后可选）。
**验收**：两个独立 Agent 会话完成开发→测试交接；崩溃重启不丢任务，不重复危险操作。

### M5 — 插件、Skill 与产品化（P1）
- M5-01 Kernel、Manifest、Capability Registry、Profile。
- M5-02 Skill Discovery/Router 与执行评估。
- M5-03 安全策略增强、插件进程隔离、诊断和备份。
- M5-04 Windows 安装包、迁移、更新与完整 E2E。
**验收**：可配置能力组合，安装包可安装/卸载/恢复，核心测试全部通过。

**任务执行原则**：每个任务拆分为 0.5–2 天可验收的增量；依赖前序任务未通过时，不开始下游开发。禁止在 M1 阶段创建空的远程服务和未经验证的 Agent Provider。

## 13. AI 编码任务模板

```markdown
# TASK-ID: M1-03
## 目标
创建 Electron Main 监管的 Node Runtime 子进程及类型化 IPC。
## 前置条件
M1-01、M1-02、M1-04 的基础契约（可先完成最小握手 Schema）。
## 修改范围
apps/desktop/src/main/runtime-supervisor/**
apps/runtime/src/**
packages/contracts/src/**
tests/integration/runtime-ipc/**
## 接口
runtime.hello(version), runtime.health(), runtime.shutdown()
## 验收
1. Main 启动 Runtime 并完成版本握手。
2. Runtime 异常退出后可按退避策略重启，不出现无限快速重启。
3. Main 关闭时清理 Runtime 子进程。
4. 不开放 HTTP 监听端口。
5. 包含握手超时、进程崩溃、协议版本不匹配测试。
## 完成定义
提交代码、测试、变更说明；运行 lint/typecheck/test/build 并报告结果。
```

## 14. 仓库根目录 AGENTS.md 建议内容

```markdown
# ProjectOS AI Development Rules
- Read `docs/ProjectOS_实施设计说明书_v1.0.md` before changes.
- Follow approved ADRs; propose an ADR for breaking changes.
- Implement only the assigned task and its required dependencies.
- TypeScript strict; Zod at process and trust boundaries.
- Renderer must never access Node, SQLite, filesystem or Shell directly.
- Domain and application must not depend on Electron, Drizzle or LLM SDKs.
- Persist task/run/session state; do not use chat history as source of truth.
- Use policy checks, approvals and audit for side-effecting tools.
- Never blindly retry unknown external side effects after crash.
- Add tests for state transitions, IPC, persistence and failure paths.
- Before marking done run lint, typecheck, tests and build; report actual results.
- Do not invent APIs, tool capabilities or test outcomes.
```

## 15. 未决问题与变更管理

以下决策需要在对应里程碑启动前确认，不能擅自默认：
1. 首个模型 Provider 及凭据获取方式（M2）；默认可先实现可配置 OpenAI-compatible Provider，但须经用户确认。
2. 首个外部 Agent 适配目标及其真实 SDK/CLI 版本（M4）。
3. Windows/macOS/Linux 的首发支持矩阵与打包签名策略（M5）。
4. 本地插件的可信签名、更新机制和进程隔离实现（M5）。
5. 数据备份加密与完整项目迁移格式（M5）。

变更流程：提出 ADR → 描述问题、备选方案、兼容性影响、数据迁移、安全影响、测试计划 → 审批 → 更新本说明书与任务依赖 → 实施。

## 16. 参考与集成核查

- DeepSeek Harness：参考插件容器、Profile/Bundle、事件和副作用清理思想；**不假设内部包结构可直接复用**。
- leeguooooo/open-cross-session：参考会话身份、持久消息、唤醒与交接；通过 Adapter 集成，**不作为 ProjectOS 权威数据库**。
- Electron 安全指南、Ant Design X、Drizzle、pnpm/Turbo 的具体 API 与版本在实际开发时以官方文档和 lockfile 为准。

**最终交付要求**：每个里程碑必须同时提交代码、迁移、自动化测试、简短使用说明和可重复的验收步骤。未通过验收不得宣布完成。

## 17. UI/UX 视觉设计系统（强制实施规范）

> 本章为架构级强制要求，优先级与类型安全、可恢复性、执行安全同级。视觉参考 Apple 官网及 macOS 的设计语言，但不得复制其商标、图片、具体页面或受保护素材。设计目标为“现代极简、层次清晰、克制玻璃拟态、专业工作台”。不得把简单套用 Ant Design 默认主题视为完成 UI 设计。

### 17.1 设计原则和禁止事项

1. **内容优先**：清晰的项目进度、任务、Agent 状态和可执行操作高于装饰；不使用占据首屏的大幅欢迎标题。
2. **克制玻璃拟态**：玻璃效果主要用于侧边栏、顶栏、悬浮工具条、Popover、Modal；表格、代码编辑器、终端、长文档采用不透明或近不透明背景。
3. **一致的视觉层级**：统一字号、间距、圆角、阴影、边框、图标与状态色，禁止页面自行定义任意视觉常量。
4. **动效表达状态**：过渡要帮助用户理解导航、反馈、执行进度，禁止无意义循环动效与强烈视差。
5. **跨平台一致性**：Windows 11 首要验收；macOS/Linux 保持统一组件语义，原生标题栏与窗口控件遵循平台惯例。
6. **专业信息密度**：项目管理需要多栏、多任务和长时间使用，不得为追求“苹果风”牺牲可读性与操作效率。

### 17.2 设计令牌（Design Tokens）

所有令牌由 `packages/design-tokens` 统一输出 TypeScript、CSS variables 和 Ant Design Theme Config。下面是首版建议值，可通过视觉验收调整，但不得各页面自行改写。

| 令牌 | Light | Dark | 用途 |
|---|---|---|---|
| `--color-canvas` | `#F5F6F8` | `#0B0D12` | 主背景 |
| `--color-surface` | `#FFFFFF` | `#151820` | 内容面板 |
| `--color-surface-raised` | `#FFFFFF` | `#1C202A` | 提升层级 |
| `--color-text-primary` | `#17191E` | `#F5F6F8` | 主文字 |
| `--color-text-secondary` | `#626A78` | `#A3ACBA` | 次级文字 |
| `--color-accent` | `#1677FF` | `#69A8FF` | 操作强调色 |
| `--color-border` | `rgba(20,30,50,.10)` | `rgba(255,255,255,.12)` | 边界 |
| `--glass-bg` | `rgba(255,255,255,.70)` | `rgba(24,28,38,.68)` | 玻璃表面 |
| `--glass-border` | `rgba(255,255,255,.55)` | `rgba(255,255,255,.14)` | 玻璃描边 |
| `--radius-sm/md/lg/xl` | `8/12/16/24px` | 同 Light | 圆角阶梯 |
| `--space-*` | `4px` 基准的 `4/8/12/16/24/32/48` | 同 Light | 间距阶梯 |
| `--blur-glass` | `18px` | `18px` | 玻璃模糊 |
| `--motion-fast/base/slow` | `120/200/320ms` | 同 Light | 动效时长 |

字体：优先系统字体栈 `-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif`；代码使用 `Consolas, "SFMono-Regular", monospace`，不随应用打包未经许可的字体。正文 14px 起，辅助文字通常不低于 12px；主要页面标题 24–32px，局部区块标题 16–20px。行高正文建议 1.5–1.65。

### 17.3 玻璃材质实现规范

- 仅在背景确实有层次时启用 `backdrop-filter`，提供不支持或性能受限环境的纯色回退。
- 玻璃表面应同时具备半透明填充、轻描边、适度模糊、微弱阴影；不使用大面积高饱和渐变作为底图。
- 文字与交互控件必须保持足够对比度；玻璃背景上的文字不能依赖底层内容碰巧足够暗或亮。
- 代码编辑、表格、终端、Diff、审批详情必须使用稳定高对比背景。
- 用户启用系统减少透明度或高对比度模式时，关闭透明玻璃材质并使用实体背景。

```css
:root {
  --glass-bg: rgba(255,255,255,.70);
  --glass-border: rgba(255,255,255,.55);
  --glass-blur: 18px;
}
[data-theme="dark"] {
  --glass-bg: rgba(24,28,38,.68);
  --glass-border: rgba(255,255,255,.14);
}
.glass-panel {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(var(--glass-blur)) saturate(1.25);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.25);
  box-shadow: 0 8px 32px rgba(10,20,40,.08);
  border-radius: 16px;
}
@media (prefers-reduced-transparency: reduce) {
  .glass-panel { backdrop-filter: none; -webkit-backdrop-filter: none; background: var(--color-surface); }
}
@supports not (backdrop-filter: blur(1px)) {
  .glass-panel { background: var(--color-surface); }
}
```

注意：`prefers-reduced-transparency` 在部分平台/浏览器不支持；还应在应用设置中提供手动“减少透明度”选项，确保可控回退。

### 17.4 页面信息架构与布局

桌面默认工作台采用：左侧项目导航（约 232–264px，可折叠）＋中央主内容（自适应，优先保证编辑器/看板空间）＋右侧 Agent 活动/上下文检查器（约 300–360px，可关闭）。顶部提供轻量标题栏、全局搜索、命令面板入口、项目切换和任务状态；底部状态栏展示 Git 分支、Runtime 状态和同步/索引状态。右侧面板不应始终占用空间，窄窗口自动收起。

首版至少设计并实现以下真实功能页面，不允许只有概念图或静态占位：

| 页面 | 核心组件 | UI 特别要求 |
|---|---|---|
| 项目总览 | 项目摘要、里程碑、进度、近期活动 | 信息分组清晰，禁止巨型欢迎 Banner |
| 任务看板 | Kanban、过滤、任务详情、依赖关系 | 状态色克制、拖拽反馈明确 |
| Agent 工作台 | Ant Design X 消息、工具步骤、审批、输入区 | 流式状态明确、工具过程可展开 |
| 工作区 | 文件树、Monaco、Diff、终端 | 不透明编辑区、稳定字体与快捷键 |
| 跨会话中心 | Agent 身份、收件箱、交接记录、恢复入口 | 清晰区分消息已送达/已接受/已完成 |
| 项目设置 | Provider、插件、权限、外观 | 重要危险设置有二次确认 |

### 17.5 组件规范与技术实现

- `packages/design-tokens`：定义主题变量、暗黑模式、间距、层级、阴影和动效令牌。
- `packages/ui`：封装 `AppShell`、`GlassPanel`、`PageHeader`、`ProjectCard`、`StatusPill`、`EmptyState`、`LoadingSkeleton`、`CommandPalette`、`InspectorPanel` 等通用组件。
- `packages/ai-ui`：封装 Ant Design X 的会话流、Agent 活动流、工具执行记录、审批卡片和消息输入区。
- `apps/desktop/src/renderer/features/*`：只组合通用组件，不允许直接散落玻璃 CSS、硬编码色值和独立阴影方案。
- 通过 Ant Design `ConfigProvider` 统一 token、算法和组件覆盖；使用 CSS variables 处理 Ant Design 无法覆盖的视觉材质。禁止大范围 `!important` 覆盖。
- 所有可交互组件提供 hover、focus-visible、active、disabled、loading、error、empty 状态；异步操作提供 Skeleton 或进度反馈。

### 17.6 动效、响应式与无障碍

- 过渡时间：轻反馈约 120ms，普通页面元素约 200ms，面板开合约 240–320ms；采用平滑但克制的 easing。
- 尊重 `prefers-reduced-motion`，减少动画时关闭大范围位移、缩放和视差。
- 窗口宽度 ≥ 1440px 支持三栏；约 1024–1439px 默认两栏；小于约 1024px 侧边栏折叠、检查器改抽屉。具体断点以内容不溢出为验收依据。
- 正文/交互文本对比度以 WCAG AA 为目标：普通文字至少 4.5:1，大文字至少 3:1；键盘焦点清晰可见。
- 触控友好目标尺寸优先达到 40×40px 左右；桌面紧凑表格可根据使用场景优化，但不可造成误触。
- 主题支持 `light`、`dark`、`system`，切换后保持可读性并持久化用户选择。

### 17.7 AI 编码 Agent 的 UI 强制工作流

1. 实现 UI 前先阅读本章、设计令牌和现有组件库；新增样式优先复用 Token。
2. 每个页面先定义信息架构、主次操作、空/加载/错误/成功状态，再写 JSX。
3. 至少提交桌面 1440×900、窄窗口 1024×768 两种尺寸的实际截图；同时验证 Light 和 Dark。
4. 不得使用未授权的 Apple 图片、Logo 或其他受保护素材；可借鉴布局、留白、材质和交互理念。
5. 不得用静态假数据掩盖未实现的 API；演示数据必须明确标注 Demo，真实功能必须连接实际状态。
6. 完成页面后运行 lint、typecheck、组件测试、必要的 Playwright 截图/交互测试，并记录真实执行结果。
7. 若视觉验收失败（溢出、错位、低对比、毛玻璃导致文字不清、主题不一致），不得标记 UI 任务完成。

### 17.8 UI 验收清单（M1 起生效）

- [ ] 统一设计令牌，无页面级随意色值/阴影/圆角。
- [ ] 首页简洁、项目数据优先，无大面积空洞 Hero 区。
- [ ] 玻璃拟态只用于合适表面，代码/表格/终端保持清晰。
- [ ] Light/Dark/System 三模式正常，主题切换无明显闪烁。
- [ ] 1440×900、1024×768 无横向溢出，侧栏和检查器可折叠。
- [ ] 交互具备键盘焦点、Loading、Empty、Error 和权限拒绝反馈。
- [ ] 常用页面切换和面板开合流畅；低性能环境有减少透明度/动效回退。
- [ ] 截图经过人工或视觉评审，严重布局缺陷为零。

### 17.9 里程碑更新与任务依赖

- **M1 新增**：设计令牌、Ant Design Theme、AppShell、GlassPanel、深浅主题、项目总览真实页面、双尺寸截图验收。
- **M2 新增**：Ant Design X 聊天/工具步骤/审批组件视觉规范与流式反馈。
- **M3 新增**：任务看板、里程碑、需求与交付物页面的统一视觉设计。
- **M4 新增**：跨会话中心、Agent 状态、消息投递和交接视图。
- **M5 新增**：完整视觉回归、无障碍检查、减少透明度/动效、跨平台窗口适配。

**新增验收门槛**：功能测试通过但 UI 视觉验收不通过，里程碑不得标记为完成。UI 质量是正式交付条件，而不是后期美化任务。
