# ProjectOS V1.6 功能需求设计（PRD）

> 版本：V1.6｜与完整实施说明书配套｜范围：UI/UX 重设计 + Agent Studio + 原有多 Agent 编排集成

## 1. 产品定位及版本边界

ProjectOS 是本地优先、项目全生命周期驱动的多 Agent 工作台。V1.6 的优先级是统一体验并打通既有 Agent 能力；不是推倒重做。V1.3 负责任务 DAG、多 Agent 编排及交接；V1.4 负责持续项目运营、监控、自动发现问题、审批与修复；V1.5 负责 AgentDefinition/Persona/Skills、开放 Runtime Registry/ACP、Harness 发现和真实运行；V1.6 为上述能力提供一致的视觉与配置体验。

## 2. P0 功能清单

| 功能 | 关键用户路径 | 依赖 / 真实性条件 |
|---|---|---|
| 项目中心 | 新建、导入、搜索、打开项目、查看进度 | 现有项目 SQLite / 状态服务；不伪造进度 |
| 项目详情 | 浏览里程碑、Agent、任务、产物、工作流 | 关联项目 ID 和任务/运行数据 |
| 任务看板 | 筛选、拖拽状态、打开详情、分配 Agent | 真实任务服务，状态可回滚和审计 |
| 多 Agent DAG | 节点绑定自定义 Agent，编排、执行、日志回传 | 必须保留原层级式工作流图、右侧 Inspector |
| Agent Studio | 选择模板或空白 → Persona/Skills/Runtime → 预览 → 保存 | V1.5 AgentDefinition、ConfigVersion、RuntimeProfile |
| 本地 Harness 扫描 | 扫描已安装 CLI/Adapter，诊断认证、能力与版本 | 发现 ≠ 可用；动态 Registry，非硬编码名单 |
| Agent 与编排集成 | DAG 节点选择 agentId；V1.4 自动策略选择 agentId | 调度器解析快照，事件真实回传 |
| AI 连接 | 选 Provider → 地址/Key → 测试 → 获取/选择模型 | 真实服务商能力与错误码；Key 安全存储 |
| 设置中心 | AI 连接、模型目录、路由、Runtime、工具/插件、外部 Agent、权限等 | 使用既有服务、状态与安全边界 |
| 左侧导航 | 平滑展开/折叠、保持布局与焦点 | 全系统共享控件，消除文字竖排中间态 |
| 运行审计 | 执行列表、Agent/Runtime、事件、产物、用量 | AgentRun/RuntimeEvent 原始记录、未知值显示未知 |

## 3. Agent Studio 详细用户故事与验收

### 3.1 新建 Agent

左侧模板导航与空白创建，中心五段配置（基础信息、人设与提示词、Skills、运行环境、高级设置），右侧实时预览。用户可独立指定角色、人设、Skills、模型 Provider 和 Runtime/Harness；这些对象不得混为同一个选择框。模板只能填预设字段，不能授予高危权限。保存时创建 AgentDefinition 与配置版本，不能触发自动执行。

### 3.2 编辑、复制、归档与版本快照

已创建的 Agent 可编辑、复制与归档；不得删除或重写历史 AgentRun。任务启动时冻结 Persona、Skills、Runtime、Model、权限和工作目录快照；运行中编辑配置只影响后续任务。复制产生新 ID，绑定现有 RuntimeProfile 时遵守权限限制。

### 3.3 工作流绑定与实际执行

V1.3 DAG 的角色槽位可选自定义 Agent，工作流保存 agentId；V1.4 自主运营策略也可选择 agentId。编排引擎通过统一 Resolver 检查状态、权限、capabilities、认证与预算，生成 AgentRun，关联 nodeId 和执行快照。客户端显示真实日志、工具调用、审批、产物与最终结果。

## 4. Runtime/Harness、Skills 与 Tools 责任边界

Runtime/Harness（例如 OpenCode、Claude Code、Codex CLI，实际以本机扫描/适配结果为准）负责执行。模型 Provider 是模型 API 服务，不是 Harness。Skills 是流程知识与工作提示，勾选 Skill 不自动授予工具权限。Tools/MCP 是可执行操作能力。外部 Agent 只管理真正独立任务执行服务，不得把普通 MCP Server 或模型端点标为外部 Agent。

Registry 必须支持新增兼容适配器；真实扫描记录版本、二进制路径、认证、协议和能力。某 CLI 未安装、未登录、没有 ACP 或无法无头执行时，明确反映不可用原因。

## 5. AI 连接与模型发现

**默认只显示必要字段**：选择服务商、API 地址（支持预填可编辑）、API Key / 认证方式、测试连接、可用模型。服务器或 Provider 能列模型就同步；不能列出时允许手动输入模型 ID。协议、温度、Top P、超时及参数映射仅在高级设置中出现并给出安全默认值。显示“已连接”须基于真实检测，不因填写了 Key 就变绿。错误区分鉴权失败、网络超时、无可用模型和不支持列表 API。

模型目录只复用已有连接，不要求重复 Key；价格、上下文长度与 capabilities 缺证据时标为未知，计费统计仅基于真实运行 usage。

## 6. OpenSpec 可选工作流

规范 → 设计 → 任务 → 执行 → 验证 → 归档，可选择是否启用；其是规范驱动开发工具链/工作流，不作为 Runtime 或模型。可在模板或工作流入口接入，使用真正已选定的 AgentRuntime 来执行编码和验证；本机没有 OpenSpec 时不伪造已启用。

## 7. 全局设置、审批与审计

覆盖 AI 连接、模型目录、Agent 路由、Runtime 管理、工具与插件、外部 Agent、团队权限、系统设置、网络代理、安全隐私、存储与数据、外观与个性化、日志监控。删除、Shell、文件、外网调用、Git 推送等高风险操作走 Policy/审批服务。角色、项目、Agent 权限应在后端生效，而非仅隐藏按钮。允许个人本地优先部署，不强制团队云服务。

## 8. 非功能要求

- 复用现有 React/Ant Design 设计 Token、Electron IPC、SQLite；禁止平行独立实现一套假的业务层。
- 控件键盘可达，Tab/F6/Esc、焦点环、屏幕阅读器和 reduced-motion 需测试。
- Windows 100%、125%、150% DPI 字体清晰，正文默认至少 14px，次要字原则至少 13px；文本对比度满足 AA。
- 复杂光学效果需性能降级，不能阻碍项目真实执行。
- 系统设置为真正的用户设置，不预置无用营销文案。

## 9. 交付门槛

每个页面需完成：独立图对照、现有功能清单、真实 Electron 截图、视觉差异修正、业务 E2E、失败/空/权限状态、深浅色和 DPI 验收。12 张已确认图作为最高优先视觉母版；41 张新设计为待确认独立页面，不能误标为已最终批准。
