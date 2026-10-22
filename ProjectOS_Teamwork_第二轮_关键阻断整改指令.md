# ProjectOS Agent Teamwork — 第二轮关键阻断整改指令（R1）

> 本文件基于 `ProjectOS_Agent_Teamwork_Legacy_Fixes_Report.md` 和 `Agent_Teamwork_Open_Issues.md`。只处理 R1 指定的问题。**实施真实代码修改与可复现测试，完成后停止。不得提前进入 Phase 2B AI Planner。**

## 0. 先读取真实代码与历史证据

1. 阅读上述两份报告，并核对其对应提交 `0e153b6` 是否实际存在于当前分支（若 squash/cherry-pick，以真实代码为准）。
2. 检查 Git 工作区、并发开发会话、现有 SQLite 迁移 V16–V18、Scheduler、Task Lease、AgentRun、Handoff、Inbox、Policy、RuntimeSupervisor 与现有 Electron 设计系统。
3. 不允许丢弃或覆盖别的会话的未提交修改；建立安全回滚点；测试只用临时项目、临时 SQLite 和临时用户目录。
4. 保留 P0-11 的 8 个已通过工具调用链测试、原有 DAG、Handoff、审批和真实 Artifact 门禁。不要重新造 Task/Registry/Orchestrator。

## 1. 本轮仅处理四个高优先级问题

### R1-A / P0-08B：跨计划、跨进程的全局 Agent 并发安全

报告中的 `countActiveRunsForAgent` 只是活跃计数，须审查「检查容量 → 占用名额 → 创建 Run/Session/Lease」是否具备原子性，不能假定计数可防竞态。

- 复用现有 SQLite 事务、唯一约束/容量令牌/租约等适用机制，确保同一个 Agent 在全局容量为 1 时，不会被两个计划、两个 Scheduler 或两个进程同时启动。
- 保留现有允许不同 Agent 并行的行为；同 Agent 超容量时等待而不是错误地使整计划失败。
- 有序排队、饥饿保护（至少明确定义优先顺序）、取消后释放、进程死亡后的失效与重试。
- **必测**：两个不同计划同时 ready，两个独立 Scheduler 竞争同 Agent；另外执行跨进程竞争；期望最大同时有效 Run ≤ 容量，所有适用任务最终完成或明确阻塞，不能重复启动。
- 不能仅凭串行调用 `tick()` 的单元测试宣称跨进程安全。

### R1-B / P0-02：真实进程 Kill/Restart 恢复

- 在隔离环境中真正启动 Electron/Runtime 子进程；执行中使用操作系统级终止手段退出该测试进程，再重新启动。
- 覆盖：Run 运行中；Handoff accepted→prepared；目标 Run 创建后但 `continuedAt` 未写入；Inbox 待投递；审批等待；已执行文件写入但未落完成状态。
- 重启后实际核验 SQLite 的 Task、Run、Handoff、Inbox、Lease 和工作区文件，不只断言函数返回。
- 已产生或可能产生副作用时使用 `needs_reconciliation`，不能自动重复写文件/重放危险命令。
- **必测**：至少一个真正的子进程 kill/restart E2E；其余状态窗口若使用故障注入，请注明与真实进程测试的区别。

### R1-C / P0-08D：Run/Plan 硬限制、超时和取消

- 加入真正可执行的 Run 墙钟超时、Plan 总执行时间上限、工具调用/执行步骤上限及重试次数上限；使用单调且可靠的时间计算方式，并考虑重启后的持久化预算。
- 预算在后端运行时检查，不仅靠 UI/Prompt；到限不得再启动新工具或新任务；必须处理正在运行的调用、释放资源并写审计。
- 为取消、超时和预算耗尽提供区分明确的终态/原因；与 Task Lease、Handoff、Reconcile、Inbox 兼容。
- Token 和费用若 Runtime 没有可信 usage，显示 `unknown`，**不得编造费用或以估算值作为已计费事实**；允许配置可验证的硬限制。
- **必测**：长时间无响应、步骤耗尽、工具调用上限、计划总超时、重启后剩余预算、一致取消；不能使用等待很久的真实模型来制造测试。

### R1-D / P0-07：Handoff 接收方启动失败后的安全替代

- 复用现有 `AgentAssignmentResolver`、项目可见性、Skills、Runtime 可用性、授权范围和 Task Lease。
- 当目标 Agent/Runtime 启动失败时，写入原始失败原因和 `continuationError`，从合法候选中计算替代建议。
- 用户显式指定 Agent 时，不得静默换人；如果替代会扩大权限、改变 Runtime 风险或无法判断先前执行副作用，必须先请求确认/核对。
- 对已经授权的低风险可替代任务，可按现有策略允许受控重新分配；保留来源 Handoff、旧 Run 与完整审计。
- 启动仍只能交给统一 Scheduler，禁止 Handoff/恢复逻辑自己单独 `startRun`；无候选时明确 `blocked`，不假成功。
- **必测**：有合法候选/无候选、显式指定、跨项目不可见、权限扩大、失败后原 Lease 未释放、重复 tick/重启不重复 Run。

## 2. 不能忽略但本轮不要求整改完的项目

- P0-01：外部 Harness 真实认证执行，以及每 Run 文件 diff 归属。
- P0-03/04/05/06/08A/08C/12：已有部分实现仍需完整 E2E、结构化证据兼容或高风险人工验收策略。
- P1-09：Electron UI 实机视觉回归。
- P1-10：重新打包最新源码、运行最新打包产物的 smoke 和数据库迁移校验。

**这些问题继续留在 `docs/Agent_Teamwork_Open_Issues.md`，不得静默关闭。下一轮优先处理 P1-10 和尚未闭环的测试。**

## 3. UI 设计约束（只有本轮确实修改 UI 时适用）

优先使用现有页面和共享组件，不新增 Teamwork 中心或重复业务页面；先审查真实主题 tokens 和现有 Glass 组件。任何新增或修改的弹窗、状态、交互，必须与当前 **Apple-inspired、浅色光学玻璃拟态、现代简约清新** 的 ProjectOS 主题一致，支持现有深浅主题。保证文字可读、状态清楚、缩放/DPI 适配；禁止原生控件拼凑、毛坯式半成品、旧版高饱和蓝紫霓虹、假数据和新增无关页面。修改后必须在真实 Electron 截图与交互验证；若不改 UI，说明无 UI 变更，不为美观制造页面。

## 4. 执行与测试纪律

- 每一项先说明根因和具体代码位置，再修复、测试、核对 SQLite 最终态。一个场景只通过 Mock/纯单测不能当成跨进程或真崩溃通过。
- 必跑适用的 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm test:teamwork` 和 V1.3/V1.4 隔离 E2E。已有 `test:package` 可以跑，但**旧打包产物的通过不能证明新源码已经发布**。
- 不降低测试断言、不预植假 Artifact 冒充真实执行，不清理用户数据，不跳过审批，不以无限 retry 修复可靠性。
- 安全高风险操作/真实生产连接须先征得用户确认；无需真实外部凭据的隔离测试应主动完成。

## 5. 验收与交付

生成 `ProjectOS_Teamwork_R1_Blockers_Report.md`，并更新 `docs/Agent_Teamwork_Open_Issues.md`。

报告必须列出：

1. R1-A/B/C/D 各自修改文件、关键事务边界/状态图和真实测试命令；
2. 两 Scheduler 与两进程并发测试，给出同时活跃 Run 峰值及数据库证据；
3. 实际 kill/restart 的操作步骤、进程 ID/日志、恢复前后 Task/Run/Handoff/Inbox/Lease/文件状态；
4. 超时/预算耗尽后的实际工具停止、状态迁移与资源释放；
5. Handoff 失败换人的候选评分、权限判断、用户确认条件及不重复执行证据；
6. Phase 1/2A/2A.1 与本轮回归测试结果，明确失败/跳过；
7. 最新的遗留问题矩阵，包括没有关闭的 P0-01、P1-09、P1-10 等；
8. 是否新增 UI，以及有 UI 时的真实 Electron 截图/交互测试结果。

每一项状态只能是 `已验证关闭`、`待验证`、`阻塞待验证` 等有证据的状态。**未做真实 Kill 测试不得关闭 P0-02；没有跨进程并发测试不得关闭 P0-08B；只写了超时常量而没有终止行为测试不得关闭 P0-08D。**

**现在开始真实整改这四项。完成并提供上述文件后立即停止，等待用户验收。禁止自行继续处理后续批次，也禁止进入 Phase 2B。**
