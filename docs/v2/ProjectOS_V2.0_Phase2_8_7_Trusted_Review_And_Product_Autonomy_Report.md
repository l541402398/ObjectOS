# ProjectOS V2.0 Phase 2.8.7 — 可信审查快照与产品自主执行（报告）

**分支**：`v2.0-phase2.8.7`（恢复点 tag `phase2.8.7-base` = `8078fbb`）
**基线**：GitHub `origin/v2.0-phase2.8.6` = `8078fbbb34768c405259aa367b16f4bc2d8001c0`（本地核对一致）
**Schema**：V36（未新增迁移）

---

## 1. 结论摘要

| 轨道 | 项 | 结果 |
|---|---|---|
| A | Review Verdict 版本校验绕过 | **PASS**（已修 + 负向测试） |
| A | 工作区内容快照 ReviewSnapshot | **PASS**（运行时采集 + 复审前重算 + 失效验证） |
| A | 审查对象真实性与路径安全 | **PASS**（越权路径拒绝、删除记录为 null） |
| A | 任务证据契约预检 | **未实现** |
| B | 产品自主 Replan / 自主交付 | **未实现（FAIL）** |
| B | 900 秒 running 根因 | **未定位** |
| B | 真实 DeepSeek E2E | **未运行** |
| C | 并行 / 强杀 / 幂等 / SSH 对账 / 打包 / 视觉回归 | **SKIP** |

确定性回归：**340 passed / 4 skipped**（本轮 +7）。

## 2. 本轮改动的文件

| 文件 | 变更 |
|---|---|
| `packages/application/src/review-verdict.ts` | 版本/快照校验**前移到所有放行路径之前**；新增 `currentSnapshot` 选项 |
| `packages/application/src/review-snapshot.ts` | **新增**：快照模型、确定性指纹、`snapshotMatches`（失败即不匹配） |
| `apps/runtime/src/review-snapshot-collector.ts` | **新增**：运行时读取真实文件并哈希，拒绝越权路径与符号链接 |
| `apps/runtime/src/agent-runner.ts` | 创建 review 产物时由**运行时**采集快照，丢弃 Agent 自带哈希 |
| `apps/runtime/src/orchestrator.ts` | 复审前**重新计算**当前范围快照并参与判定 |
| `packages/application/src/index.ts` | 导出新模块 |
| `tests/p287-review-snapshot.test.ts` | 7 项 |

## 3. 修掉的绕过缺陷（P0-1）

原实现把版本校验放在最后：

```
if (explicit === 'approved') return 'approved'   // ← 提前返回
...
if (reviewedRevision !== currentRevision) return 'inconclusive'  // ← 永远到不了
```

即：只要 Agent 写一个 `metadata.verdict = 'approved'`，**版本检查就被绕过**。

现在顺序是：blocker → **版本/快照校验** → 结构化 verdict → 自由文本。所有放行路径之后都必然经过版本闸门。

新增负向测试（`tests/p287-review-snapshot.test.ts`）直接覆盖这一点：带 `verdict: 'approved'` 的证书在文件内容变化后返回 `inconclusive`。

## 4. 可信审查快照（P0-2）

**问题**：`reviewedRevision = git rev-parse HEAD` 不能代表被审查内容。Agent 在 Worktree 里改文件但没提交时，HEAD 完全不变，旧审查仍然放行。

**实现**：

- `ReviewSnapshot = { baselineCommit, files[{path, sha256}], fingerprint }`，指纹对「基线 commit + 排序后的文件哈希」做 SHA-256；
- **由运行时采集**（`review-snapshot-collector.ts`）：读取 `reviewedObjects` 指向的真实文件字节；Agent 写入的任何 `reviewSnapshot` 一律被覆盖丢弃；
- **路径安全**：绝对路径、`../` 逃逸一律丢弃；符号链接不跟随；不存在的文件记为 `sha256: null`（删除也算内容变化）；
- **范围**：只按 `reviewedObjects` 实际范围取快照，无关文件变化不会让整个项目审查失效；
- **复审时重算**：`orchestrator` 在判定前用当前工作区重新采集快照，指纹不一致 → `inconclusive`；
- 缺快照的审查在需要校验时一律 `inconclusive`（fail-closed）。

实测（7 项全绿）：

| 场景 | 结果 |
|---|---|
| 文件改了但 HEAD 没变 | 指纹不同 → 拒绝 |
| 带 `verdict:'approved'` 且内容已变 | `inconclusive` |
| 审查没有快照 | `inconclusive` |
| `../outside.mjs`、`/etc/passwd` | 被丢弃，不进入快照 |
| 已删除文件 | 记为 `null`，不伪造 |
| 文件顺序打乱 | 指纹相同（确定性） |

## 5. 未完成项（如实记录）

### 5.1 产品自主 Replan 与自主交付（**FAIL，本轮最重要的缺口**）

E2E 脚本仍然替用户调用 `plans.replan.apply` / `plans.update` / `plans.approve` / `plans.grant.issue` / `orchestration.start` / `worktrees.merge`。因此**不能声称产品自主闭环**。

本轮**没有**实现 `AutonomyCoordinator` 在授权范围内的自动修订应用。这是收口的首要阻断项，且不是我能在本轮剩余预算内安全完成的工作：它涉及授权范围比较（路径/工具/Agent/预算）、人工审批差异项、以及自动恢复调度，任何草率实现都可能变成"系统自己给自己扩权"——那比不做更危险。

### 5.2 900 秒 running 根因（未定位）

本轮没有运行真实 E2E，也没有对上一轮 `p285-ui3` 的运行记录做逐条时间线分析。因此**不能**给出根因。此前把它归因为"等待不够"是错的，本轮不再重复该说法。

### 5.3 其余

- 任务证据契约预检：未实现。
- Review Evidence 的「Reviewer 真实只读检查记录」关联：未实现（只做了文件内容快照）。
- 并行、强杀恢复、事件幂等、SSH 只读对账、自动交付、打包、Electron 截图、125% 视觉回归：**全部 SKIP**。

## 6. 质量门

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | **PASS** |
| `pnpm lint` | **PASS**，0 errors / 17 warnings（均既有），边界 OK |
| `pnpm test` | **PASS**，340 passed / 4 skipped |
| `pnpm build` | **PASS** |
| `pnpm package:dir` / `test:package` | **SKIP** |
| 真实 DeepSeek E2E | **未运行** |
| Electron / 视觉回归 | **SKIP** |

## 7. 是否具备 Phase 2 收口条件

**不具备。**

本轮实质推进了 A 轨道：审查证书现在绑定**真实文件内容**，`verdict:'approved'` 再也绕不过版本闸门——这是"过期 Review 放行新代码"这一类风险的直接修补。

但收口的两个硬条件仍未满足，且都是本轮明确点名的最高优先级：

1. **产品自主推进**（AutonomyCoordinator 自己应用合法修订、重新调度、恢复执行）——完全未实现；
2. **900 秒 running 的真实根因**——未定位。

在这两件之前，即使所有单测通过，也不能说 ProjectOS 具备自主研发闭环。

**Phase 2.8.7 到此停止，不进入 Phase 3。**
