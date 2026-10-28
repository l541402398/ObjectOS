# Phase 2.5 · P0-1 SSH 部署闭环：真实根因与修复

**分支**：`v2.0-phase2.5` · **恢复点 tag**：`phase2.5-base`
**证据类型**：真实 Electron 运行日志、SQLite 行状态、远端容器事实、修复后 UI 端到端

---

## 1. 复现与首次证据（修复前）

用真实 Electron（`PROJECTOS_DATA_DIR` 独立数据目录）走完整 UI 流程，点击「执行部署」后：

| 观测点 | 事实 |
|---|---|
| `deployments.status` | `running` |
| `deployments.execution_state` | `running` |
| `deployments.started_at` | `1793153758903`（已写入） |
| `deployments.finished_at` | `null` |
| `deployments.external_id` | `null` |
| `deployment_events` | `created` → `approved` → `adapter_started`，之后无任何事件 |
| `desktop.log` | 只有 `starting runtime` / `runtime ready` / `runtime exited`，**没有任何 `deployment.*` 记录** |

结论一：`deployment.prepare` **确实提交了**（否则 `started_at` 不会写入），所以「UI 停在 pending」不是"渲染没刷新"，而是**执行中断后没有任何可恢复的记录**。

结论二：Phase 2.4 报告里的 `pending` 与本次实测的 `running` 是同一个缺陷的两个瞬间——`prepareDeployment` 只把状态翻成 `running`，**没有操作意图记录、没有操作 ID、没有对账入口**。一旦 Main 进程结束（关闭应用、SSH 断线、Runtime 重启），这一行就永久停在 `running`，既不能判断远端是否已生效，也没有任何机制把它推进到 `needs_reconciliation`。

结论三：Phase 2.4 的验收脚本无法发现该问题，因为它的等待条件 `('自我声明' || '外部确认')` 在点击前就已经存在于页面上（`可信度 自我声明` 是常驻文案），`waitForFunction` **立刻返回**，随后脚本关闭 Electron。也就是说：**测试在点击后约 0.7 秒就杀掉了应用**，把一次真实部署截断在 `running`。

---

## 2. 根因分类（全部经代码与运行证据确认）

| 编号 | 根因 | 证据 |
|---|---|---|
| RC-1 | 远端副作用前没有持久化"操作意图 + 稳定操作 ID"，只有一次裸状态翻转 | `prepareDeployment` 仅 `UPDATE deployments SET status='running'`；`deployment_operations` 表不存在 |
| RC-2 | 失败分类错误：任何异常都写成 `failed` + `external_id=null`，即使远端已经重建容器 | Main 的 catch 分支无条件 `deployment.finish(status:'failed', assurance:'self_declared')` |
| RC-3 | 存在两套 SSH 执行实现：Main（ssh2 + safeStorage Vault）与 Runtime（`PROJECTOS_DEPLOY_SSH_KEY` + shell `ssh/scp`），`deployment.execute.local` 仍可绕过 Main 执行远程动作 | `apps/runtime/src/delivery-adapters.ts` 与 `apps/desktop/src/main/ssh-deploy.ts` 各自实现 mkdir/scp/docker/health |
| RC-4 | 远程命令无超时；`docker run` / `curl /health` 挂起时整条 IPC 无界等待 | `exec()` 无超时；`health` 只查一次，nginx 尚未就绪即判失败 |
| RC-5 | 制品模型缺陷：无文件 URI 的"证据类"制品被当成必须上传的文件，部署在**执行阶段**才失败 | 实测报错 `制品缺少真实文件：v1 测试证据` |
| RC-6 | 渲染层没有 unknown / 对账概念，也没有回滚入口 | `DeploymentConsole` 仅有「执行部署 / 人工记录结果 / 刷新状态」 |

---

## 3. 修复内容

### 3.1 Schema V33（additive，V27–V32 未改动）

- `deployment_operations`：`operation_key`（`deploymentId:attempt` 唯一）、`attempt`、`state`（prepared/executing/confirmed/failed/unknown）、`external_id`、`remote_facts_json`、`last_error`、时间戳
- `deployment_operation_steps`：每次尝试的分阶段时间线
- `deployments.active_operation_id`
- `approval_file_targets` / `approval_file_snapshots`（P0-3 使用）

### 3.2 执行前持久化意图，执行中记录状态

`prepareDeployment` 现在：

1. 先做授权指纹与资源/凭据状态校验；
2. 若存在 `prepared/executing` 的操作 → **resume**（返回同一 operation，不新建尝试）；
3. 若存在 `unknown` 的操作 → 直接拒绝并提示必须先对账；
4. 否则在**一个事务内**插入 operation 行（state=`prepared`）并翻转部署为 `running`。

Main 逐步上报 `deployment.operation.step`（verify-local / connect / upload / container / health / receipt / error），并按序 flush，避免快速失败时丢失时间线。

### 3.3 远端成功但本地未确认 → `needs_reconciliation`

`SshDeployError` 携带 `remoteMutated`：只要 `docker run` 已经开始，任何失败都不再写成 `failed`，而是 `deployment.operation.mark_unknown` → 部署进入 `needs_reconciliation`，并记录 `remote_facts`。

### 3.4 对账（只读查远程事实，禁止盲目重放）

新增 `deployment.reconcile.remote`（Main 执行只读探测）→ `deployment.reconcile`（Runtime 记录）：

- `observeSshDeployment` 只读：release 目录、`docker inspect` 的镜像与挂载、`/health`，**判定容器是否真的在提供本次部署的 Release**；
- 只有 `reachable && healthOk && externalId` 三者成立才置 `succeeded` + `externally_confirmed`，否则维持 `needs_reconciliation`。

### 3.5 单一执行系统

`executeDeployment`（Runtime）只允许 `local-artifact`；远程目标直接拒绝："远程目标必须在 Main 进程内执行，Runtime 不持有凭据"。

### 3.6 超时与健康检查

远程命令 90s 超时、SFTP 上传 90s 超时、`/health` 最多重试 10 次（700ms 间隔）。

### 3.7 证据类制品不再阻断部署

只有带真实文件 URI 的制品才进入上传载荷；无 URI 的制品作为证据跳过并写入回执 `evidenceOnlyArtifacts`；同时要求载荷中必须存在 `health`。

---

## 4. 修复后的真实验收（UI 驱动）

完整流程全部通过真实鼠标操作（无 `window.projectos` 驱动业务动作）：

资源新建 → 连接测试 + Host Key 信任 → 部署目标引用 Resource/Profile → 记录三类证据 → 推进阶段（开发中→验证中→候选发布）→ 变更审批 → 生成候选 → 登记 Release → 登记部署 → **独立审批** → 点击「执行部署」。

结果：

| 项目 | 结果 |
|---|---|
| UI 终止态 | `服务已确认`（`succeeded` + `externally_confirmed`） |
| SQLite `execution_state` | `completed` |
| SQLite `external_id` | `ssh:projectos-delivery-test:dep_…` |
| 操作状态 | `confirmed`，attempt=1 |
| 执行时间线 | 10 步：`verify-local → connect → upload ×2 → container → health → receipt` |
| 远端 `/health` | `ok` |
| 远端 `/version` | `projectos-phase2.5-v1`（与本次 Release 一致） |
| 远端容器挂载 | `/opt/projectos-delivery-test/releases/<本次 deploymentId>` |
| 重启 Electron 后 | UI 仍显示「服务已确认」+ 外部 ID，记录完整 |

**四者一致：远端事实 = SQLite = 执行证据 = UI 展示。**

---

## 5. 未覆盖 / 限制

- `resume` 的同进程并发保护用 10 分钟陈旧判定，未实现跨进程互斥锁（单窗口桌面场景可接受）。
- 对账只实现 SSH 目标的只读探测；local-artifact 无远端事实可查。
- Phase 2.4 的旧数据目录中遗留的 `running` 行不会自动迁移为 `needs_reconciliation`（本轮未提供一次性修复脚本）。
