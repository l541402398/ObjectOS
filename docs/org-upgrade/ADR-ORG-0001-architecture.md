# ADR-ORG-0001：组织协作架构基线（A0）

- 状态：Proposed，作为 A0 评审与 A1 入口的架构基线
- 日期：2026-10-29
- 基线：`v2.0-phase2.9` / `9e2f82ab0564cea7dabfdbaf0a620c191d7afc49`
- 决策范围：A0 只固化边界与契约，不实现正式组织 CRUD、不部署共享服务、不宣称多租户已上线
- 关联文档：`A0-capability-audit.md`、`A0-data-authority-and-migration.md`、`design/PRECISION_DESIGN_SYSTEM.md`、`reports/A0-report.md`

## 1. 背景（已在代码中核实）

1. 当前产品是本地优先单用户工作台：`Project.rootPath` 是必填本地绝对路径（`packages/contracts/src/entities.ts:32`），
   SQLite 由 Node Runtime 单写者持有，Renderer 只走具名 preload IPC。
2. 数据库 schema 在 **version 36**（`packages/persistence/src/migrations.ts:1488`），迁移校验和不匹配即拒绝启动；
   不存在 users / organizations / memberships / tenants 表（`git grep` 无匹配，见审计文档）。
3. 已有 Planner、Scheduler、AgentRunner、ReviewEvidence、GateEvaluation、Approval、Worktree、Runtime supervisor 的
   真实实现与测试，是本轮唯一允许复用的执行内核。
4. `AgentDefinition.visibility` 的 `global/space` 在读取时被无条件放行（`packages/persistence/src/read-models.ts:1264`），
   它不是租户边界，也不能直接当作新组织授权。
5. `TeamSettingsPanel.tsx` 自称“本地单用户工作区”，但全仓零 import、设置分区也无 `team`，是死代码，不能作为现状权威面。

完整证据见 `A0-capability-audit.md`。

## 2. 决策

### D1 控制面与执行面分离（中心服务器 + Local Worker）

- **组织服务器**（`apps/server`，Fastify + better-auth，生产目标 PostgreSQL）是组织、成员、项目、需求、流程模板、
  组织资产等**共享实体的唯一权威写入源**。
- **Local Worker** 复用现有 Node Runtime / SQLite / Git / AgentRunner，负责本机文件、命令与 Worktree。
- 服务器只保存仓库 URI、项目元数据与授权，不保存某台机器的绝对路径；本机路径只存在于 `LocalProjectLink`。
- 禁止本地与服务器各自修改同一组织实体后“最后写入胜出”。任何跨端冲突都必须显式呈现。

### D2 身份与权限分层，UI 不是授权

- 关系：`Account ↔ OrganizationMembership ↔ Organization → Project ↔ ProjectMembership → Requirement`。
- 组织角色（owner/admin/member）只覆盖组织级能力；项目角色（owner/maintainer/contributor/reviewer/viewer）只在
  该项目内生效；**组织管理员不会自动获得项目权限，也不会自动获得本机 Shell/文件权限**。
- 后端对每次请求强制组织/项目作用域校验；ID 猜测、URL 改写、WebSocket、下载路径都必须隔离。
- 高风险操作（批准计划/文档、合并、部署、工具执行）由细粒度 Permission + ApprovalPolicy 决定，角色名称不是授权。

### D3 共享资产版本化与冻结

- Agent / Skill / MCP / Tool / WorkflowTemplate / ModelConnectionPolicy 属于组织，以不可变版本发布。
- 项目绑定**明确版本**；Run 启动时冻结版本、checksum、工具权限、模型/Runtime 绑定。运行中更新不影响已开始的 Run。
- 组织共享的是定义与受权配置，不是明文 API Key / SSH 私钥；密钥仍由受控存储按最小权限下发。

### D4 需求是独立执行单元

- Requirement 仍属于 Project，但拥有独立文档、流程实例、Plan lineage、Worktree 与 feature 分支。
- 每条需求基于明确 `baseCommit` 建 Worktree；不复制整套源码；合并按串行门禁记录真实目标 HEAD。
- 项目级 Journey 只做聚合，不允许把“项目最新计划”当作全项目唯一目标。

### D5 可配置流程不得绕过组织强制门禁

- WorkflowTemplateVersion 冻结步骤、条件、角色、审批策略、超时与重试；实例创建时固定模板版本。
- 组织强制门禁是下限，模板只能增加不能删除；条件使用受限规则，禁止 eval 任意脚本。
- “任务完成” ≠ “文档审核通过” ≠ “交付完成”；门禁只接受与当前内容快照绑定的真实证据。

### D6 桌面登录：系统浏览器 + loopback + PKCE

- Renderer 永不持有登录秘密；Main 在 `127.0.0.1:0` 启动一次性回调监听，用系统浏览器完成授权。
- 必须校验 state、PKCE S256、redirect_uri 精确匹配、回调 Host/端口、单次 code（120s）与超时（默认 5 分钟）。
- 令牌只进 Main 的安全存储，Renderer 只拿到脱敏账号/组织摘要。
- 相关契约：`packages/organization-contracts/src/index.ts` 的 `DesktopAuthorizeQuerySchema` / `DesktopTokenRequestSchema` /
  `DesktopSessionSchema`；PoC 实现与测试见 `apps/server/src/desktop-auth.ts`、`tests/org-desktop-login.test.ts`。

### D7 离线与失败语义

- 个人模式继续完全本地可用，不依赖服务器；组织模式离线时只读缓存可用，需要权威写入的操作必须停止并说明。
- Worker 动作要求租约 + fencing + 幂等键；未知外部副作用**不盲目重试**，标记 `EXECUTION_RECONCILIATION_REQUIRED` 交人处理。
- 组会切换、会话失效、权限变更后：立即拒绝新的写入，安全停泊正在执行的租约。

### D8 UI 方向：Precision Workspace 作为 A0 候选

- A0 新增独立原型路由 `#/precision-lab`（page-registry 状态 `DEV_ONLY`），与生产入口隔离，全部数据标注 `DESIGN PROTOTYPE`。
- 生产 shell 在本轮**不切换主题**：现有 Premium Liquid Glass 仍是生产视觉基线，直到用户明确批准 Precision 方向。
- 新设计系统采用中性纸面、低饱和靛青、1px 发丝线、12px 内容字号下限、真实 React Flow + ELK DAG；
  细节见 `design/PRECISION_DESIGN_SYSTEM.md`。
- 不允许用静态 HTML 原型冒充业务功能；A0 原型的交互必须真实改变自身状态，并明确“不写入后端/不启动 Agent”。

## 3. 数据权威（摘要）

| 实体 | 组织模式权威 | 本地是否缓存 | 备注 |
|---|---|---|---|
| Account / Organization / Membership | 服务器 | 摘要缓存 | 组织切换需重新校验 |
| Project / ProjectMembership | 服务器 | 元数据缓存 | 不含本机路径 |
| LocalProjectLink | **本机** | 本机 SQLite | 显式建立，不上传 rootPath |
| Requirement / 文档 / 流程实例 | 服务器 | 只读缓存 | 需求目录/Worktree 在本机 |
| Task / Plan / Run / ToolCall | 本机 Runtime | 本机 SQLite | 事件与证据上传服务器 |
| Approval / GateEvaluation | 服务器（决策）+ 本机（执行事实） | 双向引用 | 以证据 hash 绑定 |
| WorkflowTemplateVersion | 服务器 | 版本摘要缓存 | 实例冻结版本 |
| AssetVersion / Binding | 服务器 | 版本摘要缓存 | 不含明文密钥 |
| Worker / Lease | 服务器（注册/租约）+ 本机（执行） | 本机状态 | 服务端授权不等于本机执行权 |

完整矩阵与冲突规则见 `A0-data-authority-and-migration.md`。

## 4. 迁移与回滚

1. additive-first：从 schema **36** 起只追加 37+，不改写既有迁移 SQL；启动校验和机制保留。
2. 迁移前备份 SQLite 与工作区清单；不打包用户私密文件、不上传仓库。
3. 旧项目、Agent、Run、Plan、Review、Knowledge 原 ID 与证据全部保留，个人模式继续可访问。
4. 组织模式首次登录只提供三选一：关联到组织项目 / 创建组织副本 / 保持本地；不静默迁移。
5. Agent `global/space` 不自动等同于“组织公开”；逐项人工归类，默认私有或显式发布。
6. 回滚：新表/新列可停机回滚；服务器权威数据不回灌旧 SQLite；关闭组织模式后本地旧数据仍可用。
7. 服务器与客户端 schema 版本不匹配时友好阻断，不破坏本地库。

## 5. 被拒绝的方案

- 把服务器逻辑塞进 Electron Main：无法支持多用户与独立部署，安全边界混乱。
- 多端共享一个 SQLite：跨机器写冲突不可控，违反单写者不变量。
- 为组织模式另建第二套 Planner/AgentRunner/Worktree：与现有能力重复且会绕过审批与证据。
- 每条需求复制整套仓库：磁盘与合并成本不可接受。
- 允许模板删除组织强制门禁：商业化交付不可审计。
- Renderer 持有会话令牌或直连服务器数据库：违反现有 CSP/进程边界。

## 6. 风险与未决问题

| 级别 | 风险 | 当前处理 |
|---|---|---|
| P0 | PostgreSQL/Drizzle 迁移尚未落地，A0 PoC 仅为内存适配器 | A1 第一项工程任务；PoC README 已列明 |
| P0 | 中心服务器未部署，组织模式不可对外宣称可用 | A0 明确不宣称；仅本地隔离 PoC |
| P1 | `check-boundaries.mjs` 原先不检查新包/新 app | 本轮已加入 `organization-contracts` 与 `apps/server` |
| P1 | Agent visibility 语义与组织发布混淆 | 迁移逐项人工确认，默认私有 |
| P1 | 组织权限变更对已运行租约的影响 | 定义为“拒绝新写入 + 安全停泊”，A2 实现 |
| P2 | `apps/server` 构建产物 externalize TS-source workspace 包 | 打包前需改为构建包；已在 server README 记录 |

## 7. 证据

- 能力审计：`docs/org-upgrade/A0-capability-audit.md`（36 条迁移、91 张表、rootPath、visibility、IPC 单通道等）
- 数据权威与迁移：`docs/org-upgrade/A0-data-authority-and-migration.md`
- 服务端 PoC：`apps/server/README.md`；`tests/org-server-poc.test.ts`（8 项）、`tests/org-desktop-login.test.ts`（6 项）真实通过
- UI 母版：`apps/desktop/src/renderer/src/features/precision/`；真实 Electron 截图与 44 项检查：
  `docs/org-upgrade/evidence/A0/`

## 8. 结论与 A1 入口条件

A0 允许开始 A1 的条件（需用户批准）：接受本 ADR 的边界与 UI 方向；A1 先修 P0（PostgreSQL 迁移、服务端部署方案），
再实现账号/组织/成员/项目，不提前实现 A2–A5。若 UI 方向被否决，A1 仍可按 D1–D7 推进，仅重做 D8 的视觉层。
