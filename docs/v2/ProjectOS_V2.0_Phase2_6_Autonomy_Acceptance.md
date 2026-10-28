# ProjectOS V2.0 — Phase 2.6 验收报告：AI 自主推进与跨模块体验修正

**分支**：`v2.0-phase2.6`（恢复点 tag `phase2.6-base` = `1d5c7ad`）
**日期**：2026-10-28（America/Los_Angeles）
**前提**：Phase 2.5 的部署闭环修复**全部保留**，未回退任何一项。

> 本轮要解决的问题：ProjectOS 名义上"AI 主导"，实际仍要用户自己判断该进版本页、审批页、Agent 页还是发布页，把自己当成人肉调度器。且通知铃铛**一律跳 Agent 聊天页**。

---

## 1. 根因（改代码前先在源码里核实）

| 缺陷 | 位置 | 事实 |
|---|---|---|
| 铃铛永远跳 Agent 页 | `components/AppLayout.tsx` | `onClick={() => navigate(`/projects/${projectId}/agents`)}`，且徽标只统计 `pendingApprovals` |
| 审批通知文案误导 | `components/AppLayout.tsx` | 事件文案固定写「前往 Agent 工作台处理」，无任何深链接 |
| 项目中心审批行跳 Agent | `pages/ProjectCenterPage.tsx:366` | 审批项 `navigate(.../agents)` |
| 审批页不支持深链接 | `pages/ApprovalsPage.tsx` | 只读 `useParams`，从不读 `?approval=`，永远自动选第一条 |
| 无统一待办模型 | 全仓库 | 审批/门禁/验收/对账/失败 Run 分散在 6 个模块，各自为政 |
| 阶段推进只能人工点 | `pages/LifecyclePage.tsx` | 每个版本行一个「推进阶段」下拉，Ai 无法自行推进 |
| 通知类型不区分 | — | 所有事件同一套 toast，无「这是审批还是门禁还是部署」的编排 |

---

## 2. 实现

### 2.1 统一 Action Center（不是第二个审批系统）

新增 `apps/runtime/src/action-center.ts`，**只读投影**既有事实，不复制任何业务真相：

| kind | 数据来源（真实表） | 深链接目的地 |
|---|---|---|
| `tool_approval` | `approvals`（`request.kind` 非 task-acceptance） | `/approvals?approval=<id>` |
| `task_acceptance` | `approvals`（`request.kind = task-acceptance`） | `/approvals?approval=<id>` |
| `delivery_approval` | `approval_requests`（change_request / deployment） | `/approvals?approval=<id>&scope=delivery` |
| `version_gate` | `gate_evaluations` + `product_versions`（新增 `LifecycleService.blockedGates`） | `/versions?version=<id>` |
| `deployment_reconciliation` | `deployments.status ∈ (needs_reconciliation, unknown)` | `/deployments?version=<id>&deployment=<id>` |
| `run_failure` | `agent_runs.status = failed` | `/runs?run=<id>` |

每个条目携带：所属项目/版本/Run/任务/部署、**必须由用户完成的具体决定**（`requiredDecision`）、**处理后自动恢复什么**（`resume`）、风险等级、`stale`（对象已处理或过期）。

### 2.2 自主推进协调机制（复用既有服务，不新建 Scheduler）

- `ActionCenter.tick(projectId)` → 调 `LifecycleService.nextGatedPhase` + `transitionVersion`。
- **只有门禁已通过的阶段才推进**；`transitionVersion` 本身会强制门禁校验、并发 CAS 和证据复核，所以自动推进无法绕过审批。
- 自主模式默认开启（`app_settings` 的 `autonomy.mode.<projectId>`），三种模式：`assist` / `autonomous` / `managed`。
- 自动推进列表固定为 `discovery|build|verify|release_candidate` 四个 **受门禁保护** 的阶段；生产部署不在此列。
- 触发点：人工决策落地的运行时事件（`approval.changed` 且状态非 pending）→ 自动 tick → 有推进则刷新门禁/生命周期/待办并提示。

### 2.3 通知与深链接

- 铃铛改为 **Action Center 面板**：待办列表 + 自主模式切换 + 「立即检查自动推进」+ 过期分区。
- `approval.changed` 通知带「查看审批」按钮，直达 `/approvals?approval=<id>`，文案不再提"Agent 工作台"。
- 审批页支持 `?approval=` 与 `&scope=delivery`，精确选中目标审批（并自动切到对应 tab 与 filter）。
- 项目中心审批行改跳 `/approvals?approval=<id>`。
- Run 详情「打开会话」改为深链到具体 `?session=<id>`（拿不到 session 时留在该 Run）。

### 2.4 统一"下一步"

`components/NextStepPanel.tsx` 置于研发工作中心首屏：显示第一优先待办（类型、风险、需要你做什么、处理后会恢复什么）+「去处理」直达；无待办时明确显示"无需你介入，系统在推进"。它读取同一个 Action Center，因此**不会与审批/门禁/部署模块不一致**。

---

## 3. 真实 Electron E2E（`scripts/phase2.6-autonomy-e2e.mjs`）

**结果：16 PASS / 0 FAIL / 0 SKIP。**

| 验收项 | 证据 |
|---|---|
| 默认自主模式 | `mode=autonomous` |
| 工作中心出现统一「下一步」 | `[data-testid="next-step-panel"]` 渲染 |
| **点铃铛不再跳 Agent** | hash 保持 `#/projects/<id>/work`，无 `/agents` |
| 面板内可切换自主模式 | 显示「自主模式（推荐）」 |
| **证据满足后系统自动推进** | `build → verify`，`advanced=["build>verify"]` |
| Action Center 汇总真实事实 | `items=2`，`kinds=tool_approval,run_failure` |
| 无任何条目回退到 Agent 页 | 0 条包含 `/agents` |
| 各条目路由互不相同 | 唯一 route 数 = 条目数 |
| **点铃铛待办直达对应对象** | 落地 `#/projects/<id>/approvals?approval=apr_01m60…`，与期望 approvalId **完全一致** |
| 审批页显示对应审批与 Diff 区域 | 命中 3 个审批/Diff 容器 |
| 无效深链接不崩溃 | `?approval=apr_nonexistent` 页面正常 |
| 重启后自主模式保持 | `autonomous → autonomous` |
| 重启后待办数量一致 | `2 → 2` |
| 重启后自动推进结果保持 | `verify → verify` |

截图：`docs/screenshots/p26-01-action-panel.png`（铃铛面板）、`p26-03-approval-deeplink.png`（深链接后的审批页）、`p26-02-next-step-after-restart.png`。

---

## 4. 哪些自动、哪些必须人工（本轮实测）

| 操作 | 归属 | 依据 |
|---|---|---|
| 记录证据后推进 `build → verify` | **自动** | 门禁通过即由 tick 推进，E2E 实测 |
| 生成待办、计算"缺什么" | **自动** | `blockedGates` 直接读门禁条件结果 |
| 审批/验收/部署授权 | **必须用户** | `approval_requests` / `approvals` 独立记录，不可由 AI 代签 |
| 生产部署、凭据变更、越权写文件 | **必须用户 + 独立授权** | 审批与授权链路未改动；Phase 2.5 的授权指纹仍生效 |
| 部署结果未知 | **必须人工对账** | `needs_reconciliation` 不自动重放 |
| 门禁不满足 | **不自动绕过** | 自动推进只走 `transitionVersion`，门禁失败即抛错 |

---

## 5. 验证结果

| 项目 | 结果 |
|---|---|
| `pnpm typecheck` | **PASS** |
| `pnpm lint` | **PASS**，0 errors / 15 warnings（均既有），`Dependency boundaries OK` |
| `pnpm test` | **PASS**，294 passed / 4 skipped |
| `pnpm build` | **PASS** |
| Phase 2.6 自主推进 E2E | **PASS** 16/16 |
| Electron 重启一致性 | **PASS** |

相关既有覆盖（引用而非新造）：`tests/agent-runner-guards.test.ts:372` 与 `tests/r2-file-attribution.test.ts:80` 覆盖"批准后 Run 自动继续"；`tests/r1-concurrency.test.ts` 覆盖"一个任务等待时其他无依赖任务继续/排队"。

---

## 6. 未完成 / BLOCKED（不隐藏）

1. **"审批通过后 Agent 自动恢复"未做真实模型端到端**：本机未配置可用模型 Provider（运行时明确返回 `PROVIDER_NOT_CONFIGURED`），因此只做到"批准入口可达 + 运行时单测证明恢复"。要跑真实模型恢复需提供 API Key。**BLOCKED（需环境）**。
2. **`review` 类任务验收待办**：任务验收本身落在 `approvals` 表并可被识别，但本轮 E2E 用真实数据只覆盖了工具审批与失败 Run；未构造真实的 task-acceptance 场景。
3. **托管模式（managed）的范围编辑 UI 未做**：模式可保存、可读取、重启保持，但"范围白名单"目前沿用默认列表，没有可视化编辑。
4. **通知未做"已读/分组"**：本轮修的是路由正确性与统一待办，未引入额外的已读状态（避免与真实业务状态形成第二套真相）。
5. **Phase 2.5 遗留**：控制台右栏"当前可信运行版本"重启后显示"没有已验证运行版本"仍在，本轮未修。
6. 125% 缩放与 UI 截图矩阵未在本轮重跑。

---

## 7. 结论

- 铃铛与通知**不再统一回退到 Agent 聊天页**；每类事实有各自精确目的地，并有 E2E 断言。
- 建立**统一的待办/决策模型**（读投影，不是第二套审批），把"用户该做什么"从 6 个模块收敛为一处。
- **合法的版本阶段推进已自动执行**（门禁通过即推进），且无法绕过审批与授权。
- **Phase 2.5 成果全部保留**，294 单测与 16 项真实 Electron 检查通过。

**Phase 2.6 到此停止，不进入 Phase 3。**
