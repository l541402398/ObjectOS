# ProjectOS V2.0 — Phase 2.3 商业级工作台与真实交付闭环报告

**日期**：2026-10-27  
**分支**：`v2.0-phase2.3`  
**基线**：`88648c4`（Phase 2.2 final）  
**实现提交**：`acc9196`  
**报告提交**：本文件提交后的 HEAD  
**结论**：**三页信息架构完成结构性重构；本地文件交付语义已纠偏；SSH/VPS Adapter 真实远程能力保留并通过隔离直连测试。新部署控制台的 SSH Electron 执行闭环尚未完成，K8s/GitOps/Pipeline 仍 BLOCKED。**

---

## 1. Git / 数据边界

| 项目 | 值 |
|---|---|
| 起始 HEAD | `88648c4` |
| 实现提交 | `acc9196` |
| 数据库 | V28/V29 保留；新增 **V30** 兼容修正 |
| V30 | 将 Phase 2.2 的 `local-*` 文件交付记录从 `independently_reproduced` 修正为 `self_declared`，health=false，不再计入环境当前版本 |
| 生产服务 | 未修改 |
| 凭据 | 仍在仓库外安全文件，不进 SQLite/Git/日志 |

---

## 2. 页面重构：删除与替换

### 删除

- 发布中心旧 `ReleasePanel` 三栏等权 `SectionCard` 布局。
- 旧 `PageHeader + 大卡片 + 标签行 + 底部重复历史` 的组合。
- 部署中心旧「部署工作区」Tab + 黑色 Badge 行 + 统计卡。
- 审批中心两张巨型审批卡纵向堆叠。

### 新结构

| 页面 | 构图 | 承载元素 |
|---|---|---|
| 发布中心 | 顶部上下文/指标 + 水平发布轨迹 + 左列表 + 中央详情 + 右 Inspector | 行列表、状态轨迹、哈希表、就绪检查 |
| 部署中心 | 顶部环境/目标 + 左目标导航 + 中央执行轨迹 + 右目标 Inspector | 目标行、步骤轨迹、证据块、历史行 |
| 审批中心 | 左待审队列 + 中审阅详情 + 右决策栏 | 队列行、快照网格、风险/备注/动作 |

### 设计参考映射

| 参考 | 许可证 | 采用的具体模式 | 本项目落点 |
|---|---|---|---|
| Argo CD UI | Apache-2.0 | 资源列表 + 选中详情 + 状态轨迹；不复制源码 | `ReleaseWorkbench` / `DeploymentConsole` 列表与 Inspector |
| GitLab Deployments / Environments | MIT (CE) | 环境/部署历史行、状态与时间；不复制源码 | `DeploymentConsole` 目标导航与历史行 |
| Linear | 专有产品，仅研究交互模式 | 高密度队列 + 详情 + 属性侧栏 | `ApprovalsPage` Master–Detail |
| shadcn/ui、Radix | MIT | 未新增依赖，仅沿用现有 Ant Design + tokens | 无代码复制 |

未新增第三方依赖，无许可证引入。

---

## 3. LocalArtifact 语义纠偏

此前：

- 复制文件、写 `health.json`；
- 返回 `independently_reproduced`；
- 环境当前版本会被错误更新。

现在：

- 只复制制品、校验 SHA-256、写 `delivery-receipt.json`；
- `assurance = self_declared`；
- `health.ok = false`，`serviceHealthVerified = false`；
- 不再写 `health.json`；
- 环境当前运行版本投影不采信该记录；
- UI 显示「制品已交付 · 未验证」，而不是绿色部署成功。

V30 修正历史 Phase 2.2 `local-*` 记录。新增负向断言：

- `currentEnvironmentVersion(...).releaseId` 为 null；
- receipt health 为 false；
- 手工/文件交付不能成为环境当前版本。

---

## 4. SSH/VPS Adapter

保留并验证：

- `/opt/projectos-delivery-test` 隔离目录；
- scp 上传 + 远端 SHA-256；
- 重建 `projectos-delivery-test` 容器；
- 仅绑定 `127.0.0.1:18080`；
- `/health` 返回 `ok`；
- `externally_confirmed` + 外部 ID `ssh:projectos-delivery-test:...`。

真实 Contabo 验证：

```text
容器 Up
/health -> ok
远端 index.html SHA-256:
1ccc12a34bcedb46c21256e39e2e5d1021972207b5c07274ab2cb6f764ab669e
```

`tests/ssh-adapter-e2e.test.ts`（opt-in）本轮再次 PASS。

---

## 5. 真实 Electron E2E

本地隔离链路（默认）：

```text
版本证据/门禁
→ 发布工作台：变更 → 审批 → 候选 → Release
→ 部署控制台：登记部署 → 审批 → 执行本地文件交付
→ 制品交付 + 哈希校验；服务健康明确未验证
PHASE 2 UI E2E PASS
```

但**新部署控制台的 SSH 远程 Electron 执行未闭环**：

- 真实 SSH Adapter 直连测试 PASS；
- 新控制台点击「执行部署」后记录停在待执行，未产生外部 ID；
- 未定位为 Adapter 还是 UI 触发/刷新的问题；
- 该项标记 **FAIL/BLOCKED**，不以 2.2 旧页面结果替代 2.3 验收。

---

## 6. 验证结果

| 项目 | 结果 |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS，0 errors / 12 warnings |
| `pnpm test` | **286 passed / 4 skipped** |
| `pnpm build` | PASS |
| `pnpm package:dir` | PASS |
| `pnpm test:package` | PASS |
| V24/V18 → V30 | PASS |
| Local 语义负向测试 | PASS |
| 本地 Electron E2E | PASS |
| 真实 SSH Adapter 直连 | PASS |
| 新控制台 SSH Electron E2E | **FAIL/BLOCKED** |
| 1024 / 1440 / DPR 1.25 | 截图 PASS，无水平溢出 |
| 100 条列表压力 | **NOT RUN** |
| 审批真实 Diff | **NOT IMPLEMENTED** |
| K8s / GitOps / Pipeline | **BLOCKED** |

---

## 7. 明确未完成

1. 新部署控制台 SSH 执行未闭环（最高优先级回归）。
2. 审批中心工具写入仍无真实 Diff；只显示摘要并明确标注未接入。
3. 1/10/100 条列表密度压力测试未执行。
4. SSH 回滚、更新内容差异断言、断线对账未完成。
5. K8s/GitOps/Pipeline Adapter 无连接。
6. 1024 下发布 Inspector 隐藏，仅保留列表+详情；审批决策栏下移。

---

## 8. 截图

- `docs/screenshots/1440x900-light-release-center.png` / dark
- `docs/screenshots/1440x900-light-deployment-center.png` / dark
- `docs/screenshots/1440x900-light-approval-center-delivery.png`
- `1024x768-*-release-center.png`
- `1024x768-*-deployment-center.png`
- `1024x768-*-approval-center.png`
- `1440x900-125-actual-*-*.png`

---

## 9. Phase 3

不启动运维蜂窝/拓扑；需真实 K8s/Service/Observability 数据后建立。现有研发 DAG 保持原图形实现。

**本轮停止，等待验收。**
