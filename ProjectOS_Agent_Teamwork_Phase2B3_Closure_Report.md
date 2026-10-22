# ProjectOS Agent Teamwork — Phase 2B-3.1 闭环补验报告

> 日期：2026-10-21
> 范围：P0-14 自动触发与真实 Replanner、P1-13 失败后闭环、Proposal 并发/过期、授权启动完整路径、P0-15 外部 Harness 边界。
> 基线：`feature/v1.6-ux`，HEAD `81cc50c`；Phase 2B-3 未提交成果已备份到 `test-results/phase2b3-backup/`。
> 本轮未创建 Git commit；未恢复 Agent 路由；未新增第二套 Planner/Scheduler。
> 证据：`test-results/r2b3/`（新增 `real-replan.json`、`real-replan-proposal.png`）。
> **最终补验：`ProjectOS_Agent_Teamwork_Phase2B3_Final_Closure_Report.md`。** 该报告已修复 Provider 400、真实 Replanner 应用并完成 P0-14；本报告中 P0-14 的未闭环状态已被最终报告更新。

## 1. 实际完成与未完成（先给结论）

| 项目 | 当前状态 | 证据 |
|---|---|---|
| P0-14 真实自动触发 | **已完成**：真实 Scheduler 失败自动生成 proposal；另有 Scheduler 单测触发 | `real-replan.json`；`tests/r2b3-replan.test.ts` |
| P0-14 真实 Replanner | **已完成**：真实 DeepSeek `replan-v1`，1 次调用、context 3,179 chars | `real-replan.json` |
| P0-14 应用后完整重授权/执行 | **未完成**：真实 proposal 未 apply | 本报告 §4 |
| P1-13 失败后最终完成的多 Agent 闭环 | **未完成**：真实 2-task DAG 成功，但没有“失败→replan→新 revision→多 Agent 完成”证据 | 本报告 §6 |
| P0-13 完整 RuntimeSupervisor 双实例启动 | **部分验证**：独立进程 + 真实 SQLite/PlanGrantService 已证；完整双 Supervisor 未跑 | `cross-process-grant.json` |
| Proposal 并发/过期 | **已完成**：V24 source fingerprint/run count、原子 claim、恢复；测试通过 | `tests/r2b3-replan.test.ts` |
| P0-15 外部 Harness | **明确接受风险**：adapter 级权限，不是 OS 沙箱 | 本报告 §7 |

因此：**P0-14 仍不能标记“已验证关闭”**（真实 proposal 已生成，但应用/重新授权/最终执行未闭环）；P1-13 仍为部分验证。没有把 2B-3 的“生成提案”冒充“完成多 Agent 协作”。

## 2. 代码改动

### 2.1 V24：Proposal 事实版本与原子应用

`packages/persistence/src/migrations.ts`：

- `plan_replan_proposals.source_fingerprint`：提案时计划内容/任务/Agent/验收/依赖指纹。
- `source_run_count`：提案时 plan execution 的 Run 数。
- `claimReplanProposal`：`UPDATE ... SET status='applying' WHERE id=? AND status='proposed'`；两个进程只有一个成功。
- `recoverApplyingReplanProposals`：启动时把“claimed 但未产生 appliedPlanId”的 proposal 恢复为 `proposed`。

`ReplanService.apply`：

1. 重新读取最新 Plan；检查 revision。
2. 检查 `planFingerprint` 与提案时的 `sourceFingerprint` 一致。
3. 检查 Run 数未变化；有新增 Run 直接拒绝。
4. 检查非 running、无 active Run。
5. 原子 claim；claim 失败 → CONFLICT。
6. claim 后再次读取/校验（防 race）。
7. `revisePlan` 失败时恢复 proposal 为 `proposed`，不留下半应用状态。
8. 成功后 appliedPlanId + 审计事件。

新增 `applying` 状态及 UI 文案。

### 2.2 Trigger 修复

- Scheduler 原来只在 `selectStartableTasks` 内检查无 assignee；该集合会先过滤掉无 Agent 任务，导致 `agent_unavailable` 触发不可达。已改为在 ready 集合中先 block + `notifyReplan`，再启动有 Agent 的任务。
- Scheduler 的 PlanGrant guard 失效且错误包含 Agent/Runtime/不可用时，也会触发 `agent_unavailable`，不再静默 pause。
- 自动 trigger 只创建 proposal；不修改 plan/grant。

### 2.3 其他

- 迁移测试更新到 V24（`reserved_runs`、预留表、Replan 表、source 字段）。
- `ReplanPanel` 增加 `applying` 中文状态。
- 报告/Open Issues 更新。

## 3. P0-14：真实自动触发 + 真实 Replanner

脚本：`scripts/r2b31-real-replan.mjs`
证据：`test-results/r2b3/real-replan.json`、`real-replan-proposal.png`

流程与事实：

1. 隔离 data dir + 已授权 DeepSeek 加密配置；真实连接 `Legacy OpenAI-compatible` / `deepseek-flash`。
2. 项目 `package.json` **故意没有 test 脚本**，作为真实质量约束。
3. 真实 Planner（maxTasks=1）生成 1 个任务：`implement-canview`，role developer。
4. 用户通过正式 API 批准计划、签发 `plan.start + workspace-write`、allowedPaths=`src`、maxRuns=1。
5. 真实 Scheduler/AgentRunner 执行；Run 1 后发生真实模型协议错误：
   `模型服务返回 400：assistant tool_calls 必须跟 tool 消息 ...`。
6. 重试 1/1 后计划 failed；Scheduler 自动触发 `retry_exhausted`（不是测试直接调用 `ReplanService.propose`）。
7. 真实 Replanner `PlannerService.generateRevision`：
   - promptVersion `replan-v1`
   - 1 次 provider 调用，无纠错
   - duration 9,318ms
   - context 3,179 chars（project/plan/task/run/tool/error/file/agent/grant/budget/trigger）
   - input 2,604 / output 1,649 tokens（无单价，cost unknown）
8. proposal：
   - status `proposed`
   - trigger `retry_exhausted`
   - sourceRevision 1
   - sourceFingerprint 已保存
   - sourceRunCount 2
   - diff：保留 1、修改 1（description/expectedArtifacts）、无新增/删除
   - grantImpact：`requiresNewGrant=true`、`withinOriginalScope=true`（任务/Agent 未变，但 revision 指纹变了）
   - 模型理由明确识别是“模型服务 400 协议错误，不是规划缺陷”，保留任务 key 与验收，只补充已证实事实。
9. 计划在 proposal 生成前未被修改；proposal 没有自动应用。

检查结果：**8 checks PASS**（真实 Planner、真实失败、自动 proposal、真实 Replanner、上下文、有效 DAG、未变更 plan、无 renderer error）。

限制：该真实 failure 是 provider 协议错误，不是任务验收/质量门禁失败；但它是实际 Scheduler/Run 失败，且触发路径与真实模型调用均为真实。proposal 未 apply，P0-14 不能关闭。

## 4. 自动 trigger 的确定性测试

`tests/r2b3-replan.test.ts` 10 tests：

- Scheduler 任务无 assignee → `agent_unavailable` trigger（真实 Scheduler tick，非直接 propose）。
- 全部 Task 已完成时启动 → 不触发。
- 无执行失败事实时 `retry_exhausted` 被 guard 拒绝。
- 相同失败不会重复提案（active proposal 复用）。
- 自动 trigger 只写 proposal，不改 plan。

未覆盖的自动路径：

- 真实 QualityGate 必需检查失败 → proposal。
- 真实 CompletionDecision 证据耗尽 → proposal。
- Handoff 替代失败后 trigger。
这些代码路径已接入（quality_gate_failed/evidence_exhausted/agent_unavailable），但本轮没有真实 E2E；保留在 §8。

## 5. Proposal 并发/过期

`tests/r2b3-replan.test.ts` 新增：

- 新增 Run 后 apply → CONFLICT，旧 plan 保持 approved。
- 原子 claim：第一次 true，第二次 false；不能产生两个 revision。
- source fingerprint/run count 持久化（V24）。
- apply 后 revision 2 draft；旧 revision superseded；旧 grant 被撤销；再次 apply CONFLICT。
- 拒绝 proposal → plan revision/status 不变。

范围：单进程测试 + SQLite 原子 claim；未在两个真实 OS 进程同时 apply 同一 proposal（claim SQL 已具备该语义，但没有双进程 E2E）。

## 6. P1-13 真实多 Agent 闭环状态

已有真实成功证据（2B-3）：

- 真实 DeepSeek 2-task DAG，未缩减任务数；
- 2 Run、2 done Task、6 Artifact、真实文件；
- 但两个任务都由 `agt_engineer` 执行，不是两个不同 AgentDefinition；
- 没有失败→replan→新 revision→多 Agent 完成。

本轮没有把以下事情冒充为完成：

- 没有手工预置“验收通过 Artifact”；
- 没有把同一 Agent 的两次 Run 称为跨 Agent；
- 没有把 proposal 生成称为最终完成。

P1-13 继续 **部分验证**。

## 7. P0-15 外部 Harness 边界（复核）

- `external-runner.ts` 仅支持 Claude Code/Codex adapter；ProjectOS 控制：
  - adapter 选择、read/write 模式、`cwd`/隔离 worktree、Run/ToolCall 审计、任务/Lease/预算；
- Claude：`--permission-mode plan|acceptEdits`、`--allowedTools`；
- Codex：`--sandbox read-only|workspace-write`；
- ProjectOS 不能逐次拦截外部进程内部工具调用；PlanGrant 不能等同 OS 沙箱；
- Replan/更换 Agent 不会自动扩大外部 Runtime 权限；外部写模式仍要求绑定隔离 worktree 和独立确认；
- UI/文档不得把 PlanGrant 描述为 OS 沙箱。Open Issues P0-15 保持“明确接受风险”。

## 8. 测试与回归

| 命令 | 结果 |
|---|---|
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | **245 passed / 3 skipped**（45 files） |
| `pnpm build` | PASS |
| `pnpm test:teamwork` | PASS（7 checks） |
| `v13-orchestration-e2e` | PASS（4-task, 5 runs） |
| `v13-e2e` | PASS |
| `v14-e2e` | PASS |
| `r21-ui-regression` | PASS（16 checks） |
| `r2-reassign-ui-e2e` | PASS（12 checks） |
| `r2b2-plan-grant-ui-e2e` | PASS（12 checks） |
| `r2b3-replan-ui-e2e` | PASS（9 checks） |
| `r2b3-cross-process-grant` | PASS（多次） |
| `r2b3-real-dag` | PASS（7 checks） |
| `r2b31-real-replan` | PASS（8 checks，proposal only） |
| `e2e.mjs` / `package:dir` / `test:package` | PASS |

V24 迁移测试：V18 → 版本 24，旧项目数据保留；`reserved_runs`/预留表/Replan 表/source 字段存在。

真实/模拟区分：

- 真实：DeepSeek Planner、DeepSeek Replanner、真实 Scheduler/AgentRunner、真实文件/Run/Artifact/SQLite、真实 Electron UI、两个 OS 进程。
- Fake：`replan-ui` 的 Planner/Replanner SSE FakeProvider；`r2b3-replan.test` 的 Planner/Agent；V1.8 多 Agent 模型。
- 未用真实模型：P1-13 失败后最终完成、QualityGate/证据耗尽 trigger、双 RuntimeSupervisor。

## 9. 未解决项（必须保留）

1. P0-14 未完成 apply → 新 revision → 重新批准/授权 → 执行；当前只到 proposal。
2. P1-13 未完成真实失败→replan→多 Agent 最终完成；真实 DAG 成功案例是同 Agent 两任务。
3. P0-13 完整 RuntimeSupervisor/Scheduler 双实例启动未验证；现有证据是独立进程 + PlanGrantService。
4. 真实 Replanner 的 failure 是 provider 400 协议错误，不是 QualityGate/CompletionDecision；其他 trigger 只有单测/代码路径。
5. Proposal 双进程 apply 未做真实 E2E；只有 SQLite claim 单进程测试。
6. 外部 Harness 细粒度权限不可强制；只有 adapter 级审计，未真实执行 Claude/Codex/OpenCode/DSH。
7. 未实现 Phase 2B-4；未恢复 Agent 路由。

## 10. 交付文件

- 本报告：`ProjectOS_Agent_Teamwork_Phase2B3_Closure_Report.md`
- 旧 2B-3 报告：`ProjectOS_Agent_Teamwork_Phase2B3_Report.md`（其未完成项由本报告更新，仍不宣称完整闭环）
- Open Issues：`docs/Agent_Teamwork_Open_Issues.md`
- 真实 Replanner：`test-results/r2b3/real-replan.json`
- 真实 2-task DAG：`test-results/r2b3/real-dag.json`
- 跨进程：`test-results/r2b3/cross-process-grant.json`
- UI：`test-results/r2b3/replan-*.png`、`real-replan-proposal.png`

## 11. 停止

本轮完成了真实自动触发 + 真实 Replanner proposal、V24 并发/过期安全、Scheduler trigger bug 修复、完整回归；**没有完成 apply 后最终多 Agent 闭环**，因此不关闭 P0-14/P1-13，不宣称生产可用。

现在停止，等待验收；不进入 Phase 2B-4，不恢复 Agent 路由。
