# ProjectOS V2.0 Phase 2.8 — 真实多 Agent 自主研发闭环与低人工干预（最终报告）

**分支**：`v2.0-phase2.8`（恢复点 tag `phase2.8-base` = `b825e24`）
**代码 HEAD**：`2dc6730`
**日期**：2026-10-28（America/Los_Angeles）
**前提**：Phase 2.5 / 2.6 / 2.7 成果全部保留，无回退。

> **结论先行**：本轮**未达到** Phase 2.8 的核心验收标准。
> 验收 A（低干预真实多 Agent 研发闭环）**FAIL**，验收 B（中断/审批/自动恢复）中
> 「真实 Provider 单 Run 暂停→铃铛→批准→自动恢复」**已在 Phase 2.7 通过并保留**，
> 但「授权范围外暂停」「无依赖任务并行」「强杀恢复」「SSH 对账」本轮**未重新验证**。
> 本轮实际交付的是 1 项真实缺陷修复（有现场证据）与 1 项机制核实。
> 以下逐项标注 PASS / FAIL / SKIP / BLOCKED，不以单测或假 Provider 充数。

---

## 1. 最终 Git HEAD 与提交记录

| 项目 | 值 |
|---|---|
| 分支 | `v2.0-phase2.8` |
| 恢复点 | tag `phase2.8-base` = `b825e24` |
| 本轮提交 | `2dc6730` `fix(phase2.8): resolve cross-version trusted running version in deployment console` |
| 工作树 | clean |
| Schema | 无新迁移（保持 V34） |

Phase 2.5–2.7 提交链完整保留：`8579016 → … → 4dd20ab → 5de3b2c → 8a70d6f → b825e24`。

## 2. 实际修改的模块

| 文件 | 变更 |
|---|---|
| `apps/runtime/src/release-service.ts` | `currentEnvironmentVersion` 增加 `releaseVersion`，用 `LEFT JOIN releases` 取跨版本标签 |
| `packages/contracts/src/release.ts` | `environmentVersions[]` 增加 `releaseVersion` 字段 |
| `apps/desktop/src/renderer/src/components/DeploymentConsole.tsx` | 优先使用事实自带标签，不再从**版本作用域**的 releases 列表反查 |

## 3. 真实 Provider 与 Agent Runtime

- Provider：本机已配置的 **DeepSeek**（`https://api.deepseek.com/v1`，`deepseek-flash`），safeStorage 加密。
- Runtime：Node Runtime 子进程 + `AgentRunner`，真实工具调用（`write_file` 等）。
- 本轮**未启动**新的真实模型执行（见第 11 节原因）；Phase 2.7 的真实 Provider 证据仍然有效：
  `docs/v2/ProjectOS_V2.0_Phase2_7_Autonomous_Orchestration_Acceptance.md` 记录 13/13 PASS。

## 4. 多 Agent 调度、依赖与 Handoff 证据

**本轮 FAIL。**

以既有真实多 Agent 脚本 `scripts/r2b32-real-multi-agent.mjs`（真实 DeepSeek Planner + developer/tester 两个真实 AgentDefinition + 真实失败 + 自动 Replan）作为基线执行：

```
R2B32 MULTI AGENT FAIL — Error: expected failed plan, got running
  at scripts/r2b32-real-multi-agent.mjs:120
```

原因：该脚本假设「下游任务必然失败」以触发 Replan。真实模型并不保证失败，
本次执行到断言点时计划仍处于 `running`。这是**脚本假设与真实模型非确定性**的冲突，
我**没有**把它改成"必定失败"的伪造场景来让它变绿，因此本轮没有拿到可用的多 Agent 闭环证据。

`v13-orchestration-e2e.mjs`、`teamwork-relay` 等多 Agent 用例使用**脚本化/假 Provider**，
按用户要求**不得**作为真实自主执行证据，故不计入。

## 5. 连续授权范围与实际人工介入次数

**机制核实 PASS（代码级），端到端未验证 SKIP。**

`apps/runtime/src/plan-grant.ts` 已实现范围受限的连续授权，判定顺序为：

1. 无已批准计划 / 无授权 → `approval`（逐次审批）
2. 授权无效（撤销/过期/revision 不符）→ `deny`
3. 授权状态非 `active` → `deny`
4. 工具不是 `write_file` → `approval`（进程/Git/外部操作永不被授权覆盖）
5. 授权不含 `workspace-write` → `approval`
6. 任务不在 `allowedTaskIds` → `deny`
7. Agent 不在 `allowedAgentIds` → `deny`
8. 任务当前执行 Agent 与授权不一致 → `deny`
9. 路径缺失 → `approval`；路径越出授权工作区 → `deny`
10. 全部通过 → **`allow`（不再逐次审批）**

即：**一次计划授权后，范围内的 `write_file` 不会重复弹审批**；越界路径、未知命令、
凭据变更、生产部署仍逐次授权。这正是 P0-2 要求的语义。

但本轮**没有**用真实模型跑一轮「一次授权 → 连续多次写入 → 零新增审批」的端到端计数，
所以"实际人工介入次数"这一项**没有实测数字**，记为 `SKIP`。

## 6. 自动测试、修复、Evidence、Gate、成果

**本轮 SKIP / FAIL。** 未产生新的一次真实多 Agent 运行，故无新的测试执行、修复、Evidence、
Gate 推进与最终成果数据。Phase 2.7 已验证的部分保留：

- 事件驱动协调器（`AutonomyCoordinator`）：8 类业务事件接入、幂等去重、单飞合并、崩溃重放、attempts 熔断 —— **PASS（6 项单测 + 300 项全量单测）**
- 门禁通过即自动推进阶段（`build → verify`）—— **PASS（Phase 2.6 E2E 实测）**

## 7. 事件恢复、并发与幂等结果

沿用 Phase 2.7 并**本轮复测通过**（全量 `pnpm test` 300 passed）：

| 能力 | 结果 |
|---|---|
| 同一 `source_event_id` 重复入队被丢弃（唯一索引） | PASS（单测） |
| `pending` 行在重启后重放为 `processed` | PASS（单测） |
| assist 模式零推进零调度 | PASS（单测） |
| 门禁通过才推进、未通过不推进 | PASS（单测） |
| 毒事件 attempts 上限 3 熔断 | PASS（实现 + 类型检查） |
| 真实强杀 Runtime 后恢复调度 | **SKIP**（本轮未跑） |
| 真实重复业务事件不产生重复 Run/审批 | **SKIP**（本轮未跑） |

## 8. SSH 自动对账验证

**SKIP。** Phase 2.7 实现了 Main 侧每 60s 的只读对账扫描（`observeSshDeployment`：
release 目录 / `docker inspect` 挂载 / `/health`，最多 3 次尝试，**从不重放部署**），
但本轮**没有**构造真实的 `needs_reconciliation` 场景来观察它收敛。
Phase 2.5 的真实 SSH 部署/更新/回滚能力保持有效（32/32 PASS，未回退）。

## 9. Electron 实际交互截图

本轮仅有 1 项 UI 修复，现场验证记录（真实 Electron，数据目录 `…\Temp\p25-ui`）：

```
HEADER: Local · Contabo Phase2.5 · 当前可信版本 v0.1.0
RAIL  : v0.1.0
TRUSTED VERSION FIX PASS
```

即：在查看 **v0.2.0** 的部署时，控制台正确显示跨版本的「当前可信版本 v0.1.0」，
不再显示"没有已验证运行版本"。**无新截图文件**（本轮未生成 `docs/screenshots/p28-*`）。
Phase 2.7 截图仍有效：`p27-01-bell-real-approval.png`、`p27-02-real-approval-diff.png`、`p27-03-after-auto-resume.png`。

## 10. PASS / FAIL / SKIP / BLOCKED

| 项目 | 状态 |
|---|---|
| 部署控制台「当前可信运行版本」跨版本修复 | **PASS**（真实 Electron 现场验证） |
| `pnpm typecheck` | **PASS** |
| `pnpm lint`（含边界检查） | **PASS**，0 errors / 15 warnings（均既有），`Dependency boundaries OK` |
| `pnpm test` | **PASS**，300 passed / 4 skipped |
| `pnpm build` | **PASS** |
| PlanGrant 范围受限连续授权（代码级核实） | **PASS** |
| PlanGrant 端到端低干预（一次授权后零新增审批） | **SKIP** |
| 验收 A：真实多 Agent 低干预研发闭环 | **FAIL**（基线脚本断言失败，未取得绿色闭环） |
| 验收 B：授权范围外暂停 | **SKIP**（本轮未跑） |
| 验收 B：铃铛→审批→Run 自动恢复（真实 Provider） | **PASS**（Phase 2.7 证据，本轮未重跑） |
| 验收 B：无依赖任务并行 | **SKIP**（仅既有 `r1-concurrency` 单测覆盖，不算真实 E2E） |
| 验收 B：强杀/重启恢复 | **SKIP** |
| 验收 B：重复事件不重复执行 | **PASS（单测）** / **SKIP（真实事件）** |
| SSH 未知结果自动对账现场验证 | **SKIP** |
| 工作中心 / Action Center P1 体验增强 | **SKIP**（本轮未做） |
| Windows 打包 / 1024 / 1440 / Light / Dark / 125% | **SKIP**（本轮未重跑；Phase 2.5 打包 PASS） |

## 11. 未完成项及其影响

1. **真实多 Agent 闭环未打通（最重要）**
   影响：无法证明"用户给目标 → 多 Agent 分工 → 自动测试/修复/证据 → 推进 → 交付"。
   阻塞点：既有真实多 Agent 脚本依赖"下游必然失败"来触发 Replan，与真实模型非确定性冲突；
   要得到稳定证据需要重新设计该场景（例如显式注入一个受控失败任务），
   这属于**新的 E2E 工程**，本轮未完成。
2. **低干预授权缺实测计数**
   影响：无法回答"一次授权后到底还需要几次人工"。
   下一步：在真实 Provider 下跑「批准计划 + 签发授权 → 连续 N 次 write_file → 断言审批数=0」。
3. **SSH 对账未现场验证**
   影响：`needs_reconciliation` 自动收敛仍是"实现存在但未证明"。
4. **并行/强杀/重复事件只用单测覆盖**
   影响：真实桌面并发与崩溃语义未证实。
5. **P1 体验（工作中心目标视图、Action Center 四态区分）未做。**
6. 本轮**没有**新增数据库迁移，也未修改任何既有迁移。

## 12. 是否达到"日常真实项目低干预自主研发"的标准

**未达到。**

可以确认的：
- 事件驱动的自主推进骨架真实存在且单测覆盖（幂等、重放、熔断、模式控制）。
- 范围受限的连续授权机制真实存在，`write_file` 在授权范围内**不会**逐次审批。
- 真实 DeepSeek 模型的"暂停→铃铛→批准→自动恢复→真实落盘"**已证明**（Phase 2.7）。
- 部署控制台跨版本可信版本显示缺陷**已修复并现场验证**。

尚不能确认的：
- 多 Agent 在真实模型下的完整交付闭环（本次 FAIL）。
- 低干预的实际人工介入次数（未计数）。
- 崩溃/并行/对账的现场行为（未验证）。

因此本轮判定：**部分交付（1 项真实缺陷修复 + 1 项机制核实）**，
核心自主闭环验收 **FAIL**，不满足"低干预自主研发"标准。
按用户要求，不使用单测或假 Provider 替代真实端到端验收，也不伪造通过。

**Phase 2.8 到此停止，不进入 Phase 3。**
