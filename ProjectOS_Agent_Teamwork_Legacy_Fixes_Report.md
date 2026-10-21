# ProjectOS Agent Teamwork — Legacy Fixes Report

> 基线：Phase 1 `4964770`、Phase 2A `f2a20a5`/`511489a`/`93db316`、Phase 2A.1 `12b14bf`。
> 本轮提交：`0e153b6`（`fix(teamwork): close legacy evidence, quality and recovery gaps`）。
> 范围：Phase 2A.1 报告第 8 节的 12 项遗留问题。**未实施 Provider-backed Planner（Phase 2B）**，未新增 Teamwork 页面，未重置用户数据库，未使用生产凭据。
> 问题清单：`docs/Agent_Teamwork_Open_Issues.md`。

---

## 1. 整改概览

**不是 12 项全部关闭。** 本轮优先完成“错误完成/证据链”和部分“恢复/并发”代码，真实环境、真实进程、打包与 UI 视觉仍保留为阻塞项。

| 状态 | 数量 | 项目 |
|---|---|---|
| 已验证关闭 | 1 | P0-11 Agent 直接 done 独立测试 |
| 待验证 | 4 | P0-03 质量策略、P0-08A revision、P0-08B 全局并发、P0-08C Inbox 队列（部分） |
| 处理中 | 4 | P0-04 人工/自动边界、P0-05 自动补证、P0-06 reconcile 继续、P0-12 结构化 Artifact |
| 未开始 | 3 | P0-02 进程恢复、P0-07 安全重分配、P0-08D 预算/超时、P1-09 UI、P1-10 打包（部分列在子项） |
| 阻塞待验证 | 1 | P0-01 真实外部 Runtime |

> 统计按主项归类；P0-08 的 A/B/C/D 与 P1 项目的具体状态见第 7 节与 Open Issues。

---

## 2. 逐项整改矩阵

| ID | 原因 | 修改文件 / 关键函数 | 验收标准 | 测试证据 | 最终状态 | 遗留风险 |
|---|---|---|---|---|---|---|
| P0-01 | 真实 Harness 未验证；Run 文件归属不足 | `agent-runner.ts`、`orchestrator.ts`、`runtime_profiles` | 真实 Runtime 隔离 E2E + Run 前后 diff 归属 | 无真实 Harness | **阻塞待验证** | 无凭据/认证；不能把 Mock E2E 当真实结果 |
| P0-02 | 缺真实进程 kill/restart E2E | `recoverInterruptedRuns`、`scheduler.recover`、`RuntimeSupervisor` | 真 kill/restart 后 DB/文件/Lease/Handoff/Inbox 一致 | 仅模拟/单测 | **未开始** | 发布/无人值守阻断 |
| P0-03 | QualityGate 无 required/optional 策略 | `quality-gate.ts`、`orchestrator.ts`、`project.qualityPolicy.*` | 必需缺失不得 pass；可选如实记录；项目可配 | `tests/orchestration.test.ts` 策略/无脚本测试 | **待验证** | Scheduler 自定义 policy E2E 未跑 |
| P0-04 | Human 可无证据完成；人/自动未区分 | `task-service.ts`、`completion-evidence.ts` | 人工/自动可区分；重复只有一条记录；Agent 不能走人工 | `tests/agent-completion-tool.test.ts` human/agent/重复 | **处理中** | 高风险任务额外证据/更高权限未做 |
| P0-05 | 证据不足只 pause | `orchestrator.ts` evidenceRetries | 有限自动补证；补证后重评；超限 pause；禁止空 Artifact | reviewer/no-script 测试会触发补证 | **处理中** | 补证成功后的完成 E2E 未做；次数上限 1 |
| P0-06 | reconcile 后需手动 resume | `dispatcher.ts` `run.reconcile`、`RunsPage` | Plan 同步；不重复；可审计；与 scheduler 兼容 | 3 个 reconcile 单测 | **处理中** | Plan resume 集成 E2E 未做 |
| P0-07 | 接收方失败无安全重分配 | 未实现 | 替代候选/权限/可见性/能力/Lease/统一 Scheduler | 无 | **未开始** | Phase 2B 必须；发布阻断 |
| P0-08A | 旧 revision 任务仍有效 | `orchestration.revisePlan`、`TaskService` | 旧 plan superseded；旧任务不重复调度；历史保留 | `tests/teamwork-relay.test.ts` revision 测试 | **待验证** | 已完成成果复用未做 |
| P0-08B | 跨计划同 Agent 并发 | `read-models.countActiveRunsForAgent`、`orchestrator` | 跨计划/跨进程容量受控；等待/取消/重启一致 | 代码已接入；无跨计划 E2E | **待验证** | 无公平队列/饥饿测试；容量默认 1 |
| P0-08C | Inbox 无 priority/backoff/终态 | `agent-runner.retryPendingInbox`、V18 | 幂等、退避、最大次数、超时终态、重启恢复 | inbox retry 测试（1 次 Run） | **待验证** | priority/backoff 未单独断言 |
| P0-08D | 无 Plan/原生 Run wall-clock 预算 | `MAX_AGENT_STEPS`、CLI/quality 120s | 硬限制到达停止新动作；不猜 Token/费用 | 无 | **未开始** | Phase 2C 发布阻断 |
| P1-09 | UI 改动未实机视觉回归 | `RunsPage` 核对 Modal | Electron 截图、状态、DPI、主题 | 无 | **未开始** | 发布阻断；不能只用 build 代替 |
| P1-10 | EXE 可能落后源码 | `release/`、`package-smoke` | 源码/产物 hash、迁移、功能一致 | `pnpm test:package` PASS，但产物缺少新功能 | **未开始/阻塞** | 打包产物非最新；不可宣称一致 |
| P0-11 | Agent 直接 done 无独立测试 | `tests/agent-completion-tool.test.ts` | 无证据/写拒绝/类型不匹配/测试缺失/合法/人机/重复/取消/Task Lease/文本覆盖 | **8 tests PASS** + 既有 lease 测试 | **已验证关闭** | 多 Agent Lease 由既有测试覆盖；未重复造 |
| P0-12 | 设计/审查靠关键词 | `artifacts.metadata_json` V17、`completion-evidence.ts`、`create_artifact` | 结构化 design/review 字段、来源 Run、类型/任务匹配、旧 Artifact 可读 | reviewer 结构化测试、valid/wrong Artifact 测试 | **待验证** | 旧 Artifact 无 metadata 不再自动通过，需人工确认 |

---

## 3. 代码变更

### Contracts / Persistence

- `packages/contracts/src/entities.ts`
  - `Task.expectedArtifacts`；`Artifact.metadata`；Plan status 增加 `superseded`；`PostDraft.supersededByPlanId`。
- `packages/contracts/src/api.ts`
  - `CreateTaskInput.expectedArtifacts`；`Artifact.create.metadata`；`run.reconcile`；`project.qualityPolicy.get/set`；PlanExecution evidence retry 字段。
- `packages/persistence/src/migrations.ts`
  - **V16** `tasks.expected_artifacts_json`
  - **V17** `artifacts.metadata_json`
  - **V18** `agent_inbox.priority/next_attempt_at`
- `store.ts` / `rows.ts` / `read-models.ts`
  - Task expectedArtifacts；Artifact metadata；Inbox priority/next_attempt；`countActiveRunsForAgent`；`getQualityPolicy`；`listDeliverableInbox`/`listStaleInbox`；`updateHandoffPayload`。

### Application

- 新增 `completion-evidence.ts`：`evaluateCompletion()` 统一 design/code/test/review/artifact/human 证据。
- `task-service.ts`：
  - `move(done)` 先评估证据；Agent/System 缺证据抛 CONFLICT。
  - `complete()` 供 Scheduler 使用已评估 decision。
  - `prepareDoneState()` 合法地经过 review 再 done（running/ready/blocked 路径）。
  - 验收 Artifact `metadata.acceptanceMode = human/automatic`。
- `project-service.ts`：Artifact metadata + `createdBy`。

### Runtime

- `quality-gate.ts`：`QualityPolicy` required/optional；`not_applicable`；`missingRequired`；`passed` 仅当 outcome=passed。
- `orchestrator.ts`：
  - review 证据不足时有限自动补证；补证 Run/计数/SQLite 记录；超限 pause。
  - `applyAcceptedHandoffs` prepared/continuedAt 幂等；目标启动失败 continuationError。
  - `selectStartableTasks` + `countActiveRunsForAgent` 全局 per-Agent 容量。
  - review cards 重新读取、最新 execution 合并，避免旧快照覆盖。
- `agent-runner.ts`：
  - `update_task_status(done)` 接入带 workspace/fileExists 的 `evaluateCompletion`。
  - `reconcileRun` + 人工核对 Artifact/RunStep。
  - `retryPendingInbox` 重试/退避/超时/优先级查询。
  - `resumeInbox` 任务忙时降级 task-less。
- `dispatcher.ts`：`run.reconcile` 后自动 resume paused plan；Inbox 定时器；quality policy API。
- `orchestration.ts`：`revisePlan` supersede 旧 plan + cancel 未完成旧任务；approve 复制 expectedArtifacts。

### UI

- `RunsPage.tsx`：needs_reconciliation 核对 Modal（completed/retry/failed + note），集成在现有运行审计页。
- `CollaborationPage.tsx` / `AgentWorkbenchPage.tsx`：Phase 2A 的结构化 Handoff/团队进度保留。

### Tests

- `tests/agent-completion-tool.test.ts`（新增，8 tests）：AgentRunner → ToolHandler → TaskService → CompletionEvidence → SQLite。
- `tests/teamwork-relay.test.ts`（12 tests）：DAG 接力、Handoff、发现、审批拒绝、无脚本、reviewer、Inbox、prepared/continuedAt、启动失败、revision。
- `tests/orchestration.test.ts`（8 tests）：QualityGate outcome/policy/无脚本。
- `tests/agent-runner-guards.test.ts`（17?）：awaitRunTerminal、reconcile、lease。

---

## 4. 数据库与兼容性

- 新增迁移 V16/V17/V18，均为加列/默认值，不删除历史数据。
- V16：旧 Task expected_artifacts_json 默认 `[]`；旧计划审批后新 Task 才有值。
- V17：旧 Artifact metadata_json 默认 `{}`；**旧 design/review Artifact 没有结构化 metadata，不再自动满足新验收**；仍可读取/展示，需要人工确认或重新生成。
- V18：旧 Inbox priority=3/next_attempt_at=0；兼容现有重试。
- 计划 JSON 新增 evidenceRetries/maxEvidenceRetries/supersededByPlanId 可选；旧 plan 读取时回退默认。
- 未对用户真实数据库执行重置/迁移试验；测试均使用临时 SQLite。

---

## 5. 执行真实性

- Agent 没有实际产物时，`update_task_status(done)` 被 `CONFLICT` 拒绝，ToolCall failed，任务保持 review：
  - `[done-gate] no-evidence task=review tool=failed`
- 必要写操作被审批拒绝时，文件不存在、任务不 done、计划 paused：
  - `[done-gate] denied-write task=review write=denied done=failed`
- Artifact 类型不符合 expectedArtifacts 时拒绝：
  - `[done-gate] wrong-artifact task=review tool=failed`
- 有合法结构化审查 Artifact 时可完成：
  - `[done-gate] valid-artifact task=done tool=completed`
- 人工验收与自动验收：
  - `[done-gate] human task=done acceptance=art_...`
  - 验收 Artifact `acceptanceMode=human` vs `automatic`。
- 无测试脚本：
  - `[no-script] plan=paused task=review gate=... verified=false`
- Reviewer 口头完成：
  - `[reviewer-claim] plan=paused task=review`
- Reviewer 真实结构化 Artifact：
  - `[reviewer] plan=completed task=done artifacts=2`

---

## 6. 调度可靠性

- Handoff prepared/continuedAt 窗口：
  - `[prepared] runs=1 targetRun=... plan=completed`
  - `[continued-window] runs=1 targetRun=...`
- 接收方启动失败：
  - `[target-start-failure] plan=failed task=blocked runs=0`
- Inbox 重试：
  - `[inbox-retry] status=completed runs=1`
- Revision：
  - `[revision] old=... status=superseded by=... oldTasks=cancelled,cancelled`
- 全局 per-Agent 容量：使用 SQLite `countActiveRunsForAgent`；**未做两计划并发 E2E**（待验证）。
- Inbox priority/backoff：V18 + `next_attempt_at`；**未单独断言退避时间/优先级顺序**（待验证）。

---

## 7. 崩溃与恢复

- 已实现：
  - `recoverInterruptedRuns` → needs_reconciliation/blocked（Phase 2A.1 既有）。
  - `scheduler.recover` 重 arm running plan。
  - Handoff prepared/continuedAt 持久化 + 单测/模拟重启。
  - Reconcile API/UI：completed/retry/failed；保留原始 RunStep/ToolCall；dispatcher 在 paused plan 上自动 resume。
- **未完成**：
  - 真实 kill Runtime/Electron 再重启的进程级 E2E（P0-02）。
  - reconcile 后 Plan resume 的集成 E2E。
  - 接收方启动失败后的安全重新分配（P0-07）。
- 原则：副作用不明确的 Run 不自动重试；必须人工核对。

---

## 8. 外部 Runtime

- 本机检测到 OpenCode/DeepSeek Harness 等 Runtime Profile，但**没有使用真实凭据进行推理/文件修改 E2E**。
- 没有真实 Claude Code / Codex / OpenCode 多 Agent 接力证据；不将 Mock 结果描述为真实 Harness。
- 外部 Runtime 的 changedFiles 仍未做“Run 前基线 vs Run 后 diff”的精确归属；可能包含上游任务改动。P0-01 仍阻塞。

---

## 9. UI/UX

- 修改了 RunsPage 的 needs_reconciliation 核对 Modal（现有运行审计页内），未新增页面。
- **未做 Electron 实机截图/交互/DPI/主题对比**；P1-09 仍未关闭。
- 现有 V1.6 Liquid Glass/浅色主题未重设计；仅使用现有组件。

---

## 10. 打包与发布

- `pnpm test:package` **PASS**（package smoke：创建项目、写 starter、重启恢复）。
- 但检查 `release/win-unpacked/resources/runtime/index.mjs`：
  - `run.reconcile`：**不存在**
  - `expected_artifacts_json`：**不存在**
  - `handoff_mode`：**不存在**
  - 产物时间 2026-10-20，明显早于本轮源码。
- 因此 **P1-10 未关闭**：package smoke 通过 ≠ 源码与 EXE 一致；未重新打包，未做迁移/功能对比。

---

## 11. 剩余风险

1. P0-01 真实外部 Runtime / 变更归属未验证。
2. P0-02 无真实进程 kill/restart E2E。
3. P0-07 无安全重新分配；Phase 2B 必须。
4. P0-08D 无 Plan/原生 Run wall-clock、工具次数/Token 硬预算。
5. P0-03/P0-05/P0-06/P0-08B/C/P0-12 仍需完整回归/兼容确认。
6. P1-09 UI 无实机截图。
7. P1-10 打包产物落后；不可发布。
8. 旧 design/review Artifact 无 metadata，自动验收会阻止，需人工确认或重建。
9. 人工验收仍可覆盖自动条件；高风险任务的额外证据/权限是 Phase 2B 决策。
10. 未做真实多计划并发、并发取消、长期饥饿测试。

---

## 12. 下一阶段建议 / Phase 2B 前置门

**不建议立即实施 Provider-backed Planner。** 先关闭或明确接受以下阻断项：

- P0-01 真实 Runtime 隔离 E2E（至少一个已授权 Harness）。
- P0-02 真实进程 kill/restart。
- P0-07 安全重新分配（Phase 2B 同期）。
- P0-08D Plan/Run 预算与超时。
- P1-09 UI 实机截图。
- P1-10 重新打包 + `test:package` + 产物/源码一致性。

Phase 2B Planner 接入点：

1. `OrchestrationService.generatePlan()` → `PlannerPort`（provider-backed），保留 `local-rules` 回退。
2. Planner 必须输出 `PlannedTask.expectedArtifacts`，并采用 **结构化 Artifact 类型**（design/review metadata schema），不能只输出自然语言标题。
3. 生成后仍走 `validatePlanDraft` + `resolveAgentAssignment` + `validatePlanAgents`；不创建半成品 DAG。
4. 计划级授权和 `PlannedTask.requiresApproval` 必须与 Approval/Policy 真正联动；不得继承扩大授权。
5. Revision 的 supersede 已具备基础；Phase 2B 要补“有效成果复用”和“旧新计划不并发”完整闭环。
6. 安全重新分配接入 `AgentAssignmentResolver`，只允许项目可见、能力/Runtime 可用、授权范围内的替代。
7. `CompletionDecision` 作为 Planner 重规划输入；不得用 Planner 文本替代真实 Artifact/文件/测试证据。

**结论：本轮完成了证据链、Agent done 测试、结构化 Artifact、质量策略、部分 Handoff/Inbox/Revision/Reconcile 可靠性；但 12 项并未全部关闭。真实 Runtime、真实进程恢复、安全重分配、预算超时、UI 与打包仍是正式发布/Phase 2B 前置阻断，已如实记录。**
