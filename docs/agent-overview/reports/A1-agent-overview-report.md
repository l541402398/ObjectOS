# A1 Agent 协作总览 — 验收报告

- **状态**：完成，待用户审查
- **阶段分支**：`v2.0-agent-overview`
- **基线**：`v2.0-org-a0` / `55f609ae469911a4e1a6ed64b4fc64acde084749`
- **生产页面**：`#/projects/:id/agents`（默认协作总览，`?view=pro` 保留原专业编排）
- **输入资料**：`ProjectOS_Agent_Overview_Visual_References/`（用户提供，已加入 `.gitignore`，不作为产品代码提交）

## 1. 对用户反馈的响应

首版按资料包中的视频帧做了固定三栏（Agent / 计划 / 成果），用户明确否定了“永远三栏”的方案，并要求“整页都是图，点击图上的 Agent 或其它对象再加载信息”。

本版因此**没有沿用三栏布局**，改为：

- 一个全宽、可缩放、可平移的协作画布；Agent、任务、审批、产物、交接都是画布上的真实节点/边。
- 顶栏只保留目标、模式切换与刷新；指标与筛选压在画布上方的一条工具带。
- 点击任意节点或“交接”边，从右侧加载该对象的真实详情（Agent 当前 Run、任务依赖、审批参数、Artifact 内容、Handoff 摘要）。
- 筛选（全部 / Agent / 任务 / 成果与审批）只改变画布中的节点，不切换到另一套页面。
- 1024 宽度下不切成三块面板，仍是同一张图；通过缩放、平移和筛选查看，详情仍从右侧抽屉打开。

设计取舍与参考来源见 `docs/agent-overview/reference-comparison.md`，视觉对照见
`docs/agent-overview/evidence/comparison-sheet.png`。

## 2. 数据与架构

新增只读投影 `CollaborationOverviewProjection`，不引入第二套调度器、不写库、不伪造进度：

| 界面对象 | 唯一数据来源 |
|---|---|
| Agent 节点 | `getAgentViews` + 活动 `Run` + 已持久化 `session`；`working` 只因存在活动 Run |
| 任务节点 | `listTaskCards`（含 `dependencyIds` / `blockedBy` / `assigneeAgentId`） |
| 审批节点 | `listApprovalViews`，只展示 `pending`；点击进入真实审批路由 |
| 成果节点 | `listArtifacts`，显示 `verifiedAt` / `contentHash` / `gitCommit`；缺失就显示“未核验/—” |
| 交接边 | `listHandoffViews`，只在 `fromAgentId → toAgentId` 均存在时绘制 |
| 底部活动 | `getProjectActivity`（真实 Run / Approval / Handoff 事件） |
| 计划信息 | `listPlanRevisions` 最新一版；`taskIds` 来自 `createdTaskIds` |

实现链路：

- `packages/contracts/src/entities.ts`：`CollaborationOverviewSchema`（含 `plan.taskIds`）。
- `packages/contracts/src/api.ts` / `desktop-api.ts`：`collaboration.overview`（`projectId` 输入）。
- `packages/application/src/collaboration-service.ts`：`overview()` 组合投影；`ACTIVE_RUN_STATUSES` 统一活动 Run 语义。
- `apps/runtime/src/dispatcher.ts`、`apps/desktop/src/preload/index.ts`：真实 IPC 方法。
- `apps/desktop/src/renderer/src/lib/queries.ts`：`useCollaborationOverview`，4s 轮询、后台不轮询；Runtime 事件触发失效。
- `features/collaboration-overview/CollaborationGraph.tsx`：React Flow 节点 + ELK 分层布局 + 同坐标系的真实关系边。
- `features/collaboration-overview/CollaborationOverview.tsx`：页面壳、筛选、指标、活动带、详情抽屉。
- `pages/AgentWorkbenchPage.tsx`：`[协作总览][专业编排]` 双向切换；打开会话仍进入现有专业编排，不覆盖 AppShell。

状态语义保持严格：

- `WAITING_APPROVAL` 只来自真实 Run/Approval；不会用计时器制造“正在运行”。
- `DONE` 的 Run 不等于任务通过，也不等于交付已验证；Artifact 默认显示“未核验”。
- Agent 之间只在存在真实 Handoff 行时连线；没有 Inbox/Handoff 就不画。
- 空项目明确显示“这张协作图还没有真实对象”，不填充演示数据。

## 3. 过程中修复的真实缺陷

### 3.1 Runtime 子进程 EPIPE 导致 Main 进程未捕获异常

快速重启 Electron 时，Runtime 已退出但 `RuntimeSupervisor` 仍向子进程 stdin 写入，Node 异步抛出 `EPIPE`，Main 进程弹出 “A JavaScript error occurred in the main process”。

修复（`apps/desktop/src/main/runtime-supervisor.ts`）：

- 为 `child.stdin` 增加 `error` 监听；非停止状态转为 `killChild('stdin error')`，由既有重启逻辑恢复。
- `request()` 写前检查 `destroyed/writable`，写回调返回错误时立即拒绝 pending 请求，而不是等到 30s 超时。
- 心跳与 `stop()` 的 shutdown 写入同样增加可写检查。
- 复测：同一数据目录重启后，Agent/任务/产物/审批全部从 SQLite 恢复，E2E 不再出现错误框。

### 3.2 React Flow 边层未渲染的兼容问题（已记录为限制）

本机 React Flow 12.12.0 下，自定义节点能渲染、24 个 Handle 在 DOM 中可见，但内部 `measured` 始终为空、`handleBounds` 未注册，导致 React Flow 自己的边层为空（Store 中 edge 存在，DOM 无子节点）。

- 本版保留 React Flow 负责节点、平移缩放、Controls 与选择；关系边改为在**同一画布坐标系**内由真实投影绘制的 SVG 层（`RelationshipLayer`），随 `viewport` 同步平移/缩放。
- 这不是静态装饰：每条线都由 `task.dependencyIds`、`artifact.taskId`、`approval.taskId`、`handoff` 行生成；无关系就没有线。
- 该兼容问题与替代方案已在本报告和代码注释中说明；后续升级 React Flow 或修复节点测量后，可切回原生 Edge。

## 4. 真实 Electron 验收

脚本：`scripts/agent-overview-e2e.mjs`（真实 Electron、真实 Runtime、隔离数据目录、本地 fake OpenAI-compatible provider，无真实凭据）。

夹具说明（重要）：

- 项目、计划、任务、依赖、Run、Approval、Handoff 均由真实产品 API 在真实 SQLite 中创建。
- 两条 Artifact 通过 `artifacts.create` 写入（作为投影夹具），因此显示“未核验”；它们不是 Agent 真实产出的交付证据。
- 一个 Run 命中真实 `run_command` 审批并停在 `waiting_approval`；另一个 Run 在截图期间保持真实 `running`。
- 审批只停在“待处理”，没有代替用户批准；Handoff 只停在 `requested`，没有代替接收方接受。

结果：**16 PASS / 0 FAIL / 0 SKIP**（`docs/agent-overview/evidence/electron-checks.json`）。

关键断言：

1. 投影同时存在 1 个待审批、2 个工作中 Agent、2 个 Artifact、1 条 Handoff。
2. 计划含 4 个真实任务，`plan.taskIds` 与创建的任务一致。
3. 画布渲染 5 个 Agent 节点、4 个任务节点、2 个成果节点、1 个审批节点，以及 9 条关系边。
4. 点击 Artifact 节点，抽屉显示真实正文、URI、Run/hash/Git 空缺（不伪造）。
5. 点击 Agent 节点，抽屉显示当前 Run、Run 状态、待审批数；可下钻到原专业编排并保留真实 Session。
6. 底部活动可进入真实 `/approvals` 或 `/runs` 路由。
7. 深色主题 token 生效；1024 仍是全画布且无横向溢出；图内筛选只显示 Agent 时任务节点为 0。
8. 125% 缩放真实生效且无溢出。
9. `prefers-reduced-motion` 下停止所有流动动画。
10. 关闭并重启 Electron 后，同一数据目录恢复 5 个 Agent、2 个 Artifact、2 个等待审批标记。

### 4.1 其它验证命令（实际输出）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | PASS（0 error） |
| `pnpm lint` | PASS（0 error / 29 个既有 warning；边界检查 PASS） |
| `pnpm vitest run tests/collaboration-overview.test.ts` | PASS（1 test） |
| `pnpm test` | 492 passed / 1 failed / 4 skipped；失败为既有 `tests/r1-budgets.test.ts` 计时断言，基线 `9e2f82a` 同样失败，未在本轮修改 |
| `pnpm build` | PASS |
| `pnpm package:dir` | PASS（win-unpacked） |
| `pnpm test:package` | PASS — 打包 EXE 创建项目、写 starter 文件、重启恢复 |

## 5. 截图证据

路径：`docs/agent-overview/evidence/screenshots/`

| 文件 | 内容 |
|---|---|
| `overview-1440-light.png` | 1440×900 全画布，亮色，真实待审批/运行中/产物/交接 |
| `overview-1440-dark.png` | 1440×900 深色 |
| `overview-1440-light-125.png` | 125% 缩放 |
| `overview-1024-all.png` | 1024×768 全图（不是三栏） |
| `overview-1024-agents.png` | 1024 图内筛选仅 Agent |
| `overview-1024-tasks.png` | 1024 图内筛选仅任务 |
| `artifact-inspector-1440-light.png` | 点击成果节点后的真实详情抽屉 |
| `agent-inspector-1440-light.png` | 点击 Agent 节点后的真实运行详情与下钻按钮 |
| `overview-1440-restart-light.png` | Runtime 重启后状态恢复 |
| `comparison-sheet.png` | Lancer 7.5s / ProjectOS / Eigent / Dify 四方对照 |

## 6. 与参考的逐项对照

| 参考 | 采用 | 未采用 / 原因 |
|---|---|---|
| Lancer 7.5s：左 Agent、中协调/计划、右成果、底部活动 | 保留“Agent→任务→成果”的阅读顺序和底部真实活动带 | 不保留固定三栏面板；用户已明确否定 |
| Eigent：单 Agent 运行卡、Progress/Execution Context、Run 级产物 | Agent 节点显示当前任务/Run/审批；详情抽屉显示 Run 审计与 Artifact 列表 | 不复制其品牌、图标、文案；只参考信息层级 |
| Angy：头像堆叠、运行中数量、实时图 | 头像 + 状态 pill + 真实关系边；图内筛选 | 不使用其 Logo/插画；不复制代码 |
| Dify：右侧执行追踪、节点耗时/状态 | 审批与运行详情、Run 状态、审批参数 | Dify 为自定义许可，只做图形/交互参考，未复制代码或资产 |

详细来源、许可证与限制见 `docs/agent-overview/reference-comparison.md`。

## 7. 已知限制与未验证项

1. **React Flow 原生边未使用**：如 3.2 所述，节点测量缺陷导致原生边层为空，当前使用同坐标系 SVG 关系层；节点、缩放、选择仍是 React Flow。此替代方案未在其它 React Flow 页面推广。
2. **1024 下画布缩放后文字视觉尺寸小于 12px**：CSS 字号未缩小，但 fit 缩放会整体缩小；用户可用缩放/平移或筛选查看。未把 1024 做成另一套列表布局，因为用户明确要求保持图。
3. **夹具不是完整交付链**：审批未批准、Handoff 未接受、Artifact 未核验、没有真实模型调用；因此不能据此声称“Agent 全链路交付验收通过”。
4. **未做全量 axe 审计**：已做键盘可达、aria 标签、状态文本、对比度 token 检查；axe 全量扫描未纳入本轮。
5. **Motion 只用于刷新提示与抽屉过渡**：画布关系边为 SVG/CSS，不使用 Motion 驱动布局，以避免每帧重建图。
6. **全量测试有 1 个既有失败**：`tests/r1-budgets.test.ts` 在完整并行负载下的计时断言；单独运行通过，基线 `9e2f82a` 也失败。该失败与本次 UI/投影无关，但仍是未收口项。

## 8. 复现命令

```bash
pnpm typecheck
pnpm eslint apps/desktop/src/renderer/src/features/collaboration-overview scripts/agent-overview-e2e.mjs
pnpm vitest run tests/collaboration-overview.test.ts
pnpm build:runtime
pnpm build:desktop
node scripts/agent-overview-e2e.mjs
```

E2E 输出末尾应看到 `PASS=16 FAIL=0`，证据写入
`docs/agent-overview/evidence/electron-checks.json`。
