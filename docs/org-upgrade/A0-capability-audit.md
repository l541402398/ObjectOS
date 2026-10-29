# A0 — 组织化升级现状能力审计

| 项 | 值 |
|---|---|
| 基线 commit | `9e2f82ab0564cea7dabfdbaf0a620c191d7afc49`（`git rev-parse HEAD`） |
| 分支 | `v2.0-org-a0` |
| 基线提交时间 | 2026-10-29 05:57:27 -0700 |
| 作者 | AI 工程审计 |
| 日期 | 2026-10-29 |
| 性质 | 只读审计。未修改任何代码，未 commit，未 push。 |
| 结论口径 | 本文只陈述"代码里实际存在什么"，不陈述"应该做什么"。凡本机无法运行验证的，一律标注「未验证」。 |

工作区在审计开始时已存在三处**未跟踪**改动（不是本次审计产生的）：
`apps/server/`（仅 `package.json`，无 `src/`）、`packages/organization-contracts/`（仅 `src/index.ts` 草稿）、
`ProjectOS_Organization_Upgrade_UIUX_Implementation_Package/`。本文把它们当作"待评估输入"，不当作已交付能力。

**路径简写约定（全文适用）**：表格中的短路径均指下列完整文件，避免歧义。

| 简写 | 完整路径 |
|---|---|
| `migrations.ts:N` | `packages/persistence/src/migrations.ts:N` |
| `store.ts:N` | `packages/persistence/src/store.ts:N` |
| `read-models.ts:N` | `packages/persistence/src/read-models.ts:N` |
| `entities.ts:N` / `v15.ts:N` / `api.ts:N` | `packages/contracts/src/{entities,v15,api}.ts:N` |
| `api.ts:N`（IPC 方法数） | `packages/contracts/src/api.ts:N` |
| `orchestrator.ts:N` / `orchestration.ts:N` / `agent-runner.ts:N` / `agent-studio.ts:N` / `lifecycle.ts:N` | `apps/runtime/src/<同名>.ts:N` |
| `ipc.ts:N` | `apps/desktop/src/main/ipc.ts:N` |
| `preload/index.ts:N` | `apps/desktop/src/preload/index.ts:N` |
| `SettingsModal.tsx:N` / `TeamSettingsPanel.tsx:N` | `apps/desktop/src/renderer/src/features/settings/<同名>.tsx:N` |
| `stores/ui.ts:N` | `apps/desktop/src/renderer/src/stores/ui.ts:N` |
| `page-registry.ts:N` / `router.tsx:N` | `apps/desktop/src/renderer/src/<同名>.ts(x):N` |
| `ADR 0001:N`（无嵌套反引号） | `docs/adr/0001-runtime-single-writer.md:N`（`0005` 同理） |

---

## 1. 方法与实际执行的命令

全部命令在仓库根目录（本机工作树，路径不写入仓库）下、以 PowerShell 7 执行。
`rg` 不在 PATH（`术语 'rg' 不会被识别`，exit 1），因此检索统一使用 `git grep`、`Select-String` 与 grep 工具。

| # | 命令 | 用途 |
|---|---|---|
| 1 | `git rev-parse HEAD` / `git rev-parse --abbrev-ref HEAD` / `git log -1 --format=...` | 固化基线 commit 与分支 |
| 2 | `git status --porcelain` | 确认工作区已有的未跟踪/已修改项 |
| 3 | `git grep -n "visibility"` | Agent 可见性字段的真实读写点 |
| 4 | `git grep -n "CREATE TABLE" -- packages/persistence/src/migrations.ts` | 全表清单（91 个，不含 `schema_migrations`） |
| 5 | `Select-String -Pattern "^\s+\{ version: (\d+), name: '([^']+)'"` | 迁移条目：共 **36** 条，version 1…36 |
| 6 | `git grep -niE "CREATE TABLE (organization\|account\|membership\|tenant\|users\|…)"` | 组织域表缺失证明（**无匹配**，exit 1） |
| 7 | `git grep -niE "\borganization(Id\|_id)?\b\|\bmembership\b\|\btenant\b" -- 'packages/**/*.ts' 'apps/**/*.ts'` | 源码内组织标识缺失证明（**无匹配**，exit 1） |
| 8 | `git grep -niE "\blogin\b\|\bsignin\b\|oauth\|bearer \|access_token\|refresh_token\|jwt" -- apps/desktop/src/main apps/desktop/src/preload` | 认证/会话缺失证明（**无匹配**，exit 1） |
| 9 | `git grep -rn "TeamSettingsPanel" -- apps/desktop/src` | 命中 1 处，仅定义自身 → 零 import |
| 10 | `git grep -n "acquireTaskLease\|task_leases\|fencingToken"` | 租约/fencing 实现位置 |
| 11 | `git grep -n "projectos/plan-\|worktrees.create"` | Worktree 分支命名与创建点 |
| 12 | `(Select-String api.ts -Pattern "^  '[A-Za-z0-9._-]+': \{").Count`（限 357–1591 行） | IPC 方法数 = **227** |
| 13 | `git status --porcelain --untracked-files=all -- ':!node_modules'`（审计开始 + 审计结束各一次） | 发现工作区在审计期间被**并发修改**（见 §2 末行） |
| 14 | `git grep -n "desktop-login-core\|features/precision" -- ':!node_modules'` | 证明新出现的组织相关文件**未被任何已跟踪代码引用**（exit 1） |
| 15 | 直接读取 | 见下节逐条 `path:line` |

**审计诚信声明**：本审计的"现状"一律指 commit `9e2f82ab0564cea7dabfdbaf0a620c191d7afc49`。
审计过程中检测到同一工作区有并发写者在创建组织相关文件（`apps/server/src/*`、`apps/desktop/src/main/auth/*`、
`apps/desktop/src/renderer/src/features/precision/*`、`tests/org-*.test.ts`）。审计临近结束时该写者又**修改了两个已跟踪文件**：
`router.tsx`（+2 行：`lazy(() => import('./features/precision/PrecisionWorkspace'))` 与路由 `precision-lab`）与
`page-registry.ts`（+1 行：`precision-lab` 条目，`status:'DEV_ONLY'`，note 自称"演示数据，仅供设计评审与视觉回归，不进入产品菜单"）。
因此：

- 本文对 `router.tsx` / `page-registry.ts` 的 `path:line` 引用**以 commit `9e2f82a` 的文件为准**；工作区版本已偏移（page-registry 第 58 行之后整体 +1）。
  核对方式：`git show 9e2f82a:apps/desktop/src/renderer/src/page-registry.ts`。
- 除 `docs/org-upgrade/` 外，本次审计**未修改任何文件**；上述改动来自并发写者，不属于本审计产出。
- 未跟踪文件**未被提交**，其功能、正确性、是否通过测试全部未验证；任何读者都应以 `git status` 复核，不要把未跟踪文件当作已交付能力。


关键读取文件：`packages/contracts/src/{entities,v15,api,plan-grant}.ts`、
`packages/persistence/src/{migrations,read-models,store}.ts`、`packages/application/src/{review-evidence,review-snapshot,project-service}.ts`、
`packages/{planning,worktree,graph-projection,domain}/src/*`、`apps/runtime/src/{orchestrator,orchestration,agent-runner,agent-studio,planner}.ts`、
`apps/desktop/src/{main/ipc,preload/index,main/runtime-supervisor}.ts`、
`apps/desktop/src/renderer/src/{router,page-registry,components/AppLayout,features/settings/SettingsModal,stores/ui}.tsx`、
`scripts/check-boundaries.mjs`、`docs/adr/*`、`docs/design/PROJECTOS_UI_CONTRACT.md`、`docs/next-ui/VISUAL_BASELINE.md`。

---

## 2. 已验证现状能力表

| 能力 | 实际存在什么 | 证据 | 对组织模式的含义 |
|---|---|---|---|
| 本地单用户成员模型 | 无成员表、无账户表。"成员"只存在于一个**零引用的死组件**里，文案自称"当前为本地单用户工作区"、"这台设备上的唯一成员" | `apps/desktop/src/renderer/src/features/settings/TeamSettingsPanel.tsx:12`、`:17`；`git grep -rn TeamSettingsPanel -- apps/desktop/src` 只命中定义处 `:5` | 组织成员关系必须**新建**；该面板不是可扩展的权威面，且当前根本挂不上去（见"设置弹层"行） |
| 设置的 section 枚举 | `SettingsSection` 有 13 个字面量，**没有 `team`**，因此团队面板没有入口 | `apps/desktop/src/renderer/src/stores/ui.ts:6-19`；`apps/desktop/src/renderer/src/features/settings/SettingsModal.tsx:27-41` | A1/A2 若要加入"组织/成员"面板，必须同时改 `SettingsSection` 联合类型与 `SECTIONS`/`renderSection`，否则和 `TeamSettingsPanel` 一样成为死代码 |
| Project 的本地根路径 | `Project.rootPath` 是**必填** `string(1..2048)`；SQLite `root_path TEXT NOT NULL` | `packages/contracts/src/entities.ts:32`；`packages/persistence/src/migrations.ts:15` | 服务端 `Project` 不能携带本机绝对路径；`LocalProjectLink` 是真实必需层，不是可选优化 |
| rootPath 唯一性 | **DB 层无 UNIQUE 约束**；只有应用层去重：`findProjectByRootPath` 后抛错 | `migrations.ts:11-22`（无 UNIQUE）；`packages/persistence/src/store.ts:391`；`packages/application/src/project-service.ts:78-79` | 迁移期若出现两个本地库指向同一路径，DB 不会阻止；`LocalProjectLink` 的唯一性必须由新层显式保证 |
| Requirement 只属于 project | `Requirement.projectId` 非空，FK `REFERENCES projects(id) ON DELETE CASCADE`；无 workspace/branch/baseCommit 概念 | `packages/contracts/src/entities.ts:51-65`（`projectId` 在 `:53`）；`migrations.ts:33-45`（FK 在 `:35`）；版本/迭代列是后加的 `migrations.ts:960-961` | `RequirementWorkspace`（branch/baseCommit/localWorkspaceRef）必须新建；不能从 Requirement 现有列推导 |
| Agent 可见性枚举 | `visibility: 'private' \| 'project' \| 'space' \| 'global'`；DB 列默认 `'project'` | `packages/contracts/src/v15.ts:99`；`migrations.ts:639` | 枚举里已有 `space`，但**没有 space 实体**（见下一行），是"悬空枚举值" |
| Agent 可见性"真正控制什么" | 唯一执行点是 `isAgentVisibleToProject`；`global`/`space` **无条件返回 true**，`private` 要求 `ownerProjectId === projectId`，`project` 允许 `ownerProjectId === null`（历史兼容） | `packages/persistence/src/read-models.ts:1256-1266`（`:1263`、`:1264`、`:1265`） | 可见性实际是"本项目 ownerProjectId 匹配 + 两个万能通配值"，不是租户边界；发布/版本化语义（`OrganizationAssetVersion`）完全缺失 |
| Agent 作用域的存储位置 | 不在 agents 表，而在 `app_settings` 的 `agent_scope:<agentId>`；读侧 `getAgentOwnerProjectId` | `packages/persistence/src/read-models.ts:1245-1248`；写入 `apps/runtime/src/agent-studio.ts:112-114`；契约字段 `packages/contracts/src/v15.ts:127-128`（`ownerProjectId`） | 作用域是"本机 app_settings 的字符串键"，跨机不可解释。组织化必须迁移到显式列/表，否则无法在服务端判定 |
| SQLite 单写者运行时 | Runtime 子进程是唯一写者：主进程 `spawn(process.execPath, [entryPath])`；DB 路径 `dataDir/projectos.db` 或 `PROJECTOS_DB_PATH`；`WAL` + `busy_timeout=5000` + `BEGIN IMMEDIATE` | `apps/desktop/src/main/runtime-supervisor.ts:1`、`:89`；`apps/runtime/src/config.ts:31`；`apps/runtime/src/main.ts:22`；`packages/persistence/src/store.ts:205-208`、`:236-238`；ADR `docs/adr/0001-runtime-single-writer.md:13-14` | "单写者"是**单机单进程**保证。引入 server 会变成双写者（本地 SQLite + 远端 PG/SQLite），A1 必须明确哪一侧是权威 |
| 迁移框架 | 36 条迁移，最新 `version 36 = command approval execution context fingerprint`；启动时逐条校验 sha256，不匹配即**拒绝启动**；每条迁移在 `BEGIN IMMEDIATE` 内执行 | `migrations.ts:1452-1489`（36 条）、`:1491-1493`（checksum）、`:1509-1531`（apply；拒绝逻辑 `:1514-1516`；事务 `:1520-1530`） | "无静默迁移"已经由 checksum 机制保证；新迁移必须**追加 version 37+**，不得改写既有 SQL |
| 现有表总量 | 91 个业务表（不含 `schema_migrations`） | `git grep -n "CREATE TABLE" -- migrations.ts` 计 91 | 组织域 0 张表（见下行） |
| 组织/账户表 | **不存在**。`organization`/`account`/`membership`/`tenant`/`users`/`api_keys` 均无匹配；源码中亦无 `organization`/`membership`/`tenant` 标识 | `git grep -niE "CREATE TABLE (organization\|account\|membership\|tenant\|users\|api_keys)"` → exit 1；`git grep -niE "\borganization\b\|\bmembership\b\|\btenant\b" -- packages/**/*.ts apps/**/*.ts` → exit 1 | 组织域是 100% 新建；任何声称"已支持组织"的文档或 UI 都不可信 |
| 认证/会话 | **在基线 `9e2f82a` 中**：Renderer、Main、Preload 无 login/oauth/token/jwt 任何痕迹；Main 不做身份校验。**审计期间工作区出现了未跟踪的 `apps/desktop/src/main/auth/desktop-login-core.ts`（11,132 B），但 `git grep` 证明它未被任何已跟踪文件 import** | 基线证据：`git grep -niE "login\|signin\|oauth\|bearer \|access_token\|refresh_token\|jwt" -- apps/desktop/src/main apps/desktop/src/preload` → exit 1；新文件：`git grep -n "desktop-login-core" -- ':!node_modules'` → exit 1（仅 `tests/org-desktop-login.test.ts` 这个未跟踪测试引用它） | 当前信任模型是"能启动这台机器的人 = 所有者"。组织模式必须新增 Main 侧会话持有与刷新，且 token 不得进 Renderer。已有一个**未被接线**的 loopback 登录核心可作起点，但"存在文件"≠"能力可用" |
| IPC 边界 | **单一通道** `projectos:request`；227 个具名方法；入参 Main 侧 Zod 校验、Runtime 侧再校验；`MAIN_METHODS` 白名单决定哪些方法留在 Main | `apps/desktop/src/main/ipc.ts:685`（唯一 handle）、`:650-653`（Zod）、`:656`（Main 分流）、`:671`（转发 Runtime）；`packages/contracts/src/api.ts:356`（`ApiSchemas`）、`:1592-1624`（31 个 `MAIN_METHODS`）、`:1637-1639`（`isMainMethod`）；`apps/desktop/src/preload/index.ts:371` | 新增组织方法必须同时改 `ApiSchemas`、`desktop-api.ts`、`preload/index.ts` 三处；否则 Renderer 调不到。无"第二个通道"可绕过 |
| Planner / DAG | 本地规则计划 `generateLocalPlan`（`generatedBy: 'local-rules'`）；`ensureReviewTask` 强制代码计划含审查任务；拓扑 `topologicalPlanTasks`、关键路径 `criticalPathTasks`；校验 `validatePlanDraft` | `packages/planning/src/index.ts:67-151`（`:144` 标记）、`:34-65`、`:153-168`、`:171-195`；`packages/planning/src/validation.ts`；`apps/runtime/src/planner.ts:109`（`PlannerService`） | Planner 是**纯函数 + 单服务**，组织模式下作为 Worker 本地能力复用，不应在服务端重写 |
| DAG 投影 | `buildGraphSnapshot` 把任务/依赖投影成图；layout 单独持久化 | `packages/graph-projection/src/index.ts:49`；`packages/contracts/src/orchestration.ts:279-296`；`migrations.ts:450`（`graph_layouts`）；`apps/runtime/src/orchestration.ts:850-878` | 图仍是"SQLite 的投影"，组织化后投影输入必须加 `organizationId`/`projectId` 作用域，而不是另造画布真源 |
| Plan 批准 = 一个事务 | `approvePlan` 在 `store.transaction` 内创建全部任务+依赖+会话，成功后写 `status:'approved'` | `apps/runtime/src/orchestration.ts:725-840`（`:734` 事务、`:761` 建任务、`:829-836` 落状态） | 组织模式下"Gate 通过 → 生成任务"必须沿用同一事务语义；不能在服务端与本地各建一半 |
| Scheduler / tick | `OrchestrationScheduler`，2.5s 定时 `tick`，`selectStartableTasks` 每 Agent 至多 1 个任务；tick 内依次检查 grant、deadline、approval park、`needs_reconciliation` | `apps/runtime/src/orchestrator.ts:131`（类）、`:396`（定时器）、`:115-129`（选择）、`:1097-1176`（tick 守卫） | 这是"本地执行循环"的既有实现。组织模式 = 给它加**远端租约来源**，而不是写第二套调度器 |
| Task lease / fencing | `task_leases` 每任务一行；`fencing_token = 旧值 + 1`；释放只置 `expires_at=0`（token 不回退）；续约/释放校验 holder+token | `migrations.ts:97-102`；`packages/persistence/src/store.ts:916-940`（`:928` 递增、`:931-937` upsert）、`:942-953`、`:955-965`；ADR `docs/adr/0005-lease-and-recovery.md:12`、`:19` | `WorkerJobEnvelope.fencing` 已有本地对应实现；服务端租约必须复用同一单调性规则，否则重放会重复执行 |
| Run 恢复语义 | 启动时 `recoverInterruptedRuns`：`waiting_approval` 保留，`running/waiting_tool` → `needs_reconciliation`，不自动重试 | `apps/runtime/src/agent-runner.ts:3105-3154`（`:3121`、`:3144`）；`packages/domain/src/task.ts:46-54`；ADR `0005` `:19` | "未知副作用不重试"是硬约束；组织化后跨机崩溃同样必须落到 `needs_reconciliation`，不能由 server 直接重派 |
| ReviewEvidence | 唯一裁决点 `resolveReviewEvidence`：当前内容上"任一未通过即阻塞"，历史审查不decide，无当前审查即不通过 | `packages/application/src/review-evidence.ts:1-21`（规则注释）、`:57-73`（`ReviewEvidenceResolution`）；运行时入口 `apps/runtime/src/review-evidence-runtime.ts:42` | 这是被 ADR 反复收敛过的核心规则（ADR-0024/0025）。服务端 Gate 若自写一套"审查通过"判断，会重现"三个模块三种规则"的老问题 |
| 审查快照 | `ReviewSnapshot` 由 Runtime 读真实文件生成，Agent 写入的 `metadata.reviewSnapshot` 会被丢弃 | `packages/application/src/review-snapshot.ts:3-24`（ADR-0025 说明）、`:121-138` | 审查证据绑定"内容指纹"而非 commit；组织化后跨机审查必须能传到同一指纹，否则审查结论不可复用 |
| Gate / 门禁 | `gate_definitions`（`project_id`、`subject_scope`、`key`、`conditions_json`）+ `gate_evaluations`（`status`、`condition_results_json`）+ `evidence` + `evidence_links` | `migrations.ts:980-991`、`:994-1007`、`:1009-1017`、`:1019-1030`；运行时 `apps/runtime/src/lifecycle.ts:402-475`、`:536` | Gate 是**项目级 + 学科范围**，没有组织级模板与"强制门禁策略"概念 → `WorkflowTemplateVersion.mandatoryGatePolicyId` 无对应 |
| 审批（工具/交付） | `approvals`（绑定 `run_id` + `tool_call_id`）与 `approval_requests`（通用，`subject_type/subject_id/subject_revision/content_fingerprint`，带唯一键） | `migrations.ts:268-282`；`migrations.ts:1100-1117`（唯一键 `:1114`）；契约 `packages/contracts/src/entities.ts:221-235` | 通用审批已按"主体 + 修订 + 内容指纹"去重，可直接承接组织侧 Gate 审批；但 `requested_by/decided_by` 是自由字符串，无账户外键 |
| 计划执行授权 | `PlanExecutionGrant`：动作限定 `plan.start`/`workspace-write`/`run-tests`，绑定 `planFingerprint`，路径/任务/Agent 白名单，`maxRuns`/`maxToolCalls` | `packages/contracts/src/plan-grant.ts:4-16`、`:28-56`；表 `migrations.ts:744`；守卫 `apps/runtime/src/orchestrator.ts:210`、`:1107-1125` | 授权是"用户显式、可撤销、有配额"的，不能由组织角色自动继承；`WorkerJobEnvelope.budget` 应映射到同一预算语义 |
| Worktree / 特性分支 | 分支名 `projectos/plan-${plan.id}`；worktree 落在 `dataDir/worktrees/<projectId>/<planId>`；`create` 单飞、可复用、可 `prune`；`merge` 要求主工作区干净、拒绝敏感/未授权文件、冲突自动 `merge --abort` | `apps/runtime/src/orchestrator.ts:985-1053`（`:1000`、`:1001`、`:1020`）；`packages/worktree/src/index.ts:151-184`、`:191-199`、`:201-223`、`:225-276`（干净检查 `:231-233`） | 分支命名**不含组织/项目/需求维度**，只含 planId；`RequirementWorkspace.branch` 需要独立规则，不能直接沿用 |
| 外部 Runtime 运行 | `runtime-run.ts` 另起 worktree，分支 `projectos/runtime-<runId>` | `apps/runtime/src/runtime-run.ts:117-118` | 第二处分支命名规则，进一步说明"分支命名尚未收敛" |
| 交付合并验证 | `recordedVerificationCommands`、`mergeWouldConflict`、`baseCommitIsAncestor` | `apps/runtime/src/delivery-verifier.ts:26`、`:145`、`:168` | 合并前校验是本地 git 事实，组织侧无法代跑 |
| 路由 | `createHashRouter`；`/settings` 与 `/settings/:section` **重定向到首页** | `apps/desktop/src/renderer/src/router.tsx:58-96`（重定向 `:90-91`） | 设置不是路由页，是全局模态。组织/成员页不能做成路由页，否则违反既有不变式 |
| 页面注册表 | 18 条 `PROJECT_PAGES` + 3 条 `GLOBAL_PAGES`；`settings` 标注为"全局设置模态，不是路由页面"；`design-lab` 为 `DEV_ONLY` | `apps/desktop/src/renderer/src/page-registry.ts:34-53`、`:55-59`（settings `:58`）、`:64-66` | 新增组织页面必须在此登记并有测试防漂移（文件头注释 `:1-15`） |
| 依赖边界检查器 | 硬编码 `PACKAGE_RULES` 白名单（21 个包），只遍历名单内 `packages/*/src`、renderer、runtime | `scripts/check-boundaries.mjs:6-28`、`:30-39`、`:90-109` | **`organization-contracts` 与 `apps/server` 都不在遍历范围**，新包默认不受边界检查 |
| 现有组织域草稿 | 未跟踪的 `packages/organization-contracts/src/index.ts`（14,923 B / 424 行，Zod 契约 + RBAC 纯函数），注释自述"A0 draft (not wired to production UI yet)"；其引用的 `docs/org-upgrade/ADR-ORG-0001-architecture.md` **在审计开始时不存在** | `packages/organization-contracts/src/index.ts:1-13`、`:89-110`（无 rootPath 的 Project）、`:122-133`（LocalProjectLink）、`:313-398`（权限）；审计开始时 `Test-Path docs/org-upgrade` → `False` | 草稿可作为 A1 的起点，但它**未被任何已跟踪代码 import**、未进 `check-boundaries` 名单、且引用了当时不存在的 ADR |
| 服务端脚手架 | **状态在审计期间发生变化**。审计开始时 `apps/server/` 只有 `package.json`（声明 `main: ./src/index.ts`，而 `src/` 不存在）。审计结束前出现了未跟踪的 `apps/server/src/{index,app,desktop-auth,store}.ts`（1,417 / 14,770 / 21,803 / 5,024 B）；`index.ts` 自述"A0 PoC entry point … on 127.0.0.1 only"，监听 `127.0.0.1`、默认端口 4310，`BETTER_AUTH_SECRET` 缺失时用开发回退密钥并打印警告，启动日志自称 "A0 PoC; in-memory data only" | `apps/server/package.json`；`apps/server/src/index.ts:2`（loopback only）、`:14`（默认 4310）、`:18-20`（缺失 secret 告警）、`:24-25`（监听 + in-memory）；审计开始时 `Get-ChildItem apps/server -Recurse -File` 仅 `package.json` + `node_modules/.bin/*` | 服务端从"0 文件"变为"有 PoC 骨架"。但：数据仅内存、无持久化、无组织表、未接线到 Desktop、未运行验证 → **不可视为组织能力已具备**；A1 必须重做持久化与租户隔离 |
| **工作区在审计期间被并发修改**（审计诚信声明） | 审计开始时 `git status` 只有 3 个已修改 + 5 个未跟踪项；结束前新增了 `apps/server/src/*`、`apps/desktop/src/main/auth/desktop-login-core.ts`、`apps/desktop/src/renderer/src/features/precision/*`（15 个文件）、`packages/design-tokens/src/precision.css`、`tests/org-desktop-login.test.ts`、`tests/org-server-poc.test.ts`，并使 `packages/design-tokens/package.json` 变为已修改 | 两次 `git status --porcelain` 对比（2026-10-29 06:56 与 07:06）；`git grep -n "features/precision\|desktop-login-core"` → exit 1（**无任何已跟踪文件引用**）；`router.tsx` / `page-registry.ts` / `stores/ui.ts` / `main/ipc.ts` / `preload/index.ts` 的 `git status` 均为空（未被修改） | 本审计所有"现状"结论**以 commit `9e2f82a` 为准**。上述新文件未提交、未接线、未被任何已跟踪代码 import，因此不改变基线结论；但它们是重要的"进行中工作"信号，且证明**同一工作区存在并发写者**——A1 起必须约定 worktree/分支隔离 |

---

## 2.1 组织化就绪度速览（由上表推导，不引入新证据）

| 分类 | 能力 | 依据 |
|---|---|---|
| **可直接复用**（加作用域参数即可） | Planner 纯函数、`validatePlanDraft`、`buildGraphSnapshot`、`WorktreeManager`、`resolveReviewEvidence`、`ReviewSnapshot`、`selectStartableTasks`、`task_leases` 语义 | §4 复用地图各行的 `path:line` |
| **需扩展**（加列/加方法，不改既有语义） | `project_events` 跨机序号、`gate_definitions` 组织模板、`approval_requests` 账户外键、`org.*` IPC 方法、`SettingsSection` 新 section、`check-boundaries.mjs` 白名单 | 第 2 节对应行；`migrations.ts:201`、`:980-991`、`:1100-1117`；`stores/ui.ts:6-19`；`check-boundaries.mjs:6-28` |
| **需新建**（当前 0 实现） | Account、Organization、Membership、ProjectMembership、`LocalProjectLink`、`RequirementWorkspaceBinding`、`OrganizationAssetVersion`/`AssetBinding`、`WorkflowTemplateVersion`/`WorkflowInstance`、Worker、服务端会话 | 第 2 节"组织/账户表"与"认证/会话"两行；`organization-contracts/src/index.ts:47-278`（仅契约，无实现） |
| **阻断项**（不解决则 A1 不能开工） | 项目 id 权威归属、离线可写集合、token 存放介质、`space` 可见性归并、事件序号跨机聚合 | §5 Q1–Q6 |

---

## 3. 旧 → 新领域映射

| 现有表 / 字段 / IPC | 现状证据 | 目标组织领域 | 映射规则与风险 |
|---|---|---|---|
| `projects`（`root_path`） | `migrations.ts:11-22`；`entities.ts:28-39` | 组织侧 `Project`（无 `rootPath`）+ `LocalProjectLink`（`localProjectId → serverProjectId`，含 `localRootPath`、`workerId`、`mappingVersion`） | 服务器 `Project` 不含任何本机路径。`LocalProjectLink` 必须是**显式、可审计**的桥接，不能靠"路径猜" |
| `projects.id`（本机 cuid 风格 id） | `packages/application/src/project-service.ts:77-110`；`store.ts:309` | `LocalProjectLink.localProjectId` ↔ `serverProjectId` 双 id | 两套 id 必须并存；不得把本地 id 直接当服务端主键（否则离线创建的项目无法上送） |
| `requirements`（`project_id`） | `entities.ts:51-65`；`migrations.ts:33-45` | `Requirement`（`projectId` 指向服务端 Project）+ `RequirementWorkspaceBinding`（`workerId`、`baseCommit`、`branch`、`localWorkspaceRef`、`status`） | Requirement 本身**不携带工作区**；工作区是"某台 Worker 上的解" |
| `requirements.version_id` / `iteration_id` | `migrations.ts:960-961` | 保持本地版本/迭代语义 | 版本/迭代未在组织草稿中出现，A1 需决定是否延后同步（未验证） |
| `agents.visibility` + `app_settings.agent_scope:*` | `migrations.ts:639`；`v15.ts:99`；`read-models.ts:1245-1266` | `OrganizationAssetVersion`（不可变版本 + checksum + `publishedBy`）+ `AssetBinding`（project 级绑定） | 规则建议：`private`→仅本地、不发布；`project`→绑定到 `LocalProjectLink` 对应的 server project；`space`→**无对应实体，必须人工归并**（见 §5 Q4）；`global`→组织级发布，但仍需 `AssetBinding` 才生效 |
| `approvals` | `migrations.ts:268-282` | Workflow 节点的 `human_input` / 审批节点 + `GateEvaluation` | 工具级审批**留在 Worker**（它约束的是本机 shell/文件），只有交付/Gate 级审批上送组织 |
| `approval_requests` | `migrations.ts:1100-1117` | `GateEvaluation`（`subjectRevision`+`contentFingerprint` 唯一键可直接复用） | 已有"同主体同修订同内容只审一次"语义，不要重造 |
| `gate_definitions` / `gate_evaluations` / `evidence` / `evidence_links` | `migrations.ts:980-1030` | `WorkflowTemplateVersion.mandatoryGatePolicyId` + 节点级 `gatePolicyId` + 组织 `GateEvaluation` | 本地 gate 是 project 级；组织模板需要"模板版本冻结"，否则运行中改模板会让历史判定不可解释 |
| `agent_runs` + `run_steps` + `project_events` + `tool_calls` | `migrations.ts:150`、`:171`、`:193-203`（`UNIQUE(project_id, seq)`）、`:252` | Worker 本地执行记录 + 上报事件（`WorkerJobEnvelope` 对应一次派发） | `seq` 是**项目内**单调，不是全局；组织侧聚合必须用 `(workerId, projectId, seq)` 或服务端重编号，否则冲突 |
| `task_leases`（`fencing_token`） | `migrations.ts:97-102`；`store.ts:916-940` | Worker lease（服务端签发 `leaseToken` + `fencing`） | 本地 token 与服务端 fencing **必须是同一单调序列**，否则两套计数会各自回退 |
| `plan_revisions` + `plan_execution_grants` | `migrations.ts:436`、`:744`；`plan-grant.ts:28-56` | Plan/PlanRevision（组织可见）+ 执行授权（Worker 本地） | 计划内容可共享；`allowedPaths` 是本机路径语义，不能上送为组织字段 |
| `worktree` 分支 `projectos/plan-<id>` | `orchestrator.ts:1001` | `RequirementWorkspaceBinding.branch` | 现命名无组织/需求维度；A1 需定义新命名并保证旧 worktree 仍可识别 |
| IPC `project.create` / `project.overview` 等 227 个方法 | `api.ts:356`；`ipc.ts:685` | 保持本地方法不变，新增 `org.*` 方法 | **不得改动既有方法的输入/输出形状**，否则破坏本地模式；组织能力必须是新增方法 |

---

## 4. 复用地图（A1–A5 必须复用，不得重写）

| 复用对象 | 精确位置 | 为什么不能重写 |
|---|---|---|
| `generateLocalPlan`、`ensureReviewTask`、`topologicalPlanTasks`、`criticalPathTasks`、`validatePlanDraft` | `packages/planning/src/index.ts:34-65`、`:67-151`、`:153-168`、`:171-195`；`packages/planning/src/validation.ts` | 计划结构（`PlannedTask.key/dependsOn/role`）已被 Scheduler、审批、Graph 三处依赖；另写一份会产生第二套 DAG 语义 |
| `PlannerService`（AI 计划 + 本地回退） | `apps/runtime/src/planner.ts:109`；调用方 `apps/runtime/src/orchestration.ts:461-553` | 回退标记 `generatedBy:'local-rules'` 是"不得冒充模型生成"的合规点，重写极易丢失 |
| `OrchestrationService.approvePlan`（单事务建任务+依赖） | `apps/runtime/src/orchestration.ts:725-840` | 违反它会重现"半个 DAG"问题（AGENTS.md 明确禁止） |
| `OrchestrationScheduler`（`start`/`tick`/`selectStartableTasks`/`ensureWorkspace`） | `apps/runtime/src/orchestrator.ts:131-154`、`:199-260`、`:1097-1176`、`:985-1053` | tick 里的四道守卫（grant、deadline、approval park、needs_reconciliation）是血泪修复，重写必丢 |
| `AgentRunner`（`startRun`/`awaitRunTerminal`/`decideApproval`/`reconcileRun`/`recoverInterruptedRuns`） | `apps/runtime/src/agent-runner.ts:382`、`:649`、`:2362`、`:2910`、`:3105`；租约 `:426`、`:604`、`:1028` | 预算、快照、审批 park、未知副作用语义全在这里；这是"组织模式下的执行器"，不是可替换件 |
| `resolveReviewEvidence` + `ReviewSnapshot` | `packages/application/src/review-evidence.ts:57-73`；`packages/application/src/review-snapshot.ts:121-131`；运行时封装 `apps/runtime/src/review-evidence-runtime.ts:42` | ADR-0024/0025 收敛后的唯一规则；服务端另写"审查通过"判断 = 回归旧缺陷 |
| `WorktreeManager`（`create`/`changedFiles`/`diff`/`merge`/`remove`/`list`） | `packages/worktree/src/index.ts:151`、`:191`、`:201`、`:225`、`:278`、`:282` | 敏感文件拦截、干净工作区检查、冲突 `merge --abort` 都是安全边界 |
| `buildGraphSnapshot` | `packages/graph-projection/src/index.ts:49` | 图必须是 SQLite 投影；换实现即违反 V1.3 不变式 |
| `QualityGateService` / `delivery-verifier` | `apps/runtime/src/quality-gate.ts:146`；`apps/runtime/src/delivery-verifier.ts:26`、`:145`、`:168` | 交付校验依赖真实 git 事实与真实命令 |
| `RuntimeSupervisor`（Main 侧监管 + 重启） | `apps/desktop/src/main/runtime-supervisor.ts:45`（`shouldRestartOnMissedPong` `:39`） | 崩溃重启与心跳容忍（ADR-0064）已调优，重写会重新引入假死/误重启 |
| Preload 单一 API 面 | `apps/desktop/src/preload/index.ts:371`；契约 `packages/contracts/src/api.ts:356`、`desktop-api.ts`；Main 校验 `apps/desktop/src/main/ipc.ts:650-671` | 三重一致性（ApiSchemas / desktop-api / preload）是既有机制；新增方法必须三处同改 |
| 迁移与 checksum 拒绝 | `packages/persistence/src/migrations.ts:1452-1489`、`:1495-1532` | 保证"无静默迁移"；绕过它等于放弃可解释性 |

---

## 5. A1 必须回答的缺口与硬问题

**Q1 — 谁拥有 `projectId` 的权威？**
本机 `projects.id` 由本地生成（`project-service.ts:77-110`），而组织 `Project.id` 由服务端生成。二者之外还有第三种情况：离线创建、之后才联网。
A1 必须给出：本地先创建还是先服务端创建？`LocalProjectLink.mappingVersion` 何时递增？冲突时以谁为准？（现状没有任何代码回答）

**Q2 — 离线行为到底允许到什么程度？**
现有 Runtime 完全离线可用（本地 SQLite + 本地 git）。组织模式若要求"没有会话就不能写需求"，就会破坏 local-first。
A1 必须逐能力列出离线可写集合，并说明恢复联网后的合并规则。（未验证：无任何离线队列实现）

**Q3 — Main 进程如何持有会话？**
现状 Main/Preload **零认证代码**（第 2 节）。组织草稿只定义了 PKCE 契约（`organization-contracts/src/index.ts:280-308`），没有存储、刷新、失效处理。
A1 必须回答：token 存 `ConnectionSecretStore` 还是新 vault？过期时 IPC 返回什么错误码（草稿给了 `ORG_FORBIDDEN` 等，但未与 `AppError` 码表对齐）？Renderer 是否永久不可见 token？

**Q4 — 全局/space Agent 可见性怎么迁？**
`space` 在枚举里存在但**没有 space 实体**（`v15.ts:99`，全库无 space 表），且 `global`/`space` 在判定上等价（`read-models.ts:1264`）。
A1 必须决定：`space` 是删除、映射为组织、还是映射为项目集合？`ownerProjectId === null` 的历史 Agent（`read-models.ts:1265`）算"全局"还是"孤儿"？

**Q5 — 事件序号如何跨机聚合？**
`project_events` 的唯一键是 `(project_id, seq)`（`migrations.ts:201`）。多 Worker 各自写本地 seq 会碰撞。
A1 必须给出：聚合时按 `workerId` 分区，还是服务端重新编号？审计链如何证明"没有丢事件"？

**Q6 — 谁负责执行？**
草稿的 `WorkerJobEnvelope` 含 `leaseToken/fencing/allowedPaths/permittedToolIds/budget`（`organization-contracts/src/index.ts:258-278`），但现有 Scheduler 只认本地 `planGrantGuard`（`orchestrator.ts:210`）。
A1 必须说明：远端派发的 job 如何进入 `OrchestrationScheduler.start`？是否新增一个"远端授权守卫"而不是替换 `planGrantGuard`？

**Q7 — 既有 227 个 IPC 方法中，哪些必须带组织作用域？**
现状所有方法只接受本地 id（如 `projectId`），没有 `organizationId`。若在方法内部隐式注入组织，会破坏本地模式的可测性。
A1 必须给出显式清单：哪些方法新增 `org.*` 版本，哪些保持原样。

**Q8 — 新增包如何进入边界检查与工作区校验？**
`scripts/check-boundaries.mjs:6-28` 是硬编码白名单，`organization-contracts` / `apps/server` 均不在其中。
A1 必须先扩展该名单，否则"渲染器不得依赖持久化层"等不变式对新包完全失效。

---

## 6. 显式「未验证 / 无法在 A0 验证」

| 项 | 原因 | 影响 |
|---|---|---|
| `apps/server` 能否启动 | 审计开始时 `apps/server/src/index.ts` 不存在；审计结束前该文件出现（未跟踪），但审计为只读，未运行 `tsx`/`pnpm dev` | 服务端"是否有可运行骨架"未验证；即使文件存在也不能声称已验证 |
| 未跟踪的组织相关文件是否可用 | `apps/desktop/src/main/auth/desktop-login-core.ts`、`apps/server/src/{app,desktop-auth,store}.ts`、`features/precision/*`、`tests/org-*.test.ts` 均为审计期间出现的未跟踪文件；未运行任何测试 | 这些文件的功能、正确性、是否通过测试**全部未验证**；且它们可能被并发写者继续修改或删除 |
| `packages/organization-contracts` 是否通过 typecheck | 未被任何已跟踪包 import；未运行 `pnpm typecheck` | 契约草稿可能含类型错误（例如 `z.email()` 的 zod v4 行为） |
| SQLite 表数 91 是否全部仍被读写 | 未做逐表引用追踪 | 只证明"表存在"，不证明"表在用" |
| `better-auth` / `fastify` 版本可用性 | `apps/server/node_modules` 仅有 `.bin` 链接，无包体 | 依赖是否真正安装未验证 |
| 真实 Electron 内组织 UI | 基线中无任何组织 UI（`router.tsx`/`page-registry.ts`/`stores/ui.ts` 在 `9e2f82a` 中无组织相关条目）。审计临近结束时并发写者新增了 `#/precision-lab` 深链接路由（`page-registry` 条目标 `DEV_ONLY`，note 自称"演示数据"），但**未运行、未验证**，且未加入产品导航 | 任何"组织界面已可用"的说法都是未验证 |
| `#/precision-lab` 是否可打开、是否用真实数据 | 该路由在审计最后几分钟才出现，未运行 Electron，未核对 `features/precision/data.ts` 的数据来源 | 该页面是"设计母版/演示数据"还是"真实接线"，A0 无法判定 |
| 迁移在**已升级数据库**上的行为 | 未构造 version 36 → 37 的真实库 | 只验证了 checksum 拒绝逻辑存在，未验证新增迁移的实际执行 |
| 认证 token 的存储介质 | 无实现 | `ConnectionSecretStore` 是否可承载 OAuth token 未验证 |
| 组织级 RLS / 多租户隔离 | 无数据库层实现 | 无法在 A0 评估任何隔离强度 |
| `docs/design/PROJECTOS_UI_CONTRACT.md` 的"五项修复"是否已全部落地 | 该文 `:3` 标 `VISUAL_DIRECTION_APPROVED_WITH_FIVE_FIXES`，`:23` 仍写 "uses fake/prototype data"；未逐项核对实现 | 组织 UI 的基线合规性未验证 |
| 视觉基线 `0686c41` 与当前 HEAD 的差异范围 | 未做 diff（只读审计，且 `docs/next-ui/VISUAL_BASELINE.md:5` 指向另一 worktree 路径） | "组织升级不得破坏视觉基线"只能作为约束记录，无法在 A0 出结论 |

**组织升级不得破坏的既有基线（记录，不评估）**：受保护视觉基线 commit `0686c41` / tag `visual-baseline-approved-0686c41`，唯一视觉事实是 Design Lab DAG 工作台（`docs/next-ui/VISUAL_BASELINE.md:3-6`、`:11`、`:19`）；`docs/design/PROJECTOS_UI_CONTRACT.md:3` 的状态为 `VISUAL_DIRECTION_APPROVED_WITH_FIVE_FIXES`，且 `:25` 明确"不得为了外观改动 Planner/Scheduler/Runtime/Teamwork/IPC 契约或持久化"。
