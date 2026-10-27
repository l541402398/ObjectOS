# ProjectOS V2.0 — Phase 2.2 真实交付能力与 UX 重构验收

**日期**：2026-10-27  
**分支**：`v2.0-phase2.2`  
**基线**：`v2.0-phase2` HEAD `49d3d86`  
**代码提交**：`1e60056`（以最终 Git log 为准）  
**工作树**：`C:\Users\Administrator\Desktop\workplace\ProjectOS-v2-phase2.2`  
**结论**：**本地 Adapter + 真实 SSH/VPS Adapter + Electron 执行链 = PASS；K8s/GitOps/Pipeline 远程 = BLOCKED（未获连接）。**

---

## 1. Git 与安全边界

| 项目 | 实际值 |
|---|---|
| 起始 HEAD | `49d3d86` |
| 本轮分支 | `v2.0-phase2.2` |
| 代码提交 | `1e60056` |
| 报告提交 | 本文件提交后的 HEAD |
| 数据库 | 复用 V28/V29；无新迁移 |
| 基线保护 | Phase 0 安全、Phase 1.1 Agent/Gate/Approval/Worktree、0686c41 视觉基线保留 |
| 生产服务 | 未修改现有 Nginx、其他容器、防火墙、K8s、CI/CD |
| SSH 密钥 | 仅存于仓库外 `~/.ssh`，ACL 仅 Administrator/SYSTEM；未写入 SQLite/Git/日志/报告 |

---

## 2. 三页 UX 重构

### 2.1 发布中心

- 「候选 / 变更 / Release」分段视图，主列表 + 右侧「发布就绪」Inspector。
- Inspector：变更批准、门禁、制品数、构建能力、最新 Release 的版本/分发/Git/哈希。
- 候选状态「可冻结 / 已生成 Release」；Release「已登记 · 未外部分发」。
- 批准按钮统一到审批中心。

### 2.2 部署中心

- 「部署执行 / 环境与目标 / 历史与回滚」分段。
- Adapter 能力条：
  - `Local Artifact · 可执行`
  - `SSH / VPS · 可执行`
  - `CI/CD Pipeline / Kubernetes / GitOps · 只读/未连接`
- 部署记录以目标名称为主标题；显示来源、assurance、外部 ID、审批。
- 执行按钮只在已批准 + 目标支持时出现。

### 2.3 审批中心

- 「全部类型 / 工具权限 / 交付审批」分段。
- 交付审批展示业务标题、revision、内容指纹前缀；不再显示原始对象 ID。
- 尚未完成：工具审批 Diff 预览与结构化影响范围（Backlog）。

### 2.4 截图

- `1440x900-light-release-center.png` / dark
- `1440x900-light-deployment-center.png` / dark
- `1440x900-light-approval-center-delivery.png`
- `1024x768-*`、`1440x900-125-actual-*`
- 125% 实际 DPR=1.25；`innerWidth=1442`、`scrollWidth=1442`。

---

## 3. 本地 Adapter（隔离测试）

`LocalArtifactAdapter`：

- 校验每个制品 SHA-256；
- 复制到 `<target>/versions/<deploymentId>`；
- 写 `deployment-receipt.json` 与 `health.json`；
- 返回 `local-<deploymentId>`、manifest hash、健康结果；
- assurance=`independently_reproduced`；
- 无 Shell，仅文件复制/哈希/回执。

E2E 制品哈希：

```text
a104444e073cb4bba61ada7e52b329a0487cd452f23d2562c4ff70921effb58a
```

---

## 4. 真实 SSH/VPS Adapter 与远程验证

### 4.1 实现

`SshArtifactAdapter`：

- 目标：`ssh://root@169.58.112.111:22/opt/projectos-delivery-test?healthPort=18080&container=projectos-delivery-test&image=nginx:alpine`
- 连接：
  - 部署专用 Ed25519 密钥（指纹 `SHA256:Vo+O1SWOTdbktLvjWzWgY/ZioCS3bBV4cOu155oCVjk`）；
  - `BatchMode=yes`、`IdentitiesOnly=yes`、`StrictHostKeyChecking=yes`、固定 known_hosts；
  - 不把密钥写入 Runtime/SQLite/Git/日志。
- 路径限制 `/opt/projectos-*`；容器名/端口/镜像白名单校验。
- 执行：
  1. 创建 `releases/<deploymentId>`；
  2. `scp` 上传制品；
  3. 远端 `sha256sum` 再校验；
  4. 删除旧隔离容器（不存在则忽略）；
  5. 启动 `nginx:alpine`，仅绑定 `127.0.0.1:18080`，只读挂载 release；
  6. SSH 内 `curl /health`；
  7. 返回 `ssh:projectos-delivery-test:<deploymentId>`、健康回执、`externally_confirmed`。
- 不修改现有 Nginx、防火墙、其他容器；不提供通用终端。
- 部署前需独立 Deployment 审批；重复执行拒绝。

### 4.2 真实远程结果（Contabo）

只读探测：

- `vmi3693465`，Ubuntu 6.8，Docker 29.9.2；
- 18080 端口空闲；
- `/opt/projectos-delivery-test` 初始不存在。

经用户明确批准后执行：

- 创建 `/opt/projectos-delivery-test/releases/<deploymentId>/`；
- 上传 `index.html`（31 bytes）与 `health`（2 bytes）；
- 拉取 `nginx:alpine`；
- 启动 `projectos-delivery-test`，状态 Up，`127.0.0.1:18080->80/tcp`；
- `curl http://127.0.0.1:18080/health` → `ok`；
- `curl /` → `<h1>ProjectOS SSH delivery</h1>`；
- 远端 `index.html` SHA-256：

```text
1ccc12a34bcedb46c21256e39e2e5d1021972207b5c07274ab2cb6f764ab669e
```

- 外部 ID：`ssh:projectos-delivery-test:dep_...`；
- assurance：`externally_confirmed`。

真实测试：

- `tests/ssh-adapter-e2e.test.ts`（opt-in `PROJECTOS_SSH_E2E=1`）直接调用 ReleaseService → SSH Adapter → Contabo，PASS；
- `scripts/phase2-ui-e2e.mjs`（`PROJECTOS_SSH_UI_E2E=1`）真实 Electron 点击「执行部署」，页面显示「外部确认」与 `ssh:...`，PASS。

### 4.3 未验证

- 香港 hk-main：只读探测通过；未部署，避免影响退役中机器。
- 更新：同一目标重新执行会重建隔离容器（本轮多次执行均为该路径），但未做内容差异断言的独立“更新”用例。
- 回滚：SSH Adapter 目前 `rollback=false`；Deployment 回滚模型存在，但未执行真实远程回滚。
- K8s/GitOps/Pipeline：无连接资料，BLOCKED。

---

## 5. 验证结果

| 项目 | 结果 |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS，0 errors（11 warnings） |
| `pnpm test` | **53 files passed / 1 skipped；286 tests passed / 4 skipped** |
| `pnpm build` | PASS |
| `pnpm package:dir` | PASS |
| `pnpm test:package` | **PACKAGE SMOKE PASS** |
| 本地 Adapter 单测 | PASS |
| 真实 SSH Adapter 测试 | PASS |
| 本地 Electron E2E | PASS |
| 真实 SSH Electron E2E | PASS（外部确认 + health） |
| 1024 / 1440 / DPR 1.25 | PASS，无水平裁切 |
| K8s / GitOps / Pipeline | **BLOCKED** |

---

## 6. 未完成 / Backlog

1. SSH Adapter 回滚、旧版本保留与真实回滚验证。
2. SSH 更新内容差异断言、日志/健康历史、断线对账。
3. K8s/GitOps/Pipeline 远程连接与 Adapter。
4. 构建系统/Registry 制品导入；当前 `canBuild=false`。
5. 工具审批 Diff 预览、影响范围结构化展示。
6. 商业级 UX 继续打磨：1024 下 Inspector 下移、列表空态密度、审批卡信息层级。

---

## 7. 用户需要提供

- K8s 只读测试 Context/Namespace 与允许读取范围；
- CI/CD 平台类型、只读 API/测试流水线；
- 若继续 SSH：确认保留当前 `/opt/projectos-delivery-test` 与容器，或授权清理；
- 真实回滚/更新前，确认目标、版本、端口、影响与回滚步骤。

---

## 8. Phase 3 起点

Phase 3 运维中心不提前实现；需真实 K8s/容器/Service/Observability 数据后再建。拓扑优先评估 AntV G6/Cytoscape.js，现有研发 DAG 保持原图形实现。

**本轮停止，等待验收。**
