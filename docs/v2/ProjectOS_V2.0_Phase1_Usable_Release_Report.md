# ProjectOS V2.0 — Phase 1 Usable Release Report

> 阶段：M1 研发主工作流 → M2 生命周期基础 → M3 一期可用版本  
> 分支：`v2.0-phase1`  
> 基线：`v2.0-phase0` @ `3665554`（Phase 0 安全修复完整保留）  
> 代码提交：`2ace719`  
> 日期：2026-10-27  
> 状态：**可试用的 Phase 1 版本；未进入 Phase 2 发布/部署/生产运维**

---

## 1. 交付摘要

本轮不是设计文档，而是实际代码改造。已交付：

1. **研发工作中心**（默认项目首页）：需求、计划、审核/批准、授权、执行、Agent、审批、运行、成果、活动在一个页面内闭环。
2. **版本与迭代页面**：真实 V25–V27 数据库、多版本、版本阶段推进、迭代、环境、项目关注对象。
3. **受控验证入口**：review 任务可请求 AgentRunner 受控验证，走既有 Run/ToolCall/Approval/预算链。
4. **V25–V27 迁移**：Product/ProductVersion/Iteration/Environment/ProjectFocus、Task/Plan 版本关联、Gate/Evidence/Checkpoint 基础表。
5. **导航收敛**：从 13 个项目内导航项收敛为 8 个（研发 5 + 项目 3），旧路由保留。
6. **真实 Electron 截图、单元测试、E2E、打包 Smoke**：见 §5。

**明确未做：** 发布、部署、生产监控、线上自动修复、多用户 ACL、远程 Worker、真实生产操作。

---

## 2. 工程基线

- 新分支：`v2.0-phase1`
- 独立 worktree：`C:\Users\Administrator\Desktop\workplace\ProjectOS-v2-phase1`
- 起点：`v2.0-phase0` @ `3665554`
- Phase 0 保护未丢失：
  - `runtime.execute` / `runtime.acpPrompt` 仍不在 ApiSchemas/preload
  - `agentDefinition.run` 仍硬拒绝
  - 外部 Agent 执行/写模式仍禁用
  - 自动修复仍禁用
  - `runtime.install` 仍禁用
  - 自动质量门禁仍默认关闭
- 未 reset / clean / force-push；未删除分支；未覆盖其他 worktree。

---

## 3. M1：研发主工作流

### 3.1 已实现

- 新增 `WorkCenterPage`，项目默认入口为 `/projects/:projectId`（兼容 `/work`）。
- 原有 `/overview` 仍可访问（项目姿态）。
- 工作中心聚合：
  - 需求数量与最近需求
  - 当前计划（rN/状态/生成方式/模型/节点数）
  - 计划任务与状态、依赖数、成果数
  - 执行状态、执行授权、完成度
  - Agent 在线/执行中
  - 最近 Run、失败/待对账 Run
  - 待审批、待验收
  - Artifact、活动、下一步
- 操作：
  - 记录需求（真实 `requirement.create`）
  - 生成 AI 计划（`plan.generate` mode=ai）
  - 无模型时生成规则草案（明确标记 `local-rules`）
  - 批准计划（`plan.approve`，不自动授权）
  - 授权执行（`plan.grant.issue`，revision/tasks/agents/paths/budget/24h）
  - 启动/暂停/继续（`orchestration.start/pause/resume`）
  - 请求受控验证（`verification.request` → `AgentRunner.startRun`）
  - 跳转 Plan Review、任务、Agent、审批、运行、知识
- 导航收敛：研发工作中心、任务与验收、Agent 协作、审批、运行审计、项目姿态、版本与迭代、知识与成果、项目设置。
- 旧路由/命令面板保留，不删除业务入口。

### 3.2 受控验证路径

`verification.request`：

```text
Review task
  -> verification.request
  -> 创建/复用 Agent session
  -> AgentRunner.startRun
  -> Run + ToolCall + Policy/Approval + lease/slot + budget
  -> run_tests / 受控命令
  -> test-report Artifact
  -> CompletionDecision / 人工验收
```

- 不绕过 AgentRunner；不复用已删除的 raw runtime 入口。
- 无 Provider 时明确失败，不伪造执行。
- 自动质量门禁默认关闭时，Scheduler 会 paused 并提示；用户可从工作中心请求受控验证。

### 3.3 未完成/限制

- 受控验证依赖已配置模型 Provider；无 Provider 时只能失败提示。
- 自动质量门禁仍默认关闭，Teamwork 自动流程仍会 paused；需要显式 `PROJECTOS_ENABLE_AUTO_QUALITY_GATE=1` 或人工/Agent 验证。
- 工作中心不是完整 Plan Editor；复杂 DAG 编辑仍进入 Plan Review。
- 大 DAG 缩放可读性未做专项优化。

---

## 4. M2：Phase 1A 生命周期基础

### 4.1 V25–V27 已实施

| 版本 | 内容 | 状态 |
|---|---|---|
| V25 | `products`、`product_versions`、`iterations`、`environments`、`project_focus` + 旧项目回填 | **已实施** |
| V26 | `requirements`/`tasks`/`milestones` 的 version/iteration 字段；`tasks.work_type/source_*`；`plan_revisions.kind/subject/environment` | **已实施** |
| V27 | `gate_definitions`、`evidence`、`evidence_links`、`gate_evaluations`、`run_checkpoints`；artifact 证据字段；默认 version gate | **已实施** |

### 4.2 领域能力

- 新建项目自动创建：默认 Product、Version `0.1.0`、Environment `local`、ProjectFocus=version。
- 旧项目 V24→V27 自动回填，`current_stage` 原样保留。
- 多版本：创建新版本、设为默认、切换当前关注、推进阶段。
- 版本阶段：planned → discovery → build → verify → release_candidate → released → maintenance → retired；非法跳转拒绝。
- 迭代：创建、开始、关闭、取消；归属版本。
- 环境：登记 local/staging/production/custom；不自动部署。
- 项目姿态：产品/版本/活跃版本/迭代/环境/待审批/待验收/Run 计数。
- 计划版本关联：WorkCenter 生成计划时写入当前版本；批准后任务继承 `versionId`。
- 任务版本过滤：任务看板按版本过滤；手建任务默认归当前版本。
- 任务/计划的版本关联真实写入 SQLite，不是前端标签。

### 4.3 明确未完成

- 迭代尚未在任务/计划 UI 中强制归属（数据库字段已就绪，计划只带 version）。
- Gate/Evidence 表已建，但尚无版本门禁评估 UI/API；默认 gate 只 seed 定义。
- 导入现有项目复用“创建项目 + 指向已有目录 + scan”，没有独立导入向导。
- 没有 Release/Deployment/Incident 实体，未伪造。
- 版本阶段推进不校验 GateEvaluation（当前只校验合法状态转移）。
- 没有多产品 UI（默认 1 个产品；数据库支持多产品）。

---

## 5. 实际验证结果

### 5.1 静态/单元/构建

| 命令 | 结果 |
|---|---|
| `pnpm lint` | **PASS**，0 errors，2 个既有 warnings（PlanReviewNext） |
| `pnpm typecheck` | **PASS** |
| `pnpm test` | **PASS**：51 files passed / 1 skipped（52）；275 tests passed / 3 skipped（278）；66.92s |
| `pnpm build` | **PASS** |
| `pnpm package:dir` | **PASS** |
| `pnpm test:package` | **PASS**（打包 EXE 创建项目、写 starter、重启恢复） |

新增测试：

- `tests/lifecycle.test.ts`：2/2 PASS（默认生命周期、并行版本/迭代/环境/focus、非法阶段跳转拒绝）。
- `tests/phase0-migration.test.ts`：1/1 PASS（V24 fixture 升级 V27，旧数据保留）。
- `tests/phase0-security.test.ts`：6/6 PASS（Phase 0 安全边界未回退）。

### 5.2 E2E

| 脚本 | 结果 |
|---|---|
| `node scripts/e2e.mjs` | **PASS**（桌面创建项目 + 重启恢复；新默认工作中心标题包含项目名） |
| `node scripts/agent-e2e.mjs` | **PASS**（真实审批暂停、批准写入、恢复循环、Run completed） |
| `node scripts/v13-e2e.mjs` | **PASS**（scan、DAG、graph、布局、重启恢复） |
| `node scripts/r1b-kill-restart-e2e.mjs`（Phase 0 继承） | **PASS 25 checks**（kill 后 `needs_reconciliation`、无自动重放） |
| `node scripts/v18-teamwork-e2e.mjs`（默认） | **FAIL（预期）**：plan=paused，自动质量门禁关闭 |
| `node scripts/v18-teamwork-e2e.mjs` + `PROJECTOS_ENABLE_AUTO_QUALITY_GATE=1` | **PASS 7 checks**（9 provider requests） |
| `node scripts/m1-flow-e2e.mjs` | **PASS**：version=0.1.0；4 tasks；tasksVersioned=4；planVersioned=versionId；grantValid=true；start running |
| `node scripts/workcenter-screenshots.mjs` | **PASS**：1440/1024、Light/Dark、work center + versions |

`m1-flow-e2e` 在无 Provider 时按预期：

- 计划批准/授权/启动成功；
- Agent 启动失败，错误为“尚未配置模型 Provider”；
- 未伪造完成、未伪造测试结果。

### 5.3 截图证据

`docs/screenshots/`：

- `1440x900-light-work-center.png`
- `1440x900-light-work-center-plan.png`
- `1440x900-dark-work-center.png`
- `1440x900-light-versions.png`
- `1440x900-dark-versions.png`
- `1024x768-light-work-center.png`
- `1024x768-light-versions.png`
- 对应 dark/plan 变体

视觉检查：

- 1440×900、1024×768 无横向溢出；
- Light/Dark 均通过截图；
- 使用既有 Premium Liquid Glass/Design Lab tokens，不是普通后台模板；
- 1024 下侧栏自动收起为图标，核心工作中心仍可读。

---

## 6. 场景验收

| 场景 | 结果 | 说明 |
|---|---|---|
| A 新项目 | **可用（需 Provider 才完成真实 Agent 执行）** | 创建项目→需求→计划→批准→授权→启动→Agent 审批/执行→成果；无 Provider 时明确失败 |
| B 已有项目 | **基础可用** | 创建项目指向已有仓库→默认版本/环境→scan→提需求→计划；无独立导入向导 |
| C 并行版本 | **可用（基础）** | 多版本/迭代/环境；计划/任务带 versionId；任务看板按版本过滤；currentStage 不阻断 |
| D 执行异常 | **部分可用** | Provider 缺失、Runtime 不可用、审批拒绝、质量门禁 paused 都有真实错误；恢复依赖既有 Scheduler/Reapproval；受控验证入口已加 |
| E 长期连续性 | **通过** | e2e/package smoke 重启恢复；SQLite 持久化；版本/计划/任务/成果保留 |

---

## 7. 已禁用/未实现（不得误认为可用）

- 发布 Release / 制品库 / Deployment / 回滚：未实现。
- 生产监控、Grafana/SigNoz 接入、事故/告警/SLO/Runbook：未实现。
- 外部 Agent 执行/写模式：Phase 0 起保持禁用。
- 自动修复：保持禁用。
- 自动质量门禁：默认关闭；显式 opt-in 才执行。
- 多用户/ACL/双人审批/远程 Worker：未实现。
- V27 Gate/Evidence 评估 UI：未实现。
- 迭代任务归属 UI：未完成。
- 独立“导入已有项目”向导：未完成。
- 生产部署/数据库生产迁移：未执行。

---

## 8. 已知技术债/Backlog

1. 自动质量门禁需要“受控脚本/审批-backed runner”，当前只能显式环境变量 opt-in。
2. 受控验证 API 无 Provider 时不能执行；需要 UI 引导配置连接。
3. 版本阶段推进未接 GateEvaluation；V27 gate 表尚未使用。
4. 计划版本关联只在 WorkCenter 生成后写入；Plan Review 内修改版本未支持。
5. 迭代未进入 Task/Plan 的创建表单。
6. TaskBoard 只有版本过滤，没有版本分组/迭代分组。
7. 版本页面 Task/Plan 计数与关联成果未聚合。
8. 导入项目缺少专门向导和基线确认页。
9. 大 DAG 缩放/可读性未做专项优化。
10. 未跑全量视觉回归（只跑核心工作中心/版本页）。
11. 未跑 v12/command/orchestration 等全部 E2E。
12. 打包 Smoke 只覆盖创建/重启，不覆盖所有新页面。

---

## 9. 结论与 Go/No-Go

### 已达成

- M1 研发主工作流：**真实代码、真实 API、真实截图、真实 E2E**。
- M2 生命周期基础：**V25–V27 已迁移，真实数据库测试通过**。
- M3 集成：工作中心 + 版本/迭代 + 计划/任务版本关联可用。
- 未恢复任何 Phase 0 已封堵的高危入口。
- 未创建虚假 Release/Deployment/Incident。

### 结论

**Phase 1 可试用版本：Conditional Go。**

允许作为本地试用品验收：

- 新项目/已有仓库的研发主流程；
- 单/多版本基础管理；
- 有 Provider 时的真实 Agent 协作；
- 无 Provider/质量门禁关闭时的明确错误与人工路径。

**不满足生产发布条件：**

- 自动质量验收仍不完整；
- Gate/Evidence 未闭环；
- 无发布/部署/监控/运维；
- 多用户/ACL 未实现；
- 未做全量视觉回归与全量 E2E。

**停止点：** 完成 M3 后停止，等待产品验收；不自动进入 Phase 2 生产部署/运维。

---

## 10. 复现命令

```bash
cd C:\Users\Administrator\Desktop\workplace\ProjectOS-v2-phase1
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node scripts/e2e.mjs
node scripts/agent-e2e.mjs
node scripts/v13-e2e.mjs
node scripts/m1-flow-e2e.mjs
node scripts/workcenter-screenshots.mjs
pnpm package:dir
pnpm test:package
```

> 注：Electron E2E 需要 `node_modules/electron/dist/electron.exe`；本 worktree 通过链接既有 43.8.2 安装准备。Teamwork 质量门禁验证需显式 `PROJECTOS_ENABLE_AUTO_QUALITY_GATE=1`。
