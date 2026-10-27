# ProjectOS V2.0 — Phase 2 多部署模式统一交付平台工程实施

> **用途**：完整、独立、可直接交给开发 AI 执行的工程提示词。无需与此前的 SSH 方案、CI/CD 补充方案拼接。
>
> **核心原则**：多部署方式并存；统一发布、部署、审批、证据与历史；优先适配用户实际 Kubernetes / CI/CD 体系，同时保留独立 SSH / VPS 部署能力。

## 1. 任务定位

你现在担任 ProjectOS 首席软件架构师、全栈工程师、DevOps 架构师、Kubernetes 工程师、Agent 平台工程师、UI/UX 负责人和测试负责人。

**正式启动 ProjectOS V2.0 Phase 2：发布、交付与多部署模式管理。**

本指令是独立完整的工程实施任务，覆盖架构适配、数据库、业务 API、部署适配器、Electron UI、真实环境测试和最终验收。

**必须实际修改代码并交付可运行功能，不得再次只输出设计文档。**

### 1.1 最终产品定位

ProjectOS 是本地优先、AI 原生的项目全生命周期管理与自主运营平台。

最终应覆盖：

- 项目立项、需求、规划和架构；
- 多产品、多版本、多迭代并行研发；
- AI 多 Agent 自主开发、测试和验收；
- 构建、制品、发布与交付；
- 多环境、多部署方式管理；
- Kubernetes、CI/CD、GitOps、VPS 等执行方式；
- 服务运行状态、监控与告警；
- 故障响应、缺陷修复与回滚；
- 持续运维、自主优化、知识沉淀与项目退役。

Phase 1.1 已实现 AI 研发主工作流。Phase 2 的目标是让 ProjectOS 从研发成果进一步延伸到真实发布、交付及部署。

### 1.2 本轮核心决策

**不同部署方式允许并存，不以 Kubernetes、SSH、CI/CD 中的任意一种作为唯一部署模式。**

必须建立统一 Deployment 业务模型和可扩展 Deployment Adapter 机制，支持以下适配器类别：

1. CI/CD Pipeline Adapter；
2. Kubernetes Direct Adapter；
3. GitOps Adapter；
4. SSH / VPS Adapter。

本轮优先把统一框架和实际环境需要的适配器开发完成。不要求一次性完整实现所有 CI/CD 产品及所有部署工具，但架构必须支持后续独立注册和扩展。

**禁止为不同部署方式分别建立相互独立的 Release、Deployment、Approval 和历史记录系统。**

---

## 2. 当前环境与工程基线

### 2.1 已知工程基线

- 代码仓库：ObjectOS；产品名称：ProjectOS。
- 已知 Phase 1.1 最终提交：`a06263d`。
- 已知分支：`v2.0-phase1.1`。
- 当前已实现：Project / ProductVersion / Iteration / Environment、Requirement / Task / PlanRevision、Planner / Replanner、OrchestrationScheduler / AgentRunner、AgentDefinition / Handoff / Inbox、PlanGrant / Policy / Approval、ToolCall / Artifact / Evidence、GateEvaluation、Git Worktree 与交付、Electron 研发工作中心、SQLite V27。

先审查仓库最新实际 HEAD、Git 状态、数据库 Schema、已批准的 V2.0 总体架构及工作区状态。历史提交只是已知基线，不代表仓库现状永远停留于此。

建立独立 Phase 2 分支和 Worktree，保护其他开发现场。不得未经用户批准 reset、clean、删除分支、force-push 或覆盖其他 Worktree / 未提交内容。

保留已认可的 `0686c41` Premium Liquid Glass 视觉基线，以及 Phase 0 / Phase 1 / Phase 1.1 的安全边界与业务成果。不得重复开发一套 Agent Runtime、Planner、Scheduler、Agent Registry 或审批体系。

### 2.2 已知基础设施

用户当前拥有：

- 使用 Kubernetes 的现有生产部署体系；
- Contabo VPS；
- 香港 VPS。

**Kubernetes 不是 CI/CD 流水线引擎。**不能仅凭用户提到 K8s，就认定正在使用 Jenkins、GitLab CI、Tekton、Argo CD 或 Flux。

必须先只读检查用户明确授权访问的配置、仓库文件和集群信息，识别：

- Git 服务和代码托管方式；
- CI 构建系统以及触发方式；
- 现有 Pipeline / Workflow / Job；
- 是否使用 Helm、Kustomize；
- 是否存在 Argo CD / Flux 等 GitOps 控制器；
- 是否使用 Tekton / Argo Workflows；
- 是否直接通过 Kubernetes API、kubectl 或 Helm 发布；
- 镜像与制品 Registry；
- Deployment 的实际控制权；
- 现有审批、环境保护、健康验证与回滚方式。

不得假设两台 VPS 是 Kubernetes 节点，也不得假设它们是独立服务器；以实际只读调查结果为准。

如果需要连接资料、凭据或具体写操作授权，向用户请求；其他不依赖连接的开发工作继续推进。

---

## 3. Phase 2 总体架构

### 3.1 统一交付体系

总体分层：

```text
ProjectOS Experience
    ↓
Release Management
    ↓
Deployment Orchestrator
    ↓
Deployment Adapter Registry
    ↓
External Execution Systems
    ↓
Deployment Evidence / Reconciliation
```

**Release Management**：统一管理 ChangeRequest、ReleaseCandidate、Release、Artifact、GateEvaluation、Approval、发布历史。

**Deployment Orchestrator**：统一负责部署策略与目标选择、授权校验、Deployment 创建、幂等、并发互斥、适配器调度、执行状态、日志和回执、回滚与断线对账。

**Deployment Adapter Registry**：管理适配器类型、连接、能力声明和执行接口；Adapter 不得自己维护第二套业务真相。

**External Execution Systems**：实际执行者可以是 Jenkins / GitLab CI / GitHub Actions / Tekton、Kubernetes API / Helm、Argo CD / Flux、SSH + Docker / Compose / systemd。ProjectOS 不重复实现它们内部成熟的流水线与编排能力。

### 3.2 建议的适配器契约

以下只是统一语义的目标抽象，必须结合当前仓库的实际服务与类型系统落地，不要机械复制成第二套基础设施。

```ts
interface DeploymentAdapter {
  readonly type: string;
  readonly capabilities: DeploymentCapabilities;

  probe(target: DeploymentTarget): Promise<ProbeResult>;
  inspect(target: DeploymentTarget): Promise<ObservedState>;
  validate(request: DeploymentRequest): Promise<ValidationResult>;
  prepare(request: DeploymentRequest): Promise<PreparationResult>;
  execute(request: AuthorizedDeploymentRequest): Promise<ExecutionHandle>;
  observe(operation: ExecutionHandle): Promise<DeploymentObservation>;
  reconcile(operation: ExecutionHandle): Promise<ReconciliationResult>;
  rollback?(request: AuthorizedRollbackRequest): Promise<ExecutionHandle>;
  cancel?(operation: ExecutionHandle): Promise<CancelResult>;
}
```

能力声明至少包括：目标类型、构建能力、触发部署、只读观察、日志、健康验证、回滚、取消、对账、外部主动触发记录同步。

不得把所有适配器强制实现为相同的 Shell 命令包装；只读 Adapter 不应假装具备执行或回滚能力。

### 3.3 多部署方式并存原则

一个 Project 可以关联多个 Environment、DeploymentTarget、AdapterConnection、DeploymentStrategy。不同版本可面向不同环境和目标交付。

示例：

- 项目 A：Jenkins 构建、Argo CD 部署 K8s staging/production、SSH 部署独立测试 VPS；
- 项目 B：GitHub Actions 构建、Docker Compose 部署 VPS；
- 项目 C：GitLab CI 完成构建及部署，实际运行于 Kubernetes。

**CI 构建方式、CD 部署方式、最终运行目标是三个不同维度**，不得合并成单个简单的 `deploymentType` 枚举。

### 3.4 部署控制权

每个 DeploymentTarget 必须明确控制方式，例如：

- `pipeline_managed`
- `gitops_managed`
- `direct_kubernetes`
- `ssh_managed`
- `external_observed`

同一目标、同一应用实例不能被两个相互冲突的控制器同时主动修改。

- Argo CD 管理的资源不应被 ProjectOS Kubernetes Direct Adapter 随意 patch；
- GitOps 应通过期望状态 Git 变更和同步/观察流程更新；
- Jenkins/GitLab 流水线负责的目标，应优先走现有 Pipeline，而不是绕过 Pipeline 直接 kubectl；
- SSH 只能操作批准的独立目录、服务、容器与端口。

控制权转换必须有明确迁移流程和审批，不能通过切换 UI 下拉框就获得另一种模式的写权限。

---

## 4. Phase 2A：领域模型与数据库迁移

### 4.1 迁移顺序

遵循此前已确定的 V2.0 迁移规划，并核对实际仓库：

- **V28：ChangeRequest 与 Approval 泛化。**
- **V29：Release / Deployment / ArtifactLink 相关领域。**

在 V29 或经兼容性核准的后续单调递增迁移中落实必要结构：ReleaseCandidate、Release、ReleaseArtifact、Deployment、DeploymentEvent、DeploymentTarget、DeploymentStrategy、AdapterConnection 元数据、PipelineExecution 关联、ArtifactLink、DeploymentReceipt 和 RollbackRecord。

物理表可以在保持领域边界及既有契约的情况下合理拆分或合并。如果当前仓库已经发布 V28 或 V29，不得修改其已发布 SQL 或校验和；使用新的整数版本追加迁移。

现有真实数据库如为 V27，迁移前必须完成 SQLite 一致性备份、恢复校验；测试 V24 / V27 旧项目安全升级、迁移幂等和外键完整性。

### 4.2 ChangeRequest

至少记录：所属项目与 ProductVersion、变更来源 Requirement / Task / Defect、影响范围、风险级别、Git revision、制品与环境、Evidence、审批快照/内容指纹、状态和历史事件。

复用既有 Approval / Policy / Audit，不建立第二套审批系统。关键内容（制品、目标环境、变更范围等）修改后，原审批必须失效，不可跨对象或跨目标复用。

### 4.3 ReleaseCandidate

从真实研发成果创建，至少绑定：Git commit、版本、关联 Plan/Task、测试与验收证据、GateEvaluation、Artifact 和哈希、ChangeRequest、发布说明与候选状态。

未构建、构建失败、证据不足可以保留为候选状态，但不得冒充已经就绪或已发布的制品。

### 4.4 Release

Release 必须关联来源候选、不可变制品清单和哈希、Git revision、审批快照、质量证据、发布时间和发布事件。

已冻结 Release 不得原地替换制品；补丁修复产生新的 Release；Release 与 Deployment 是不同事实；本地记录发布不能冒充外部制品分发成功。

### 4.5 Deployment

必须记录 Release、Environment、Target、Strategy、Adapter、目标制品、幂等请求、授权、外部运行 ID、状态、日志、健康验证、回执、来源可信度、回滚关系及事件时间线。

状态语义至少区分 `pending`、`awaiting_approval`、`preparing`、`running`、`verifying`、`succeeded`、`failed`、`cancelled`、`unknown`、`needs_reconciliation`、`rolled_back`。可以遵循现有工程命名风格，但不得只用 `deployed=true` 表示部署真相。

### 4.6 PipelineExecution

关联 CI/CD 平台、Pipeline / Workflow / Job、外部 Run ID、Git commit、参数快照、执行阶段、Artifact / image digest、日志引用、Deployment 和外部回执。

同一次 Pipeline 可能包含构建、测试、推送、部署多个阶段，应区分各阶段状态。触发 API 成功不等于 Pipeline 成功；Pipeline 成功也不代表目标服务健康。

---

## 5. Phase 2B：CI/CD Pipeline Adapter

### 5.1 优先级

**优先接入用户现有实际使用的 CI/CD 系统。**只读识别后选择一个 Adapter 完整开发与验证。其他平台保留可扩展的契约与能力声明，不能制作仅有空壳的伪实现。

候选包括 Jenkins、GitLab CI/CD、GitHub Actions、Tekton 或用户现有其他平台。

### 5.2 首个适配器至少支持

1. 连接检测与身份/权限范围检查；
2. Pipeline 发现、选择和参数校验；
3. Git revision 和 Release 绑定；
4. Artifact / Image digest 关联；
5. 独立部署审批与有效授权校验；
6. 触发合法 Pipeline；
7. 获取外部运行 ID；
8. 查询阶段进度、日志和实际结果；
9. 读取制品或镜像信息；
10. 获取部署回执、目标健康状态；
11. 失败、取消和重试策略；
12. 中断后的状态对账；
13. 只读导入由外部主动触发的已有流水线运行。

### 5.3 不重复实现成熟流水线

如果现有系统已经负责构建、测试、镜像推送和部署，ProjectOS 只负责将经审批的 Release/参数提交给该流程、观察结果、验证制品与环境、保存证据和历史。

不得绕过 CI/CD 平台既有的环境保护、人工审批、RBAC 或发布规则。

对于只读凭据或无法触发的平台，可以先实现观察和同步；UI 必须准确显示“只读连接”，不能展示可执行的虚假部署按钮。

---

## 6. Phase 2C：Kubernetes 与 GitOps Adapter

### 6.1 只读发现

在授权的 K8s 集群中，只读检查 Cluster Context、K8s 版本、Namespaces、Deployments / StatefulSets、Service / Ingress、Helm、GitOps 控制器、Pipeline CRD、Registry、rollout 状态和 RBAC 权限。

不得读取或导出无关 Secret 内容；不得默认修改生产 Namespace、Deployment、Ingress、Service、ConfigMap 或其他资源。

### 6.2 Kubernetes Direct Adapter

按真实需求逐步支持：连接、Namespace/Workload 选择、Manifest/Helm 元信息、当前镜像与 digest、Pod Ready、rollout、事件与日志、健康检查、授权更新、历史与回滚、未知状态对账。

优先使用官方 API / 成熟客户端，不开发新的 Kubernetes 控制平面，不封装无限制 kubectl Shell。

写操作必须限定到经批准的 Namespace、资源、镜像和具体动作。

### 6.3 GitOps Adapter

如实际使用 Argo CD / Flux，优先让现有 GitOps 控制器继续作为部署执行者。ProjectOS 负责经审批的 Git 期望状态变更、revision 关联、同步/健康观察、漂移检测、真实回执、失败对账。

GitOps 管理资源不能由其他 Adapter 绕过期望状态直接修改。

回滚必须考虑自动同步：仅执行一次 `kubectl rollout undo` 不一定能保持回滚结果，优先通过已批准的 Git revision 恢复和重新同步完成回滚。

### 6.4 按现实选首条交付链

- Jenkins → K8s：优先 Jenkins Pipeline Adapter + K8s 只读观察。
- GitLab CI → K8s：优先 GitLab Pipeline Adapter + K8s 只读观察。
- Tekton → K8s：优先 Tekton Adapter。
- Argo CD → K8s：优先 GitOps Adapter。
- 直接 Helm / Kubernetes API：优先受控 Kubernetes Direct Adapter。

**首轮至少完整交付一条与实际环境相符的可运行链路，不为覆盖所有平台而同时生成多套半成品。**

---

## 7. Phase 2D：SSH / VPS Adapter

### 7.1 地位和用途

SSH 是可注册的正式部署适配器，与 Pipeline、K8s Direct、GitOps 平级，适用于单机 VPS、独立 Docker/Compose/systemd 服务及没有流水线的轻量项目。

**不能将 SSH 作为所有部署方式的隐藏底层实现。**

### 7.2 最小能力

实现 SSH 主机身份校验、连接与权限检查、远程只读调查、制品传输、SHA256 校验、独立版本目录、受控更新、服务健康检查、日志与回执、旧版本回滚和中断后对账。

不得建立无限制远程 Shell Agent；远程目录、服务、容器、端口和允许执行的命令受 DeploymentTarget 与授权策略约束。

### 7.3 两台 VPS

用户有 Contabo VPS 和香港 VPS，可用于明确授权的隔离部署测试。

先判断其角色：如果实际是 K8s 集群节点，应优先通过集群既有控制链操作应用，不要通过 SSH 私自改写受 Kubernetes 管理的工作负载；如果是独立 VPS，则可使用 SSH Adapter。

首次写操作前必须提交具体部署清单：目标、测试项目、目录、运行用户、容器/服务、端口、要改动的配置、对现有服务影响及回滚方案，并取得用户确认。

---

## 8. Phase 2E：Electron 产品体验

### 8.1 工作流与信息架构

发布/部署应是研发工作流的自然延伸：

```text
项目 → 版本 → 研发成果 → 发布候选 → 发布审批 → Release
    → 选择部署策略 → 执行/观察 → 健康验证 → 历史/回滚
```

不创建 CI/CD、Kubernetes、SSH 三套相互割裂的管理页面。

### 8.2 部署策略配置

一个项目可配置多条策略。每条策略关联 Project、Environment、DeploymentTarget、AdapterConnection、制品/镜像来源、构建策略、部署方式、验证、回滚和审批策略。

例如：

- 生产环境 / K8s / GitOps；
- 预发布 / K8s / Pipeline；
- Contabo / Docker Compose / SSH；
- 香港 VPS / systemd / SSH。

用户可以按环境和目标选择策略，不需要理解底层 Adapter 代码。

### 8.3 部署工作区

统一展示 Release、目标环境、执行平台、外部 Run ID、真实步骤、镜像 digest / Artifact hash、增量日志、健康检查、失败原因、历史版本、回滚和 needs_reconciliation。

适配器特有信息使用上下文 Inspector 呈现，不复制多套页面。不以静态日志冒充实时数据。

### 8.4 UI 风格与性能

严格延续 `0686c41` 已批准的 **Premium Liquid Glass / Apple-inspired Optical Workspace**：清爽的光学玻璃、柔和低饱和环境光、成熟布局、统一弹窗和 Inspector、良好文字对比度及自然动效。

支持 Light/Dark、1024/1440、实际 DPR 1.25。删除解释性文案，避免卡片堆叠、重复按钮、虚假状态和毛坯 CRUD。持续部署日志不能造成 Electron 主线程卡顿或高频全量轮询。

---

## 9. 部署授权与安全边界

### 9.1 独立部署授权

Phase 1 的研发 PlanGrant **不能自动授予部署权限**。每次实际部署要绑定 Release、Artifact hash/image digest、Environment、Target、Adapter、操作类型、独立审批、授权有效期和幂等键。

AI 可以建议发布、分析日志、提出回滚，但不能仅凭模型决定对生产环境执行写操作。

### 9.2 凭据处理

SSH 私钥/密码、kubeconfig Token、ServiceAccount Token、CI/CD Access Token、GitOps Token、Registry 密码和云平台密钥不进入模型提示词、普通 SQLite 明文字段、Git、日志或截图。优先使用系统安全凭据存储、最小权限与目标绑定，Renderer/Agent 不直接读取凭据原文。

### 9.3 多模式互斥与可观测事实

- 同一应用目标不能被 Pipeline、GitOps、K8s Direct、SSH 意外互相覆盖；
- 同一目标的冲突部署须串行或明确拒绝；
- 不同目标独立授权，审批不可跨环境复用；
- 外部触发成功不等于部署成功，部署成功还需目标状态/健康证据；
- 手工声明不等于 externally_confirmed；
- 未知结果进入 `unknown` / `needs_reconciliation`，不得盲目重放远程副作用；
- 回滚是新操作，不能通过修改旧 Deployment 历史冒充成功。

### 9.4 真实生产环境边界

用户允许将其服务器用于测试，但**没有对任意生产写操作给予无限制授权**。

先只读调查；首次修改集群、服务器或流水线前列明具体对象、命令类别、预期影响、风险、恢复方案，取得用户明确确认。

未经授权不得删除 Namespace/工作负载、修改生产 Ingress/全局 Nginx、重启其他服务、清理防火墙、重装 VPS、更改生产数据库、替换 Registry 凭据或进行破坏性资源清理。

---

## 10. 真实验收场景

### 10.1 场景 A：真实研发成果到发布

使用 Phase 1 的真实 Git commit、测试报告、Artifact 和 GateEvaluation，创建 ReleaseCandidate → ChangeRequest → 独立审批 → 不可变 Release，保存实际证据与审计。

### 10.2 场景 B：现有流水线

通过实际识别的 Pipeline Adapter，选择批准的版本与测试环境，触发或只读导入真实 Pipeline，读取 Run ID、阶段状态、日志、Artifact/digest、目标运行状态和 Deployment Receipt。

### 10.3 场景 C：Kubernetes / GitOps

在**用户明确批准的隔离测试 Namespace** 下，查询工作负载、发布合法版本、观察 rollout / Pod Ready、验证健康、实际回滚。若资源由 GitOps 管理，必须走 GitOps 控制链，不得强行直接 patch。

### 10.4 场景 D：SSH VPS

在授权的独立 VPS 测试服务上，上传真实构建产物、校验 SHA256、启动应用、检查 `/health`、部署新版本、真实回滚旧版本、确认原有业务不受影响。

### 10.5 场景 E：多模式并存

同一 Project 至少配置两种不同 DeploymentStrategy，例如 K8s staging 与 Contabo SSH staging。验证同一 Release 的多目标关联、独立授权/历史/证据和目标间故障隔离；如只有一种真实外部环境可用，另一种可以用本地隔离集成测试，但必须标明测试级别。

### 10.6 场景 F：故障与恢复

至少覆盖：Pipeline 触发后断线、K8s rollout 超时、GitOps 不同步、SSH 中断、用户取消、健康检查失败、审批过期、Artifact hash 不一致、同目标并发部署、Runtime 强杀重启后的真实对账。不得把未确认结果自动归类为成功或失败。

---

## 11. 工程实施顺序与质量验收

**阶段一：领域与迁移**。实施 V28/V29，完成 ChangeRequest、Release、Deployment、Target、Strategy、PipelineExecution、Artifact/Evidence 关联及兼容测试。

**阶段二：Adapter 框架**。实现统一能力、注册、授权、观察、执行状态、幂等、事件与对账；复用现有 Runtime 和 Policy。

**阶段三：真实环境首条交付链**。先只读调查现有 K8s 与 CI/CD 关系，选择实际使用的一个 Adapter 做到真实可执行、可观察、可回滚。

**阶段四：第二部署方式**。优先实现独立 SSH/VPS 适配器；若实际环境证明另一个模式更合适，优先价值最高的第二模式。两种模式共享领域、审批与审计。

**阶段五：正式 Electron UI**。完成版本、发布候选、审批、制品、部署策略、执行、健康、历史、回滚的真实 UI 连接。

**阶段六：真实环境验收**。针对授权的测试 K8s Namespace / 测试流水线 / VPS，完成真实部署、更新、健康验证、回滚及状态对账；需要远程连接或写操作批准时向用户请求，其余开发继续。

**阶段七：全面回归与交付**。必须按仓库实际情况执行：

- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`；
- `pnpm package:dir`、`pnpm test:package`；
- V24/V27 → V28/V29 迁移和备份恢复；
- Phase 1 Agent / Planner / Replanner / Grant / Handoff / Gate / Worktree / kill-restart 回归；
- Adapter 契约、幂等、并发互斥、未确认状态对账；
- Release 不可变、审批绑定、部署凭据保护测试；
- Electron 真实点击 E2E（不能只调 API 再截图）；
- 1024 / 1440、Light / Dark、实际 DPR 1.25 和部署中日志性能。

所有验收结果必须明确标注 **PASS / FAIL / SKIP / BLOCKED**；不把 FakeProvider、模拟集群或手工登记冒充真实环境部署。

每个阶段应实际提交可回退的 Git commit，记录阻断点，并继续完成不依赖外部授权的工作。非阻断性的安全增强和技术债进入 Backlog，不反复启动 Phase 0.x 或整体架构重写。

---

## 12. 最终交付与停止点

生成：

`ProjectOS_V2.0_Phase2_MultiDeployment_Final_Report.md`

报告至少包含：

1. Git 分支、最终 HEAD、提交与工作树状态；
2. V28/V29 实际迁移及历史数据兼容；
3. ReleaseCandidate / ChangeRequest / Release / Artifact / Evidence；
4. Deployment / EnvironmentTarget / Strategy / PipelineExecution；
5. Adapter Registry 的真实实现清单及能力边界；
6. 实际 CI/CD 系统与 K8s 部署控制关系；
7. Pipeline / GitOps / Kubernetes / SSH 各模式已实现、只读、未实现状态；
8. 真实目标、Release、制品哈希、外部执行 ID 与回执；
9. 多模式并存、控制权互斥、审批和幂等证据；
10. 实际部署、更新、健康检查、回滚与重启对账；
11. Electron UI 真实点击测试、截图、交互与性能；
12. 旧版 Agent / Runtime / 数据回归；
13. PASS / FAIL / SKIP / BLOCKED 和明确限制；
14. 为 Phase 3 Service / Incident / Observability 预留的关联和接口。

**Phase 2 完成标准**：ProjectOS 能将真实研发成果转化为受质量证据与审批保护的 Release，为不同项目及环境配置不同 DeploymentStrategy，并在一套统一产品界面中管理 K8s/CI/CD 和独立 VPS 等不同目标的部署、观察、回滚与完整历史。

**必须至少完成一条与用户现有 K8s/CI/CD 现实架构匹配的真实交付链，并尽力完成一条独立 VPS 测试部署链。**任何因缺少连接或审批而不能实际运行的外部测试必须标为 BLOCKED，不得宣称通过。

**本轮只实现 Phase 2，不自动进入 Phase 3。**

需要真实集群/VPS 连接资料时向用户索取；首次有副作用的远程操作前提交具体变更清单并等待批准。其他不依赖远程授权的工程任务直接执行。

**现在开始实际代码开发，不要停留在设计文档阶段。**

---

## 13. 信息架构调整（Phase 2 开发中追加）

### 13.1 目标

将嵌入「版本与迭代」页底部的完整发布/部署管理拆分为独立业务工作区；不重写 Phase 2 发布、部署、审批、Adapter 后端。

### 13.2 导航

项目导航新增「交付」分组：

- 发布中心（`/projects/:projectId/releases`）
- 部署中心（`/projects/:projectId/deployments`）

保留研发工作中心、任务与验收、Agent 协作、审批、运行审计、版本与迭代、知识与成果。窄屏使用图标侧栏；完整侧栏显示分组与名称。旧 `/versions` 路由和深链接继续可用；发布/部署入口传递 `?version=` 上下文。

### 13.3 版本与迭代页面

只保留多版本、阶段、迭代、任务/计划关联、质量门禁和发布/部署摘要。完整发布/部署容器移出页面，替换为：

- 最新 Release 摘要。
- 已确认环境数与来源可信度。
- 待处理审批数。
- 「进入发布中心」「查看部署历史」入口（携带 Project / ProductVersion）。

### 13.4 发布中心

以版本上下文组织：发布候选、变更申请、质量门禁、关联制品、发布审批、Release 历史、证据链。复用现有 `ReleaseService`、`ChangeRequest`、`ApprovalRequest`、Gate 和 Artifact，不复制第二套实现。

### 13.5 部署中心

统一 Deployment 模型展示环境与目标、部署策略、部署来源、状态、外部 ID、历史与回滚；按 Adapter 能力显示“未配置部署适配器”，不显示虚假执行按钮。当前无正式外部 Adapter 时仅允许手工/导入事实登记；`manual` 保持 `self_declared`，`imported` 为 `source_observed`，`unknown` 为 `needs_reconciliation`。

### 13.6 验收

- Electron 真实点击：版本摘要 → 发布中心 → 变更提交/批准 → 候选 → Release → 部署中心 → 部署审批/结果登记。
- 1440 Light/Dark、1024、实际 DPR 1.25；`scrollWidth == innerWidth`，无裁切。
- 旧路由兼容；单测、E2E、构建与打包通过。

---

## 14. Phase 2.1 收口与导航重构实施状态（2026-10-27）

### 14.1 已实施

- 侧栏改为一/二级分组可折叠：研发、交付、项目、全局；当前路由所属组自动展开。
- 展开状态写入 `localStorage`（`projectos.sidebar.expandedGroups`），重启/刷新恢复；手动折叠当前组在路由切换前保持。
- 运维组仅显示“Phase 3”占位，不创建空页面或假监控。
- 侧栏内容区独立滚动；底部设置与 Runtime 状态固定；窄屏保留图标 + Tooltip。
- 发布中心 `/releases`、部署中心 `/deployments` 独立工作区；旧 `/versions` 和深链接保留。
- 版本页只保留发布/部署摘要，完整交付容器移出。
- 交付审批接入统一审批中心，保留 subject/revision/content fingerprint；Release/Deployment 页不再重复放置批准按钮。
- 候选状态改为“可冻结/已生成 Release”；Release 显示“已登记 · 未外部分发”；手工部署显示“已登记 · 未核实”，不计入环境当前版本。
- 真实 Electron E2E：折叠/展开/持久化、版本证据/门禁、发布中心、审批中心处理、部署中心、部署结果登记均通过。

### 14.2 Adapter 与真实远程链

仓库内只发现 `.github/workflows/linux-build.yml`（构建 AppImage，不含部署）；未发现 Helm/Kustomize、Argo CD/Flux/Tekton、Jenkinsfile 或生产部署配置。没有外部连接凭据与写操作授权。

因此：

- CI/CD、Kubernetes、GitOps、SSH 真实 Adapter：**未实现，BLOCKED**。
- 当前只实现手工/导入部署事实登记与来源可信性；不宣称自动部署能力。
- Phase 3 再接入真实 Service/Incident/Observability 数据并建立运维一级菜单。

### 14.3 验收

`pnpm typecheck`、`pnpm test`、`pnpm build`、`package:dir`、`test:package` 通过；详见 `docs/v2/ProjectOS_V2.0_Phase2_1_Delivery_Closure.md`。

---

## 15. Phase 2.2 真实本地 Adapter 与三页 UX 重构（2026-10-27）

### 15.1 已实施

- 发布中心改为「候选 / 变更 / Release」分段视图，主列表 + 右侧发布就绪 Inspector；不再三栏等权堆叠。
- 部署中心改为「部署执行 / 环境与目标 / 历史与回滚」分段；适配器能力可见。
- 审批中心增加「全部类型 / 工具权限 / 交付审批」分段；交付审批不再与工具审批混排成长页。
- 新增可执行 `LocalArtifactAdapter`：
  - 校验冻结制品 SHA-256；
  - 复制到目标目录 `versions/<deploymentId>`；
  - 写入回执与 `health.json`；
  - 记录外部 ID、独立复现 assurance、事件和哈希；
  - 需要部署审批进入 `pending` 后才可执行，重复执行拒绝。
- 保留 Pipeline / K8s / GitOps / SSH 只读能力契约，标记未连接，不伪造执行。
- 真实 Electron E2E：本地目标、制品文件、候选、Release、部署审批、执行、哈希/健康回执全流程通过。

### 15.2 真实远程状态

本机仓库无 Helm/Kustomize/Argo/Flux/Tekton/Jenkins 部署配置，未获得 K8s/CI/VPS 连接凭据与写授权。真实远程部署为 **BLOCKED**，需用户提供只读连接后继续。

Phase 3 仍不启动。
