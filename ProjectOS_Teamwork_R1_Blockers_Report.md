# ProjectOS Agent Teamwork — R1 关键阻断整改报告

> 指令：`ProjectOS_Teamwork_第二轮_关键阻断整改指令.md`（R1）
> 基线：`b3544c2`（Legacy Fixes 报告与 Open Issues）；本轮未提交，工作区改动即为交付物。
> 回滚点：`git tag r1-wip-before-continue`（`a9be3ab`，续作前的未提交 WIP）。
> 范围：只处理 R1-A/B/C/D。**未实施 Phase 2B Planner，未新增 Teamwork 页面，未重置用户数据库，未使用生产凭据。**
> 环境：Windows 11 / Node 24 / Electron 43 / SQLite WAL；所有测试使用临时项目、临时 SQLite、临时用户目录。

---

## 0. 结论

| ID | 状态 | 一句话证据 |
|---|---|---|
| R1-A / P0-08B 全局 Agent 并发 | **已验证关闭** | 双 Scheduler：峰值 1；双真实进程（PID 23668/16924）：`peakRuns=1 peakSlots=1 overlaps=0 runs=2 plans=completed openSlots=0` |
| R1-B / P0-02 真实进程 Kill/Restart | **已验证关闭**（真实 kill 覆盖运行中+审批等待；Handoff/Inbox 窗口为注入状态，见 §3.3） | 真实 Runtime 子进程 PID 14544 被 `taskkill /T /F` 杀死，重启 PID 16776；25 项 SQLite/文件断言通过 |
| R1-C / P0-08D Run/Plan 硬预算 | **已验证关闭** | 墙钟 → `timed_out`；步骤/工具 → `budget_exhausted`；计划超时 → plan `failed/budgetExhausted=plan_wall_clock`；重启保留剩余预算且被批准的工具未执行 |
| R1-D / P0-07 Handoff 安全替代 | **已验证关闭** | 低风险自动替代 2 个 Run 且交接保留；无候选 blocked；显式指定 paused→确认→完成；权限扩大需确认；跨项目不可见被拒；重复 tick 不新增 Run |

本轮未关闭：P0-01（真实外部 Harness/文件归属）、P1-09（Electron 实机视觉回归）、P1-10（重新打包与产物/源码一致性）。
另有 P0-03/04/05/06/08A/08C/12 的既有“待验证/处理中”状态保持不变（本轮回归通过，但未新增其专项 E2E）。

---

## 1. R1-A / P0-08B：跨计划、跨进程的全局 Agent 并发

### 1.1 根因与代码位置

- 根因：旧实现只用 `countActiveRunsForAgent()` 在 Scheduler 里“先查后启动”，检查与占用不在同一事务；
  同一 Agent 被两个计划/两个进程同时检查时都能看到 0，随后各自创建 Run。
- 修复：
  - `packages/persistence/src/migrations.ts`：**V19** 新增 `agent_execution_slots(agent_id PK, run_id, fencing_token, acquired_at, expires_at)` + 过期索引。
  - `packages/persistence/src/store.ts`：
    - `acquireAgentExecutionSlot()`：在 `BEGIN IMMEDIATE` 写事务内完成“查占用 → 冲突抛 `CONFLICT/执行容量已满` → upsert”；
    - `renewAgentExecutionSlot()`：`fencing_token` 不匹配即失败（旧执行者失去容量）；
    - `releaseAgentExecutionSlot/ForRun()`；`getAgentExecutionSlot()` 只返回未过期槽；
    - `releaseDeadAgentExecutionSlots()`：清理所属 Run 已不存在/已终态的僵尸槽。
  - `apps/runtime/src/agent-runner.ts`：`startRun` 在任何 Task lease / Run / Attempt / Session 写入之前获取槽；
    失败或 Run 创建失败时释放；Task lease 与槽共用一个 120s 续约定时器；`cleanup/cancel/reconcile/recover` 均释放。
  - `apps/runtime/src/orchestrator.ts`：容量冲突被识别为“排队”，任务保持 `ready`、计划保持 `running`，绝不把整计划判失败；
    显式顺序：`priority DESC, createdAt ASC`，同 Agent 每 tick 最多一个。
  - 饿死/取消/进程死亡：槽 TTL 30 分钟 + 心跳续约；取消与终态立即释放；启动恢复清理死槽。
- 事务边界：**槽占用（单事务）→ Task lease（单事务）→ Run/Attempt/Task 状态（单事务）**。
  任一前置失败都不留下半个 Run。

### 1.2 双 Scheduler（同进程、单 SQLite）真实测试

命令：`pnpm vitest run tests/r1-concurrency.test.ts`

- 两个项目、两个计划、同一个 `agt_engineer`，两个独立 `OrchestrationScheduler` 实例同时启动。
- 采样（20ms）峰值：`peakActiveRuns=1 peakSlots=1`；两计划最终 `completed`；每个任务恰好 1 个 Run。
- 容量被占时：第二计划任务保持 `ready`、计划 `running`、`latestRun=null`（3.2s 多 tick 观察）；
  释放后无需重启计划即自动开始并完成。
- 槽语义单测：冲突抛 `执行容量已满`；同 Run 重取只提升 token；死 Run 槽被清理；
  旧 token 续约失败；全局槽数始终 ≤1。

### 1.3 跨进程真实测试

命令：`node scripts/r1a-cross-process.mjs`（两个 `node --import tsx` 子进程，各自独立 `SqliteStore` + Scheduler，
文件屏障同时放行；父进程每 20ms 用 `node:sqlite` 直接采样数据库）

实测输出（`test-results/r1/r1a-cross-process.log`）：

```
workerExitCodes: [0, 0]
peak: { runs: 1, slots: 1, samples: 236 }
runRows:
  alpha run ... started_at=1792590498835 finished_at=1792590500683 completed
  beta  run ... started_at=1792590501307 finished_at=1792590503168 completed
overlaps: []
openSlots: 0
[r1a-xproc] PASS peakRuns=1 peakSlots=1 runs=2 overlaps=0 openSlots=0 samples=236 workers=23668,16924
```

数据库证据：两个 Run 的时间区间不重叠；结束时无残留槽；两计划均 `completed`。
**不是**“串行调用 tick()”的单测。

---

## 2. R1-B / P0-02：真实进程 Kill/Restart 恢复

### 2.1 根因与代码位置

- 根因：此前只有“重建对象/模拟恢复”，没有真正杀死持有 SQLite 写锁与子进程的 Runtime。
- 既有能力（沿用）：`AgentRunner.recoverInterruptedRuns()`、`OrchestrationScheduler.recover()`、
  `needs_reconciliation`、Approval 失效、lease 释放、Handoff prepared/continuedAt 幂等。
- 本轮补齐：
  - 恢复时 `releaseDeadAgentExecutionSlots()`，避免崩溃后 Agent 被容量槽卡 30 分钟；
  - 统一 `isTerminalRunStatus()`，新终态不会被误判为“未完成”；
  - Inbox 仍按 24h/3 次/退避处理，重启不丢待投递消息。

### 2.2 真实 kill/restart 步骤与实测

命令：`pnpm build:runtime && node scripts/r1b-kill-restart-e2e.mjs`
（构建真实 `apps/runtime/dist/index.mjs`，以 NDJSON stdio 驱动；不涉及用户数据/凭据）

1. 临时 data dir + 全新 SQLite；启动 Runtime，读取 `hello`（PID 14544）。
2. 创建项目、CLI Runtime Profile（`node -e` 写文件后 `setTimeout` 600s）、两个绑定该 Profile 的 Agent。
3. Run A：`run.start` → 真实 `Approval` → 批准 → 子进程 PID 19908 写入 `side-effect.json` → Run `running`。
4. Run B：`run.start` → 停在 `waiting_approval`（不批准，无子进程）。
5. 注入两个持久化窗口：已接受的 Handoff（payload 只有 `schedulerPreparedAt`、无 `continuedAt`）、
   一条 `wake:false` 的待投递 Inbox。
6. `taskkill /pid 14544 /T /F` 杀死 Runtime（`exit={code:1, signal:null}`）。
7. 直接读 SQLite（`node:sqlite`）：Run A 仍 `running`、Task A 仍 `running`、lease/槽仍被死进程持有、
   副作用文件已存在且只有一次写入。
8. 重启 Runtime（PID 16776），启动恢复在 `hello` 之前执行。
9. 再次直接读 SQLite + 通过 `run.get` 交叉验证；等待 3s 再读一次确认幂等。

恢复前后实测（`test-results/r1/r1b-kill-restart.log`）：

| 对象 | kill 后、重启前 | 重启恢复后 |
|---|---|---|
| Run A（运行中） | `running` | `needs_reconciliation`，错误含“外部副作用状态未知…人工核对” |
| Run B（审批等待） | `waiting_approval` | `needs_reconciliation`，审批被 `cancelled` |
| Task A / B | `running` / 原状态 | `blocked` / `blocked` |
| Task lease | 仍有效，holder=`run:A` | `expires_at=0`（已释放，保留 fencing 记录） |
| Agent 容量槽 | 两个槽有效 | 两槽 `expires_at=0` |
| 审批 | A=`approved`，B=`pending` | A 历史保留 `approved`，B=`cancelled` |
| 副作用文件 | `{"pid":19908,"at":1792590507866,"argv":2}` | **文件内容完全不变**，未重复写入 |
| Run 总数 | 2 | 2（未自动重试、未新建 Run） |
| Handoff | `accepted` + `schedulerPreparedAt` | 原样保留，`continuedAt` 仍不存在，`targetRunId` 不存在 |
| Inbox | 1 条 `delivered` | 1 条 `delivered`，attempts 不变 |

断言总数：`checks=25`，全部通过；`[r1b] PASS checks=25 firstPid=14544 restartPid=16776`。
迁移 19/20 在全新数据库上被真实应用（日志可见），说明 V19/V20 不是只存在于源码。

### 2.3 与真实进程测试的区别（必须注明）

- **真实 kill 覆盖**：Run 正在运行且已产生文件副作用；Run 等待 CLI 审批。
- **故障注入/状态持久化覆盖**（不是真实 kill 窗口）：
  - Handoff `accepted→prepared`、未写 `continuedAt`：直接向 `handoffs.payload_json` 注入 `schedulerPreparedAt`；
  - Inbox 待投递：通过真实 `inbox.send(wake:false)` 产生，但未在“投递瞬间”杀进程；
  - “目标 Run 已创建、`continuedAt` 未写”窗口：由 `tests/teamwork-relay.test.ts` 的
    `does not start a second target run when a target Run exists before continuedAt` 覆盖（对象级，不是进程级）。
- 因此 P0-02 的结论是“真实 kill/restart 主路径已验证”，而非“所有微秒级崩溃窗口都用真实进程复现”。

---

## 3. R1-C / P0-08D：Run/Plan 硬限制、超时和取消

### 3.1 根因与代码位置

- 根因：只有步骤上限常量；没有 Run 墙钟、工具次数、计划总时长；步骤超限被当作普通 `failed`；
  重启后无法知道已用预算；审批等待期间时间继续流逝却无终止。
- 契约/迁移：
  - `packages/contracts/src/enums.ts`：`RUN_STATUSES` 增加 `timed_out`、`budget_exhausted`；
    `TERMINAL_RUN_STATUSES`、新增 `RUN_TERMINATION_REASONS`、RunStep 增加 `budget` kind。
  - `packages/domain/src/task.ts`：状态机允许 `running/waiting_*/verifying/suspended/needs_reconciliation → timed_out|budget_exhausted`；
    `isTerminalRunStatus()` 统一判定。
  - `packages/contracts/src/entities.ts`：`Run.deadlineAt`、`Run.budget{maxWallClockMs,maxSteps,maxToolCalls,stepsUsed,toolCallsUsed}`。
  - **V20**：`agent_runs.deadline_at`、`budget_json`。
  - `PlanExecution`：`maxWallClockMs/deadlineAt/budgetExhausted`（计划 JSON，重启天然持久）。
- Runtime：
  - `apps/runtime/src/limits.ts`：环境变量 `PROJECTOS_RUN_TIMEOUT_MS / PLAN_TIMEOUT_MS / MAX_AGENT_STEPS /
    MAX_TOOL_CALLS / AGENT_SLOT_TTL_MS / TASK_LEASE_TTL_MS`，带下限/上限钳制，不能把预算配成 0 关闭。
  - `agent-runner.ts`：`armDeadline()`（绝对时间 + `AbortController`）；`execute()` 每轮前检查墙钟/步骤/工具预算；
    `executeTool()` 在产生任何副作用前检查预算；`decideApproval()` 在执行已批准工具前**二次**检查（覆盖审批等待）；
    `budgetForRun()` 从 Run 持久化字段恢复，旧 Run 用 `started_at + 上限` 与已存 tool_result 数回填；
    `terminateRun()` 统一写 `budget` RunStep、事件、`needs_reconciliation` 之外的终态、释放 lease/槽、取消审批。
  - `orchestrator.ts`：`start()` 写入计划 deadline；`tick()` 到限先终止所有活动 Run 再置计划失败；
    `resume()` 拒绝已过期的计划；超时后不再启动任何新任务。
- Token/费用：只有 Provider 返回 usage 才记录；没有价格时 `estimatedCost=null/0`，**不估算、不冒充已计费**。
- 终态区分：用户取消=`cancelled`；墙钟=`timed_out`；步骤/工具或计划预算=`budget_exhausted`（计划另记 `budgetExhausted` 原因）。

### 3.2 实测（命令：`pnpm vitest run tests/r1-budgets.test.ts`）

| 场景 | 实测结果 |
|---|---|
| 无限挂起的 Run，墙钟 400ms | `status=timed_out`，错误含“墙钟上限”，RunStep `reason=wall_clock_timeout`，槽释放，未编造费用 |
| 模型无限调用工具，步骤上限 2 | `status=budget_exhausted`，实际 ToolCall=2，`reason=step_budget_exhausted`，槽释放 |
| 一次返回 2 个工具调用，工具上限 1 | 只创建/执行 1 个 ToolCall；第二个在创建前被拒；`reason=tool_budget_exhausted` |
| 计划总上限 1.5s，Run 挂起 | 计划 `failed`、`budgetExhausted=plan_wall_clock`、错误含“计划总执行时间”；Run `timed_out`；Task `blocked`；lease `expires_at=0`；槽释放；产生 `plan.status.changed` 事件 |
| 重启后剩余预算 | 关闭并重开同一 SQLite：`deadlineAt` 与 budget 原样保留；把 deadline 改为过去后批准 `write_file`：Run 变 `timed_out`，`generated/restart.txt` **不存在**，ToolCall 被置 denied，槽释放 |

### 3.3 资源释放与审计

- 每个预算终止都写一条 `run_steps.kind='budget'`（含 limits、已用计数、原因、时间）与 `run.status.changed` 事件；
- 释放 Task lease、Agent 槽，取消 pending approvals；ToolCall 不会停留在 `running`；
- 任务进入 `blocked` 并写明原因；Inbox 置 `failed`（若关联）；
- 取消路径仍走 `cancel()`（`cancelled`），与超时/预算明确区分。

---

## 4. R1-D / P0-07：Handoff 接收方启动失败后的安全替代

### 4.1 根因与代码位置

- 根因：接收方启动失败只写 `continuationError` 并 block/fail，没有合法候选、权限判断和确认机制；
  且 Plan 自动分配的 Agent 在批准时会被二次解析成“显式指定”，无法安全替代。
- 代码：
  - `packages/planning/src/assignment.ts`：抽出 `rankAssignmentCandidates()`，与 `resolveAgentAssignment()` 共用同一套
    角色/能力/分类/Skill/Runtime/负载评分。
  - `apps/runtime/src/assignment-candidates.ts`（新）：Scheduler 与 Planner 共用候选快照（可见性、状态、Skills、Runtime、负载）。
  - `packages/contracts/src/orchestration.ts`：`PlannedTask.assignmentMode: auto|explicit`，随计划 JSON 持久化。
  - `apps/runtime/src/orchestration.ts`：`updatePlan` 只在用户真正改变 agentId 时标记 explicit；自动节点保持 auto。
  - `apps/runtime/src/orchestrator.ts`：
    - `evaluateReassignment()`：排除当前接收方→同一 resolver 评分（Top3）→硬规则；
    - `handleReceiverStartFailure()`：低风险且无权限扩大→改派并置 `ready`（**不自己 startRun**）；
      否则写提议、Task `blocked`、计划 `paused` 等待确认；
    - `confirmReassignment()` / dispatcher `orchestration.reassign` / preload/desktop-api：人工确认后才改派；
    - 记录 `handoff.payload.reassignment{status,candidates,rejected,reasons,from,to,decidedAt}` 与事件；
    - 无候选：明确 `status='none'`，不假成功。
  - 硬规则（任一成立必须确认）：用户显式指定、Handoff 风险非 low、候选能力超出原 Agent、
    候选 Runtime 风险更高（native<ACP<CLI）、存在活动 Run/未知副作用 Run、原 Task Lease 未释放。

### 4.2 实测（命令：`pnpm vitest run tests/r1-handoff-reassign.test.ts`）

| 必测项 | 实测 |
|---|---|
| 有合法候选 | 低风险、无权限扩大：`reassignment.status=applied`，Task 改派后由 Scheduler 启动；总 Run=2（源 Run+替代 Run），接收方 0 个 Run，计划 `completed`，Handoff 仍 `accepted` 且 `continuedAt` 有值 |
| 无候选 | 所有 Agent 不可用：`status=none`，Task `blocked`，计划失败且错误明确，接收方从未产生 Run |
| 显式指定 | `status=needs_confirmation`、`explicitAssignment=true`；计划 `paused`；确认前 Run 仍只有 1 个；`orchestration.reassign` 确认后计划恢复并完成（Run 1→2） |
| 跨项目不可见 | 候选 `rejected` 中含“不在当前项目可见范围”，`candidates` 中不含该 Agent，标签仍只选合法候选 |
| 权限扩大 | 接收方 capabilities `[implement,test,analyze]`，替代增加 `review`：`reasons=["替代 Agent 权限更大（新增能力：review）"]`，必须确认 |
| 原 Lease 未释放 | 注入 `run:ghost` 有效 lease 后调用确认：抛“任务仍有运行或租约，不能换人”；释放后可确认 |
| 重复 tick/重启不重复 Run | 完成后 `scheduler.recover()` + 3s：Run 数不变 |

候选评分示例（真实日志）：`Iris score=32`、`Sage score=26`、`Kai score=26`，排序确定、可复现。

---

## 5. 本轮修改文件

### Contracts / Domain / Persistence

- `packages/contracts/src/enums.ts`：新终态、终止原因、`budget` RunStep。
- `packages/contracts/src/entities.ts`：`Run.deadlineAt`、`Run.budget`。
- `packages/contracts/src/orchestration.ts`：`PlanExecution.maxWallClockMs/deadlineAt/budgetExhausted`；`PlannedTask.assignmentMode`。
- `packages/contracts/src/api.ts` / `desktop-api.ts`：`orchestration.reassign`。
- `packages/domain/src/task.ts`：状态机 + `isTerminalRunStatus`。
- `packages/domain/src/events.ts`：`plan.status.changed`、`handoff.reassignment.proposed`。
- `packages/persistence/src/migrations.ts`：V19 槽表、V20 deadline/budget 列。
- `packages/persistence/src/store.ts`：槽事务/续约/释放/死槽清理、Run 新列读写。
- `packages/persistence/src/rows.ts` / `read-models.ts`：映射与终态过滤。
- `packages/planning/src/assignment.ts`：`rankAssignmentCandidates`。

### Runtime

- `apps/runtime/src/agent-runner.ts`：槽接入、墙钟/步骤/工具预算、`terminateRun`、恢复清理、终态统一。
- `apps/runtime/src/orchestrator.ts`：计划截止时间、替代评估/确认、暂停等待确认、取消/资源释放、队列语义。
- `apps/runtime/src/orchestration.ts`：`assignmentMode`、候选快照复用、`metrics` 回退（V1.3 回归修复）。
- `apps/runtime/src/assignment-candidates.ts`（新）、`apps/runtime/src/limits.ts`（新）、`config.ts`。
- `apps/runtime/src/dispatcher.ts`：`orchestration.reassign`。

### Desktop

- `apps/desktop/src/preload/index.ts`、`packages/contracts/src/desktop-api.ts`：reassign 通道。
- `apps/desktop/src/renderer/src/lib/labels.ts`：`超时终止`、`预算耗尽` 文案。
- **没有新增页面/弹窗/视觉样式**；未改动布局。UI 视觉回归（P1-09）仍未做。

### Tests / Scripts

- `tests/helpers/r1-fixture.ts`、`tests/r1-concurrency.test.ts`（3）、`tests/r1-budgets.test.ts`（5）、
  `tests/r1-handoff-reassign.test.ts`（5）。
- `scripts/r1a-cross-process.mjs` + `scripts/r1a-prepare.ts` + `scripts/r1a-worker.ts`。
- `scripts/r1b-kill-restart-e2e.mjs`。
- `package.json`：`test:r1a`、`test:r1b`、`test:r1`。
- `docs/adr/0011-run-budget-and-agent-capacity.md`。

---

## 6. 真实测试结果与回归

| 命令 | 结果 | 说明 |
|---|---|---|
| `pnpm lint` | **PASS** | eslint 0 error 0 warning；Dependency boundaries OK |
| `pnpm typecheck` | **PASS** | `tsc --noEmit` |
| `pnpm test` | **PASS** | 36 文件 / **190 tests**，含既有 Phase 1/2A/2A.1 全部用例 |
| `pnpm build` | **PASS** | runtime + desktop（Electron 43） |
| `pnpm vitest run tests/r1-*.test.ts` | **PASS** | **13 tests**（并发 3、预算 5、替代 5） |
| `node scripts/r1a-cross-process.mjs` | **PASS** | 见 §1.3；日志 `test-results/r1/r1a-cross-process.log` |
| `node scripts/r1b-kill-restart-e2e.mjs` | **PASS** | 25 checks；日志 `test-results/r1/r1b-kill-restart.log` |
| `node scripts/v18-teamwork-e2e.mjs` | **PASS** | 7 checks，9 provider requests |
| `node scripts/v14-e2e.mjs` | **PASS** | findings=1 proposals=2 pending_approval mode=propose |
| `node scripts/v13-e2e.mjs` | **未通过（既有探针过期）** | metrics 回归已修；随后卡在 `.po-inspector-identity` 隐藏（V1.7 节点抽屉改版后的旧选择器），与本轮改动无关。日志 `test-results/r1/v13-e2e.log` |
| `pnpm test:package` | **未执行（刻意）** | 现有 `release/` 产物早于本轮源码；跑旧产物不能证明新源码，P1-10 仍开放 |

> 失败/跳过均已列出，未隐藏。V1.3 的失败需要在 P1-09/P1-10 的 UI/打包轮次一并修复探针，不能用“build 通过”代替。

---

## 7. 遗留问题矩阵（最新）

| ID | 状态 | 说明 |
|---|---|---|
| P0-01 外部 Runtime 真实认证 / 每 Run 文件 diff 归属 | **阻塞待验证** | 本轮未使用任何真实 Harness/凭据；CLI Runtime 只用于验证进程生命周期，不代表真实模型能力 |
| P0-02 进程 kill/restart | **已验证关闭** | 真实 Runtime 进程 kill + 重启，25 断言；微秒级窗口用注入/对象级测试，已在 §2.3 注明 |
| P0-03 质量策略 | 待验证 | 既有测试通过，本轮未新增 Scheduler E2E |
| P0-04 人工/自动边界 | 处理中 | 高风险额外证据仍待 Phase 2B |
| P0-05 自动补证 | 处理中 | 补证成功后的完整 E2E 仍缺 |
| P0-06 Reconcile 后继续 | 处理中 | 本轮恢复路径通过，Plan 自动 resume 集成 E2E 仍缺 |
| P0-07 Handoff 安全替代 | **已验证关闭** | 见 §4；Runtime 风险升级规则已实现但未单独测试 |
| P0-08A revision | 待验证 | 既有测试通过 |
| P0-08B 全局并发 | **已验证关闭** | 双 Scheduler + 双进程真实测试 |
| P0-08C Inbox 队列 | 待验证 | 持久化/幂等通过；backoff 时间与优先级顺序未单独断言 |
| P0-08D Run/Plan 预算 | **已验证关闭** | 见 §3 |
| P0-11 Agent 直接 done | 已验证关闭 | 既有 8 tests 保持通过 |
| P0-12 结构化 Artifact | 待验证 | 旧 Artifact 兼容策略未变 |
| P1-09 Electron UI 视觉回归 | **未开始** | 本轮无新增 UI；仅新增两个状态文案，未做截图/DPI/主题对比 |
| P1-10 重新打包/产物一致性 | **未开始** | 未重新打包；`release/` 仍落后源码 |

---

## 8. UI 变更说明

- **没有新增或重设计任何页面、弹窗、组件或样式**。
- 唯一 UI 相关改动：`RUN_STATUS_LABELS` 增加 `timed_out=超时终止`、`budget_exhausted=预算耗尽`，
  以及确认替代的 API 通道（`orchestration.reassign`，未接入新界面）。
- 因此**没有 Electron 截图/交互/DPI 证据**；P1-09 保持未关闭。替代确认当前通过 API/持久化提议暴露，
  若下一轮需要界面操作，应在现有运行/协作页面内增量实现，不新增 Teamwork 中心。

---

## 9. 已知风险与下一轮建议

1. **V1.3 E2E 探针过期**：`.po-inspector-identity` 在 V1.7 抽屉布局下隐藏；需要与 P1-09 一起修 UI 探针，
   不能用修改断言“假装通过”。
2. **替代确认尚无界面**：提议已持久化、事件已发、API 可确认；UI 入口待 P1-09 轮次。
3. **Runtime 风险升级规则**未单独测试（实现存在：native<ACP<CLI）。
4. **进程级微秒窗口**（目标 Run 已创建/continuedAt 未写）仍为对象级测试。
5. **P1-10**：本轮源码未打包；发布前必须重新 `package:dir` 并跑 `test:package` + 迁移/功能对比。
6. 失败 Run 仍需人工 reconcile；预算终态不会自动重试，符合“未知副作用不重放”。

**本轮到此停止，等待验收。未进入 Phase 2B，未处理后续批次。**
