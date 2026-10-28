# ProjectOS V2.0 Phase 2.8.2 — 低人工干预、自主恢复与目标级交付闭环（报告）

**分支**：`v2.0-phase2.8.2`（恢复点 tag `phase2.8.2-base` = `3b6b411`）
**代码 HEAD**：`6395e33`
**日期**：2026-10-28（America/Los_Angeles）
**前提**：V34、PlanGrant、AutonomyCoordinator、Action Center、Worktree、真实 DeepSeek 多 Agent 链路、SSH 部署能力全部保留；本轮回退为零。

---

## 1. 一句话结论

**低干预目标达成**：一次计划批准 + 一次授权后，真实双 Agent 在授权范围内完成研发，**`write_file` 审批 = 0**、**重复命令审批 = 0**、**手动合并 = 0**、**手动推进阶段 = 0**。

**自动 Replan 被真实触发**（`evidence_exhausted`，修订 revision=2 已应用），但**修复闭环没跑完**：暴露出一个真实设计冲突（验收型任务要求"通过的测试报告"，而它的职责恰恰是报告失败），因此 B 判定 **FAIL**。

---

## 2. Git 状态

| 项目 | 值 |
|---|---|
| 分支 | `v2.0-phase2.8.2` |
| 恢复点 | `phase2.8.2-base` = `3b6b411` |
| 本轮代码提交 | `6395e33` `feat(phase2.8.2): reuse identical command approvals per plan, add low-intervention E2E` |
| 工作树 | clean |
| Schema | **V35**（additive；V33/V34 未改；已发布迁移未修改） |

## 3. 本轮实际修复的产品缺陷

### 3.1 同一命令被反复要求审批（重复人工介入）

Phase 2.8.1 的取证显示：两个场景共产生 **19 条命令审批**，其中 `npm test` 出现 **5 次**、同一 `sha256` 校验命令出现 **3 次**。人工批准过的、完全相同的命令仍被反复要求批准，这是产品摩擦，不是安全需要。

实现（V35 + `plan-grant.ts` + `agent-runner.ts`）：

- 新增 `plan_command_approvals` 表：`(plan_id, agent_id, tool_name, command_hash)` 唯一，带 `expires_at`、`uses`。
- 人在计划内批准某条 `run_command`/`run_tests` 时，记录该**完全相同命令**的授权。
- 后续同一 Agent 在同一计划内再次调用**同一命令** → 直接 `allow`，返回理由
  `复用该计划内已批准的完全相同命令（审批 …，剩余有效期内）`。
- 命令只要有一个字符变化（或换 Agent、换计划、过期）→ 仍然逐次审批。

**没有**放宽任何边界：不是命令前缀白名单，不匹配 `npm run *` 之类的任意脚本，不覆盖 `git` 写操作、网络、敏感文件或破坏性命令；敏感路径（auth/permission/security/crypto）规则原样保留。

### 3.2 目标级工作中心（P1 体验）

研发工作中心已按"一个真实目标"展示：NEXT STEP 面板给出**阻塞项、原因、需要你做什么、处理后会自动推进什么、去处理入口**，并显示当前计划、真实执行状态、成果计数。见第 7 节截图。

## 4. 验收 A：非敏感文件连续低干预研发 —— **PASS**

真实 Electron + 真实 DeepSeek（`deepseek-flash`）+ 真实 Git 仓库；夹具刻意使用**非敏感**命名 `src/formatting.mjs` / `tests/formatting.test.mjs`（不触发 critical grant path 规则）。

| 证据 | 值 |
|---|---|
| 真实 Planner | `source=provider`，2 任务 |
| 计划批准 | 1 次 |
| PlanGrant 签发 | 1 次（`allowedPaths=[src,tests]`） |
| 计划终态 | `completed` |
| **`write_file` 审批次数** | **0** |
| **重复命令审批** | **0**（总审批 5 = `run_tests` 3 + `run_command` 2） |
| 真实代码改动 | `M src/formatting.mjs` |
| 真实 Agent 数 | 2（Developer + Tester） |
| 手动合并 / 手动推进阶段 / 手动恢复 | 0 / 0 / 0 |

对照 Phase 2.8.1：`write_file` 2 次（因文件名撞敏感规则）、命令审批 16 条且大量重复。**这两项现在都归零。**

## 5. 验收 B：真实失败 → 自动 Replan —— **FAIL（部分达成）**

确定性夹具：`src/visibility.mjs` 忽略 owner 规则，`tests/visibility.test.mjs` 的三条断言中两条必然失败。

已达成：

| 步骤 | 证据 |
|---|---|
| 夹具真实失败 | 基线 `npm test` 退出码 **1** |
| 真实 Planner | 2 任务，开发者 + 测试者 |
| 测试者执行真实测试并报告失败 | 任务证据不足被判定 |
| **自动 Replan 真实产生** | `proposals=1`，`trigger=evidence_exhausted`，`status=proposed` |
| 修订已应用 | `revision=2` |

未达成：

| 步骤 | 结果 |
|---|---|
| 修复计划完成 | `status=paused` |
| 同一测试在修复后通过 | `npm test exit=1` |

### 5.1 根因（真实设计冲突，非测试脚本问题）

计划暂停的原因是：

```
任务「运行 npm test 并如实报告失败结果」缺少有效完成依据：
预期产物：测试报告：缺少已验证测试报告、质量门禁通过或成功的 run_tests
```

即：完成证据门禁要求验收型任务必须产出**通过的**测试报告，而该任务的职责恰恰是"运行测试并如实报告失败"。**它的合法产出是一个失败结果**，永远无法满足"通过的测试报告"，于是任务必然阻塞、计划必然暂停，修复环节拿不到上游结论。

这不是放宽门禁能糊过去的问题：门禁本身是对的（防止伪造通过）。缺的是**"负向验证"这一任务类型**——应当允许某类任务以"记录了失败输出与退出码"作为合格证据，而不是要求它通过。

**未修**：这属于验收语义的扩展，需要新 ADR 级决策（涉及 CompletionDecision 的证据判定），本轮不擅自放宽门禁以免削弱安全边界。记为 FAIL + 明确下一步。

## 6. 人工介入统计（真实点击）

| 指标 | 数值 |
|---|---|
| 计划批准次数 | 3（A 1 次；B 初始 1 次 + 修订 1 次） |
| PlanGrant 签发次数 | 3 |
| 实际工具审批点击 | 13 |
| 自动授权覆盖的写入 | **全部**（`write_file` 审批 0） |
| 必须逐次审批的敏感/进程操作 | B 场景的测试与命令（首次） |
| 重复审批 | **0** |
| 手动推进阶段 | 0 |
| 手动恢复 Agent | 0 |
| 手动合并 Worktree | 0 |

区分结论：
- **安全策略要求**的介入：B 场景中"报告失败"任务的证据缺失（真实设计缺口，见 5.1）。
- **产品流程不合理**造成的介入：原先 19 条命令审批中的 8 条重复，本轮已消除。

## 7. Electron 实际截图

`docs/screenshots/p282-01-work-center.png`（1440×900，真实 Electron）：

- NEXT STEP：`版本 v0.1.0 无法进入开发中` / 低风险 / `缺少 review_record (需要 passed/self_declared)` / 需要你：补齐证据后推进 / 处理后：门禁通过后可由系统自动推进，无需手动点击阶段按钮 / **去处理**
- 当前计划：`r1 · 已批准`，目标文本、`2 个节点 · AI 生成 · deepseek-flash`
- 计数：需求 0 / 待审批 0 / 待验收 0 / 运行中 0 / 成果 7

## 8. PASS / FAIL / SKIP / BLOCKED

| 项目 | 状态 |
|---|---|
| A. 非敏感文件连续低干预研发（write_file 审批=0） | **PASS** |
| A. 重复命令审批复用 | **PASS**（重复=0） |
| B. 真实失败触发自动 Replan | **PASS** |
| B. 修订计划应用 | **PASS** |
| B. 修复后同一测试通过 | **FAIL**（证据门禁用例冲突，见 5.1） |
| C. 有任务等待审批时其他任务继续 | **SKIP**（本轮未构造） |
| D. Runtime 强杀恢复 + 事件幂等 | **SKIP**（本轮未构造） |
| E. 授权范围内受控自动 Worktree 交付 | **SKIP**（本轮未实现自动合并策略） |
| F. SSH 未知结果只读对账现场验证 | **SKIP**（需远端写授权） |
| G. 工作中心目标级视图 | **PASS** |
| `pnpm typecheck` | **PASS** |
| `pnpm lint` | **PASS**，0 error / 15 既有 warning，边界 OK |
| `pnpm test` | **PASS**，300 passed / 4 skipped |
| `pnpm build` | **PASS** |
| `pnpm package:dir` / `test:package` | **SKIP**（本轮未跑） |
| 1024 / 1440 / Light-Dark / 125% | **SKIP**（本轮未跑） |

## 9. 未完成项及真实原因

1. **负向验证任务类型缺失**（B 的根因）：验收门禁只认"通过的测试报告"。需要新决策：为显式声明为 verification 的任务允许"失败结果 + 退出码"作为合格证据。本轮不擅自放宽。
2. **C/D 未验证**：并行与强杀恢复需要专门构造，本轮时间用于 A/B 与命令复用。
3. **E 自动交付未实现**：`worktrees.merge` 仍是显式步骤；本轮未引入项目级交付策略与自动合并。
4. **F 未做**：SSH 对账需要真实 `needs_reconciliation` 场景，可能涉及远端写操作，需先取得授权。
5. **打包与视觉矩阵**未跑。

## 10. 是否具备 Phase 2 收口条件

**接近，但还不能收口。**

已经成立：一次授权下的连续研发（零写入审批、零重复审批、零手动推进、零手动合并），真实双 Agent、真实代码、真实测试、真实计划完成，以及目标级工作中心。

阻断收口的唯一硬缺口：**失败 → 自动修复 → 重新通过**这一段在证据语义上走不通（5.1）。修好它，Phase 2 的自主研发闭环才算真正闭合。

**Phase 2.8.2 到此停止，不进入 Phase 3。**
