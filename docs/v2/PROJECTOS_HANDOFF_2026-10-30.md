# ProjectOS 接力开发方案

交接日期：2026-10-30。接收者：继续开发当前 ProjectOS 工作目录的 AI。

请在当前实现上继续完成需求驱动的开发流程，优先减少人的重复操作，再完善 Agent 能力组合和设置。需求流程、拖拽编辑器和真实执行已经实现，不要从头搭建另一套工作台。以下“当前事实”和“后续实施”分开列出；后续内容不是已完成声明。

## 接管当前工作区

| 项目 | 当前值 |
|---|---|
| 仓库 | l541402398/ObjectOS |
| 产品 | ProjectOS |
| 工作目录 | `C:\Users\Administrator\Desktop\workplace\ProjectOS-v2-phase2.4` |
| 分支 | `codex/premium-system` |
| HEAD | `f71d33e8acd70ec579501873c327e5b1180ee02a` |
| 工作区 | 大量已修改及未跟踪文件，包含此前 UI、需求隔离、成果集成与最新流程实现 |
| 当前生产样式 | 用户恢复并确认的蓝青 Premium Liquid Glass |
| 本轮执行范围 | 本交接轮只核对状态并补充交接文档，没有继续修改产品代码或重新运行测试 |

**当前成果尚未提交。只克隆远程仓库、切到此 HEAD，或只复制这份方案，都不能得到本轮代码。** 同机接力直接使用上面的工作目录；异机交接需要同时携带已修改文件、未跟踪源码、ADR 和证据目录。普通 `git diff` 不含未跟踪文件。不要复制账号密钥、实际用户数据库或其他私人运行资料作为开发交接包。

进入目录先运行并阅读结果：

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
git diff --stat
```

禁止 reset、clean、强制 checkout 或整包覆盖。保留现有差异，不把此前开发成果当成需要清理的脏文件。用户没有授权本次接力自动推送、合并主分支或发布；仓库中关于提交证据的要求不构成远程发布授权。

交接时重新核对了最新验收 manifest 中的 90 个源码及文档指纹，均一致。接手时仍需重新核对，不将 HEAD 当作未提交源码的完整标识。

## 已确定的产品决策

1. **层级是需求 → 任务 → 流程节点及负责 Agent。UC 已整体退出当前产品模型。** 用户自己定义需求大小，不再增加中间分组步骤。
2. 需求是交付单元；开发任务使用独立工作区。一个需求选择一个流程版本，它产生的每个任务都执行该流程。不要擅自改为整个需求只执行一遍流程，或只让开发任务执行其中部分节点。
3. 流程节点可自由组合。初始提供需求分析、需求审核、技术设计、技术设计审核、开发、测试，另有代码审查、知识更新。需求文档、设计文档和审核结果是可追溯的真实资料。
4. 用户可以选已有模板，也可以拖拽创建并保存模板。流程版本与执行实例分离；已运行的需求不能被编辑模板追溯改写。
5. 自主、辅助等原有工作模式必须保留。工作模式、流程节点的 Agent 分配方式、工具授权是三件不同的事，不能用一个“自动”开关混为一谈。
6. 模型服务、执行引擎和 Agent 必须明确区分。Agent 的角色和能力配置不能等同于模型供应商，也不能等同于一个命令行工具。
7. 保留真正的 Agent 协作画布、依赖连线、流向、选中详情和布局保存，不恢复聊天式协作内页。
8. UI 继续使用蓝青玻璃主题。用户已否定后来尝试的 Soft Studio 方向；不要因为旧设计包、旧灰白方案或未撤销的历史文字而再次换主题。
9. 简化操作的目标是让人清楚“当前发生什么、需要我处理什么、下一步是什么”。减少重复输入、跳页和多余确认，保留真实错误、必要审批、版本核对和未知结果处理。

受影响的旧文档中仍会出现 UC：ADR-0073、ADR-0074 的分组表述已被最新用户决策与 ADR-0076 取代，其工作区隔离、内容审查和独立授权约束仍应保留。历史迁移、历史审计 JSON、已冻结截图不应为了消除字面词汇而破坏。

## 接手必须阅读的资料

文内代码路径均相对上述仓库根目录。先按根目录 `AGENTS.md` 的完整清单阅读，再检查拟修改文件的实际内容。

- `AGENTS.md`、`ProjectOS_AI开发实施设计说明书_v1.1.md`、`docs/architecture.md`。
- [最新流程契约 ADR-0076](../adr/0076-requirement-owned-workflows.md)、[过渡决策 ADR-0075](../adr/0075-direct-requirement-tasks.md)、[成果集成约束 ADR-0074](../adr/0074-reviewed-task-integration.md)。
- [本批真实实现与验收](evidence/requirement-guided-flow/REPORT.md)、[源码及截图指纹](evidence/requirement-guided-flow/manifest.json)。
- [前一批成果集成证据](evidence/requirement-integration/REPORT.md)、[更早需求工作台证据](evidence/requirement-work/REPORT.md)。后者的 UC 界面属于历史，不是当前目标。
- UI 契约：`docs/design/PROJECTOS_UI_CONTRACT.md`、`DESIGN.md`、`DESIGN_CHANGELOG.md`、`OVERLAY_SYSTEM.md`、`OVERLAY_AUDIT.md`、`PROJECTOS_DESIGN_SYSTEM.md`。
- UI 状态：`docs/next-ui/BASELINE_AND_RECOVERY.md`、`MIGRATION_PROGRESS.md`、`OPEN_ISSUES.md`、`VISUAL_BASELINE.md`、`VISUAL_REGRESSION_INVESTIGATION.md`。
- 实际查看 `docs/design/baselines/2026-10-29-user-confirmed-DAG.png`、Design Lab 当前源码和下方本批真实截图。保护基线为 `0686c41` / `visual-baseline-approved-0686c41`；被拒绝的正式 `PLAN REVIEW · R1` Modal 不能作为批准稿。

UI 开发按 AGENTS 要求实际查阅 UI UX Pro Max、Vercel composition / React best practices、Impeccable、Sim 画布源码、现有 Liquid Glass React / React Bits 来源及 Motion。上一批的查阅和不适用项已记录在验收报告。接力环境里若技能或工具不可用，明确写出；不要把“知道这个项目”写成“已使用其源码”。本地 `.tmp/reference-*` 参考目录不保证会随 Git 携带。

## 当前已经实现的内容

| 能力 | 当前事实 |
|---|---|
| 移除 UC | 活跃类型、API、preload、Runtime、界面与分组存储已清理。V42 保留旧分组说明为资料并保留任务链接，不重写历史审计。 |
| 需求与流程 | 新建需求时选模板，或在同一弹层内新建流程后返回原表单。已有旧需求可绑定流程。 |
| 拖拽编辑器 | React Flow 的实际节点、连线、布局保存、点击与键盘替代、前置节点选择、循环校验、未保存保护均已接通。 |
| 模板和继承 | 三个内置模板；任务的公共持久化路径建立流程实例。手工创建、Agent 创建与 AI 计划审批生成的任务走同一继承路径。 |
| Agent 分配 | 手工逐节点选择；AI 使用当前模型连接给出经校验的真实分配。自主模式自动补全未分配节点，不覆盖已有人工选择。 |
| 原生节点执行 | 复用 AgentRunner、协调器、租约、Run、ToolCall、Artifact；点击开始后推进后续节点；可暂停、重试、核对异常。 |
| 节点完成条件 | 文档有真实正文；审核结论绑定输入版本；测试需要真实成功命令和未变化的代码指纹；配置节点全部通过才允许任务完成。 |
| 资料入口 | 需求工作台上方的实际流程阶段可打开资料；协作图点击 Agent 后在原详情中阅读其产出。 |
| 任务隔离与成果集成 | 独立任务 worktree；真实代码审查、测试命令授权、任务验收、Git 合入授权；新准备的依赖任务获得前置任务已合入的代码。 |
| 原有 UI 工作 | 蓝青玻璃恢复、中文字体、启动动画、具名全局旅程及原有协作画布等修改保留。 |

不要把 `flow completed`、任务验收通过、已合入需求分支、整条需求已交付、外部部署成功视为同一个状态。

## 当前仍未完成的内容

- 每个任务仍需显式点击一次“开始流程”。AI 分配已自动化，但新流程与原有计划授权的自动启动尚未完整衔接。
- 手工分配仍主要逐任务逐节点操作，缺少需求级默认分配及批量应用。
- 新资料旅程只在需求工作台；其他页面仍使用原项目目标旅程。`AppLayout.tsx` 目前对 `requirements` 隐藏旧旅程，避免叠加。
- 插件式 Agent 能力组合与设置整理未完成；但已有 AgentDefinition、Skill、RuntimeProfile 和插件契约，不能误判为从零开始。
- 需求整体验证、验收及交付闭环、已创建任务工作区追上更新基线、冲突处理界面仍未完成。
- 外部 CLI Runtime 未接入新流程产物协议，当前明确拒绝该执行路径。原生流程成功不代表 Codex CLI、Claude Code 等已支持该流程。
- 组织升级的 A2.2b 远程作业执行仍是独立待办。不要把账号、组织资产及设备准备等已有阶段理解成团队远程执行已经闭环。
- 外部真实模型质量、系统 DPI 125%、人工读屏、触屏输入、新 GPU 性能测试及用户最终审美验收尚未完成。

## 后续实施顺序

### 第一批 减少需求启动与分配操作

先完成这一批并真实验收，再扩展后续范围。目标是让人工模式与辅助模式也容易上手，不依赖自主模式掩盖流程复杂度。

用户操作主线收敛为“描述需求并选流程 → 确认任务安排并开始 → 处理必要审批与查看成果”。这些是界面组织阶段，不是删除后台六个业务节点，也不意味着每次需求只有三次点击。

具体实施：

1. 在需求层设置各流程节点的默认 Agent，一次配置可用于后续任务。提供“应用到尚未分配的任务”和明确的批量调整预览；保留单任务覆盖。人工选择与已经启动的节点不可被静默替换。
2. 不要为调整负责人调用当前 `requirement.flow.bind` 重建所有实例。该 API 用于未开始需求的换模板；批量分配需独立的 typed API、版本校验和事务边界。
3. 需求级“开始执行”由 Runtime 检查任务依赖、Agent、工作区、预算、冻结版本、现有 Run 与授权，持久化启动意图；幂等启动符合条件的任务，逐项返回待授权、依赖等待和失败原因。不能只在 Renderer 循环点击每个任务的开始按钮。
4. 在已有任务草稿确认处整理主操作；若提供“确认并开始”，其含义只是确认计划并启动受既有策略约束的流程。创建 worktree、文件写入、命令、Git 和部署仍需各自的实际权限评估，不能变成一次永久放行。
5. 自主模式接通已有计划授权、暂停/撤销和 RequirementFlowService。只在存在有效且范围一致的启动授权时自动推进；不能因为打开页面或切换模式就执行未获授权的副作用。该部分涉及核心调度与授权契约，应先写新的 ADR。
6. 页面按真实状态显示当前主要动作：确认安排、开始执行、处理授权、处理问题或查看成果。保留完整操作入口于详情，避免同一屏到处放同等突出的按钮。人工暂停后不自动恢复。

验收至少包含：一个需求三个任务共用六阶段默认负责人；一个任务单独覆盖仍被保留；批量请求重复提交不产生重复 Run；过期版本、无效 Agent 和缺失权限明确失败；自主启动授权被撤销后不再启动新节点；等待审批、依赖阻塞、关闭页面、重启和未知副作用不会被误标完成。

### 第二批 统一顶部旅程与资料阅读

复用现有需求流程视图与 `RequirementMaterials.tsx`，把所选需求上下文贯穿概览、任务和协作画布。保留旧项目/计划旅程的兼容路径；一次只显示与当前上下文相符的一套主旅程。

同一阶段可能有多个任务：显示真实的进行中、待审核、失败及未开始数量，允许按任务选择资料；不能以某个任务完成冒充该阶段全部完成。存在并行节点时保留多条进行中的事实，不强行用单一序号解释所有状态。

资料详情展示实际正文、所属需求/任务、产出 Agent、版本、审核结果和运行记录入口。废弃与过期版本明确区分；项目切换、需求切换及直接链接不得读取前一项目的缓存资料。聚合状态必须来自持久化数据，不能由画布坐标推断。

验收包含跨页返回、深链接、多个并行任务、空资料、长文、加载失败、文档被更新后旧审核失效、1024 窗口与键盘打开关闭。沿用字体就绪与页面加载机制，避免恢复“框架先显示、文字明显滞后”。

### 第三批 完成 Agent 能力组合

“插件式 Agent”优先落为现有 AgentDefinition 的可组合能力配置，不先建立插件市场或第二套执行引擎。

| 概念 | 应承担的职责 |
|---|---|
| 模型服务 | 连接、模型选择、真实推理可用性、用量；密钥仍归 Main |
| 执行引擎 | Native 或已明确支持的 CLI / ACP 适配，负责实际运行能力 |
| Agent | 身份、职责、指令、能力组合、项目/组织可见范围 |
| 能力 | 经验证的 Skill、工具、MCP 绑定与上下文来源；具有实际版本及可用状态 |
| 流程节点 | 输入、输出、审核条件、负责 Agent 和执行记录 |

先审查现有 `agent-studio.ts`、AgentDefinition 的 skills/runtime/model/permissions 字段、组织资产版本绑定、插件管理及工具注册实现。扩展复用它们，避免另起 AgentProfile / ProviderManager / Runtime。

能力配置需要从 UI 保存一直连到真实 Run：执行前检查可用性、组织/项目范围、引擎兼容性与策略；记录本次使用的版本。Agent 可用能力不等于所有工具已获授权，实际工具仍走已有策略与审批。能力缺失显示可操作错误，不能在页面上显示已启用、执行时却根本不读取。

首批先做现有能力的选择、启停、版本绑定、执行验证；任意第三方脚本安装、组织远程执行或新执行引擎协议应拆分处理。涉及迁移和安全边界先写 ADR。

验收：两个 Agent 使用不同能力配置完成不同节点；更改配置不改写旧 Run 快照；禁用能力或越权资产被 Runtime 拒绝；权限撤销对后续工具调用生效；失败和用量真实记录。

### 第四批 整理设置并打通实际操作

设置继续是全局弹层，连接编辑继续使用内部子视图，禁止套嵌多层 Modal。先建立“现有设置项 → 数据来源/作用范围 → 编辑方式 → 实际生效位置”清单，再决定合并导航。

以下是建议分组，不是新的强制菜单数量：

| 分组 | 现有入口的去向 |
|---|---|
| 账号与组织 | `organization`，保留成员、角色、项目、资产、设备入口 |
| AI 服务 | `ai-connections` 与 `models` 成为相关子视图；模型目录注明来源与可编辑范围 |
| 执行引擎 | `runtime`；明确原生/外部引擎、检测结果与支持能力 |
| 能力与规则 | `tools`、`skills`、`openspec` 分清管理对象，保留安装/配置/启停/验证等实际已有能力 |
| 权限与数据 | `permissions`、`data-security`，作用范围和生效条件可见 |
| 用量与限制 | `usage`、`general` 中相关项；其余通用设置按实际含义归位 |
| 外观与关于 | `preferences`、`about`；设置概览只汇总待处理项和快捷入口 |

现有 section key、命令菜单、旧深链接、错误跳转须有兼容映射。不能删掉难以归类的配置来凑菜单。只读页面明确“由哪里管理”，提供实际可达的修改入口；不造假的“测试成功”“已连接”“启用”状态。全局设置与项目覆盖层必须区分，项目执行动作留在工作区，设置不成为第二个任务调度页面。

验收：配置保存并重启后仍生效；取消不保存；连接测试区分配置检查、可达与真实推理；错误可修复；旧入口都能到正确子视图；窄窗、滚动、焦点和未保存保护无回退。

### 第五批 补齐需求交付与工作区同步

在单任务流程和成果集成之上增加需求整体验证与验收。聚合所有必需任务、当前节点证据、集成记录和需求验收条件；任一未解决失败、待审批或待核对都必须可见。需求合入项目分支、发布和部署仍是独立范围与权限，不因任务完成而自动发生。

已准备的任务目录追上新的需求基线时，要先区分干净/有未提交改动、活动租约、活动 Run 和未知操作。不能自动 rebase、reset 或覆盖人工改动。设计明确的同步预览、授权、冲突处理与恢复方案，并以实际 Git 内容和记录验收。

外部 CLI 流程适配放在原生主路径稳定之后。先定义 Run 关联、资料真实性、审核、测试、工具授权和中断恢复契约；不得把 CLI 的任意输出字符串直接当作可信产物或完成事实。组织远程作业 A2.2b 继续遵循原组织升级 ADR 和阶段报告，独立验收。

## 代码入口

| 功能 | 当前文件 |
|---|---|
| 需求工作台及逐节点负责人 | `apps/desktop/src/renderer/src/pages/RequirementWorkPage.tsx` |
| 流程编辑、资料、计划确认、上下文审批 | 同目录 `RequirementFlowEditor.tsx`、`RequirementMaterials.tsx`、`RequirementPlanDialog.tsx`、`RequirementApproval.tsx` |
| 成果审查与合入 | 同目录 `RequirementIntegrationDialog.tsx`；Runtime `requirement-integration.ts`、`requirement-git.ts` |
| 需求样式 | 同目录 `requirement-flow.css`、`requirement-work.css` |
| 协作图与 Agent 资料 | `apps/desktop/src/renderer/src/features/collaboration-overview/CollaborationOverview.tsx`、`CollaborationGraph.tsx` |
| 全局框架与旅程 | `apps/desktop/src/renderer/src/components/AppLayout.tsx`；`apps/desktop/src/renderer/src/lib/journey.ts`；`apps/runtime/src/journey.ts`；`packages/contracts/src/journey.ts` |
| 设置 | `apps/desktop/src/renderer/src/features/settings/SettingsModal.tsx` 及各 Panel；`apps/desktop/src/renderer/src/stores/ui.ts` |
| 流程调度 | `apps/runtime/src/requirement-flow.ts` 的 `RequirementFlowService` |
| 工作区准备 | `apps/runtime/src/requirement-work.ts` |
| 协调、计划与启动授权 | `apps/runtime/src/autonomy-coordinator.ts`、`dispatcher.ts`、`planner.ts`、`orchestration.ts`、`plan-grant.ts` |
| Agent 与执行 | `apps/runtime/src/agent-studio.ts`、`agent-runner.ts`、`external-runner.ts`；`packages/agent-runtime/src/index.ts` |
| 流程契约与算法 | `packages/contracts/src/requirement-flow.ts`、`packages/domain/src/requirement-flow.ts` |
| 持久化与继承 | `packages/persistence/src/requirement-flow.ts`、`store.ts`、`migrations.ts`；`packages/application/src/task-service.ts` |
| IPC 边界 | `packages/contracts/src/api.ts`、`desktop-api.ts`；`apps/desktop/src/preload/index.ts`；Runtime `dispatcher.ts` |
| 共享视觉体系 | `packages/design-tokens`、`packages/ui`、`packages/ai-ui`、桌面 `next-ui/overlay` |

现有流程 API 包括 `workflow.templates/save/materials`、`requirement.flow`、`requirement.flow.bind/assign/assignAI/start/pause/reconcile/retry`。先核对实际 schema；新增需求级启动/分配 API 不要随意复用语义不一致的旧方法。

V40 为去掉 UC 前置条件的过渡；V41 增加模板版本、需求绑定、任务节点与资料来源；V42 归档旧分组后清理结构。迁移只追加，不重写已应用的旧版本。

一个已修复的协调器细节：部分工作区完成通知是 `project.event` 外壳，真正事件在 `payload.kind`。新调度需保留这条唤醒路径，否则辅助模式可能在工作区授权完成后卡住。

## 必须保留的工程边界

- Renderer 只调用 typed preload，禁止直接访问文件系统、SQLite、命令行或 Node；Main 管理窗口、IPC、密钥与 Runtime 生命周期；Runtime 是业务 SQLite 的单写者。
- Zod 校验进程与信任边界。聊天、画布节点与客户端缓存都不是任务依赖、执行或审批的事实来源。
- 真实任务 DAG 与任务内部流程 DAG 分开；保持无环、任务写租约唯一、单调 fencing token、计划创建任务及依赖的原子事务。
- 创建计划或批准文档不授予写文件、命令、Git 和部署的通用权限。副作用前后保留 ToolCall 与真实审计。
- 中断后的未知副作用进入 `needs_reconciliation`，不能重放。核对操作只确认已经发生的事实，不能偷偷执行遗失步骤。
- 审核、测试、合入证据必须绑定对应版本与内容；更新内容后旧证据不得继续放行。不能以测试模型回复的“通过”代替真实命令结果。
- 新模板版本、新 Agent 能力版本不可改写历史执行。模型服务密钥留在 Main SecretStore，不写 Renderer、数据库、日志或交接材料。

## 验证基线与下一批验收

以下是上一开发批的真实结果，本交接轮没有再次运行：

| 检查 | 结果 |
|---|---|
| Typecheck | PASS |
| Lint 与依赖边界 | PASS，0 error、24 项原有 warning |
| 完整构建及 `package:dir` | PASS |
| 打包 EXE 创建项目与重启恢复 | PASS |
| 最后一轮全量单测 | **613 PASS、1 超时、4 SKIP，结果是 FAIL** |
| 超时所属完整测试文件单独复跑 | 15/15 PASS，未提高超时或删弱断言 |
| 最终流程及协调器定向测试 | 18/18 PASS |
| 旧桌面四套 E2E | PASS |
| 新流程、集成与编辑器原生检查 | 40 + 28 + 6 = 74 PASS，41 张最终截图 |

超时发生在 `tests/requirement-integration.test.ts` 的 `after-merge` 中断恢复用例。当时有桌面回归并行，资源竞争是推测而非已确认根因。全量测试在最后的“自动分配保留人工选择”修正之前执行，之后已跑定向测试、类型检查、lint、构建及桌面回归，未跑第三次全量。不得写成全量全绿。

先做与修改相符的定向检查；阶段完成按 AGENTS 执行真实命令并记录 PASS / FAIL / SKIP：

```powershell
pnpm lint
pnpm typecheck
pnpm exec vitest run tests/requirement-flow.test.ts tests/p27-autonomy-coordinator.test.ts --maxWorkers=1
pnpm exec vitest run tests/requirement-integration.test.ts --maxWorkers=1
pnpm run test --maxWorkers=2
pnpm build
node scripts/e2e.mjs
node scripts/agent-e2e.mjs
node scripts/v12-e2e.mjs
node scripts/v13-e2e.mjs
pnpm package:dir
pnpm test:package
```

`--maxWorkers=2` 是真实全量 Vitest 的并发上限，不是筛选测试。不要同时运行重型 Git 测试、桌面回归和打包；不要在 Electron 回归运行时重建它正在读取的产物。若环境拒绝启动 esbuild、PostgreSQL 或子进程，应使用当前环境允许的授权方式，不能将受阻记录为通过。

新增流程回归脚本：`scripts/requirement-flow-e2e.mjs`、`scripts/requirement-integration-e2e.mjs`。两者可通过 `PROJECTOS_EVIDENCE_DIR` 指向下一批的新证据目录；运行前设置各自独立输出位置，避免覆盖本批证据。`scripts/requirement-work-e2e.mjs` 目前是新流程脚本入口，不再是旧 UC 测试。

**`scripts/requirement-flow-visual-e2e.mjs` 当前会读取旧 `desktop/checks.json` 中的临时 profile，并写固定 editor 目录。** 接力环境不要直接盲跑：先让它接收本次流程回归的实际 profile/清单路径与新输出目录，再执行；旧临时目录可能已经消失。测试 fixture 为 `scripts/helpers/requirement-flow-model.mjs`。

真实运行截图至少检查浅/深主题、1440×900、1280×800、1024×768、125% 应用缩放、减少动效、焦点、长文、密集任务、空态、加载态、错误与审批。正文原则上不低于 14px，辅助文字不低于 13px。缩放画布和系统 DPI 分别记录，不混淆测量。

Electron 截图与真实 Runtime/SQLite/Git 回归已存在，但模型回复是明确标记的本地确定性测试 fixture，不能声称验证了外部真实模型生成质量。新一批如做真实模型验证，记录实际模型、成本范围与失败，不展示密钥。

旧证据目录保持冻结。每批在 `docs/v2/evidence/` 创建新的报告、截图、检查明细及源码指纹，更新 `DESIGN_CHANGELOG.md`、`MIGRATION_PROGRESS.md`、`OPEN_ISSUES.md`。原始输出若被 `.gitignore` 排除，用可纳入仓库的文本副本保存。若以后获准提交，代码与证据同一提交；没有单独授权就不推送。

## 可直接查看的真实画面

- [需求工作台 1440 浅色](evidence/requirement-guided-flow/desktop/workbench-1440-light.png)
- [需求工作台 1024 深色](evidence/requirement-guided-flow/desktop/workbench-1024-dark.png)
- [完整六阶段编辑器](evidence/requirement-guided-flow/editor/six-stages-1440-light.png)
- [编辑器 1024 深色 125%](evidence/requirement-guided-flow/editor/six-stages-1024-dark-125-reduced.png)
- [旅程读取正文](evidence/requirement-guided-flow/desktop/journey-material-1440-light.png)
- [协作图 Agent 资料](evidence/requirement-guided-flow/desktop/agent-material-1440-light.png)
- [上下文真实审批](evidence/requirement-guided-flow/desktop/workspace-approval-1440-light.png)
- [成果审查与验证](evidence/requirement-guided-flow/integration/review-1440-light.png)

## 启动和首轮交付

在仓库根目录运行 `pnpm start` 使用当前构建；开发调试运行 `pnpm dev`。可直接运行 `release/win-unpacked/ProjectOS.exe`，但接力修改代码后应重新构建，不把旧 EXE 画面作为新源码的验收。

真实入口：项目 → 需求工作台 → 新建需求 → 选流程或新建流程 → 手工添加或 AI 拆分任务 → 分配 Agent → 开始流程。当前源码路由为 `#/projects/<projectId>/requirements`，可使用 `?requirement=<requirementId>` 定位需求；不要复制验收 fixture 的 ID 到用户数据。

接力后的第一轮应交付第一批“需求级默认分配和受控启动”的代码、相关 ADR、真实桌面截图与验证记录。说明减少了哪些重复操作、哪些审批仍需用户处理、哪些边界尚未覆盖。遇到用户数据或环境限制，完成不依赖该限制的部分并明确未验证项；不要只再写一份建议，也不要将多批未完成工作全部宣称完成。
