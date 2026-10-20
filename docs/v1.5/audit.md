# V1.5 审计与实施状态

日期：2026-10-19

## 已有 / 复用

| 能力 | 路径 | 结论 |
|---|---|---|
| Agent 基础实体 | `agents` 表、`AgentSchema` | 复用；为自定义 Agent 增加 persona/config/version |
| Agent 会话与运行 | sessions、agent_runs、AgentRunner | 复用，不新建平行 Runtime |
| 外部 CLI 探测 | `external-agents.ts`、`external-runner.ts` | 复用检测/进程/取消模式 |
| 模型连接与密钥 | `ai_connections`、ConnectionSecretStore | Runtime 模型引用复用，不存明文 |
| 审批 / 策略 / Worktree | V1.3/V1.4 | Runtime 执行必须继续走这些链路 |
| 设置弹层 | SettingsModal + RuntimeSettingsPanel | 增量扩展 Runtime 管理 |
| Agent 工作台 | AgentWorkbenchPage | 增量加 Agent 管理，不做新导航体系 |

## 本轮新增

| 能力 | 状态 | 证据 |
|---|---|---|
| AgentDefinition / Persona | 完成（首版） | `agent_config_versions`、AgentStudioService、CRUD |
| Skills 表与绑定 | 完成（存储） | `skills`、`agent_skill_bindings`；尚未做 SKILL.md 导入 UI |
| RuntimeProfile | 完成（首版） | `runtime_profiles`、CRUD、自定义 Runtime 表单 |
| Runtime 检测 | 完成（首版） | `where`/`--version`，明确 available/unavailable，不伪造 |
| ACP Registry | 完成（拉取/缓存） | 官方 JSON，6 小时内存缓存 |
| Agent 管理 UI | 完成（首版） | 创建/编辑/删除、Persona、Skills、Runtime、权限、提示词预览 |
| Runtime 管理中心 | 完成（首版） | 设置 → 运行时：检测、能力标签、自定义 Runtime、Registry 拉取 |
| Runtime 执行适配 | 未完成 | 尚未把 RuntimeProfile 接入 AgentRunner/ExternalRunner |
| 两种 Runtime 真实验收 | 阻塞 | 本机仅安装 Claude Code；此前用户要求不执行 Claude 真实调用；其余候选未安装 |

## 未完成

- RuntimeAdapter 统一接口与真实 execution/event/cancel 接线
- ACP 安装、握手、认证、会话
- Skill 导入、版本快照注入执行
- Runtime 模型/密钥引用与权限沙箱
- 两种外部 Runtime 实跑与 100/125/150% DPI 验收
- 打包后脱离源码验证

## 已知限制

- Runtime 候选列表来自文档与本地探测，不代表已兼容。
- 未安装的 Runtime 只显示不可用及原因。
- 当前自定义 Agent 可配置但尚未真正通过所选外部 Runtime 执行。
