# ProjectOS Agent Teamwork — Phase 2B-2 计划授权与 Agent 组队报告

> 日期：2026-10-21
> 范围：Phase 2B-2 计划审批、Agent 自动组队校验、最小权限计划执行授权、真实 UI 闭环、Planner 用量记录。
> 基线：分支 `feature/v1.6-ux`，HEAD `81cc50c`（R2.1 最终验收）。本轮未创建 Git commit。
> 2B-1 成果备份：`test-results/phase2b1-backup/working-tree.patch` + 同目录下新增文件副本。
> 证据目录：`test-results/r2b2/`（7 张截图 + `real-grant.json`）；2B-1 证据仍在 `test-results/r2b1/`。
> 未恢复 Agent 路由；未实现 Phase 2B-3。

## 1. 基线与 2B-1 成果保护

- 开始前已先保存 2B-1 工作区：`git diff` 全量 patch、`git status` 记录、`planner*.ts`/`planner-prompt.ts`/`validation.ts`/`planner.test.ts`/2B-1 E2E 脚本/2B-1 报告副本，均保存在 `test-results/phase2b1-backup/`，可恢复。
- 没有执行 `git reset`、`git clean`、强制 checkout 或其他破坏性 Git 命令；没有改写用户真实数据库或安装包。
- 2B-1 的 Provider-backed Planner、隔离真实 Provider 证据、计划弹窗来源标记、验收/产物编辑继续保留。
- 本轮数据库从 V21 迁移到 **V22**；迁移只发生在运行中的 `SqliteStore`/测试临时数据库，未操作用户真实 DB。
- 产品决策保持不变：**Agent 路由页面/菜单/绑定流程不恢复**；未新增 `ModelRouter`/`AgentRouter`、第二套连接、Agent/Runtime Registry、Task、Scheduler、DAG 编辑器或 Teamwork 页面。

## 2. 实际调用链

### 2.1 计划审批（不执行）

```text
Renderer 计划弹窗
  → window.projectos.plans.approve(planId)
  → Main IPC → RuntimeDispatcher → OrchestrationService.approvePlan
  → 在一个事务中创建 Tasks/Dependencies
  → 返回 PlanDraft(status=approved, execution=null)
```

批准只创建任务；不会创建执行授权、不会启动 Scheduler、不会启动 Agent。2B-2 UI E2E 明确断言 `execution === null`。

### 2.2 计划执行授权

```text
Renderer “计划执行授权”表单
  → window.projectos.plans.grant.issue({planId, actions, allowedPaths, ...})
  → Main IPC(plan.grant.issue)
  → RuntimeDispatcher.plan.grant.issue
  → PlanGrantService.issue
      ├─ 只允许 approved plan + 已有 createdTaskIds
      ├─ 规范化 allowedPaths（项目内、拒绝 .. / 绝对路径 / 敏感路径）
      ├─ 绑定 plan.id + revision + planFingerprint
      ├─ 绑定当前全部 taskIds/assignee AgentIds
      ├─ 记录 actor=local-user、actions、TTL、limits、allowOverBudget、note
      ├─ 撤销同 plan 旧的 active grant
      └─ V22 plan_execution_grants + plan.grant.issued 审计
```

### 2.3 启动

```text
Renderer 开始执行
  → window.projectos.orchestration.start(planId, ..., grantId)
  → Main IPC → dispatcher
  → PlanGrantService.assertStartAllowed(plan, grantId)
  → 项目软预算检查（超预算必须 grant.allowOverBudget=true + note）
  → store.consumePlanExecutionGrantStart（原子 used_runs + 1）
  → OrchestrationScheduler.start
      ├─ planGrantGuard = PlanGrantService.assertExecutionActive
      ├─ 创建/恢复 Task/Plan execution 状态
      └─ tick 时再次检查 grant；失效则 pause + plan.grant.invalidated
  → 既有 Task Lease/Agent 全局容量/Run 预算/Approval/QualityGate
```

`plan.grant.started` 记录 grantId、revision、是否超预算、spent/softLimit。

### 2.4 工具执行与授权范围

```text
AgentRunner.executeTool
  → evaluateToolPolicy（现有 PolicyEngine）
  → 若 require_approval 且为 write_file：
      PlanGrantService.authorizeToolCall
        ├─ 无 grant → 保持 per-call Approval（旧计划兼容）
        ├─ grant 已撤销/过期/内容指纹/revision/task/agent 不一致 → deny
        ├─ 工具不是 write_file → 保持逐次 Approval
        ├─ 路径不在 allowedPaths → deny（不静默扩大范围）
        ├─ 敏感/安全关键路径（.env、auth、migrations、package.json、CI 等）→ 逐次 Approval
        ├─ 原子 consume used_tool_calls（上限 500）
        └─ 记录 plan.grant.consumed + ToolCall/run step 审计
  → 既有 ToolHandler 执行实际 write_file
```

进程、Git 写、外部 Runtime、`runtime.*` **从不**被计划授权放行，始终逐次 Approval。计划授权不能绕过 PolicyEngine 的 `deny`。

### 2.5 撤销、过期与重新确认

```text
plan.grant.revoke
  → PlanGrantService.revoke（幂等：已撤销不重复写事件）
  → 若 Plan execution running/paused，dispatcher 调 scheduler.cancel
  → 取消活动 Runs / 释放 lease 的既有逻辑
  → plan.grant.revoked 审计
```

- 授权失效后 `AgentRunner.authorizeToolCall` 对所有副作用工具返回 deny（不再生成逐次 Approval），避免撤销后继续放行。
- Scheduler tick 每轮重新检查授权；过期/撤销/任务或 Agent 改变时暂停计划并记录 `plan.grant.invalidated`。
- 用户在既有 Handoff 替代面板显式确认替代 Agent 时，`confirmReassignment` 调用 `PlanGrantService.amendAgentForConfirmedReassignment`，只增加该确认 Agent，并记录 `plan.grant.amended`；自动/未经确认的替代不会扩展授权，会先暂停等待授权。

### 2.6 当前 AI 连接/模型选择（未变）

Planner 继续复用现有默认 AI 连接/默认模型：`AIConnectionService.getDefault()` + `ProviderManager.createProvider(id, defaultModelId)`。没有 ModelRouter；用户仍在既有 Settings → AI 连接/模型目录中切换默认连接与模型。Agent 仍由既有 `AgentAssignmentResolver` 分配，模型不选择 Agent，Agent ≠ Runtime/Harness ≠ AI 模型。

## 3. 文件与迁移

### 3.1 V22 迁移

`packages/persistence/src/migrations.ts` 新增：

| 表 | 作用 |
|---|---|
| `plan_execution_grants` | 计划执行授权：project/plan/revision/fingerprint、actor、actions、allowed paths/tasks/agents、runs/tool-call 限额、expiry、revoke、note、last_used_at |
| `planner_usage_records` | Planner 每次模型尝试的 usage：requestId+attempt 唯一、project/plan/revision、连接/模型、tokens、cost/currency/pricing_version、outcome |

索引：`plan_id/issued_at`、`project_id/issued_at`、project/created_at、plan/created_at。

### 3.2 主要文件

**新增**

| 文件 | 内容 |
|---|---|
| `packages/contracts/src/plan-grant.ts` | 授权/风险/执行 API 合约；`PlanExecutionGrantView`；Planner usage 合约 |
| `apps/runtime/src/plan-grant.ts` | 授权签发/指纹/路径校验/启动与工具消费/撤销/替代确认扩展 |
| `apps/runtime/src/planner-usage.ts` | Planner 每次尝试 usage 记录，真实/未知价格处理 |
| `apps/desktop/src/renderer/.../PlanGrantPanel.tsx` | 计划弹窗内的授权表单、范围/风险/状态/撤销 UI |
| `tests/r2b2-plan-grant.test.ts` | 11 项授权/路径/撤销/过期/能力/usage/真实 AgentRunner 写入测试 |
| `scripts/r2b2-plan-grant-ui-e2e.mjs` | 12 checks 真实 Electron UI 授权闭环 |
| `scripts/r2b2-real-grant-e2e.mjs` | 12 checks 真实 Provider 计划 + 授权 + 低风险写入 |
| `test-results/r2b2/` | 截图与 `real-grant.json` |

**修改**

- `packages/contracts`：plan-grant 导出、API（`plan.grant.*`、`orchestration.start.grantId`）、AI usage summary、`PlannedTask.hardCapabilities`、事件。
- `packages/domain/src/events.ts`：`plan.grant.issued/revoked/started/consumed/invalidated/amended`。
- `packages/persistence`：V22、grant/planner usage store/read models/rows、`summarizeAIUsage` 合并 Planner usage。
- `packages/planning`：hard/soft capability 规则；Planner prompt 输出 `hardCapabilities`；候选硬能力阻断。
- `apps/runtime`：`PlanGrantService`、PlannerUsageService、dispatcher、scheduler guard、AgentRunner 写入授权路径、Orchestrator 替代确认扩展。
- `apps/desktop`：Main IPC/preload、计划弹窗与授权面板、Usage 设置、queries、CSS。
- `tests`/scripts：V22 迁移测试、R2 quality 测试显式授权、V1.8/V1.3 orchestration/R2 reassign E2E 先签发授权；2B-1 脚本保持不变。

## 4. Agent 硬能力与软能力规则

### 4.1 硬能力

角色核心能力自动作为硬条件（`mergeHardCapabilities`）：

| role | hard capabilities |
|---|---|
| architect | `architect` |
| developer | `implement` |
| reviewer | `review` |
| tester | `test` |
| custom | 无（避免把宽泛角色机械阻断） |

模型只能通过 `hardCapabilities` 增加最多 2 项确实不可替代的额外硬能力；普通辅助能力放在 `capabilities`（软偏好）。

### 4.2 软偏好

`requiredCapabilities` 仍只影响候选评分与原因，不硬阻断；缺少软能力的 Agent 可以在没有更好候选时被选中，并在 `assignmentReasons` 中记录未匹配。

### 4.3 阻断与排队

- 缺少硬能力 → candidate 被拒绝；全部候选不足时 `assignmentBlocked=true`，`approvePlan` 拒绝。
- Agent 禁用/不可见/Skill 缺失/Runtime 不可用 → 既有候选阻断逻辑，不静默降级。
- 用户显式指定 Agent 若缺少硬能力 → `assignmentBlocked=true`，不能绕过。
- 容量繁忙 → 既有 Task Lease/Agent 全局容量排队；不会伪装成“无可用 Agent”。
- 模型提供的 `agentId`/`runtime`/`skills` 仍被 Planner 忽略；只接受角色/能力要求，实际分配由既有 resolver 完成。

### 4.4 2B-1 三份真实计划的复核

来源：`test-results/r2b1/real-plans.json` 与三张真实截图。复核结果：

| 计划 | 任务 | 角色/实际 Agent | 硬能力检查 |
|---|---:|---|---|
| 按钮样式 | 3 | developer/agt_engineer、reviewer/agt_reviewer、tester/agt_qa | implement/review/test 全部满足 |
| RBAC | 8 | architect/agt_architect；developer/agt_engineer ×3；tester/agt_qa ×2；reviewer/agt_reviewer；custom/agt_product | architect/implement/test/review 全部满足；custom 无硬条件 |
| 性能 | 7 | developer/agt_engineer ×4、architect/agt_architect、tester/agt_qa、reviewer/agt_reviewer | implement/architect/test/review 全部满足 |

结论：三份真实计划的所有节点均有合法 Agent 绑定，角色能力差异有意义；合法草稿可以批准，但批准后 `execution=null`，只有显式 grant 才能启动。2B-2 的真实执行验证使用了一个**用户编辑后的单任务真实 Provider 草稿**（见 §6），以保持隔离副作用最小；原始真实草稿完整记录在 `real-grant.json`。

## 5. PlanExecutionGrant 数据模型与风险表

### 5.1 数据模型

`plan_execution_grants` 关键字段：

- `project_id`、`plan_id`、`plan_revision`、`plan_fingerprint`（对 id/revision/goal/createdTaskIds/tasks/Agent/能力/依赖/验收/产物做稳定 SHA-256）；
- `actor_kind/actor_id/actor_name`（本地产品只有 `local-user`；自动化修复为 `system:automation`）；
- `actions_json`（`plan.start` / `workspace-write`）；
- `allowed_paths_json`、`allowed_task_ids_json`、`allowed_agent_ids_json`；
- `max_runs/used_runs`、`max_tool_calls/used_tool_calls`；
- `allow_over_budget`、`note`；
- `issued_at/expires_at/revoked_at/revoked_reason/last_used_at`。

视图 `PlanExecutionGrantView` 计算 `status`、`valid`、`invalidReasons`、`canStart`、`planStatus`。状态优先级：revoked → expired → exhausted → active。`valid` 还检查 plan 状态、revision、指纹、任务覆盖、当前 Agent 分配；`canStart` 只在无 execution 或 failed/cancelled 时成立，`paused` 走继续执行。

### 5.2 风险表

| 能力/操作 | 默认 | 可被 grant 覆盖 | 仍需 |
|---|---|---|---|
| `plan.start` | 未授权 | 仅显式授权后，一次启动消耗 | 计划必须 approved；budget/lease/容量仍检查 |
| `workspace-write` | 未勾选 | 是，仅 allowedPaths + allowedTasks + allowedAgents，非敏感路径 | `ToolHandler` 实际路径校验；工具调用上限 |
| `run_command` / `run_tests` | 逐次审批 | **否** | 既有 per-call Approval + PolicyEngine |
| `git_commit` | 逐次审批 | **否** | 既有 per-call Approval |
| `runtime.*` / 外部 Harness | 逐次审批/受限 | **否** | 既有逐次审批；不因 Harness 可信而放开 |
| `.env`/secrets/auth/migrations/package.json/CI | 逐次审批 | **否**（allowed path 也会拒绝/回退到 Approval） | 高风险 Approval |
| 破坏性命令 | 逐次审批 | **否** | 既有 acceptance/policy 风险 |
| 路径 `../`/绝对路径/符号链接/连接点跨界 | 阻断 | 否 | 实际目标 realpath/工作区边界 |
| 超软预算 | 默认阻止 | 仅 `allowOverBudget=true` + ≥8 字说明 | 用量/spent/softLimit 审计 |
| task/Agent 更换 | 不自动继承 | 仅用户显式确认替代 Agent 时追加 | 重新分配后旧 grant 失效；自动替代暂停 |

### 5.3 一致性与并发

- 创建 grant 时撤销同 plan 旧 active grant，并写入 `plan.grant.issued`，在同一事务内完成。
- 启动消费使用条件 `UPDATE ... WHERE revoked_at IS NULL AND expires_at > ? AND used_runs < max_runs`，原子返回 `changes`；并发启动只有一个成功。
- 工具调用消费同样条件更新 `used_tool_calls`；失败不执行工具。
- `plan.grant.revoke` 幂等；已撤销不重复写事件。撤销后若 plan running/paused，调用既有 `scheduler.cancel` 取消活动 Runs。
- revision supersede 后旧 grant 因 plan 状态/指纹/revision 检查失效；不会继承到新 revision。
- `plan.grant.get/issue/revoke` 都经 Runtime/Main IPC 与 SQLite，不以 Renderer 缓存作为授权依据。

### 5.4 与 Approval 的关系

PlanExecutionGrant 是**执行授权**，不是新的通用审批队列；高风险工具仍使用既有 `Approval` 实体/表/per-call 流程。grant 的创建/使用/撤销有独立审计事件，审批界面与运行审计仍复用现有页面。单用户产品只有 `local-user`，没有虚构 admin/approver。

## 6. 真实 Provider 计划、授权与低风险写入

脚本：`scripts/r2b2-real-grant-e2e.mjs`
证据：`test-results/r2b2/real-grant.json`、`real-grant-before.png`、`real-grant-revoked.png`

- 隔离临时 data dir + Electron user-data dir；只复制已授权 Provider 的加密 `provider.json` 与 Chromium `Local State`；safeStorage 在 Electron 内解密。
- 真实连接：隔离迁移产生的 `Legacy OpenAI-compatible`；协议 `openai-chat`，模型 `deepseek-flash`。
- 真实 Planner 生成 1 个任务草稿（deepseek-flash，1 次调用，上下文 1,240 字符，原始任务 `写入并回读验证 src/notes.txt`）。
- 为保持隔离副作用最小，用户显式把 draft 编辑为一个任务：写 `src/notes.txt` 并读取确认；`generatedBy=provider` 来源保留，编辑事实明确记录。
- 审批：创建 1 个 Task，`execution=null`。
- 授权：`actions=[plan.start, workspace-write]`，`allowedPaths=[src]`，`maxRuns=1`，`maxToolCalls=20`，`usedRuns=1`，`usedToolCalls=1`，最终 `revoked`。
- 真实 AgentRunner 在既有执行链中完成 `write_file`（`toolCallId=tol_...`），文件内容 `hello from plan grant`；没有 write_file 的 per-call Approval；Run 有真实记录。
- 撤销后 plan `cancelled`；不会继续产生新的授权写入。
- Planner usage：真实 Provider 返回 token 数据，记录 1 次 Planner call（本次 input 1,537 / output 2,193 tokens）；**没有模型单价，estimatedCost=0 但 `costUnknown=true`、`unpricedCalls=1`，不宣称零成本**。Run usage 在撤销时尚未写入 `ai_usage_records`，因此 `runs=0`；这是“未知/未记录”而非伪造 0 的 Agent 费用。

## 7. 后端拒绝、授权、撤销与恢复测试

`tests/r2b2-plan-grant.test.ts`（11 tests PASS）：

1. 授权绑定 approved revision、全部任务/Agent，启动计数原子消费；第二次启动被拒。
2. 拒绝空路径、绝对路径、`..`、`src/auth`、`package.json`。
3. 撤销、过期、任务重新分配后的写入 deny；进程工具仍 Approval；重新分配后 view 失效。
4. 符号链接/连接点逃逸 deny（Windows junction fixture）。
5. 硬能力缺失阻断；软能力只影响评分，不阻断。
6. 真实 `AgentRunner` 使用 grant 完成 scoped `write_file`，无 per-call Approval，usedToolCalls=1。
7. 无 grant 的 dispatcher start → `APPROVAL_REQUIRED`，不产生 execution。
8. 超预算 opt-in 必须有 ≥8 字说明；无 grant 的 allowOverBudget 绕过被拒。
9. 旧 revision supersede 后旧 grant 失效，新 revision 不继承。
10. Planner usage 按 attempt 记录，未知价格 `costUnknown`，有价格时真实计算，重复 attempt 不重复累计。
11. R1/R2 P0-04/R1 容量/预算/Reconcile/Handoff/Inbox 既有测试继续通过。

真实 Electron UI / 执行回归：

| 回归 | 结果 |
|---|---|
| `scripts/r2b2-plan-grant-ui-e2e.mjs` | **12 checks PASS**：批准不等于执行、写权限默认关、显式确认、授权并开始、真实 Run、无 write approval、撤销、撤销停止计划、危险默认重置、125% 缩放、深色 |
| `scripts/r2-reassign-ui-e2e.mjs` | **12 checks PASS**：显式替代确认后调度器继续执行（grant Agent 范围被审计扩展）；取消保持 blocked/paused |
| `scripts/r2b1-planner-ui-e2e.mjs` | **11 checks PASS**：2B-1 Planner 来源/编辑/错误/回退未回归 |
| `scripts/v18-teamwork-e2e.mjs` | **7 checks PASS**：同 Agent 串行、不同 Agent 并行、DAG、不可用 Runtime 阻断 |
| `scripts/v13-orchestration-e2e.mjs` | PASS：4-task plan 真实执行、usage、质量报告、worktree |
| `scripts/v13-e2e.mjs` | PASS：扫描、计划批准、DAG、布局、连接编辑、重启 |
| `scripts/v14-e2e.mjs` | PASS：健康检查/提案/重启 |
| `scripts/r21-ui-regression.mjs` | **16 checks PASS**，15 张截图 |
| `scripts/e2e.mjs` | PASS：创建项目 + 重启恢复 |
| `pnpm package:dir` / `pnpm test:package` | PASS：打包 EXE 创建项目、starter、重启 |

## 8. Planner 用量记录与现有预算

- `PlannerUsageService` 每次模型尝试记录一行 `planner_usage_records`：`request_id + attempt` 唯一；真实 Provider 的 usage 事件才写 tokens；无 token 为 `usage_source=unknown`，不填 0。
- 单价来自既有 `ai_model_prices`；有价格时按 input/output per-million 真实计算；无价格 `estimated_cost=NULL`，`currency=NULL`，`pricing_version=NULL`。
- `summarizeAIUsage` 将 Run usage 与 Planner usage 合并到项目总 token/已知费用；新增 `planner` 子结构、`costUnknown`、`unpricedCalls`。未知费用不被展示为确定零成本。
- UI `UsageSettingsPanel` 新增 Planner calls/tokens/cost、未知单价调用和 “+ 未知”提示。
- 单元测试：attempt 1 无价格 → unpriced；attempt 2 有价格 → cost=3；重复 attempt 不重复累计。
- 真实证据：Planner call 1 次，input 1537/output 2193，`costUnknown=true`；Run usage 在撤销时未写入，`runs=0`，没有填 0 冒充 Agent 费用。

## 9. UI 改动与 Electron 截图

只修改既有计划弹窗与 Usage 设置，没有新增路由/页面。

- 批准后立即显示 **“计划已批准，但尚未授权执行”**；
- 危险写权限默认**未勾选**；路径 tags、有效期、启动次数、授权写入次数显式输入；
- 授权范围显示任务数、Agent 数、启动/写入用量、路径、actions、到期时间、是否允许超预算；
- “开始执行”只在有效 grant 且 `canStart` 时出现；
- 撤销确认后显示 revoked；危险默认全部重置；
- 硬能力以红色标签显示；存在 assignmentBlocked 时禁止批准并显示缺失原因；
- 125%/深色/浅色布局保留玻璃材质；无 renderer page error。

截图：

| 截图 | 内容 |
|---|---|
| [`grant-before.png`](test-results/r2b2/grant-before.png) | 批准后未授权；写权限默认关 |
| [`grant-active.png`](test-results/r2b2/grant-active.png) | 有效授权、进度/撤销、真实 Run |
| [`grant-revoked.png`](test-results/r2b2/grant-revoked.png) | 撤销后状态、危险默认重置 |
| [`grant-dark.png`](test-results/r2b2/grant-dark.png) | 深色主题 |
| [`grant-zoom125.png`](test-results/r2b2/grant-zoom125.png) | 125% 缩放 |
| [`real-grant-before.png`](test-results/r2b2/real-grant-before.png) | 真实 Provider 计划 + 有效 grant；来源 `deepseek-flash` |
| [`real-grant-revoked.png`](test-results/r2b2/real-grant-revoked.png) | 真实 grant 撤销后的持久状态 |

真实 Provider 截图中连接名为隔离迁移的 `Legacy OpenAI-compatible`；这是隔离测试迁移产物，不代表新增连接或路由机制。

## 10. 验证结果

| 命令 | 结果 |
|---|---|
| `pnpm lint` | PASS（0 error；依赖边界 PASS） |
| `pnpm typecheck` | PASS |
| `pnpm test` | **233 passed，3 skipped**（43 个文件通过，1 个文件 skip） |
| `pnpm build` | PASS（runtime + desktop） |
| `pnpm test:teamwork` | PASS（7 checks，9 provider requests） |
| `node scripts/v13-e2e.mjs` | PASS（plan r1 4 tasks superseded；10 nodes/12 edges） |
| `node scripts/v13-orchestration-e2e.mjs` | PASS（4-task plan executed；usage/quality/worktree） |
| `node scripts/v14-e2e.mjs` | PASS |
| `node scripts/r21-ui-regression.mjs` | PASS（16 checks；15 截图） |
| `node scripts/r2-reassign-ui-e2e.mjs` | PASS（12 checks；6 截图） |
| `node scripts/r2b2-plan-grant-ui-e2e.mjs` | PASS（12 checks；5 截图） |
| `node scripts/r2b2-real-grant-e2e.mjs` | PASS（12 checks；3 证据文件） |
| `node scripts/r2b1-planner-ui-e2e.mjs` | PASS（11 checks；4 截图） |
| `node scripts/e2e.mjs` | PASS |
| `pnpm package:dir` / `pnpm test:package` | PASS |

### 10.1 真实发现并修复的问题

1. **V1.8 同 Agent 多任务授权失败**：初版把“唯一 Agent 数”与“任务数”比较，两个任务共用 `agt_engineer` 时误判为有任务未分配。已改为检查每个 Task 是否为空分配；V1.8 重跑 7 checks PASS。
2. **R2 替代确认后计划被暂停**：任务重新分配后旧 grant 的 Agent 范围失效，这是正确安全行为，但既有 R1/R2 显式确认流程需要继续执行。已实现仅对**用户显式确认**的替代 Agent 做审计扩展（`plan.grant.amended`）；自动替代仍暂停等待授权。R2 reassign 12 checks PASS。
3. **V22 迁移测试预期旧版本**：将 V18→V21 迁移测试更新为 V18→V22，并断言 grant/planner usage 表存在。
4. **真实撤销截图滞后**：API 撤销后 Renderer 缓存仍显示 active；E2E 在截屏前 reload，以持久状态截图。产品 UI 的 revoke 动作本身会刷新 draft/grant 查询。
5. **真实 Provider 截图/执行**：真实 Provider 只用于真实计划与低风险写入；UI 的 fake Provider 逻辑明确标记为 Mock，未冒充真实模型。

### 10.2 未执行/未覆盖

- `tests/r2-real-harness.test.ts` 的 3 个真实 Harness 测试因无密钥 **skipped**；未把 2B-1 的真实 Harness 证据冒充为本轮新跑。
- 未重新运行 `r2-package-features` / `r2-package-migration`；本轮无 R2 特性/迁移语义变更，已完成 `package:dir` + package smoke。
- 未做全站逐页像素级 UI 回归；UI 证据覆盖计划授权面板、R2.1 既有页面、V1.3/V1.4/V1.8。
- 真实 Provider 只验证 DeepSeek `deepseek-flash`；OpenAI/Anthropic 协议未用真实密钥验证。
- 真实 Provider 计划执行使用用户编辑后的单任务草稿（原始真实草稿已保存），不是未编辑的全量 AI 计划执行；这是为了隔离环境下的最小副作用，不把编辑后的任务冒充模型原文。

## 11. 遗留问题与 Phase 2B-3 边界

**本轮未实现（按指令停止）：**

- Phase 2B-3 自动动态重规划、执行中自动修订/重新授权；
- Agent 路由页面/配置/绑定流程（不恢复）；
- 新 ModelRouter/AgentRouter、Agent Runtime、Task/Scheduler/DAG 编辑器、Teamwork 页面；
- 计划自动批准、自动授权危险操作、自动启动。

**已知限制：**

1. Plan grant 目前只覆盖 `plan.start` + `workspace-write`（`write_file`）；`run_command`/`run_tests`/`git_commit`/`runtime.*` 始终逐次 Approval，符合最小权限，但计划执行可能因进程审批暂停。
2. Grant 必须覆盖该 plan revision 的全部 tasks 与当前全部 assignee Agents；暂不支持只授权子任务集合。
3. 自动/低风险 Handoff 替代不会自动扩展 grant；只有用户显式确认替代 Agent 才扩展，否则会暂停等待授权。
4. 启动消费在 `scheduler.start` 之前执行；若后续 workspace 准备失败，`used_runs` 已消费，需要重新授权（不会误放行，但用户体验可改进）。
5. Planner usage 已记录，但真实模型价格未配置时费用保持 unknown；不会估算或填 0。
6. 真实 Run 的 Agent usage 在撤销时可能尚未落库（本轮 `runs=0`）；UI 以 unknown 展示，不伪造。
7. 未做多进程真实 grant 竞争 E2E；原子 SQL 与单进程测试已覆盖，跨进程竞争仍是风险。
8. 真实 Provider 仅 DeepSeek；外部 Harness 的 CLI/ACP 作用域仍由既有逐次审批保护。
9. 真实高风险副作用未在无确认情况下执行；本报告不声称已执行高风险验证。

## 12. 停止边界

- 2B-1 AI Planner 成果完整保留；2B-2 计划授权、Agent 硬/软能力、真实写入、撤销、usage 记录和 UI 闭环已完成。
- 未恢复 Agent 路由，未开发 Phase 2B-3，未覆盖用户真实数据库/安装包。
- **现在停止，等待验收。**
