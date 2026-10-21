# ProjectOS V1.6 — 设计图覆盖矩阵

日期：2026-10-20  
设计索引：53 项（12 已确认 + 41 待复核）

状态：✅ 真实实现 / ◐ 部分实现 / ○ 未实现

| 设计 | 状态 | 实现位置 |
|---|---|---|
| 01 项目中心 | ✅ | ProjectCenterPage |
| 02 项目详情 | ✅ | ProjectOverviewPage + V1.6 Hero |
| 03 Agent 工作台 | ✅ | AgentWorkbenchPage |
| 04 Agent Studio | ✅ | AgentStudioModal 三栏五 Tabs |
| 05 工作流编排 | ◐ | 真实 DAG + Inspector + 节点筛选 + 日志；无任意节点创建 |
| 06 任务看板 | ✅ | TaskBoardPage + 快速指派 + 整列拖放 |
| 07 运行审计 | ✅ | RunsPage |
| 08 AI 连接 | ✅ | AIConnectionsPanel 极简表单 |
| 09 知识库 | ✅ | KnowledgePage |
| 10 资源管理 | ✅ | ResourcesPage |
| 11 模型目录 | ✅ | ModelCatalogPanel + 模型详情 Drawer |
| 12 Runtime 管理 | ✅ | RuntimeSettingsPanel + 检测持久化 |
| 13 Agent 路由 | ◐ | V1.7 按 `settings-runtime-ux.md` 移除独立页；后端路由数据保留，当前无 UI |
| 14 工具与插件 | ✅ | ToolsSettingsPanel + Runtime 详情 |
| 15 外部 Agent | ◐ | V1.7 移除设置入口；Runtime Harness 统一管理，externalAgents API 仍保留 |
| 16 AI 连接编辑器 | ✅ | 内联编辑器 + 高级折叠 |
| 16 团队与权限 | ◐ | V1.7 移除设置入口；本地单用户后端权限仍生效 |
| 17 项目任务 | ✅ | 任务看板 |
| 17 系统设置 | ◐ | 合并为“偏好设置”；旧 SystemSettingsPanel 不再挂载 |
| 18 跨会话交接 | ✅ | CollaborationPage |
| 19 自主运营 | ✅ | OperationsPage |
| 20 审批中心 | ✅ | ApprovalsPage |
| 21 Agent 模板库 | ✅ | Agent Studio 左栏模板 |
| 22 人设编辑器 | ✅ | Agent Studio 人设 Tab |
| 23 Skills 绑定 | ✅ | Agent Studio 技能 Tab |
| 24 Runtime 绑定 | ✅ | Agent Studio 运行环境 Tab |
| 25 新建工作流 | ◐ | 生成计划弹窗；无节点画布编辑器 |
| 26 实时执行监控 | ✅ | RunsPage 2.5s 轮询 |
| 27 新建项目 | ✅ | ProjectCenter Modal |
| 28 创建任务 | ✅ | TaskBoard Modal |
| 29 新建会话 | ✅ | AgentWorkbench Modal |
| 30 导入项目 | ✅ | ProjectCenter 导入模式 |
| 31 项目文件 | ✅ | Workspace + Resources |
| 32 工具权限 | ✅ | PermissionsSettingsPanel |
| 33 OpenSpec | ○ | 明确未集成，未伪造 |
| 34 存储与数据 | ✅ | DataSecuritySettingsPanel |
| 35 网络与代理 | ◐ | 真实说明系统代理；无独立代理设置 |
| 36 安全与隐私 | ✅ | DataSecuritySettingsPanel |
| 37 外观与主题 | ✅ | AppearanceSettingsPanel |
| 38 快捷键 | ✅ | AppearanceSettingsPanel |
| 39 通知中心 | ✅ | NotificationsPage |
| 40 命令面板 | ✅ | CommandPalette |
| 41 关于 | ✅ | AboutSettingsPanel |
| 42 空状态 | ✅ | 共享 EmptyState |
| 43 项目健康 | ✅ | ProjectHealthPage |
| 44 用量与价格 | ✅ | UsageSettingsPanel |
| 45 Harness 发现 | ✅ | Runtime 检测 |
| 46 第三方连接 | ✅ | IntegrationsSettingsPanel |
| 47 项目设置 | ✅ | ProjectSettingsPage |
| 48 插件详情 | ✅ | Runtime 详情 Drawer（插件安装仍缺） |
| 49 模型详情 | ✅ | 模型详情 Drawer |
| 50 Agent Studio Light | ✅ | 实机截图 |
| 51 AI 连接 Light | ✅ | 实机截图 |

## 明确边界

- 工作流节点图是 SQLite 任务/依赖/Agent 的投影，不允许客户端成为依赖真相；因此没有提供任意节点拖入创建。
- OpenSpec 未集成，不注册为 Runtime。
- 第三方代码托管（GitHub/GitLab）未接入，UI 明确显示未连接。
# 设计覆盖补充：25 新建工作流

- 计划弹窗支持添加/删除任务节点、编辑角色与依赖
- 批准计划后由后端创建真实 Task DAG
- 台账仍以 SQLite 为唯一依赖真相
