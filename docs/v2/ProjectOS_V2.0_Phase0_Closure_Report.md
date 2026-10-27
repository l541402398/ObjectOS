# ProjectOS V2.0 — Phase 0 Closure Report

> 阶段：Phase 0 — 工程基线冻结与执行安全收口  
> 日期：2026-10-27  
> 分支：`v2.0-phase0`  
> 集成基线：`feature/plan-review-design-lab-integration` @ `9dd12f1`（含 `98cd5a3` Teamwork + `0686c41` 视觉基线）  
> 代码提交：`bf99361` + `effee70`  
> 状态：**代码/安全门槛 Go；Phase 1A 进入为 Conditional No-Go（见 §11）**

---

## 1. 实际 Git 基线与已保护成果

### 1.1 基线选择

- `feature/plan-review-design-lab-integration` @ `9dd12f1` 是 `feature/v1.6-ux` @ `98cd5a3` 的后代，包含 `0686c41`（Design Lab / 视觉基线）。
- `git diff --name-only 98cd5a3..9dd12f1 -- apps/runtime packages` → **0 个文件**；UI 集成没有改后端内核。
- 因此 `v2.0-phase0` 从 `9dd12f1` 建立，而不是直接假设 `98cd5a3` 是唯一最新实现。
- 独立 worktree：`C:\Users\Administrator\Desktop\workplace\ProjectOS-v2-phase0`；主工作区与其他 worktree 未被 reset/clean/force-push。

### 1.2 分支/标签清理

- 清理前：18 个本地分支、10 个 worktree、4 个 tag。
- 清理后：**12 个本地分支、10 个 worktree、4 个 tag**。
- 删除的 7 个本地分支（均验证为 `v2.0-phase0` 祖先，tip 仍在历史中）：
  - `backup/formal-plan-review-20261023`
  - `feature/v1.6-commercial-ui-redesign`
  - `feature/v1.6-liquid-glass-design-lab`
  - `feature/v1.6-next-ui`
  - `feature/v1.6-premium-liquid-glass`
  - `feature/v1.6-overlay-system`
  - `phase1-baseline-a9cba63`
- 另移除了已合并的干净 worktree `ProjectOS-commercial-ui`；其分支已合并，无未提交修改。
- **未删除远程分支**；远程仍保留上述名字。
- 保留的 0686 保护：
  - `visual-baseline-approved-0686c41` tag 未移动/未重命名。
  - `restore/visual-baseline-0686c41` 工作树保留。
  - `feature/plan-review-design-lab-integration`、`feature_dev_ux`、`perf/electron-v1.6-audit`、`feature/projectos-next-ui-full-migration`、`build/formal-0686style` 保留为 UI 候选。

### 1.3 全部 Worktree 核对

| Worktree | 分支/HEAD | 脏状态 | 处理 |
|---|---|---|---|
| `ProjectOS` | `feature/v1.6-ux` / `98cd5a3` | 7 未跟踪（docs/temp/`$a`） | 保留；只同步 docs，未改代码 |
| `ProjectOS-ai-routing` | `chore/ai-tool-routing` / `d3686c4` | 干净 | 保留 |
| `ProjectOS-ed231d5-build` | detached / `ed231d5` | 干净 | 保留（历史构建现场） |
| `ProjectOS-feature-dev-ux` | `feature_dev_ux` / `49f9413` | `SettingsModal.tsx` 未提交 | **未触碰** |
| `ProjectOS-formal-0686-style` | `build/formal-0686style` / `8a9ba85` | 干净 | 保留 |
| `ProjectOS-next-ui-full-migration` | `feature/projectos-next-ui-full-migration` / `acfd86f` | 未跟踪视觉回归目录 | 保留，未触碰 |
| `ProjectOS-perf-audit` | `fix/plan-review-inspector-actions` / `cfa26ef` | `main/index.ts` 未提交 | **未触碰** |
| `ProjectOS-plan-review-integration` | `feature/plan-review-design-lab-integration` / `9dd12f1` | 干净 | 保留 |
| `ProjectOS-v2-phase0` | `v2.0-phase0` / `ed7ea50` | 干净 | Phase 0 工作区 |
| `ProjectOS-visual-baseline-0686c41` | `restore/visual-baseline-0686c41` / `0686c41` | 干净 | 保留 |

> 主工作区现有未跟踪 `$a/ProjectOS.exe` 等：未读取、未修改、未删除。

### 1.4 本轮提交

```text
66d5dab docs(phase0): clarify ACCEPT-1 is not used
fbe1ee4 docs(phase0): record complete worktree audit
ed7ea50 docs(phase0): record final test duration
2b39ac1 docs(phase0): add closure report, migration readiness and license record
effee70 fix(phase0): disable unapproved harness install and sync docs
bf99361 feat(phase0): close raw execution paths and freeze V24 baseline
```

---

## 2. 每条 P0/P1 的修复方式

| 项 | 修复方式 | 关键文件 | 验证 |
|---|---|---|---|
| P0-1 `runtime.execute` | 从 `ApiSchemas`、preload、dispatcher 移除；Renderer 无入口 | `packages/contracts/src/api.ts`、`apps/desktop/src/preload/index.ts`、`apps/runtime/src/dispatcher.ts` | 安全 E2E：`typeof ... === 'undefined'` |
| P0-2 `runtime.acpPrompt` | 同上；ACP 仅保留 `acpHandshake/acpAuthenticate` 诊断/认证 | 同上 | 安全 E2E：`undefined` |
| P0-3 CLI/ACP Worktree | `executeViaRuntime` 的 cwd 从 `project.rootPath` 改为 `state.workspaceRoot` | `apps/runtime/src/agent-runner.ts` | runtime-worktree + teamwork E2E |
| P0-4 RuntimeRunService | `agentDefinition.run` 解析后直接抛 `POLICY_DENIED`；不再调用 `RuntimeRunService` | `apps/runtime/src/dispatcher.ts` | 安全 E2E：明确报错；类级测试仍保留 |
| P0-5 ExternalRunner | 写模式 `assertExternalWriteAllowed` 抛 `POLICY_DENIED`；公共 `externalAgents.execute` 整体禁用；slot/env 白名单代码保留 | `external-runner.ts`、`dispatcher.ts` | 安全 E2E；单测 |
| P1-1 allowedPaths | `startRepair` 在入口抛 `POLICY_DENIED`；`autoStartRepairs` 直接 return；UI 关闭/提示 | `dispatcher.ts`、`OperationsPage.tsx` | 安全 E2E；operations 回归 |
| P1-2 quality gate | `AUTO_QUALITY_GATE_ENABLED` 默认 false（测试环境/显式 env 才 true）；Scheduler 遇 review 暂停并提示，不再自动跑 shell | `quality-gate.ts`、`orchestrator.ts` | 单测；Teamwork 默认暂停/opt-in 通过 |
| P1-3 coordination | `assertCoordinatedTaskScope`：跨项目拒绝、跨计划/任务拒绝、无绑定任务禁止 handoff | `agent-runner.ts` | 6 个安全单测 |
| `runtime.install` | 全局 npm 安装入口禁用，只保留检测/登记；UI 提示手动安装 | `dispatcher.ts` | 安全 E2E |
| ACCEPT-1 | 外部执行公共入口已禁用，不再依赖“逐工具不可见”的限制 | — | 安全 E2E |

> 没有删除安全检查、没有修改测试预期来达到通过；新增负向测试而非绕过。

---

## 3. 封堵前后的正式调用链

### 3.1 原始 Runtime 执行

**Before：**

```text
RuntimeSettingsPanel
  -> window.projectos.runtimeProfiles.execute / acpPrompt
  -> preload call('runtime.execute' / 'runtime.acpPrompt')
  -> Main ipc allowlist
  -> Runtime dispatcher
  -> RuntimeExecutionService.execute / AgentStudioService.acpPrompt
  -> spawn（任意 cwd，无 Run/Approval/Budget/Lease）
```

**After：**

```text
RuntimeSettingsPanel -> runtimeProfiles.detect（只读检测）
Agent Workbench -> session.sendMessage
  -> AgentRunner.startRun
  -> Run + ToolCall + Policy/Approval + lease/slot + budget
  -> executeViaRuntime(state.workspaceRoot)
```

- `runtime.execute` / `runtime.acpPrompt` 在 ApiSchemas、preload、dispatcher 均不存在。
- Renderer 只能调用 `detect`、`acpHandshake`、`acpAuthenticate`（诊断/认证，不执行 Prompt）。

### 3.2 Agent Studio 直跑

**Before：**

```text
AgentStudioModal.runAgent
  -> agentDefinitions.run
  -> dispatcher
  -> RuntimeRunService.run
  -> 自建 session/run/toolcall，直接 spawn
```

**After：**

```text
AgentStudioModal.runAgent -> 显示“请到 Agent 工作台运行”
dispatcher.agentDefinition.run -> POLICY_DENIED
Agent 工作台 -> AgentRunner.startRun（合法入口）
```

### 3.3 外部 Agent

**Before：**

```text
externalAgents.execute -> ExternalAgentRunner.execute
  -> 读/写模式均 spawn；env = process.env；写模式无 run 审批
```

**After：**

```text
externalAgents.execute -> POLICY_DENIED（Phase 0 整体禁用）
ExternalAgentRunner.execute -> 写模式 POLICY_DENIED；只读模式保留 slot/env 白名单代码
```

- 只读外部执行在 Phase 0 也不可达；待 Phase 4 接 run 级审批后恢复。
- `SAFE_ENV_KEYS` 白名单、`acquireAgentExecutionSlot` 已就位，避免恢复时重复实现。

### 3.4 自动修复

**Before：**

```text
operations.startRepair -> startRepair -> consumeGrant
  -> automation plan -> 自动写
```

**After：**

```text
operations.startRepair -> POLICY_DENIED
autoStartRepairs -> return（不启动）
UI -> 提示“Phase 0 禁用”
```

### 3.5 质量门禁

**Before：**

```text
Scheduler review -> QualityGateService.run
  -> pnpm/npm run test（shell:true）
```

**After（默认）：**

```text
Scheduler review -> AUTO_QUALITY_GATE_ENABLED=false
  -> report=skipped（不 spawn）
  -> plan.status=paused，error 提示人工验证
```

**After（显式 opt-in）：**

```text
PROJECTOS_ENABLE_AUTO_QUALITY_GATE=1
  -> QualityGateService.run 正常执行
  -> 仅用于受信任环境/测试
```

### 3.6 协调工具

**Before：**

```text
update_task_status(args.taskId) -> 任意项目/计划 task
```

**After：**

```text
update_task_status/handoff_task
  -> assertCoordinatedTaskScope({
       project match,
       runTaskId === target (若运行绑定任务),
       assignee match (项目级 run),
       handoff 必须有绑定任务
     })
  -> 否则 POLICY_DENIED
```

---

## 4. 被禁用功能与替代入口

| 被禁用 | 原因 | 替代/恢复条件 |
|---|---|---|
| Runtime 设置“测试 Prompt” | 原始 execute/acpPrompt 无 Run/审批 | 改为“安全检测”（detect）；真实推理到 Agent 工作台 |
| Agent Studio 直跑 | 绕过 Scheduler/槽/租约/审批 | Agent 工作台会话 -> `AgentRunner.startRun` |
| 外部 Agent 执行 | 无 run 级审批 | Phase 4 接审批后恢复；当前用 Agent 工作台 CLI/ACP/原生 |
| 外部 Agent 写模式 | 无 run 审批、无 diff 验收 | 同上；代码保留 slot/env |
| 自动修复（manual/autofix） | allowedPaths 未真实派生 | 受控 Agent 计划/人工修复；Phase 1A 后重做 grant |
| 自动质量门禁 | shell 执行仓库脚本无审批 | `PROJECTOS_ENABLE_AUTO_QUALITY_GATE=1`（受信任环境）；或 Agent `run_tests`/人工验证 |
| Harness 自动安装 | 全局 npm 安装无审批 | 手动安装后在设置中检测 |
| `agentDefinition.run` API | 第二套 Run 创建路径 | 保留 API 但硬拒绝；Phase 1A 再移除 |

---

## 5. 完整测试及安全负向证据

### 5.1 静态/单元/构建

| 命令 | 结果 | 说明 |
|---|---|---|
| `pnpm lint` | **PASS（0 errors，2 warnings）** | warnings 在 `PlanReviewNext.tsx`（Sparkles/activeStage），非本轮引入 |
| `pnpm typecheck` | **PASS** | `tsc --noEmit` |
| `pnpm test` | **PASS**：50 files passed / 1 skipped（51）；273 tests passed / 3 skipped（276）；68.08s | 含新增 Phase 0 测试 |
| `pnpm build` | **PASS** | runtime 1.95MB + desktop main/preload/renderer |
| `pnpm package:dir` | **PASS** | `release/win-unpacked/ProjectOS.exe` |
| `pnpm test:package` | **PASS** | 打包 EXE 创建项目/写 starter/重启恢复 |

### 5.2 Phase 0 专项

| 测试 | 结果 | 证据 |
|---|---|---|
| `tests/phase0-security.test.ts` | **6/6 PASS** | ApiSchemas 不含 raw 方法；写模式拒绝；跨项目/跨计划 task 拒绝；无绑定任务 handoff 拒绝；quality gate 默认关闭 |
| `tests/phase0-migration.test.ts` | **1/1 PASS** | V24 fixture 保持 V24；project/task/plan/artifact 可读 |
| `scripts/phase0-security-e2e.mjs` | **PASS** | execute/acpPrompt `undefined`；agent studio/repair/external/install 均明确拒绝 |
| `scripts/r1b-kill-restart-e2e.mjs` | **PASS 25 checks** | Runtime kill 后 `needs_reconciliation`、lease/slot 释放、无自动重放 |
| `scripts/e2e.mjs` | **PASS** | 桌面创建项目 + 重启恢复 |
| `scripts/agent-e2e.mjs` | **PASS** | 真实审批暂停、批准写入、恢复循环、Run completed；2 次 provider 请求 |
| `scripts/v13-e2e.mjs` | **PASS** | scan/plan DAG/真实 graph/保存布局/重启恢复 |
| `scripts/v18-teamwork-e2e.mjs`（默认） | **FAIL（预期）** | plan=paused，error=自动质量门禁已禁用；证明默认 fail-closed |
| `scripts/v18-teamwork-e2e.mjs`（`PROJECTOS_ENABLE_AUTO_QUALITY_GATE=1`） | **PASS 7 checks** | 同 Agent 串行、不同 Agent 并行、依赖等待、Runtime 不可用阻断、9 次 provider 请求 |

### 5.3 安全负向证据

```json
{
  "executeExposed": "undefined",
  "acpPromptExposed": "undefined",
  "handshakeExposed": "function",
  "agentStudioRunError": "Agent Studio 直跑入口已在 Phase 0 禁用...",
  "repairError": "Phase 0 已禁用自动修复写能力...",
  "externalExecuteError": "Phase 0 已禁用外部 Agent 执行...",
  "installError": "Phase 0 已禁用自动安装 Harness..."
}
```

### 5.4 未运行/跳过

- `tests/r2-real-harness.test.ts`：3 skipped（需要真实外部 Harness，未配置）。
- 全量 UI 截图/视觉回归：未运行；本轮只改安全相关 UI 文案/按钮，不是视觉验收。
- `v12-e2e` 等其余 E2E：未全部运行；本轮运行了 e2e/agent/v13/v18/r1b/package。
- 远程分支清理：未执行（只清理本地）。
- V25–V27 SQL/迁移：未实施、未运行。

> 首次运行 `e2e.mjs` 因新 worktree 缺少 Electron `dist` 失败；从已有安装链接 43.8.2 dist 后通过。这是环境准备问题，不是产品失败。

---

## 6. 数据备份与恢复结果

- 源：`C:\Users\Administrator\AppData\Roaming\ProjectOS\data\projectos.db`
- 备份：`C:\Users\Administrator\Desktop\workplace\_v2_backups\phase0\projectos-v24-2026-10-27T06-46-44-747Z.sqlite`
- 恢复校验副本：同目录 `...-restore-check.sqlite`
- SHA256：`7c51459356dd45c4aceb4287db3cf2ca00296989bf18354af24a5a05450d0609`
- 大小：999,424 bytes
- `PRAGMA integrity_check`：`ok`
- schema max version：24
- 计数：projects=2，tasks=22，plans=1，approvals=1
- 备份 vs 恢复：计数完全一致；未改动源数据库。
- 脚本：`scripts/backup-restore-rehearsal.mjs`（可重复执行）。

**限制：** 演练是“复制 + 恢复副本”验证，不是在线热备；如果应用正在写入，需在维护窗口重做。

---

## 7. 迁移准备情况

- 当前真实 schema：**V24**；本轮没有创建任何新领域表，没有修改数据库。
- V24 历史夹具：`tests/fixtures/v24-baseline.sqlite`（770,048 bytes；含 project/task/plan/artifact；`current_stage=testing`）。
- 夹具测试：`tests/phase0-migration.test.ts` 通过；升级到当前仍为 V24，旧数据可读。
- V25–V27 评审稿：`docs/v2/Phase0_Migration_Readiness.md`。
  - V25：products/product_versions/iterations/environments/project_focus。
  - V26：requirements/tasks/milestones/plan_revisions 的版本/迭代/workType/subject 字段。
  - V27：gate_definitions/gate_evaluations/evidence/evidence_links/run_checkpoints + artifacts 证据字段。
- 依赖、回填、兼容、幂等、停止条件已列出；**SQL 未写、未执行、未批准**。
- Phase 1B 原则上不加表；若必须加，只能新增 V27b/V28，不得改已发布 V25–V27。

---

## 8. 版本修复、Assurance、告警网络边界

### 8.1 版本修复与制品不可变

已在架构文档 §11.3.1 明确：

- 已发布 Release 的制品集合/hash 冻结，不得原地修复。
- 修复产生新 patch/hotfix 版本与新制品；旧 Release/Deployment/回执不改写。
- 回滚是新 Deployment，不是改历史。
- 损坏制品隔离 + 新制品 + 新发布；本地数据修复不等于制品修复。
- 手工部署记录不能证明制品未变；只有 adapter 回执/独立 hash 校验提升 Assurance。

### 8.2 Assurance 门禁比较语义

已在架构文档 §5.3.1 明确：

- 偏序：`self_declared < source_observed < independently_reproduced < externally_confirmed`。
- `minAssurance` 是阈值（`>=`），不是等级相等；需要精确等级用 `exactAssurance`。
- `allowSelfDeclared` 默认 false；缺失/`unknown` fail closed。
- `waived` 不等于 `passed`，必须批准/理由/有效期。
- GateEvaluation 逐条件记录，禁止单一 level。

### 8.3 Phase 3 告警网络边界

已在架构文档 §11.4.1 与路线图 Phase 3 明确：

- 默认不监听公网端口；优先出站拉取。
- 如必须 Webhook：只绑定 loopback，用户自备 TLS 反代；HMAC/防重放/限流/大小上限/Zod/allowlist。
- 凭据只进 Main SecretStore；Webhook 只创建候选 alert/health snapshot，不改 Deployment/Incident 终态。
- Phase 3 不引入公网回调域名/多租户入口。

---

## 9. UI 基线与分支治理

- Phase 0 集成基线：`9dd12f1`，含 0686；相对 98cd5a3 无 `apps/runtime`/`packages` diff。
- 不整支合并 UI；保留：
  - `feature_dev_ux` @49f9413（dirty SettingsModal）
  - `perf/electron-v1.6-audit` @65054bf（dirty main/index）
  - `feature/projectos-next-ui-full-migration` @acfd86f
  - `build/formal-0686style` @8a9ba85
- 合并前硬检查：`git diff --name-only 98cd5a3..<candidate> -- apps/runtime packages` 必须为空。
- 0686 tag 未移动；`restore/visual-baseline-0686c41` 保留。
- Phase 1B 采用哪条 UI 线仍待用户确认（切片/清理后 UI 基线/延后）。

---

## 10. 尚未解决的问题

1. **ADR 正式签署未完成**：ADR-V2-001/002/003/004/005/008/010/013/014/015/016 仍在评审稿；Phase 1A 前需用户批准。
2. **V25–V27 未实施/未批准**：迁移评审稿已写，但 SQL、回填脚本、V25+ 迁移测试未做。
3. **自动质量门禁默认关闭是产品级降级**：Teamwork 默认会 paused；需可信审批-backed runner 或明确的用户 opt-in UI。
4. **外部 Agent 执行完全禁用**：run 级审批未实现；Phase 4 前不可用；slot/env 代码已预留。
5. **`agentDefinition.run` 仍留在 contracts/preload**，只是 dispatcher 拒绝；Phase 1A 应彻底移除。
6. **`runtime.acpHandshake/acpAuthenticate` 仍可启动进程**：无 Prompt/写入，但仍是进程副作用；需在 Phase 1A 评估是否加审批或限制 cwd。
7. **`runtime.install` UI 按钮仍存在**，点击会显示拒绝错误；应改为禁用/手动安装说明。
8. **视觉回归未做**：安全 UI 文案改动未跑全量截图；Phase 1B 前需视觉验收。
9. **全量 E2E 未跑全**：仅 e2e/agent/v13/v18/r1b/package；v12/command/orchestration 等未跑。
10. **3 个 real-harness 测试 skipped**：无真实外部 Harness。
11. **远程分支未清理**：本地删了 7 个合并分支，origin 仍在。
12. **V24 fixture 是合成数据**：足够兼容测试，但不覆盖所有历史边界。

---

## 11. Phase 0 → Phase 1A Go/No-Go

### 11.1 已达成（Go for Phase 0 closure）

- P0-1~P0-5 全部关闭/硬禁用；P1-1/P1-2 能力关闭；P1-3 修复。
- 合法 Agent 入口回归：`agent-e2e`、`v13-e2e` 通过；Teamwork opt-in 通过，默认暂停有明确提示。
- 备份/恢复、V24 fixture、V24 兼容测试通过。
- lint/typecheck/test/build/package smoke 有实际结果。
- 分支/基线已保护；0686 未覆盖；未自动合并 UI。

### 11.2 不能进入 Phase 1A 的条件（Conditional No-Go）

以下任一未完成，**不开始 Phase 1A 代码**：

1. 用户验收本报告与 Phase 0 安全降级（quality gate/外部执行/自动修复/安装）。
2. ADR 正式签署（至少 001/005/008/013/014/015/016）。
3. V25–V27 迁移评审批准，且 V24→V25–V27 迁移测试计划/停止条件确认。
4. 1A 的 UI 线/范围确认（1B 可后置）。
5. 自动质量门禁的替代路径被用户接受（显式 opt-in / 人工验证 / Agent run_tests）。

> **结论：Phase 0 代码与安全门槛为 Go；Phase 1A 进入为 Conditional No-Go。** 不把未验证项标记为已关闭，不自动进入 Phase 1A。
