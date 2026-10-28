# ProjectOS V2.0 Phase 2.5 — 新会话启动简报（上下文压缩版）

**用途**：替代 698k tokens 的旧会话，作为 Phase 2.5 的唯一启动上下文。
**生成时间**：2026-10-27 18:50（America/Los_Angeles）
**原始需求全文**：见本文 [附录 A](#附录-a原始需求全文2026-10-27-1832-提交)，任何压缩解读与附录 A 冲突时以附录 A 为准。

---

## 0. 怎么用这份文件

1. 新会话**只**接收一句启动指令（见[第 10 节](#10-第一条消息可直接复制)），不要粘贴旧会话记录。
2. 需要什么再让 agent 读什么（[第 6 节](#6-必读清单按需禁止一次性全读)），**不要**一次性把 docs/ 全读完。
3. 每完成一个 P0 就落一份小结到 `docs/v2/`，会话里只保留"指针 + 结论"，这是控制上下文的核心手段。

---

## 1. 为什么要换会话（实测数据，不要重新排查）

| 事实 | 数值 | 来源 |
|---|---|---|
| 旧会话上下文规模 | `inputTokens=698,354`，会话文件 12.6 MB / 20,754 事件 / 2,819 条 assistant 消息 | 旧会话日志 usage |
| 切到 `commandcode/deepseek/deepseek-v4.1-flash-fast`（effort=max）后单步首 token | 289 s、275 s、再一步仍在等 | 同一日志 |
| 切之前 `deepseek-account/deepseek-flash` 单步 | 3~8 s（`cacheReadTokens≈716k` 命中官方提示词缓存） | 同一日志 |
| 直连网关实测：71,497 tokens 冷启动 / 同前缀复测 | 首字节 17.5 s（≈4.1k tok/s prefill）/ 2.2 s（真命中缓存） | 独立探针 |
| 直连网关实测：42 tokens 小请求 | 3.0 s | 独立探针 |

**结论**：不是卡死、不是限流，是"每步重算 70 万 tokens 的 prompt"。所以本轮工程必须在 **<100k tokens** 的会话里做。另外旧会话第一次请求还撞过 `IMAGE_OFFLOAD_REQUIRED`（2 MB base64 图片预算，31 张截图被 offload 后静默重试），**不要在长会话里 `read_image` 大截图**。

---

## 2. 工作区、分支、恢复点（已核实）

| 项目 | 值 |
|---|---|
| 工作目录 | `C:\Users\Administrator\Desktop\workplace\ProjectOS-v2-phase2.4` |
| 当前分支 / HEAD | `v2.0-phase2.4` / `491860e`（= Phase 2.4 报告提交） |
| 未提交改动 | `apps/desktop/src/main/ipc.ts`（+5/−1）：在 `deployment.execute` 的 SSH 分支加了 3 条 `logger.info`（prepared / ssh result / finish done） |
| 该改动能否编译 | 能。`logger` 已在 `IpcContext`（同文件 L35、L66）注入，无需补 import |
| 其他 worktree | `ProjectOS-v2-phase0 … phase2.3-res`、`ProjectOS-v2-phase2.4` 等同级目录，**禁止** reset / clean / 删除分支 / 覆盖其他 Worktree |

**开工第一步（照做）**：

```powershell
cd C:\Users\Administrator\Desktop\workplace\ProjectOS-v2-phase2.4
git add apps/desktop/src/main/ipc.ts
git commit -m "chore(phase2.5): add deployment.execute diagnostics"
git switch -c v2.0-phase2.5
git tag phase2.5-base   # 安全恢复点
```

---

## 3. 已核实的现状基线（Phase 2.4 结论，勿重做）

来源：`docs/v2/ProjectOS_V2.0_Phase2_4_Resource_Driven_Delivery_Final_Report.md`

| 能力 | 状态 | 备注 |
|---|---|---|
| Schema V32 additive（resources.revision、connection_profiles.revision、approval_requests.subject_snapshot_json、deployments.execution_state、deployments.authorization_fingerprint） | PASS | V27–V31 未修改 |
| 部署授权绑定目标快照 + 执行前指纹重算 + 负向单测 | PASS | 地址/端口/账号/路径/Host Key/revision/制品变化即失效 |
| 受控 SSH 执行路径（ssh2 + safeStorage + host key pin + SFTP + sha256sum + docker + /health） | 代码 PASS | 私钥不进 Renderer / Runtime / SQLite / 日志 |
| Local Adapter（制品 SHA-256 → versions/<deploymentId> → receipt/health） | PASS | 不执行任意 Shell |
| **Electron 发起的 SSH 部署闭环** | **FAIL** | 远端 release 目录与容器确实被重建，但 DB/UI 仍 `pending`，无 external_id / receipt。根因候选未定位：Main `deployment.finish` 响应未回 Renderer / 超时、Renderer 查询缓存未刷新 |
| v1 → v2 → v1 真实更新与回滚 | **FAIL/BLOCKED** | 无两个可验证远端版本；回滚 API 已支持"上一个不同 Release 的成功部署" |
| 审批 Diff 后端基线哈希 / TOCTOU 拒绝 | **FAIL（PARTIAL）** | Diff 仍是 Renderer 读当前工作区生成，不是可信授权快照 |
| Resource/Profile 编辑、凭据轮换、归档与引用约束 | PARTIAL | 创建/停用/重启恢复已有 |
| K8s / CI-CD | BLOCKED | 无只读 Context/Token，**不得伪造连接成功** |

已验证命令基线（Phase 2.4 实测）：`lint` PASS、`typecheck` PASS、`test` 287 passed / 4 skipped、`build` PASS、`package:dir` PASS、`test:package` PASS、V24→V32 迁移 PASS。

---

## 4. 本轮范围与验收口径

以附录 A 为准，这里只列出"怎么算过"，避免转述失真。

### P0-1 SSH 部署执行状态一致性
- **必须**先定位真实根因（Main `deployment.execute` → `ssh-deploy` → `deployment.finish` → Runtime → SQLite → Renderer 刷新哪一段断），给出证据（日志/断点/时序），**不得**直接写 DB、mock 回执或靠刷新页面掩盖。
- 通过标准：真实 Electron 里 `资源选择 → 授权审批 → 执行 → 远程 /health → succeeded → external_id/receipt 落库 → 重启 Electron 后仍正确`，且 UI 展示与 DB、远端事实三者一致。
- 远端副作用前必须持久化意图 + 稳定操作 ID；远端成功本地未确认 → `needs_reconciliation`，先查远程事实，禁止盲目重试。

### P0-2 真实更新与回滚
- v1 首部署 + `/version` 或等价 HTTP 校验；v2 更新 + 制品哈希校验；回滚独立审批；v2 → v1 实际回滚 + HTTP 校验；历史/回执/健康证据关联。
- 回滚必须是**新 Deployment**，不覆盖旧记录。超出已批准目标/目录/容器/端口范围先问用户。

### P0-3 审批 Diff 一致性
- 审批创建时记录：目标文件基线哈希、目标内容哈希、审批快照；批准前与写入前各重算一次；内容或授权范围变化 → 拒绝旧审批。
- 负向测试必须真实跑：预览后文件变化、审批后文件变化、多文件变更。
- 不得仅依赖前端 Diff 判断合法性。

### P1-1 资源与连接完善（保留 V31/V32、safeStorage Vault、host key 校验）
Resource/Profile 编辑；资源禁用/归档 + 引用检查；凭据轮换/停用 + 连接测试历史；凭据或连接变更后部署授权失效；资源详情/连接状态/错误诊断；部署目标直接引用已登记 Resource/Profile。

### P1-2 UI/UX 深化（禁止只动颜色圆角）
审批工作台（可读 Diff、文件切换、全屏、路径/规模/风险/授权范围、可信快照标识）；部署控制台（真实时间线、增量日志、健康检查、失败原因、pending/running/unknown/succeeded 区分、对账与回滚入口）；资源与连接（高密度资产目录 + Inspector、渐进式部署目标创建、浅色主题下控件一致性）；发布工作台（列表/详情/Inspector 空间分配、面板可收起可调整）。
允许引入开源组件（Monaco Diff、react-resizable-panels 等），但**必须**核许可证、真集成、并给出源码落点；保留 Premium Liquid Glass 与现有真实功能。

### P1-3 K8s / CI-CD
只做可独立验证的只读连接、资源发现、Adapter 契约；缺 Context/Token 就向用户要，判定 BLOCKED，不阻塞其他工作；不得碰生产集群。

---

## 5. 代码地图（已核实存在，按需打开）

| 关注点 | 文件 |
|---|---|
| `deployment.execute` 主流程（本次核心） | `apps/desktop/src/main/ipc.ts`（约 L500–L535） |
| SSH 执行实现 | `apps/desktop/src/main/ssh-deploy.ts` |
| Runtime 侧 prepare/finish | `apps/runtime/src/dispatcher.ts`（约 L880–L905） |
| 凭据/连接/资源 | `apps/desktop/src/main/connection-secrets.ts`、`resource-credentials.ts`、`resource-connection.ts` |
| 部署控制台 UI | `apps/desktop/src/renderer/src/pages/DeploymentCenterPage.tsx`、`components/DeploymentConsole.tsx` |
| 审批 UI | `apps/desktop/src/renderer/src/pages/ApprovalsPage.tsx`、`features/design-lab/ApprovalDialog.tsx` |
| 资源 UI | `pages/ResourcesPage.tsx`、`pages/ResourceCenter.tsx`、`pages/DeliveryResourcesPage.tsx` |
| 发布工作台 | `pages/ReleaseCenterPage.tsx`、`components/ReleaseWorkbench.tsx`、`ReleasePanel.tsx` |

---

## 6. 必读清单（按需，禁止一次性全读）

**必读（开工前，约 20k tokens）**
1. `AGENTS.md`（工作区规则，已自动注入）
2. `docs/v2/ProjectOS_V2.0_Phase2_4_Resource_Driven_Delivery_Final_Report.md`（现状与 FAIL 项）
3. `docs/adr/0001-runtime-single-writer.md`、`0009-external-runtime-audit-boundary.md`（单写者与远程副作用边界）
4. 本文第 2、3、4 节

**按需（动到哪块读哪块）**
- `docs/architecture.md`、`docs/adr/0003-typed-preload-zod.md`、`0005-lease-and-recovery.md`
- `docs/design-system.md` + `packages/design-tokens`（UI 任务）
- `docs/v2/04_ProjectOS_V2.0_架构决策与一致性核对.md`（决策与不变量）
- Phase 2.3 报告（资源/连接既有实现）

**禁止**：一次性 `read` 完 `docs/v2/01…03`（约 240 KB）；`read_image` 大截图进对话。

---

## 7. 验收命令与产出物

```powershell
pnpm lint          # eslint + node scripts/check-boundaries.mjs（边界检查）
pnpm typecheck
pnpm test          # vitest
pnpm build
node scripts/e2e.mjs            # 桌面创建 + 重启恢复
node scripts/phase2-ui-e2e.mjs  # Phase 2 交付 UI 链路
node scripts/resources-ui-e2e.mjs
node scripts/scale125-e2e.mjs   # 125% 缩放
node scripts/v15-dpi-check.mjs
pnpm package:dir && pnpm test:package   # 打包 EXE 冒烟
```

UI 证据：`scripts/screenshots.mjs`、`scripts/phase2-delivery-screenshots.mjs`（1440 / 1024 / Light / Dark / 125%），截图**落盘留路径**，不要把图读回会话。

**最终产出**：`docs/v2/ProjectOS_V2.0_Phase2_5_Final_Acceptance.md`，必须含最终 Git HEAD、真实根因、远程部署/回滚证据、DB 状态与回执、UI 截图路径、开源组件与源码落点、未完成项；测试结果按 **PASS / FAIL / SKIP / BLOCKED** 分类。

**第一验收标准**：Electron 中发起的真实部署，其远程执行结果、数据库状态、运行证据、UI 展示四者一致。

---

## 8. 上下文纪律（决定本轮快慢，务必遵守）

1. 单会话目标 **<100k tokens**；触及 200k 就开新会话，并把结论写进 `docs/v2/` 后带指针过去。
2. 大日志/大 diff 用 `Select-Object -Last N`、`rg -n` 精确取，不要整文件读进对话。
3. 截图只落盘 + 报路径；需要看就用极小尺寸或文字描述。
4. 每个 P0 完成即写 1 页小结（`docs/v2/phase2.5/` 下可拆多份），报告最后汇总。
5. 每步先声明要读/要改的文件，再动手；改完立刻跑 `pnpm typecheck` 收敛。

---

## 9. 远程与安全边界

- 允许的隔离测试目标：Contabo `169.58.112.111:22`，目录 `/opt/projectos-delivery-test`，容器 `projectos-delivery-test`，端口 `18080`；不记录私钥、不写入明文凭据。
- 越界（其他目录/容器/端口/服务）必须先问用户。禁止 reset / clean / 删分支 / 覆盖其他 Worktree。
- 不得让 Renderer 或 AI Agent 拿到明文凭据；不得直改 SQLite 绕过流程；未知副作用的崩溃恢复走 `needs_reconciliation`。
- 无法取得 K8s/CI 只读凭据时判 BLOCKED，不得伪造连接成功。

---

## 10. 第一条消息（可直接复制）

```text
按 docs/v2/ProjectOS_V2.0_Phase2_5_Kickoff_Brief.md 执行 Phase 2.5。

先做三件事，然后直接开工，不要输出规划文档：
1. 读该简报第 2/3/4 节与附录 A，按第 2 节建立恢复点并切到 v2.0-phase2.5。
2. 读 Phase 2.4 报告，确认 SSH 部署闭环 FAIL 的现状。
3. 从 P0-1 开始：先定位 deployment.execute → ssh-deploy → deployment.finish → SQLite → Renderer 刷新断在哪，用日志/时序证据说明，再改代码。

约束：单会话上下文 <100k tokens；日志和大 diff 只取需要的片段；截图只落盘报路径；
每完成一个 P0 就写小结到 docs/v2/；测试结果按 PASS/FAIL/SKIP/BLOCKED 分类；
不碰已批准范围以外的远程目标；完成 Phase 2.5 后停止，不进入 Phase 3。
```

---

## 附录 A：原始需求全文（2026-10-27 18:32 提交）

ProjectOS V2.0 Phase 2.5 — 部署闭环修复与 UX 深化

你现在担任 ProjectOS 全栈架构师、DevOps 工程师及 UI/UX 负责人。

基于当前 v2.0-phase2.4 最新代码，立即进行实际开发。本轮不重新设计总体架构、不重复 Phase 0 审计、不提前进入 Phase 3。

以现有 V2.0 架构文档、Phase 2.4 验收报告及最新源码为依据。

一、P0：修复 SSH 部署执行状态不一致

当前问题：Electron 发起部署后，Contabo VPS 已创建 Release 目录并重建容器，但 SQLite 中 Deployment 仍为 pending，缺少外部执行 ID 和回执。

必须定位真实根因，不得通过直接修改数据库、模拟回执或简单刷新页面掩盖问题。

重点检查：

1. Renderer → Electron Main → SSH Adapter → deployment.finish → Runtime → SQLite 的完整调用链。
2. Main/Runtime IPC 超时、异常传播、状态转换及事务提交。
3. 部署执行 ID、幂等键、外部回执与日志关联。
4. Renderer 查询缓存、事件订阅与状态刷新。
5. Electron 关闭、Runtime 重启及 SSH 断线后的恢复。

要求远程副作用执行前持久化操作意图和稳定操作 ID，执行中持续记录状态。远端操作成功但本地未确认时进入 needs_reconciliation，先查询远程事实，禁止盲目重复执行。

完成真实 Electron SSH E2E：

资源选择 → 授权审批 → 执行 → 远程健康检查 → Deployment succeeded → 外部 ID / Evidence 持久化 → 重启 Electron 后正确恢复。

二、P0：真实更新与回滚

在用户已批准的 Contabo 隔离测试范围内，完成：

* v1 初次部署与 HTTP 版本验证。
* v2 更新部署与制品哈希验证。
* 独立回滚审批。
* v2 → v1 实际回滚与 HTTP 验证。
* 部署历史、外部回执、健康证据和回滚关联。

回滚必须是新的 Deployment，不得覆盖旧记录。

如本轮测试超出现有授权的目标、目录、容器、端口或操作范围，先向用户确认；不得修改其他业务服务。

三、P0：审批 Diff 一致性

当前 Diff 由 Renderer 读取工作区文件生成，缺少可信的文件基线校验。

必须实现：

1. 审批创建时记录目标文件基线哈希、目标内容哈希及审批快照。
2. 批准和实际写入前重新校验。
3. 文件内容或授权范围变化时拒绝使用旧审批。
4. Diff 超长截断明确提示，支持完整内容查看。
5. 验证预览后文件变化、审批后文件变化、多文件变更的负向测试。

不得仅依赖前端 Diff 判断操作合法性。

四、P1：完善资源与连接管理

保留 V31/V32、safeStorage Credential Vault、SSH 主机指纹验证。

补齐：

* Resource / ConnectionProfile 编辑。
* 资源禁用、归档及引用关系检查。
* 凭据轮换、停用和连接测试历史。
* 凭据及连接配置变更后的部署授权失效。
* 资源详情、连接状态和错误诊断。
* 部署目标直接引用已登记 Resource/Profile。

不得让 Renderer 或 AI Agent 获得明文凭据。

五、P1：专业 UI/UX 深化

此次不允许继续仅调整卡片颜色、圆角或排列。

必须针对真实工作流优化：

审批工作台

* 可读的代码 Diff、文件切换、全屏审阅。
* 清晰显示路径、变更规模、风险及授权范围。
* 使用可信快照标识用户正在批准的具体内容。

部署控制台

* 真实执行时间线、增量日志、健康检查、失败原因。
* 明确区分 pending、running、unknown、succeeded。
* 提供对账和回滚操作。
* 目标、执行内容、结果之间具备清晰层次。

资源与连接

* 高密度资产目录与 Inspector。
* 将部署目标创建改为资源选择、部署范围、连接预检的渐进式流程。
* 改善浅色主题下下拉框、输入框和弹窗风格不一致的问题。

发布工作台

* 优化列表、详情和 Inspector 的空间分配。
* 允许必要的面板收起和尺寸调整。
* 避免单条记录占据大面积无效空间。

实际研究并按需采用成熟开源组件及模式：

* VS Code：可调整工作区布局。
* Coolify：主机与部署资源管理。
* Argo CD：部署状态、历史与资源详情。
* Bytebase：变更审查体验。
* Monaco Diff Editor：专业代码差异查看。
* react-resizable-panels：可调整面板。

允许安装合适依赖，但必须检查许可证、实际集成与性能；不允许只在报告中声称"参考了开源项目"。

保留 Premium Liquid Glass 视觉方向和现有真实业务功能。

六、Kubernetes / CI/CD

继续保留多部署模式架构。

优先开发可独立验证的只读连接、资源发现和 Adapter 契约。

需要真实 K8s Context、Namespace、CI/CD 平台资料时主动向用户请求，不因外部连接缺失停止其他开发。

不得擅自修改生产集群或生产流水线。

七、开发及验收要求

* 在最新分支建立安全恢复点，禁止擅自 reset、clean、删除分支或覆盖其他 Worktree。
* 复用现有 Deployment、Approval、Runtime、Evidence 和 Adapter，不创建第二套执行系统。
* 实际修改代码并提交，不能只生成方案。
* 运行 lint、typecheck、test、build、package 及相关 E2E。
* 验证 V24 → V32 的迁移兼容及 Phase 1 关键功能回归。
* 使用真实 Electron 验证 1440、1024、Light/Dark 和实际 125% 缩放。
* 所有测试区分 PASS、FAIL、SKIP、BLOCKED。
* 真实 VPS 写操作不得超过已明确批准的测试范围。

最终输出：

ProjectOS_V2.0_Phase2_5_Final_Acceptance.md

报告必须包含最终 Git HEAD、实际修复根因、远程部署/回滚证据、数据库状态与回执、UI 截图、使用的开源组件及其源码落点、未完成事项。

本轮验收的第一标准：Electron 中发起的真实部署，其远程执行结果、数据库状态、运行证据及 UI 展示必须一致。

完成 Phase 2.5 后停止，不自动进入 Phase 3。

现在直接开始工程实施，不要再仅输出规划文档。
