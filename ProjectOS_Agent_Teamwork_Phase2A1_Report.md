# ProjectOS Agent Teamwork — Phase 2A.1 整改报告

> 基线：Phase 2A 提交 `f2a20a5`、`511489a`、`93db316`；Phase 1 提交 `4964770`。
> Phase 2A.1 提交：`12b14bf`（`fix(teamwork): enforce completion evidence and resilient handoff recovery`）。
> 范围：修复错误完成任务、补齐完成依据/质量门禁状态模型、补强 Handoff 幂等与恢复、增加 needs_reconciliation 人工核对、Inbox 持久重试。未新增 Teamwork 页面，未重做 Planner，未进入 Phase 2B。
> 测试：真实 SQLite/AgentRunner/Scheduler/Context/Collaboration + 本地假 LlmProvider；Electron E2E 使用隔离临时目录；未使用生产凭据。

---

## 1. 发现的风险与根本原因

| 风险 | 根因（修复前） |
|---|---|
| 工具被拒绝后 Run 仍继续，任务仍可 done | `TaskService.move(to='done')` 只检查验收标准和依赖，然后无条件写一条“验收记录”Artifact 并 `done`；Run 的 `ToolCall.denied/failed` 没有进入完成判断。 |
| 无测试脚本时 QualityGate skipped 被当 passed | `QualityGateService.run` 用 `executed.every(...)`；`executed.length === 0` 时数组 every 返回 true，`passed=true`、`skipped=true`。 |
| reviewer/architect/custom 缺少明确验收 | 调度器只对 developer/tester 跑质量门禁；其他角色只要 run 完成并进入 review，就直接 `done`。 |
| Agent 声称完成但无实际产物 | 完成判断只依赖文本/任务状态；没有把 Artifact、成功工具调用、实际文件、测试报告与 `PlannedTask.expectedArtifacts` 关联。 |
| Handoff 重复执行/崩溃窗口 | `schedulerPreparedAt/continuedAt` 已存在，但缺少“目标 Run 已创建、continuedAt 未写入”“接收方启动失败”“prepared 后重启”的回归测试；完成/失败路径没有覆盖。 |
| needs_reconciliation 无法核对恢复 | 只有 Run 标记和暂停，没有 `run.reconcile` API/UI；用户只能取消运行再求助计划 resume。 |
| Inbox 投递失败后丢失 | `wakeInbox` 失败只记 warning；`delivered` 没有持久重试/超时；状态没有上限。 |
| 完成依据无法审计 | 没有独立的完成证据模型；`run_steps` 未记录完成判断/工具拒绝/质量门禁 skipped 的组合。 |

---

## 2. 修改文件及关键函数

### 2.1 Contracts / Persistence

| 文件 | 关键改动 |
|---|---|
| `packages/contracts/src/entities.ts` | `TaskSchema` 增加 `expectedArtifacts?: string[]`；保留 Handoff 结构化投影。 |
| `packages/contracts/src/api.ts` | `CreateTaskInput/UpdateTaskInput` 支持 `expectedArtifacts`；新增 `run.reconcile`（completed/retry/failed）。 |
| `packages/contracts/src/desktop-api.ts` | 暴露 `runs.reconcile`。 |
| `packages/persistence/src/migrations.ts` | **V16**：`ALTER TABLE tasks ADD COLUMN expected_artifacts_json TEXT NOT NULL DEFAULT '[]'`。 |
| `packages/persistence/src/rows.ts` | `TaskRow/toTask` 读写 `expected_artifacts_json`，旧行为空数组。 |
| `packages/persistence/src/store.ts` | `createTask/updateTask` 持久化 expectedArtifacts；`updateHandoffPayload`/`setAppSetting`（Phase 2A）保持。 |
| `packages/persistence/src/read-models.ts` | `listDeliverableInbox`/`listStaleInbox`；Agent/Handoff 结构化读取（Phase 2A）。 |

### 2.2 Application / Domain

| 文件 | 关键改动 |
|---|---|
| `packages/application/src/completion-evidence.ts` | **新增** `evaluateCompletion()`：把任务角色、`expectedArtifacts`、Artifact、Run/ToolCall、QualityGate、文件存在性和人工验收统一映射为 `CompletionDecision`（requirements/toolOutcomes/reasons）。 |
| `packages/application/src/task-service.ts` | `move(to='done')` 先评估完成依据；Agent/System 缺少证据抛 `CONFLICT`；新增 `complete()` 供 Scheduler 使用已评估 decision；验收 Artifact 记录实际完成依据；Human 验收保留可追溯人工记录。 |
| `packages/application/src/ports.ts` | `updateTask` 支持 expectedArtifacts。 |
| `packages/domain/src/events.ts` | 新增 `run.reconciled` 事件与摘要。 |

### 2.3 Runtime

| 文件 | 关键改动 |
|---|---|
| `apps/runtime/src/quality-gate.ts` | `QualityGateReport` 增加 `outcome: passed/failed/error/skipped`；`passed` 仅在 `outcome === 'passed'` 时为真；无脚本 = skipped，绝不再当 passed。 |
| `apps/runtime/src/orchestrator.ts` | review 循环：gate failed/error → block + plan failed；gate skipped → 不直接 done，继续评估 Agent 实际测试证据；任何角色完成后必须通过 `evaluateCompletion`；证据不足时任务留在 review、计划 `paused` 并记录缺失原因；通过后调用 `tasks.complete(decision)`。 |
| `apps/runtime/src/agent-runner.ts` | `update_task_status(done)` 也运行带 workspace/fileExists 的完成评估，失败则 ToolCall failed；新增 `reconcileRun(completed/retry/failed)`、`moveTaskAfterReconcile`、`retryPendingInbox`；Run 审计写“人工核对”。 |
| `apps/runtime/src/dispatcher.ts` | `run.reconcile`；30s Inbox 重试计时器；shutdown 清理。 |
| `apps/runtime/src/agent-studio.ts` | （Phase 2A）Agent 项目作用域。 |

### 2.4 UI

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/renderer/src/pages/RunsPage.tsx` | needs_reconciliation 运行详情新增“人工核对” Modal：确认完成 / 允许重试 / 确认失败 + 说明；提示不会自动重复执行。无新页面。 |
| `apps/desktop/src/preload/index.ts` | `runs.reconcile` 桥接。 |

### 2.5 Tests / E2E 调整

- `tests/teamwork-relay.test.ts` 扩展到 **11 个集成测试**：DAG、Handoff、发现/消息、审批拒绝、无脚本、reviewer Artifact、reviewer 口头完成、Inbox 重试、prepared 重启、continuedAt 窗口、接收方启动失败。
- `tests/agent-runner-guards.test.ts` 增加 3 个 reconcile 测试。
- `tests/orchestration.test.ts` 增加“无脚本 = skipped, not passed”。
- `scripts/v18-teamwork-e2e.mjs` / `scripts/v13-orchestration-e2e.mjs`：假 Provider 只返回文本，因此 E2E 在启动前显式创建真实完成 Artifact；否则严格完成门禁会正确阻止 text-only 任务。E2E 验证的是调度/证据/完成链路，不是 Agent 真实工具执行；真实工具链路由 `tests/teamwork-relay.test.ts` 覆盖。

---

## 3. 完成条件和质量门禁状态模型

### 3.1 质量门禁

```text
outcome:
  passed   有至少一个可执行检查，全部 passed
  failed   有检查失败（exit != 0）
  error    检查无法完成（超时、启动失败、abort）
  skipped  没有任何可执行检查脚本
passed = (outcome === 'passed')
```

- `skipped` **不是**通过；测试报告 Artifact `verifiedAt = null`，body 明确写 `skipped`。
- 调度器：
  - `failed/error` → 任务 blocked，计划 failed（真实检查失败）。
  - `skipped` → 不再直接 done；若 Agent 有已验证测试报告/成功的 run_tests，可继续评估；否则任务留在 review，计划 paused，等待补脚本/人工验收。
  - `passed` → 仍要通过完成证据评估。

### 3.2 完成证据

`evaluateCompletion` 把证据映射为 requirement：

| requirement | 接受的真实证据 |
|---|---|
| `design` | 非 demo 的 `design`/`document` Artifact，或标题/正文匹配 ADR/设计/架构/方案/实施 |
| `code` | 非 demo 的 `diff`/`code` Artifact；成功的 `write_file`（workspaceRoot + fileExists 时要求文件存在）；外部 Runtime 完成且有非空 changedFiles |
| `test` | QualityGate `passed`；已验证 `test-report` Artifact；成功的 `run_tests` 且 result exitCode=0 |
| `review` | 标题/正文匹配审查/评审/review 的 Artifact |
| `artifact` | 任意非 demo Artifact（custom 且无 expectedArtifacts 时） |
| `human` | 人工验收（actor=user）；验收 Artifact 记录“人工验收确认” |

- `expectedArtifacts` 从 `PlannedTask` 复制到 Task（V16），按内容映射到 design/code/test/review；不再只存在于 plan JSON。
- 工具状态统一为 `completed/failed/denied/skipped/not_applicable`；denied/failed 会进入 decision.reasons。
- **不是所有 denied 都导致计划失败**：完成判断按“必要证据”进行。例如 write_file 被拒绝，但 Agent 通过另一个文件成功写入或生成了 code/diff Artifact，code requirement 仍可满足；只有必要证据缺失才阻止 done。
- Agent/System 完成必须通过 evidence；Human 完成保留人工验收依据和 Artifact。
- Scheduler 使用 `TaskService.complete(decision)`，避免二次评估丢失 QualityGate/workspace 上下文；Agent 工具 `update_task_status(done)` 使用同一 evaluator（带 workspace/fileExists），不能仅凭文本完成。

---

## 4. 审批拒绝后的真实行为

测试 `does not write a file when a dangerous tool approval is rejected`：

```text
[rejected] run=run_... toolCall=tol_... status=denied
task=review plan=paused fileWritten=false
```

具体：

1. `write_file` 进入 Approval，用户拒绝。
2. ToolCall 状态 `denied`，Run 继续（Agent 可以提出替代方案/总结）。
3. Run completed 后任务进入 `review`；QualityGate 的 test 脚本通过，但完成评估的 `code` requirement 不满足（没有成功 write_file、没有 code/diff Artifact）。
4. Scheduler **不 done**：任务保持 `review`，计划 `paused`，error 记录“缺少有效完成依据/代码证据”。
5. Worktree 中目标文件不存在；Run/ToolCall/拒绝记录保留。

这满足“必要操作被拒绝时，不允许仅凭 Agent 文本将任务标记 done”，同时没有把所有 denied 无条件升级为整个计划失败。

---

## 5. 自动交接幂等与恢复测试

| 场景 | 测试 | 结果 |
|---|---|---|
| 重复 Handoff 请求 | `tests/collaboration-handoff.test.ts` 同 task+target 请求两次 | 返回同一 ID，DB 只有 1 条 |
| 重复 Scheduler tick | `starts a prepared handoff exactly once...` + `scheduler.recover()` | 只有 1 条 target Run，计划完成 |
| 接受后源 Run 尚未结束 | 自动 Handoff 集成测试 | target Run `startedAt >= source finishedAt`；无 Lease 冲突 |
| prepared 后尚未启动 | `schedulerPreparedAt` 持久化 + 新 scheduler start/recover | `runs=1`，无重复 |
| target Run 已创建、continuedAt 未写入 | 手工创建目标 Run + prepared handoff + scheduler start | 仍只有原 Run，未再启动 |
| 接收方 Runtime 启动失败 | 目标 Runtime 在 accept 后变为 unavailable | plan failed、task blocked、**runs=0**、handoff `continuationError`，无假成功 |
| 已完成 DAG 旧任务再次执行 | Test A 完成后 `scheduler.recover()` | Run 数不变，计划仍 completed |
| Inbox 重复/重试 | `retries a delivered inbox exactly once` | 1 条 target Run，inbox completed；第二次 retry 不新增 |
| needs_reconciliation | `tests/agent-runner-guards.test.ts` 3 个 reconcile 测试 | completed → Run completed + task review + 核对 Artifact；retry → Run failed + task ready + 无第二 Run；非 needs_reconciliation 抛错 |

**状态写入顺序/幂等边界**：

- `requestHandoff` 在事务内再次检查同 task/target 的 requested/accepted 记录。
- `acceptHandoff` 只写 Handoff status/toSession/task assignee/system message，不启动 Run。
- Scheduler `applyAcceptedHandoffs`：
  1. 有 active Run 或有效 Lease → 等待，不抢占；
  2. 无 active Run → 改负责人、review/blocked→ready、写 `schedulerPreparedAt`；
  3. 正常 ready/start 循环是唯一启动点；
  4. 启动成功写 `continuedAt + targetRunId`；启动失败写 `continuationError` 并 block。
- 目标 Run 已存在时，`getActiveRunForTask`/task status 阻止第二个 Run；`continuedAt` 缺失不会触发第二次启动。
- 所有 Run/Task/Handoff 状态都写 SQLite；重启后 `scheduler.recover()` 重新 arm running plan，prepared 状态保留。

---

## 6. 所有测试命令及结果

```text
pnpm lint        → PASS（0 warnings）
pnpm typecheck   → PASS
pnpm test        → 32 files / 167 tests PASS
pnpm build       → PASS（runtime + desktop）
pnpm test:teamwork → PASS（7 checks, 9 provider requests）
```

`pnpm test` 中的关键实测输出：

```text
[relay] design=art_... developerRun=run_... injected=2 testReports=2
        files=src/rbac.ts+test-evidence.txt
        order=...->...->... worktree=...

[handoff] status=accepted sourceRun=run_... targetRun=run_...
          continuedAt=... task=done assignee=agt_qa

[discovery] inbox=inb_... status=completed targetSession=ses_... targetRun=run_...

[rejected] run=run_... toolCall=tol_... status=denied
           task=review plan=paused fileWritten=false

[no-script] plan=paused task=review gate=art_... verified=false

[reviewer] plan=completed task=done artifacts=2

[reviewer-claim] plan=paused task=review

[inbox-retry] inbox=inb_... status=completed runs=1

[prepared] handoff=hnd_... runs=1 targetRun=run_... plan=completed

[continued-window] handoff=hnd_... runs=1 targetRun=run_...

[target-start-failure] plan=failed task=blocked runs=0
                       error=Agent 绑定的 Runtime「Flaky Target Runtime」当前不可用（unavailable）
```

质量门禁单元测试：

```text
✓ reports skipped, not passed, when no executable scripts are configured
  outcome=skipped passed=false skipped=true
```

Reconcile 单测：3 个新增测试全部通过（共 14 个 agent-runner-guards 测试）。

---

## 7. Phase 1/2A 回归结果

```text
pnpm test:teamwork
→ PASS（7 checks, 9 provider requests）
  group chat 4/4
  same-Agent serialize completed
  different-Agent overlap + dependency wait
  Runtime unavailable blocks approval, 0 done

node .tmp/v13-orchestration-e2e-isolated.mjs
→ V1.3 ORCHESTRATION E2E PASS
  4-task plan, 5 runs, retry 1, quality reports 2, worktree merged

node .tmp/v14-e2e-isolated.mjs
→ V1.4 E2E PASS
  findings=1, proposals=2, mode=propose, survives restart
```

说明：v18/v13 的假 HTTP Provider 只返回文本，严格完成后无法凭空满足 Artifact 要求；E2E 已在启动前显式创建真实 completion Artifact。**因此这两个 E2E 验证的是 Scheduler/证据/完成门禁，而不是“模型真实产生代码”**。真实工具调用/文件写入/测试执行由 `tests/teamwork-relay.test.ts` 的假 LlmProvider（真实 AgentRunner/Scheduler/SQLite）覆盖。

---

## 8. 仍未解决的问题

1. **真实外部 Runtime 未验证**：本轮没有使用 DSH/OpenCode/Claude Code/Codex 真实 CLI 或真实付费模型；外部 Runtime 的 changedFiles 证据可能包含上游任务改动，仍需要 run 前后 diff 快照来精确归属。
2. **完整进程级重启 E2E 未做**：handoff prepared/continuedAt 窗口、Run 恢复、Inbox 重试都在测试中模拟/单测覆盖；没有真正 kill Runtime 进程再重启的 Electron E2E。
3. **QualityGate 部分脚本语义**：有 test 但没有 lint/typecheck 时，gate 仍为 passed（只执行已配置脚本）。是否要求全套检查取决于项目验收策略，本阶段未强制。
4. **人工验收**：Human `TaskService.move(done)` 仍允许人工确认完成而不要求 Artifact；这是显式人工决定，但与 Agent 严格完成不同。若要求所有完成都带证据，需要产品决策。
5. **Agent 工具完成后仍可能留下 review 任务**：Agent 可在 `update_task_status(done)` 被证据阻止后进入 review，计划 paused；需要用户补 Artifact/脚本后 resume。没有自动重试完成评估。
6. **reconcile 后计划不会自动继续**：只修改 Run/Task 状态并写核对记录；用户需要在编排工作台 resume。符合“人工核对”安全边界，但不是全自动恢复。
7. **Handoff 接收方启动失败**：会 plan failed + task blocked + continuationError；没有自动重新分配。重分配属于 Phase 2B/2C。
8. **Plan revision supersede、全局 per-Agent 并发、Inbox 队列优先级、run 级预算**仍未完成。
9. **UI 未做视觉回归**：RunsPage 核对 Modal、CollaborationPage 结构化卡片只做类型检查/构建。
10. **打包产物**：未重新打包 `test:package`；当前运行包可能仍是旧构建。
11. **Agent 工具 `update_task_status(done)` 的严格路径没有单独 E2E**：代码已接入 evaluator；本阶段有 Scheduler/Reviewer 证据测试，但没有专门构造“Agent 工具自称 done 被拒”的集成测试。
12. **reviewer/design 证据使用标题/正文关键词匹配**：是启发式，不是结构化 Artifact kind 强约束；Phase 2B 可引入 expectedArtifact schema。

---

## 9. Phase 2B 智能 Planner 的具体接入点

1. **Planner 入口**：`apps/runtime/src/orchestration.ts` 的 `generatePlan()` 当前调用 `generateLocalPlan`。Phase 2B 增加 `PlannerPort`（provider-backed），返回 `PlanDraft`，保留 `generatedBy: 'local-rules'` 回退；禁止把本地模板伪装成模型生成。
2. **PlannedTask 契约**：继续使用 `key/title/description/role/agentId/dependsOn/acceptanceCriteria/expectedArtifacts`。Planner 必须输出可验证的 `expectedArtifacts`（design/code/test/review 等），它们会经 V16 持久化到 Task，并直接被 `evaluateCompletion` 使用。
3. **AgentAssignmentResolver**：Planner 产出角色/节点后，复用 Phase 1 的 `resolveAgentAssignment` 做能力/Skill/Runtime/可见性/负载匹配；显式 agentId 优先。
4. **计划校验**：Planner 输出必须经过 `validatePlanDraft`（环检测/依赖存在/键唯一）+ `validatePlanAgents` + expectedArtifacts 完整性检查；不通过则回退 local-rules，不创建半成品 DAG。
5. **计划审批/修订**：沿用现有单事务 `approvePlan`；Phase 2B 增加计划级权限策略（批准写操作范围）和 revision supersede。
6. **完成反馈闭环**：Scheduler 的 `CompletionDecision`（requirements/reasons/toolOutcomes）可以作为 Planner 重新规划的输入；失败/证据缺失时生成“补充 Artifact/调整任务”的新 revision，而不是无限重试。
7. **任务粒度/并行**：Planner 需要输出可并行 DAG 和明确的 expectedArtifacts；调度器已支持不同 Agent 并行、同 Agent 串行、Handoff 继续。
8. **不改变本阶段的完成门禁**：Planner 产物仍必须通过真实 Artifact/文件/测试证据，不能以“Planner 说完成”替代证据。

---

## 10. 变更摘要

- 完成任务从“状态迁移”升级为“证据门禁”：Task done 需要真实 Artifact/文件/测试/审查或显式人工验收。
- `expectedArtifacts` 从 PlanDraft 进入 Task（V16），与 Artifact/QualityGate/文件检查关联。
- QualityGate 明确四态；skipped 不再等于 passed。
- 必要操作 denied/failed 不再被文本完成覆盖；替代方案只要重新满足验收证据即可。
- Handoff 的 prepared/continuedAt、Lease 等待、目标 Run 窗口、接收方启动失败、prepared 后重启均有回归测试。
- needs_reconciliation 有可审计人工核对 API/UI；Inbox 有持久重试/超时/幂等。
- Phase 1/2A 群聊、并行、自动选人、DAG 接力、Handoff 回归通过；没有新增重复业务页面或第二套架构。
