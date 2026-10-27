# ProjectOS V2.0 — Phase 2.3「资源与连接」验收报告

**日期**：2026-10-27  
**分支**：`v2.0-phase2.3-resources`  
**基线**：`337e655`（Phase 2.3 工作台）  
**实现提交**：`a59f41b`（以最终 Git log 为准）  
**报告提交**：本文件提交后的 HEAD  
**结论**：**主机/VPS 资源、加密凭据引用、真实 SSH 只读测试、部署目标引用资源 = PASS；K8s/CI/CD/GitOps 连接器未实现。**

---

## 1. 基线 / Schema

| 项目 | 值 |
|---|---|
| 起始 HEAD | `337e655` |
| 数据库 | V31 additive migration |
| V31 表 | `resources`、`connection_profiles`、`credential_metadata`、`connection_test_runs` |
| V31 字段 | `deployment_targets.resource_id`、`connection_profile_id` |
| 旧数据 | 原有手工 Target 保留，新字段 nullable |
| 已发布迁移 | V27/V28/V29/V30 SQL 与 checksum 未修改 |

---

## 2. 资源模型与 API

- `Resource`：Host / KubernetesCluster / PipelineProvider / GitOpsController；项目可见，状态 active/disabled/archived。
- `ConnectionProfile`：协议、host、port、username、认证类型、`credentialRef`、host key fingerprint、trust policy、超时、最近测试状态。
- `CredentialMetadata`：只保存 kind/label/status/vaultKey，**无秘密列**。
- `ConnectionTestRun`：status/stage/message/latency/details/time。

主要 API：

```text
resource.overview / create / update
resource.profile.create / update / delete
resource.credential.create / disable
resource.connection.test
resource.credential.register（Main → Runtime，仅元数据）
resource.profile.internal（Main → Runtime）
resource.test.record（Main → Runtime）
```

---

## 3. 凭据安全

- 秘密只经 Renderer → Main 一次性输入；Main 使用 Electron `safeStorage` 加密后写入：
  - `resource-credentials.vault.json`
- SQLite 只存 `credential_metadata` 和 opaque `vaultKey/credentialRef`；没有 secret/password 列。
- Renderer 无任何“读取全部明文凭据”的 API；UI 只显示类型/标签/状态。
- `safeStorage.isEncryptionAvailable()` 为 false 时直接拒绝保存，**不会静默回退明文**。
- 凭据停用会删除 vault 条目；之后连接测试返回认证不可用。
- AI/日志/错误信息不包含私钥或密码。

---

## 4. SSH 真实连接测试

实现：

- `ssh2` 1.17.0（MIT）。
- 严格 `hostVerifier`：
  - 首次无固定指纹：返回 `host_key_untrusted` 和实际指纹，需要用户确认；
  - 指纹变化：`host_key_mismatch`，拒绝连接；
  - 固定指纹匹配后才认证。
- 认证方式：private key（含可选 passphrase）、password；Agent 明确 `unsupported`。
- 只读白名单命令：

```text
uname -srm && whoami
```

- 结果写入 `connection_test_runs`，Profile 记录最近状态/时间。

真实 Contabo 验证：

```text
host: vmi3693465
OS: Linux 6.8.0-147-generic x86_64
user: root
host key: SHA256:wNRyPcQ8ed2dEy7LIVIFGieWCaTjb3GTsZ1FwTZEWB8
```

Electron E2E 步骤：

1. 新建 Host（Contabo）→ 录入私钥（UI 遮蔽/不读回）
2. 创建 SSH Profile
3. 首次测试 → 返回指纹待确认
4. 固定指纹 → 重新测试 → `已连接`
5. 篡改 fingerprint → 测试返回 `主机指纹变化`
6. 恢复指纹 → 重新连接成功
7. 停用凭据 → 再测试失败
8. 重启应用 → 资源/Profile/测试历史恢复；私钥不出现在 UI/SQLite/vault 明文

输出：

```text
SSH host key trust + read-only connection PASS
host key mismatch rejected, restored fingerprint reconnects PASS
disabled credential invalidates connection test PASS
restart recovery PASS
SQLite credential metadata contains no private key PASS
OS-encrypted vault contains ciphertext only PASS
RESOURCES UI E2E PASS
```

---

## 5. 部署中心集成

- 部署目标创建支持选择：
  - 已登记 Resource；
  - ConnectionProfile；
  - 自动填充目标名、host、port、username 与 `ssh://.../path`；
  - `DeploymentTarget.resource_id/connection_profile_id` 持久化。
- 旧手工 Target 仍可使用。
- 连接测试成功不等于部署授权；执行仍需独立 Deployment Approval。
- 本轮未实现：修改 Resource/Profile 后自动失效已有 Target 审批；属于后续加固。

---

## 6. Kubernetes / Pipeline / GitOps 边界

- 资源类型与连接元数据模型已建立（endpoint、labels、metadata、Profile）。
- 本轮**只实现 Host SSH 连接器**。
- Kubernetes/CI/CD/GitOps 的 UI 明确显示“连接器未实现/未连接”，没有伪造测试成功。
- 不把 K8s 等同于 CI/CD；后续按真实 API/Namespace/RBAC 接入。

---

## 7. 验证结果

| 项目 | 结果 |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS，0 errors |
| `pnpm test` | **287 passed / 4 skipped** |
| `pnpm build` | PASS |
| `pnpm package:dir` | PASS |
| `pnpm test:package` | **PACKAGE SMOKE PASS** |
| V24/V18 → V31 | PASS |
| 资源/凭据单测 | PASS |
| 真实 SSH Electron E2E | PASS |
| 部署目标引用资源 UI | PASS |
| 重启恢复 | PASS |
| 私钥泄漏检查（UI/SQLite/vault 明文） | PASS |
| 1440 / 1024 截图 | PASS |
| 真实 DPR 1.25 资源页 | **未截图** |
| K8s/CI/CD/GitOps 连接 | **BLOCKED（未实现）** |

---

## 8. 依赖与许可

| 依赖 | 版本 | 许可证 |
|---|---|---|
| `ssh2` | 1.17.0 | MIT |
| `@types/ssh2` | dev | MIT |

未新增 UI 框架依赖；继续使用现有 Ant Design 与设计 tokens。

---

## 9. 截图

- `docs/screenshots/1440x900-light-resources.png`
- `docs/screenshots/1024x768-light-resources.png`
- `docs/screenshots/1440x900-light-deployment-resource-target.png`

---

## 10. 未完成 / Backlog

1. Resource/Profile 编辑 UI（后端 update API 已有）。
2. Resource 删除/归档 UI（目前只有停用资源按钮）。
3. 凭据轮换 UI 与审计时间线。
4. Host key 指纹变化后的 Target 审批失效联动。
5. K8s/CI/CD/GitOps 真实连接器。
6. 资源项目可见性/ACL、跨项目授权 UI。
7. 1/10/100 资源列表密度压力测试。
8. DPR 1.25 资源页截图。

---

## 11. 停止点

本轮只完成资源与连接管理的最小可用闭环；不自动进入 Phase 3，不执行未授权的远程部署写入。

**等待验收。**
