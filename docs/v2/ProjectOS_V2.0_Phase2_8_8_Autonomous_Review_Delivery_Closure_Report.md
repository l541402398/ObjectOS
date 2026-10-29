# ProjectOS V2.0 Phase 2.8.8 — 自动复审、真实自主交付与自主修订可靠性收口

**分支**：`v2.0-phase2.8.8`（恢复点 tag `phase2.8.8-base` = `5d4a538`）
**基线**：GitHub `origin/v2.0-phase2.8.7` = `5d4a538b95f6259c5ea0ae019e7a66d9c0fc06b4`（本地与远端一致，已核对）
**Schema**：V36（未新增迁移；本轮新增字段全部落在既有 JSON 列 `plan_json` 与 `app_settings`）
**新增 ADR**：0028（自动复审）、0029（修订预算按 lineage）、0030（交付 = 合并提交 + 合并后验证）、0031（目标状态读模型）、0032（只读审批家族）、0033（审查任务只读与散文判定）、0034（失败必须修代码）、0035（写路径规范化）

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

| 命令 | 结果 |
|---|---|
| 宿主基线 `node --test tests/*.test.mjs` | exit 1 |
| 产品内 `run_tests node --test tests/sums.test.mjs` / `npm test` | exit 1（共 6 次记录） |
| 任何一次 exit 0 的 `run_tests` | **没有** |

本轮**没有**拿到 exit 1 → exit 0。阻断点在真实运行中逐层暴露，每一层都已定位：

1. Replanner 三次修订都不修代码，只改写取证方式（ADR-0034 修复：有真实失败时必须包含修复任务）；
2. 修复任务出现后，Developer 无法把修复写进工作区 —— **`write_file` 全部被拒**，原因是 Windows 8.3 短路径
   （`ADMINI~1`）与长路径比较导致所有工作区相对写入都被判定越界（ADR-0035/0036 修复）；
3. 短路径修复后，`write_file` 真实成功（运行 `projectos-p288b-OD5BiV`：
   `write_file "tests/qa-node-test-report.md" → completed`、`write_file "src/sums.notes.mjs" → completed`），
   但修订图仍把**修复前的验证任务**（`run-sums-tests`，只依赖 dev）保留在修复任务之前：
   该任务在修复发生前就因"没有成功的 run_tests"证据耗尽而暂停计划，修复任务（依赖 review）留在 `backlog`。

因此 exit 仍为 1：不是审查语义、授权或交付逻辑的问题，而是**修订图顺序**（见 §17.2 第 6 项）。

---

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

| 项 | 结果 |
|---|---|
| Merge Commit | **无** |
| mergedAt | `null` |
| 合并后验证 | 未执行（无合并） |
| 交付证据 Artifact | 无 |

合并后验证的实现（`delivery-verifier.ts`）已在真实子进程中验证：只重跑"计划内真实通过过的验证命令"，
返回每条命令的真实 exit code、耗时与输出尾；`git merge-tree` 预演能识别冲突；基线提交被重写时
`base-commit ancestor` 检查失败。均通过确定性测试，但**没有**在真实合并上运行过。

---

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

| # | 项 | 状态 | 证据 |
|---|---|---|---|
| 8.1 | 一个 Agent 等审批、另一个继续 | **PARTIAL** | 调度器按 Agent 串行、跨 Agent 并行（`selectStartableTasks` + `tests/r1-concurrency.test.ts`）；本轮未新增实时用例 |
| 8.2 | Runtime 强杀恢复 | **PARTIAL（既有机制）** | `needs_reconciliation` 路径未改，`tests/recovery.test.ts`；本轮新增"重复自动修订不重放"的确定性覆盖 |
| 8.3 | SSH 只读对账 | **SKIP** | 需要连接到用户 VPS；按规范先说明，未擅自扩大远端权限。机制未改动（2.5 报告与 `tests/ssh-adapter-e2e.test.ts` 为既有证据） |
| 8.4 | 工作中心 UX | **PASS** | 见 §15；9/9 真实 Electron 检查通过 |

---

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
| B | **代码修复 + 测试 exit 1 → exit 0** | **FAIL** | 真实运行（无一次 exit 0） |
| B | **当前内容自动复审通过** | **FAIL** | 复审被触发，但复审结论仍为 changes-requested（因为代码没修） |
| B | **GateEvaluation 通过** | **BLOCKED** | 计划未完成 |
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

### 17.3 是否可以将 Phase 2 自主研发主链标记为 PASS

**不能。** 依据本轮自己的验收标准（§十二）：

- ✅ 真实 DeepSeek 完成缺陷发现（审查给出精确缺陷）
- ✅ 相同测试确实失败（exit 1）
- ✅ 产品自己安排复审（不依赖脚本）
- ❌ 修复后测试未变成 exit 0（Replanner 未修代码）
- ❌ 没有 Merge Commit、没有 mergedAt、没有合并后验证
- ✅ E2E 没有替产品调用 Replan Apply / Scheduler Start / Merge
- ✅ 修订次数与重复事件受到可靠限制（真实达到上限并停止）

因此：**Phase 2 自主研发主链 = FAIL/BLOCKED**。阻断点是"修订没有修代码"，已定位到具体机制并给出
修复（ADR-0034），但未复验，故不宣称收口。**不进入 Phase 3。**

### 17.4 质量门（绑定本轮 HEAD）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS（0 error / 22 warning，边界 OK） |
| `pnpm test` | PASS（403 passed / 4 skipped；8 个新增 2.8.8 测试文件）。注：一次在全量测试与 Electron E2E 并行时 `r1-budgets` 出现计时抖动，单独及清洁环境下均 PASS |
| `pnpm build` | PASS |
| `pnpm package:dir` | PASS |
| `pnpm test:package` | PASS |
| 真实 Electron + DeepSeek PRODUCT_AUTONOMOUS | **FAIL（未达最终交付）**，证据见 §6/§7/§17.2 |
| 工作中心 UI（真实 Electron 9/9） | PASS |
