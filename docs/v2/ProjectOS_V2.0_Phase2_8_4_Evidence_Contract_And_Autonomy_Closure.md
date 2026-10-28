# ProjectOS V2.0 Phase 2.8.4 — 统一任务证据契约与真实自主修复闭环（报告）

**分支**：`v2.0-phase2.8.4`（恢复点 tag `phase2.8.4-base` = `d13f584`）
**日期**：2026-10-28（America/Los_Angeles）
**前提**：V34/V35/V36、ADR-0021、PlanGrant、AutonomyCoordinator、Action Center、Worktree、真实 DeepSeek 链路全部保留；无回退。

---

## 1. 结论摘要

| 轨道 | 结果 |
|---|---|
| A. 统一任务/证据契约 + 真实审查证据 | **PASS（核心修复）/ FAIL（完整链路未跑通）** |
| B. V36 审批复用安全（fail-closed） | **PASS** |
| C. 可靠性与 SSH 对账 | **SKIP** |
| D. 自动交付与工作中心 | **SKIP** |

---

## 2. Git

| 项目 | 值 |
|---|---|
| 分支 | `v2.0-phase2.8.4` |
| 恢复点 | `phase2.8.4-base` = `d13f584` |
| 远端 | **未推送**（见第 8 节） |
| 工作树 | 提交后 clean |

## 3. A 轨道：找到并修复了真正的领域缺陷

### 3.1 根因：系统在**伪造审查证据**

对 `apps/runtime/src/agent-runner.ts` 做源码级检查，发现
`normalizeReviewArtifactMetadata`：当产物标题含"审查/评审"且未给 `artifactType` 时，它自动编造：

```
artifactType: 'review'
reviewedObjects: [uri ?? 'workspace']   ← 编造被审查对象
findings: body 前 8 行 或 [title]        ← 编造发现
conclusion: body 文本 或 title           ← 编造结论
blockers: ['无阻塞项']                    ← 编造"无阻塞"
```

这正是用户明令禁止的"插入空 findings、虚假 conclusion 或伪造 passed Artifact"。
它让审查任务**看起来**有证据，而证据内容是系统写的，不是 Agent 判断的。

### 3.2 修复（ADR-0022）

`docs/adr/0022-task-evidence-contract.md`

1. **删除伪造逻辑**，系统不再补写任何审查字段；
2. 改为**严格校验 + 字段级错误回传**：`artifactType=review` 时校验
   `reviewedObjects`（非空数组，真实对象）、`scope`（非空）、`findings`（非空数组）、
   `conclusion`（非空）、`blockers`（字符串数组）；
3. 不合格时抛 `BAD_REQUEST`，逐字段列出缺失项作为**工具结果回传给 Agent**，
   让它在预算内自行修正输出格式，而不是让用户手工填 JSON；
4. `metadata` 原样入库，无隐式规范化。

**不变量**：审查任务可以合法完成于"需要修改 / 阻断交付"（发现问题 = 审查成功），
但质量门禁不得因此通过；无效产物不落库，不产生半成品证据。

## 4. B 轨道：V36 审批复用改为 fail-closed

`apps/runtime/src/plan-grant.ts` 的 `commandApproval` 原逻辑在
`workspaceRoot` 缺失或 `context_hash` 为空时**退化到仅按命令字符串复用**——这正是用户点名的"失败降级"。

改为：

- 无法取得 `workspaceRoot` → 删除该复用记录，**要求重新审批**；
- 记录无 `context_hash` → 同上；
- 重算指纹不一致（package.json / 入口文件变化）→ 删除并要求重新审批。

即：**不能证明执行语义一致，就一律重新授权**。敏感路径、网络、凭据、危险命令的既有保护未改动。

## 5. 真实 E2E 结果（本轮）

使用 `scripts/phase2.8.3-diagnostic-closure-e2e.mjs`（真实 DeepSeek、真实 Git、真实 `npm test`）。

| 步骤 | 结果 |
|---|---|
| 基线 `npm test` | **exit=1**（PASS） |
| 真实 Planner 生成 2 任务 | PASS |
| QA 任务声明 `diagnostic` | PASS |
| 本轮运行到达 | 计划仍在 `running`，开发者的 `run_tests` 停在 `waiting_approval` |
| 自动 Replan 提案 | **未产出**（计划未到终态） |

**根因（本轮运行）**：开发者调用 `run_tests` 时未传 `command` 参数（工具默认 `pnpm test`），
审批载荷里 `command` 为空，测试脚本的白名单正则无法匹配，因此该审批一直挂起，最终撞到 900s 上限。

这是**验收脚本的判定缺陷**（应把"空 command 的 run_tests"按工具默认语义处理或直接放行只读测试），
不是产品逻辑缺陷；但它导致本轮**未能**产出"修复后测试通过"的端到端证据。

因此 A 轨道如实记为：**核心缺陷修复 PASS，完整闭环 FAIL（脚本侧阻塞）**。

## 6. 质量门

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | **PASS** |
| `pnpm lint` | **PASS**，0 errors / 16 warnings（均既有），边界 OK |
| `pnpm test` | **PASS**，310 passed / 4 skipped |
| `pnpm build` | **PASS** |
| `pnpm package:dir` / `test:package` | **SKIP** |
| 1024 / 1440 / Light / Dark / 125% | **SKIP** |
| Electron 截图 | **SKIP**（本轮无 UI 改动） |

## 7. 未完成项

1. **完整修复闭环**：需要修好 E2E 的 `run_tests` 空命令处理后再跑一次，才能拿到
   `测试 1 → 修复 → 测试 0 → Gate → 交付` 的完整证据。
2. **任务契约预检**（用户 P0 第一条）：Planner 生成任务后、批准前的能力/证据可行性检查尚未实现；
   本轮只实现了"证据不合格时拒绝并给出字段级错误"这一半。
3. **C 轨道全部 SKIP**：并行、强杀恢复、事件幂等、SSH 只读对账。
4. **D 轨道全部 SKIP**：自动 Worktree 交付、工作中心 UX 收口。
5. **审查任务的独立约束**（被审查代码不得自我宣布通过）尚未单独加校验。

## 8. 关于推送

`origin` = `https://github.com/l541402398/ObjectOS.git`（公开仓库）。
本轮**未推送**：提交历史与环境痕迹（E2E 数据目录、`%APPDATA%` 引用等）需要单独脱敏审计，
且本会话没有用户对公开推送的明确授权。本地 HEAD 与提交清单见第 2 节，可直接审阅。

## 9. 是否具备 Phase 2 收口条件

**仍不具备。**

本轮的价值是把"自主链为何反复卡住"的**真实原因挖到了底**：不是 Planner 不行，也不是 Agent 不行，
而是**系统在伪造审查证据**让任务假通过、以及证据契约与任务职责不匹配。
伪造逻辑已删除并改为严格校验，这是收口前必须清掉的地基问题。

剩下的就一件事：**把契约校验反馈闭环跑通一次**（Agent 收到字段级错误 → 自行补齐 → 审查任务合法完成 →
修复 → 测试转绿 → 门禁通过 → 交付）。这需要修好验收脚本并再跑一轮真实 E2E。

**Phase 2.8.4 到此停止，不进入 Phase 3。**
