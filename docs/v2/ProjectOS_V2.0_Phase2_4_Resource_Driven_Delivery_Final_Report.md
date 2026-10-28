# ProjectOS V2.0 — Phase 2.4 资源驱动部署闭环最终报告

**日期**：2026-10-27  
**分支**：`v2.0-phase2.4`  
**基线**：`2c8e29d`  
**实现提交**：`3ed50d9`  
**报告提交**：本文件提交后的 HEAD  
**结论**：**部署授权绑定、V32 快照、受控 SSH 执行路径、资源/凭据复用已完成；Electron SSH 执行记录仍停在 pending，未达到 P0 闭环；v1→v2→v1 未完成。Phase 2.4 远程部署判定 FAIL。**

---

## 1. Git / Schema

| 项目 | 值 |
|---|---|
| 起始 HEAD | `2c8e29d` |
| 实现提交 | `3ed50d9` |
| 数据库 | **V32** additive migration |
| V32 | `resources.revision`、`connection_profiles.revision`、`approval_requests.subject_snapshot_json`、`deployments.execution_state`、`deployments.authorization_fingerprint` |
| 已发布迁移 | V27–V31 未修改 |
| 远程测试目标 | Contabo `169.58.112.111:22`，隔离目录 `/opt/projectos-delivery-test`，容器 `projectos-delivery-test`，端口 18080；不记录私钥 |

---

## 2. 本轮实现

### 2.1 部署授权绑定目标快照

- `deploymentAuthorization()` 生成并保存：
  - Release ID / manifest hash / Git commit；
  - Environment；
  - Target：ID、名称、kind、controlMode、adapterType、targetRef、resourceId、profileId；
  - Resource：ID、revision、status、endpoint；
  - Profile：ID、revision、host、port、username、authType、credentialRef、host key fingerprint、trustPolicy；
  - 制品清单（name + SHA-256）。
- 审批 `approval_requests.content_fingerprint` 使用该快照指纹；
- `deployments.authorization_fingerprint` 保存同一指纹；
- 执行前重新计算：
  - 审批必须 approved；
  - 当前指纹必须等于审批指纹与部署保存指纹；
  - 资源必须 active；
  - Profile 必须存在；
  - 引用的凭据必须 active。
- 地址/端口/账号/路径/Host Key/资源 revision/制品变化会使旧授权失效。
- 新增负向单测：批准后修改 Target 的 `target_ref`，执行被拒绝为“授权失效”。

### 2.2 受控 SSH 执行路径

- Main 进程新增 `ssh-deploy.ts`：
  - 使用 `ssh2`；
  - 从 safeStorage vault 读取 SSH 私钥/密码；
  - 严格 hostVerifier 校验 pinned fingerprint；
  - SFTP 创建 release 目录、上传制品；
  - 远端 `sha256sum` 再校验；
  - `docker rm -f` + `docker run` 固定容器；
  - SSH 内 `curl /health`；
  - 回执、外部 ID、健康结果。
- `deployment.execute` 改为 Main 方法：
  1. `deployment.inspect` 判断 Adapter；
  2. SSH 走 `deployment.prepare` → Main safeStorage → ssh2；
  3. `deployment.finish` 写回状态/回执；
  4. Local 仍走 Runtime Adapter。
- 私钥不进入 Renderer、Runtime API 响应、SQLite、Git、日志。

### 2.3 资源/凭据复用

- UI 新建 Host → 私钥录入 → Profile → 连接测试 → Target 选择 Resource/Profile；
- DeploymentTarget 持久化 `resource_id/connection_profile_id`；
- 真实 Host Key 首次确认、变化阻断、凭据停用失效；
- Vault 只存密文；SQLite 无 secret 列。

### 2.4 回滚语义

- `createRollback` 现在默认查找同一目标/环境**上一个不同 Release 的成功部署**；
- 没有历史 Release 时拒绝；
- 回滚审批使用新的目标快照和指纹；
- 回滚仍是新 Deployment，不改写原记录。

---

## 3. 真实远程验证

只读/连接：

- Contabo VPS 可连接；
- Host key 固定后可读 `uname/whoami`；
- SSH Adapter 直连测试通过；
- 远端隔离目录存在，容器运行。

部署尝试：

- Electron 点击「执行部署」后：
  - 远端实际产生新的 release 目录，容器被重建；
  - 但 UI/数据库记录仍显示 `pending`；
  - 未拿到可展示的 `external_id` / receipt；
  - 因此不能判定为完整 Electron 部署闭环。
- 直连/后台路径曾返回 succeeded 与 `ssh:projectos-delivery-test:...`，但未通过 Electron 持久化/刷新验证，不能替代 UI 验收。

**Electron SSH 部署：FAIL。**

根因未完全定位；候选：
- Main `deployment.finish` 响应未回到 Renderer / 超时；
- UI 执行后查询缓存未刷新；
- Renderer 侧未观察到完成状态。
- 未通过直接写 DB 或 mock 绕过。

---

## 4. v1 → v2 → v1

**未完成。**

- 回滚 API 逻辑已改为上一个不同 Release；
- 未实际准备 v1/v2 两个远端可验证版本；
- 未完成真实更新、独立回滚审批与 `/version`/HTTP 回滚验证。
- 判定 **FAIL/BLOCKED**。

---

## 5. 审批 Diff / TOCTOU

- UI 已有真实行级 Diff（Phase 2.3）；
- 本轮**未完成**：
  - 后端保存原始文件基线哈希；
  - 批准时重新校验基线；
  - 预览后文件变化导致批准拒绝；
  - 多文件/完整内容截断提示。
- 当前 Diff 仍是 Renderer 读取当前工作区的展示，不是可信授权快照。
- 判定 **PARTIAL**。

---

## 6. 资源管理日常功能

- 已完成：创建 Host、凭据、Profile、连接测试、Target 引用、资源停用、凭据停用、重启恢复。
- 未完成：
  - Resource/Profile 编辑 UI；
  - Profile 删除；
  - 凭据轮换；
  - 连接历史删除/筛选；
  - 资源归档与引用约束 UI。

---

## 7. K8s / CI/CD

- 只保留资源/Profile 元数据；
- 未获得 K8s Context/Namespace、CI/CD 只读 API/Token；
- 不伪造连接成功；
- 判定 **BLOCKED**。

需要用户提供：
1. K8s 只读测试 Context + Namespace + 允许读取资源；
2. CI/CD 平台类型、URL、只读 Token、测试流水线；
3. 若继续 VPS 写入：确认当前 `/opt/projectos-delivery-test` 与容器仍属测试范围；v1/v2/回滚操作需再次列明目标、路径、端口、影响和回滚方案。

---

## 8. 验证结果

| 项目 | 结果 |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS，0 errors |
| `pnpm test` | **287 passed / 4 skipped** |
| `pnpm build` | PASS |
| `pnpm package:dir` | PASS |
| `pnpm test:package` | **PACKAGE SMOKE PASS** |
| V24/V18 → V32 | PASS |
| 授权快照负向测试 | PASS |
| 资源/凭据/SSH 连接 E2E | PASS |
| Local Adapter E2E | PASS |
| Electron SSH 部署闭环 | **FAIL** |
| v1/v2/rollback | **FAIL/BLOCKED** |
| Diff TOCTOU 后端校验 | **FAIL** |
| K8s/CI 只读 | **BLOCKED** |

---

## 9. 截图

- `1440x900-light-resources.png`
- `1024x768-light-resources.png`
- `1440x900-light-deployment-resource-target.png`
- `1440x900-light-approval-tool-diff.png`
- `1440x900-light-release-center.png`
- `1440x900-light-deployment-center.png`（Local 交付，不是 SSH 成功）

没有伪造 SSH 成功截图。

---

## 10. 未完成 / 下一步

1. 定位 Main `deployment.finish` / Renderer 刷新链，完成 Electron SSH 部署记录。
2. v1/v2 实际远端版本、独立回滚审批、HTTP 验证。
3. 后端 Diff 基线哈希与 TOCTOU 拒绝。
4. Resource/Profile 编辑、凭据轮换、引用约束。
5. K8s/CI 只读连接。
6. 并发、幂等、断连、Runtime 强杀对账。

**Phase 2.4 远程部署不能判定完成；不进入 Phase 3。**
