# ProjectOS V2.0 Phase 2.8.3 — 负向验证语义修复、自主研发闭环与收口（报告）

**分支**：`v2.0-phase2.8.3`（恢复点 tag `phase2.8.3-base` = `63453d1`）
**日期**：2026-10-28（America/Los_Angeles）
**前提**：V34/V35、PlanGrant、AutonomyCoordinator、Action Center、Worktree、真实 DeepSeek 多 Agent 链路、SSH 部署能力全部保留；无回退。

---

## 1. 结论摘要

| 验收 | 结果 |
|---|---|
| A. 负向验证任务可合法完成、Quality Gate 不误通过 | **PASS** |
| B. 真实失败 → 自动 Replan → 修订应用 | **PASS** |
| B. 修订后修复 → 重新验证通过 → 交付 | **FAIL**（卡在修订计划新增的审查证据契约） |
| C. V35 审批复用随执行语义失效 | **PASS**（单测级，4 项） |
| D. 自动补证与版本门禁联动 | **SKIP** |
| E. 自动 Worktree 交付 | **SKIP** |
| F. 并行 / 强杀恢复 / 幂等 | **SKIP** |
| G. SSH 未知结果只读对账 | **SKIP** |
| H. 工作中心与 Action Center | 沿用 Phase 2.8.2（本轮未改） |

真实 E2E 最终：**9 PASS / 3 FAIL / 0 BLOCKED**（3 个 FAIL 同源，见第 5 节）。

---

## 2. Git

| 项目 | 值 |
|---|---|
| 分支 | `v2.0-phase2.8.3` |
| 恢复点 | `phase2.8.3-base` = `63453d1` |
| 远端 | `origin` = `https://github.com/l541402398/ObjectOS.git`（本轮**未推送**，见第 9 节） |
| 工作树 | 提交后 clean |
| Schema | **V36**（additive；V33–V35 未修改） |

## 3. 本轮修复的领域缺陷

### 3.1 负向验证语义（ADR-0021）

`docs/adr/0021-diagnostic-verification-intent.md`

**问题**：Tester 的职责是"运行 `npm test` 并如实报告失败"，它确实拿到退出码 1，但完成判定要求"通过的测试报告"，于是诊断任务永远无法完成，Replan 修订无法推进。

**解决**：引入**显式验证意图** `workType='diagnostic'`（不按标题猜测）：

- `diagnostic`：带**真实退出码**（0 或非 0）的已完成 `run_tests`/`run_command` 即满足其完成条件；
- 其它（默认）：维持"测试必须通过"。

**不变量**（`tests/p283-diagnostic-completion.test.ts` 6 项全绿守住）：

1. 诊断完成**不写** `hasTest` → Quality Gate 不可能因此通过；
2. 失败结果不被改写为通过，不新增 passed Artifact；
3. 无 `exitCode` 不算证据；
4. 意图必须显式；仅凭标题（"测试/失败/检查"）**不会**被判为诊断。

### 3.2 计划不得因"诊断完成"而谎报成功

`apps/runtime/src/orchestrator.ts` 新增 `failingVerifications(plan)`：当计划所有任务 `done` 时，检查真实记录里是否存在**未被后续通过运行覆盖的非零退出码**；若有：

- 计划置 `paused`，错误信息带**具体命令与退出码**；
- 触发 `notifyReplan(plan, 'evidence_exhausted', reason)`（该触发的事实断言与"暂停 + 真实失败证据"匹配）；
- 写入 `planExecutionFailureClassified` 事件。

实测输出：`验证未通过：npm test（退出码 1）`。

### 3.3 失败分类器不认"验证未通过"

`apps/runtime/src/failure-classifier.ts` 的 `implementation` 规则原本只认 `exit code`/`测试失败` 等，中文"退出码""验证未通过"落到 `unknown` → `replan:false` → **Replan 被静默抑制**。已把这三种表述并入 `implementation`。

### 3.4 V35 审批复用的执行语义校验（P0-3）

相同命令字符串 ≠ 相同执行语义。新增 `executionContextFingerprint`：

- 覆盖 tool 名、命令文本、`package.json` 内容哈希、`node <entry>` 的入口文件哈希；
- V36 为 `plan_command_approvals` 增列 `context_hash`；
- 复用前重算，不匹配则**删除该复用记录并要求重新审批**；
- 记录时若拿不到 workspace 则退化为命令级（保守）。

单测（`tests/p283-command-context.test.ts` 4 项全绿）：package.json 改动失效、入口文件改动失效、tool/命令不同即不同。未经授权的 Shell、网络、凭据、敏感路径规则**未放宽**；敏感路径（auth/permission/security/crypto）仍逐次审批。

## 4. 真实 DeepSeek 闭环证据（本次运行 `p283-ui7`）

真实 Electron + 真实 DeepSeek（`deepseek-flash`）+ 真实 Git 仓库 + 真实 `npm test`。

| 步骤 | 证据 |
|---|---|
| 夹具真实失败 | 基线 `npm test` **exit=1** |
| 真实 Planner | `source=provider`，2 任务（dev → qa） |
| 测试任务声明诊断意图 | `task=tsk_01m618zcfedyqe4eb96vkdv3ef`，`workType=diagnostic` |
| **诊断任务合法完成** | 计划进入 `paused`，错误 `验证未通过：npm test（退出码 1）` —— 不再无限卡死，也不再谎报 completed |
| **自动 Replan 真实产生** | `proposals=1`，`trigger=evidence_exhausted` |
| **修订已应用** | `revision=2` |
| 修复计划 | `paused`：`任务「核对 npm test 失败与需求范围的符合性并给出人工决策项」缺少有效完成依据：预期产物：审查报告…缺少审查/评审 Artifact` |

与 Phase 2.8.2 对比：2.8.2 卡在"必须通过"的证据语义（无法推进）；本轮**该问题已消除**，链路推进到了修订计划的执行阶段。

## 5. FAIL 的真实原因

3 个 FAIL 同源：修订计划由真实 Replanner 生成，**新增了一个架构师审查任务**，其预期产物是"审查报告"，而当前 TaskCard/完成证据要求的是结构化 review Artifact（`artifactType=review` + reviewedObjects/scope/findings/conclusion/blockers）。执行该任务的 Agent 没有产出符合该结构化的审查 Artifact，因此任务阻塞、修复任务未执行、测试仍失败。

这与 2.8.2 的缺陷性质相同、层级不同：**同样是"任务职责与其证据契约不匹配"**，对象从"测试任务"变成了"审查任务"。按本轮纪律，不擅自放宽 review 契约（它在防止伪造评审），因此记为 FAIL 并保留证据。

**下一步（需决策）**：为审查类任务定义可机器验证的 review Artifact 契约（例如由 Agent 产出结构化 JSON 并带 reviewedObjects 指向真实 Diff/Commit），或允许系统用真实事实（Diff + 测试输出 + 运行记录）**自动合成**只读审查证据。后者更符合"AI 自主补证"，但需要 ADR 级别的证据可信度定义。

## 6. 人工介入统计（真实点击，本次运行）

| 指标 | 数值 |
|---|---|
| 计划批准 | 2（初始 + 修订） |
| PlanGrant 签发 | 2 |
| 工具审批点击 | 12 |
| 手动合并 | 0 |
| 手动推进阶段 | 0 |
| AI 自动完成 | Planner 生成、双 Agent 执行、诊断完成、失败判定、Replan 提案、修订应用 |

## 7. 质量门

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | **PASS** |
| `pnpm lint` | **PASS**，0 errors / 16 warnings（均既有），边界 OK |
| `pnpm test` | **PASS**，**310 passed / 4 skipped**（新增 10 项） |
| `pnpm build` | **PASS** |
| `pnpm package:dir` / `test:package` | **SKIP**（本轮未跑） |
| Electron UI 截图 | **未生成**（本轮聚焦链路，未做视觉回归） |
| 1024 / 1440 / Light / Dark / 125% | **SKIP** |

## 8. 未完成项

1. **审查任务证据契约**（第 5 节）—— 阻断 B 的最后一跳，也阻断 Phase 2 收口。
2. **D/E/F/G/H 全部 SKIP**：自动补证、自动 Worktree 交付、并行/强杀/幂等、SSH 对账、工作中心本轮均未验证。
3. 打包与视觉矩阵未跑。

## 9. 关于远端推送

`origin` 指向公开仓库 `github.com/l541402398/ObjectOS`。本轮**未推送**：仓库历史中包含 E2E 数据目录路径、`%APPDATA%` 引用与 provider 配置文件名等开发痕迹，推送前需要一次独立的脱敏检查；同时本会话没有用户对"公开推送"的明确授权。按纪律不擅自推送。

## 10. 是否具备 Phase 2 收口条件

**尚不具备。**

已闭环：**发现失败 → 负向证据 → 诊断任务合法完成 → 计划拒绝谎报成功 → 自动 Replan → 修订应用**。这是本轮最关键的语义修复，已真实验证。

仍缺：**修订计划中的新任务（审查）能被合法完成，进而驱动真实修复与重新验证**。它与 2.8.2 的问题是同一类：任务职责与证据契约的匹配。修好这一类，Phase 2 的自主研发闭环才算真正闭合。

**Phase 2.8.3 到此停止，不进入 Phase 3。**
