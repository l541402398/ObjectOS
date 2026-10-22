# ProjectOS — Phase 2B-2：Agent 自动组队与计划级授权（正式开发指令）

> **阶段边界**：基于 Phase 2B-1 Provider-backed AI Planner 的真实实现进行扩展。本轮只做计划审批、Agent 自动组队校验、最小权限授权、真实 UI 闭环及必要的使用量记录；**不实现 Phase 2B-3 自动动态重规划**。完成后停止并提交报告。

## 一、先审查并保护现有代码

1. 阅读 `ProjectOS_Agent_Teamwork_Phase2B1_Report.md`、R2.1 最终验收报告、最新 Open Issues，并阅读仓库真实源码；检查当前分支、HEAD、未提交/未跟踪文件及其他开发会话。**先完整、可恢复地保存 2B-1 工作区成果**，不覆盖或丢弃用户改动；未经允许不要使用破坏性 Git 命令。
2. 核对现存的 `PlanDraft`、`PlanGeneration`、`validatePlanDraft`、`validatePlanAgents`、`AgentAssignmentResolver`、`AIConnectionService`、`Approval`、`PolicyEngine`、`TaskService`、`CompletionDecision`、`OrchestrationScheduler`、Runtime Adapter、SQLite 迁移以及 `OrchestrationWorkspace`。以代码为准，不假设模块名称一定准确。
3. **禁止恢复已删除的 Agent 路由页面、菜单和绑定流程**；不新增 `ModelRouter` / `AgentRouter` / 第二套连接、Agent Registry、Runtime Registry、Task、Scheduler、DAG 编辑器或 Teamwork 页面。Planner 继续使用现有 AI 连接和默认模型；Agent 仍由既有分配器分配。

## 二、PlanDraft 审核与 Agent 自动组队

1. 用户使用 AI Planner 生成的内容**始终先是草稿**；审批前可查看每个任务的角色、能力要求、实际分配 Agent、Skill/Runtime 状态、依赖、验收条件、expectedArtifacts、风险和分配理由。用户编辑草稿后必须重新校验。
2. 复用 `AgentAssignmentResolver` 的候选、项目可见性、启停状态、Skills、Runtime 可用性和负载逻辑。模型输出的 Agent ID / Runtime ID 一律不得直接信任。
3. Phase 2B-1 报告说明 `requiredCapabilities` 当前只影响候选评分。审查这种软匹配是否允许**不具备必要能力**的 Agent 被选中。对于确实必需的能力，必须区分 *hard requirements* 和 *preferences*；缺少硬能力时 `assignmentBlocked`，阻止批准/执行，并解释缺失项；不应把所有辅助能力机械升级为硬条件。
4. 自动/显式分配语义沿用已有 `assignmentMode`。用户显式指定不可静默换人；审批后的 Agent 不可用时，复用 R1/R2 既有安全换人和确认机制。
5. 校验 DAG、任务对应关系、实际 Agent 的项目权限、任务可用性及并发容量；容量繁忙应排队而不是假报无可用 Agent。

## 三、明确区分「批准计划」与「授予执行权限」

1. 审核 PlanDraft ≠ 一次性授权执行所有工具。用户可以先批准任务清单但不启动；只有明确的用户操作才能进入执行。
2. 设计最小必要的 **PlanExecutionGrant（名称以现有架构适配）**，与已有 Policy / Approval 集成，不另造平行审批系统。授权必须包含：绑定的 `projectId`、不可变的 plan revision/内容指纹、发起用户 actor、授权操作种类、适用任务/Agent、允许的项目内路径或作用域、有效期、撤销状态，以及可可靠度量的资源上限。凡未配置的高风险能力默认不授予。
3. 授权必须经过可信主进程/后端校验与持久审计：UI 隐藏按钮并非授权。Agent、模型回复、任务 Artifact、工具参数均不能自行签发、放宽或续期授权。不可依赖 Agent 声称“已经获得批准”。
4. **路径安全**：真实路径规范化后检查项目根与授权范围；阻止 `../`、绝对路径、符号链接/连接点跨界和大小写变体绕过，检查实际执行目标，而不是只检查声明的路径。敏感位置（凭据、SSH、权限/密钥、CI、配置迁移等）及破坏性命令仍走单独高风险 Approval；计划授权不可绕过已有风险分级。
5. **命令与副作用**：计划授权不等于通用 shell 权限。执行前必须复用真实 ToolHandler/PolicyEngine 做命令和参数评估；对于无法可靠界定范围的 CLI/ACP/外部 Harness，使用受限可执行模式或维持逐次审批，不得因为 Harness 是“可信工具”就直接放行所有操作。
6. **撤销与过期**：在任何副作用前重新检查 grant 当前状态、plan revision、任务、actor、Agent/Runtime 和预算；撤销后不再产生新工具副作用。对于已经运行的外部进程，尽力取消/终止并标记未知副作用需核对；不得承诺可以撤销已经发生的外部操作。
7. **Revision**：旧计划被 supersede、任务重新分配、需求扩大、文件/工具作用域扩大、修改安全敏感验收要求时旧 grant 不得自动继承到新 revision。已完成成果的 `reuseFromTaskId/reuseArtifactIds` 可以复用记录，但不是授权继承。
8. **一致性**：SQLite 中 grant 创建/批准/消费/撤销要有幂等与审计。考虑两 Scheduler 竞争、应用进程终止、审批前后竞争，以及审批记录与计划状态原子一致性；不得仅靠前端缓存。
9. 本地单用户模型只存在 `local-user` 时对齐现有 actor 身份，不要编造 admin/approver 角色；“独立审批记录”不等于第二人复核。

## 四、Phase 2B-1 的必要技术债同时收口

1. 检查 `allowOverBudget`：不得由模型、内部任务或非授权的 IPC 请求绕过项目预算；若用户可以选择超预算调用，必须显示用量和潜在费用风险并记录明确授权，默认不开启。
2. Planner 费用/Token 报告目前只记录在 `PlanGeneration`，未计入 Run 维度 `ai_usage_records`。设计**不伪造费用**、与现有预算统计兼容的 Planner usage 记录方案。只有 Provider 返回 token 数据才记录实际值；价格未知显示 unknown，不填 0 冒充零成本；重复请求/纠错应区分每次尝试，并防重复累计。根据真实数据模型决定是否需要迁移。
3. 检查 `expectedArtifacts` 的结构化要求是否能被现有 `CompletionDecision` 真正识别，不得因为 Planner 自动补充“设计方案”“测试报告”等文字标签就默认已有验证证据。计划可批准不代表成果合格。
4. 继续限制发送给外部 Provider 的上下文：项目范围、密钥脱敏、敏感文件过滤、大小上限与低信任文件指令防护。UI 在适当位置准确提示使用外部连接会发送必要项目上下文，不虚构隐私保证。

## 五、现有页面内完成产品闭环

1. 只在既有计划弹窗、DAG Inspector、任务审批/运行界面增量展示：草稿来源、Agent 分配理由与阻断、计划审核、授权范围/有效期/风险、需要逐次审批的操作、授权状态与撤销入口。
2. 审批前清晰显示**“批准任务计划”**与**“授权有限操作 / 开始执行”**之间的区别。危险权限不可使用预勾选、模糊总开关或隐藏默认值；取消/拒绝后不能启动执行。
3. 必须严格复用当前 ProjectOS 的 Apple-inspired 浅色 Liquid Glass 设计 tokens/组件和既有深色主题：精致的玻璃层次、低饱和色、清晰间距，禁止“清水房/毛坯房”式默认表单堆砌、大片高饱和蓝紫、重复页面、虚假状态/统计。
4. Electron 真实鼠标/键盘 E2E，覆盖小窗口、125% 缩放、侧栏折叠、错误/空/加载状态、风险审批的确认和拒绝、焦点与玻璃遮罩命中。提供真实截图；绝不使用 DOM `.click()` 绕过命中问题。

## 六、必须验证的安全与业务场景

- 简单按钮样式、RBAC、性能排查三类 **Phase 2B-1 真实 PlanDraft**：在 UI 中确认任务与 Agent 绑定，要求有意义的角色能力差异，合法草稿可批准但不会自动执行。
- 模型虚构 Agent、不可见 Agent、禁用 Agent、Runtime 不可用、硬能力缺失、显式指定 Agent 无法执行、跨计划容量满：都应产生可解释阻断/排队/用户确认，不静默降级。
- 未授权工具、路径越界、符号链接/连接点越界、敏感路径、破坏性命令、权限扩大、审批被拒：后端在产生副作用**之前**阻断；不能通过 Agent 的文本或 Artifact 绕过。
- grant 已过期、被撤销、Plan revision 已 supersede、任务/Agent 更换、重启恢复、多进程竞争与重复审批：确保不重复签发、不误放行旧授权，不重复 Run。
- 原有 P0-04 人工验收策略、R1 原子 Agent 容量、R1 Run/Plan 预算、R2 Reconcile、Handoff 和 Inbox 全部保持有效。
- 费用记录：真实可见 usage 时正确汇总；无 usage/无单价时明确 unknown；一次纠错对应多个模型调用不会漏记或重复记。
- 不使用 Mock 声称真实模型/真实 Harness 全链路已经验证；可在已有授权与隔离条件下验证至少一次真实 Planner 草稿、授权并由现有执行链完成低风险工具动作。高风险真实副作用不得未经确认执行。

运行适用的 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm test:teamwork`、V1.3/V1.4/V1.8 回归、相关 Electron UI E2E、`pnpm package:dir` / `pnpm test:package` 与新功能迁移测试。若某测试未执行或环境不允许，明确说明。

## 七、交付与停止边界

输出 `ProjectOS_Agent_Teamwork_Phase2B2_Report.md`：列出实际调用链、文件与迁移、Agent 硬/软能力规则、授权数据模型与风险表、三个计划审查记录、真实后端拒绝/授权/撤销测试、Provider 用量统计、UI 截图、测试证据、遗留问题与下一阶段边界。

保留已有 Agent 路由已移除的产品决策；不得因为历史 `aiRouting.*` 类型或表存在而恢复路由页面。本阶段**不开发 Phase 2B-3 自动重新规划**，不批量改造产品 UI，不自动授权危险操作，不覆盖用户真实数据库和安装包。

**现在审查代码并开始真实开发。完成 Phase 2B-2 后停止，等待用户验收。**
