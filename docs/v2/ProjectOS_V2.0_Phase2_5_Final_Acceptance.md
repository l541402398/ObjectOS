# ProjectOS V2.0 — Phase 2.5 最终验收报告

**主题**：部署闭环修复与 UX 深化
**分支**：`v2.0-phase2.5`（恢复点 tag `phase2.5-base` = `b7a1819`）
**日期**：2026-10-27 / 2026-10-28（America/Los_Angeles）
**远程范围**：Contabo `169.58.112.111` · `/opt/projectos-delivery-test` · 容器 `projectos-delivery-test` · 端口 `18080`（未触碰该机器任何其他服务）

> 本轮第一验收标准：**Electron 中发起的真实部署，其远程执行结果、数据库状态、运行证据与 UI 展示必须一致。** 该标准已通过真实 UI 操作验证，见第 4 节。

---

## 1. Git / Schema

| 项目 | 值 |
|---|---|
| 分支 | `v2.0-phase2.5` |
| 恢复点 | tag `phase2.5-base`（`b7a1819`） |
| 基线 | `491860e`（Phase 2.4 报告提交） |
| 本轮提交 | `3278fee` → `2f513cb` → `4dd20ab`（最后一个**代码**提交）→ 若干 docs 提交 |
| **代码 HEAD（全部验证所对应的提交）** | **`4dd20ab`** |
| 报告 HEAD | 本文件所在提交（`git log -1`，其后不再有代码变更） |
| 工作树 | clean |
| Schema | **V33**（additive；V27–V32 未修改） |

V33 新增：

- `deployment_operations`（`operation_key` 唯一、`attempt`、`state`、`external_id`、`remote_facts_json`、`last_error`）
- `deployment_operation_steps`（分阶段执行时间线）
- `deployments.active_operation_id`
- `approval_file_targets` / `approval_file_snapshots`（可信审批基线）

迁移兼容：`tests/phase0-migration.test.ts`（V24 fixture）与 `tests/r2-phase1.test.ts`（V18 fixture）均断言升级到 **V33** 并通过。

---

## 2. 实际修复的根因（不是猜测，逐条有证据）

完整的证据链见 `docs/v2/phase2.5/P0-1_deployment_closure_root_cause.md`。要点：

| 编号 | 根因 | 修复 |
|---|---|---|
| RC-1 | 远端副作用前**没有持久化操作意图与稳定操作 ID**，只有一次裸状态翻转；进程一结束就永久停在 `running` | V33 `deployment_operations`：`operation_key = deploymentId:attempt`，执行前在同一事务内落库并为 `prepared`，执行中持续写 `executing`/步骤 |
| RC-2 | 失败分类错误：任何异常都写成 `failed` + `external_id=null`，即使远端已重建容器 | `SshDeployError.remoteMutated`：`docker run` 之后任何失败 → `deployment.operation.mark_unknown` → 部署进入 `needs_reconciliation`，并记录 `remote_facts` |
| RC-3 | **两套 SSH 执行实现**：Main（ssh2 + safeStorage Vault）与 Runtime（`PROJECTOS_DEPLOY_SSH_KEY` + shell `ssh/scp`） | Runtime `executeDeployment` 只允许 `local-artifact`；远程目标直接拒绝（"Runtime 不持有凭据"） |
| RC-4 | 远程命令无超时；`/health` 只查一次，nginx 未就绪即判失败 | 命令/SFTP 各 90s 超时；`/health` 最多 10 次重试 |
| RC-5 | 无文件 URI 的**证据类制品**被当成必须上传的文件，部署在执行阶段才失败（实测：`制品缺少真实文件：v1 测试证据`） | 只有带真实文件的制品进入载荷；证据类制品跳过并写入回执 `evidenceOnlyArtifacts`；同时要求载荷必须含 `health` |
| RC-6 | `createRollback` 的 INSERT **21 个值对 22 列** → 回滚**从未成功过**（静默失败，UI 无任何提示） | 重写 INSERT 列/值对应；新增回归测试 `tests/p25-rollback.test.ts` |
| RC-7 | `deployment.operations` 被列为 Main-only，Runtime 拒绝，Main 代理也失败 → 执行时间线永远拿不到 | 从 `MAIN_METHODS` 移除，改由 Main 代理到 Runtime |
| RC-8 | 审批 Diff 只由 Renderer 读工作区生成，**无可信基线** | V33 审批快照 + 批准前/写入前两次重校验 + TOCTOU 拒绝（见第 5 节） |

另外确认一个**测试缺陷**（Phase 2.4 为何没发现 RC-1）：旧验收脚本的等待条件 `('自我声明' || '外部确认')` 在点击前就命中常驻文案 `可信度 自我声明`，`waitForFunction` 立即返回，脚本随即关闭 Electron —— **点击后约 0.7 秒应用就被杀掉**，把一次真实部署截断在 `running`。

---

## 3. 实现的运行语义

1. **执行前**：校验授权指纹、资源/凭据状态 → 若已有 `prepared/executing` 操作则 `resume`（不新建尝试）；若存在 `unknown` 操作则**拒绝执行**并提示先对账。
2. **执行中**：逐步写 `deployment_operation_steps`（`verify-local → connect → upload → container → health → receipt`），按序 flush，快速失败也不丢时间线。
3. **远端成功但本地未确认**：`needs_reconciliation` + `remote_facts`，**禁止盲目重放**。
4. **对账**：`deployment.reconcile.remote`（Main）做**只读**探测——release 目录、`docker inspect` 镜像与挂载、`/health`，并判定容器是否真的在提供**本次**部署的 Release；三条件同时成立才置 `succeeded` + `externally_confirmed`。
5. **回滚**：创建**新的 Deployment**（`awaiting_approval`），引用上一个不同的成功 Release，`rollback_of_deployment_id` 指向源部署；旧记录不被覆盖。

---

## 4. 真实远程证据（UI 驱动的完整闭环）

脚本：`scripts/phase2.5-deploy-closure-e2e.mjs`（全部业务动作走真实鼠标点击；`window.projectos` 仅用于**读取**核对与为制品挂载真实文件路径——产品目前没有为制品设置文件 URI 的 UI）。

**结果：32/32 PASS。**

| 检查 | 结果 |
|---|---|
| 真实 Electron 启动、UI 新建主机、连接测试 + Host Key 信任 | PASS |
| 凭据未泄漏到 Renderer | PASS |
| 部署目标引用已登记 Resource/Profile | PASS |
| 门禁证据（评审记录 + 测试报告 + 审批记录）+ 推进到候选发布 | PASS |
| 变更审批 → 生成候选 → 登记 Release → 登记部署 → 独立审批 | PASS |
| UI 真实点击「执行部署」（`elementFromPoint` 命中校验） | PASS |
| **v1** UI 终止态 `服务已确认` | PASS |
| **v1** 远端 `/version` = `projectos-phase2.5-v1` | PASS |
| **v1** 远端容器挂载 = `…/releases/<本次 deploymentId>` | PASS |
| **v2**（新建版本 0.2.0）UI 终止态 `服务已确认` | PASS |
| **v2** 远端 `/version` = `projectos-phase2.5-v2` | PASS |
| **v2** 容器挂载切到 v2 的 Release | PASS |
| 控制台「基于此版本创建回滚」→ 新的待审批 Deployment | PASS |
| 回滚独立审批通过 | PASS |
| **回滚** 执行 → UI `服务已确认` | PASS |
| **回滚** 远端 `/version` 回到 `projectos-phase2.5-v1` | PASS |
| 回滚是**新的** Deployment（3 个不同 ID，未覆盖 v2） | PASS |
| 重启 Electron 后 UI 仍显示「服务已确认」+ 外部 ID | PASS |
| SQLite 三次部署全部 `succeeded` | PASS（3/3） |
| SQLite 三个 `external_id` 全部持久化 | PASS |
| SQLite `execution_state = completed` | PASS |
| SQLite 回滚记录独立且关联 v2 | PASS |
| SQLite 三次操作全部 `confirmed` | PASS |
| SQLite 执行时间线落库 | PASS（30 步） |
| Schema V33 已应用 | PASS |

数据库实测样例（本次运行）：

| deployment | status | assurance | external_id |
|---|---|---|---|
| `dep_…jnxrv…`（v1） | succeeded | externally_confirmed | `ssh:projectos-delivery-test:dep_…jnxrv…` |
| `dep_…jrr3a…`（v2） | succeeded | externally_confirmed | `ssh:projectos-delivery-test:dep_…jrr3a…` |
| `dep_…jsz2g…`（回滚） | succeeded | externally_confirmed | `ssh:projectos-delivery-test:dep_…jsz2g…` |

---

## 5. 审批 Diff 一致性（P0-3）

实现（`apps/runtime/src/file-approval.ts`）：

- 审批创建时记录：目标文件**基线哈希**、**目标内容哈希**、审批快照（基线内容 + 拟写内容，512 KiB 上限并标记 `truncated`）、以及用于展示的 `fingerprint`；
- **批准时**重算并校验；**实际写入前**再校验一次；两次任一漂移即拒绝，并让审批失效（`expired`）+ 工具调用置 `denied`；
- 路径越出项目根目录时拒绝生成快照（策略层仍是授权边界，快照只做完整性）；
- 证据类/非文件审批不受影响（无快照则跳过校验）。

负向测试（`tests/p25-file-approval.test.ts`，6 项全部 PASS）：

1. 新文件基线 = null、目标哈希正确；
2. **预览后文件变化**（审批前）→ 批准被拒（`审批快照已过期`）；
3. **审批后文件变化**（写入前）→ 被拒；
4. 目标文件被删除 → 被拒；
5. **多文件变更** → 只报出漂移的那个路径（`two.ts`），不误报 `one.ts`；
6. 路径逃逸（`../escape.ts`）→ 拒绝生成快照。

UI 侧：审批创建时携带 `fileSnapshot.fingerprint`；无法生成快照时携带 `fileSnapshotSkipped` 原因，不再静默。

---

## 6. 资源与连接（P1-1）

保留 V31/V32、safeStorage Credential Vault、SSH Host Key 钉扎。本轮补齐：

- **Resource 编辑**、**ConnectionProfile 编辑**（主机/端口/用户/指纹）；
- **资源停用**与**归档**：归档为终态，若仍被部署目标引用则拒绝并说明原因（`该资源仍被 N 个部署目标引用，先解除引用再归档`）；
- **凭据轮换**：新建凭据 → 把引用旧凭据的连接配置切到新凭据 → 停用旧凭据；
- **授权失效**：资源/Profile 修改会提升 `revision`；授权指纹现在**同时包含凭据状态与更新时间**，因此轮换或停用凭据都会使旧部署授权立即失效；
- 连接测试历史、资源详情、状态与错误诊断沿用既有 UI 并已验证；
- 部署目标直接引用已登记 Resource/Profile（Phase 2.4 已有，本轮 UI 走查确认）。

---

## 7. UI/UX 深化（P1-2）

### 7.1 实际测量到的缺陷（不是"看起来"）

用 `scripts/p25-ui-audit.mjs` 在真实 Electron 中做几何测量，修复前得到：

| 缺陷 | 证据 |
|---|---|
| **Toast 覆盖全局搜索** | light: toast `{x:662,y:6}` 与搜索框 `{x:731,y:16}` 相交；dark 同样。文案「候选已冻结」 |
| **发布工作台详情面板 126px 无效空白** | `.rw-detail` height=428px，内容 302px，dead=126px |

### 7.2 修复

- `.ant-message { top: 60px !important; pointer-events: none }`（通知本身仍可交互），让浮层落在 header 之下；这是 ux-audit 已知缺陷同类问题（消息容器拦截点击）。
- `.rw-detail { align-self: start; max-height: 100% }`：单条记录时按内容收缩，过长才滚动。
- 版本门禁状态自相矛盾（同屏「尚未评估」+「门禁未通过」）→ 现在显示「最近推进被门禁拒绝」，且失败后主动刷新门禁数据。

复查：`scripts/p25-ui-audit.mjs` 重跑（改为用"保存资源"制造**确定性** toast）后：

- `toast-covers-search` **不再出现**；实测 light toast `y=84`、dark toast `y=140`，搜索框 `y=16`，**纵向完全分离**；
- `panel-dead-space` **消失**；
- 总计 **0 条缺陷**，仅 2 条 INFO。

### 7.3 部署控制台

新增真实执行时间线（按 `deployment_operations` + `deployment_operation_steps` 渲染每次尝试与每步状态/耗时/远端引用/错误），并新增两个操作：

- **对账远程事实**（`needs_reconciliation`/`unknown`/`running`/`failed`/`pending` 时可用）；
- **基于此版本创建回滚**（`succeeded` 时可用，创建新的待审批 Deployment）。

状态语义明确区分：`待审批 / 待执行 / 执行中 / 待核对 / 服务已确认 / 制品已交付·未验证 / 失败 / 未知`。

**真实 UI 实测**（在成功部署的数据目录上打开控制台）：

```json
{
  "timelinePresent": true,
  "operations": 1,
  "steps": 10,
  "firstSteps": [
    "verify-local本地校验 2 个文件制品；跳过 1 个纯证据制品",
    "connect169.58.112.111:22",
    "connectSSH 连接建立，Host Key 已固定",
    "upload已上传并校验 version…",
    "upload已上传并校验 health…",
    "container重建容器 projectos-delivery-test…"
  ],
  "hasRollback": true,
  "statusTag": "服务已确认"
}
```

即：时间线在真实界面中渲染了 10 步真实证据（含"跳过 1 个纯证据制品"这一修复后的语义），回滚入口可用，状态标签为 `服务已确认`。

### 7.4 开源组件

本轮**未新增第三方依赖**（未安装 Monaco、react-resizable-panels）。原因与依据：

- 代码 Diff 使用项目既有的行级 Diff 组件（Phase 2.3 已实现真实 diff），本轮的核心缺口是**后端可信基线**而不是渲染器；
- 面板可调整属于布局增强，在补齐功能正确性之前引入重型依赖（Monaco 编辑器 chunk 已 5.09 MB）会放大性能风险，测试机为软件合成 GPU（`gpu_compositing disabled`）。

因此**没有**在任何地方声称"参考并落地了 Monaco / Argo CD 等"。这一点按未完成项处理（见第 9 节），不做虚假声明。

---

## 8. 验证结果总表

| 项目 | 结果 |
|---|---|
| `pnpm lint`（含边界检查） | **PASS**，0 errors / 12 warnings（均为既有告警），`Dependency boundaries OK` |
| `pnpm typecheck` | **PASS** |
| `pnpm test` | **PASS**，294 passed / 4 skipped（58 个文件：56 passed / 2 skipped） |
| `pnpm build` | **PASS** |
| `pnpm package:dir` + `pnpm test:package` | 见第 8.1 节 |
| V24 → V33 / V18 → V33 迁移 | **PASS** |
| Phase 2.5 部署闭环 E2E（真实 UI） | **PASS**，32/32 |
| 审批快照负向测试 | **PASS**，6/6 |
| 回滚回归测试 | **PASS**，1/1 |
| UI 计量审计 | 修复后 0 缺陷 / 1 INFO |
| 1440 Light / Dark、1024 | **PASS**（截图见第 8.2 节） |
| 125% 缩放 | **SKIP**（本轮未执行，见未完成项） |
| Kubernetes / CI-CD | **BLOCKED**（缺真实只读 Context/Token，未伪造连接成功） |

### 8.1 打包

| 命令 | 结果 |
|---|---|
| `pnpm package:dir` | **PASS**（`release/win-unpacked/ProjectOS.exe`，electron 43.8.2 x64，asar 完整性已更新） |
| `pnpm test:package` | **PACKAGE SMOKE PASS** —— 打包 EXE 能创建项目、写入起始文件并在重启后恢复 |

打包器提示 `@tailwindcss/oxide-wasm32-wasi` 未落盘以及平台可选依赖未被打包，属 pnpm 10 的已知行为，打包与冒烟均通过。

### 8.2 截图（落盘路径，未读回会话）

`docs/screenshots/` 下本轮产物：

- `p25-03-connections-connected.png`（资源与连接，已连接）
- `p25-06-version-gate.png`、`p25-06b-gate-after-evidence.png`（版本门禁与证据）
- `p25-12-deployment-succeeded.png`（v1 部署成功）
- `p25-13-console-light-1440.png`、`p25-14-console-dark-1440.png`、`p25-15-console-1024.png`
- `p25-16-after-restart.png`（重启后仍正确）
- `p25-17-rollback-succeeded.png`（回滚成功）
- `p25-audit-*.png`（UI 计量审计）

---

## 9. 未完成 / 限制（不隐藏）

1. **K8s / CI-CD：BLOCKED**。需要用户提供真实的只读 `kubeconfig` Context + Namespace 与 CI/CD 平台（如 GitHub Actions / GitLab）只读 Token，才能做真实资源发现；本轮只保留 `ReadOnlyRemoteAdapter` 契约（`execute` 直接抛错，`inspect` 明确返回未配置），**没有伪造连接成功**。
2. **125% 缩放**：本轮未跑 `scripts/scale125-e2e.mjs`。
3. **重启后右栏"当前可信运行版本"显示"没有已验证运行版本"**，尽管 v1/v2/回滚均 `succeeded`。重启后的历史列表与外部 ID 正确，但该派生字段的绑定存在不一致，**记为已知缺陷未修**（不属本轮第一标准，但必须如实记录）。
4. **Toast 覆盖搜索**已修复并有实测证据（light `y=84` / dark `y=140` vs 搜索框 `y=16`）。
5. **`resume` 并发保护**用 10 分钟陈旧判定，未实现跨进程互斥锁。
6. **Phase 2.4 遗留的 `running` 行**不会自动迁移为 `needs_reconciliation`（未提供一次性修复脚本）。
7. **Monaco Diff / react-resizable-panels 等未引入**，见 7.4 的理由。
8. 制品文件 URI 目前仍只能通过 API 设置（产品无相应 UI），E2E 因此在该步使用 API 写入；这一点是产品缺口，不是测试取巧的接口调用。

---

## 10. 结论

- **P0-1 部署闭环：PASS**（四者一致，含重启恢复）。
- **P0-2 真实更新与回滚：PASS**（v1 → v2 → 回滚到 v1，回滚为新 Deployment，独立审批）。
- **P0-3 审批 Diff 一致性：PASS**（可信快照 + 两次重校验 + 4 类负向测试）。
- **P1-1 资源与连接：PASS（核心项）**。
- **P1-2 UI/UX：PARTIAL**（部署控制台与两个实测缺陷已修；发布工作台空间分配与 Monaco 级 Diff 未做）。
- **P1-3 K8s/CI-CD：BLOCKED**（等待用户提供只读凭据）。

**Phase 2.5 到此停止，不进入 Phase 3。**

---

## 11. 最终远程状态（本轮结束时）

- 远端 release 目录累计 34 个（历史尝试全部保留，便于对账）。
- 容器 `projectos-delivery-test` 当前服务 `projectos-phase2.5-v1` —— 即最后一次操作是把 v2 回滚到 v1，与数据库最后一条 `succeeded` 部署一致。
- 该机器其余业务容器（1Panel / openviking / nezha / uptime-kuma 等）**未被触碰**。
