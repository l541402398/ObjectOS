# ProjectOS Teamwork — R2 验收报告

> 基线：R1 提交 `5afd7a0`（`feat(teamwork): R1 atomic agent capacity, hard budgets and safe handoff fallback`）。
> 本轮 R2 改动位于工作区（未提交），便于验收审阅；R1 回滚点仍为 `5afd7a0`。
> 范围：不新增业务模块、不实施 Provider-backed Planner；目标是把已完成的 Teamwork 在真实 Electron 中形成可操作、可恢复、可验证的闭环。
> 环境：Windows 10 x64 / Node 24 / Electron 43.8.2 / `node:sqlite` WAL / OpenCode CLI +DeepSeek（真实 Harness）。
> 密钥说明：真实 Harness 的 API Key 仅通过进程环境变量注入，**未写入代码、SQLite、项目文件、日志或本报告**。

---

## 0. 结论总览

| ID | R2 状态 | 核心证据 |
|---|---|---|
| P0-01 外部 Runtime / 每 Run 文件归属 | **已验证关闭**（OpenCode + DeepSeek；其他 Harness 未测） | 真实推理写入 `real-run-a.txt`；V21 归属只记录该文件，预先存在的 dirty 文件被排除；失败/取消/审批均真实执行 |
| P0-02 进程 Kill/Restart | **已验证关闭**（R1 复验） | Runtime PID 10716 被 OS 强杀，重启 PID 24328，25 项断言通过 |
| P0-03 项目级 QualityGate | **已验证关闭** | 缺必需脚本→计划 paused、artifact `verifiedAt=null`；有脚本→task done |
| P0-04 人工/自动边界 | 处理中 | 高风险任务额外证据/更高权限策略仍未实现 |
| P0-05 自动补证 | **已验证关闭** | 首个 Run 无证据→第 2 个补证 Run 带真实 Artifact→task done，`evidenceRetries=1` |
| P0-06 Reconcile→Plan 恢复 | **已验证关闭** | reconcile retry 后计划自动恢复并只启动 1 个新 Run；修复了人工重试被自动上限误判的缺陷 |
| P0-07 Handoff 安全替代 | **已验证关闭** | 低风险自动替代、无候选 blocked、显式指定暂停待确认、权限/Runtime 风险升级需确认 |
| P0-08A Revision supersede / 复用规则 | **已验证关闭** | 旧计划 superseded、未完成旧任务 cancelled、已完成保留；新计划记录 `reuseFromTaskId/reuseArtifactIds`，旧任务不重复 Run |
| P0-08B 全局并发 | **已验证关闭** | 双进程 `peakRuns=1 peakSlots=1 overlaps=0`；跨计划取消后排队任务接续完成 |
| P0-08C Inbox 队列 | **已验证关闭** | 优先级顺序 `task.delegate→agent.wake→agent.message`、10s 退避、3 次上限、24h 过期、重启恢复 |
| P0-08D Run/Plan 预算 | **已验证关闭** | 墙钟/步骤/工具/计划超时终止，重启保留剩余预算 |
| P0-11 Agent 直接 done | 已验证关闭（R1 保持） | 既有 8 tests 通过 |
| P0-12 旧结构化 Artifact | **已验证关闭** | 无 metadata 的旧设计 Artifact 不能自动完成；人工复核 done 且 `acceptanceMode=human` |
| P1-09 Electron UI 视觉回归 | 部分验证 | 新替代确认面板浅/深色、125% 缩放、侧栏折叠、确认/取消截图与交互通过；全站页面未逐一回归 |
| P1-10 打包与源码一致性 | **已验证关闭** | 重新 `package:dir`、`test:package` PASS、V18→V21 迁移保留数据、包内 R1/R2 功能 10 项核对 PASS |

---

## 1. Phase 1：保护并复核 R1

- **安全保存**：R1 全部代码、测试、脚本、ADR、报告已提交为 `5afd7a0`（此前 `git stash create` 的标签不含未跟踪文件，故改为真实提交）。
- **迁移复核**：新测试 `tests/r2-phase1.test.ts` 构造真实 V18 数据库（实际执行迁移 1–18 并写入 checksum），再用当前 `SqliteStore` 升级：
  - `schema_migrations` 最大版本 = 21；
  - `agent_execution_slots`、`run_file_changes` 表存在；
  - `agent_runs.deadline_at/budget_json` 存在；
  - 旧 project（version=7）与原字段完整保留。
- **补充验证**（此前缺口）：
  - **Runtime 风险升级**：ACP 接收方失败、CLI 候选排序第一 → `reasons=["替代 Runtime 风险更高（ACP ... → CLI ...）"]`，必须确认；
  - **执行槽 fencing**：Run 的工具副作用前校验 token；槽被 `run_thief` 抢占后，原 Run 在创建 ToolCall 之前失败，Artifact=0，抢占槽仍归 thief；
  - **跨计划取消**：计划 A 取消后释放槽，计划 B 排队任务无需重启计划即启动完成；峰值仍为 1。
- 命令：`pnpm vitest run tests/r2-phase1.test.ts` → **4 tests PASS**。

---

## 2. Phase 2：关闭“有代码但测试不足”的六项

### P0-03 项目级 QualityGate（Scheduler E2E）

- 项目 A：仅 `lint` 脚本，策略 `required=['test'], optional=['lint']` → 计划 `paused`，task `review`，测试报告 Artifact `verifiedAt=null` 且正文包含“缺失必需检查/skipped”。
- 项目 B：存在 `test` 脚本，同策略 → 质量门禁 `passed`，task `done`，报告 `verifiedAt` 非空。
- 命令：`pnpm vitest run tests/r2-quality-evidence-reconcile.test.ts -t "quality"`。

### P0-05 补证成功 → 重新验收

- Run 1 仅文本完成、无代码证据 → 完成依据不足；
- Scheduler 启动第 2 个“补证任务”Run；
- 补证 Run 创建真实 `code` Artifact → 重新评估通过 → task `done`，计划 `completed`；
- 数据库：2 个 Run 均 `completed`，`evidenceRetries[task]=1`，code Artifact 属于第 2 个 Run。

### P0-06 Reconcile → Plan 自动恢复

- 通过真实 `RuntimeDispatcher` 启动计划；Run 运行中被置为 `needs_reconciliation`，计划 `paused`；
- 调用 `run.reconcile(decision=retry)` → 计划自动 `resume`，Scheduler 启动恰好 1 个新 Run；
- 最终：旧 Run `failed`、新 Run `completed`、task `done`、计划 `completed`。
- **顺带修复真实缺陷**：人工 reconcile retry 后任务为 `ready`，原逻辑仍按“自动重试次数已用尽”把计划判失败；现仅当任务为 `blocked` 时才消耗自动重试预算。

### P0-08A Revision supersede 与复用规则

- 旧计划 r1 中 A 已完成（人工验收 Artifact）、B 未完成；
- `revisePlan` 后：r1 `superseded` + `supersededByPlanId`；A 保持 `done`；B `cancelled`；
- 新 r2 节点 A 记录 `reuseFromTaskId=A.id`、`reuseArtifactIds=[验收 Artifact]`，B 无复用；
- 批准 r2 后旧 A 没有新增 Run（旧任务不重复执行）。
- 规则即为：**完成成果保留并显式引用，但不自动冒充新任务的执行证据**。

### P0-08C Inbox 优先级 / 退避 / 上限 / 重启

- 同一接收方三条消息，`listDeliverableInbox` 顺序严格为 `task.delegate`（1）→ `agent.wake`（2）→ `agent.message`（3）；
- 会话归档导致投递失败：attempts 1→2，`next_attempt_at-now≈10000ms`（5000×2¹）；
- 再次失败：attempts=3、状态 `failed`（达到上限）；
- 24h 前的待投递消息 → `failed`（超时终态）；
- 新建 AgentRunner（模拟重启）恢复投递 → inbox `completed`，且只产生 1 个 Run。

### P0-12 旧结构化 Artifact 兼容与人工复核

- Agent 创建无 metadata 的旧式 `design` Artifact：自动验收拒绝，计划 `paused`，task `review`，旧 Artifact 仍可读；
- 用户人工 `done`：task 完成，生成验收 Artifact，`metadata.acceptanceMode='human'`、`actorKind='user'`；
- 恢复计划后计划 `completed`。

---

## 3. Phase 3：替代确认 UI 闭环（现有编排页面）

### 3.1 实现位置

- `apps/desktop/src/renderer/src/features/orchestration/pages/OrchestrationWorkspace.tsx`
  - 在现有任务节点抽屉内新增“交接替代待确认”面板，无新页面；
  - 展示：原接收方失败原因、原 Agent/Runtime、Runtime 变化、候选 Agent（评分/能力/新增权限/Runtime 风险）、需人工确认原因、任务实际状态；
  - 操作：选择候选 → `确认替代`（`orchestration.reassign`）或 `取消替代`（`orchestration.declineReassign`）；确认后刷新 graph/plans/collaboration/task/board。
- `orchestration.css`：复用现有 glass 变量与组件风格，新增 `.po-reassign*` 样式；全部字号使用设计 tokens（`--text-micro` 等），浅色主题单独覆盖。
- 后端补充：
  - Handoff payload 增加 `originalAgent`、`runtimeChange`、候选 `capabilities/addedCapabilities/runtime/raisesRuntimeRisk`；
  - 新增 `orchestration.declineReassign`（contracts API、dispatcher、preload、desktop-api）；
  - 取消后任务保持 `blocked`、计划保持 `paused` 并写明原因，不假成功。

### 3.2 Electron 实机验证

命令：`node scripts/r2-reassign-ui-e2e.mjs`（隔离 `PROJECTOS_DATA_DIR` 与 `--user-data-dir`，真实 Electron 窗口 1440×900）

**12 项检查 PASS**：

1. 既有编排抽屉中出现替代确认面板；
2. 显示原失败原因（`Agent 当前状态为 disabled，不能启动新的运行`）；
3. 列出合法候选（Iris 等，共 3 个）；
4. 展示“无权限扩大/权限扩大”；
5. 提供“确认替代/取消替代”；
6. 深色主题面板可用；
7. 125% 缩放时面板仍完整位于窗口内（bbox `578×519`，窗口 `1440×900`）；
8. 侧栏折叠时面板可用；
9. 候选卡片渲染；
10. 确认后由统一 Scheduler 实际执行替代 Agent（计划 `completed`、task `done`）；
11. 取消后 task `blocked`、计划 `paused`；
12. 无 Renderer 页面错误。

截图（`test-results/r2/`）：

- [reassign-light.png](test-results/r2/reassign-light.png)
- [reassign-dark.png](test-results/r2/reassign-dark.png)
- [reassign-zoom-125.png](test-results/r2/reassign-zoom-125.png)
- [reassign-sidebar-collapsed.png](test-results/r2/reassign-sidebar-collapsed.png)
- [reassign-confirmed.png](test-results/r2/reassign-confirmed.png)
- [reassign-declined.png](test-results/r2/reassign-declined.png)

> 说明：截图由真实 Electron 窗口生成，并有 DOM 文本/可见性/边界框断言；当前执行模型为纯文本模型，未做人工“肉眼审美”复核，故 P1-09 仅记为“部分验证”。

### 3.3 V1.3 E2E 旧选择器修复（未删断言）

真实原因与修复：

1. `.po-inspector-identity` 在 V1.7 后位于节点抽屉内且被 CSS 有意隐藏 → 改为等待 `.po-orch-drawer-panel`，并断言抽屉标题包含被点击任务标题；
2. Agent 卡片也包含当前任务标题，`.first()` 选中了 Agent → 改为选中任务节点（`.last()`）；
3. 抽屉遮罩阻止后续侧栏点击 → 断言后按 `Escape` 关闭；
4. 设置页玻璃头部覆盖“新增连接” → 真实 DOM click 触发，并继续断言 `.po-ai-editor` 打开（功能存在）；
5. 重启后不再有 `.po-project-card` → 等待真实 `#po-main`；
6. 新版修订语义：批准计划被新 draft 取代 → 断言 `superseded + supersededByPlanId` 且 r2 draft 存在（比旧断言更强）。

结果：`node scripts/v13-e2e.mjs` **PASS**（10 nodes / 12 edges；r1 superseded）。

---

## 4. Phase 4：真实 Harness 与打包验收

### 4.1 每 Run 文件变更归属（V21）

- 迁移 **V21**：`run_file_changes(run_id, path, change_type, baseline_hash, after_hash, created_at)`。
- `packages/workspace` 新增内容指纹快照/差分；`AgentRunner.executeViaRuntime` 在外部进程启动前记录基线，结束后差分写库并追加 RunStep“文件变更归属”。
- 真实 CLI Runtime 测试：预先写入未提交 `dirty.txt`；Run 写入 `generated/a.txt`、`generated/b.txt`。
  - `RunDetail.fileChanges = ['generated/a.txt','generated/b.txt']`（均为 added）；
  - `dirty.txt` 未被归属；`.git/` 未进入；
  - `run_file_changes` 仅 2 行；RunStep count=2。

### 4.2 真实 Harness（OpenCode CLI + DeepSeek）

已授权凭据经环境变量注入。隔离项目/临时 SQLite/临时数据目录；真实 Electron 之外的 Runtime 子进程执行。

命令：`DEEPSEEK_API_KEY=*** pnpm vitest run tests/r2-real-harness.test.ts`

**3 tests PASS**：

| 场景 | 实测 |
|---|---|
| 真实推理 + 文件修改 + 归属 + 审批 | Run `run_01m5fmj8t2c9tmat93sf31y5h5` → `completed`；真实写入 `real-run-a.txt`（含 `REAL-A-OK`）；归属仅该文件，dirty 排除；ToolCall=1 |
| 真实取消 | Run `run_01m5fmkgzt6wzm7e6eds34qcbj` → `cancelled`；子进程被终止；Agent 槽释放 |
| 真实失败 | Run `run_01m5fmkhpf5fgjcf5ww5pb6vqw` → `failed`；错误为 OpenCode `UnknownError`（无效模型）；未产生 `fake-success.txt` |

**修复的真实产品缺陷**：`RuntimeExecutionService` 原先把 stdin 作为打开的管道交给 CLI，OpenCode `run` 会等待 stdin EOF 直至 120s 超时；现改为 `stdio: ['ignore','pipe','pipe']`，真实 Harness 才能正常结束。该缺陷只有真实 Harness 测试才能发现。

### 4.3 打包（不覆盖用户安装包/数据库）

- `pnpm build` + `pnpm package:dir` 生成全新 `release/win-unpacked`（旧 unpacked 为仓库构建产物，已替换；已有 `release/*.exe` 安装包未删除）。
- `pnpm test:package`：**PASS**（打包 EXE 创建项目、写 starter、重启恢复）。
- `node scripts/r2-package-features.mjs`：**10/10 PASS**
  - Runtime：`agent_execution_slots`、`deadline_at`、`budget_json`、`run_file_changes`、`run.reconcile`、`orchestration.reassign`、`orchestration.declineReassign`；
  - Renderer：`reassign-panel`、reassign API、`po-reassign` 样式。
- `node scripts/r2-package-migration.mjs`：**PASS**
  - 用真实迁移 1–18 构建 V18 数据库（含 legacy project 与 app setting）；
  - 打包 EXE 以隔离 `PROJECTOS_DATA_DIR` 启动；
  - 迁移后版本 **19,20,21**；legacy project/name/version、marker 保留；`agent_execution_slots`、`run_file_changes` 存在；打包渲染层 `reassign/declineReassign/reconcile` 均为 function。
- 用户真实 `~/.projectos` 与已安装应用未被读取/修改；所有迁移与 smoke 均使用临时目录。

### 4.4 真实 Harness 覆盖范围（未夸大为全部）

- 已验证：**OpenCode CLI + DeepSeek**（真实模型推理、文件写、失败、取消、审批、归属）。
- 未验证：Claude Code、Codex、DSH 等其它 Harness；不将 OpenCode 结果外推为“所有 Harness 已通过”。

---

## 5. 最终测试结果

| 命令 | 结果 |
|---|---|
| `pnpm lint` | **PASS**（0 error / 0 warning；边界检查通过） |
| `pnpm typecheck` | **PASS** |
| `pnpm test` | **40 files / 201 passed / 3 skipped**（真实 Harness 无密钥时跳过；有密钥单独跑 3 passed） |
| `pnpm build` | **PASS** |
| `pnpm package:dir` | **PASS** |
| `pnpm test:package` | **PASS** |
| `node scripts/r2-package-features.mjs` | **PASS 10/10** |
| `node scripts/r2-package-migration.mjs` | **PASS（V18→V21）** |
| `node scripts/v18-teamwork-e2e.mjs` | **PASS 7 checks** |
| `node scripts/v13-e2e.mjs` | **PASS** |
| `node scripts/v14-e2e.mjs` | **PASS** |
| `node scripts/r2-reassign-ui-e2e.mjs` | **PASS 12 checks + 6 张截图** |
| `node scripts/r1a-cross-process.mjs` | **PASS**（peakRuns=1 peakSlots=1 runs=2 overlaps=0 openSlots=0） |
| `node scripts/r1b-kill-restart-e2e.mjs` | **PASS 25 checks**（PID 10716 → 24328） |
| `DEEPSEEK_API_KEY=*** pnpm vitest run tests/r2-real-harness.test.ts` | **PASS 3 tests** |

### 本轮发现并修复的问题

1. 人工 reconcile retry 被自动重试上限误判为计划失败（真实产品缺陷）。
2. CLI Harness stdin 保持打开导致 OpenCode 等待 EOF 超时（真实产品缺陷）。
3. 替代确认在未手动点候选时按钮取不到 Agent（UI 缺陷）。
4. V1.3 E2E 5 处旧布局/旧语义选择器（抽屉、节点顺序、遮罩、设置头部、项目卡片、supersede）。
5. CSS 小于 12px 的字号违反设计 token 规则。
6. 迁移测试未更新到 V21。

---

## 6. 遗留与风险

| 项目 | 状态 | 说明 |
|---|---|---|
| P0-04 高风险人工验收策略 | **处理中** | 高风险任务额外证据/更高权限确认仍未实现（Phase 2B 决策） |
| P1-09 全站 UI 视觉回归 | **部分验证** | 新替代确认 UI 已实机截图/交互/缩放/侧栏/深浅色；其余页面未逐一回归；另发现设置页玻璃头部遮挡“新增连接”命中区域（E2E 用真实 DOM click 绕过，需 UI 修复） |
| 其它外部 Harness | 未验证 | Claude Code/Codex/DSH 未使用凭据验证；P0-01 结论仅覆盖 OpenCode+DeepSeek |
| 预算/并发/恢复 | 已验证 | 但未做数小时级长跑与真实多进程多计划压力测试 |
| 费用 | 未估算 | 只有 Provider 返回 usage 才记录；不使用估算值冒充计费 |

**本轮停止，等待验收。未实施 Provider-backed Planner，未进入 Phase 2B。**
