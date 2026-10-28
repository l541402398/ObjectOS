# ProjectOS V2.0 Phase 2.8.6 — Review 一致性、自主修复诊断与可靠性（报告）

**分支**：`v2.0-phase2.8.6`（恢复点 tag `phase2.8.6-base` = `be65fe0`）
**基线**：GitHub `origin/v2.0-phase2.8.5` = `be65fe0e58c70e662c8d4ef66e32f6ef365f3a4f`（本地已核对一致；本轮 `git fetch` 因网络暂时不可达，未取得新的远端 ref）
**Schema**：V36（未新增迁移）

---

## 1. 结论摘要

| 项 | 结果 |
|---|---|
| P0-1 Review Verdict 四态、无默认通过 | **PASS** |
| P0-1 统一判定源（消除各模块重复正则） | **PASS** |
| P0-2 Review 版本绑定（reviewedRevision） | **PASS** |
| P0-2 版本取代（旧负向不永久阻断、新审查不抹掉未解决阻断） | **PASS**（逻辑+单测；真实链路未复验） |
| P0-6 审批描述对齐有效参数 | **PASS** |
| P0-6 V36 覆盖 npm scripts 间接引用文件 | **PASS**（单测） |
| P0-3 Review Evidence 对象真实性校验 | **未实现** |
| P0-4 任务契约预检 | **未实现** |
| P0-5 Run 执行诊断增强 | **未实现** |
| P0-7 产品自主 vs 脚本代办分离验收 | **未实现** |
| P1 自动交付 / 并行 / 强杀 / 幂等 / SSH 对账 / 打包 / 视觉 | **SKIP** |

确定性回归：**333 passed / 4 skipped**（本轮 +13）。

## 2. 本轮改动的文件

| 文件 | 变更 |
|---|---|
| `packages/application/src/review-verdict.ts` | **新增**：唯一 Review 判定源（四态 verdict、blocker 解析、版本过期判定） |
| `packages/application/src/index.ts` | 导出新模块 |
| `packages/application/src/completion-evidence.ts` | 删除本地 verdict 正则，改用共享实现 |
| `apps/runtime/src/orchestrator.ts` | `negativeReviews` 改用共享判定 + 版本取代逻辑 + `workspaceRevision()` |
| `apps/runtime/src/agent-runner.ts` | 审批描述改用有效参数；review 产物自动记录 `reviewedRevision` |
| `apps/runtime/src/plan-grant.ts` | 指纹覆盖 npm script 脚本体与引用文件；读取失败 fail-closed |
| `docs/adr/0024-review-verdict-and-version-supersession.md` | **新增 ADR** |
| `tests/p286-review-verdict.test.ts` | 10 项 |
| `tests/p286-npm-script-context.test.ts` | 3 项 |

## 3. Review Verdict：不再默认通过

旧实现在"没命中拒绝词"时就返回 `approved`，等于对空结论、含糊结论、读不懂的结论**一律放行**。

新规则（ADR-0024）：

| Verdict | 条件 |
|---|---|
| `blocked` | 存在真实 blocker（排除 `无`/`none`/`—` 等占位） |
| `changes_requested` | 结论明确要求修改/不通过/拒绝 |
| `approved` | 结论以明确正向词开头且不含否定词 |
| `inconclusive` | 空、含糊、矛盾、无法解析、版本过期——**一律不是通过** |

实测断言（`tests/p286-review-verdict.test.ts`）：

- `''`、`'看起来还行吧'`、`'待确认'`、缺字段 → 全部 `inconclusive`；
- `'通过，但阻断项仍未解决'`（自相矛盾）→ `inconclusive`；
- `blockers: ['无', 'owner 规则缺失']` → `blocked`（真实阻断优先于正向结论）；
- 结构化 `verdict: 'maybe'` → `inconclusive`，`verdict: 'approved'` 与结论矛盾时降级；
- `reviewedRevision: 'aaa111'` 对 `currentRevision: 'bbb222'` → `inconclusive`（过期）。

**统一判定源**：`reviewVerdictOf()` 现在是唯一实现，`completion-evidence.ts` 与 `orchestrator.ts` 都引用它，消除了两处正则漂移——这是原报告点名的第 2 条问题。

## 4. 版本绑定与取代

- 创建 review 产物时，若未提供 `reviewedRevision`，系统用 `git rev-parse HEAD` **记录当时的 revision**（这是事实采集，不写任何 conclusion/findings/blockers）。
- 判定时 `reviewedRevision ≠ 当前 HEAD` → `inconclusive`。
- 取代规则：只以"当前 revision 上的 review"为决定性证据；旧 revision 的负面 review 保留为历史但不再阻断；当前 revision 上**所有** review 必须通过——新审查不能抹掉同版本其它未解决的阻断项。
- 历史 Review 不删除、不改写。

## 5. 审批一致性与命令指纹

- `approvalDetail()` 此前用原始 `invocation`，现在与 Policy/PlanGrant/执行共用 `invocationEffective`；`run_tests` 不传 command 时用户看到的就是实际执行的 `pnpm test`。
- 指纹新增对 npm scripts 的覆盖：解析 `package.json` 中对应脚本体并纳入指纹，同时哈希脚本体内引用的本地文件（`.mjs/.js/.ts/.json/.sh/.ps1`）。脚本体改一行、或它引用的测试文件变了，旧审批都会失效并要求重新授权（3 项单测验证）。
- 读取任何必需上下文文件失败 → 返回"不可验证" → 拒绝复用。**未放宽**任何 Shell / 网络 / 敏感路径 / 凭据权限。

## 6. 未完成项与原因

1. **Review Evidence 对象真实性校验**（P0-3）：仍未校验 `reviewedObjects` 指向的文件/Commit 是否真实存在、是否属于本项目。只补了 revision 绑定这一半。
2. **任务契约预检**（P0-4）：未实现。这是"执行前判断证据能否产出"的部分。
3. **Run 执行诊断**（P0-5）：未实现专用诊断字段；上一轮 900s 到点仍在 running 的根因**仍未定位**，本轮没有把它归因为"等待不足"。
4. **产品自主 vs 脚本代办**（P0-7）：E2E 脚本仍在替用户调用 `replan.apply` / `plans.update` / `approve` / `grant.issue` / `orchestration.start` / `worktrees.merge`，因此**不能声称产品自主闭环**。分离验收未实现。
5. **P1 全部 SKIP**：自动交付、并行、强杀恢复、幂等、SSH 对账、打包、Electron 截图与 125% 视觉回归。

## 7. 质量门

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | **PASS** |
| `pnpm lint` | **PASS**，0 errors / 16 warnings（既有），边界 OK |
| `pnpm test` | **PASS**，333 passed / 4 skipped |
| `pnpm build` | **PASS** |
| `pnpm package:dir` / `test:package` | **SKIP** |
| 真实 DeepSeek E2E | **未运行**（按本轮要求先做确定性回归；且未解决自主/代办分离前，再跑一次不能构成收口证据） |
| Electron 截图 / 125% | **SKIP** |

## 8. 是否具备 Phase 2 收口条件

**不具备。** 本轮只交付了确定性层面的修复：审查判定不再默认放行、版本取代规则成立、审批与指纹一致性补齐。

真正阻断收口的是三件事，且都不是"再等更久"能解决的：

1. **产品自主 vs 脚本代办**：现在所有"自主"推进都是 E2E 脚本替用户点出来的，必须让 Scheduler/AutonomyCoordinator 自己完成 replan 应用、重新分配、恢复执行，脚本只做观察与必要审批；
2. **900 秒仍在 running 的根因未定位**；
3. **Review Evidence 对象真实性 + 任务契约预检**未实现。

**Phase 2.8.6 到此停止，不进入 Phase 3。**
