# ProjectOS V2.0 Phase 2.8.1 — 真实多 Agent 验收重构与自主研发闭环收口（最终报告）

**分支**：`v2.0-phase2.8.1`（恢复点 tag `phase2.8.1-base` = `4ee96ae`）
**代码 HEAD**：`d2c51d2`
**日期**：2026-10-28（America/Los_Angeles）
**前提**：Phase 2.5 / 2.6 / 2.7 / 2.8 成果保留，未回退；无新迁移（仍 V34）。

---

## 1. 结论摘要

| 验收 | 结果 |
|---|---|
| **A. 真实多 Agent 正常研发闭环** | **PASS** |
| **B. 真实失败修复闭环（含交付合并）** | **PASS** |
| C. 低人工介入闭合 | **PARTIAL**（机制已验证生效；但本轮夹具命名恰好落在"安全敏感路径"，未取得"非敏感路径零审批"的计数） |
| D. 可靠性闭合（并行 / 强杀 / 幂等 / SSH 对账） | **未完成**（本轮聚焦 A/B，见第 9 节） |

自动 E2E 最终结果：**21 PASS / 1 FAIL / 0 BLOCKED**，唯一 FAIL 已定位为**产品正确行为**（见第 6 节），非缺陷。

---

## 2. 最终 Git HEAD 与提交记录

| 项目 | 值 |
|---|---|
| 分支 | `v2.0-phase2.8.1` |
| 恢复点 | tag `phase2.8.1-base` = `4ee96ae` |
| 本轮提交 | `d2c51d2` `fix(phase2.8.1): make worktree creation race-safe, recover from unknown route, add real multi-agent E2E` |
| 工作树 | clean |

## 3. 实际修改的模块

| 文件 | 变更 | 性质 |
|---|---|---|
| `packages/worktree/src/index.ts` | `create()` 改为**竞态安全**：add 失败后若目标已是可用 worktree 则**复用**（而非整盘失败），并在确认失效时 `worktree prune` | **真实缺陷修复** |
| `apps/runtime/src/orchestrator.ts` | `ensureWorkspace` 加 **per-plan 单飞**（`workspaceInflight`），避免 start 与 restart 并发执行两次 `git worktree add` | **真实缺陷修复** |
| `apps/desktop/src/renderer/src/router.tsx` | 404 页增加**返回上一页 / 回到项目中心**与实际路径显示 | **真实体验缺陷修复** |
| `apps/desktop/src/renderer/src/styles/app.css` | 404 恢复区样式（遵守 12px 字号下限） | 配套 |
| `scripts/phase2.8.1-multi-agent-e2e.mjs` | 新验收脚本：场景 A/B 独立、事件驱动有界轮询、失败日志可诊断 | 验收工程 |

## 4. 根因证据（Phase 2.8 的 FAIL 到底是什么）

### 4.1 `expected failed plan, got running` 的真实原因

读取上一轮保留的数据目录 `…/projectos-r2b32-multi-data-1jV5DO/projectos.db` 与 `test-results/r2b3/multi-agent-failure.json`：

- 真实 Planner（`deepseek-flash`）确实产出了 2 个任务与依赖：
  `implement-canview` → `verify-canview`
- 两个真实 AgentDefinition 均已分配
- 断言失败时 `plan.execution.status = running`，`runIds` 只有 1 个

**结论**：旧脚本用 240s 固定预算 + 直接断言，真实模型在该预算内尚未跑完；不是多 Agent 架构失败。

### 4.2 修复过程中发现的**真实产品缺陷**（本轮已修）

对上一轮运行日志取证：

```
fatal: '<…>/worktrees/prj_…/pln_…' already exists
→ AppError: 无法创建隔离 Worktree，已停止执行
```

`WorktreeManager.create()` 在 `git worktree add` 失败后会退回 `worktree add <path> <branch>`，
但此时目录已被上一次尝试创建，git 报 `already exists`，**整个计划被判失败**。
同时 `ensureWorkspace` 无并发保护，start 与 restart 可能同时执行。

修复后：竞态失败方**复用**已建立的 worktree；只有确认目录不是可用 worktree 时才 `prune` 并报错。
修复效果直接可见：场景 B 由 Phase 2.8 的 `status=failed` 变为 `status=completed`。

## 5. 场景 A：真实多 Agent 正常研发（PASS）

真实 Electron + 真实 DeepSeek（`deepseek-flash`）+ 真实 Git 仓库。

| 证据 | 值 |
|---|---|
| Planner 来源 | `source=provider`，`model=deepseek-flash`，2 个任务 |
| 依赖拓扑 | `implement-canview` → `verify-canview-behavior` |
| 不同 Agent | 2（Developer / Tester） |
| 计划授权 | 1 次（`pgr_01m60xq10ns74vpqst03x95856`，`allowedPaths=[src,tests]`） |
| 计划终态 | `completed` |
| 真实 Run | 2 个，`distinctAgents=2`（确有跨 Agent 交接） |
| 真实改动（Worktree 内） | `src/permission.mjs`、`tests/canview-independent.mjs`、`tests/permission.test.mjs` |
| 工具审批 | 16 次（`run_command:11`、`run_tests:3`、`write_file:2`） |
| 渲染进程报错 | 0 |

即有界轮询在 900s 内等到 `completed`，不再依赖固定 sleep。

## 6. 唯一的 FAIL，以及为什么它是**正确行为**

断言 `授权范围内写入未重复审批` 失败（`write_file` 审批 2 次）。取审批载荷：

```
path=src/permission.mjs      grantReason=安全敏感路径 src/permission.mjs 不纳入计划授权，必须逐次审批
path=tests/permission.test.mjs grantReason=安全敏感路径 tests/permission.test.mjs 不纳入计划授权，必须逐次审批
```

根因在 `apps/runtime/src/plan-grant.ts` 的 `CRITICAL_GRANT_PATH_PATTERNS`：

```
/(^|\/)(auth|authentication|permission|permissions|security|crypto)(\/|\.|$)/i
```

`permission.mjs` 命中该规则 → **鉴权/权限类文件被刻意排除在计划授权之外，永远逐次审批**。

这是**安全设计的正确结果**（与"敏感配置或凭据必须单独授权"一致），
但本轮夹具恰好选了 `permission` 命名，因此**没有取得**"非敏感路径写入零审批"的计数证据。
该项记为 **PARTIAL**，而不是产品缺陷。

## 7. 场景 B：真实失败 → 自动修复 → 交付（PASS）

确定性夹具：`src/slug.mjs` 实现不满足 `tests/slug.test.mjs` 契约（未小写、未把空格转连字符）。

| 步骤 | 证据 |
|---|---|
| 夹具真实失败 | `npm test` 退出码 **1**（真实命令，非伪造） |
| 真实 Planner | `source=provider`，2 任务：`fix-slugify` → `verify-npm-test` |
| 两 Agent + 依赖 | 2 个 AgentDefinition，下游依赖上游 |
| 一次授权 | `pgr_01m60xttdy6dr3zmk2en0jasdk`，`allowedPaths=[src,tests]` |
| 计划完成 | `status=completed` |
| **修复后测试通过（Worktree）** | `wt=pln_01m60xtkxksehctve0c4wjra2d` → `npm test` 退出码 **0** |
| **合并交付（主工作区）** | `worktrees.merge` 成功，主仓库 `npm test` 退出码 **0** |

说明：Agent 的真实修改先落在隔离 Worktree；`worktree.merge` 是**显式交付步骤**（非自动），
本轮已验证"完成后合并 → 主工作区测试通过"的完整交付链路。

## 8. 事件恢复 / 幂等 / 并发（沿用并复测）

| 能力 | 结果 |
|---|---|
| 事件去重（`source_event_id` 唯一索引） | PASS（Phase 2.7 单测，本轮全量 300 passed） |
| 崩溃后 `pending` 重放 | PASS（同上） |
| `ensureWorkspace` 并发单飞 | **本轮新增**，代码级 |
| worktree 创建竞态 | **本轮修复**，由 B 场景从 failed→completed 实证 |
| 真实强杀 Runtime 后恢复 | SKIP（本轮未跑） |
| 真实重复事件不产生重复 Run | SKIP（本轮未跑） |

## 9. 未完成项及其影响

1. **C 项计数证据（PARTIAL）**：需要把夹具改为非敏感命名（如 `src/visibility.mjs`）再跑一次，
   才能给出"一次授权后 write_file 审批 = 0"的真实数字。
2. **D 项可靠性闭环未验证**：并行（一个 Agent 等待时其他任务继续）、Runtime 强杀恢复、
   重复事件幂等、SSH 未知结果只读对账，本轮均未做真机验证。
3. **P1 工作中心 / Action Center 四态**未实做。
4. **打包与视觉回归**：`package:dir` / `test:package` / 1024 / Light-Dark / 125% 本轮未重跑
   （Phase 2.5 曾 PASS）。
5. **`preload` 缺少辅助方法**：本轮脚本曾误用 `orchestration.merge`，正确入口是
   `worktrees.merge`（已确认存在），非缺陷。

## 10. 质量门

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | **PASS** |
| `pnpm lint` | **PASS**，0 errors / 15 warnings（均既有），`Dependency boundaries OK` |
| `pnpm test` | **PASS**，300 passed / 4 skipped |
| `pnpm build` | **PASS** |
| `scripts/phase2.8.1-multi-agent-e2e.mjs` | 21 PASS / 1 FAIL（该 FAIL 为正确安全行为，见第 6 节） |

本轮另修：404 页原无任何出口，用户看到「页面不存在」会被困住；现已提供返回上一页/回到项目中心。

## 11. 是否达到"低干预自主研发"标准

**方向已打通，但计数证据尚缺一格。**

已证明（真实运行）：
- 真实 Planner → 双 Agent → 真实依赖 → 真实代码改动 → 真实测试 → 计划完成；
- 真实失败夹具 → Agent 真实修复 → Worktree 测试通过 → 合并 → 主工作区测试通过；
- 一次计划授权（PlanGrant）贯穿全程，期间无版本推进人工点击、无回聊天催促；
- 敏感路径（auth/permission/security/crypto）**按设计**强制逐次审批；
- Worktree 创建的竞态缺陷已修，直接决定了多 Agent 计划能否跑完。

未证明：
- 非敏感路径下的"零重复审批"计数；
- 强杀/并行/幂等/SSH 对账的真机结果。

因此判定：**核心闭环 PASS，低干预计数 PARTIAL，可靠性闭合未完成**。
不以单测或假 Provider 替代真机验收，也不掩盖尚未取得的证据。

**Phase 2.8.1 到此停止，不进入 Phase 3。**
