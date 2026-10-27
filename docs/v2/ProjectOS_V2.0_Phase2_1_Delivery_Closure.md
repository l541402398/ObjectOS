# ProjectOS V2.0 — Phase 2.1 交付能力收口与导航重构报告

**日期**：2026-10-27  
**分支**：`v2.0-phase2`  
**Phase 2 基线**：`3b10125`（Phase 2 最终报告）  
**代码提交**：`939dac7`（本轮导航/交付工作区收口；见 Git log）  
**工作树**：`C:\Users\Administrator\Desktop\workplace\ProjectOS-v2-phase2`  
**结论**：**导航与发布/部署工作区收口 PASS；真实外部部署链 BLOCKED（无连接资料与生产写授权），未伪造部署成功。**

---

## 1. Git 与保护

| 项目 | 实际值 |
|---|---|
| 起始 HEAD | `3b10125` |
| 本轮代码提交 | `939dac7` |
| 最终报告提交 | 本文件提交后的 HEAD |
| 基线功能 | AgentRunner/Scheduler/PlanGrant/Approval/Gate/Artifact/Worktree 保留 |
| 数据库 | V28/V29 保留；未修改已发布迁移 |
| 视觉基线 | 0686c41 Premium Liquid Glass tokens 保留 |
| 外部操作 | 未连接/修改生产服务器 |

---

## 2. 侧栏导航重构

### 结构

- 研发：研发工作中心、任务与验收、Agent 协作、审批、运行审计。
- 交付：发布中心、部署中心。
- 项目：项目姿态、版本与迭代、知识与成果、项目设置。
- 全局：项目中心、设置。
- 运维：仅预留导航配置，标记 `Phase 3`，禁用；没有空页面、没有假监控。

### 交互

- 分组标题可点击展开/收起；chevron 状态可见。
- 当前路由所属分组自动展开。
- 用户展开状态持久化到 `localStorage` 键 `projectos.sidebar.expandedGroups`；刷新/重启恢复。
- 手动折叠当前分组在路由变化前保持；切换到该组的另一路由时重新自动展开。
- 窄屏侧栏折叠为图标，保留 Tooltip 与可访问名称。
- 仅 `.po-sidenav-scroll` 滚动；底部设置/Runtime 状态固定。
- Badge、命令面板、旧路由与深链接保留。

### 真实 E2E

```text
[phase2-ui] accordion nav expand/collapse/persistence PASS
```

验证了展开、收起、展开后 reload 恢复。

---

## 3. 版本与迭代收敛

- 移除页面底部完整发布/部署容器。
- 新增紧凑「发布与部署摘要」：
  - 最新 Release（未发布/已登记）。
  - 已确认环境数与来源可信度。
  - 待处理审批。
  - 候选/Release 数。
  - 「进入发布中心」「查看部署历史」，携带 `?version=`。
- 版本页保留版本、阶段、迭代、任务/计划、Gate；不再塞入完整交付工作区。
- 原底部空白与 Grid 拉伸问题消除；页面 DOM 不再渲染完整候选/部署列表。

---

## 4. 发布中心

独立路由 `/projects/:projectId/releases?version=`，复用现有 `ReleaseService`：

- 变更申请 / 候选 / Release 证据链。
- 提交审批、审批状态、候选冻结、Release 登记。
- 版本筛选下拉。
- 候选状态准确：
  - `ready` → **可冻结**；
  - `released` → **已生成 Release**。
- Release 状态：
  - **已登记 · 未外部分发**；
  - 有外部回执才可能 `externally_confirmed`。
- 同一动作只有一个主 CTA；批准/拒绝从发布中心移除，统一到审批中心。

---

## 5. 部署中心

独立路由 `/projects/:projectId/deployments?version=`：

- 环境事实卡（仅 `source_observed` 以上才显示已确认版本）。
- Release 选择登记。
- 环境与目标、部署策略。
- 部署历史、来源、assurance、外部 ID。
- 手工部署显示 **已登记 · 未核实**，明确“仅用户声明，不计入环境当前版本”。
- 未配置 Adapter 显示“未配置部署适配器”，没有执行按钮。
- 目标/策略可登记；控制方式与 Adapter 能力分开。
- 支持未知来源进入 `needs_reconciliation`；回滚是新 Deployment。

---

## 6. 统一审批中心

- 审批中心新增「交付审批」区，读取 `release.approvals`。
- 展示 subject title、revision、内容指纹前缀。
- 批准/拒绝调用 `release.approval.decide`，保留 fingerprint/revision 校验。
- Release/Deployment 页不再重复提供批准按钮。
- 真实 E2E 在审批中心完成发布变更批准后返回发布中心继续候选/Release。

---

## 7. 真实 Electron E2E

`scripts/phase2-ui-e2e.mjs` 实际点击：

1. 分组导航展开/收起/reload 恢复；
2. 版本页记录证据、推进 Gate；
3. 版本摘要入口；
4. 发布中心新建变更、提交；
5. 审批中心查看并批准交付审批；
6. 发布中心生成候选、登记 Release；
7. 部署中心选择 Release、登记部署；
8. 审批中心批准部署；
9. 部署中心登记结果，显示 `已登记 · 未核实`/`self_declared`。

结果：

```text
accordion nav expand/collapse/persistence PASS
version evidence/gate PASS
change request approved PASS
release recorded PASS
manual deployment recorded with self_declared provenance PASS
PHASE 2 UI E2E PASS
```

### 截图

- `1440x900-light-release-center.png` / dark
- `1440x900-light-deployment-center.png` / dark
- `1440x900-light-approval-center-delivery.png`
- `1024x768-light-release-center.png` / dark
- `1024x768-light-deployment-center.png` / dark
- `1440x900-125-actual-light-release-center.png` / dark
- `1440x900-125-actual-light-deployment-center.png` / dark
- `1440x900-light-versions.png`（摘要 + 折叠 nav）

125% 实际 DPR=1.25，`innerWidth=1442`、`scrollWidth=1442`，无裁切。

---

## 8. Adapter 与真实部署链

### 已核对

- 仓库仅找到 `.github/workflows/linux-build.yml`：构建/打包 AppImage，并上传 artifact；**不是部署流水线**。
- 未发现 Helm/Kustomize、Argo CD/Flux、Tekton、Jenkinsfile 或生产 K8s/SSH 部署配置。
- 无外部连接凭据，无生产写授权。

### 结论

- Pipeline / Kubernetes / GitOps / SSH 真实 Deployment Adapter：**未实现，BLOCKED**。
- 不生成空壳 Adapter，不伪造外部执行。
- 当前仅支持手工/导入部署事实、来源可信度、审批、环境状态推导和回滚关联。
- 首次外部写操作前必须获得用户对目标、Namespace/目录、命令、影响与回滚方案的单独确认。

---

## 9. 验证结果

| 项目 | 结果 |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS，0 errors（存在既有/新增 warnings） |
| `pnpm test` | **52 files passed / 1 skipped；285 tests passed / 3 skipped** |
| `pnpm build` | PASS |
| `pnpm package:dir` | PASS |
| `pnpm test:package` | **PACKAGE SMOKE PASS** |
| 导航 accordion E2E | PASS |
| 发布/审批/部署 Electron E2E | PASS |
| 1024 / 1440 / DPR 1.25 | PASS |
| 真实 CI/CD / K8s / SSH 交付 | **BLOCKED** |

---

## 10. 明确限制与 Backlog

1. 无真实 Adapter/外部执行；部署中心只记录事实，不执行远程部署。
2. 没有构建系统；`canBuild=false`。
3. 交付审批数据与 ToolCall 审批仍在同一审批中心页面但来自两个数据表；视觉入口已统一，数据层后续可合并。
4. 发布/部署详情仍以卡片+证据链为主，尚未做独立 Inspector 路由；当前信息量下可用。
5. 未实现健康检查、持续日志、远程回滚与对账。
6. Phase 3 运维组只预留禁用入口，没有服务拓扑/监控/Incident 页面。

---

## 11. Phase 3 起点

Phase 3 应基于真实 K8s/容器/Service/Observability 数据独立建立运维一级菜单，优先评估 AntV G6/Cytoscape 等专业拓扑引擎；现有研发 DAG 保持既有图形实现。必须先获得外部只读连接与测试 Namespace/VPS 授权，再讨论写入与自动运维。

---

## 12. 判定

| 项目 | 判定 |
|---|---|
| 侧栏分组折叠/持久化/自动展开 | PASS |
| 版本页收敛 | PASS |
| 发布中心 | PASS |
| 部署中心 | PASS（记录/来源层） |
| 统一审批中心联动 | PASS |
| 状态语义（候选/Release/手工部署） | PASS |
| 真实外部交付链 | BLOCKED |
| Phase 2.1 整体 | **Conditional PASS** |

**本轮停止，等待验收。不进入 Phase 3/4，不连接或修改真实生产环境。**
