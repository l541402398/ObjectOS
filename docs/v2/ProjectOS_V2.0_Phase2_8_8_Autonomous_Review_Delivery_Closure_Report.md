# ProjectOS V2.0 Phase 2.8.8 — 自动复审、真实自主交付与自主修订可靠性收口

**分支**：`v2.0-phase2.8.8`（恢复点 tag `phase2.8.8-base` = `5d4a538`）
**基线**：GitHub `origin/v2.0-phase2.8.7` = `5d4a538b95f6259c5ea0ae019e7a66d9c0fc06b4`（本地与远端一致，已核对）
**Schema**：V36（未新增迁移；本轮新增字段全部落在既有 JSON 列 `plan_json` 与 `app_settings`）
**新增 ADR**：0028（自动复审）、0029（修订预算按 lineage）、0030（交付 = 合并提交 + 合并后验证）、0031（目标状态读模型）、0032（只读审批家族）、0033（审查任务只读与散文判定）、0034（失败必须修代码）、0035（写路径规范化）、0036（工作区路径规范化）、0037（栏内滚动）、0038（事件文案）、0039（修复前验证降级）、0040（按角色复用 Agent）、0041（策略字段透传）、0042（完成驱动自主 pass）、0043（交付单飞认领）

---

## 1. 本地与远端 HEAD

| 项 | 值 |
|---|---|
| 基线远端 HEAD | `5d4a538b95f6259c5ea0ae019e7a66d9c0fc06b4`（`git ls-remote` 经本机代理核对一致） |
| 本轮起点 | 本地 HEAD = 基线，工作树 clean，17 个 worktree、全部分支未动 |
| 本轮提交 | 见 §16 |
| 保留项 | 未执行 `reset --hard` / `clean` / `force-push`，未删除任何 worktree，未合并主分支 |

---

## 2. 实际代码提交与修改文件

按轨道（详见 §16 的提交记录）：

**轨道 A（生产代码 + 确定性单测）**

| 文件 | 变更 |
|---|---|
| `apps/runtime/src/review-coordinator.ts` | **新增**：内容变化后复用原计划审查任务安排复审（ADR-0028） |
| `apps/runtime/src/plan-lineage.ts` | **新增**：目标 lineage 推导与精确修订预算（ADR-0029） |
| `apps/runtime/src/delivery-verifier.ts` | **新增**：合并后真实验证、merge-tree 预演、基线祖先检查（ADR-0030） |
| `apps/runtime/src/goal-status.ts` | **新增**：目标状态读模型（ADR-0031） |
| `packages/application/src/review-snapshot.ts` | presence/integrity：真实删除 vs 从未存在 vs 不可读 vs 拒绝（ADR-0028） |
| `apps/runtime/src/review-snapshot-collector.ts` | 采集 presence、必采对象失败即不完整、Git 删除判定 |
| `apps/runtime/src/replan-service.ts` | 修订绑定钉住、Agent 复用、lineageRoot 持久化、失败必须修代码指令（ADR-0034） |
| `apps/runtime/src/replan-autopilot.ts` | 复审优先于新修订、交付前置条件 + 合并后验证 + 交付证据（ADR-0030） |
| `apps/runtime/src/plan-grant.ts` | 只读审批家族复用（ADR-0032）、审查任务禁止写（ADR-0033）、派生授权 |
| `packages/application/src/review-verdict.ts` | 散文判定与零计数识别（ADR-0033） |
| `apps/runtime/src/failure-classifier.ts` | 审查未通过归类为 implementation → 可修订 |
| `packages/contracts/src/{orchestration,api,desktop-api}.ts` | `reReview` / `mergeCommit` / `deliveryStatus` / `work.goalStatus` |
| `apps/desktop/src/renderer/src/pages/WorkCenterPage.tsx` + `work-center.css` | 目标状态带 + AI 下一步条（ADR-0031） |

**轨道 B/C**：`scripts/phase2.8.8-product-autonomous-e2e.mjs`、`scripts/p288-work-center-ui-e2e.mjs`、`tests/p288-*.test.ts`（5 个新文件）、`docs/adr/0028..0034`、`docs/v2/evidence/p288-product-run.txt`、`docs/screenshots/p288-wc-*.png`。

---

## 3. 自动复审触发条件与调度证据

触发（全部成立才调度，`ReviewCoordinator.reconcilePlan`）：计划处于 `paused`/`running`；无活动 Run；
共享解析器判定"当前内容没有审查"（只有历史/过期审查）；没有任何未通过的验证；工作区存在；
计划中存在可复用的审查任务；执行授权有效且覆盖审查 Agent。

动作：复用原审查任务，走**合法领域转换** `done → review → blocked → ready`（同一同步块内完成，
避免调度器看到中间 `review` 态用旧证据提前完成），并在计划执行上持久化
`reReview = { taskId, fingerprint, requestedAt }`；旧审查 Artifact 保留不覆盖。

真实运行证据（`docs/v2/evidence/p288-product-run.txt`，dataDir `projectos-p288b-e3Ag9O`）：

```json
{"event":"plan.review.reopened","taskId":"tsk_01m62metysp2xdcvwcpm6epwjc",
 "replyOf":"art_01m62mw00y5xdxgf6evrndmv53",
 "staleArtifactIds":["art_01m62mw00y5xdxgf6evrndmv53","art_01m62mrmxat5mng8hbqkvzj0ta",...],
 "reviewedObjects":["src/sums.mjs","tests/sums.test.mjs","package.json"],
 "reason":"内容已变化，旧审查失效，复用原计划审查任务重新审查当前内容",
 "authorizedBy":"policy","policy":"autoReview"}
```

自动化证据（`tests/p288-auto-review.test.ts`，全部真实 Git 仓库）：scheduled 且**不新建 revision**、
计划从 paused 恢复、同一指纹不重复、验证失败时不复审、无审查任务时 `needs-replan`、授权撤销时 `blocked`、
当前内容已有通过审查时不动。

---

## 4. ReviewSnapshot 的真实性边界与回归结果

| 场景 | 现在的行为 | 测试 |
|---|---|---|
| Git 中真实存在、现已删除 | `presence: "deleted"`，计入内容（可审查删除） | PASS |
| 从未存在过的路径 | `presence: "never-existed"`，快照 `integrity.complete=false`，**不能放行** | PASS |
| 无权限/非普通文件 | `presence: "unreadable"`，不完整 | PASS（类型覆盖） |
| 符号链接/越界/绝对路径 | `presence: "rejected"`，保留在 files 中并标记 required | PASS |
| 必采对象无法采集 | `integrity.complete=false`，其余文件哈希**不能**补偿 | PASS |
| 不完整快照 vs 相同指纹 | `snapshotMatches` 一律 false | PASS |

关键点：被拒绝的必需对象**不再被静默丢弃**（旧实现在越界时直接跳过，剩余哈希看起来"完整"）。

---

## 5. Replan lineage 上限与重复提案幂等验证

**预算语义**（ADR-0029）：修订次数按**同一目标 lineage**统计（由 `supersededByPlanId` 链推导根计划），
使用精确 SQL 聚合，**没有时间窗、没有事件窗口**；`lineageRoot` 持久化在 `plan.replan.applied` 事件里。

**真实运行证明上限生效**（`p288-product-run.txt`）：

```
policy applies:  seq157 lineageRoot=pln_01m62n22… → r2
                 seq201 lineageRoot=pln_01m62n22… → r3
                 seq243 lineageRoot=pln_01m62n22… → r4
第 4 个提案:      rpp_01m62ng2… status = proposed（未应用）
policy:          maxAutoReplans = 3
```

即：`maxAutoReplans=3` 时，第 4 次修订**不会**被策略自动应用 —— 这正是 §4.3 要求的真实复验。

幂等回归（`tests/p287-reliability.test.ts` + `tests/p288-*`）：同一事件重复 enqueue 只 1 行；
同一提案重复应用被状态机拒绝；superseded 源计划不能再次应用；单进程 pass 单飞；
`plan.replan.applyFailed` 在批准/启动失败时落事件；达到上限后 `blocked` 且保留诊断。

---

## 6. 真实 DeepSeek 执行时间线（PRODUCT_AUTONOMOUS）

真实 provider `deepseek-flash`、真实 Git、真实 `node --test`；脚本只在初始阶段行使"用户"权限
（创建项目/Agent、批准计划、签发一次授权、开启策略），之后只读观察 + 处理真正必要的工具审批。

| 步骤 | 实测结果 | 证据 |
|---|---|---|
| 夹具真实失败 | `exit=1` | 宿主 `node --test` |
| Planner | `source=provider tasks=3` | `plan.generated` |
| **产品自主启动**（脚本未调 `orchestration.start`） | `from=approved to=running reason=policy.autoStart authorizedBy=policy` | seq 17 |
| Tester 真实执行 | `node --test tests/sums.test.mjs` exit 1、`npm test` exit 1 | tool_calls |
| 负向证据 | 审查 Artifact `verdict=changes-requested`，findings 精确到 `src/sums.mjs:3 的 return a` | `art_01m62n87x…` |
| Replanner | 3 个提案（trigger=evidence_exhausted） | `plan.replan.proposed` |
| **产品授权内自动应用** | 3 次，全部 `authorizedBy=policy`，同一 lineageRoot | seq 157/201/243 |
| 第 4 次修订 | **未应用**（预算上限） | `rpp_… status=proposed` |
| 自动复审 | `plan.review.reopened`（复用审查任务，非新计划） | `p288-product-run.txt` |
| Reviewer 真实检查 | `list_directory`、`git_status`、`read_file`×4、`git_diff`×3、`run_tests`×2 | 同文件 §reviewer |
| **自动交付 / Merge Commit** | **未发生**（`mergedAt=null`、`mergeCommit=null`、`deliveryStatus=none`） | 全部 revision |

---

## 7. Exit Code 从 1 到 0 的证据

**已拿到真实转绿。** 同一个真实 fixture（`src/sums.mjs` 忽略第二个参数、`tests/sums.test.mjs` 断言 `sum(2,3)===5`）：

| 运行 | 真实工作区结果 | 证据 |
|---|---|---|
| 宿主基线 | `node --test` exit 1 | E2E 夹具自检 |
| run 8（`projectos-p288b-QQwO6S`，r4） | **exit 0** | `[…] 同一测试 exit=1 → exit=0（真实工作区） — exit=0 wt=pln_01m62t988…` |
| run 9（`projectos-p288b-5S4GML`，r2） | **exit 0** | `exit=0 wt=pln_01m62v1y854…`，且 r2 仅用 2 个修订版本就完成 |
| run 11（`projectos-p288b-8kUVJM`，r3） | 工作区仍是 `return a`，但测试报告声称 exit 0 | 复审当场判定"当前工作区 src/sums.mjs 仍是 2 行 return a"并暂停 |

即：产品确实能自己修好代码并让真实测试转绿（run 8/9），也真的会拒绝"报告说绿、代码没改"的虚假证据（run 11，复审独立复核工作区后否决）。

## 8. Reviewer 对新代码的真实检查记录

来自真实运行（`p288-product-run.txt`），审查任务 run `run_01m62n6yt7…`：

```
list_directory · git_status · read_file src/sums.mjs · read_file tests/sums.test.mjs
read_file package.json · read_file src/sums.notes.mjs · git_diff src/sums.mjs
git_diff tests/sums.test.mjs · git_diff · run_tests "node --test tests/sums.test.mjs"
run_tests "npm test" · run_command "node --version" · git_status · create_artifact · update_task_status
```

即 Reviewer 确实读取了代码、Diff 与测试结果后创建审查 Artifact；本轮同时把该审查任务设为**只读**
（`write_file` 直接拒绝），避免"审查者改动被审内容导致自己的快照失效"的循环。

---

## 9. 当前 ReviewSnapshot 指纹与 Verdict

```
artifact: art_01m62n87xc7ghjc9ehdp77penh
title:    审查报告 · src/sums.mjs 实现与测试结果复核
verdict:  changes-requested
fingerprint: 19790ddf9485ac61fe4656bab6917852aad131ce81323b2064d43da1d17c9616
reviewer: P288 Reviewer
conclusion: 实现与测试期望不一致（阻断）：src/sums.mjs:3 的 return a 忽略第二参数 b …
```

---

## 10. GateEvaluation 的实际结果

**未评估**：计划从未 `completed`，交付前置条件在第一步（当前内容审查/验证）就不成立，因此没有
`GateEvaluation` 记录，也没有伪造。

交付门禁实现（ADR-0030）已具备：计划完成 + 当前审查通过 + 无未通过验证且至少一条真实验证记录 +
版本门禁（若属版本）通过 + 授权仍有效 + 变更文件在授权路径内 + 目标分支未变 + 基线提交仍是祖先 +
merge-tree 无冲突 + 目标工作区干净。自动化覆盖见 `tests/p288-delivery-lineage.test.ts`。

---

## 11. 自动 Worktree Merge Commit、mergedAt 与合并后验证

**已达成。真实运行 `projectos-p288b-IgGA1q`（r2）：**

| 项 | 值 |
|---|---|
| deliveryStatus | `verified` |
| mergeCommit | `b352a3fad220149b6c9ab9bdda8ba31fd6a31906` |
| mergedAt | 1793246659621 |
| deliveryVerifiedAt | 1793246661996 |
| 交付证据 Artifact | `art_01m62x93baj0kwwxd76zwbmbcz`（「交付验证 · 计划 r2」） |
| 审查指纹 | `b426d784f76c94b5cfaf6ae0dd1234af221fadbc6ed200b898447b32b9294851` |
| 合并后验证 | **PASS：3 条命令全部 exit 0**（`npm test`、`node --test tests/*.test.mjs`、`node --test tests/sums.test.mjs`，各 2/2 通过） |

合并后的真实仓库内容（`git show HEAD:src/sums.mjs`）：

```js
export function sum(a, b) {
  return a + b
}
```

证据文件：`docs/v2/evidence/p288-merge-evidence.txt`（含交付验证工件全文、`plan.autoDelivered` 事件与 `git log --graph`）。

### 11.1 更正：没有出现重复合并（我最初误判，已核对撤回）

首次取证时我看到 `git log --graph` 里有两行同样的 "Merge ProjectOS plan …"，据此推断"同一计划被合并两次"
（当时写成了 `fc846b5` + `b352a3f`）。核对 `git rev-list --merges --count HEAD` 后确认：**真实合并提交只有 1 个**，
另一行是计划分支上的提交——scheduler 提交 worktree 时用的是同一句提交信息，所以分支提交看起来也像 merge。

```
项目仓库（run 12, IgGA1q）：merges=1 commits=3
项目仓库（run 14, mTwZa1）：merges=1 commits=3
```

所以真实运行中**没有**重复合并；该判断已从报告与 ADR 中更正。

尽管结论撤回，我保留了 ADR-0043 的**单飞认领**（`claimPlanDelivery`，compare-and-set `deliveryClaimedAt`）：
两次 pass 并发时原本没有任何原子保护（"两个 pass 都看到 `mergedAt === null`"在代码上可能），
认领让这种可能不可能发生，代价很小且有单测。它属于**预防性加固**，不是"复现过的 bug"。

### 11.2 最终一次真实运行（run 14）

`PASS=19 FAIL=0 SKIP=5 BLOCKED=0`；`deliveryStatus=verified`、`mergeCommit=8d3665f…`、
合并后 3 条命令全部 exit 0、`rev-list --merges --count HEAD = 1`。证据：
`docs/v2/evidence/p288-final-closure.txt`。

## 12. 项目自主动作与 E2E 脚本动作的分类统计

来自最终真实运行的 E2E 计数器（脚本原样输出）：

```
产品自主动作：start=1 replan=3 reReview=1 resume=0 deliver=0 reviewEvidence=0
脚本业务调用：start=0 replanApply=0 approve=0 grant=0 merge=0 taskEdit=1
人工介入：计划批准=1 授权=1 工具审批=N 重复审批=0 策略变更=1
```

- 产品自主：开始执行 1 次、应用修订 3 次（达上限）、复用审查任务复审 1 次；脚本 0 次代替。
- 脚本：唯一的 `taskEdit=1` 是用户在**授权前**把测试任务声明为 diagnostic 契约（属设置初始执行范围）。
- `deliver=0`：没有任何交付动作（也就没有任何脚本代替交付）。

---

## 13. 实际人工审批次数与原因

- 计划批准 1 次（初始范围）。
- 执行授权 1 次（`maxRuns=6 / maxToolCalls=150 / paths=src,tests / ttl=3h`）。
- 策略设置 1 次（autoStart / autoApplyReplans / autoDeliver / maxAutoReplans=3）。
- 真实工具审批：本轮新增**只读家族复用**（ADR-0032）后，`git status/diff/log/grep/node --check` 等同族只读命令
  只需首次批准；`node -e`（可写文件）、`npm test` 等仍逐次审批。E2E 未放宽白名单来改善数字。

---

## 14. 并行、强杀恢复、幂等、SSH 对账结果

### 14.0 Agent 并行的真实契约（回答"是否一个项目只能一个 Agent 活动"）

不是 bug，也不是"一个项目只能一个 Agent"。真实的两个限制是：

1. **同一个 Agent 同时刻最多一个 Run**，且这条槽位是**跨计划、跨进程**在 SQLite 里原子占用的
   （R1-A，`tests/r1-concurrency.test.ts`：两个计划共用一个 Agent 会串行排队并都完成）；
2. **一个计划内并发上限是 `concurrency`**（调度 `start(planId, concurrency, …)`，默认 2），
   不同 Agent 可以同时跑，前提是任务之间没有依赖。

截图里"运行中的 Agent = 1"是正确结果：该计划只有 3 个任务，且是 `开发 → 测试 → 审查` 的依赖链，
任一时刻只有一个任务就绪；种子团队里又只有 Kai 一个 `implement` 能力的实现工程师。

本轮新增确定性证据 `tests/p288-parallel-agents.test.ts`：
- 两个**互不依赖**的任务分给两个不同 Agent（同计划、concurrency=2）→ 峰值同时运行 **2**；
- 同一个 Agent 的两个任务（concurrency=2）→ 峰值 **1**，依次完成。

因此理想形态成立：N 个项目可各自有计划在跑（每个 armed 计划有独立计时器，Agent 槽位按 Agent 而非按项目），
每个项目内 N 个不同 Agent 可并行到 `concurrency`。用例与代码都只证明到"不同 Agent 并行 + 同 Agent 串行"，
没有证明"同一 Agent 同时跑两个项目"——那被设计禁止。

| # | 项 | 状态 | 证据 |
|---|---|---|---|
| 8.1 | 一个 Agent 等审批、另一个继续 | **PARTIAL** | 调度按 Agent 串行、跨 Agent 并行（`selectStartableTasks` + `tests/r1-concurrency.test.ts` + 本轮 `p288-parallel-agents.test.ts`）；未补实时审批等待用例 |
| 8.2 | Runtime 强杀恢复 | **PARTIAL（既有机制）** | `needs_reconciliation` 路径未改，`tests/recovery.test.ts`；本轮新增"重复自动修订不重放"的确定性覆盖 |
| 8.3 | SSH 只读对账 | **SKIP** | 需要连接到用户 VPS；按规范先说明，未擅自扩大远端权限 |
| 8.4 | 工作中心 UX | **PASS** | 9/9 真实 Electron 检查 + 本轮栏内滚动/动态文案修复 |

## 15. Windows 打包与 Electron UI 截图

| 项 | 结果 |
|---|---|
| `pnpm package:dir` | **PASS**：`release/win-unpacked/ProjectOS.exe` |
| `pnpm test:package` | **PASS**：打包 EXE 创建项目、写起始文件、重启恢复 |
| 工作中心 UI（`scripts/p288-work-center-ui-e2e.mjs`） | **PASS 9/9** |
| 1440 Dark | `docs/screenshots/p288-wc-1440-dark.png` |
| 1440 Light | `docs/screenshots/p288-wc-1440-light.png` |
| 1024 Light | `docs/screenshots/p288-wc-1024-light.png` |
| 125% 缩放（`--force-device-scale-factor=1.25`） | `docs/screenshots/p288-wc-125.png`，`dpr=1.25`，无横向溢出 |

状态带实测内容：`执行=未启动 | 真实测试=未验证 | 当前审查=尚无审查 | 交付=尚未交付`，四个状态在
1440/1024、Light/Dark、125% 下都完整，且"AI 下一步（无需你操作）"与用户待办分离。

---

## 16. 提交记录

| 提交 | 内容 |
|---|---|
| `bb91cc4` | 轨道 A：自动复审、快照真实性边界、lineage 预算、交付前置条件与合并后验证（ADRs 0028–0030） |
| `317466c` | E2E：产品模式观察复审与已验证交付 |
| `57a764c` | 目标状态读模型 + 只读审批家族 + 复审语义修正（ADR-0031/0032） |
| `e1c98a7` | 真实审查散文判定 + 审查未通过归类为可修订（ADR-0033） |
| 见文末 | 审查任务只读 + 重复复审循环修复、失败必须修代码指令（ADR-0034）、报告 |

---

## 17. PASS / FAIL / SKIP / BLOCKED 与 Phase 2 收口判断

### 17.1 逐项状态（并标注证据类型）

| 轨道 | 项 | 状态 | 证据类型 |
|---|---|---|---|
| A | 自动复审（复用原审查任务，不新建计划） | **PASS** | 单测 + 真实运行事件 |
| A | 快照真实性边界（删除/从未存在/不可读/拒绝/不完整） | **PASS** | 单测（真实文件） |
| A | 审查对象真实性（reviewer 只读检查、指纹、身份） | **PASS** | 真实运行 DB |
| A | 审查任务只读（禁止写被审内容） | **PASS** | 单测 + 策略代码 |
| A | 修订预算按 lineage，重启/时间/事件洪泛不重置 | **PASS** | 单测 + 真实运行（3 次后第 4 次不应用） |
| A | 重复提案/重复应用/并发/强杀幂等 | **PASS** | 单测 |
| A | 交付前置条件 + 合并后验证实现 | **PASS** | 单测/集成（真实子进程） |
| B | 产品自主开始执行 | **PASS** | 真实 Electron + DeepSeek |
| B | 授权范围内自动应用修订 | **PASS** | 真实运行（3 次） |
| B | 达上限后停止自动修订 | **PASS** | 真实运行 |
| B | 缺陷发现 + 负向审查证据 | **PASS** | 真实运行 |
| B | 代码修复 + 测试 exit 1 → exit 0 | **PASS** | 真实运行 run 8/run 9（工作区实跑 exit 0） |
| B | 内容变化后自动复审（同计划复用审查任务） | **PASS** | 真实 run 11 `plan.review.reopened`（reopen=1）+ 8 项单测 |
| B | 计划自主完成（全部任务 done + 审查通过） | **PASS** | run 8 r4、run 9 r2 均 `execution.status=completed` |
| B | GateEvaluation + 自动合并 + 合并后验证 | **PASS** | 真实运行：merge commit `b352a3f`、mergedAt、合并后 3 条命令 exit 0、交付证据工件 |
| B | 交付单飞（一次交付只一个合并提交） | **PASS** | ADR-0043 + 单测；真实仓库 rev-list --merges --count HEAD = 1（"两次合并"的判断已核对撤回） |
| B | **自动合并 + Merge Commit + 合并后验证** | **BLOCKED / FAIL** | `mergedAt=null`，`mergeCommit=null` |
| C | 工作中心目标状态（执行/测试/审查/交付 + AI 下一步） | **PASS** | 真实 Electron 9/9 |
| C | 1024/1440、Light/Dark、125% | **PASS** | 真实 Electron + 截图 |
| C | 打包与打包冒烟 | **PASS** | `package:dir` + `test:package` |
| C | 并行 / 强杀恢复 / SSH 对账 | **PARTIAL / PARTIAL / SKIP** | 见 §14 |

### 17.2 未完成项及其真实原因

1. **真实交付闭环未达成（BLOCKED）**。真实运行里 `src/sums.mjs` 的缺陷**从未被修复**：
   Replanner 的三次修订都在改写"如何取证"（把审查任务产物定义写清楚、把测试与报告拆成两个任务、
   新增报告采集任务），没有一次新增可修改被测试代码的修复任务。于是 `node --test` 始终 exit 1，
   证据耗尽、修订预算用尽、计划停在 paused。
   **本轮已针对该根因落地修复**：`ReplanService` 在有真实失败验证时向 Replanner 追加硬性指令
   （必须包含 developer 修复任务 + 真实复跑，禁止只改取证），见 ADR-0034。该修复**尚未**在真实运行中复验。
2. **自动复审的成功路径未验证**。复审确实被自动触发并执行（`plan.review.reopened` + 新的审查 Artifact），
   但因为代码没修好，复审只能再次给出 changes-requested。成功后进入 Gate/交付的路径仍只有单测覆盖。
3. **并行与强杀恢复**：机制在既有实现中，本轮未补实时用例。
4. **SSH 现场对账**：需要用户对 VPS 的只读访问授权；按规范未擅自执行。

5. **最后一个真实阻断（已定位、已修复、待复验）**：在 ADR-0034 生效之后的一次真实运行里，
   r2 终于包含了修复任务（"修复 src/sums.mjs 使 sum 返回两个参数之和"）、复跑任务与复审任务。
   但 Developer 调用 `write_file` 时把**绝对工作区路径**原样回传，授权层（正确）判定越界并拒绝，
   任务随之 `blocked`，下游任务留在 `backlog`，调度器判定"没有可继续执行的任务"并把计划置为 `failed`。
   证据（`projectos-p288b-bWPtl4`）：
   `task.moved "修复 src/sums.mjs …" → blocked，note: 修正未落盘：write_file … 路径 ../../../../Administrator/… 不在计划授权路径范围内`。
   已修复（ADR-0035）：`write_file` 在工作区内接受绝对路径并归一化为相对路径；越界时返回**可重试的
   BAD_REQUEST** 而不是让任务直接 blocked。复验中又发现更深的同源缺陷（Windows 8.3 短路径导致所有
   工作区相对写入被判越界），已由 ADR-0036 修复并在真实运行中确认 `write_file` 成功。

6. **最后一个已定位阻断：修订图把修复前的验证任务保留在修复之前**。短路径修复后的真实运行
   （`projectos-p288b-OD5BiV`）里，r2 正确新增了修复任务与修复后复跑/复审，但旧任务
   `run-sums-tests`（依赖 `add-sums-notes-module`）仍在图的前面；它在修复发生前执行，因"没有成功的
   run_tests"证据耗尽而暂停整个计划，修复任务（依赖 review）留在 `backlog`。
   这一类缺陷的修复方向明确：当修订新增了修复任务时，被修复对象相关的**验证任务必须重新指向修复任务**
   （依赖重排/替换），而 `detectContractDowngrade` 目前只检测"删除验证任务"，不检测"验证先于修复"。
   本轮未实现该重排，因此主链仍为 BLOCKED。

7. **本轮新修的真实缺陷（都是真实运行逼出来的，不是设计推演）**
   - ADR-0039：修订新增修复任务后，**修复前的验证任务被降级为诊断**（如实报告真实退出码即可完成），
     修复后的验证才是门禁。修前：r2 新增了 fix/verify，但旧 tester 在修复前就跑、证据耗尽、计划暂停，
     修复任务永远留在 backlog（run 5/6/7 都是这样死的）。
   - ADR-0040：修订新增任务时"复用授权内同能力 Agent"取了**第一个具备该能力**的 Agent，而三个 P288 Agent
     能力集相同，于是测试/审查新任务全落到 P288 Dev（用户看到的"全指派给 P288 Dev"）；改为按角色优先
     （同角色任务 → 角色名匹配 → 确定性 id），并把人选理由合并保留到审计里。
   - ADR-0041：`action.autonomy.set` 合同接受 `autoDeliver/autoStartPlans/autoApplyReplans/maxAutoReplans`，
     但 dispatcher 只透传 `mode` 与阶段 → 用户开了自主交付也没生效（run 8/9 完成却 `deliveryStatus=none`）。
   - ADR-0042：计划完成只写 `plan_json.execution`，**不发事件**，自主协调器没有 pass 可跑 → 即使能交付也永远
     不会被观察到。现在完成是 `plan.execution.completed` 一等事件（`plan.*` → plan.settled）。
   - ADR-0035/0036：真实工作区里 `write_file` 全被拒（Windows 8.3 短路径 `ADMINI~1` 与长路径比较导致
     "所有相对写入都像越界"），修复后 `write_file` 真实成功。
8. **仍未达成的交付闭环（BLOCKED）**：run 12 之前的最后一次真实运行里，修订链在 r3 被复审否决
   （"测试报告称 exit 0，但工作区 `src/sums.mjs` 仍是 `return a`"），修订预算用尽。这说明：
   - 复审的独立复核是有效的（它拒绝了一份不真实的自测报告）；
   - 但**测试证据的可信度**仍弱于复审：`test-report` 工件只要被标记 verified 就计入 `hasTest`，
     没有强制"同一工作区、最后一次内容变化之后的真实 exit 0"。这是下一轮必须收口的第一项
     （方向：证据必须绑定同一 worktree 的真实 `run_tests` 退出码，或由复审指纹与工作区哈希交叉校验）。

### 17.3 是否可以将 Phase 2 自主研发主链标记为 PASS

**不能。** 依据本轮自己的验收标准（§十二）：

- ✅ 真实 DeepSeek 完成缺陷发现（审查给出精确缺陷）
- ✅ 相同测试确实失败（exit 1）
- ✅ 产品自己修复并让真实测试转绿（run 8/9：工作区 exit 0）
- ✅ 内容变化后产品自己安排复审（run 11：reopen=1）
- ✅ 计划自主完成、审查通过
- ✅ 自动合并：真实 Merge Commit `b352a3f`、`mergedAt`、`deliveryStatus=verified`
- ✅ 合并后验证：3 条真实命令全部 exit 0，证据工件绑定审查指纹与合并提交
- ✅ E2E 没有替产品调用 Replan Apply / Scheduler Start / Merge
- ✅ 修订次数与重复事件受到可靠限制（真实达到上限并停止）
- ✅ 一次交付只产生一个合并提交（ADR-0043 单飞认领为预防性加固；先前"两次合并"的判断已核对撤回）

因此：**Phase 2 自主研发主链 = PASS（真实闭环）**。真实 DeepSeek 在无人替代产品动作的前提下完成了
缺陷发现 → 修订 → 修复 → 测试 exit 1→0 → 复审通过 → Gate → 真实合并 → 合并后验证 → 交付证据。
仍如实保留的限制见 §17.2（测试证据可信度仍弱于复审；并行只验证到"不同 Agent 并行、同 Agent 串行"）。**不进入 Phase 3。**

### 17.4 质量门（绑定本轮 HEAD）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS（0 error / 22 warning，边界 OK） |
| `pnpm test` | PASS（**427 passed / 4 skipped**，81 个测试文件；含 12 个新增 2.8.8 测试文件）。注：一次在全量测试与 Electron E2E 并行时 `r1-budgets` 出现计时抖动，单独及清洁环境下均 PASS |
| `pnpm build` | PASS |
| `pnpm package:dir` | PASS |
| `pnpm test:package` | PASS |
| 真实 Electron + DeepSeek PRODUCT_AUTONOMOUS | **PASS**：run 14 `PASS=19 FAIL=0 SKIP=5 BLOCKED=0`，`deliveryStatus=verified`、merge commit `8d3665f`、合并后 3 条命令 exit 0；证据 `docs/v2/evidence/p288-final-closure.txt` |
| 工作中心 UI（真实 Electron 9/9） | PASS |
