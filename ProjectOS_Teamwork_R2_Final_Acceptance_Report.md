# ProjectOS Teamwork R2 Final Acceptance Report（R2.1）

> 日期：2026-10-21
> 范围：R2.1 最终收尾，只关闭 R2 报告中未完成的 **P0-04** 与 **P1-09**。
> 基线：R2 提交 `8b1739b`（R1 为 `5afd7a0`）。
> 非目标：Phase 2B Planner、新 Teamwork 页面、编排架构重构；均未开始。
> 证据目录：`test-results/r21/`（15 张 Electron 截图）；`test-results/r2/`（6 张替代确认截图）。
> 真实 Harness 密钥仅通过环境变量注入，未写入代码、数据库、日志或本报告。

## 1. 结论

| 问题 | 结论 |
|---|---|
| P0-04 是否真正关闭 | **是**。风险分级人工验收已落地，权限、证据、独立审批、覆盖审计、重复提交、历史兼容与拒绝路径均有真实测试。 |
| P1-09 约定范围是否完成 | **是**。Settings、Runs/Reconcile、Collaboration/Handoff、Agent 工作台、Orchestration 抽屉均完成真实 Electron 回归。 |
| 设置页“新增连接”是否真实鼠标点击通过 | **是**。修复装饰层命中遮挡后，R2.1 UI 与 V1.3 均使用真实鼠标点击通过，未使用 DOM/JS click。 |
| 是否有新的发布阻断 | **无**。剩余为范围性风险，见 §6。 |
| 既有回归是否全部通过 | **是**。lint/typecheck/test/build、V1.3/V1.4/V1.8、R2 UI、R2.1 UI、打包 smoke/features/migration 全部通过。 |
| Phase 2B 是否可以开始 | **可以**。以本报告与更新后的 Open Issues 作为准入门槛记录；范围性风险需在后续阶段继续覆盖。 |

## 2. P0-04：风险分级人工验收

### 2.1 与真实产品模型对齐

- 不新增 admin/approver 角色。ProjectOS 当前只有本机项目所有者 `local-user`，人工验收仅允许该 actor：
  - 其他 `user` id：`FORBIDDEN`；
  - Agent/System：不能提交人工验收，仍走严格证据链；
  - Agent 写入 `metadata.acceptanceMode=human` 的 Artifact 不会被信任。
- 复用现有 `Approval` 实体/表、`TaskService`、`CompletionDecision`、Policy 风险语义，未新增审批表或迁移（数据库仍为 V21）。
- 风险等级只从持久化执行事实推导，不读取 Agent 提供的风险标签：
  - 工具：`write_file`、`run_command`、`run_tests`、`runtime.*`、`git_commit`；
  - 文件：V21 `run_file_changes` 的归属变更；
  - 敏感路径：`.env`、secrets/credentials、SSH/AWS、auth/permission/security/crypto、migrations/schema、`package.json`、`electron-builder.yml`、`.github/workflows`；
  - 破坏性命令（如 `rm -rf`、`git reset --hard`、`git push --force`、`npm publish`）；
  - `needs_reconciliation` Run、`priority=1`。
- 额外证据来自可核验事实：已验证的非 document Artifact、成功的写/进程/外部 Runtime 工具、V21 文件归属。

### 2.2 分级规则

| 风险 | 判定 | 人工完成要求 | 覆盖自动要求 |
|---|---|---|---|
| 常规 | 无写入/进程/敏感路径 | 所有者可直接确认；未填理由时写入默认审计理由 | 允许，审计记录 `override` 与覆盖项 |
| 高风险 | 有写入/进程/删除/紧急优先级等 | 必须显式安全确认 `confirmHighRisk` + 额外证据 + ≥8 字理由 | 必须显式 `override` |
| 关键风险 | 敏感路径、Git 写、破坏性命令、外部 Runtime、待核对 Run | 禁止直接完成；必须创建并批准独立验收 Approval，再确认完成 | 审批通过后记录覆盖项与 `approvalId` |

- 关键风险审批复用 `approvals`：绑定任务与最近一次真实 Run，24 小时过期；同一任务重复申请复用待审批记录；拒绝后不能完成，可补充理由重新申请。
- 验收 Artifact 记录：`acceptanceMode`、`riskLevel`、`riskReasons`、`operator`、`decidedAt`、`reason`、`evidence`、`unsatisfiedRequirements`、`override`、`overriddenRequirements`、`approvalId`；正文同步记录风险与覆盖依据。
- UI：任务看板“完成验收”弹窗（既有页面内），展示风险、证据、未满足要求，支持高风险确认、覆盖声明、关键风险申请/批准/拒绝/确认完成；未新增 Teamwork 页面。

### 2.3 测试证据

`tests/r2-human-acceptance.test.ts`：**6 tests PASS**。

| 场景 | 断言 |
|---|---|
| 常规任务 | 完成后 Artifact 记录 owner=`local-user`、时间、理由、`riskLevel=normal` |
| 高风险 + 覆盖 | 无显式确认被拒；无 `override` 被拒；确认 + 证据 + override 后完成；审计含被覆盖的“测试报告”要求与 1 个归属文件 |
| 高风险但无额外证据 | 即使确认也被拒，任务保持 `review` |
| 关键风险 | 直接完成返回 `APPROVAL_REQUIRED`；重复申请返回同一 approvalId；待审批确认被拒；审批拒绝后不能完成；重新申请并批准后完成；Artifact 含 critical 与 approvalId |
| 权限/冒充 | 其他用户 `FORBIDDEN`；Agent 仍按严格证据返回 `CONFLICT`；伪造 human 元数据 Artifact 仍不能通过 |
| 历史/重复 | 旧验收 Artifact `metadata={}` 可读；任务仍 done；重复完成返回 `CONFLICT` |

UI 验证：`r21-ui-regression` 中真实鼠标完成高风险验收任务，任务最终状态 `done`，截图 `task-acceptance-high-risk.png`。

## 3. P1-09：真实 Electron UI 回归

### 3.1 设置页“新增连接”命中问题（真实产品缺陷）

- 根因：V1.6 设置头部装饰性 `::after` 光斑（180×180，右上角）位于按钮之上并参与命中测试，`elementFromPoint` 返回 `.po-settings-panel-head`；旧 E2E 用 `element.click()` 绕过，掩盖了缺陷。
- 修复（`apps/desktop/src/renderer/src/styles/v16.css`）：
  - `::before/::after` 增加 `pointer-events: none`、`z-index: 0`；
  - 头部 `isolation: isolate`，直接子元素 `position: relative; z-index: 1`；
  - 保留玻璃视觉，未删除遮挡断言、未隐藏覆盖层。
- 结果：真实鼠标点击“新增连接”打开内联编辑器；V1.3 中原 DOM click 已删除并改为真实点击，通过。

### 3.2 键盘与焦点

- 修复验收编辑器 Escape 不退出：编辑器容器捕获 Escape 并关闭子视图，不误关整个设置弹窗。
- 验证：设置弹窗打开后焦点留在 `.ant-modal` 内；无嵌套 modal；缩放 125% 后编辑器仍在窗口内；Escape 后无残留编辑器/遮罩。

### 3.3 覆盖矩阵（`scripts/r21-ui-regression.mjs`，16 checks PASS）

| 区域 | 覆盖 |
|---|---|
| Settings | 真实点击新增连接、内联编辑器、焦点陷阱、无嵌套 modal、125% 缩放、Escape、浅/深色 |
| Runs/Reconcile | 运行行 → 运行详情 modal → “人工核对” → 核对 modal；浅/深色；真实取消/关闭 |
| Collaboration/Handoff | 交接/收件/会话内容渲染，浅色截图 |
| Agent 工作台 | 会话/Agent 内容渲染，浅色截图 |
| Orchestration | 真实图节点、点击任务节点打开抽屉、浅/深色截图 |
| 全局 | 缺失项目错误态、侧栏真实折叠、1100×760 无横向溢出、无 renderer page error |

截图（15 张，`test-results/r21/`）：
`settings-editor-light.png`、`settings-editor-dark.png`、`settings-editor-zoom125.png`、
`runs-detail-light.png`、`runs-reconcile-light.png`、`runs-reconcile-dark.png`、
`collaboration-light.png`、`agents-light.png`、`orchestration-light.png`、
`orchestration-drawer-light.png`、`orchestration-drawer-dark.png`、
`error-project-missing.png`、`runs-sidebar-collapsed.png`、`runs-resized-1100.png`、
`task-acceptance-high-risk.png`。

R2 既有替代确认截图仍保留：`test-results/r2/reassign-{light,dark,zoom-125,sidebar-collapsed,confirmed,declined}.png`。

## 4. 回归与打包结果

| 命令 | 结果 |
|---|---|
| `pnpm lint` | PASS（0 error；依赖边界检查 PASS） |
| `pnpm typecheck` | PASS |
| `pnpm test` | **207 passed，3 skipped**；41 个测试文件通过、1 个跳过（真实 Harness 无密钥时跳过） |
| `pnpm build` | PASS |
| `pnpm package:dir` | PASS（重建 `release/win-unpacked`） |
| `pnpm test:package` | PASS（打包 EXE 创建项目、写 starter 文件、重启恢复） |
| `r2-package-features` | PASS（runtime 10 项 + renderer 3 项，含 P0-04 API/验收弹窗与 R2 替代面板） |
| `r2-package-migration` | PASS（V18→V21；legacy 数据保留；未触碰用户 DB） |
| V1.8 Teamwork E2E | PASS（7 checks，9 provider requests） |
| V1.3 E2E | PASS（真实鼠标点击新增连接；plan superseded；10 nodes/12 edges） |
| V1.4 E2E | PASS（findings 1；proposals 2 pending_approval；propose 模式） |
| R2 Reassign UI | PASS（12 checks，6 张截图） |
| R2.1 UI regression | PASS（16 checks，15 张截图） |

真实 Harness：本阶段未重复付费运行，沿用 R2 的真实 OpenCode CLI + DeepSeek 证据（成功 `run_01m5fmj8t2c9tmat93sf31y5h5`、取消 `run_01m5fmkgzt6wzm7e6eds34qcbj`、失败 `run_01m5fmkhpf5fgjcf5ww5pb6vqw`）。`pnpm test` 中 3 个真实 Harness 测试因无密钥跳过，未标记为 R2.1 重新通过。

## 5. 过程中的失败与修复（未隐藏）

1. **设置页命中失败**：由装饰 `::after` 抢占，已按 §3.1 修复；不是删除断言或隐藏覆盖层。
2. **Escape 无响应**：编辑器未处理键盘事件，已修复并纳入回归。
3. **首次 R2.1 UI 验证报 `未知方法：task.acceptancePolicy`**：runtime `dist` 未重建，属于验证环境遗漏；重建 runtime 后通过，不是产品缺陷。
4. **既有测试因新策略失败 3 项**：常规任务无理由、正常覆盖理由过短；已调整为常规风险默认审计理由，并更新需覆盖场景的测试理由，未放宽高风险/关键风险要求。
5. **Playwright 选择器问题**：项目路由应为 `#/projects/:id`、Ant 双汉字“取消”带空格；修正的是测试脚本，不是产品行为。

最终无未解决失败。

## 6. 范围性风险（不构成发布阻断）

- 真实 Harness 只覆盖 **OpenCode + DeepSeek**；其他 Harness 未验证（与 R2 相同）。
- P1-09 覆盖约定页面与状态，不是全站逐页像素级视觉回归；自动化断言覆盖真实命中、焦点、溢出与弹窗层叠，截图用于人工复核。
- 打包验收为 `win-unpacked` smoke，不包含安装器签名、自动更新与分发渠道验证。
- 未在本阶段重新执行付费真实模型运行；相关结论沿用 R2 证据并已注明。

## 7. 证据索引

- 单元/集成测试：`tests/r2-human-acceptance.test.ts`、`tests/agent-completion-tool.test.ts`、`tests/application.test.ts`、`tests/r2-revision-inbox-legacy.test.ts`
- UI 回归：`scripts/r21-ui-regression.mjs`、`scripts/r21-prepare-ui.ts`、`scripts/v13-e2e.mjs`
- 打包：`scripts/package-smoke.mjs`、`scripts/r2-package-features.mjs`、`scripts/r2-package-migration.mjs`
- 截图：`test-results/r21/`（15 张）、`test-results/r2/`（6 张）
- 问题清单：`docs/Agent_Teamwork_Open_Issues.md`（P0-04、P1-09 已更新为已验证关闭）
