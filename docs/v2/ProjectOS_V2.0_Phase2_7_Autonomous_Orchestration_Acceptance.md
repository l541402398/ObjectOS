# ProjectOS V2.0 Phase 2.7 — 事件驱动自主编排与端到端自动恢复（验收报告）

**分支**：`v2.0-phase2.7`（恢复点 tag `phase2.7-base` = `478ed9f`）
**代码 HEAD**：`8a70d6f`（本报告提交后另有 docs 提交，工作树 clean）
**日期**：2026-10-28（America/Los_Angeles）
**前提**：Phase 2.5 部署闭环、Phase 2.6 Action Center **全部保留**，未回退任何一项。

---

## 1. 本轮实现的链路

```
业务事件 (store.appendEvent)
   └─ hub.onCommitted
        └─ dispatcher.onProjectEvent
             └─ AutonomyCoordinator.enqueue            ← 唯一索引去重（幂等）
                  └─ 250ms 合并 + 单飞（每项目一次）
                       └─ pass():
                            1. 重算门禁并只推进「门禁已通过」的阶段
                            2. scheduler.nudgeProject() 推动现有 OrchestrationScheduler
                            3. 汇总仍需要人的事项（交给 Action Center）
                       └─ 结果写回 autonomy_events（processed / attempts / detail）
```

**没有第二套调度器**：`pass()` 只调用既有的 `LifecycleService.transitionVersion` 与
`OrchestrationScheduler.nudgeProject`（内部仍是 `arm()` + `tick()`）。

### 1.1 事件分类（真实接入点）

| 事件前缀 | 归类 | 触发后果 |
|---|---|---|
| `run.*` | run.settled | 重评门禁、推动调度 |
| `approval.*` | approval.settled | 同上 |
| `task.*` | task.settled | 同上 |
| `artifact.*` / `evidence.*` | evidence.settled | 补证后重评门禁 |
| `gate.*` | gate.settled | 同上 |
| `version.*` / `iteration.*` | version.settled | 同上 |
| `deployment.*` / `release.*` / `changeRequest.*` | delivery.settled | 同上 |
| `handoff.*` | handoff.settled | 同上 |
| 其它（`runtime.log`、`ai.*` 等） | — | **不入队**，避免噪声触发 |

### 1.2 幂等 / 去重 / 并发 / 崩溃恢复

- **幂等**：`autonomy_events(source_event_id, kind)` 唯一索引，重复事件 `INSERT OR IGNORE` 直接丢弃（实测返回 `false`）。
- **去重**：同一项目 250ms 内的多个事件合并为一次 pass，并带 `event.coalesced` 二次消费队列。
- **并发**：进程内 per-project `inFlight` 单飞；`dispose()` 清理未触发的定时器。
- **崩溃恢复**：`recoverOrchestrations()` → `autonomy.replay()` 重放 `status='pending'` 的行；调度器本身 `recover()` 仍会重新 `arm()` 所有 `running` 计划。**不依赖内存事件。**
- **熔断**：`attempts` 上限 3，毒事件不会无限循环；`autonomy_events` 保留最近 2000 行。

### 1.3 部署未知结果自动对账（P0-4）

`Main` 进程新增**只读**对账扫描（每 60s + 启动时一次）：

1. `deployment.pending_reconciliation` 取 `needs_reconciliation|unknown` 的部署；
2. `attempts >= 3` 的跳过（避免循环）；
3. 仅对 `ssh-artifact` 且**凭据可用**的目标执行；
4. `observeSshDeployment` 只读探测（release 目录 / `docker inspect` 挂载 / `/health`）；
5. 探测可达才写回 `deployment.reconcile`；
6. **全程不重放部署**，探测不到就留在 Action Center 交给人。

### 1.4 Action Center 排序修正（真实缺陷）

实测发现：`version_gate` 条目的 `createdAt` 用的是 `Date.now()`，导致每次读取都排在最前，
把「Run 正在等待授权」挤到后面。已改为按**谁真的被卡住**排序：

`tool_approval(0) → task_acceptance(1) → delivery_approval(2) → deployment_reconciliation(3) → run_failure(4) → version_gate(5)`，同级别再按时间倒序。

---

## 2. 真实 AI Provider 端到端（本轮最关键证据）

脚本：`scripts/phase2.7-real-provider-e2e.mjs`
**Provider**：本机已配置的 DeepSeek（`baseUrl=https://api.deepseek.com/v1`、`model=deepseek-flash`、`hasKey=true`），
通过 safeStorage 加密存储，测试时复用同一 Windows 用户的凭据并交由**应用自身的** legacy→connection 迁移安装进 Runtime。
**未使用任何 FakeProvider / 脚本化 SSE 服务器。**

**结果：13 PASS / 0 FAIL / 0 BLOCKED。**

| 验收点 | 证据 |
|---|---|
| 真实 Provider 可用 | `configured:true, hasKey:true, model:deepseek-flash` |
| 真实模型被调度执行 | `run_01m60qmf0q…` 启动 |
| **真实模型请求工具授权 → Run 暂停** | `waiting_approval`，真实审批 `apr_01m60qmgrtr…` |
| **铃铛直达该审批** | `#/projects/<id>/approvals?approval=apr_01m60qmgrtr24d4v043ddbsnk1` |
| 审批页显示真实 Diff | 命中 2 个 Diff/审批容器 |
| 用户真实 UI 批准 | 点击批准按钮 |
| **同一 Run 自动恢复并完成** | `status=completed`，`error=` 空 |
| **真实写入文件** | `…/demo/aurora-notes/phase27-real-agent.md` 实际存在 |
| 写入内容正确 | `# Phase 2.7 real agent …` |
| 授权完成后待办自动消失 | `remaining=0` |
| 未产生伪完成 | run 状态来自真实完成 |

> 关键点：批准后**没有回到 Agent 聊天界面输入"继续"**，Run 自行继续并落盘。

截图：`docs/screenshots/p27-01-bell-real-approval.png`、`p27-02-real-approval-diff.png`、`p27-03-after-auto-resume.png`。

---

## 3. 单元 / 集成验证

| 项目 | 结果 |
|---|---|
| `pnpm typecheck` | **PASS** |
| `pnpm lint`（含边界检查） | **PASS**，0 errors / 15 warnings（均既有），`Dependency boundaries OK` |
| `pnpm test` | **PASS**，**300 passed / 4 skipped**（59 文件：57 passed / 2 skipped） |
| `pnpm build` | **PASS** |
| 新增 `tests/p27-autonomy-coordinator.test.ts` | **6/6 PASS** |
| V24 → **V34**、V18 → V34 迁移 | **PASS** |

`p27-autonomy-coordinator.test.ts` 覆盖：
1. 只有业务事件被归类为协调触发（`runtime.log`/`ai.*` 不入队）；
2. 同一 `source_event_id` 重复入队返回 `false`，库中仅 1 行（**幂等**）；
3. 崩溃后 `pending` 行被重放为 `processed` 且 `attempts=1`（**持久化恢复**）；
4. 门禁通过则推进、未通过则不推进（二者互斥）；
5. **assist 模式零推进零调度**；
6. 协调历史可查询（诊断）。

---

## 4. 哪些自动、哪些必须人工（本轮实测边界）

| 动作 | 归属 | 依据 |
|---|---|---|
| 事件驱动的门禁重评 + 合规阶段推进 | **自动** | coordinator pass，`transitionVersion` 仍强制门禁 |
| 推动执行中的计划继续调度 | **自动** | `scheduler.nudgeProject` → 既有 tick |
| 未知部署的只读对账 | **自动** | Main 扫描 + `observeSshDeployment`，失败即停 |
| 工具授权（write_file 等） | **必须人工** | 真实模型暂停，等人批准（本轮实测） |
| 生产部署 / 凭据变更 | **必须人工 + 独立授权** | 未改动审批与授权链路 |
| 拒绝授权后的替代方案 | **由既有规划能力处理**；无法继续则明确报错 | 未自动伪造通过 |
| 门禁不满足 | **不绕过** | 只在 gate passed 时推进 |

---

## 5. 未完成 / BLOCKED（不隐藏）

1. **完整"目标 → 规划 → 多 Agent 分工 → 证据 → 推进"的真实模型端到端**未一次性跑通。
   本轮真实 Provider 只证明到「单 Run 的工具授权暂停→批准→自动恢复→真实落盘」。
   多 Agent 全链路 E2E 仍依赖既有假 Provider 编排用例（`v13-orchestration`/`teamwork`），
   这部分**不能**算作真实 AI 自主执行的证据。
2. **自动对账扫描**只做了代码实现 + 类型/单测级验证，本轮**没有**真实制造一个
   `needs_reconciliation` 的 SSH 部署来观察它自动收敛。
3. **"一个任务等待人工时其他无依赖任务继续"** 依赖既有 `tests/r1-concurrency.test.ts`
   覆盖，本轮未用真实模型复测。
4. **Action Center 富字段**（"AI 正在做什么"、"不处理会影响哪些任务"）本轮**未实现**，
   条目仍提供：项目/版本/Run/任务/部署 ID、原因、需要用户做的决定、处理后恢复什么、风险、精确路由。
5. **managed 模式的范围白名单**仍无编辑 UI（模式可存取、重启保持）。
6. **铃铛区分"需行动"与"普通消息"**：徽标只统计需行动条目、普通通知走通知页，
   但未做统一的已读/分组视图。
7. Phase 2.5 遗留「重启后控制台右栏当前可信运行版本显示为空」仍在。
8. 125% 缩放矩阵与 `pnpm package:dir` 打包冒烟本轮未重跑（Phase 2.5 已 PASS）。

---

## 6. 结论

- **事件驱动自主推进已落地**：接入 8 类业务事件，幂等去重、单飞合并、持久化重放、熔断上限，复用既有 Scheduler 与 Lifecycle，无第二套调度系统。
- **真实 AI 自主执行已证明一段关键闭环**：真实 DeepSeek 模型请求授权 → Run 暂停 → 铃铛精准深链 → 用户批准 → **同一 Run 自动恢复并真实写盘**。
- **可自行解决的异常改为自动处理**：未知部署用只读探测自动对账，不重放、不猜。
- 排序缺陷（门禁条目抢占首位）已按"谁被卡住"修正。
- 300 项单测、0 lint error、类型检查与构建全部通过；Phase 2.5/2.6 成果保留。

**未达成**：一次真实模型驱动、跨多 Agent 的完整"目标→规划→执行→补证→推进"端到端，
以及自动对账的现场实证。这两项如实记为未完成，不以既有假 Provider 用例充数。

**Phase 2.7 到此停止，不进入 Phase 3。**
