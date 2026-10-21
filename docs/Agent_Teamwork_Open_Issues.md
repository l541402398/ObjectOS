# ProjectOS Agent Teamwork — Open Issues

> 基线：Phase 1 `4964770`、Phase 2A `f2a20a5`/`511489a`/`93db316`、Phase 2A.1 `12b14bf`。
> 本轮 Legacy Fixes 提交：`0e153b6`。
> 本清单对应 Phase 2A.1 报告第 8 节的 12 项遗留问题，以及本轮 Legacy Fixes 的整改状态。
> 状态枚举：`未开始 / 处理中 / 待验证 / 已验证关闭 / 阻塞待验证 / 明确接受风险`。
> **没有测试证据的项目不标记为“已验证关闭”。**

| ID | 影响范围 | 根本原因 | 实际代码位置 | 当前实现 / 缺失 | 风险 | 计划阶段 | 验收标准 | 当前状态 | 验证证据 | 阻断正式发布 |
|---|---|---|---|---|---|---|---|---|---|---|
| P0-01 | 外部 Runtime / 证据归属 | 假 Provider E2E 不能证明真实 Harness；changedFiles 可能包含上游改动 | `apps/runtime/src/agent-runner.ts`、`apps/runtime/src/orchestrator.ts`、`packages/persistence`、`runtime_profiles` | 已有 Runtime Registry/Profile/Adapter 与实际调用链；**缺失**每次 Run 的独立文件基线/前后 diff 归属，真实 CLI E2E 未跑 | 高 | Phase 2C / 真实环境 | 隔离项目 + 已授权真实 Runtime 至少完成一次真实文件修改、失败和取消，并证明变更只归属于本次 Run | **阻塞待验证**（本机无授权真实 Harness/凭据；未伪造通过） | 无真实 Runtime 证据；Phase 1/2A 假 Provider 测试不计入 | 是 |
| P0-02 | 进程崩溃/重启恢复 | 只有对象重建/模拟恢复，没有真正 kill/restart E2E | `apps/runtime/src/agent-runner.ts` `recoverInterruptedRuns`、`orchestrator.ts` `recover`、`RuntimeSupervisor` | 已有 needs_reconciliation、scheduler.recover、handoff prepared/continuedAt 单测；**缺失**真实 Electron 进程 kill/restart E2E | 高 | Phase 2C | kill Runtime 后重启，核验 Run/Task/Handoff/Inbox/文件/Lease 最终状态，且不重复执行 | **未开始**（本轮未写真实 kill/restart 脚本） | 单元模拟：`tests/teamwork-relay.test.ts` prepared/continuedAt、`tests/recovery.test.ts`；不构成进程级 E2E | 是 |
| P0-03 | 质量门禁策略 | 只有脚本存在检查，没有 required/optional/not_applicable 策略 | `apps/runtime/src/quality-gate.ts`、`orchestrator.ts` review loop、`project.qualityPolicy.*` | 已实现 required/optional/not_applicable/skipped；必需缺失=skipped 且 passed=false；project policy 存 `app_settings`，API 可取/设 | 中 | Legacy 第一批 | 必需脚本缺失不得 pass；可选缺失如实记录；不同项目可配置 | **待验证**（单元/策略测试通过，Scheduler E2E 待完整回归） | `tests/orchestration.test.ts`：“enforces a project-specific required/optional quality policy”“reports skipped, not passed” | 是（若未验证） |
| P0-04 | 人工/自动验收边界 | Human 可无 Artifact 直接完成；未区分人工/自动审计 | `packages/application/src/task-service.ts`、`completion-evidence.ts`、`RunsPage`/任务完成 UI | 验收 Artifact 增加 `acceptanceMode: human/automatic`、actor、requirements；Agent/System 严格走证据；人工保留可追溯记录；**缺失**高风险任务额外证据/更高权限确认 | 中 | Phase 2B | 人工与自动验收可区分；重复提交只有 1 条验收记录；Agent 不能走人工路径；历史记录不被覆盖 | **处理中**（关键路径已实现并测试，高风险策略待 Phase 2B） | `tests/agent-completion-tool.test.ts` human/agent 区分、重复提交测试 | 是（高风险策略未做） |
| P0-05 | 证据不足自动补证 | 证据不足只 pause，需人工补 | `apps/runtime/src/orchestrator.ts` review loop、`PlanExecution` evidenceRetries | 已实现有限自动补证（默认 1 次，记录 evidenceRetries/evidenceRetryForRun，补证 Run 记录）；无补证成功后完整 E2E | 中 | Legacy 第一批 | 缺失证据可自动补证有限次；补证后重新评估；超限 pause，不空 Artifact 绕过 | **处理中** | 代码路径 + 现有 reviewer/no-script 测试会触发补证；尚未断言补证成功后的完成 | 是（未完整验证） |
| P0-06 | Reconcile 后继续 | reconcile 只改 Run/Task，计划需手动 resume | `agent-runner.reconcileRun`、`dispatcher` `run.reconcile`、`RunsPage` | reconcile 后若计划 paused，dispatcher 自动 `scheduler.resume`（completed/retry）；failed 不自动继续 | 中 | Legacy 第二批 | 确认完成/重试后 Plan 同步、旧 Run 不重复、审计可查 | **处理中**（API/UI + 自动 resume 已有，缺集成测试） | `tests/agent-runner-guards.test.ts` 3 个 reconcile 单测；未覆盖 Plan resume E2E | 是（未 E2E） |
| P0-07 | Handoff 接收方失败安全重分配 | 目标 Runtime/Agent 不可用时只 block/fail，无合法替代 | `orchestrator.ts` start catch/handoff apply、`AgentAssignmentResolver` | **未实现**自动推荐/重新分配；仍记录 continuationError/block/fail | 高 | Phase 2B | 失败原因、候选替代、权限/可见性/能力/负载、Lease 释放、统一 Scheduler 启动、无合法者阻塞 | **未开始** | 无；现有测试只证明失败不假成功 | 是 |
| P0-08A | Plan Revision supersede | 新 revision 创建新任务，旧任务仍可调度 | `orchestration.revisePlan`、`TaskService` | 已实现旧 plan `superseded`、`supersededByPlanId`、未完成旧 Task `cancelled`（保留记录）；已完成旧成果保留，但不复用 | 中 | Legacy 第二批 | 旧任务不重复调度、历史保留、新旧不并发、复用规则明确 | **待验证**（单测通过） | `tests/teamwork-relay.test.ts` “supersedes old tasks on revision without deleting history” | 是（复用规则未完成） |
| P0-08B | 全局 per-Agent 并发 | 跨计划可同时调用同一 Agent | `read-models.countActiveRunsForAgent`、`orchestrator` activeAgentIds | 已用 SQLite 全局 active Run 计数限制每 Agent 1 个活跃 Run；跨进程共享 DB；无完整公平队列/饥饿测试 | 中 | Legacy 第二批 | 两个计划同 Agent 不并发；等待/取消/重启一致 | **待验证**（代码已接入，无跨计划 E2E） | 无专门跨计划测试 | 是（未验证） |
| P0-08C | Inbox 可靠队列 | delivered 失败只 warning；无 priority/backoff/终态 | `agent-runner.retryPendingInbox`、`agent_inbox.priority/next_attempt_at`（V18） | 已加 priority、next_attempt_at、最多 3 次、指数退避、24h 超时 failed；幂等键防重；Inbox retry 测试 | 中 | Legacy 第二批 | 重复投递不重复 Run；失败有退避和终态；重启可恢复 | **待验证**（基础重试测试通过；backoff/priority 未单独断言） | `tests/teamwork-relay.test.ts` “retries a delivered inbox exactly once” | 是（未完整验证） |
| P0-08D | Run/Plan 预算与超时 | 只有质量门禁/CLI 120s、步骤上限；无 plan/run wall-clock | `agent-runner` `MAX_AGENT_STEPS`、`PlanExecution` | **部分缺失**：已有步骤上限、CLI 120s、质量门禁 120s、项目软预算；无 Plan 最大时长/原生 Run wall-clock/工具次数硬预算 | 高 | Phase 2C | 硬限制达到时停止新动作并安全中断；不可猜 Token/费用 | **未开始** | 现有 `MAX_AGENT_STEPS`、CLI/quality timeout；无 Plan/Run wall-clock 测试 | 是 |
| P1-09 | UI 视觉与交互回归 | Phase 2A/2A.1 UI 改动未截图/交互验证 | `RunsPage.tsx`、`CollaborationPage.tsx`、`AgentWorkbenchPage.tsx` | 仅类型检查/构建；无 Electron 截图、DPI、状态检查 | 中 | Phase 2C | 实际 Electron 截图、正常/错误/空/等待、DPI/缩放、与主题一致 | **未开始** | 无截图/交互证据 | 是 |
| P1-10 | EXE 与源码一致性 | 打包产物可能落后，DB 迁移/Runtime 未包含 | `release/`、`scripts/package-smoke.mjs`、`pnpm test:package` | 未重新打包；未运行 package smoke；无源码/产物 hash/迁移对比 | 高 | Phase 2C | build/test:package/打包 Smoke/迁移测试通过；临时数据目录，不碰用户 DB | **未开始** | 无 | 是 |
| P0-11 | Agent 直接 done 独立测试 | 只有纯函数测试，缺 AgentRunner→ToolHandler→TaskService 链 | `tests/agent-completion-tool.test.ts` | 已新增 8 个真实调用链测试：无证据、写拒绝、类型不匹配、测试缺失、合法证据、Human/Agent、重复提交、取消任务；另有 Task Lease/多 Agent 既有测试 | 高 | Legacy 第一批 | 10 类场景中关键路径均有真实调用链证据 | **已验证关闭** | `tests/agent-completion-tool.test.ts` 8 tests PASS；`[done-gate]` 输出；`tests/agent-runner-guards.test.ts` lease 测试 | 否 |
| P0-12 | 结构化 Design/Review Artifact | 仅关键词匹配，不能证明真实审查 | `packages/contracts/entities.ts` `metadata`、`artifacts.metadata_json`（V17）、`completion-evidence.ts`、`tools/create_artifact` | 已加 Artifact metadata；design 要求 artifactType/scope/decisions/referencedFiles；review 要求 reviewedObjects/scope/findings/conclusion/blockers/关联变更；要求 runId 或 createdBy user；不再关键词判合格 | 高 | Legacy 第一批 | Artifact 存在、任务/来源可追溯、类型匹配、必需字段有效；旧 Artifact 可读但需人工 | **待验证**（新结构化路径测试通过；旧 artifact 兼容策略需确认） | `tests/teamwork-relay.test.ts` reviewer 结构化 Artifact；`tests/agent-completion-tool.test.ts` valid/wrong artifact | 是（旧数据兼容/人工复核待定） |

## 状态统计

- 已验证关闭：1（P0-11）
- 处理中：4（P0-04、P0-05、P0-06、P0-08 整体）
- 待验证：4（P0-03、P0-08A、P0-08B、P0-08C、P0-12 中的部分）
- 未开始：3（P0-02、P0-07、P0-08D、P1-09、P1-10 中的部分）
- 阻塞待验证：1（P0-01）

> 该统计按 12 个主项归类；P0-08 的 A/B/C/D 子项在矩阵中分别列出。**本轮不把未实测项标为关闭。**

## 进入 Phase 2B 前的判断

- **P0-11 已关闭**：Agent 直接 done 不再能绕过证据链。
- **P0-12 新产物路径已实现**：design/review 结构化 metadata 进入验收；旧 Artifact 需人工确认；Phase 2B Planner 必须输出该结构。
- **P0-03/P0-04/P0-05** 的关键路径已实现，需完整回归确认。
- **P0-01/P0-02/P0-07/P0-08D/P1-09/P1-10** 仍是正式发布的阻断项；其中 P0-02/P0-07/P0-08D 与 Phase 2B/2C 的可靠性和安全重新分配直接相关。
- Phase 2B 的 Provider-backed Planner 不能在上述可靠性问题未关闭时被描述为“生产可用”。
