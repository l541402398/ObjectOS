# ProjectOS V1.5 — 自定义 Agent 与开放式多 Runtime 适配系统

版本：V1.5 ｜ 状态：待实施 ｜ 基线：V1.4 已开发/开发中 ｜ 日期：2026-10-20

> 交付目标：用户可创建具备独立名称、人设、Skills、Runtime、模型、权限的 Agent，配置真实进入执行链路；Runtime 面向整个 Agent 生态开放：ACP Registry 动态发现 + SDK/CLI/API 原生适配 + 自定义 Runtime 插件；不采用固定厂商白名单，不与模型 Provider 混淆。

## 本期不可妥协的原则

- 审计现有代码后增量实现；不得覆盖 V1.4。
- Agent 配置独立于 Runtime；运行固定版本快照。
- 首批 Runtime 列入规划不等于宣称已兼容，必须逐项真实验证。
- 技能与工具权限分离，密钥不明文落库。
- UI 极简且文字清晰；不允许只做空壳选择器。
## 1. 版本定位与范围

V1.5 是独立于 V1.4 的新增版本：自定义 Agent 配置、多 Runtime 插件适配与真实执行。V1.4 自主运营、健康监测、Agent 工作流图、字体清晰度整改必须保持兼容。禁止重做已有 AI 配置、Skill 注册表和数据库实体。

## 2. 实施前审计

逐项扫描 AgentDefinition、AgentRun、Skill Registry、AI Provider、模型配置、Runtime、IPC、SQLite、safeStorage、工作区权限、执行事件、流程图。输出“已有/缺失/复用/迁移”矩阵及文件路径。未审计不得直接新建平行体系。

## 3. 核心领域模型

AgentDefinition（id/name/avatar/category/spaceId/visibility/status/currentVersion）、AgentPersona（role/background/responsibilities/principles/style/constraints/systemPrompt）、AgentSkillBinding（skillId/version/enabled/config）、RuntimeProfile（runtimeType/endpoint/executablePath/authRef/modelRef/options）、AgentRuntimeBinding（primary/fallbacks）、AgentConfigVersion（不可变快照）、AgentRun（snapshotId/runtimeId/sessionId/status）。Agent 身份与 Runtime 分离；历史运行固定快照。

## 4. 创建与编辑 Agent UI

沿用当前“创建 Agent”弹窗，布局顺序：名称与角色、Persona、Skills、Runtime、模型、工作方式、权限。默认展示必要字段，复杂选项折叠到高级配置。角色预设可填充人设，但用户可以编辑。支持创建/编辑/复制/导入/导出/禁用/删除；删除先检查任务引用。保持深浅色可读性，正文≥14px，辅助文字原则上≥13px，正文对比度≥4.5:1；不堆解释性文案。

## 5. Persona 与提示词编译

支持结构化人设与高级 System Prompt；保存草稿和预览最终生效指令，显示来源（组织策略/项目规则/Agent Persona/Skill/任务）。优先级明确，禁止 Agent 覆盖安全策略。不同 Runtime 提示词注入能力不同：adapter 应报告 native_system_prompt / prepend_instructions / unsupported，不能假装生效。

## 6. Skills、Tools、MCP 边界

Skills 是工作流程与知识，Tools 是实际可执行操作，MCP 是工具服务协议。支持 Skill 注册表搜索、多选、版本固定、本地 SKILL.md 导入、依赖检查、兼容性提示；技能启用不自动授予文件、Shell、网络权限。支持按需加载 Skill，保留版本快照与运行证据。

## 7. Runtime 支持矩阵

P0：DeepSeek Harness（dsh）、OpenCode、Qwen Code、Claude Code、Codex、Gemini CLI、ProjectOS Native（仅在既有实现存在时）。P1：ACP 通用适配器、可配置 CLI Adapter、远程 Agent 服务 Adapter。P2：Aider、Cline/Roo Code、Goose、OpenHands 等先做技术验证，确认可用的外部控制协议/许可/部署条件后再启用。对未验证的 Runtime 只显示“实验性/不可用”，不承诺全部能力。

## 8. Runtime 与 Provider 区分

Runtime 是 Agent 执行引擎，Provider 是模型服务商。DeepSeek、Qwen、OpenAI、Anthropic、Google、OpenRouter、Ollama、vLLM、LM Studio 可作为模型来源（实际能力视各 Runtime 支持情况）；DeepSeek Harness 与 Qwen Code 是不同于模型本身的运行引擎。不得把“选 Qwen 模型”等同于“启动 Qwen Code”。Provider 凭据引用现有安全存储。

## 9. RuntimeAdapter 接口与能力声明

统一接口：detect(), validate(), getCapabilities(), start(runContext), send(session,input), subscribeEvents(), cancel(), dispose()。可选 resume(), pause(), fork(), listModels(), listSessions()。能力以运行时探测返回，字段含 stream/toolCalls/skills/systemPrompt/sessionResume/subagents/worktree/permissions/costMetrics/modelSwitch。版本变化时重测，不假设各 CLI 的命令行参数相同。

## 10. 七类首批适配策略

DeepSeek Harness：审查 Cordis 插件/会话/事件接口，优先使用正式支持的集成面，预览 API 加版本隔离。OpenCode：优先 SDK/Server 及 Agent 配置能力。Qwen Code：优先公开 SDK/CLI/协议，确认非交互运行、会话和事件机制。Claude Code：优先 Claude Agent SDK 或受支持的 CLI 模式。Codex：优先官方 SDK/CLI。Gemini CLI：优先 ACP 或正式支持的非交互模式。Native：复用既有内部 Harness。每个适配器必须提供 detect/validate/stream/cancel 的可复现验证报告。

## 11. Runtime 安装检测与环境中心

检查版本、可执行路径、平台、登录状态、模型配置、网络、工作目录、工具权限；提供重新检测、打开安装文档、诊断日志。Windows 环境优先，不允许硬编码开发者机器路径。支持未安装/未认证/不兼容/可用/降级等状态，严禁假成功。

## 12. 模型与 Runtime 配置

Agent 可绑定一个主 Runtime 与若干备用 Runtime，分别关联 Provider、模型、环境变量引用、超时、并发、工作区策略。仅在启动前或安全检查点进行故障转移；不支持恢复的 Runtime 必须新建会话并显式传递经脱敏的任务摘要，不能宣称无损热切换。

## 13. 执行链路

用户创建/选择 Agent → 载入版本化定义 → 合成 Persona → 解析 Skills → 权限与能力检查 → 选择 RuntimeProfile → 创建 AgentRun 快照 → 启动真实 Runtime → 流式归一化事件 → SQLite 持久化 → Agent 图谱同步 → 结果与工件归档。不得只做表单与 Mock 流程。

## 14. 统一事件与会话

事件类型：run.started, message.delta, tool.requested, tool.completed, permission.requested, artifact.created, run.failed, run.completed。每事件带 runId/sessionId/seq/timestamp/runtimeType，支持幂等、重放与断线恢复；不支持事件级别能力的 CLI 只能报告粗粒度事件，不伪造 token/tool 细节。

## 15. 安全与权限

密钥通过 Electron safeStorage 或已有密钥服务引用，不写明文 SQLite/日志/导出。进程调用避免 shell 注入，参数数组启动；可执行文件路径白名单与校验；目录访问沙箱、Git Worktree、工具审批、MCP 权限按 Agent/任务独立生效。Runtime 选择不能绕过 ProjectOS 全局安全策略。

## 16. 数据迁移与 IPC

优先扩展已有 SQLite 表；新增表时需唯一约束、外键、索引、schemaVersion 和回滚方案。IPC 命名空间 agent.*, runtime.*, skill.*；输入 schema 校验、主进程鉴权、异步事件订阅清理。导入/导出使用可版本化 JSON，排除 authRef 实际秘密。

## 17. 视觉与交互规范

保留截图中的紧凑弹窗、类型切换、所属空间和 Runtime 区块。新增 Persona 编辑器、Skill 选择器、Runtime 状态、模型联动及高级配置。运行引擎状态用明确文本+图标，不仅靠颜色。杜绝灰色 11px 小字、opacity 叠加、父容器模糊和整体 transform 缩放。

## 18. 里程碑

M1.5-00 代码审计；M1.5-01 Agent 定义与配置版本；M1.5-02 Persona/Skill 注入；M1.5-03 Runtime Adapter 基座；M1.5-04 首批 Runtime 适配与检测；M1.5-05 创建/编辑 UI；M1.5-06 真正执行与事件流；M1.5-07 安全/迁移/回归；M1.5-08 Windows EXE 干净环境验证。P0 先确保 OpenCode/Qwen Code/DeepSeek Harness 中至少两种真实打通，再按适配成熟度扩展全部首批 Runtime。

## 19. 测试与验收

T01 创建不同名称/Persona 的 Agent；T02 Skill 添加移除实际改变任务上下文；T03 OpenCode 实跑；T04 Qwen Code 实跑；T05 DeepSeek Harness 实跑；T06 Claude/Codex/Gemini 能力探测及可用环境实跑；T07 Runtime 缺失/认证失败正确提示；T08 版本快照不污染历史；T09 中断/取消/重启恢复；T10 未授权工具拒绝；T11 密钥不泄露；T12 深浅色及 100/125/150% DPI 清晰度；T13 Agent 图谱联动；T14 安装包脱离源码和 node_modules 启动；T15 Provider 与 Runtime 区分；T16 回归 V1.4。对无法获取凭据的外部 Runtime 标记阻塞，不伪造测试通过。

## 20. 开发 AI 的交付要求

提交代码变更与迁移清单、每个 Runtime 的官方接口依据/版本/能力矩阵、实际运行录屏或日志、测试结果、截图、未完成事项、安装包验证。不得用静态假数据、隐藏失败、直接覆写用户配置、绕过审批或声称所有 Runtime 天然支持相同功能。

## 21. 官方参考资料

DeepSeek Harness: https://www.deepseek.com/harness/en/ ；OpenCode: https://opencode.ai/docs/agents/ ；Qwen Code: https://github.com/QwenLM/qwen-code ；Gemini CLI ACP: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md ；Claude SDK: https://platform.claude.com/docs/zh-CN/cli-sdks-libraries/overview 。其他 Runtime 以实施时官方文档为准。

## 附录 A：TypeScript 契约草案

```ts
type RuntimeType = 'deepseek-harness' | 'opencode' | 'qwen-code' | 'claude-code' | 'codex' | 'gemini-cli' | 'projectos-native' | 'acp' | 'custom-cli';
interface RuntimeCapabilities { stream: boolean; toolCalls: boolean; skills: boolean; systemPrompt: 'native'|'prepend'|'unsupported'; sessionResume: boolean; subagents: boolean; worktree: boolean; permissions: boolean; costMetrics: boolean; modelSwitch: boolean; }
interface RuntimeAdapter {
  detect(): Promise<{ installed: boolean; version?: string; executable?: string }>;
  validate(profileId: string): Promise<{ ok: boolean; errors: string[] }>;
  getCapabilities(): Promise<RuntimeCapabilities>;
  start(context: AgentRunContext): Promise<{ sessionId: string }>;
  send(sessionId: string, input: string): Promise<void>;
  subscribeEvents(sessionId: string, onEvent: (event: AgentEvent) => void): () => void;
  cancel(sessionId: string): Promise<void>;
  dispose(): Promise<void>;
}
```

## 附录 B：实施约束

以上接口是 ProjectOS 内部契约草案，并非各第三方 Runtime 的官方 API。开发时必须分别做实际适配，记录兼容版本、能力差异和错误处理。


## 18. 开放式 Agent Runtime 生态接入（V1.5 强制新增）

### 18.1 核心原则：不是预置若干品牌，而是实现 Runtime 平台

- 禁止以 `switch(runtimeName)`、固定枚举、写死 UI 选项的方式实现 Runtime 生态。已有预置选项只能作为插件清单示例，不能构成接入上限。
- 实现 Runtime Registry（发现/安装/注册/启停/升级/卸载）、Runtime Adapter SDK、协议桥接器、能力协商、环境检测与诊断。
- Runtime 既可来自本地 CLI、SDK、HTTP 服务、ACP Agent、独立 Harness、远程托管 Agent，也可来自用户安装的第三方适配插件；模型 Provider 独立管理。
- 所有外部 Runtime 都必须通过统一 AgentRun、权限、预算、审计、事件和工作区隔离链路执行，禁止插件绕过 ProjectOS 内核。

### 18.2 ACP 优先的动态发现

- 实现 Agent Client Protocol（ACP）客户端，优先采用官方维护的协议定义和 SDK，支持 initialize、认证协商、会话创建、消息/事件、取消等实际支持的操作。
- 从官方 Registry `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` 获取可安装 Agent 清单；缓存版本、更新时间、签名/校验信息（如源提供）与平台分发信息。
- Registry 不是兼容性保证。必须检测 Windows 兼容性、安装方式、协议握手、认证、能力及实际任务执行；不兼容时展示原因。
- 支持手动导入本地 ACP Agent manifest、私有 Registry URL；网络不可用时使用本地缓存，不自动执行未经确认的安装脚本。
- ACP 不覆盖的高级功能，可由专用 SDK/CLI Adapter 补充；同一 Runtime 多传输实现时显示能力差异，优先选择用户配置的可用方式。

### 18.3 Runtime 兼容候选清单（非封闭白名单）

**首批真实验收候选**：DeepSeek Harness、OpenCode、Qwen Code、Claude Code、Codex CLI、Gemini CLI、Kimi CLI、Goose、Cline、Aider、OpenHands、ProjectOS Native。

**扩展兼容候选**：Mistral Vibe、Factory Droid、GitHub Copilot CLI、Cursor Agent CLI、Augment/Auggie、Qoder CLI、Kilo Code、Roo Code、Pi Coding Agent、SWE-agent、Continue、Amp、Devin、GLM Agent、Grok Build、Junie、Stakpak、VT Code、DeepAgents、fast-agent，以及后续 Registry 收录或用户自行注册的 Agent。

候选并不意味着都原生支持 ACP、Windows、无头运行、SDK 或二次分发。开发 AI 必须逐项查证其当前协议、许可、认证和实际能力，归类为「ACP 可接入 / 原生适配可接入 / 需桥接或实验性 / 当前不支持」，不得虚构适配完成。

### 18.4 插件包与注册机制

建议 manifest：`id`、`displayName`、`version`、`publisher`、`protocol`（acp/sdk/cli/http/native）、`entrypoint`、`platforms`、`installSource`、`authMethods`、`requiredPermissions`、`capabilities`、`healthcheck`、`compatibility`。

- Adapter SDK 提供标准 TypeScript 接口与示例插件，支持插件包签名/哈希、版本约束、受限进程运行、最小权限与卸载清理。
- 安装前展示来源、可执行代码、请求权限和磁盘/网络操作；未经授权不得自动安装或执行。
- 第三方插件不得直接读写 Electron 主进程密钥或任意 SQLite 表，通过能力受控的 RPC/IPC 访问。
- 允许社区新增 Runtime 适配插件，主程序无需发版即可安装兼容插件；核心接口破坏性升级必须有兼容性检测。

### 18.5 自定义 Runtime 创建向导

用户可选择「从 ACP Registry 安装」「连接已安装 CLI」「连接本地/远程服务」「导入 Adapter 插件」「自定义 Runtime」。

自定义表单包括：名称、协议类型、可执行路径或 Endpoint、启动参数数组、工作目录、环境变量引用、认证方式、超时、并发、平台、能力声明与测试按钮。

CLI 模式不得把任意用户输入拼成 Shell 命令；使用参数数组、权限审批、路径限制、进程树清理。自定义 HTTP 协议需要明确请求/响应映射与事件规范，不得假设所有 REST API 都是 Agent Runtime。

### 18.6 Runtime 管理中心 UI

在设置中新增 Runtime 管理中心，含「已安装」「可发现」「自定义」「诊断」四个视图；显示真实版本、协议、安装状态、认证状态、支持能力、平台兼容性和错误原因。

创建 Agent 时的 Runtime 选择器从 Registry 和已安装 Profile 动态加载，支持搜索、筛选、检测、连接与配置；无效 Runtime 不得标记为可用。延续 V1.4 文字清晰度规范与极简文案。

### 18.7 兼容性测试矩阵与验收

- 对 ACP Registry 至少完成：清单拉取、缓存、版本更新、平台过滤、握手、认证、会话、事件、取消、异常降级测试。
- 至少两种不同厂商的 ACP Agent 完成真实任务；至少一种非 ACP Runtime 通过独立 Adapter 完成真实任务；具体产品由当前可安装性决定并记录版本。
- 自定义 Runtime 从零注册、检测、执行、取消、卸载完整闭环通过。
- 模拟新 Runtime 上架：只更新 Registry 或安装插件，无需修改核心代码和重新编译 Electron。
- 非兼容候选必须显示「未适配/实验性」及原因；不得仅靠 Mock 宣称全生态兼容。
- 新 Runtime 接入后仍必须遵守 V1.3 多 Agent 编排与 V1.4 自动运营的审批、预算、Worktree、审计和执行恢复策略。

### 18.8 参考规范

- 官方 ACP Registry：https://github.com/agentclientprotocol/registry
- 官方机器可读索引：https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json
- ACP 协议：https://agentclientprotocol.com/

> 注意：Registry 内容和各 Runtime 支持能力会持续变化，必须以实施时的官方协议、实际安装版本与运行验证为准，不得将文档中的候选列表写成静态兼容承诺。


## 22. 全版本 UI 设计继承与极简文案规范（P0 强制，不可回退）

### 22.1 版本继承约束
- V1.5 必须继承 V1.1–V1.4 已确定的视觉语言和交互规范；新增 Runtime/Agent 功能只允许增量扩展，不得以重构为名推翻现有导航、页面布局、图标体系、主题 Token、弹窗交互和 Agent 工作流图。
- 在修改任何 UI 前，开发 AI 必须审计现有组件与截图，列出复用项、拟修改项和视觉回归风险；优先复用共享组件。
- V1.3 层级式 Agent 工作流图必须保留：Orchestrator → Agent → Task 的层次关系、依赖连线、任务状态、右侧 Inspector、实时事件、布局持久化；新 Runtime 信息作为节点与详情扩展，禁止替换成纯列表或静态示意图。
- V1.4 的文字清晰度专项整改继续适用于所有 V1.5 新页面和旧页面。

### 22.2 视觉设计基线
- 现代、简洁、克制、精致的 Apple 式桌面视觉；玻璃拟态仅适度用于侧栏、工具栏、弹层等，不牺牲可读性。
- 高密度任务表格、日志、代码、配置表单使用稳定且足够不透明的背景；禁止给文字层施加 blur/filter 或通过容器 opacity 降低对比度。
- 继续使用现有设计 Token、字体、间距、圆角、图标、交互反馈和暗/亮主题；新功能不得引入另一套不统一的视觉体系。
- 普通正文默认不低于 14px，辅助文字原则上不低于 13px；正文对比度不低于 4.5:1，大标题不低于 3:1；100%/125%/150% DPI 下实际截图验收。
- 禁止全局 transform:scale、模糊滤镜、过细字重或灰度过低造成文字发虚。先定位渲染根因，不得默认关闭 Electron GPU 加速。

### 22.3 移除解释性、宣传性和冗余文案
- 删除欢迎语、功能宣传语、重复介绍、卡片说明长段落、无意义副标题、教学式提示及 AI 自动生成的“本功能可以帮助您……”文案。
- 界面只保留完成操作必需的信息：标题、字段名、状态、数值、操作、必要的错误说明、安全风险和权限确认。
- 不得以“极简”为理由删除关键错误、权限范围、危险操作确认、安装缺失原因、Runtime 兼容性限制、数据丢失风险等必要信息。
- 优先采用简短标签：如“创建 Agent”“人设”“技能”“Runtime”“检测环境”“运行中”“待审批”；不写营销式说明。
- 空状态简短给出下一步操作；不堆叠长篇引导和重复按钮。
- Agent 创建/编辑、Persona、Skills、Runtime 目录、Runtime 插件、连接诊断、执行日志、流程图 Inspector、设置等全部页面适用。

### 22.4 交互一致性
- 复用当前“创建 Agent”弹窗骨架：名称、人设、Skills、Runtime、模型、工作方式、权限；高级项折叠，底部操作区固定；长表单可滚动。
- Runtime 安装与状态使用真实检测结果，不允许装饰性“已连接”或虚假成功反馈。
- Agent 流程图保留已有布局和交互，不允许为增加 Runtime 节点重新做成风格不一致的新页面。
- 图标、hover、focus、禁用、错误态、加载态、快捷键、键盘可访问性必须遵循现有组件规范。

### 22.5 AI 编程 Agent 的强制执行与验收
- 开工前生成 UI 继承检查表，附现有界面截图或组件清单；禁止直接全站重绘。
- 对所有新增页面进行文案审查，删除解释性/营销性文字；保留安全和错误信息。
- 完成后提供旧版与新版关键页面对比截图：创建 Agent、Runtime 管理、Skills 管理、Agent 流程图、深浅主题。
- 自动检查文字对比度、字号、文本溢出和响应式布局；人工复核 Windows Electron 100%/125%/150% 缩放。
- 验收失败条件：出现无意义说明文案、低对比度灰色小字、字体发虚、流程图降级为静态图、与既有视觉风格不一致、旧功能交互被破坏。
- 以上规则为 V1.5 的 P0 发布门槛，不得延期为“后续优化”。
