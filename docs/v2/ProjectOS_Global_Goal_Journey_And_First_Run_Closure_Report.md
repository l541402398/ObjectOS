# ProjectOS V2.0 — Global Goal Journey 与首次使用闭环报告（Phase 2.9-P0）

- 仓库：`l541402398/ObjectOS`
- 分支：`v2.0-phase2.9`（自 `v2.0-phase2.8.8` 基线创建，未回退任何既有实现）
- 本轮 HEAD：`e91d36c`（报告提交后以实际 `git rev-parse HEAD` 为准）
- 基线核对：远端 `v2.0-phase2.8.8` = `7ecf6f5`（用户在任务书中核对的 `a224e8e` 之后有 1 个打包/清单提交，已如实记录；`v2.0-phase2.8.8` 的 PRODUCT_AUTONOMOUS 闭环证据仍在 `docs/v2/evidence/p288-final-closure.txt`）
- 保护：未合并 main、未删除任何分支/worktree、未改写历史；所有验证在独立临时数据目录与 `--user-data-dir` 中进行，不动用户真实库与 `C:\...\workplace\test`

## 1. 首次使用流程真实复现

真实 Electron + 全新数据目录 + 全新空文件夹（脚本 `scripts/p29-goal-journey-e2e.mjs`）：

| 步骤 | 真实结果 |
|---|---|
| 空目录创建项目 | 成功，`initGit=true` 建立 Git 仓库（**没有提交**） |
| 进入项目 | 顶部目标旅程立即出现“项目准备：目录是空 Git 仓库：首次启动会自动建立基线提交” |
| 提交需求 | 需求阶段完成，下一步变成「AI 会在自主模式下生成计划草案」 |
| 生成计划（本地规则，保证确定性） | 「等待你审核计划」，下一步携带真实 `planId` |
| 批准计划 | 审核=done，授权=blocked，下一步「需要授权执行」（**不再显示“未生成计划”**） |
| 授权 | 授权=done，执行=进行中，下一步「已授权，产品会自动开始执行」 |
| 启动执行 | 计划进入 running，随后因**未配置模型 Provider** 失败 |
| 错误可见性 | 旅程显示「执行受阻：尚未配置模型连接」＋真实错误原文，owner=**你**（不是 AI） |
| 换页 | `/work` `/tasks` `/approvals` `/runs` `/versions` `/orchestration` 上旅程栏始终存在 |
| 重启 Electron | 旅程从持久化事实恢复（同一 planId、9 个阶段） |

**E2E 结果：PASS=21 FAIL=0 SKIP=0。**

## 2. 首次执行失败的真实根因与修复

### 2.1 空 Git 仓库无法创建 Worktree（真实阻断，已修 ADR-0050）

真实报错：`无法创建隔离 Worktree，已停止执行：fatal: invalid reference: projectos/plan-pln_01m633…`。

根因（`packages/worktree/src/index.ts`）：空仓库（unborn HEAD）上 `git worktree add -b <branch> <path> HEAD` 必然失败，旧回退再执行 `git worktree add <path> <branch>`，而该分支从未创建 → 用户只看到 `invalid reference`。

修复：

1. `resolveBaseCommit()` 检测未出生 HEAD，抛 `WorktreeBaseMissingError`（中文可执行说明）；
2. 回退只接受真实存在的分支；
3. 编排层在创建 worktree 前调用 `ensureBaselineCommit()`：仅在无提交时用当前目录内容建立基线提交（空目录用 `--allow-empty`），**从不改写已有历史**，并写 `project.baseline.created` 事件；
4. 失败时给出恢复指引，而不是 git 内部错误。

真实恢复证据（`scripts/p29-recover-unborn-project-e2e.mjs`，用用户数据与项目目录的**副本**）：
`workspaceRef` 创建成功、`baseCommit=0d58756…`、旧错误消失；后续新错误为“路由选择的 AI 连接未配置可执行密钥”（副本缺凭据，属验证环境，非产品缺陷）。

### 2.2 缺少模型连接时责任错配（已修）

原旅程把 `执行失败` 一律归给 AI（“AI 将诊断并修复”）。空的模型配置 AI 无法自愈。现在若错误匹配 `Provider / API Key / 尚未配置模型`：owner=**user**，文案「执行受阻：尚未配置模型连接」，并提供 `/?settings=ai-connections` 深链接（AppLayout 识别 `settings=` 参数直接打开设置对应分区）。

### 2.3 「项目准备」抢占下一步指引（已修）

空仓库是**自动处理**的阶段，但投影把第一个 active 阶段当作下一步 → 提交需求后下一步仍显示“项目准备”。修复：下一步只在非 setup 阶段中选择；当前阶段高亮改为**最靠后的 active/blocked**。

### 2.4 不在侧栏分组内的页面导致侧栏“空菜单”（已修 ADR-0052）

编排工作台/工作区/通知中心不是侧栏项，新档案下没有任何分组自动展开，侧栏只剩分组标题。修复：侧栏按页面登记表取所属分组兜底展开（真实截图验证「研发」展开）。

## 3. 全局旅程状态模型

`ProjectJourneyProjection`（`apps/runtime/src/journey.ts`，ADR-0053）只读派生，不新增数据库：

- **九个用户阶段**：项目准备 / 需求 / 计划 / 审核 / 授权 / 执行 / 验证 / 审查 / 交付。
- 每个阶段：`key,label,state(pending|active|blocked|done|skipped),owner(user|ai|system|none),detail,requirements[],satisfied[],objects{planId,revision,taskId,runId,approvalId,grantId,versionId,mergeCommit,evidenceId},entry{label,route}`。
- **计划选择**：执行中(executing) > 最近 approved > 最近 draft，带 `selection.reason`；不会用最新 approved 覆盖正在审核的 draft，也不会因 superseded 而误判。
- **历史/多个目标**：始终返回被选中计划与理由，另外提供后台运行项目数与待审批数。
- **完成判定只认真实证据**：验证阶段用 ADR-0047 可信测试证据（当前内容指纹 + 真实 Run/退出码），审查阶段用 ReviewSnapshot 解析，交付阶段只认 mergeCommit + 合并后验证。

## 4. 业务状态 → 旅程映射（真实映射表）

| 真实状态 | 阶段/状态 | 下一步 owner | 下一步与入口 |
|---|---|---|---|
| 刚建项目、空 Git 仓库 | 项目准备=active | system | 首次启动自动建立基线提交 |
| 有需求、无计划 | 计划=active | ai（自主）/user（assist） | 生成计划草案 → `?plan=` 编排 |
| 计划 draft | 审核=active | user | 等待你审核计划 → 编排计划评审 |
| 已批准、无授权 | 授权=blocked | user | 需要授权执行 → 编排授权面板 |
| 已授权、未启动 | 执行=active | ai | 已授权，产品会自动开始执行 |
| running + 工具审批 | 执行=blocked | user | 等待你批准一次工具调用（含真实 approvalId） |
| running | 执行=active | ai | AI 正在执行，无需你操作 |
| paused / failed | 执行=blocked | ai（或 user：模型未配置） | 诊断修复 / 配置模型连接 |
| 测试失败（当前内容） | 验证=blocked | ai（预算内）/user（耗尽） | 重新规划修复 |
| 旧审查、内容已变 | 审查=blocked | ai | 重新审查当前内容 |
| 计划完成、未交付 | 交付=blocked | user（autoDeliver=false）/ai | 确认交付 / 自动交付 |
| merged 但验证失败 | 交付=blocked | user/ai | 查看合并结果与失败原因 |
| deliveryStatus=verified | 交付=done | none | 已完成交付并验证（含 mergeCommit/evidenceId） |

## 5. 全局 UI 与持久性

- 结构：标题栏 → **全局目标旅程栏（56px）** → 页面 → 状态栏；旅程栏在 `AppShell.subheader`，**不在**会被 `body.po-plan-workspace-open` 隐藏的 `.po-titlebar` 里。
- 紧凑模式：<1180px 或计划全屏工作区自动收敛为单行（阶段数/当前阶段/下一步），可展开查看九阶段详情；展开面板为绝对定位，不改变页面高度（不破坏审批/资源页的 `height:100%` 栏内滚动）。
- 响应式实测：1440 九阶段全显且无截断；1024 与 1440@125% 进入紧凑模式，无横向溢出（`overflowX=0`）。
- 视觉：按用户最新指示，**壳层已切换到 Design Lab 材质/构图**（ADR-0054，批量 1）：环境渐变底、侧栏与主面板光学玻璃配方、旅程栏同名 token；页面主体仍为旧卡片样式，属后续批次（逐页出对照截图）。

截图（真实 Electron）：`docs/screenshots/p29-journey-1440.png`、`p29-journey-1024.png`、`p29-journey-1440-125.png`、`p29-journey-no-project.png`、`p29-journey-restart.png`。

## 6. 实时更新与重启恢复

- 数据源：React Query `['work','journey',projectId]`，5s 轮询 + 路由切换即刷新；**权威来源仍是持久化事实**，事件仅用于触发刷新（当前未接入 runtime 事件推送，见第 8 节）。
- 重启恢复：E2E 关闭并重启 Electron 后，planId 与九阶段完全一致（`before=pln_…/9 after=pln_…/9`）。

## 7. 验证命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS（0 error / 27 warning，边界 OK） |
| `pnpm test` | 见第 9 节（新增 journey/证据/工作树测试后全量通过） |
| `pnpm build` | PASS |
| `pnpm package:dir` + `pnpm test:package` | PASS（打包 EXE 建项目/重启恢复） |
| 真实 Electron E2E `scripts/p29-goal-journey-e2e.mjs` | **PASS=21 FAIL=0 SKIP=0** |
| 真实恢复 E2E `scripts/p29-recover-unborn-project-e2e.mjs` | PASS=6 FAIL=0（空仓库副本上 Worktree 修复生效） |

## 8. 未覆盖的阻断与剩余问题

1. **完整真实 AI 交付链未在本轮复跑**：E2E 数据目录无模型连接，真实执行在“未配置 Provider”处停止；旅程已把该阻断归因给用户并给出一键入口。需要配置真实 DeepSeek 连接后再跑一轮 900s 级真实闭环才能覆盖“验证→审查→合并→交付”。
2. **事件推送未接入旅程栏**：目前 5s 轮询；runtime 事件只驱动其他查询。下一步应在 `runtime.events` 上 invalidate `['work','journey']`，减少延迟。
3. **计划全屏工作区的旅程栏只做了 CSS 层面的紧凑与存在性**：`po-plan-workspace-open` 下未做截图级验收（打开计划全屏评审的自动化入口本轮未打通）。
4. **项目中心的多项目旅程摘要**：API 已返回 `background.runningProjects/pendingApprovals` 并渲染为可点击芯片；但“最近活跃项目卡片内嵌旅程摘要”未实现。
5. **页面主体尚未迁移到 Design Lab 风格**（批量 2+）：工作中心、看板、审批、运行审计、发布/部署、设置等仍为旧样式。

## 9. PASS / FAIL / SKIP / BLOCKED

| 项 | 状态 | 证据 |
|---|---|---|
| 空目录建项目 + 旅程“项目准备” | PASS | E2E |
| 需求 → 计划 → 审核 → 授权 → 启动的状态推进 | PASS | E2E 21/21 |
| 批准后显示待授权（不误报“未生成计划”） | PASS | E2E + 单测 |
| 授权后显示可启动/自动启动 | PASS | E2E + 单测 |
| 换页旅程持续存在 | PASS | 6 条路由实测 |
| 真实错误可见且 owner 正确 | PASS | E2E（Provider 未配置 → user + 设置深链） |
| 重启后状态恢复 | PASS | E2E |
| 测试失败时不显示验证通过 | PASS | E2E + 单测 |
| 布局 1440/1024/125% | PASS | overflowX=0、九阶段/紧凑 |
| 空仓库 Worktree 阻断 | PASS（已修） | 恢复 E2E + 单测 |
| 未配置模型时的完整 AI 运行 | **SKIP** | 环境无模型连接（不是产品判定） |
| 验证→审查→合并→交付全链 | **BLOCKED** | 同上，需真实模型 |
| 计划全屏下旅程栏截图验收 | **SKIP** | 自动化入口未打通 |
| 页面主体 Design Lab 迁移 | **未开始（批量 2+）** | 本批仅壳层 |

## 10. 结论

- 首次使用用户现在在**任何正式页面**都能看到：正在完成什么目标、处于九步中的哪一步、系统在做什么、若停下缺少什么以及下一步归谁，并可直接点进对应对象。E2E 从空目录到“真实错误归因 + 一键配置模型”全程通过（21/21）。
- 但“首次使用全程无阻断”仍未达成：**空目录需要模型连接才能真正跑起来**。这是产品的真实前置条件，旅程栏现已把它变成一步可完成的用户动作，而不是隐藏的失败。
- 本轮未宣称全局旅程已覆盖交付全链；待真实模型连接后复跑 E2E，再决定 Phase 2 是否最终关闭。不进入 Phase 3。
