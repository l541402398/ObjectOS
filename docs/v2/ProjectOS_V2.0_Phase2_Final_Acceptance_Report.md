# ProjectOS V2.0 — Phase 2 发布、交付与部署管理最终报告

**日期**：2026-10-27  
**分支**：`v2.0-phase2`  
**基线**：`939e103`（Phase 1.1 交付收尾）  
**Phase 2 代码提交**：`a9f2f48`（`feat(phase2): add release, deployment and delivery workspaces`）  
**工作树**：`C:\Users\Administrator\Desktop\workplace\ProjectOS-v2-phase2`  
**结论**：**Phase 2 发布/部署记录管理 = PASS（本地与 Electron 真实操作）；真实外部 CI/CD、Kubernetes、SSH 部署链 = BLOCKED（无连接资料与生产操作授权）。**

> 本轮未操作真实生产服务器，未伪造部署成功，未把手工登记升级为外部确认。Phase 3/4 未启动。

---

## 1. Git 与工作区

| 项目 | 实际值 |
|---|---|
| 起始 HEAD | `939e103`（Phase 1.1 clean） |
| Phase 2 分支 | `v2.0-phase2` |
| Phase 2 代码提交 | `a9f2f48` |
| 独立 Worktree | `ProjectOS-v2-phase2` |
| 基线保护 | Phase 0 安全修复、Phase 1/1.1 真实业务、0686c41 视觉基线、V27 数据与 checksum 全部保留 |
| 数据库 | V28、V29 追加；V24/V27→V29 可升级，未修改既有 V27 SQL |
| 原始 Phase 1.1 worktree | 未 reset/clean/覆盖 |

---

## 2. V28 / V29 迁移

### V28 — ChangeRequest 与交付审批

新增：

- `change_requests`：Project/ProductVersion、标题说明、来源 Requirement/Task/Defect/Audit、风险、影响范围、目标环境、状态、revision、content_fingerprint、发起人、提交/决定时间。
- `change_request_links`：Artifact / Task 关联。
- `change_request_events`：created / revised / submitted / approved / rejected / changes_requested 审计。
- `approval_requests`：通用交付审批对象，绑定 `subject_type/subject_id/subject_revision/content_fingerprint`，用于 ChangeRequest 与 Deployment。

### V29 — Release / Deployment

新增：

- `release_candidates`、`release_candidate_artifacts`
- `releases`、`release_artifacts`
- `deployment_targets`、`deployment_strategies`
- `deployments`、`deployment_events`

外键、索引、唯一幂等键：

- `releases(project_id, version_id, idempotency_key)` 唯一。
- `deployments(project_id, environment_id, idempotency_key)` 唯一。
- `approval_requests(subject_type, subject_id, subject_revision, content_fingerprint)` 唯一，防止重复消费审批。

### 迁移验证

- `tests/phase0-migration.test.ts`：V24 fixture → V29，历史 project/task/artifact/plan 保留；新增表存在。
- V29 一致性备份：`VACUUM INTO` 后 `PRAGMA integrity_check = ok`，备份可读且 project/release 计数正确。
- `tests/r2-phase1.test.ts`：V18 → V29 数据保留。
- 迁移数组：1…27,…28,29 单调追加；未改写已发布 V27 SQL。

**结果：PASS。**

---

## 3. ChangeRequest / Approval 真实实现

`apps/runtime/src/release-service.ts`：

- 创建变更：校验版本/环境；写入内容指纹、来源、风险、影响范围、目标环境、Artifact/Task 关联。
- 编辑变更：revision+1、重算指纹、状态回到 draft；原 pending/approved/changes_requested 审批全部 `superseded`；旧批准不能继续使用。
- 提交审批：创建 `approval_requests`，绑定 revision + content_fingerprint；写入事件。
- 决定审批：只接受 `pending`；过期/重复消费拒绝；审批前重新比对 fingerprint/revision，内容变化则拒绝并 supersede。
- 审批通过才允许 candidate 进入可发布状态。

**结果：PASS。**
限制：交付审批使用 `approval_requests` 通用表与 Release Center 内操作；现有研发 ToolCall 审批表未合并，审批中心 UI 尚未展示交付审批条目。没有第二套 Release/ChangeRequest 业务实现。

---

## 4. ReleaseCandidate / Release

### Candidate

- 绑定 ProductVersion、ChangeRequest、Git commit/branch/repository、Artifact 快照与 SHA-256、GateEvaluation 最新状态。
- 仅当 **存在真实 Artifact + 最新版本 Gate passed + ChangeRequest approved** 时 `status = ready`；否则 `blocked` 并保留，不冒充可发布。
- Artifact 只从**该版本关联任务**的 Artifact 快照，不再把项目全部 Artifact 塞入候选。

### Release

- 必须来自 `ready` candidate；再次校验 CR approved + 审批 fingerprint 匹配 + gate passed。
- `releases` 冻结 manifest、每项 content hash、manifest_hash、Git commit；状态 `recorded`。
- `distribution_status = not_distributed`；没有外部分发回执，不标记为已分发。
- 相同 `idempotency_key` 返回同一 Release，不重复创建。
- 补丁/新版本产生新 candidate/release；旧 Release 历史不被覆盖。

**结果：PASS（本地发布记录）。**
限制：没有真实构建系统，`canBuild=false`；候选明确显示“构建未配置”，不把源码目录冒充正式构建制品。

---

## 5. Deployment / Environment

### 已实现

- `deployment_targets`：环境、名称、类型（local/ssh/kubernetes/pipeline/gitops/external）、控制方式、adapter 类型、目标引用、保护标记。
- `deployment_strategies`：环境、目标、adapter、来源、审批策略、启用状态。
- `deployments`：Release、Environment、Target/Strategy、状态、来源、assurance、幂等键、artifact hash、external id、receipt、approval、rollback/previous 关系。
- `deployment_events`：created / approved / rejected / result_recorded / rollback_created。
- 环境当前版本只依据 `status=succeeded AND assurance IN (source_observed, independently_reproduced, externally_confirmed)` 推导；手工声明不会成为“已确认当前版本”。

### 来源语义

| 来源 | 状态 | assurance | 说明 |
|---|---|---|---|
| manual | awaiting_approval → pending → succeeded | self_declared | 仅用户声明；环境当前版本不升级 |
| imported | awaiting_approval → pending → succeeded | source_observed | 来源报告了部署；不是 ProjectOS 执行 |
| unknown | needs_reconciliation | self_declared | 不猜测成功，不自动重试 |
| adapter | 拒绝 | — | 当前没有可执行 Adapter；不得伪造 |

### 幂等、审批与回滚

- 重复 deployment idempotency key 返回原记录。
- 审批重复消费拒绝；过期审批拒绝。
- 回滚是新 Deployment（`rollback_of_deployment_id`），原 Deployment 状态不变；回滚同样等待独立审批。
- 取消/未确认结果不改写历史。

**结果：PASS（事实记录与来源可信性）。**
限制：**没有真实 CI/CD、Kubernetes、GitOps 或 SSH 执行 Adapter**；没有连接资料与写操作授权，真实外部部署、健康检查、回滚、远程对账均 **BLOCKED**。UI 显示“未配置部署适配器”，不提供执行按钮。

---

## 6. UI / 信息架构

### 导航

新增项目「交付」分组：

- 发布中心 `/projects/:projectId/releases`
- 部署中心 `/projects/:projectId/deployments`

保留研发工作中心、任务与验收、Agent 协作、审批、运行审计、版本与迭代、知识与成果、项目姿态、设置。窄屏折叠为图标，完整侧栏显示「研发 / 交付 / 项目 / 全局」分组。旧 `/versions` 路由与深链接保留；导航传递 `?version=`。

### 版本与迭代收敛

- 移除底部完整发布/部署容器。
- 新增紧凑「发布与部署摘要」：最新 Release、已确认环境数、待办审批、候选/Release 数；入口携带 Project/Version 上下文。
- 消除原底部大块空白；版本页只负责版本、阶段、迭代、门禁与摘要。

### 发布中心

候选、变更申请、质量门禁、关联制品、审批、Release 历史、证据链；操作链：新建变更 → 提交审批 → 批准 → 生成候选 → 登记 Release。

### 部署中心

环境与目标、部署策略、Release 选择、部署历史、来源/assurance、外部 ID；手工/导入/未知三种来源；无 Adapter 时明确显示能力缺失。

### 真实 Electron E2E

`scripts/phase2-ui-e2e.mjs` 实际点击：

1. 版本页记录证据并推进门禁；
2. 进入发布中心；
3. 新建变更、提交、批准；
4. 生成候选、登记 Release；
5. 进入部署中心；
6. 选择 Release、登记部署、批准、记录成功结果。

输出：

```text
[phase2-ui] version delivery summary loaded
[phase2-ui] version evidence/gate PASS
[phase2-ui] release center loaded
[phase2-ui] change request approved PASS
[phase2-ui] release recorded PASS
[phase2-ui] deployment center loaded
[phase2-ui] manual deployment recorded with self_declared provenance PASS
PHASE 2 UI E2E PASS
```

### 截图

- `1440x900-light-release-center.png` / dark
- `1440x900-light-deployment-center.png` / dark
- `1440x900-125-actual-light-release-center.png` / dark
- `1440x900-125-actual-light-deployment-center.png` / dark
- `1024x768-light-release-center.png` / dark
- `1024x768-light-deployment-center.png` / dark
- 版本摘要/导航截图：`1440x900-light-versions.png` 等

125% 实际 DPR=1.25；`innerWidth=1442`、`scrollWidth=1442`，无水平裁切。

---

## 7. 测试与构建

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS，0 errors（剩余既有/新增 warnings，未隐藏） |
| `pnpm test` | **52 files passed / 1 skipped；285 tests passed / 3 skipped** |
| `pnpm build` | PASS |
| `pnpm package:dir` | PASS |
| `pnpm test:package` | **PACKAGE SMOKE PASS** |
| `node scripts/phase2-ui-e2e.mjs` | PASS（真实点击 + 发布/部署流程） |
| `node scripts/phase2-delivery-screenshots.mjs` | PASS（1024 / 1440 / DPR 1.25） |
| `tests/release.test.ts` | 2 passed（候选/Release/不可变/幂等/来源/未知/回滚/Adapter 拒绝） |
| V24/V18→V29 migration | PASS；V29 backup integrity_check=ok |

**未覆盖/未运行**：真实外部 CI/CD、K8s、SSH 部署 E2E；真实生产健康检查与远程回滚；未提供连接资料，未请求生产写权限。

---

## 8. 明确限制（必须接受）

1. **没有任何真实 Deployment Adapter**。Phase 2 的完成标准在原始工程提示词中要求至少一条真实外部交付链；当前只有 local/manual/imported 记录管理，**真实外部部署链 BLOCKED**。
2. **没有构建系统**。`canBuild=false`；Release 只冻结已存在 Artifact，不冒充正式构建产物。
3. **交付审批与现有 ToolCall 审批未完全合并**：数据与 UI 已统一在 Release Center，但 Approval Center 页面尚未列出交付审批。
4. 手工部署保持 `self_declared`；即使手工填写成功，也不会被环境当前版本采信。
5. 未操作任何生产服务器；未开始 Phase 3/4。

---

## 9. 与 Phase 3/4 的兼容性

已预留：

- `DeploymentTarget.controlMode`：pipeline / gitops / direct_kubernetes / ssh / external_observed。
- `DeploymentStrategy.adapterType/source`。
- Deployment `source/assurance/externalId/receipt/rollbackOf/previous`。
- Release→Deployment 一对多历史。
- 未来 Service / Incident 可通过 Deployment.releaseId + environmentId + externalId 关联。

未来 Adapter 必须：

- 只读 probe/inspect 与写入 execute 分离；
- 凭据只进 Main safeStorage，不进 SQLite/Git/模型；
- 同一目标控制权互斥；
- 未知结果进 `needs_reconciliation`，不自动重放；
- 外部回执必须可验证后才升级 `externally_confirmed`。

---

## 10. Phase 2 判定

| 项目 | 判定 |
|---|---|
| V28/V29 迁移与备份 | PASS |
| ChangeRequest + 审批绑定/失效 | PASS |
| ReleaseCandidate / Release 不可变与幂等 | PASS |
| Deployment 来源可信性与环境推导 | PASS |
| 发布中心/部署中心/版本摘要/导航 | PASS |
| 真实 Electron 点击流程 | PASS |
| 1024/1440/DPR 1.25 | PASS |
| 真实 CI/CD / K8s / SSH 交付链 | **BLOCKED（无连接资料与生产授权）** |
| Phase 2 整体 | **Conditional PASS：发布与部署记录管理可用；真实外部部署能力未完成，不得宣称可自动部署生产。** |

**本轮停止，等待验收；不自动进入 Phase 3/4，不连接或修改真实生产服务器。**
