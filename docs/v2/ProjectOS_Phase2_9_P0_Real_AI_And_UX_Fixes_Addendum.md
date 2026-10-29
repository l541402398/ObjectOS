# Phase 2.9-P0 补充记录：真实 AI 首跑与用户反馈修复（2026-10-29）

本文件补充 `ProjectOS_Global_Goal_Journey_And_First_Run_Closure_Report.md`。全部结论来自真实
Electron、真实 DeepSeek 连接与用户实际界面反馈，不是设计推演。

## 1. 真实 DeepSeek 闭环（`scripts/p29-real-ai-journey-e2e.mjs`）

密钥只写入临时档案的 Main safeStorage，未回传渲染进程（`leaked=false`），未写入仓库/日志；验证后请
在 DeepSeek 控制台轮换该密钥。

| 检查 | 结果 |
|---|---|
| 创建真实连接 + 真实推理测试（L1 passed, 1.4s） | PASS |
| `aiConnections.create` 响应不含密钥 | PASS |
| 空目录建项目（真实档案，autonomous + autoDeliver） | PASS |
| AI 生成计划草案（`generation=provider`，2 个任务） | PASS |
| 生成后旅程「等待你审核计划」 | PASS |
| 批准+授权后「已授权，产品会自动开始执行」 | PASS |
| 真实启动 → Agent 实际执行（6 条只读/测试命令真实审批，逐条记录 approvalId） | PASS |
| 真实测试通过：`node --test test/hello.test.js`（exit 0） | PASS |
| 验证阶段不伪造：证据过期时 `verify=blocked`，下一步 owner=user「需要重新验证」 | PASS |
| 交付阶段只认 merge + 合并后验证（当时 `delivery=none`，未宣称交付） | PASS |

**运行结局（诚实记录）**：计划在"最后一次写入晚于最后一次测试"处暂停，要求人工重新验证（ADR-0047
的可信证据规则工作正常，也说明 Agent 收尾后需要自动重跑测试）。E2E 脚本的两个断言有缺陷（把隔离
worktree 里的产物当成项目根目录产物、最终截图超时），因此脚本退出码为 1；产品状态本身正确。

由此发现并修复的真实缺陷：

1. **计划修订号并发冲突**（`UNIQUE constraint failed: plan_revisions.project_id, plan_revisions.revision`）：
   自主草案与手动生成同时分配 revision。现在按项目串行分配（`withPlanLock`），并新增
   `tests/p29-plan-generation-race.test.ts`（两路并发均落库，revision 不同）。
2. **验证阶段与执行暂停矛盾**：执行因"测试证据已过期"暂停时，旅程仍显示"验证通过"。现在 verify
   `blocked`，下一步归 user 并说明需要重新验证（`tests/p29-goal-journey.test.ts` 新增用例）。
3. **过期审批把运行永久挂起**：见 ADR-0057；一个 tick 后审批 `expired`、运行结算为失败，
   `scripts/p29-approval-expiry-e2e.mjs` 验证 `EXPIRY_SETTLED=true`。
4. **每条测试命令都要人工点审批**：见 ADR-0056（`run-tests` 窄白名单授权）。

## 2. 用户反馈修复

| 反馈 | 根因 | 修复 | 验证 |
|---|---|---|---|
| 「已执行审批的记录还能继续点击审批」 | 决策面板对所有状态都渲染表单 | ADR-0055 只读结论块，无批准/拒绝/备注框 | `p29-approvals-readonly-e2e` 4/4 PASS |
| 「内页小字体发虚，好多页面都是这样」 | 605 处 <12px 声明 + 125% 缩放下分数像素 | ADR-0058 统一 12px 地板（Design Lab 除外） | 9 页 × 1440/1024 计算字号扫描：0 处 <12px；审批页同样 0 |
| 「测试时中间还有报错页面不存在」 | 视觉巡检脚本用了不存在的路由 `/collab` | 路由改为 `collaboration`/`agents`/`overview`，并断言真实标题、禁止出现"页面不存在" | 巡检 18/18 PASS |
| 「项目中心这块太突兀、按钮突兀、75% 看不懂」 | 我在 hero 里重复了全局旅程行 + 无标签百分比 + 全宽按钮 | 移除重复旅程行与裸百分比：改为「1/4 任务完成 · 1 个已完成 · 3 个未完成」+ 单一主按钮；项目卡片改「25% 任务」 | `p29-center-hero-check`：无旅程行、无裸百分比、0 小字、无溢出（1440/1024 截图） |

## 3. 当前质量门（本轮结束）

- `pnpm typecheck` PASS
- `pnpm lint` 0 error / 29 warning（边界 OK）
- `pnpm test` 454 passed / 4 skipped；`tests/r1-budgets.test.ts` 在并行负载下 1 次超时失败，单独运行
  5/5 通过（既有计时敏感，非本轮回归，已如实记录）
- `pnpm build` PASS；`pnpm package:dir` + `pnpm test:package` 见本轮日志
- 真实 Electron：首次旅程 E2E 21/21、审批只读 4/4、过期清扫 PASS、视觉巡检 18/18、项目中心 hero 检查 PASS

## 4. 仍未完成

1. 真实 AI 链未走到 `deliveryStatus=verified`：需要 Agent 在最后一次写入后自动重跑测试（自动证据重采），
   或允许一次显式"重新验证"后再走合并。本轮只把状态说清楚，没有伪造完成。
2. 页面主体（工作中心、看板、审批、运行、发布）仍是旧卡片样式，Design Lab 迁移只完成壳层（ADR-0054）。
3. 旅程栏的事件驱动刷新已接入，但未做"多窗口/多项目并发"的专项压测。
