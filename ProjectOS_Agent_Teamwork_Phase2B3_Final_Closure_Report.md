# ProjectOS Agent Teamwork — Phase 2B-3.2 最终闭环整改报告

> 日期：2026-10-22
> 范围：真实 Provider 400 协议修复、失败分类、P0-14 真实 Replanner 应用闭环、P1-13 双 Agent 真实接力、Proposal 并发、P0-13 完整 Runtime 启动竞争复核、P0-15 边界。
> 基线：`feature/v1.6-ux`，HEAD `81cc50c`；本轮未创建 Git commit。
> 可恢复基线：`test-results/phase2b3-2-backup/working-tree.patch` + `git-status.txt` + 关键新增文件副本。
> 证据：`test-results/r2b3/`、`test-results/task-drawer/`。

## 1. 最终状态

| 项目 | 状态 | 说明 |
|---|---|---|
| P1-14 Provider tool_calls 协议 | **已验证关闭** | 修复缺失 tool result 的 transcript；真实 DeepSeek 运行不再 400 |
| P0-14 真实自动 Replan + 应用 + 最终执行 | **已验证关闭** | 真实 AgentDefinition 失败 → 自动 trigger → 真实 Replanner → apply r2 → 新 grant → plan completed |
| P1-13 双 Agent 真实接力 | **部分验证** | 两个不同真实 AgentDefinition、上下游依赖、真实 Run/Artifact、失败/Replan/复用/最终 completed；`handoffs` 表为 0，接力依赖持久化 Task dependency + 下游 read_file，不是 Handoff 实体 |
| P0-13 完整 RuntimeSupervisor 启动竞争 | **部分验证** | 两个独立 OS 进程 + SQLite + PlanGrantService 已证；两个完整 RuntimeSupervisor/Scheduler 仍未跑 |
| P0-15 外部 Harness | **明确接受风险** | adapter 级权限，不是 OS 沙箱；本轮没有新增真实外部 Harness 执行 |
| 2B-3 总体 | **停止等待验收** | 不进入 2B-4，不恢复 Agent 路由 |

## 2. Provider 400 根因与修复

### 2.1 根因

OpenAI-compatible/DeepSeek 要求：**assistant 消息带 `tool_calls` 时，后续必须为每个 `tool_call_id` 提供对应的 tool 消息**。

实际调用链有两个缺口：

1. `agent-runtime.runAgentLoop` 在工具返回 `paused`（等待审批）时直接返回 `waiting_approval`，没有把该 tool call 的“未执行/等待审批”结果放进消息序列。
2. `AgentRunner.reconstructTranscript` 从持久化 RunStep 重建历史时，会为每个带 `toolCalls` 的 assistant step 生成消息，但某些 tool result 可能尚未持久化（暂停、崩溃、进程被杀、取消/审批拒绝窗口）。重建后直接发送给 Provider，导致 400。

这不是 Prompt 问题，不能通过删消息或跳过工具结果修复。

### 2.2 修复

`packages/agent-runtime/src/index.ts` 新增 `repairToolCallTranscript`：

- 按 assistant `toolCalls` 的 ID 配对后续 tool 消息。
- 缺失的调用补一条**明确的失败结果**：
  `{"ok":false,"error":"tool result missing from persisted transcript; the tool was not executed","missingToolResult":true}`。
- 丢弃没有对应 assistant call 的孤立 tool 消息。
- 在 `runAgentLoop` 每次 Provider 请求前调用。
- `AgentRunner.buildMessages` 在 `reconstructTranscript` 之后调用。
- 不伪造成功；缺失结果明确标注，仍保留原 tool call。

### 2.3 协议测试

`tests/agent-protocol.test.ts`（5 tests）：

- 完整配对的多轮历史保持不变。
- 缺失 tool result（暂停/崩溃）自动补失败结果，assistant 调用不被删除。
- 孤立 tool 消息被丢弃；多轮成功历史仍合法。
- 工具失败生成显式失败 tool result。
- 审批拒绝生成 denied result；等待审批在恢复时补齐。

真实 Provider 验证：

- 修复后真实 DeepSeek 计划 `real-replan.json` 完成（1 task / 1 Run / completed），不再出现 400。
- 真实多 Agent closure 执行了多次工具调用（写文件、npm test、read_file、create_artifact），未出现协议 400。

## 3. 失败分类：技术故障不再默认改 DAG

新增 `apps/runtime/src/failure-classifier.ts`，分类与动作：

| 失败类别 | 示例 | 是否 Replan | 首选动作 |
|---|---|---|---|
| provider_protocol | tool_calls/tool result 400、invalid_request | 否 | 修复协议/Provider；重试 |
| provider_auth | 401/403/API key | 否 | 修复连接/凭据 |
| provider_unavailable | 429/5xx/连接超时 | 否 | 重试/等待 |
| environment | workspace/worktree/ENOENT/权限 | 否 | 修复环境 |
| agent_unavailable | Agent disabled/无 assignee/Runtime 不可用 | 是 | 合法替代或 Replan |
| quality_gate | 必需检查/质量门禁失败 | 是（先补救证/修复尝试） | Replan/修复任务 |
| evidence | 完成依据/补证耗尽 | 是 | 修订证据/验收 |
| implementation | 测试/断言/命令/任务执行失败 | 是 | Replan 或人工修复 |
| tool_error/approval | 工具技术异常/审批拒绝 | 否 | 人工核对/重试 |
| unknown | 未归类 | 否 | 人工审查 |

实现：

- Scheduler `notifyReplan` 先分类；技术类只写 `plan.execution.failure_classified` 审计并记录日志，不生成 Proposal。
- ReplanService `assertTriggerFact` 对 `retry_exhausted` 再次检查分类；provider_protocol 等直接 `CONFLICT`。
- 保留已有重试、证据补证、Reconcile、Handoff 替代优先；分类不替代这些机制。
- 新增测试：`tests/failure-classifier.test.ts` 4 tests；`tests/r2b3-replan.test.ts` 验证 provider 400 被拒绝、agent disabled 允许 proposal。

## 4. P0-14：真实失败 → 自动 Replan → 应用 → 最终完成

脚本：`scripts/r2b32-real-closure.mjs`
证据：`test-results/r2b3/closure.json`、`closure-proposal.png`、`closure-completed.png`
结果：**12 checks PASS**

流程：

1. 隔离项目，真实 DeepSeek `deepseek-flash`。
2. 通过正式 API 创建真实自定义 AgentDefinition `Closure Developer`（开发工程师，files/shell 权限），指派到真实 Planner 生成的任务。
3. 批准计划 + 签发初始 PlanGrant。
4. 通过正式 `agentDefinition.setStatus` 将 Agent 置 disabled，制造真实可恢复失败。
5. 真实 Scheduler 启动失败，任务 block、plan failed：
   `任务启动失败：Agent 当前状态为 disabled`。
6. Scheduler 自动触发 `agent_unavailable`；**没有测试直接调用 ReplanService.propose**。
7. 真实 Replanner（DeepSeek，`replan-v1`，1 次调用）生成有效 Proposal；Proposal 记录真实执行上下文、diff、grant impact。
8. 用户通过正式 API：
   - 恢复 Agent；
   - `plan.replan.apply`；
   - 更新新 revision 的 Agent 指派；
   - `plans.approve`；
   - 签发新 PlanGrant；
   - `orchestration.start`。
9. 新 revision 实际执行：真实 write_file、读取、质量门禁、Artifact 验收。
10. 最终 Plan `completed`，Task `done`，Artifact 已验证。

关键检查：

- 初始计划已批准但 `execution=null`；
- 真实失败 `failed`；
- Proposal `proposed`，`generation.mode=provider`；
- Revision r2 draft；
- 旧 plan `superseded`；
- 旧 grant `revoked` 且 `valid=false`；
- 新 grant `valid=true`；
- 最终 plan `completed`；
- 最终 task `done`；
- 真实 Agent Run + Artifact；
- 无 renderer error。

## 5. P1-13：两个真实 AgentDefinition 的失败/接力/复用

脚本：`scripts/r2b32-real-multi-agent.mjs`
证据：`test-results/r2b3/multi-agent-closure.json`、`multi-agent-db-evidence.json`、`multi-agent-completed.png`
结果：**13 checks PASS，但 Handoff 实体缺口，P1-13 仍为部分验证**

流程：

1. 真实 DeepSeek Planner 生成 **2 个任务、上下游依赖**：
   - `implement-canview` / developer
   - `verify-canview` / tester，依赖 developer。
2. 通过正式 API 创建两个真实 AgentDefinition：`Closure Developer`、`Closure Tester`，分别指派。
3. 批准计划 + 初始 PlanGrant。
4. 禁用 Tester Agent；Developer 先完成真实实现，Tester 下游任务启动失败。
5. 真实 Scheduler 自动触发 `agent_unavailable`，真实 Replanner 生成 Proposal。
6. 恢复 Tester，正式 apply → r2 → 重新指派 → approve → 新 grant → start。
7. r2 复用已完成的 Developer Task（旧 Task ID），不再重复执行；Tester 真实 Run 读取 `src/permission.ts`、写测试、`npm test`、创建测试报告。
8. 最终 Plan `completed`，两个 Task `done`，两个不同 AgentDefinition 均有真实 Run。

SQLite 证据（`multi-agent-db-evidence.json`）：

- 3 个 Task：旧 developer（done、复用）、旧 tester（cancelled）、新 tester（done）；
- 2 个 Run：
  - developer `Closure Developer`；
  - tester `Closure Tester`（读取 `src/permission.ts`，运行 `node --test`、`npm test`，写 `src/permission.test.mjs`，create_artifact）；
- 9 个 Artifact；
- 1 个 Proposal；
- 持久化 Task dependency：tester → developer；
- `handoffs` 表 **0 条**。

P1-13 判定：**部分验证**。两个 Agent、真实 Run、上下游依赖、失败/Replan/复用/最终完成均成立；但没有 Handoff 实体，且下游消费的是真实文件（`read_file`）而不是直接读取上游 Artifact 实体。因此不把“Handoff 真实传递”标记为完成。

## 6. P0-13：完整 RuntimeSupervisor 启动竞争

已有证据（`scripts/r2b3-cross-process-grant.mjs`）：

- 两个真实 OS 进程、独立 SQLite 连接、独立 PlanGrantService；
- 同一 grant 启动竞争：1 reserved / 1 rejected；
- 工具配额：1 allow / 1 deny；
- `used_tool_calls=1`；
- 撤销/过期后 deny；
- stale reservation 释放 1 个，`used_runs=0`；
- V23/V24 预留与恢复。

未完成：

- 两个完整 RuntimeSupervisor/Scheduler 进程（包含 runtime child、workspace 初始化、真实 Task lease/Agent slot）的启动竞争未跑；
- Workspace 初始化失败 + 真实启动重试的完整 Runtime 路径未跑；
- “Run 已创建但预留未结算”的完整进程 kill/restart 未跑。

因此 P0-13 仍为**部分验证**，没有用 PlanGrantService 单测冒充完整 Runtime 测试。

## 7. Proposal 并发与崩溃一致性

已完成：

- V24 `source_fingerprint` + `source_run_count`；
- `claimReplanProposal` 原子 `proposed → applying`；
- `recoverApplyingReplanProposals` 启动恢复；
- apply 时重读最新 Plan/Run/Task/Grant，指纹/新 Run 变化拒绝；
- 单进程原子 claim 测试、stale proposal 测试、重复 apply 测试；
- 旧已完成 Task 复用不再重复执行。

未完成：

- 两个真实 OS 进程同时 apply 同一 Proposal 的 E2E；
- 新 Revision 已创建但 `applied_plan_id` 尚未写入时真实 kill 的测试；
- 需要跨进程崩溃窗口的恢复验证。

报告不把单进程 claim 测试冒充双进程 E2E。

## 8. P0-15 外部 Harness 边界

保持明确接受风险：

- 代码只有 Claude Code / Codex adapter；ProjectOS 控制启动参数、read/write、cwd/worktree、Run 审计；
- 不能逐次拦截外部进程内部工具调用；
- PlanGrant 不是 OS 沙箱；
- Replan/更换 Agent 不自动扩大外部 Runtime 权限；
- UI/文档不得把 Harness permission mode 描述为 ProjectOS 工具级强制隔离；
- 未使用未授权外部 Harness 凭据。

## 9. UI 与回归

本阶段未新增页面/路由；保留现有 Apple-inspired Liquid Glass、V1.3 DAG、浅深主题。

任务详情抽屉（上一轮整改）也保持通过：

- 4 个 Tab：概览、验收与依赖、运行与交付、授权；
- 验收标准独立编号行；
- 关闭动画期间不再显示“任务不存在”；
- 125% 缩放、深色主题、遮罩关闭验证；
- `task-drawer-ui-e2e` 10 checks PASS。

## 10. 实际测试结果

| 命令 | 结果 |
|---|---|
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | **255 passed / 3 skipped**（47 files；46 pass/1 skip） |
| `pnpm test:teamwork` | PASS（7 checks，9 provider requests） |
| `v13-orchestration-e2e` | PASS（4-task，5 runs，quality reports 2，worktree merged） |
| `v13-e2e` | PASS |
| `v14-e2e` | PASS |
| `r21-ui-regression` | PASS（16 checks） |
| `r2-reassign-ui-e2e` | PASS（12 checks） |
| `r2b2-plan-grant-ui-e2e` | PASS（12 checks） |
| `r2b3-replan-ui-e2e` | PASS（9 checks） |
| `task-drawer-ui-e2e` | PASS（10 checks） |
| `r2b3-cross-process-grant` | PASS（多进程授权竞争） |
| `r2b3-real-dag` | PASS（真实 DeepSeek 2-task DAG） |
| `r2b31-real-replan` | PASS（协议修复后的真实完成运行） |
| `r2b32-real-closure` | **PASS 12 checks**（P0-14） |
| `r2b32-real-multi-agent` | **PASS 13 checks**（P1-13 主体，Handoff 缺口） |
| `e2e.mjs` / `package:dir` / `test:package` | PASS |

真实/模拟区分：

- **真实**：DeepSeek Planner/Replanner、真实 AgentDefinition、真实 Scheduler/AgentRunner、真实 SQLite/Run/Task/Artifact、真实 Electron、独立 OS 进程。
- **模拟**：`r2b3-replan.test.ts`、`r2b3-replan-ui-e2e.mjs` 的 Planner/Replanner FakeProvider；V1.8 多 Agent 模型；任务抽屉 UI 的测试 fixture。
- **未执行真实**：Claude Code/Codex/OpenCode/DSH、完整 RuntimeSupervisor 双实例、Proposal 双进程 apply、P1-13 Handoff 实体。

## 11. 仍未关闭/风险

1. **P1-13**：`handoffs` 表 0 条；下游 Tester 读取真实文件而不是上游 Artifact 实体。需要真实 Handoff 请求/接受/消费才能关闭。
2. **P0-13**：完整 RuntimeSupervisor/Scheduler 双进程启动竞争、Workspace 失败、预留未结算 kill/restart 未跑。
3. **Proposal 双进程 apply/崩溃窗口**：只有单进程 atomic claim 与 stale 检查；没有双进程 E2E。
4. **P0-15**：外部 Harness 细粒度权限不可强制，保持接受风险；未真实执行外部 Harness。
5. **真实 Replanner 失败原因**：closure 使用 Agent disabled（可恢复的真实失败）；provider protocol 失败现在被分类为技术故障，不再触发 Replan。其他 QualityGate/evidence trigger 的真实 Replanner 应用未单独跑。
6. **Git**：未创建 commit；提供 `test-results/phase2b3-2-backup/` 可恢复 patch/状态/关键文件。未覆盖其他会话工作。

## 12. 停止

- P0-14、P1-14 可标记验证关闭；
- P1-13 仍为部分验证（Handoff 实体缺口）；
- P0-13 仍为部分验证（完整 RuntimeSupervisor 双实例未跑）；
- P0-15 保持明确接受风险。

不进入 Phase 2B-4，不恢复 Agent 路由，不新增第二套 Planner/Scheduler/Task/Runtime/Teamwork 页面。现在停止，等待验收。
