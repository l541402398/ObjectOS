# ProjectOS Agent Teamwork — Open Issues

> 基线：Phase 1 `4964770`、Phase 2A `f2a20a5`/`511489a`/`93db316`、Phase 2A.1 `12b14bf`、Legacy Fixes `0e153b6`、R1 `5afd7a0`。
> 本轮：R2 集成闭环与发布前验收；报告 `ProjectOS_Teamwork_R2_Acceptance_Report.md`；
> 证据：`test-results/r1/`、`test-results/r2/`（含 6 张 Electron 截图）；真实 Harness 密钥仅环境变量注入。
> 状态枚举：`未开始 / 处理中 / 部分验证 / 待验证 / 已验证关闭 / 阻塞待验证 / 明确接受风险`。
> **没有测试证据的项目不标记为“已验证关闭”。**

| ID | 影响范围 | 根本原因 | 实际代码位置 | 当前实现 / 缺失 | 风险 | 计划阶段 | 验收标准 | 当前状态 | 验证证据 | 阻断正式发布 |
|---|---|---|---|---|---|---|---|---|---|---|
| P0-01 | 外部 Runtime / 证据归属 | 假 Provider E2E 不能证明真实 Harness；changedFiles 可能包含上游改动 | `agent-runner.ts`（V21 归属）、`runtime-executor.ts`、`packages/workspace` 指纹差分、`run_file_changes` | 已实现每 Run 内容指纹基线/差分归属；使用已授权 OpenCode CLI + DeepSeek 完成真实推理、文件修改、审批、取消、失败 | 高 | 真实环境 | 隔离项目 + 已授权真实 Runtime 至少完成一次真实文件修改、失败和取消，并证明变更只归属于本次 Run | **已验证关闭**（仅覆盖 OpenCode + DeepSeek；其他 Harness 未测） | `tests/r2-real-harness.test.ts` 3 tests PASS；真实写入 `real-run-a.txt` 且只归属该文件，dirty 文件排除；取消/失败均真实记录；报告 §4.2 | 否 |
| P0-02 | 进程崩溃/重启恢复 | 只有对象重建/模拟恢复，没有真正 kill/restart E2E | `apps/runtime/src/agent-runner.ts` `recoverInterruptedRuns`、`orchestrator.ts` `recover`、`RuntimeSupervisor` | 真实 Runtime 子进程 kill/restart E2E（`scripts/r1b-kill-restart-e2e.mjs`）；恢复清理死槽、释放 lease、取消失效审批、Handoff/Inbox 状态保留 | 高 | Phase 2C | kill Runtime 后重启，核验 Run/Task/Handoff/Inbox/文件/Lease 最终状态，且不重复执行 | **已验证关闭**（真实 kill 覆盖运行中+审批等待；Handoff/Inbox 窗口为注入状态，报告 §2.3 已注明） | `test-results/r1/r1b-kill-restart.log`：PID 14544 被 taskkill /T /F，重启 16776，25 checks PASS；Run→needs_reconciliation、Task→blocked、lease/槽 expires_at=0、文件未重写、Run 数不变 | 否 |
| P0-03 | 质量门禁策略 | 只有脚本存在检查，没有 required/optional/not_applicable 策略 | `apps/runtime/src/quality-gate.ts`、`orchestrator.ts` review loop、`project.qualityPolicy.*` | 已实现 required/optional/not_applicable/skipped；必需缺失=skipped 且 passed=false；project policy 存 `app_settings` | 中 | Legacy 第一批 | 必需脚本缺失不得 pass；可选缺失如实记录；不同项目可配置 | **已验证关闭** | `tests/r2-quality-evidence-reconcile.test.ts`：缺 test 脚本→paused/artifact 未验证；有 test→done/已验证 | 否 |
| P0-04 | 人工/自动验收边界 | Human 可无 Artifact 直接完成；未区分人工/自动审计 | `packages/application/src/task-service.ts`、`completion-evidence.ts`、`RunsPage`/任务完成 UI | 验收 Artifact 增加 `acceptanceMode: human/automatic`、actor、requirements；Agent/System 严格走证据；人工保留可追溯记录；**缺失**高风险任务额外证据/更高权限确认 | 中 | Phase 2B | 人工与自动验收可区分；重复提交只有 1 条验收记录；Agent 不能走人工路径；历史记录不被覆盖 | **处理中**（关键路径已实现并测试，高风险策略待 Phase 2B） | `tests/agent-completion-tool.test.ts` human/agent 区分、重复提交测试 | 是（高风险策略未做） |
| P0-05 | 证据不足自动补证 | 证据不足只 pause，需人工补 | `apps/runtime/src/orchestrator.ts` review loop、`PlanExecution` evidenceRetries | 已实现有限自动补证（默认 1 次）；补证 Run 创建真实 code Artifact 后重新验收并通过 | 中 | Legacy 第一批 | 缺失证据可自动补证有限次；补证后重新评估；超限 pause，不空 Artifact 绕过 | **已验证关闭** | `tests/r2-quality-evidence-reconcile.test.ts`：2 个 Run、`evidenceRetries=1`、task done、plan completed | 否 |
| P0-06 | Reconcile 后继续 | reconcile 只改 Run/Task，计划需手动 resume | `agent-runner.reconcileRun`、`dispatcher` `run.reconcile`、`orchestrator` | reconcile 后若计划 paused 自动 `scheduler.resume`；修复人工 retry 被自动重试上限误判的问题 | 中 | Legacy 第二批 | 确认完成/重试后 Plan 同步、旧 Run 不重复、审计可查 | **已验证关闭** | `tests/r2-quality-evidence-reconcile.test.ts`：真实 dispatcher，retry 后 plan 自动完成，旧 Run failed + 新 Run completed 恰 2 个 | 否 |
| P0-07 | Handoff 接收方失败安全重分配 | 目标 Runtime/Agent 不可用时只 block/fail，无合法替代 | `orchestrator.ts` `evaluateReassignment/handleReceiverStartFailure/confirmReassignment`、`assignment-candidates.ts`、`packages/planning/src/assignment.ts` | 已实现：统一候选评分、可见性/Skill/Runtime/负载过滤、显式指定与权限扩大需确认、无候选明确 blocked、`orchestration.reassign` 人工确认、启动仍归 Scheduler | 高 | Phase 2B | 失败原因、候选替代、权限/可见性/能力/负载、Lease 释放、统一 Scheduler 启动、无合法者阻塞 | **已验证关闭**（Runtime 风险升级规则已实现但未单独测试） | `tests/r1-handoff-reassign.test.ts` 5 tests PASS：applied/none/explicit/invisible/expansion/lease/重复 tick；`[r1d-*]` 日志 | 否 |
| P0-08A | Plan Revision supersede | 新 revision 创建新任务，旧任务仍可调度 | `orchestration.revisePlan`、`PlanDraft.tasks.reuse*`、`TaskService` | 旧 plan superseded、未完成旧 Task cancelled、已完成保留；新节点记录 `reuseFromTaskId/reuseArtifactIds`；旧任务不重复 Run | 中 | Legacy 第二批 | 旧任务不重复调度、历史保留、新旧不并发、复用规则明确 | **已验证关闭** | `tests/r2-revision-inbox-legacy.test.ts`：superseded、done 保留、未完成 cancelled、reuse 引用、批准后 0 新 Run | 否 |
| P0-08B | 全局 per-Agent 并发 | 跨计划可同时调用同一 Agent | `agent_execution_slots`（V19）、`store.acquireAgentExecutionSlot`、`agent-runner.startRun`、`orchestrator` | 原子容量槽：检查+占用同一 `BEGIN IMMEDIATE` 事务，fencing token，TTL/心跳，取消/终态/崩溃释放；容量冲突=排队不失败 | 中 | Legacy 第二批 | 两个计划同 Agent 不并发；等待/取消/重启一致 | **已验证关闭** | 双 Scheduler：峰值 1、两计划完成；双真实进程（PID 23668/16924）：`peakRuns=1 peakSlots=1 overlaps=0 openSlots=0`；`tests/r1-concurrency.test.ts` 3 tests；`test-results/r1/r1a-cross-process.log` | 否 |
| P0-08C | Inbox 可靠队列 | delivered 失败只 warning；无 priority/backoff/终态 | `agent-runner.retryPendingInbox`、`agent_inbox.priority/next_attempt_at`（V18） | priority/backoff/最多 3 次/24h 终态/幂等/重启恢复均已实现 | 中 | Legacy 第二批 | 重复投递不重复 Run；失败有退避和终态；重启可恢复 | **已验证关闭** | `tests/r2-revision-inbox-legacy.test.ts`：优先级顺序、退避 10s、attempts=3 failed、24h failed、重启 completed 且 1 个 Run | 否 |
| P0-08D | Run/Plan 预算与超时 | 只有质量门禁/CLI 120s、步骤上限；无 plan/run wall-clock | `limits.ts`、`agent-runner`（deadline/budget/terminateRun）、`orchestrator`（计划 deadline）、V20 `deadline_at/budget_json` | 已实现 Run 墙钟、步骤/工具次数、Plan 总时长、审批等待二次检查、重启保留剩余预算；新增 `timed_out`/`budget_exhausted` 终态；Token/费用未知不估算 | 高 | Phase 2C | 硬限制达到时停止新动作并安全中断；不可猜 Token/费用 | **已验证关闭** | `tests/r1-budgets.test.ts` 5 tests PASS：墙钟/步骤/工具/计划超时/重启预算；`[r1c-*]` 日志；工具上限时第二调用未创建 ToolCall | 否 |
| P1-09 | UI 视觉与交互回归 | Phase 2A/2A.1 UI 改动未截图/交互验证 | `RunsPage.tsx`、`CollaborationPage.tsx`、`AgentWorkbenchPage.tsx`、`OrchestrationWorkspace.tsx` | 新替代确认面板已实机截图/交互；全站其它页面未逐一回归；设置页玻璃头部遮挡“新增连接”命中区域（E2E 以真实 DOM click 绕过，需 UI 修复） | 中 | Phase 2C | 实际 Electron 截图、正常/错误/空/等待、DPI/缩放、与主题一致 | **部分验证** | `test-results/r2/reassign-*.png` 6 张；`r2-reassign-ui-e2e` 12 checks；浅/深色、125% 缩放、侧栏折叠、确认/取消 | 是（全站未回归） |
| P1-10 | EXE 与源码一致性 | 打包产物可能落后，DB 迁移/Runtime 未包含 | `release/win-unpacked`、`scripts/package-smoke.mjs`、`scripts/r2-package-*.mjs` | 已重新打包；package smoke PASS；V18→V21 隔离迁移 PASS；包内 R1/R2 功能 10 项核对 PASS | 高 | Phase 2C | build/test:package/打包 Smoke/迁移测试通过；临时数据目录，不碰用户 DB | **已验证关闭** | `pnpm test:package` PASS；`r2-package-features` 10/10；`r2-package-migration` versions=19,20,21 且 legacy 数据保留，未触碰用户 DB | 否 |
| P0-11 | Agent 直接 done 独立测试 | 只有纯函数测试，缺 AgentRunner→ToolHandler→TaskService 链 | `tests/agent-completion-tool.test.ts` | 已新增 8 个真实调用链测试：无证据、写拒绝、类型不匹配、测试缺失、合法证据、Human/Agent、重复提交、取消任务；另有 Task Lease/多 Agent 既有测试 | 高 | Legacy 第一批 | 10 类场景中关键路径均有真实调用链证据 | **已验证关闭** | `tests/agent-completion-tool.test.ts` 8 tests PASS；`[done-gate]` 输出；`tests/agent-runner-guards.test.ts` lease 测试 | 否 |
| P0-12 | 结构化 Design/Review Artifact | 仅关键词匹配，不能证明真实审查 | `packages/contracts/entities.ts` `metadata`、V17、`completion-evidence.ts`、`create_artifact` | 新结构化路径严格校验；旧 Artifact 仍可读但不自动通过，需人工复核；人工验收记录 `acceptanceMode=human` | 高 | Legacy 第一批 | Artifact 存在、任务/来源可追溯、类型匹配、必需字段有效；旧 Artifact 可读但需人工 | **已验证关闭** | `tests/r2-revision-inbox-legacy.test.ts`：旧 design 无 metadata→paused；人工 done→task done + human 验收 Artifact；计划恢复完成 | 否 |

## 状态统计

- 已验证关闭：12（P0-01、P0-02、P0-03、P0-05、P0-06、P0-07、P0-08A、P0-08B、P0-08C、P0-08D、P0-11、P0-12）
- 处理中：1（P0-04 高风险人工验收策略）
- 部分验证：1（P1-09 新替代 UI 已实机验证，全站未逐一回归）
- 未开始：0
- 阻塞待验证：0（真实 Harness 仅覆盖 OpenCode + DeepSeek，其它 Harness 未测）

> 该统计按 12 个主项归类；P0-08 的 A/B/C/D 子项在矩阵中分别列出。**没有真实进程 kill / 跨进程并发 / 真实 Harness / 终止行为测试的项目不会被标为关闭。**
> R2：201 个单测（+3 真实 Harness 有密钥时运行）、R1 双进程、R1 真实 kill/restart、V1.3/V1.4/V1.8、R2 UI 12 checks、打包 smoke 与 V18→V21 迁移均有日志。

## 进入 Phase 2B 前的判断

- **P0-01 已关闭（范围：OpenCode + DeepSeek）**：真实推理、文件修改、审批、取消、失败、每 Run 归属；其他 Harness 未验证。
- **P0-02 / P0-07 / P0-08B / P0-08D 已关闭**：真实 kill/restart、安全替代、原子全局容量、硬预算/超时均有可复现证据。
- **P0-03 / P0-05 / P0-06 / P0-08A / P0-08C / P0-12 / P1-10 已关闭**：均有真实 SQLite/打包证据。
- **P0-11 已关闭**：Agent 直接 done 不再能绕过证据链。
- **剩余阻断**：P0-04 高风险人工验收策略；P1-09 全站视觉回归（新替代面板已实机验证，并发现设置页玻璃头部遮挡“新增连接”的命中区域，需 UI 修复）。
- 替代确认界面已在现有编排节点抽屉内完成（`orchestration.reassign` / `declineReassign`），未新增 Teamwork 页面。
- Phase 2B 的 Provider-backed Planner 在 P0-04 与 P1-09 完成前仍不能被描述为“生产可用”。
