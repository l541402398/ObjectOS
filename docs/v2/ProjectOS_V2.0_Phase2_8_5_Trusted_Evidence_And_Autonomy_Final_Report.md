# ProjectOS V2.0 Phase 2.8.5 — 审查语义、可信证据链与自主研发最终闭环（报告）

**分支**：`v2.0-phase2.8.5`（恢复点 tag `phase2.8.5-base` = `c2dc8a8`，与 GitHub `origin/v2.0-phase2.8.4` 一致）
**日期**：2026-10-28（America/Los_Angeles）
**Schema**：V36（未新增迁移）

---

## 1. 结论摘要

| 项 | 结果 |
|---|---|
| ① Review 完成语义（发现缺陷也能完成审查） | **PASS** |
| ② 有效参数规范化（run_tests 空命令） | **PASS** |
| ③ V36 上下文指纹 fail-closed | **PASS** |
| ④ Review 负向结论传递到 Replan | **PASS** |
| ⑤ 真实 DeepSeek 完整闭环（测试 1 → 修复 → 测试 0） | **FAIL（未跑完，见第 6 节）** |
| ⑥ 可信 Review Evidence（对象真实性校验） | **未实现** |
| ⑦ 任务契约预检 | **未实现** |
| 自动交付 / 并行 / 强杀 / 幂等 / SSH 对账 | **SKIP** |

确定性回归：**320 passed / 4 skipped**（新增 10 项）。

---

## 2. 本轮修复的源码缺陷

### 2.1 Review 完成语义（`packages/application/src/completion-evidence.ts`）

原实现把"证据是否有效"和"审查是否通过"塞进同一个过滤条件：

```
!blocking && !rejected
```

结果是：审查员真实完成审查、并在报告里指出缺陷时，任务反而无法完成——与 ADR-0022 直接冲突。

**修复**：拆成两层

- `reviewArtifacts`：只校验证据有效性（artifactType=review、reviewedObjects 非空、scope、findings 为数组、conclusion 非空、blockers 为字符串数组、有 runId 或人工创建）；
- `reviewVerdictOf()`：独立给出 `approved | changes_requested | blocked`；
- `hasReview`（任务完成）只看证据有效；`review.approved` 单独暴露；
- `CompletionDecision` 新增 `review?: { performed, approved, blockingFindings }`。

同时按用户要求放开"空 findings"：诚实且无问题的审查可提交 `findings: []`，**不再要求 Agent 编造一条"无问题"发现**，系统也不代写任何结论。

判定规则采用保守口径：明确的否定措辞（阻断/不通过/拒绝/需要修改/不可放行/fail/reject…）或**非"无"的 blocker** 才算未通过；中性措辞（未发现问题）视为通过。

### 2.2 负向审查必须传递给 Replan（`apps/runtime/src/orchestrator.ts`）

计划全部任务完成时，除真实失败检查外，新增 `negativeReviews(plan)`：存在"有效但不通过"的 review 产物 → 计划 `paused`、错误信息列出审查标题与结论、触发 `notifyReplan('evidence_exhausted')`、写入 `planExecutionFailureClassified`。

**审查任务完成 ≠ 成果通过门禁**：因为从未写入 passed 证据，质量门禁与合并没有被放行。

### 2.3 有效工具参数规范化（`apps/runtime/src/agent-runner.ts`，ADR-0023）

真实缺陷：`run_tests` 不带 `command` 时实际执行 `pnpm test`，但 Policy / PlanGrant / ApprovalRequest / 审计看到的是**空命令**，导致审批界面显示"未提供"、E2E 无法匹配、命令复用无法记录、Run 长期挂起在 `waiting_approval`。

**修复**：新增 `resolveEffectiveToolArgs(toolName, rawArgs)`，在**任何安全决策之前**统一解析默认值；此后 Policy、PlanGrant、审批请求、审批快照、ToolCall 审计、ToolHandler 执行全部使用同一组有效参数（`invocationEffective`），原始入参不再被单独使用。

**实测生效**：本轮 E2E 中审批不再卡在空命令，`run_tests` 的正确解析为 `pnpm test` / `node --test tests/*.test.mjs`。

### 2.4 V36 上下文指纹 fail-closed（`apps/runtime/src/plan-grant.ts`）

原 `executionContextFingerprint` 在读取 `package.json` 或入口文件失败时**吞掉异常继续拼接**，等于生成"不完整但仍可用"的指纹。

**修复**：`package.json` 或 `node <entry>` 入口不可读 → 返回 `null`（不可验证）→ `commandApproval` 收到无指纹直接删除复用记录并**要求重新审批**。命令复用不再可能退化为"仅命令字符串匹配"。

### 2.5 顺带修掉的误判（本轮真实运行发现）

`failingVerifications` 原先把任何非零退出码都当作验证失败，导致 `git diff --no-index`（文件不同即退出 1，属只读信息）把计划误判为"验证未通过"。

**修复**：只把真正的验证命令计入——`run_tests`，以及 `npm/pnpm/yarn test|run test`、`vitest|jest|mocha`、`node --test`、`test|build|typecheck|lint` 脚本、`tsc`。其余命令的退出码不再影响计划结论。

## 3. 确定性回归（第一阶段）

`tests/p285-review-and-effective-args.test.ts`（10 项，全部通过）：

- 审查报告"需要修改" → 任务可完成、`review.approved === false`；
- 正向审查 → 完成任务且 `approved === true`；
- `findings: []` 的干净审查 → 可完成（不要求编造 finding）；
- `reviewedObjects: []` → 拒绝；无 conclusion → 拒绝；
- 非审查角色的任务不能靠 review 产物完成；
- `run_tests` 空参数 → `pnpm test`；显式命令保留；`run_command` 去空格；不修改原始入参。

被新语义影响的既有测试已按 ADR-0022 更新（`agent-completion-tool.test.ts` 的 blocking-review 用例：任务可完成，但不得声称质量通过）。全套 **320 passed**。

## 4. 真实 DeepSeek 闭环证据（运行 `p285-ui3`）

真实 Electron + 真实 DeepSeek（`deepseek-flash`）+ 真实 Git + 真实 `npm test`。

| 步骤 | 证据 |
|---|---|
| 夹具真实失败 | 基线 `npm test` **exit=1** |
| Planner | `source=provider`，2 任务 |
| QA 任务诊断意图 | `tsk_01m61em7jbsjxkzmyknk8s2eyc`，`workType=diagnostic` |
| 诊断合法完成 | 计划 `paused`，`验证未通过：node --test tests/*.test.mjs（退出码 1）、npm test（退出码 1）` |
| 自动 Replan | `proposals=1`，`trigger=evidence_exhausted` |
| 修订应用 | `revision=2` |
| **修订生成了真实修复任务** | 任务「按 tests/visibility.test.mjs 修复 src 中的 ca…」状态 `running`；后续「独立复跑 npm test 并确认全绿」`backlog` |
| 修复是否跑完 | **未跑完**：到 900s 有界等待上限时修复任务仍在执行 |

对比 2.8.4：上一轮修订只产出"范围决策"任务且全部 blocked；本轮在目标允许修复的前提下，Replanner **确实生成了针对 `src/visibility.mjs` 的修复任务并开始执行**。

## 5. 人工介入

| 指标 | 数值 |
|---|---|
| 计划批准 | 2（初始 + 修订） |
| PlanGrant 签发 | 2 |
| 工具审批点击 | 26（脚本自动点击） |
| 手动合并 / 手动推进阶段 | 0 / 0 |

## 6. 为什么⑤记为 FAIL

不是产品逻辑失败，是**有界等待不够**：修复任务比前几轮更"重"（26 次工具调用），900 秒时仍在执行中，脚本按设计放弃等待并关闭应用。

要拿到 `exit 0` 的完整证据，需要：把该场景的有界等待提高到 25–30 分钟并有针对性放宽——不是放宽安全边界，而是给真实模型更多执行时间。

## 7. 未完成项

1. **可信 Review Evidence**（P0-2）：`reviewedObjects` 目前只校验"非空"，未校验其指向的文件/Commit/Artifact 是否真实存在、是否属于本项目、审查后代码是否变化。这是下一轮必须补的。
2. **任务契约预检**（P0-5）：在执行前判断"任务要求的证据是否有 Agent 能产出"仍未实现。
3. **第二轮真实 E2E**：需更长的有界等待才能拿到 `exit 0`。
4. 自动交付、并行、强杀恢复、事件幂等、SSH 对账、打包与 125% 视觉回归：全部 SKIP。
5. 独立审查者约束（被审查代码不得自我宣布通过）未单独实现。

## 8. 质量门

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | **PASS** |
| `pnpm lint` | **PASS**，0 errors / 16 warnings（既有），边界 OK |
| `pnpm test` | **PASS**，320 passed / 4 skipped |
| `pnpm build` | **PASS** |
| `pnpm package:dir` / `test:package` | **SKIP** |
| Electron 截图 / 125% 视觉回归 | **SKIP** |

## 9. 是否具备 Phase 2 收口条件

**仍不具备，但阻断面已经收窄到两件可执行的事：**

1. 给真实 E2E 更长的有界等待，拿到 `exit 1 → 修复 → exit 0 → Gate 通过 → 交付` 的完整时间线；
2. 补上 Review Evidence 的**对象真实性**校验与任务契约预检。

本轮已经把三层语义彻底分开并落到了代码与测试里：
**任务完成 ≠ 审查通过 ≠ 质量门禁通过**，且**工具原始参数 ≠ 有效执行参数**、**命令文本相同 ≠ 执行语义相同**。

**Phase 2.8.5 到此停止，不进入 Phase 3。**
