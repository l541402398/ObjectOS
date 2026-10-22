# ProjectOS Agent Teamwork — Phase 2B-1 AI Planner Report

> 日期：2026-10-21
> 范围：仅 Phase 2B-1 Provider-backed AI Planner。
> 基线：分支 `feature/v1.6-ux`，HEAD `81cc50c`（`feat(teamwork): R2.1 risk-tiered acceptance and real UI regression`）。
> 本轮所有改动仍在工作区，**未创建 Git commit**；未覆盖其他会话的未提交文件。
> 关键截图与证据：`test-results/r2b1/`（7 张截图 + `real-plans.json`）。
> 真实 Provider 密钥仅存在于 Electron safeStorage 加密配置和 Runtime 内存；未写入代码、SQLite、项目文件、日志或本报告。

## 1. Git 基线与实际修改

### 1.1 基线

| 项目 | 值 |
|---|---|
| 分支 | `feature/v1.6-ux` |
| HEAD | `81cc50c` |
| 基线说明 | R2.1 最终验收提交；本轮未提交 |
| 数据库 | 仍为 V21；**未新增迁移**。AI 计划来源写入既有 `plan_revisions.plan_json`；审计写入既有 `project_events`（`plan.generated`） |
| 既有成果 | 未删除/回退 R1/R2/R2.1 功能；未触碰基线中已有的未跟踪报告、提示词和打包文件 |

### 1.2 修改文件

| 文件 | 变更 |
|---|---|
| `packages/contracts/src/orchestration.ts` | 向后兼容新增 `PlanGeneration` 来源记录、`PlanContextSource`、任务 `requiredCapabilities`/`rationale`；`generation` 可选 |
| `packages/contracts/src/api.ts` | `plan.generate` 增加 `mode`（AI/本地）、`allowRuleFallback`、`maxTasks`、`allowOverBudget`；默认 `mode=local` 以保持旧调用兼容 |
| `packages/contracts/src/desktop-api.ts` | `plans.generate` 增加可选参数类型 |
| `packages/planning/src/validation.ts` | **新文件**：共享 DAG 校验（唯一 key、依赖存在、自依赖、环、深度、任务数上限） |
| `packages/planning/src/planner-prompt.ts` | **新文件**：Planner 系统/用户/纠错提示词、JSON 提取、任务字段校验、artifact 兼容性补齐、模型伪造 Agent/Runtime 字段忽略 |
| `packages/planning/src/index.ts` | 引出版本校验模块；`validatePlanDraft` 行为保持兼容 |
| `packages/planning/src/assignment.ts` | `requiredCapabilities` 作为候选评分输入；不伪造 Agent，不改变显式选择 |
| `packages/domain/src/events.ts` | 新增 `plan.generated` 事件与可读摘要 |
| `apps/runtime/src/planner.ts` | **新文件**：PlannerService（预算、上下文、模型调用、超时、有界纠错、来源记录） |
| `apps/runtime/src/planner-context.ts` | **新文件**：有界、只读、敏感路径过滤、密钥脱敏的项目上下文构建器 |
| `apps/runtime/src/planner-provider.ts` | **新文件**：复用默认 AI 连接/默认模型的 Provider 目标解析；无 ModelRouter |
| `apps/runtime/src/orchestration.ts` | `generateAIPlan`：只生成校验后草稿；`plan.generated` 审计；本地规则回退真实标记；修订保留来源 |
| `apps/runtime/src/dispatcher.ts` | 构造 PlannerService；`plan.generate` 接入 AI/本地模式 |
| `apps/desktop/src/main/ipc.ts` | `plan.generate` IPC 超时提高到 240s（模型调用 + 一次纠错） |
| `apps/desktop/src/preload/index.ts` | 透传 plan generate 选项 |
| `apps/desktop/src/renderer/.../OrchestrationWorkspace.tsx` | AI/本地模式、来源条、错误/回退反馈、任务 rationale/能力、验收与产物可编辑、sticky 操作栏 |
| `apps/desktop/src/renderer/.../orchestration.css` | 计划弹窗浅/深色玻璃样式、来源/错误/回退卡片、可编辑任务布局、12px 最小字号 |
| `scripts/e2e.mjs` | 修正 V1.6/V1.7 UI 重设计后过时的 `.po-project-card` 选择器为 `.v16-project-visual`；**未删减断言** |
| `tests/planner.test.ts` | **新文件**：15 项 Planner 单元/集成测试 |
| `scripts/r2b1-planner-ui-e2e.mjs` | **新文件**：真实 Electron UI + 本地 fake Provider 的确定性回归 |
| `scripts/r2b1-real-planner.mjs` | **新文件**：隔离真实 Provider 三需求验证与截图 |

## 2. Agent 路由状态与当前 AI 连接/模型实现

### 2.1 没有恢复 Agent 路由

- 当前 Renderer **没有** Agent 路由页面、路由导航、路由配置面板；没有新增/恢复 `/routing`。
- 本轮没有新增 `ModelRouter`、`AgentRouter`、第二套 AI 连接、Agent Registry、Runtime Registry 或 Orchestrator。
- 仓库仍保留历史底层类型/IPC（`AgentBackendBinding`、`aiRouting.*`、`agent_backend_bindings` 表），但它们**没有 UI 入口，本轮未扩展，Planner 没有调用**；不能把它们视为本轮恢复的 Agent 路由。
- Planner 不使用 `AIConnectionService.resolveForRun()`、`listBindings()` 或 `AgentBackendBinding`。选人仍由既有 `AgentAssignmentResolver` 完成；Agent ≠ Runtime/Harness ≠ AI 模型。

### 2.2 当前实际存在的 AI 连接/模型选择接口

| 层 | 实际实现 | 用途 |
|---|---|---|
| Main | `ProviderConfigStore`、`ConnectionSecretStore`（Electron safeStorage） | 兼容旧 Provider 配置；加密保存连接密钥；不向 Renderer 返回密钥 |
| Main IPC | `settings.get/update/clearKey/test`、`aiConnections.list/create/update/delete/setDefault/test/discoverModels`、`aiModels.list/create/delete/setDefault` | 连接编辑、连接测试、模型目录、默认模型 |
| Runtime | `AIConnectionService` | SQLite `ai_connection_profiles` / `ai_models`；默认连接与默认模型 |
| Runtime | `ProviderManager` | `openai-chat`、`openai-responses`、`anthropic-messages` 三种原生 Provider；连接凭据只存内存 |
| Runtime | `runtime.ai.registry`、`runtime.ai.credentials`、`runtime.ai.probe`、`runtime.ai.discover` | Main 与 Runtime 之间的连接/凭据同步和诊断 |
| Renderer | Settings 内的 `AIConnectionsPanel`、`ModelCatalogPanel` | 真实连接/模型选择 UI；不是独立页面 |

**本轮 Planner 的模型选择方式（最小扩展）：**
默认 AI 连接 + 该连接的默认模型。没有把模型选择做成新的路由模块；用户仍在既有设置中切换默认连接/模型。Planner 不读取/不创建 Agent 路由绑定。

> 隔离真实 Provider 验证中，临时数据目录通过既有“旧 Provider → AI 连接”迁移路径创建了临时连接 `Legacy OpenAI-compatible`；模型为 `deepseek-flash`。这是隔离测试的迁移产物，不是新增路由或新连接机制；用户真实数据目录未被修改。

## 3. AI Planner 到真实 Provider 的调用链、预算与凭据

### 3.1 真实调用链

```text
Renderer 计划弹窗
  → window.projectos.plans.generate(projectId, goal,
      { mode: 'ai', allowRuleFallback: false, maxTasks: 12 })
  → preload call('plan.generate', {...})
  → Main IPC（240s 超时）
  → RuntimeSupervisor stdio
  → RuntimeDispatcher case 'plan.generate'
  → OrchestrationService.generateAIPlan
  → PlannerService.generate
      ├─ project soft budget check（BUDGET_EXCEEDED，除非 allowOverBudget）
      ├─ AiPlannerModelSource.resolve()
      │    └─ AIConnectionService.getDefault()
      │       + ProviderManager.hasConnection / createProvider
      ├─ buildPlannerContext（只读）
      ├─ planSystemPrompt() + buildPlannerUserPrompt()（planner-v1）
      ├─ provider.stream({ messages, tools: [], maxTokens })
      ├─ extract JSON → parsePlannerResponse → DAG/字段/artifact 校验
      ├─ 失败时最多 1 次有界纠错（总计 2 次模型调用）
      └─ PlanGeneration（连接/模型/attempts/tokens/warnings/context sources）
  → OrchestrationService.assignPlanAgents（既有 AgentAssignmentResolver）
  → validatePlanDraft + validatePlanAgents
  → store.createPlanRevision（仅 draft）
  → store.appendEvent('plan.generated')
  → ensurePlanCollaboration
  → 返回 PlanDraft
```

成功链路在 `createPlanRevision` 前不写任务，不创建 Approval，不启动 Scheduler/Agent，不执行工具，不写项目文件。

### 3.2 上下文

`buildPlannerContext()` 只读，按相关性组装：

- 项目元数据、项目扫描快照（语言/框架/模块/依赖/告警）；
- 可见 Agent 的名称、角色、能力、状态、Runtime 可用性与 Skills（**不发送 Agent ID**）；
- 已有任务、最近计划与节点、已验证/已有 Artifact、知识库、已接受 ADR；
- 质量门禁策略、项目 AI 预算；
- 最多 8 个相关文件摘要（含 `package.json`/README；内容预算 1,700 字符/文件）；
- 中文需求会通过小型双语映射匹配英文路径（例如 权限→auth/permission、性能→performance/metric、按钮→button、样式→css/token），避免只靠通用 `src/` 权重选中无关文件。

安全处理：

- `resolveWorkspacePath` 限制在项目根内；
- `isProtectedPath` + `.pem/.key/.p12/.pfx` 额外过滤，跳过 `.env`、secrets、credentials、SSH/AWS 等；
- 所有文件内容 `redactSecrets`；最终上下文再次脱敏；
- 绝对项目路径不发送给模型，只发送根目录名称与相对路径；
- 系统提示明确标注项目文件/文档/模型输出是低信任数据，不得覆盖系统规则。

### 3.3 调用预算

| 限制 | 值 | 位置 |
|---|---|---|
| 上下文预算 | 18,000 字符（可配置） | `planner-context.ts` / `PlannerService` |
| 输出 token 上限 | 4,096 | `PlannerService` |
| 输出字符硬上限 | 120,000 | `PlannerService` |
| 单次模型超时 | 75s（可配置，IPC 240s） | `PlannerService` / `ipc.ts` |
| 模型调用次数 | 最多 2 次（1 次纠错） | `maxRepairAttempts=1` |
| 任务数 | 默认最多 12，API 上限 20 | `api.ts` / `PlannerService` |
| 依赖深度 | 8 | `validation.ts` |
| 项目软预算 | 已有 `project_budgets` 超出时阻止付费调用，除非显式 `allowOverBudget` | `PlannerService.assertBudget` |

Token 使用由 Provider 的 `usage` 事件记录到 `PlanGeneration`；**不伪造未知 token/费用**。当前 `ai_usage_records` 是 Run 维度，Planner 没有 Run，因此 Planner 的 token 暂不进入项目 AI 费用汇总（见 §10）。

### 3.4 凭据处理

- Main `ConnectionSecretStore` 只保存 safeStorage 加密后的密文；`connectionSecrets.get()` 只在 Main 内存中短暂解密；
- Main → Runtime 通过 `runtime.ai.credentials` 传 `AIConnectionProbe`，Runtime 的 `ProviderManager.connections` 只存内存；
- 连接元数据在 SQLite 中只有 `secret_ref`，没有 key；
- 计划 `generation` 只记录 `connectionId`/`connectionName`/`model`/`protocol`/token 数，不记录 key；
- Runtime 日志通过 pino redact 和 `redactSecrets` 处理；Provider 错误响应读取上限 2,000 字符并脱敏；
- 报告和 `real-plans.json` 不含 `sk-` 材料（脚本断言通过）。

### 3.5 只生成草稿

`generateAIPlan()` 成功时只写 `plan_revisions` 的 draft 和 `plan.generated` 事件；`PlanDraft.execution` 为 `null`，`createdTaskIds` 为空。只有用户继续点击“批准并创建任务”才调用既有 `approvePlan` 创建 Tasks；只有用户点击“开始执行”才启动 Scheduler。UI 明确写出这一边界。

## 4. 三种真实需求的计划 DAG、验收与来源

真实 Provider：隔离数据目录中经 safeStorage 解密的已授权 DeepSeek 连接；协议 `openai-chat`，模型 `deepseek-flash`。三个项目、三份 plan revision 均为 `draft`。完整数据（含全部验收标准、假设、风险、上下文来源）见 [`real-plans.json`](test-results/r2b1/real-plans.json)。

### 4.1 A. 修改主按钮样式（小计划）

来源信息：`generatedBy=provider`，`attempts=1`，`durationMs=14280`，`contextChars=2003`，`inputTokens=1728`，`outputTokens=2437`；无纠错。上下文文件：`package.json`、`README.md`、`src/components/PrimaryButton.tsx`、`src/styles/tokens.css`。

| key | role | 依赖 | 验收条数 | 预期产物 |
|---|---|---|---:|---|
| `implement-minimal-button-style` | developer | — | 5 | 代码 diff；变更说明（改动文件清单与必要性） |
| `review-style-diff-scope` | reviewer | `implement-minimal-button-style` | 4 | 审查报告 |
| `verify-button-style` | tester | `implement-minimal-button-style` | 5 | 测试报告；渲染与样式检查记录 |

与真实上下文的对应：

- 模型看到 `PrimaryButton.tsx` 的内联样式与 `tokens.css` 的 `--button-radius`/`--button-accent`，因此选择“只改按钮组件 + 必要时追加 token”的最小范围，而不是重做设计系统；
- 模型显式在 assumptions/risks 中指出“没有目标视觉细节”“测试脚本是占位实现，不能作为样式正确性证据”；
- 计划共 3 个任务，不是固定四节点模板。

### 4.2 B. 增加角色分级的用户权限管理（较大、有并行）

来源信息：`generatedBy=provider`，`attempts=2`（首次输出被有界纠错 1 次），`durationMs=44454`，`contextChars=3299`，`inputTokens=2269`，`outputTokens=3930`；11 个上下文来源。上下文包含 `src/auth/permissions.ts`、`src/auth/guard.ts`、`docs/security.md`，以及 `src/components/PrimaryButton.tsx`、`src/server/api.ts`、`src/server/metrics.ts` 等摘要。

| key | role | 依赖 | 验收条数 | 预期产物 |
|---|---|---|---:|---|
| `design-rbac-model` | architect | — | 6 | 角色分级权限设计方案；权限矩阵；旧角色兼容映射；接口/前端契约 |
| `data-role-store` | developer | `design-rbac-model` | 5 | 代码 diff；权限矩阵实现；兼容性说明 |
| `api-enforce` | developer | `design-rbac-model` | 5 | 代码 diff；路由 × 权限映射；401/403 行为说明 |
| `web-gating` | developer | `design-rbac-model` | 5 | 代码 diff；受控组件 × 权限清单 |
| `unit-tests-permissions` | tester | `data-role-store` | 4 | 测试代码 diff；测试报告 |
| `integration-tests` | tester | `api-enforce, web-gating, unit-tests-permissions` | 4 | 集成测试代码 diff；测试报告 |
| `security-review` | reviewer | `data-role-store, api-enforce, web-gating, unit-tests-permissions` | 5 | 审查报告；必改项清单；一致性核对表 |
| `docs-security-update` | custom | `design-rbac-model, data-role-store, api-enforce` | 4 | docs/security.md 更新 diff；一致性核对记录 |

与真实上下文的对应：

- 设计任务先固定“权限矩阵/角色层级/默认拒绝/旧 owner/member 兼容”，因为上下文里 `Role` 只有 owner/member，模型在 assumptions 中明确“沿用现有联合类型，不新建并行权限模型”；
- 数据层、接口层、前端门禁三项都依赖同一设计，可并行；测试依赖数据层，集成测试依赖 API + 前端 + 单元测试；审查依赖实现与测试；文档依赖设计/数据/API；
- 真实计划是 8 个任务、14 条依赖边，角色包含 architect/developer/tester/reviewer/custom，明显区别于固定 4 节点模板。

### 4.3 C. 排查服务性能问题（测量优先）

来源信息：`generatedBy=provider`，`attempts=2`（1 次有界纠错），`durationMs=36434`，`contextChars=2394`，`inputTokens=4710`，`outputTokens=7033`；5 个上下文文件：`package.json`、`README.md`、`src/server/metrics.ts`、`docs/performance.md`、`src/server/api.ts`。模型补充了一个标准交付物标签（`post-optimization-measurement` 缺少代码 diff），并在 warnings 中显示。

| key | role | 依赖 | 验收条数 | 预期产物 |
|---|---|---|---:|---|
| `metrics-instrumentation` | developer | — | 4 | 代码 diff；指标采集接口说明 |
| `baseline-measurement` | developer | `metrics-instrumentation` | 4 | 基线结果文件；可复现命令 |
| `profiling-localization` | architect | `baseline-measurement` | 4 | 设计与优化方案；定位报告 |
| `optimization-implementation` | developer | `profiling-localization` | 4 | 代码 diff；改动与方案对应说明 |
| `post-optimization-measurement` | developer | `optimization-implementation, baseline-measurement` | 4 | 优化后测量结果；基线对比报告；代码 diff |
| `regression-verification` | tester | `post-optimization-measurement` | 4 | 测试报告；回归断言清单 |
| `independent-review` | reviewer | `regression-verification, profiling-localization` | 4 | 审查报告（三维度结论与证据位置） |

与真实上下文的对应：

- 模型看到 `docs/performance.md` 明确“先记录 p50/p95 与样本量，再做 profiling”，以及 `metrics.ts` 是桩实现（p50=p95、samples=1），因此把“指标采集有效性”放在第一位，再建立基线；
- 优化依赖 profiling 定位，复测依赖优化 + 原基线，回归依赖复测，独立审查依赖回归与定位；
- 计划是 7 个任务，不是 4 节点模板；测量/定位在优化之前，符合需求。

### 4.4 三份计划的差异（不是只改数量）

| 需求 | 任务数 | 角色集合 | 依赖边 | 关键结构 |
|---|---:|---|---:|---|
| 按钮样式 | 3 | developer, reviewer, tester | 2 | 定位/实现（同任务最小改动）→ 审查/验证并行 |
| 角色权限 | 8 | architect, developer, tester, reviewer, custom | 14 | 设计 → 数据/API/前端三项并行 → 测试 → 集成/审查/文档 |
| 服务性能 | 7 | developer, architect, tester, reviewer | 8 | 指标采集 → 基线 → 定位 → 优化 → 复测 → 回归 → 独立审查 |

差异来自真实上下文（`PrimaryButton`/`tokens.css` vs `auth/permissions`/`guard`/`security.md` vs `metrics.ts`/`performance.md`/`api.ts`）和需求类型，而不是模板占位。任务 rationale、验收和产物在 UI 中可见并可在批准前编辑。

## 5. Schema、权限、循环依赖校验与失败回退

### 5.1 结构与 DAG 校验

`validatePlanTaskGraph`（共享）和 `parsePlannerResponse` 至少检查：

1. `tasks` 非空、任务数 ≤ `maxTasks`（默认 12，API 上限 20）；
2. task key 非空、唯一、小写短横线格式；
3. 所有 `dependsOn` 存在、无自依赖、无重复、无环，依赖深度 ≤ 8；
4. `title`、`description`、`rationale` 非空；`acceptanceCriteria` 1–8 条且非空；`expectedArtifacts` 1–6 条且非空；
5. `role` 只能是 `architect|developer|reviewer|tester|custom`；`capabilities` 只能是既有 `AgentCapability` 枚举，最多 6 项；
6. 模型输出中的 `agentId`、`assigneeAgentId`、`runtime`、`runtimeProfileId`、`skills` 一律忽略并记录 warning；不把模型文本当作真实 Agent/Runtime；
7. 设计/审查/测试/实现任务缺标准交付物时，补充 `设计/实施方案`、`审查报告`、`测试报告` 或 `代码 diff`，并在 generation warnings 中说明（不删除模型自己的产物）；
8. 模型不允许返回工具调用；Planner 只接受 JSON 计划文本，`tool.call` 直接报错。

### 5.2 权限与作用域

- 所有读取限制在项目根内，跳过受保护路径；不发送绝对路径；
- 项目必须存在；目标长度 3–8,000；
- 只有主窗口 IPC 可以调用；Renderer 不直接接触 Node/SQLite/文件系统；
- 模型输出不会触发写文件、执行进程、创建任务、创建批准或启动 Scheduler；
- 批准仍走既有 `approvePlan` → strict `validatePlanAgents`，无可用 Agent 时明确阻塞；
- 既有 `Task Lease`、全局 Agent 容量、Run/Plan 预算、Approval、QualityGate 代码未修改。

### 5.3 失败与回退矩阵

| 场景 | 行为 | 证据 |
|---|---|---|
| 未配置 AI 连接 | `PROVIDER_NOT_CONFIGURED`，无计划、无模型调用 | `tests/planner.test.ts` |
| 模型超时 | `TIMEOUT`，无计划保存；不自动重复付费调用 | `planner.test.ts` 150ms hang |
| Provider 抛错 | 准确脱敏错误；`allowRuleFallback=false` 时不保存 | `planner.test.ts` |
| 非法 JSON / 缺字段 | 首次失败 → 1 次有界纠错 → 仍失败则 `PROVIDER_ERROR`，不保存半成品 | `planner.test.ts` 2 个用例 |
| 依赖不存在 / 自依赖 / 环形依赖 | 校验失败；纠错提示中包含具体问题；最终不保存 | `planner.test.ts` cycle 用例 |
| 超过任务数/依赖深度 | 校验失败，不保存 | `validatePlanTaskGraph` / 单元断言 |
| 超出项目软预算 | 在调用前 `BUDGET_EXCEEDED`，模型调用次数 0 | `planner.test.ts` |
| 模型返回工具调用 | 拒绝执行，报“不会执行工具”，不保存 | `planner.test.ts` |
| 无可用 Agent | 保存草稿但节点标 `assignmentBlocked`；`approvePlan` 拒绝 | `planner.test.ts` |
| 显式规则回退 | `generatedBy=local-rules`，`generation.mode=local-rules`，`fallbackReason` 真实记录，UI 明确提示，不冒充模型 | `planner.test.ts` + UI 截图 |
| 旧计划 | `generation`/`requiredCapabilities`/`rationale` 可选；旧 JSON 可读且 `PlanDraftSchema` 通过 | `planner.test.ts` legacy 用例 |

`allowRuleFallback` 默认 `false`；产品 UI 的“AI 生成”默认严格失败并给出明确错误，用户可显式点击“改用本地规则”。API 调用方也可显式传 `allowRuleFallback=true`，此时仍如实标记 `local-rules`。

## 6. 与 AgentAssignmentResolver / Artifact / QualityGate 的集成

### 6.1 AgentAssignmentResolver

- Planner 只输出 `role` 与 `requiredCapabilities`，不输出真实 Agent ID；
- `OrchestrationService.assignPlanAgents` 继续使用既有 `buildAssignmentCandidates`（项目可见性、AgentDefinition 状态、Skills、Runtime 可用性、当前负载）和 `resolveAgentAssignment`；
- `requiredCapabilities` 只增加候选评分与原因，不把缺能力当成硬阻断（避免全部不可用）；显式用户选择仍保留，自动节点保持 `assignmentMode='auto'`；
- 无候选时保留可编辑草稿，但节点 `assignmentBlocked=true`，批准被拒绝；
- 未新增 Agent Registry、Runtime Registry 或选择器。

### 6.2 Artifact / CompletionDecision

- Planner 的 `expectedArtifacts` 在批准时复制到 Task（既有 `approvePlan` 行为）；
- 对 architect/reviewer/tester/实现型 developer 缺失标准产物时，系统补充标准标签，并在 plan generation warnings 中说明；
- 任务描述追加结构化 metadata 要求（design/review），与既有 `completion-evidence.ts` 的 `artifactType=design/review` 校验兼容；
- 不把标题关键词当作完成证据；完成仍由既有 CompletionDecision、Artifact metadata、ToolCall/文件证据、QualityGate 决定。

### 6.3 QualityGate

- Planner 将项目 `required/optional` 质量策略放入上下文，提醒模型不要把 skipped 当 passed；
- 未修改 QualityGate 服务、计划执行器、证据补证或验收逻辑；
- 本轮 AI Planner 只生成草稿，因此不会绕过任何既有执行质量门禁。

## 7. 真实 Provider 测试与 Mock 边界

### 7.1 真实 Provider（已授权，隔离）

脚本：[`scripts/r2b1-real-planner.mjs`](scripts/r2b1-real-planner.mjs)

- 隔离临时数据目录、临时 projects、临时 Electron user-data dir；
- 仅复制已授权 Provider 的 **加密** `provider.json` 与 Chromium `Local State` 到临时目录；safeStorage 在 Electron 进程内解密；
- 未触及用户真实 `projectos.db`、项目目录、Provider 配置；
- 通过既有 legacy → AI connection 迁移路径创建临时连接 `Legacy OpenAI-compatible`，模型 `deepseek-flash`；
- 三个需求分别生成真实草稿；**20 checks PASS**；
- 真实计划证据：[`real-plans.json`](test-results/r2b1/real-plans.json)（只含模型、连接名、token、任务、验收、产物、上下文 metadata；无密钥）；
- 真实截图：`real-button.png`、`real-rbac.png`、`real-performance.png`；
- 未打印/写入任何 API Key；脚本断言 summary 中无 `sk-` 材料。

真实 Provider 测试边界：

- 只验证了 DeepSeek `deepseek-flash`（当前已授权连接）；OpenAI/Anthropic 协议实现存在但未在本轮用真实密钥验证；
- 真实 Provider 输出存在非确定性：RBAC/性能计划首次输出需要一次有界纠错；报告保留 attempts=2；
- 真实计划质量由上述实际 DAG、验收和上下文对应关系证明，不以“数量不同”作为质量结论。

### 7.2 Mock/本地 fake Provider（仅 UI 确定性）

脚本：[`scripts/r2b1-planner-ui-e2e.mjs`](scripts/r2b1-planner-ui-e2e.mjs)

- 本地 OpenAI-compatible fake server，只用于 UI 状态回归（成功、错误、回退、浅/深色、可编辑）；
- **11 checks PASS**；未把 Mock 计划当作真实模型质量证据；
- 截图：`plan-ai-light.png`、`plan-ai-dark.png`、`plan-error.png`、`plan-local-fallback.png`；
- Mock 的 `generatedBy`/来源条仍真实显示为 fake 连接/模型；不会冒充真实 Provider。

### 7.3 真实 Harness

`tests/r2-real-harness.test.ts` 的 3 个测试因本机没有真实 Harness 密钥而 **skipped**（与基线相同）；本轮没有把 OpenCode/DeepSeek 的真实 Harness 付费运行冒充为已执行。AI Planner 的真实 Provider 验证使用上述独立隔离脚本。

## 8. UI 改动与 Electron 截图

### 8.1 改动（仅在既有编排工作台计划弹窗内）

- 计划弹窗：AI/本地规则模式切换；ai 模式显示真实连接名 + 模型；本地模式明确“未调用模型”；
- 生成中状态、240s 主进程超时、内联错误（不再被 toast 遮挡），错误后提供“改用本地规则”显式回退；
- 来源条：`AI 模型生成` / `本地规则草案`、rN、任务数、耗时、纠错次数、上下文来源数量；
- 警告/回退原因：有界纠错、补充标准交付物、上下文截断、敏感路径跳过等真实信息；
- 任务卡：rationale、能力要求、验收/产物数量、依赖、自动/手动/待分配状态；
- 验收标准与预期产物可用 tags 编辑器修改；标题/角色/Agent/依赖保持既有编辑能力；
- 任务列表可滚动，计划操作栏 sticky 于弹窗底部；浅色/深色均使用原有玻璃拟态和低饱和色；
- 没有新增独立 Planner 中心、没有新增路由页、没有恢复 Agent 路由页面。

### 8.2 截图（真实 Electron）

| 截图 | 说明 |
|---|---|
| [`plan-ai-light.png`](test-results/r2b1/plan-ai-light.png) | 确定性 fake Provider，AI 来源条、任务卡、验收/产物可编辑、浅色 |
| [`plan-ai-dark.png`](test-results/r2b1/plan-ai-dark.png) | 同一计划深色主题 |
| [`plan-error.png`](test-results/r2b1/plan-error.png) | 非法模型输出两次失败后的内联错误 + 改用本地规则 |
| [`plan-local-fallback.png`](test-results/r2b1/plan-local-fallback.png) | 显式本地规则回退；来源标记 local-rules |
| [`real-button.png`](test-results/r2b1/real-button.png) | 真实 Provider 按钮样式计划；3 任务 |
| [`real-rbac.png`](test-results/r2b1/real-rbac.png) | 真实 Provider RBAC 计划；8 任务，44s，1 次纠错 |
| [`real-performance.png`](test-results/r2b1/real-performance.png) | 真实 Provider 性能计划；7 任务，测量优先 |

### 8.3 UI 验收

- 1440×900 真实 Electron 窗口；真实鼠标点击打开计划弹窗、生成、模式切换、错误回退、关闭；
- 真实键盘在验收 tags 中新增“人工复核样式对比”，draft 立即更新（UI E2E 断言通过）；
- 浅/深色截图；12px 最小字号；无 renderer page error；
- 弹窗内容滚动、sticky 操作栏，长计划（8 任务）可操作；
- 真实 Provider 截图中连接名为隔离迁移产生的 `Legacy OpenAI-compatible`，模型为 `deepseek-flash`；生产用户原有连接名/模型不会被改写。

## 9. 验证结果与失败项

### 9.1 命令结果

| 命令 | 结果 |
|---|---|
| `pnpm lint` | **PASS**（0 error；依赖边界检查 PASS） |
| `pnpm typecheck` | **PASS** |
| `pnpm test` | **PASS**：222 passed，3 skipped（43 个测试文件：42 pass、1 skip） |
| `pnpm build` | **PASS**（runtime + desktop；多次重建） |
| `pnpm test:teamwork` | **PASS**：7 checks，9 provider requests |
| `node scripts/v13-e2e.mjs` | **PASS**：scan/plan DAG/approval/graph/layout/inline connection editor；plan r1 4 tasks superseded；10 nodes/12 edges |
| `node scripts/v14-e2e.mjs` | **PASS**：findings 1；proposals 2 pending_approval；propose |
| `node scripts/r21-ui-regression.mjs` | **PASS**：16 checks；15 张截图；settings/runs/collaboration/agents/orchestration/error/dark/sidebar/resize |
| `node scripts/e2e.mjs` | 首次因**过时选择器**失败；修正后 **PASS**（创建项目 + 重启恢复） |
| `pnpm package:dir` | **PASS**（重建 `release/win-unpacked`） |
| `pnpm test:package` | **PASS**（打包 EXE 创建项目、starter 文件、重启恢复） |
| `node scripts/r2b1-planner-ui-e2e.mjs` | **PASS**：11 checks，4 张截图 |
| `node scripts/r2b1-real-planner.mjs` | **PASS**：20 checks，3 个真实计划，3 张截图 |

### 9.2 失败与修复（未隐藏）

1. **基础 E2E 选择器过时**：`scripts/e2e.mjs` 仍等待 V1.6 前的 `.po-project-card`；V1.7 后项目卡实际为 `.v16-project-visual`。已修正选择器，断言（创建项目、重启后卡片内容、点击进入项目）保持不变；重跑 PASS。这是测试维护问题，不是产品功能失败；截图证明项目卡一直存在。
2. **真实 Provider RBAC 首次校验过严**：第一轮真实输出使用的 artifact 名称（如 `权限清单`、`结论说明`）未命中严格的设计/审查/测试/代码关键词，导致两次校验失败。改为“补充标准交付物标签 + 真实 warning”，保留模型自己的产物，不静默丢弃；重跑真实 Provider PASS。该行为也新增了单元测试。
3. **真实 Provider 隔离启动 safeStorage 解密失败**：最初只复制 `provider.json`，临时 `--user-data-dir` 没有 Chromium OS-crypt key，safeStorage 无法解密。修正为仅复制 Chromium `Local State` 到临时用户目录；未复制/修改用户真实数据库或密钥明文；重跑 PASS。这是测试隔离问题，不是产品凭据逻辑变更。
4. **UI 源码首次出现 11/11.5px 字号**：`tests/design-tokens.test.ts` 要求最小 12px；已改为 12px 并重跑 PASS。
5. 全量测试与 UI 回归中未发现其他产品失败。

### 9.3 未执行的回归

- `tests/r2-real-harness.test.ts`：3 个真实 Harness 测试因无密钥 skipped；未重新付费运行 OpenCode/DeepSeek Harness。
- `pnpm test:r2-ui` / `r2-reassign-ui-e2e`：R2.1 UI 回归已覆盖当前相关页面；本轮没有修改替代/Handoff UI。
- `r2-package-features` / `r2-package-migration`：未重跑；本轮无 DB 迁移、无 R2 特性改动；已完成 `package:dir` 与 package smoke。
- 未执行全站逐页像素级 UI 回归；UI 范围限定为计划弹窗与既有 R2.1 覆盖页面。

## 10. 尚未实现 / 范围外（Phase 2B-2 / 2B-3）

**未实现，按指令停止：**

- Phase 2B-2 计划级授权（Plan-level authorization）；
- Phase 2B-3 自动动态重规划、执行中的自动计划修订；
- Agent 路由页面/配置/路由模型（不恢复）；
- 新的 ModelRouter/AgentRouter/Agent Registry/Runtime Registry/Orchestrator/Scheduler/Task 系统/DAG 编辑器；
- 全系统 UI 重做；
- 计划自动批准、自动创建执行任务、自动启动 Agent。

**本轮限制：**

1. Planner 固定使用**默认 AI 连接 + 默认模型**；没有计划级模型选择器。用户可在既有设置中切换默认连接/模型。
2. 真实 Provider 只验证了 DeepSeek `deepseek-flash`；OpenAI/Anthropic 真实调用未验证。
3. 本地规则回退仍是固定 4 模板，仅作为真实标记的回退；不冒充模型质量。
4. 上下文为有界相关性启发式，不是完整代码图/语义检索；可能遗漏上下文，模型被要求将推断路径标为“需执行前确认”。
5. 网络错误/超时不会自动重试（避免重复付费）；非法格式/字段最多一次有界纠错，之后准确失败。
6. Planner token 使用已记录在 `PlanGeneration`，但未写入 Run 维度的 `ai_usage_records`，因此暂未进入项目 AI 费用汇总；项目软预算闸门仍生效。
7. 模型输出质量仍须人工复核；Planner 只生成可编辑 draft，不能替代架构师/审查员判断。
8. UI 回归范围限于计划弹窗和 R2.1 覆盖矩阵，不是全站像素级回归。

## 11. 验收结论与停止边界

- AI Planner 已真实调用当前存在的默认 AI 连接/模型；未恢复 Agent 路由；未新增 ModelRouter。
- 三种需求在隔离环境中生成了真实计划，任务数 3/8/7、角色与依赖结构明显不同；每项任务有 rationale、可检验验收与产物。
- 所有模型输出只生成 draft；无自动批准、无任务创建、无 Scheduler/Agent/工具执行；DAG、Schema、Agent 可用性校验与明确失败/真实回退均有测试。
- UI 已在真实 Electron 中验证（浅/深色、真实鼠标/键盘、错误、回退、可编辑）。
- lint/typecheck/test/build/E2E/package smoke 全部通过（除已注明的真实 Harness skip 与未执行 R2 打包特性回归）。
- **按要求停止，等待验收。未继续开发 Phase 2B-2/2B-3，未恢复 Agent 路由。**
