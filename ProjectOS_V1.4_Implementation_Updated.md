# ProjectOS V1.4 — 自主项目运营与持续交付实施设计说明书

> 版本：1.4.0｜性质：供 AI 编程 Agent 执行的增量开发规范｜前置：V1.3 需审计确认，不假定已全部完成。
> 目标：项目健康检测 → 有证据的问题发现 → 去重与优先级 → 风险评估和授权 → 调度 → 隔离修复 → 验证 → 审批 → 项目状态更新。
> 核心原则：Local-first、默认不自主修改、用户可控、事件可追溯、可中断恢复、不得伪造执行结果。

## 0. AI 开发 Agent 强制指令

1. **先审计**：扫描当前仓库、V1.3 任务 DAG、Agent Runtime、跨会话、Worktree、Policy、SQLite、事件总线和 React Flow 画布，生成 `docs/audits/v1.4-baseline.md`，逐项标注 `existing / partial / missing` 与证据路径；不假设已有模块均可用。
2. **仅增量开发**：沿用 TypeScript、Node.js、Electron、React、Ant Design、Ant Design X、pnpm/Turborepo；不新建平行任务引擎、第二套数据库、第二套 Agent 图。
3. **权限默认收紧**：默认监测仅只读；自动文件修改必须获得范围明确的授权并使用隔离 Worktree；合并主分支、部署、删除数据、外部通知始终需要显式审批。
4. **无假数据**：禁止随机健康评分、模拟修复结果、定时器伪进度；所有 UI 状态必须来自实际数据库事件和检测记录。演示模式必须显式标注。
5. **失败可见**：未知/未运行的检查不能显示为通过；缺少凭据或环境时应给出阻塞原因。
6. **每个里程碑**：交付代码、迁移、测试、截图、运行命令、验收证据、遗留风险；未通过测试不能声称完成。
7. **UI 极简**：Apple 式简约、克制玻璃拟态、深浅色主题；删除营销、功能解释、重复副标题；保留关键权限/危险操作提示。
8. **Windows 优先**：进程管理、路径、Git、计划任务不得假定 Bash、systemd 或 POSIX 信号可用。

## 1. 范围与验收目标

### 1.1 P0
- 健康检查：Git 状态、构建、测试、Lint、项目任务阻塞；通过插件扩展依赖安全与 CI。
- 问题发现：检查结果生成 Evidence-backed Finding，带来源、文件、时间、版本、严重度和置信度。
- 问题去重：同项目、同规则、同证据指纹复用 Finding，保留发生历史。
- 自主执行策略：observe / propose / approved-autofix 三种模式，默认 observe；风险分级和人工审批。
- 持久化调度：手动、间隔、项目事件触发；任务队列、幂等、重试、取消、暂停、重启恢复。
- 修复闭环：Finding → Proposal → Approval → Task DAG → Worktree → Developer → Tester/Reviewer → Result。
- 自主运营工作台：监测状态、发现问题、执行链、审批、运行记录、成本与失败原因。

### 1.2 P1
- Git hooks/CI 事件接入（本地或经授权的远程 API）；依赖版本与安全告警；版本候选与 Changelog 草稿；Token 预算/并发限额；趋势图。

### 1.3 非目标
- 无人值守生产发布、跨机器常驻守护、自动合并主分支、自动删除数据、无限重试、自行扩大权限、完整云端 SaaS。

### 1.4 最终验收场景
在本地真实 Git 项目中植入一个可复现的失败测试；用户启用健康检查后系统记录失败证据、创建去重 Finding 和修复提案；用户授权限定范围后，在独立 Worktree 中修复，运行真实测试并由 Reviewer 检查；提交候选结果供用户审批合并。重启 Electron 后，问题、任务、审批和图节点状态可恢复。没有审批不得写入主分支。

## 2. 架构与进程边界

```text
Electron Renderer (React + Ant Design + Ant Design X + @xyflow/react)
  ├─ Operations Dashboard / Findings / Approvals / Execution Graph
  └─ Typed Preload IPC
Electron Main: IPC 验证、窗口管理、Runtime Supervisor
Node Runtime (唯一业务写入者)
  ├─ Health Engine → Check Runner Registry → Git/Build/Test/Lint Adapters
  ├─ Finding Engine → Evidence Store / Fingerprint / Dedup
  ├─ Proposal Engine → Risk Classifier / Policy / Approval
  ├─ Trigger Engine → Scheduler / Durable Queue / Outbox
  ├─ Autonomous Coordinator → V1.3 Orchestrator / Task DAG / Agent Drivers
  ├─ Repair Loop → Worktree / Verification / Reviewer
  ├─ Budget Guard → Token / Time / Concurrency / Retry
  └─ SQLite → Events / Checkpoints / Findings / Plans / Runs
```

**依赖约束**：`domain` 不 import Electron/SQLite/Provider；`application` 通过接口调用检测器、策略、存储；`autonomy` 不直接执行 shell，必须走 V1.3 Tool Dispatcher/Policy；前端不能直读数据库；后台服务为可选扩展，默认关闭应用即停止调度。

## 3. Monorepo 增量目录

```text
packages/
  operations-contracts/src/{commands,events,schemas}/
  health-engine/src/{checks,runners,registry,aggregation}/
  finding-engine/src/{evidence,fingerprint,dedup,triage}/
  autonomy-policy/src/{risk,grants,guards}/
  trigger-engine/src/{scheduler,triggers,queue,leases}/
  autonomous-coordinator/src/{proposal,dispatch,repair,verification}/
  budget-guard/src/{usage,limits,circuit-breaker}/
  operations-persistence/src/{schema,repositories,migrations}/
  operations-ui/src/{dashboard,findings,approval,graph-nodes}/
  integrations/{git-events,ci-adapter,dependency-check}/
apps/desktop/src/renderer/features/operations/
apps/runtime/src/services/operations/
tests/{operations-integration,operations-recovery,operations-e2e}/
```

若现有仓库已存在相同能力包，优先复用并在原包增加模块；上面为逻辑目录而非强制创建全部新包。

## 4. 领域模型与状态机

**HealthCheckDefinition**：`id, version, kind, commandSpec, timeoutMs, risk, supportedPlatforms`。
**HealthCheckRun**：`id, projectId, definitionId, sourceRevision, status, startedAt, finishedAt, evidenceIds`；状态 `queued/running/passed/failed/error/cancelled/skipped`。
**Finding**：`id, projectId, fingerprint, category, severity, status, firstSeenAt, lastSeenAt, occurrenceCount, evidenceIds`；状态 `open/triaged/proposed/in_progress/resolved/ignored/reopened`。
**Proposal**：`id, findingIds, scope, estimatedRisk, requiredPermissions, acceptanceCriteria, status`；状态 `draft/pending_approval/approved/rejected/expired/executing/completed/failed`。
**AutomationRun**：`id, triggerId, proposalId, taskId, status, attempt, leaseToken, startedAt, finishedAt`；状态 `queued/running/waiting_approval/verifying/paused/completed/failed/cancelled/reconciliation_required`。

禁止以单一健康分数掩盖未知项；如展示评分，必须有明确公式、样本覆盖率和不可评估项，初期可不展示总分。

## 5. SQLite 迁移规范与示例

- 迁移编号沿用当前项目体系；新增字段采用可回滚策略；保留 `created_at/updated_at`、外键、索引、唯一约束。
- 与 V1.3 的 `tasks`、`agent_runs`、`project_events`、`approvals` 通过 ID 关联，不重复定义。
- 事件、Finding 更新、Outbox 写入同一事务；工具副作用在事务外且必须可对账。

```sql
CREATE TABLE health_check_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  check_id TEXT NOT NULL,
  source_revision TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued','running','passed','failed','error','cancelled','skipped')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  result_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_health_project_time ON health_check_runs(project_id, started_at DESC);

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  fingerprint TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE(project_id, fingerprint)
);
CREATE TABLE finding_evidence (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  check_run_id TEXT REFERENCES health_check_runs(id),
  source_uri TEXT,
  source_revision TEXT,
  excerpt TEXT,
  content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE repair_proposals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  acceptance_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE proposal_findings (
  proposal_id TEXT NOT NULL REFERENCES repair_proposals(id),
  finding_id TEXT NOT NULL REFERENCES findings(id),
  PRIMARY KEY(proposal_id, finding_id)
);
CREATE TABLE automation_triggers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,
  config_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  next_run_at INTEGER,
  UNIQUE(project_id, id)
);
CREATE TABLE automation_runs (
  id TEXT PRIMARY KEY,
  trigger_id TEXT REFERENCES automation_triggers(id),
  proposal_id TEXT REFERENCES repair_proposals(id),
  task_id TEXT REFERENCES tasks(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_token INTEGER,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX idx_automation_runs_status ON automation_runs(status);
```

补充表：`automation_grants`（授权范围/过期/撤销）、`automation_run_events`（审计）、`budget_limits`（额度）、`budget_usage`（实际消耗）；如既有 Policy/Events 表支持则扩展原表，禁止双写。

## 6. TypeScript 核心接口

```ts
export type CheckStatus = 'passed'|'failed'|'error'|'skipped';
export interface HealthCheckContext {
  projectId: string;
  workspacePath: string;
  revision?: string;
  signal: AbortSignal;
}
export interface CheckEvidence {
  uri?: string;
  revision?: string;
  excerpt?: string;
  contentHash: string;
}
export interface HealthCheckResult {
  checkId: string;
  status: CheckStatus;
  durationMs: number;
  evidence: CheckEvidence[];
  diagnosticCode?: string;
}
export interface HealthCheckRunner {
  id: string;
  supports(ctx: HealthCheckContext): Promise<boolean>;
  run(ctx: HealthCheckContext): Promise<HealthCheckResult>;
}
export type AutonomyMode = 'observe'|'propose'|'approved-autofix';
export interface AutomationGrant {
  projectId: string;
  allowedActions: string[];
  allowedPaths: string[];
  expiresAt: string;
  maxRuns: number;
  revokedAt?: string;
}
export interface RiskDecision {
  level: 'low'|'medium'|'high'|'critical';
  allowed: boolean;
  requiresApproval: boolean;
  reasons: string[];
}
export interface AutomationTrigger {
  id: string;
  projectId: string;
  kind: 'manual'|'interval'|'git-change'|'test-failure'|'build-failure';
  config: unknown;
}
export interface OperationsService {
  runChecks(projectId: string, checkIds?: string[]): Promise<string>;
  listFindings(projectId: string): Promise<unknown[]>;
  proposeRepair(findingIds: string[]): Promise<string>;
  approveProposal(proposalId: string, grant: AutomationGrant): Promise<void>;
  cancelAutomation(runId: string): Promise<void>;
}
```

具体 `unknown` DTO 必须在实现时以 Zod Schema 替换；跨进程 payload 做版本化验证。每个执行器必须支持 `AbortSignal`、超时和进程树清理。

## 7. 检测、证据与去重

1. **Check Registry**：只允许用户配置或内置受信任的检测命令；不允许模型直接把生成文本当 Shell 命令自动运行。
2. **Evidence**：记录执行命令 ID、退出码、标准输出摘要、相关文件/行号、Git SHA、时间戳；日志先脱敏再落库。
3. **Fingerprint**：推荐 `hash(projectId + checkId + normalizedLocation + normalizedErrorCode)`；避免将绝对路径、时间戳纳入指纹。
4. **Dedup**：已存在 Finding 更新 `lastSeenAt`、`occurrenceCount` 和证据；修复后同指纹再出现标记 `reopened`。
5. **Triage**：优先级基于严重度、可复现性、受影响范围；AI 判断为建议，不能覆盖原始证据。
6. **安全**：依赖安全检查若依赖在线服务必须明确告知数据发送范围；无网络时显示 unavailable，不假装扫描成功。

## 8. 自主权限与审批矩阵

| 行为 | 默认模式 | 执行条件 |
|---|---|---|
| 读取仓库、Git 状态、静态检查 | observe | 项目已授权读取 |
| 运行既定构建/测试命令 | observe | 用户启用检测、命令白名单、资源限制 |
| 创建 Finding、Proposal | propose | 有可追溯证据 |
| Worktree 内修改文件 | approved-autofix | 有效范围授权 + 路径检查 |
| 安装依赖、联网访问 | 单独授权 | 显示目的、目标与风险 |
| 合并主分支、推送、发布、删除数据 | 强制人工审批 | 每次明确确认，不能长期免审批 |

所有权限检查必须在实际 Tool Dispatcher 执行前再次验证；UI 隐藏按钮不是权限控制。授权支持撤销、过期、次数上限和路径限制。拒绝或过期时进入等待审批，不得自行降级绕过。

## 9. 调度与故障恢复

- 调度触发：手动优先；间隔任务使用持久化 `next_run_at`；Git 变化采用防抖、版本去重；失败事件有循环抑制。
- 单实例队列：SQLite 持久化；`BEGIN IMMEDIATE` 抢占租约，fencing token 防止过期持有者提交。
- 重试：只重试可证明幂等的检测/查询；文件修改、Git 操作等副作用必须先对账。
- 限制：默认每个 Finding 最多 2 次自动修复尝试；单次运行时间、Token 和费用预算可配置；连续失败触发熔断。
- 重启：检查 `running` 的 AutomationRun、工具调用日志和 Worktree 状态；不能确定结果时转 `reconciliation_required`，不得盲目重放。
- 后台：MVP Electron 关闭即停止；若未来实现常驻服务，必须另行设计权限、安装/卸载和升级。

## 10. 修复闭环与质量关卡

```text
Check Failed → Evidence → Finding (dedup) → Repair Proposal
   → Risk & Scope Validation → Approval → Task DAG
   → Isolated Git Worktree → Developer Agent → Real Tests
   → Reviewer Agent → Candidate Patch → Human Merge Approval
   → Update Finding/Artifacts/Project Memory
```

- 必须使用 V1.3 Orchestrator/Agent Driver，不新造调度器。
- 修复计划包含修改范围、受影响文件、回滚方案、测试命令、验收条件、预估预算。
- 验收以真实退出码、测试报告、差异和 Reviewer 记录为依据。
- 测试失败最多按配置回到规划/修复，超过次数停止并保留失败证据。
- 完成候选不等于已合并；未经用户批准不得修改主分支。

## 11. 自主运营可视化工作台

### 11.1 页面结构
- 左侧：项目导航（项目、任务、Agents、自主运营）。
- 顶部：项目名称、监测开关、最近运行时间、当前模式、暂停入口。
- 中央：健康检查结果、Finding 列表、可筛选的执行流程画布。
- 右侧 Inspector：选中 Finding/Agent/Proposal 后显示证据、日志、文件变更、审批操作。
- 底部可折叠：事件时间线、失败诊断、预算用量。

### 11.2 复用 V1.3 React Flow

```text
[Git Change] ─┐
[Test Failure] ├─> [Health Monitor] ─> [Finding] ─> [Planner]
[Schedule] ───┘                                    │
                                               [Approval]
                                                   │
                                          [Orchestrator]
                                             /       \
                                      [Developer]  [Tester]
                                             \       /
                                             [Reviewer]
                                                 │
                                          [Candidate Patch]
                                                 │
                                          [Merge Approval]
```

- 新节点：`TriggerNode`、`HealthCheckNode`、`FindingNode`、`ApprovalNode`、`QualityGateNode`、`CandidatePatchNode`。
- 边类型：`trigger`、`dependency`、`delegation`、`verification`、`approval`；状态与 Runtime 事件映射。
- 节点点击打开 Inspector；支持缩放、Minimap、自动布局、持久化位置；不得使用假进度。
- 采用 Apple 式现代简约 + 克制玻璃拟态；节点颜色仅表达真实状态；避免霓虹堆叠和低对比度文字。
- 去解释化：页面不显示“通过智能协作提高效率”等营销/教学段落；安全提示、空状态和错误原因必须保留。

### 11.3 IPC 命令
`operations.checks.run`、`operations.findings.list`、`operations.proposals.create`、`operations.proposals.approve`、`operations.runs.pause`、`operations.runs.cancel`、`operations.events.subscribe`；均需 Zod 校验与项目级授权。

## 12. 可观测性与预算

- 每次 Check/AutomationRun 记录 traceId、projectId、taskId、agentId、执行耗时、错误码、Token、估算成本。
- 费用按 Provider 返回的实际用量优先；缺少价格/用量时标记未知，禁止填 0 伪装免费。
- 预算控制：每项目日预算、单任务预算、最大并发、最大运行时长、修复循环上限。
- 敏感信息（Key、Token、环境变量）不得进入日志、Evidence、截图、事件 payload。

## 13. 里程碑与交付标准

| 里程碑 | 实施内容 | 验收 |
|---|---|---|
| M1.4-00 | 代码审计与兼容性评估 | `docs/audits/v1.4-baseline.md` 含证据路径 |
| M1.4-01 | 健康检查引擎 | 实际运行构建/测试，保存退出码与证据 |
| M1.4-02 | Finding 与去重 | 同问题重复扫描不产生重复未关闭 Finding |
| M1.4-03 | 风险策略与授权 | 未授权写入/合并均被 Runtime 拦截 |
| M1.4-04 | 持久化触发器与队列 | 重启后恢复计划，重复事件幂等 |
| M1.4-05 | Worktree 修复与验证 | 真实失败测试被修复且生成候选补丁 |
| M1.4-06 | Git/CI 事件与预算 | 事件可追溯、额度触发停止 |
| M1.4-07 | Operations UI 与流程图 | 真实事件驱动，点击节点可查看证据 |
| M1.4-08 | 恢复/安全/E2E | 故障注入测试通过，无越权操作 |

## 14. 必测用例

1. 健康检查失败产生包含来源 SHA、退出码的 Evidence。
2. 同一错误重复检测只更新一个 Finding；修复后再现可 reopened。
3. 仅 observe 模式下不允许修改任何项目文件。
4. 提案未审批时无法进入写入型 Tool Dispatcher。
5. 授权过期、撤销、路径越界均阻止执行。
6. 两个触发器同时到达，同一幂等键只生成一次运行。
7. Runtime 在工具成功后、数据库记录前崩溃，恢复必须对账而非盲目重放。
8. Git Worktree 中的修复不影响主分支；合并必须再次人工确认。
9. 测试失败触发有限次数重试，达到上限后停止。
10. Token/时间/并发限制可阻止继续执行。
11. 无网络、无命令、无凭据时显示 skipped/error，不显示 passed。
12. Electron 重启后事件、Finding、审批、图布局可恢复。
13. Windows 11 下路径、进程树清理、Git Worktree 操作正确。
14. UI 无冗余解释性文案，保留关键权限和错误提示。

## 15. AI 实施与验收报告模板

每个里程碑结束必须提交：

```text
Milestone:
Baseline evidence:
Changed files:
Schema migrations:
Commands executed:
Tests passed / failed / skipped:
UI screenshots (real runtime):
Security and approval checks:
Known limitations:
Next milestone dependencies:
```

执行顺序：审计 → 设计差异确认 → 数据模型/Contracts → 后端能力 → IPC → UI → 自动化测试 → 故障注入 → 文档更新。若现有 V1.3 能力不满足前置条件，先修复前置缺陷并报告，不得以 Mock 冒充完成。

## 16. 完成定义（Definition of Done）

- 所有 P0 能力有真实运行证据；数据库迁移可在现有用户数据上安全升级。
- 用户可以关闭自主运行并撤销授权；高风险操作不自动执行。
- 失败原因、审批记录、Git 差异、测试报告可追溯。
- V1.3 Agent 流程图得到增量扩展，状态与 Runtime 一致。
- 保持 V1.1/V1.2/V1.3 的既有配置、数据、主题和工作流兼容。
- AI 开发 Agent 提供逐里程碑验收报告，未经验证不得宣称完成。


## 17. UI 文字清晰度与可读性专项整改（P0，V1.4 必做）

## 17.1 目标与范围
V1.4 实施前先审计 V1.3 当前 UI。覆盖项目中心、任务看板、Agent 流程图、Agent 详情、AI Provider 设置、执行日志、审批弹窗、知识库、健康监测及 Operations 工作台。解决灰色小字低对比度、字体偏细、半透明背景干扰、文字实际渲染发虚等问题；保留 Apple 式现代极简和克制玻璃拟态。禁止重做既有功能、增加冗余解释性文案。

## 17.2 设计 Token 强制标准
统一在共享主题层定义 text-primary、text-secondary、text-tertiary、surface-base、surface-panel、font-body、font-small、font-weight-body、line-height 等 Token；Ant Design ConfigProvider、Ant Design X、自定义 React Flow 节点和 Electron 页面统一消费 Token，禁止页面散落硬编码。深色模式建议初始值：主文字 #F5F7FA，次级 #C5CBD5，三级 #AEB7C4，底色 #121419，面板 #1C2028；这些仅为起始值，必须按实际背景测量对比度。浅色主题另行定义并验收。

## 17.3 字号、字重、对比度
普通正文及主要操作标签默认 >=14px；次要信息原则上 >=13px，密集图节点或不可避免的短元数据若使用更小字号必须提供缩放/展开和实际可读性验收。正文 400–500 字重；禁止大量 300 字重和低 opacity 灰字。普通文本及重要辅助文字对比度 >=4.5:1；大号文字 >=3:1；图形控件与状态指示按适用 WCAG 非文本对比度 >=3:1。禁用文本及装饰性内容按规范单独处理。状态不允许只依靠颜色表达。

## 17.4 玻璃拟态与渲染限制
毛玻璃优先用于侧栏、顶栏、浮层；代码、日志、表格、任务清单及长文本使用足够不透明的背景。禁止对文字或其父容器使用 filter: blur()、整体 opacity、transform: scale() 或全局 CSS zoom 伪造视觉层次。backdrop-filter 只能作用于背景层，文本应独立清晰绘制。禁止在未定位根因时默认关闭 Electron GPU 加速。

## 17.5 Electron / Windows DPI 排查
分别检查操作系统缩放 100%、125%、150%，Electron deviceScaleFactor、窗口缩放、字体回退链、字重文件、Chromium 合成和父级 CSS 效果。若连高对比度大标题也发虚，应优先定位渲染与 DPI，而非只修改灰字颜色。需要记录系统缩放、Electron 版本、显示器分辨率和复现截图。

## 17.6 Agent 流程图专项规范
React Flow 节点标题、状态、任务摘要、连线标签、右侧 Inspector 统一采用可读 Token；画布缩小时不得以无法辨认的 10–11px 文字承载关键状态。缩放阈值下隐藏非关键元数据、保留清晰标题与状态，详情通过节点选择展示；选中态和运行态兼顾颜色与图标/文字。Minimap 不承担文本信息。

## 17.7 极简文案约束
删除功能介绍、宣传语、重复说明和技术实现长文案；保留必要的字段名称、操作反馈、错误详情、安全授权、风险警告和可访问性标签。不能以删掉必要提示换取极简；非关键帮助信息移入 Tooltip 或帮助页。

## 17.8 实施步骤与验收证据
M1.4-00 先完成现状截图与 CSS/Token 审计，记录每类问题的组件、颜色、字号、对比度、DPI；M1.4-01 之前修复共享主题 Token 和基础组件；M1.4-07 前完成 React Flow 与 Operations UI 统一整改；M1.4-08 做深浅色、DPI、窗口尺寸及交互回归。必须输出整改前后同窗口同缩放截图、自动对比度检测结果、人工审阅记录和测试报告；不能只修改几个颜色值就宣布完成。

## 17.9 通过标准（全部满足）
① 普通文本及关键辅助文字达到对比度标准；② 正文与状态文字无明显发灰、模糊、重影；③ 100%/125%/150% DPI 下可读；④ Agent 流程图缩放后仍可辨识关键状态；⑤ 深色与浅色主题均通过；⑥ 没有破坏现有布局、功能、Agent 事件与审批安全信息；⑦ 提供真实运行截图与验证证据，无法通过项明确列为未完成。
