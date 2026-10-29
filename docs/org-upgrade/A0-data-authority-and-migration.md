# A0 — 数据权威与迁移方案

| 项 | 值 |
|---|---|
| 基线 commit | `9e2f82ab0564cea7dabfdbaf0a620c191d7afc49`（`git rev-parse HEAD`） |
| 分支 | `v2.0-org-a0` |
| 作者 | AI 工程审计 |
| 日期 | 2026-10-29 |
| 性质 | 只读审计 + 迁移方案设计。未执行任何迁移、未修改代码、未 commit / push。 |
| 起点 schema | SQLite `user_version` 语义由 `schema_migrations` 表承担；**最新迁移 version = 36**，name = `command approval execution context fingerprint`（`packages/persistence/src/migrations.ts:1488`）；迁移总数 **36**（`migrations.ts:1452-1489`） |

**路径简写约定（全文适用）**：`migrations.ts:N` = `packages/persistence/src/migrations.ts:N`；
`store.ts:N` = `packages/persistence/src/store.ts:N`；`read-models.ts:N` = `packages/persistence/src/read-models.ts:N`；
`entities.ts:N` / `v15.ts:N` = `packages/contracts/src/<同名>.ts:N`；
`orchestrator.ts:N` / `agent-runner.ts:N` = `apps/runtime/src/<同名>.ts:N`；
`TeamSettingsPanel.tsx:N` = `apps/desktop/src/renderer/src/features/settings/TeamSettingsPanel.tsx:N`；
`stores/ui.ts:N` = `apps/desktop/src/renderer/src/stores/ui.ts:N`；
`ADR 0001:N`（无嵌套反引号） = `docs/adr/0001-runtime-single-writer.md:N`（`0005` 同理）；
`organization-contracts/src/index.ts:N` 在表格中简写为 `:N`（承接上一行的同一文件）。

**阅读前提（以 commit `9e2f82a` 为准）**：该 commit 中**不存在**任何组织域表或认证代码。`git grep -niE "CREATE TABLE (organization|account|membership|tenant|users|api_keys)"` 无匹配（exit 1），
`git grep -niE "\borganization\b|\bmembership\b|\btenant\b" -- 'packages/**/*.ts' 'apps/**/*.ts'` 无匹配（exit 1）。
因此下表的"组织模式权威"一列，**全部是待建目标，不是现状**。本文不把设计写成已完成事实。

**工作区并发变更声明**：审计期间同一工作区出现了未跟踪的 `apps/server/src/{index,app,desktop-auth,store}.ts`、
`apps/desktop/src/main/auth/desktop-login-core.ts`、`apps/desktop/src/renderer/src/features/precision/*`（15 个文件）、
`tests/org-desktop-login.test.ts`、`tests/org-server-poc.test.ts`；临近结束时有写者修改了 `router.tsx`（+2 行）与
`page-registry.ts`（+1 行）以挂载 `#/precision-lab`（`DEV_ONLY`，自称演示数据）。这些改动**均未提交**，
且 `git grep -n "desktop-login-core\|features/precision"` 在基线代码中返回 exit 1。
因此 §1 的"组织侧状态"一律按基线 `9e2f82a` 判定；表内对未跟踪文件只做"存在但不生效"的标注。
本文对 `router.tsx`/`page-registry.ts` 不引用行号；如需核对基线版本用 `git show 9e2f82a:<path>`。

---

## 1. 权威矩阵

图例：**权威**=该模式下唯一可裁决的一方；**本地缓存**=是否需要在 Worker 本地留副本；
「组织侧状态」列区分 **未实现**（零代码）/ **仅契约**（`packages/organization-contracts/src/index.ts` 有 Zod 形状但无实现、无 import）。

| 实体 | 个人/本地模式权威 | 组织模式权威（目标） | 本地缓存 | 谁可写 | 冲突规则 | 组织侧状态 |
|---|---|---|---|---|---|---|
| **Account** | 基线中不存在。本机无身份概念；`git grep -niE "login\|oauth\|jwt" -- apps/desktop/src/{main,preload}` 无匹配（exit 1）。审计期间出现未跟踪的 `apps/desktop/src/main/auth/desktop-login-core.ts`，但无任何已跟踪文件引用它 | Server（OIDC/PKCE 登录后签发会话） | 仅缓存 id/name/email 展示字段，**不落 token 到 SQLite** | Server 独占；Worker 只读 | 以 Server 为准；本地缓存按 `accountId` 覆盖 | 仅契约（`organization-contracts/src/index.ts:47-54`） |
| **Organization** | 不存在 | Server | 缓存 `id/name/slug/role` 供 UI 显示 | Server 独占 | 以 Server 为准；`slug` 唯一 | 仅契约（`:56-68`） |
| **Membership**（组织级 + 项目级） | 不存在；`TeamSettingsPanel.tsx:12` 的"唯一成员/Owner"是硬编码文案，且该组件零 import | Server | 缓存"我的角色"，用于禁用按钮（**不得当作授权依据**） | Server 独占 | 组织角色**不自动**变成项目权限：`projectRoleOf` 要求在该项目内有 membership（`:378-387`） | 仅契约（`:70-82`、`:112-120`） |
| **Project** | 本地 `projects` 表，`root_path` 必填（`entities.ts:32`；`migrations.ts:15`），无 UNIQUE（`migrations.ts:11-22`），应用层按路径去重（`store.ts:391`；`project-service.ts:78-79`） | Server（**无 rootPath**，只有 `organizationId/key/repo`） | 需要：本地 `projects` 行继续存在，作为执行上下文 | 本地写本地行；Server 写组织行 | `id` 双轨：`localProjectId` ≠ `serverProjectId`；映射只存在于 `LocalProjectLink`（`:122-133`），**靠映射而非路径猜测** | 仅契约（`:89-110`） |
| **LocalProjectLink** | 不存在（新表） | **Local 权威**（含本机绝对路径，永不上送） | 本身就是本地表 | 仅本机 Worker | 唯一键建议 `(localProjectId)` 与 `(serverProjectId, workerId)`；重复绑定必须报错而非覆盖 | 未实现 |
| **Requirement** | 本地 `requirements`，`project_id` 非空 + FK CASCADE（`entities.ts:53`；`migrations.ts:33-45`） | Server（`Requirement` 属于 `serverProjectId`） | 需要，且离线可写 | 有 `project.write_requirement` 的项目成员（`:324`）；本地模式=本机用户 | 本地 `version` 列做乐观并发（`migrations.ts:41`）；跨机冲突需 Server 侧 `REQUIREMENT_BASE_CHANGED`（`:411`） | 仅契约（`:159-176` 只定义 workspace，未定义 Requirement 本体） |
| **RequirementWorkspace** | 不存在。工作区概念只隐含在 `plan_execution.workspaceRef/branch/baseCommit`（`orchestrator.ts:1031-1038`） | **Local 权威**（`localWorkspaceRef` 只有 owner Worker 能解析，`:170-171`） | 本身就是本地表 | 仅绑定 `workerId` 的 Worker | `REQUIREMENT_WORKSPACE_CONFLICT`（`:410`）；同一 requirement 在多个 Worker 上 = 多个 workspace，不是冲突 | 仅契约（`:159-176`） |
| **Task / Plan / Run** | 本地 `tasks`/`plan_revisions`/`agent_runs`；`plan.approvePlan` 单事务建任务+依赖（`orchestration.ts:725-840`） | 拆分：Plan 内容与状态可共享；**Run 与 Task 执行态归 Worker** | 需要（离线可执行） | 本地 Runtime 写执行态；Server 只写计划级状态 | `task_leases` fencing 单调（`store.ts:916-940`，`:928`）；Run 崩溃 → `needs_reconciliation` 且不自动重试（`agent-runner.ts:3105-3154`；ADR `0005:19`） | 未实现（`WorkerJobEnvelope` 只带 `planId/runId`，`:258-278`） |
| **Approval** | 本地两张表：`approvals`（工具级，绑 `run_id`+`tool_call_id`，`migrations.ts:268-282`）与 `approval_requests`（通用，`UNIQUE(subject_type,subject_id,subject_revision,content_fingerprint)`，`:1100-1117`） | 工具级审批**永远本地**；交付/Gate 级审批 → Server | 需要（离线也要能决定工具审批） | 本地：本机用户；组织：项目成员按权限（`:322-332`） | 已决策审批只读（ADR-0055）；内容指纹变即需重审（`:1114`）；过期不得永久 park（ADR-0057；`orchestrator.ts:1134-1152`） | 未实现 |
| **WorkflowTemplateVersion / Instance** | 不存在。本地有 `gate_definitions`（project 级，`migrations.ts:980-991`）与 `gate_evaluations`（`:1019-1030`） | Server（模板版本不可变；实例冻结 `templateVersionId`） | 缓存"当前实例 + 当前节点"，用于 UI 与本地守卫 | Server 写模板/实例；Worker 只写执行结果 | `WORKFLOW_TEMPLATE_STALE`（`:408`）：模板更新不得改动运行中实例（`:234-235`） | 仅契约（`:178-242`） |
| **AssetVersion / AssetBinding** | 本地 `agents`（`visibility` 列，`migrations.ts:639`）+ `app_settings.agent_scope:<id>`（`read-models.ts:1245-1248`）；无版本化发布概念 | Server（`OrganizationAssetVersion` 不可变 + `checksum`；`AssetBinding` 绑定到项目） | 需要：本地仍需完整 Agent 配置才能离线执行 | Server 写发布版本；本地写草稿 | 发布即不可变（`:143-145`）；绑定是显式动作，**可见性不等于已绑定** | 仅契约（`:135-157`） |
| **Worker** | 不存在。本地只有进程身份：Main 监管 Runtime 子进程（`runtime-supervisor.ts:45`），无 `workerId` 概念 | Server 签发身份与租约 | 需要：本地持有 `workerId` + 公钥指纹 | Server 写状态；Worker 只发心跳 | `WORKER_OFFLINE` / `WORKER_NOT_AUTHORIZED` / `LEASE_EXPIRED`（`:405-407`）；吊销后不得续租 | 仅契约（`:244-255`） |
| **Knowledge** | 本地 `knowledge_entries`（`migrations.ts:313-323`）+ FTS5 虚拟表 `knowledge_fts` 与三个同步触发器（`migrations.ts:460-482`）；`project_id` FK CASCADE | Server（可选发布为组织知识） | 需要（离线可检索） | 本地写；发布是显式动作 | 发布后以 Server 版本为准；本地继续可写本地条目 | 未实现（草稿的 `ASSET_KINDS` 含 `'workflow'` 但无 knowledge，`:22`） |
| **AuditEvent** | **没有统一审计表**。分散为 `project_events`（`migrations.ts:193-203`，`UNIQUE(project_id, seq)`）、`autonomy_events`（`:1413`）、`change_request_events`（`:1089`）、`deployment_events`（`:1253`）、`automation_run_events`（`:626`） | Server（聚合审计，需可解释来源） | 需要（`project_events` 是本地事实源） | 本地各表由各自服务写 | **`seq` 只在 project 内单调**（`:201`）；跨 Worker 聚合必须带 `workerId` 或服务端重编号，否则主键语义崩塌 | 未实现 |

---

## 2. 迁移方案（additive-first，从 version 36 开始）

### 2.0 不可协商的约束（来自现有代码）

1. **不得改写任何既有迁移 SQL。** 启动时对每条已应用迁移重算 sha256，不一致直接抛错拒绝启动：
   `Database migration N checksum mismatch; refusing to mutate an incompatible database`（`migrations.ts:1513-1516`）。
   改一个字符 = 所有已有库无法打开。
2. **新迁移只能追加。** `MIGRATIONS` 数组顺序执行（`migrations.ts:1509-1531`），每条在 `BEGIN IMMEDIATE` 内完成（`:1520`）。
3. **本地模式必须继续可启动。** Runtime 启动即 `applyMigrations` + `ensureBuiltinAgents`（`store.ts:209-212`）。新迁移失败 = 应用完全起不来。

### 2.1 Step 0 — 备份（强制，先于任何写入）

| 动作 | 具体做法 | 依据 |
|---|---|---|
| 停写 | 关闭应用，让 Runtime 正常退出 | Runtime 是唯一写者（ADR `0001:13-14`） |
| WAL 落盘 | 关闭时已有 `PRAGMA wal_checkpoint(TRUNCATE)`（`store.ts:217-220`），因此**正常退出后** `projectos.db` 单文件即完整 | `store.ts:217` |
| 复制 | 复制 `dataDir/projectos.db` 到带时间戳的旁路文件；若进程被强杀（WAL 未 truncate），必须同时复制 `projectos.db-wal` 与 `projectos.db-shm` | 库路径 `apps/runtime/src/config.ts:31`；WAL 模式 `store.ts:205` |
| 记录 | 备份旁路文件旁边写 `manifest.json`：`commit=9e2f82a`、`schemaVersion=36`、`sha256(db)`、时间戳 | 复用既有 checksum 思路（`migrations.ts:1491-1493`） |
| 验证 | 用只读连接打开备份并执行 `SELECT max(version) FROM schema_migrations`，必须返回 `36` | `migrations.ts:1496-1501` |

**无备份不迁移**：迁移脚本自身不做备份（它跑在 `applyMigrations` 里，无法安全复制正在写的库），备份必须是外部步骤。

### 2.2 Step 1 — 纯新增表（version 37，零风险）

只 `CREATE TABLE` / `CREATE INDEX`，不触碰既有表。建议一并加入：

| 新表 | 关键列 | 为什么是本地表而不是服务端表 |
|---|---|---|
| `local_project_links` | `local_project_id`(PK)、`organization_id`、`server_project_id`、`worker_id`、`local_root_path`、`mapping_version`、`created_at` | 含本机绝对路径，**永不上送**（`organization-contracts/src/index.ts:128-129`） |
| `requirement_workspaces` | `requirement_id`、`organization_id`、`project_id`、`worker_id`、`base_commit`、`branch`、`local_workspace_ref`、`status`、`created_at`、`updated_at` | `localWorkspaceRef` 只有 owner Worker 能解析（`:170-171`） |
| `worker_identity` | `worker_id`(PK)、`organization_id`、`public_key_fingerprint`、`status`、`last_heartbeat_at`、`revoked_at` | 本机身份，不含私钥（私钥应进 Main `ConnectionSecretStore`，见 §5 P0-3） |
| `org_sync_outbox` | `id`、`entity_type`、`entity_id`、`operation`、`payload_json`、`idempotency_key`(UNIQUE)、`status`、`attempts`、`next_attempt_at`、`created_at` | 离线队列；复用既有 `outbox` 的形状（`migrations.ts:205-216`）但**不复用该表**（它绑定 `event_id` FK） |
| `org_sync_cursor` | `scope`(PK)、`last_pulled_seq`、`last_pulled_at` | 拉取水位，单行/少量行 |

此步完成后：应用能启动、旧功能不变、新表为空。**此时还没有任何行为变化**，可以先发一版做灰度和备份验证。

### 2.3 Step 2 — 既有表加列（version 38，全部可空或带默认值）

SQLite `ALTER TABLE ADD COLUMN` 的限制必须遵守：新增 `NOT NULL` 列**必须**带非空默认值。

| 表 | 新列 | 约束写法 | 回填 |
|---|---|---|---|
| `projects` | `server_project_id TEXT` | 可空，无默认 | 全部保持 `NULL`（= 纯本地项目），只有用户显式绑定时写入 |
| `projects` | `org_link_state TEXT NOT NULL DEFAULT 'local_only'` | `NOT NULL DEFAULT 'local_only'`，取值 `local_only\|linked\|detached` | 默认值即正确值，无需回填 |
| `requirements` | `server_requirement_id TEXT` | 可空 | 保持 `NULL` |
| `agents` | `asset_version TEXT`、`asset_checksum TEXT` | 可空 | 保持 `NULL`（未发布） |
| `agent_config_versions` | `published_version TEXT` | 可空 | 保持 `NULL` |

**关键决策**：*不要*把 `agents.visibility` 改成 `organization`。它是既有列（`migrations.ts:639`），
被 `read-models.ts:1261` 读取；改语义会让历史 Agent 的解释发生静默变化。组织归属应写在新表/新列，与旧列并存。

### 2.4 Step 3 — LocalProjectLink 建立与映射规则

绑定只在用户显式操作时发生，且必须一次性在一个事务内完成三件事：

```
BEGIN IMMEDIATE
  INSERT INTO local_project_links (...) VALUES (...)
  UPDATE projects SET server_project_id = ?, org_link_state = 'linked'
   WHERE id = ? AND org_link_state = 'local_only'
  INSERT INTO org_sync_outbox (...)   -- 首次上行：project 元数据
COMMIT
```

规则：

1. **一个本地项目最多绑定一个 server project**（`local_project_id` 主键天然保证）。
2. **一个 server project 在同一 Worker 上最多一个本地项目**（对 `(server_project_id, worker_id)` 建 UNIQUE）。
3. 绑定前必须校验：本地 `root_path` 仍存在且可读、`server_project_id` 属于当前组织。
4. 已 `linked` 的项目不得再次绑定；解绑只能置 `detached`（**不删 `local_project_links` 行**，保留审计）。
5. 解绑后本地数据**不回删**，只是停止上行；`server_project_id` 保留以便重连。

### 2.5 Step 4 — 全局/space Agent 可见性映射规则

现状事实：`visibility ∈ {private, project, space, global}`（`v15.ts:99`），DB 默认 `'project'`（`migrations.ts:639`）；
作用域在 `app_settings.agent_scope:<agentId>`（`read-models.ts:1245-1248`）；判定逻辑 `read-models.ts:1256-1266`：
`private` 要求 `ownerProjectId === projectId`；`global`/`space` **无条件 true**；`project` 允许 `ownerProjectId === null`。

映射规则（一次性、可审计、幂等）：

| 旧值 | 旧判定 | 新语义 | 迁移动作 |
|---|---|---|---|
| `private` 且 `ownerProjectId != null` | 仅该 project 可见 | 本地私有资产，**不发布** | 不写 `agents.asset_version`；仅保留 `agent_scope` |
| `private` 且 `ownerProjectId == null` | **永不可见**（`:1263` 返回 false） | 历史脏数据 | 标记 `needs_manual_triage`，不自动发布（A1 需人工确认） |
| `project` 且 `ownerProjectId != null` | 该 project 可见 | 发布候选：可绑定到 `LocalProjectLink.serverProjectId` | 写 `agents.asset_version/asset_checksum` 草稿，等待显式发布 |
| `project` 且 `ownerProjectId == null` | **所有 project 可见**（`:1265`） | 事实上的全局 | 迁移时**必须**提示用户归类（视为 `global` 候选），不得静默当私有 |
| `space` | 所有 project 可见，但**无 space 实体** | 无法映射 | 逐条人工归类为 `project` 或 `global`；A0 不定自动规则 |
| `global` | 所有 project 可见 | 组织级发布 | 发布为 `OrganizationAssetVersion`，但仍需 `AssetBinding` 才在某项目生效 |

迁移必须是**只读分析 + 用户确认后写入**两步：先生成 CSV/JSON 报告（agentId、name、visibility、ownerProjectId、判定后果），
再由用户确认，最后一次性写回。**不允许**在迁移脚本里静默决定 `space` 的归属。

### 2.6 Step 5 — 服务器与客户端版本不一致时的兼容

| 场景 | 允许行为 | 禁止行为 |
|---|---|---|
| Server 新、Desktop 旧 | Server 对未知字段返回 400 + `OrgError.code`；Desktop 只依赖自己声明的 `schemaVersion` | Server 不得对旧客户端返回它无法解析的新字段 |
| Desktop 新、Server 旧 | Desktop 探测 `GET /version` 失败即降级为 `local_only` 模式继续工作 | Desktop 不得在版本未知时写组织数据 |
| 契约变更 | `organization-contracts` 必须带显式 `schemaVersion`；破坏性变更升 major | 用"字段可选"掩盖破坏性变更 |
| 迁移未完成 | `org_link_state='local_only'` 时所有 `org.*` 调用直接返回本地不可用错误 | 不得部分上行 |

### 2.7 Down / 回滚策略

| 层级 | 能否回滚 | 做法 |
|---|---|---|
| 代码 | 能 | 回退到 `9e2f82a`；旧代码不认识新表/新列，但 SQLite 允许存在多余表列 → **应用仍能启动** |
| 迁移 38（加列） | 不需要 | 新列全部可空或带默认，旧代码忽略它们 |
| 迁移 37（新表） | 保留不回滚 | 空表无副作用；删表会丢失后续已同步数据 |
| 数据 | 能 | 用 §2.1 的备份整体替换 `projectos.db`（必须在停机状态） |
| **禁止** | — | 不得写 "down migration" 去 `DROP TABLE` / `ALTER TABLE DROP COLUMN`：SQLite 的 `DROP COLUMN` 有限制，且删除 = 销毁审计证据 |

结论：**回滚靠备份，不靠反向迁移。** 这符合现有 "checksum 拒绝改写" 的设计取向（`migrations.ts:1513-1516`）。

---

## 3. 回滚与失败场景

| 场景 | 检测方式 | 安全行为 | 数据风险 |
|---|---|---|---|
| Server 不可达 | HTTP 连接错误 / 超时；`org_sync_outbox.status='pending'` 增长 | 进入 `offline` 模式：本地读写全部继续；`org.*` 调用返回明确错误码；**不阻塞**本地计划执行 | 无数据丢失；上行延迟。风险在长期离线后的批量冲突 |
| 会话过期 | `401` / `ORG_FORBIDDEN`（`organization-contracts/src/index.ts:402`） | Main 清空内存 token，通知 Renderer 重登；组织写操作暂停，**本地写不受影响**；不得把整个应用锁死 | 无。风险是用户误以为"数据没了" |
| 组织被移除 / 成员被移除 | Server 返回 `ORG_FORBIDDEN` 或组织列表不再包含该 org | 该组织的项目转 `org_link_state='detached'`；本地数据保留可读；停止上行 | 无本地丢失。风险是用户失去对远端数据的访问 |
| 并发编辑冲突 | 本地 `version` 列不匹配（`migrations.ts:41`、`:71`）；Server 侧 `REQUIREMENT_BASE_CHANGED`（`:411`） | 拒绝写入并展示两侧差异；**不自动 merge 字段**；由人决定 | 可能丢失"后写"的那次尝试（因为被拒绝，不是被覆盖） |
| Worker lease 过期 | `LEASE_EXPIRED`（`:407`）；本地 `renewTaskLease` 抛 `任务租约已失效，无法续约`（`store.ts:951`） | 立即停止工具执行；Run 置 `needs_reconciliation`；**不重试未知副作用**（ADR `0005:19`） | 若副作用已发生而未记录，需要人工核对；这正是设计意图 |
| 崩溃后未知副作用 | 启动扫描 `running/waiting_tool`（`agent-runner.ts:3105-3154`） | 转 `needs_reconciliation` + 任务 `blocked`；`reconcileRun` 需人工确认（`agent-runner.ts:2910-2918`） | 任务卡住但不会重复执行 |
| 部分项目导入中断 | 导入批次缺 `org_sync_outbox` 终态 / 本地 `projects` 有行但 `local_project_links` 无行 | 启动自检：`org_link_state='linked'` 但无 link 行 → 降级 `local_only` 并告警；反之以 link 行为准修复状态列 | 可能出现"半绑定"项目；靠幂等键重放补齐，不删数据 |
| 迁移执行中断 | `schema_migrations` 缺少 37 但新表已存在 | 不可能：每条迁移在 `BEGIN IMMEDIATE` 内（`migrations.ts:1520-1530`），失败即 `ROLLBACK` | 无部分迁移。风险是反复失败导致应用无法启动 |
| 数据库 checksum 不匹配 | `migrations.ts:1514-1516` 抛错 | **拒绝启动**（现有行为），要求人工恢复备份 | 应用不可用，但数据未被破坏 |

---

## 4. 租户隔离检查清单

> 现状：**零实现**。以下为 A1 必须逐项给出实现与证据的清单，不是现状描述。

**身份与授权**
- [ ] 每个 `org.*` / `project.*` 服务端入口都从**会话**取 `accountId`，绝不从请求体取（防 IDOR 的第一原则）。
- [ ] 每次访问都做"资源属于该 org"校验：先按 `organizationId` 过滤，再按 `projectId` 过滤，**不依赖调用方传入的 orgId**。
- [ ] 组织角色 → 组织权限用 `canOrg`（`organization-contracts/src/index.ts:366-368`）；项目角色 → 项目权限用 `canProject`（`:370-372`）。
- [ ] **组织 owner 不等于项目权限**：`projectRoleOf` 必须查该项目 membership（`:374-387`），无 membership 即 `PROJECT_FORBIDDEN`（`:389-398`）。

**查询作用域**
- [ ] 所有列表/聚合查询在 SQL 层带 `organization_id = ?`，而不是取回后在内存过滤。
- [ ] 所有按 id 取单条的接口，WHERE 同时包含 `id` 与 `organization_id`（否则枚举 id 即可越权）。
- [ ] 禁止"先 `findById` 再判 org"的写法出现在错误处理分支里。

**下载与流**
- [ ] 文件/产物下载使用一次性签名 URL，签名内含 `organizationId` + 过期时间；不得用可猜测的路径。
- [ ] WebSocket / SSE 握手时校验会话，并在订阅时校验 `organizationId`；断开后不得继续推送。
- [ ] `LocalProjectLink.localRootPath` 这类本机字段**永不出现在任何响应体**中（`:128-129`）。

**数据库层**
- [ ] RLS（若使用 Postgres）**只作为纵深防御**，不作为唯一隔离手段；应用层必须独立正确。
- [ ] 若使用 SQLite 多租户，则每个查询都必须显式 `organization_id` 条件，且要有测试证明缺少该条件会失败。
- [ ] 迁移脚本不得跨 org 复制数据。

**可验证性**
- [ ] 至少一组"跨 org 越权"负向测试：用 A org 的会话访问 B org 的 project/requirement/run，必须全部 403/404。
- [ ] 审计：越权尝试必须落 `AuditEvent`（含 `correlationId`，`:420`）。

---

## 5. 未决风险（P0 / P1 / P2）

| 级别 | 风险 | 证据 | 建议 owner |
|---|---|---|---|
| **P0-1** | **双写者权威未定义**：本地 SQLite 是唯一写者（ADR `0001:13-14`），引入 server 后同一业务事实有两个写者，冲突规则不存在 | `apps/desktop/src/main/runtime-supervisor.ts:89`；`store.ts:205-238`；全库无 org 表 | 架构（A1 第一份 ADR 必须回答） |
| **P0-2** | **无认证即无隔离**：基线中 Main/Preload 零认证代码，任何本机进程都可调用 `projectos:request` 的 227 个方法。审计期间出现的 `main/auth/desktop-login-core.ts` **未接线**（无已跟踪文件 import、`ipc.ts`/`preload` 未修改），因此隔离状态未改变 | `git grep -niE "login\|oauth\|jwt" -- apps/desktop/src/{main,preload}` → exit 1（基线）；`git grep -n "desktop-login-core" -- ':!node_modules'` → exit 1（已跟踪树）；`apps/desktop/src/main/ipc.ts:685` | 安全 + Desktop |
| **P0-3** | **token 存放介质未定**：`ConnectionSecretStore` 是为 API key 设计的；OAuth token 需要过期/刷新/吊销语义，直接复用有泄漏与陈旧风险 | `apps/desktop/src/main/connection-secrets.ts`（存在，未在本轮验证其接口） | 安全 + Desktop |
| **P0-4** | **`space` 可见性是悬空枚举**：枚举存在但无实体，且判定上等价于 `global`；静默归并会让 Agent 意外跨项目可见 | `packages/contracts/src/v15.ts:99`；`read-models.ts:1264`；全库无 space 表 | 产品 + 架构（必须先给归类规则，再迁移） |
| **P1-1** | **事件序号跨机会碰撞**：`UNIQUE(project_id, seq)` 在单机成立，多 Worker 聚合时主键语义崩塌 | `migrations.ts:201` | Runtime + Server |
| **P1-2** | **`AgentDefinition.visibility` 与 `app_settings.agent_scope` 双源**：作用域不在 agents 表而在 app_settings 字符串键，跨机不可解释 | `read-models.ts:1245-1248`；`agent-studio.ts:112-114` | Persistence（迁移 Step 4） |
| **P1-3** | **分支命名不含组织/需求维度**：`projectos/plan-<planId>` 与 `projectos/runtime-<runId>` 两套并存，`RequirementWorkspace.branch` 无规则可依 | `orchestrator.ts:1001`；`runtime-run.ts:118` | Worktree + 架构 |
| **P1-4** | **边界检查不覆盖新包**：`check-boundaries.mjs` 硬编码 21 个包，`organization-contracts` / `apps/server` 均不在其中，renderer 隔离不变式对新代码失效 | `scripts/check-boundaries.mjs:6-28`、`:90-109` | 平台（A1 第一件工程任务） |
| **P1-5** | **组织域草稿引用不存在的 ADR**：`organization-contracts/src/index.ts:8` 指向 `docs/org-upgrade/ADR-ORG-0001-architecture.md`，该 ADR 至今仍不存在（该目录因本次审计产出两份文档才被创建） | `organization-contracts/src/index.ts:8`；审计开始时 `Test-Path docs/org-upgrade` → `False` | 架构（补 ADR，或改引用） |
| **P2-1** | **`TeamSettingsPanel` 是死代码**，其"本地单用户/Owner"文案仍在仓库内，容易被误当作现状权威面 | `TeamSettingsPanel.tsx:12`、`:17`；零 import；`stores/ui.ts:6-19` 无 `team` section | 前端（删除或正式挂载，二选一） |
| **P2-2** | **服务端脚手架缺少持久化与隔离**：审计开始只有 `package.json`；结束时出现未跟踪的 `apps/server/src/{index,app,desktop-auth,store}.ts`，但启动日志自述 "A0 PoC; in-memory data only" | `apps/server/package.json`；`apps/server/src/index.ts:24-25`（loopback 监听 + in-memory 自述）；审计开始时 `Get-ChildItem apps/server -Recurse -File` 仅 `package.json` 与 `node_modules/.bin/*` | 平台 + Server（A1 必须替换为真实持久化） |
| **P2-3** | **审计表分裂**：`project_events` / `autonomy_events` / `change_request_events` / `deployment_events` / `automation_run_events` 五处并存，无统一 `AuditEvent` | `migrations.ts:193`、`:1413`、`:1089`、`:1253`、`:626` | Persistence（组织审计需要先聚合） |
| **P2-4** | **Organization 草稿缺 Requirement 本体**：只定义了 `RequirementWorkspaceBinding`，没有服务端 `Requirement` 形状，A1 需补齐 | `organization-contracts/src/index.ts:159-176` | 架构 |

---

## 6. 未验证清单（本文件范围内）

| 项 | 原因 |
|---|---|
| 备份/恢复流程的实际可用性 | 未真的执行备份与恢复（只读审计） |
| SQLite `ALTER TABLE ADD COLUMN` 在 version 36 真实库上的执行结果 | 未构造迁移演练库 |
| `ConnectionSecretStore` 能否承载 OAuth token | 未读其接口实现（`apps/desktop/src/main/connection-secrets.ts` 存在性已确认，能力未验证） |
| `better-auth` / `fastify` 版本是否可安装 | `apps/server/node_modules` 只有 `.bin`，未运行 `pnpm install` |
| 未跟踪的服务端/登录/UI 文件是否可用 | 审计期间出现的 `apps/server/src/*`、`main/auth/desktop-login-core.ts`、`features/precision/*`、`tests/org-*.test.ts` 全部未提交，未运行任何构建或测试 |
| Postgres RLS 方案（若选 Postgres） | 无任何数据库选型代码；审计开始时 `apps/server` 无 `src/`；结束时只有内存 PoC（`apps/server/src/index.ts:25` 自述 "in-memory data only"） |
| 服务端 `schemaVersion` 协商 | 无实现 |
| 跨 Worker 事件聚合的具体编码 | 属 A1 设计，本文件只指出问题 |
