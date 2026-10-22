# ProjectOS Agent Teamwork — Phase 2B-3 报告

> 日期：2026-10-21
> 范围：Phase 2B-3 动态重规划、Revision Diff/成果复用、计划授权联动、授权启动失败恢复、跨进程授权竞争、真实多任务 DAG。
> 基线：`feature/v1.6-ux`，HEAD `81cc50c`；Phase 2B-2 未提交成果已备份到 `test-results/phase2b2-backup/`。
> 本轮未创建 Git commit；未恢复 Agent 路由；未实现 Phase 2B-4。
> 证据目录：`test-results/r2b3/`；既有 R1/R2/2B1/2B2 证据仍保留。
> **后续补验：`ProjectOS_Agent_Teamwork_Phase2B3_Closure_Report.md`。** 该报告已补充真实自动触发 + 真实 DeepSeek Replanner proposal；本报告 §8/§12 中“真实 Replanner 未跑”已被 Closure 报告更新，但 P0-14/P1-13 仍未完整闭环。

## 1. 结论与停止边界

已完成：

- V23 数据库迁移（启动预留表、授权 `reserved_runs`、Replan Proposal 表）。
- 授权启动从“先扣 used_runs”改为“原子预留 → 成功结算 / 失败释放”，支持幂等、崩溃恢复、Workspace 失败恢复；真正产生执行/Run 时不返还。
- 两个独立 OS 进程对同一 SQLite 授权进行启动与工具配额竞争，启动 1 次、工具 1 次，不超发；撤销/过期后 deny；崩溃预留可释放。
- Replan Proposal 服务、真实执行上下文、Provider-backed Replanner、结构化 DAG 校验、Revision Diff、Agent 变化、Artifact 复用/重新验证、授权影响、次数/模型调用上限、UI 面板。
- 已完成任务复用：批准新 revision 时直接复用旧已完成 Task，不创建重复任务；验收/产物/角色变化时不复用。
- 真实 DeepSeek 计划（2 个任务，未人为缩减）通过既有 Scheduler/AgentRunner 执行完成：2 个 Run、2 个 done Task、6 个 Artifact、两个真实文件、Planner + Run usage。
- UI：现有计划弹窗内新增动态重规划面板；深色、125% 缩放、真实鼠标键盘验证。
- 全量 241 passed / 3 skipped；V1.8、V1.3、V1.4、R2.1、2B2 UI、2B3 UI、打包 smoke 通过。

未完成/限制（必须保留）：

- 自动 trigger 只在代码路径中接入（重试耗尽、质量门禁失败、补证耗尽、无 assignee Agent），**没有完成“真实失败 → 自动 Replan → 应用 → 重新授权 → 最终完成”的完整 E2E**。
- 真实 Replanner 没有用真实模型跑过；Replan 提案/应用/拒绝/无效 DAG/限制测试使用 FakeProvider + 真实 SQLite/真实 Electron。
- 真实多任务 DAG 的两个任务都由 `agt_engineer` 执行；跨角色接力/Handoff 的真实 Provider 案例未完成（V1.8 为 fake provider）。
- 外部 Runtime 只有 Claude Code/Codex 适配层审计；未在本轮真实执行；PlanGrant 不是 OS 沙箱。
- 未实现 Phase 2B-4；未恢复 Agent 路由。

## 2. 实际代码改动

### 2.1 数据库 V23

`packages/persistence/src/migrations.ts`：

| 表/列 | 作用 |
|---|---|
| `plan_execution_grants.reserved_runs` | 启动中的预留数量；`used_runs + reserved_runs < max_runs` 才能预留 |
| `plan_grant_start_reservations` | 每次启动的持久预留：grant/plan/revision/fingerprint、幂等键、`reserved/started/failed`、RunIds、错误、时间 |
| `plan_replan_proposals` | Replan 提案：trigger/status/reason/context/proposed tasks/diff/grant impact/generation/error/requestedBy/appliedPlanId/modelCalls |

索引：预留状态/时间、Replan plan/status。V22→V23 迁移保持旧数据；V18 迁移测试已更新到 V23。

### 2.2 授权启动预留

- `PlanGrantService.reserveStart`：
  - 先按 `(grant_id, idempotency_key)` 查找；已成功/已失败按幂等语义处理。
  - `UPDATE ... SET reserved_runs = reserved_runs + 1 WHERE ... revoked_at IS NULL AND expires_at > ? AND used_runs + reserved_runs < max_runs`。
  - 插入 reservation；并发只有一个成功。
- `markStartSucceeded`：同一事务把 reservation 置 `started`，`reserved_runs - 1`、`used_runs + 1`。
- `markStartFailed`：只释放本 reservation 的 `reserved_runs`；`used_runs` 不变。
- `settleStartFailure`：若已产生 Run / execution running/paused/completed / runIds，则按成功消费；仅 failed execution 且无 Run（Workspace 初始化失败）才释放。
- `recoverStartReservations`：启动时扫描 stale `reserved`；有真实 Run/执行则结算，否则释放。绝不简单全局减 `used_runs`。
- Dispatcher：`startRequestId` 幂等键；启动前检查已有 reservation；成功/失败均结算；`recoverOrchestrations` 调用恢复；自动化修复路径同样使用预留。
- `PlanGrantPanel` 显示 `used + reserved / max`。

### 2.3 Replan 服务与契约

新增：

- `packages/contracts/src/plan-replan.ts`：trigger/status/diff/grant impact/proposal/view/propose input。
- `apps/runtime/src/replan-context.ts`：有界（14k chars）、脱敏、只读上下文。
- `apps/runtime/src/replan-service.ts`：propose/apply/reject/list/get、diff、grant impact、限制、状态。
- `packages/planning/src/replan-prompt.ts`：`replan-v1` 修订提示词。
- `apps/runtime/src/planner.ts`：`generateRevision` 复用真实 Provider、预算、超时、usage、一次有界纠错。
- `packages/contracts/src/orchestration.ts`：context source 增加 run/tool-call/handoff/grant。
- `apps/runtime/src/orchestrator.ts`：自动 trigger hook；在重试耗尽/质量门禁/补证耗尽/无 assignee 时通知 dispatcher；异步生成提案，不直接改 Scheduler。
- Dispatcher：`plan.replan.propose/list/get/apply/reject`。
- Desktop preload/API、`ReplanPanel.tsx`、计划弹窗、CSS。

### 2.4 复用与 Revision

- `OrchestrationService.taskRequirementSignature`：role + acceptance + expectedArtifacts + required/hard capabilities。
- `reuseReferences(source, nextTasks)`：只有 key 相同且 requirements 完全一致、旧 Task done 才复用。
- `approvePlan`：reuse 节点直接把旧 done Task ID 放入新 plan `createdTaskIds`，不创建重复 Task、不重复执行；写 `plan.task.reused` 审计。
- `revisePlan`：
  - supersede 旧 plan、取消未完成旧 Task；
  - 撤销旧 revision 的 active grants；
  - 旧已完成 Task/Artifact 保留；
  - 新 revision 中修改验收/产物时不再复用，并在 proposal `revalidate` 中标记。
- `replan.apply` 要求无 running 计划、无活动 Run；否则 `CONFLICT`，不会未经处理接管运行中任务。

## 3. 动态重规划触发与状态机

### 3.1 触发来源

| 来源 | 自动/手动 | 当前实现 |
|---|---|---|
| 重试耗尽 | 自动 | `retry_exhausted`；plan execution failed 且重试到上限 |
| CompletionDecision 证据/补证耗尽 | 自动 | `evidence_exhausted`；补证上限后 pause |
| 质量门禁失败 | 自动 | `quality_gate_failed`；review loop failed |
| Agent/Runtime 不可用 | 部分自动 | 无 assignee 时 `agent_unavailable`；Handoff 替代仍先走既有 R2 流程 |
| 上游 Artifact 无效 | 手动 | `artifact_invalid` trigger；自动 hook 未单独接入 |
| 用户请求调整 | 手动 | UI “用户主动调整” |
| 实际约束变化 | 手动 | UI “项目约束变化” |

`assertTriggerFact` 校验事实，避免安全重试/补证被误当成 Replan；失败触发必须有 failed/error 事实。

### 3.2 状态机

```text
plan approved
  ├─ 正常重试 / 补证 / 合法换人 → 继续现有 Scheduler（不 Replan）
  └─ 事实耗尽
       → propose: proposed（只读提案，不改 plan/grant）
            ├─ reject → rejected（旧 plan、旧 grant、旧 execution 不变）
            ├─ generation invalid → failed（proposedTasks 为空，旧 plan 不变）
            └─ apply → 新 draft revision
                 → 旧 revision superseded，未完成旧 Task cancelled，旧 grant revoked
                 → 用户重新批准 → 重新签发 PlanGrant → 下一次显式启动
```

限制：每 plan 最多 3 个 proposal、累计最多 5 次模型调用；Planner 自身有 timeout、输出 token/字符、一次纠错；超过限制返回 `CONFLICT`。

## 4. Replan Context

`buildReplanContext` 读取并转换：

- 项目/计划/revision/status/execution error；
- 每个 Task 的状态、Agent、依赖、验收、预期产物、Run、ToolCall 状态/错误/路径；
- 已记录的文件变化（相对路径，不读文件内容）；
- 只列 verified Artifact 作为证据，未验证仅计数；
- Handoff/依赖交接（summary 脱敏）；
- 当前 Agent 能力/可用状态；
- 当前 Plan Grant 状态/actions/paths/agents/配额/过期/失效原因；
- 项目预算与 Planner/Run 用量；
- 本次 trigger/reason。

所有自由文本经 `redactSecrets`；字符上限 14k；绝对工作区路径不发送；Agent 自然语言声明不被当成完成证据。

## 5. Revision Diff、Agent 变化、Artifact 复用

`ReplanProposal.diff` 包含：

- `kept` / `added` / `removed` / `modified`；
- `dependencyChanges`；
- `agentChanges`（前后 Agent ID/name）；
- `acceptanceChanges`；
- `reusableArtifacts`（旧 Task done + requirements 未变）；
- `revalidate`（验收/产物变化，或任务删除但已有 verified Artifact）。

复用策略：

1. 不是“标题相同”就复用；必须 key 相同且 requirements signature 一致。
2. 已完成 Task 直接复用旧 Task ID；不创建重复节点、不重复执行。
3. 修改验收/预期产物/角色 → 不复用，列入 revalidate，要求新的执行证据。
4. 旧 Artifact 保留历史；新 revision 不把旧 Artifact 当新 evidence。
5. 正在运行的旧 Task 不被新 revision 接管；apply 返回冲突，要求暂停/取消/等待。
6. 旧 revision 与新 revision 不重复调度：supersede 取消未完成旧 Task，已完成旧 Task 保留且新 plan 引用。
7. 未知副作用 Run：沿用 `needs_reconciliation`，不自动重试；Replan 不绕过 Reconcile。
8. 每次修订记录 `plan.replan.proposed/applied/rejected/failed`、`plan.task.reused`、`plan.grant.invalidated`。

## 6. Plan Grant 变更与重新授权

- Revision 生成后 `grantImpact` 计算：
  - 旧 grant 状态/valid；
  - `newAgents`、`removedAgents`；
  - 新增/删除任务；
  - 验收变化、角色变化；
  - `requiresNewGrant`；
  - `withinOriginalScope`（语义范围）与 expanded reasons。
- 由于 grant 绑定 `plan_id + revision + fingerprint`，**任何 revision 都要求新 grant**；不会改旧 grant 的 fingerprint 绕过。
- `revisePlan` 撤销旧 active grants；旧授权不能恢复 active。
- 提案 UI 明确显示“需要重新签发计划授权”；用户应用后得到 **draft**，仍需批准计划 + 新 grant；不会自动开始。
- 如果新 Agent/任务/验收扩大，`expanded` 列出；UI 不隐藏。
- 用户拒绝 proposal → 旧计划/grant 不变。
- 旧 grant 撤销/过期后 `authorizeToolCall` 对副作用工具 deny；不会重新审批放行。

## 7. 外部 Runtime 权限边界（审查结论）

实际代码只有：

- Claude Code：`--permission-mode plan|acceptEdits`、`--allowedTools Read,Glob,Grep` 或 `Read,Edit,Write,Glob,Grep`；写模式绑定隔离 worktree。
- Codex CLI：`codex exec --json --sandbox read-only|workspace-write`；写模式绑定隔离 worktree。
- 无 OpenCode/DSH 的 ProjectOS adapter；没有通用 OS 沙箱。

边界：

- ProjectOS 可以拦截/控制的：启动哪个 adapter、read/write 模式、cwd/worktree、Run/ToolCall 审计、任务/计划/Lease/预算；外部进程内部的具体工具调用**不在 ProjectOS ToolHandler** 中，无法逐次拦截。
- Harness 自身支持的：Claude 的 permission mode/allowedTools；Codex 的 sandbox。它们是 Harness 侧约束，不是 ProjectOS PlanGrant 的结果。
- 无法强制：外部 CLI 在自身 sandbox/permission 范围内执行的命令、文件访问、网络行为；PlanGrant 不能等同于操作系统沙箱。
- 因此外部 Runtime 的细粒度权限**不宣称已解决**；本轮没有真实外部 Harness 执行证据。Open Issues P0-15 标记“明确接受风险”。

## 8. 真实多任务 DAG 证据

脚本：`scripts/r2b3-real-dag.mjs`
证据：`test-results/r2b3/real-dag.json`、`real-dag-approved.png`、`real-dag-completed.png`

- 隔离 data dir + Electron user-data；复制已授权 Provider 加密配置 + Local State；未打印/写 key。
- 真实连接：`Legacy OpenAI-compatible` / `deepseek-flash`。
- 真实 Planner：1 次调用，2 个任务（`write-alpha`、`write-beta`，均 developer、无依赖、可并行），**未人工缩减任务数**。
- 批准：2 个 Task，`execution=null`。
- 授权：`plan.start + workspace-write`，`allowedPaths=[src]`，maxRuns=1，maxToolCalls=40。
- 执行：2 个 Run（both completed），2 个 Task done，6 个 Artifact，`src/alpha.txt=alpha`、`src/beta.txt=beta`，plan completed。
- usage：Planner 1 call（input 1546/output 1658）；Run usage 2 calls（input 78,261/output 4,307）；总 3 unpriced calls，`costUnknown=true`。
- 限制：两个任务均分配给 `agt_engineer`；真实 Provider 下的跨角色接力/Handoff 尚未验证（V1.8 的跨 Agent 并行是 fake provider）。

## 9. 授权失败恢复与跨进程证据

脚本：`scripts/r2b3-cross-process-grant.mjs`
证据：`test-results/r2b3/cross-process-grant.json`

- 两个真实 OS 进程（独立 SQLite 连接、独立 PlanGrantService）同时：
  - 对同一 grant `maxRuns=1` 预留启动；
  - 对同一 grant `maxToolCalls=1` 请求 `write_file`。
- 结果（多次重跑稳定）：启动 `reserved=1 / rejected=1`；工具 `allow=1 / deny=1`；`used_tool_calls=1`；启动 `used_runs=0, reserved_runs=1`（预留未结算）。
- 恢复：把 stale reservation 置老；`recoverStartReservations` 释放 1 个；`used_runs=0, reserved_runs=0`；不错误扣减。
- 撤销后 `authorizeToolCall=deny`；过期 grant `deny`。
- 范围限制：这是真实独立进程 + 真实 SQLite + 真实 PlanGrantService，**不是两个完整 RuntimeSupervisor/Scheduler 进程**；完整 Runtime 子进程的启动竞争仍需后续覆盖。

单元测试：`tests/r2b2-plan-grant.test.ts` 13 tests，含预留幂等、失败释放、stale 无 Run 释放、有 execution 消费、路径/撤销/过期、AgentRunner 写入、超预算、revision。

## 10. UI

只扩展既有计划弹窗，没有新增 Planner/Teamwork 路由。

`ReplanPanel`：

- trigger 事实来源、状态、proposal 时间；
- Revision Diff 数量/修改字段/Agent 变化；
- 可复用成果、需重新验证；
- 授权影响（是否需新 grant、扩大项）；
- “应用为草稿 revision”“拒绝修订”；
- 已应用后提示重新批准/授权；
- Provider/model/attempts/context chars 来源；
- 与 PlanGrantPanel 同弹窗、同一设计系统；无第二套页面。

截图：

| 截图 | 内容 |
|---|---|
| [`replan-proposal.png`](test-results/r2b3/replan-proposal.png) | 提案、Diff、Agent 变化、授权影响 |
| [`replan-applied.png`](test-results/r2b3/replan-applied.png) | 应用后新 draft revision，不自动执行 |
| [`replan-dark.png`](test-results/r2b3/replan-dark.png) | 深色主题 |
| [`replan-zoom125.png`](test-results/r2b3/replan-zoom125.png) | 125% 缩放 |
| [`real-dag-approved.png`](test-results/r2b3/real-dag-approved.png) | 真实 Provider 计划批准后、未执行 |
| [`real-dag-completed.png`](test-results/r2b3/real-dag-completed.png) | 2-task DAG 完成 |

UI E2E：`scripts/r2b3-replan-ui-e2e.mjs`，9 checks，真实 Electron 鼠标/键盘；模态宽度改为按 DPR 自适应，125% 下 857px、面板 795.6px 在窗口内；无 renderer page error。

## 11. 测试命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm lint` | PASS（0 error；依赖边界 PASS） |
| `pnpm typecheck` | PASS |
| `pnpm test` | **241 passed / 3 skipped**（45 files，44 pass/1 skip） |
| `pnpm test:teamwork` | PASS（7 checks，9 provider requests） |
| `node scripts/v13-orchestration-e2e.mjs` | PASS（4-task plan，5 runs，quality reports 2，worktree merged） |
| `node scripts/v13-e2e.mjs` | PASS（plan r1 4 tasks superseded，10 nodes/12 edges） |
| `node scripts/v14-e2e.mjs` | PASS |
| `node scripts/r21-ui-regression.mjs` | PASS（16 checks，15 截图） |
| `node scripts/r2-reassign-ui-e2e.mjs` | PASS（12 checks） |
| `node scripts/r2b2-plan-grant-ui-e2e.mjs` | PASS（12 checks） |
| `node scripts/r2b3-replan-ui-e2e.mjs` | PASS（9 checks，4 截图） |
| `node --import tsx scripts/r2b3-cross-process-grant.mjs` | PASS（双进程；多次重跑） |
| `node scripts/r2b3-real-dag.mjs` | PASS（7 checks，真实 DeepSeek 2-task DAG） |
| `node scripts/e2e.mjs` | PASS |
| `pnpm package:dir` / `pnpm test:package` | PASS |

专项：

- `tests/r2b2-plan-grant.test.ts`：13 tests。
- `tests/r2b3-replan.test.ts`：6 tests（无失败事实不提案、Diff/Agent/授权、运行中拒绝、拒绝不改 plan、无效 DAG、应用新 revision/旧 grant 失效、次数上限）。
- `tests/r2-phase1.test.ts`：V18→V23 迁移、reserved_runs/新表、旧项目数据保留。
- `tests/r2-revision-inbox-legacy.test.ts`：复用旧 done Task ID，不重复创建。

### 11.1 真实/模拟区分

| 证据 | 真实部分 | 模拟部分 |
|---|---|---|
| `real-dag` | DeepSeek Planner、真实 SQLite、真实 Scheduler/AgentRunner、真实文件/Run/Artifact | 无；两个任务同 Agent |
| `replan-ui` | 真实 Electron、真实 SQLite、真实 IPC、真实 UI 交互 | Planner/Replanner 为本地 SSE FakeProvider |
| `replan.test` | 真实 SQLite、真实 ReplanService/OrchestrationService | Planner 为 FakeProvider |
| `cross-process` | 两个真实 OS 进程、独立 SQLite、真实 PlanGrantService | 未启动完整 RuntimeSupervisor/Scheduler |
| V1.8/R1/R2 | 真实调度/Lease/SQLite | 多 Agent Provider 为 fake |

## 12. 未解决/风险

1. **自动 trigger 到最终完成的真实 E2E 缺失**：代码已接入失败 hook，测试只覆盖 ReplanService 事实校验/提案/应用；未跑“真实失败 → 自动提案 → 用户应用 → 新 grant → 执行完成”。Open Issues P1-13 部分验证。
2. **真实 Replanner 未跑**：`generateRevision` 使用真实 Provider 路径，但本轮证据是 fake SSE；成本/时延/真实模型遵循修订提示词未验证。
3. **真实 DAG 是同一 Agent**：2 个任务均为 `agt_engineer`；不同 Agent/角色接力只有 V1.8 fake 和 R1 证据。不能宣称真实多角色开发完成。
4. **外部 Runtime 边界**：只有 Claude Code/Codex adapter 审计，未真实执行；无法逐调用拦截 Harness 内部工具；PlanGrant 不是 OS 沙箱。Open Issues P0-15 明确接受风险。
5. **跨进程范围**：独立进程使用 PlanGrantService + SQLite，不是完整 RuntimeSupervisor/Scheduler 双实例；启动竞争不覆盖完整 workspace/worktree 初始化。
6. **Replan 应用必须用户操作**：本轮不自动应用；即使变更严格在原范围内也要重新批准/签发新 grant（revision fingerprint 改变）。这是安全选择，但“自主继续”仍有人工步骤。
7. **Reconcile 门禁**：Replan 不自动重试未知副作用；`needs_reconciliation` 仍暂停等人工核对。未新增绕过路径。
8. **自动 trigger 限流**：每 plan 3 proposals/5 model calls；未实现 wall-clock 重规划时间窗或按 trigger 类型独立预算。
9. **UI 125%**：通过 DPR 自适应宽度修复；仅验证计划/Replan 弹窗，不是全站像素回归。
10. **未运行**：真实 Harness 3 tests skipped；`r2-package-features`/`r2-package-migration` 未重跑；未验证安装器/自动更新。

## 13. 停止

Phase 2B-3 核心实现、真实 2-task DAG、授权预留/跨进程、Replan 提案/Revision Diff/复用/授权联动、UI 已完成；上述未完成项已明确记录，不冒充生产可用或完整自主闭环。

**现在停止，等待验收。禁止提前进入 Phase 2B-4。**
