# ProjectOS V1.3 — 智能项目编排与多 Agent 可视化实施设计说明书

> 文档性质：面向 AI 编程 Agent 的增量开发规格（可直接拆解任务）  
> 版本：1.3.0 / 2026-10-19  
> 前置：V1.1 基础平台与 V1.2.x AI Provider、Agent 接入能力已实现或通过审计确认  
> 核心目标：项目感知 → 需求拆解 → 多 Agent DAG 编排 → Worktree 隔离执行 → 验证 → 交接/恢复 → 项目记忆更新。  
> 重要：截图仅作视觉参考，不代表功能已经实现；不得照搬其品牌、Logo、具体界面素材。

## 0. 给 AI 开发 Agent 的强制执行指令

1. **先审计后修改**：检查当前仓库、package.json、现有数据库迁移、Runtime、IPC、Provider、任务/会话模块、UI 组件；输出 `docs/audits/v1.3-baseline.md`，列出已有/缺失/部分实现能力、文件路径、复用方案；不得假设 V1.2 全部完成。
2. **增量升级**：不推倒重做 V1.1/V1.2，不更换既有框架；已有模块优先扩展接口和迁移，不创建平行重复系统。
3. **禁止伪实现**：不能用静态数组、随机进度、定时器假数据冒充 Agent、任务、状态和图节点。演示数据必须显式标记 Demo。
4. **严格执行权限**：Agent 的 Shell、文件写入、Git 合并、网络、部署必须经既有 Policy Engine；未经授权不得绕过。
5. **逐里程碑交付**：每一阶段提交变更文件、数据库迁移、测试、截图、运行命令、验收证据和剩余风险；未通过不得标记完成。
6. **UI 文案克制**：页面不放营销语、重复功能介绍、长段解释；保留操作标签、状态、必要错误与安全提示；详细帮助进入 Tooltip/文档。
7. **跨平台**：至少 Windows 11 作为主验收平台；文件路径、进程启动和 Git Worktree 必须兼容 Windows；不假设 Bash 可用。
8. **不得声称外部 Agent 的内部状态可恢复**：只能在适配器支持的能力范围内恢复；不支持时以任务交接与新 Run 续作。

## 1. 产品边界与成功标准

### 1.1 本期 P0
- 项目扫描与技术栈索引：导入仓库后检测语言、框架、包管理器、Git 分支、目录模块及关键依赖。
- 自然语言需求转结构化计划：生成可编辑的 Task DAG、验收标准、风险、工作量粗估，用户批准后执行。
- 多 Agent 编排：Orchestrator、Architect、Developer、Reviewer、Tester 作为可配置角色，实际执行后端来自 V1.2 Agent Driver/Provider。
- 持久化任务依赖、Agent Run、事件、消息、交付物和恢复点；重启后可继续工作。
- **多 Agent 可视化编排工作台**：画布呈现 Agent 层级、任务关系、运行状态和数据流，点击节点进入详情，图和右侧详情实时联动。
- 自动验收：代码修改后执行已配置测试/检查，记录可验证结果；未通过不能自动完成任务。

### 1.2 P1
- Git Worktree 并行隔离与安全合并；项目记忆索引和相关性检索；Skill 路由；依赖关键路径视图；运行指标。

### 1.3 非目标
- 云端多租户、生产环境自动部署、插件商店、无限递归子 Agent、完整 IDE 替代、未经授权的自动合并主分支。

### 1.4 端到端验收
在一个真实本地 Git 项目中输入“增加 RBAC 权限管理”，系统扫描仓库、产出可编辑 DAG、用户批准、至少两个真实 Agent/角色完成串行交接、Developer 修改隔离工作区、Tester 验证、UI 图实时更新；强制关闭并重启后可恢复任务/事件/图布局，所有结论可追溯至 Run、Git commit、测试记录。

## 2. 总体架构与依赖边界

```text
React/Electron Renderer
  ├─ Project Workspace (overview / requirements / tasks)
  ├─ Multi-Agent Graph Canvas (React Flow / @xyflow/react)
  └─ Agent Inspector / Event Timeline / Approvals
                 │ typed preload IPC
Electron Main ───┤ security + runtime supervisor
                 │ typed IPC
Node Runtime
  ├─ Application Services + Project Domain
  ├─ Project Analyzer ──── File/Git/Parser Adapters
  ├─ Planning Service ──── Provider/Agent Driver (V1.2)
  ├─ Orchestrator ──────── Scheduler / Lease / Handoff
  ├─ Verification Service ─ Test/Review Artifacts
  ├─ Context/Memory Engine ─ Knowledge/Artifact Index
  └─ SQLite (source of truth) + Outbox + Event Stream
```

依赖规则：UI 仅依赖 `contracts` 和客户端 SDK；业务领域不 import Electron/React/ORM/模型 SDK；Orchestrator 通过 `AgentDriver`、`WorkspaceService`、`PolicyService` 接口调用；图布局不改变真实任务依赖；SQLite 写操作仅由 Runtime 负责。

## 3. Monorepo 增量目录

```text
apps/desktop/src/renderer/features/
  orchestration/
    pages/OrchestrationWorkspace.tsx
    components/AgentGraphCanvas.tsx
    components/AgentNode.tsx
    components/TaskNode.tsx
    components/DependencyEdge.tsx
    components/GraphToolbar.tsx
    components/AgentInspector.tsx
    components/RunTimeline.tsx
    components/PlanApprovalDrawer.tsx
    hooks/useGraphProjection.ts
    hooks/useRunEventStream.ts
    store/graph-ui.store.ts
  project-analysis/
  planning/
packages/
  project-analyzer/src/{scanner,detectors,indexer,git}/
  planning/src/{plan-generator,dag-validator,approval}/
  orchestration/src/{scheduler,assignment,lease,dispatcher,recovery}/
  collaboration/src/{handoff,mailbox}/  # 扩展已有包
  verification/src/{quality-gates,reporting}/
  graph-projection/src/{builders,layout,selectors}/
  context-engine/src/{project-index,provenance}/  # 扩展已有包
  contracts/src/{analysis,plans,graph,run-events}/
  persistence/src/{migrations,repositories}/
tests/{integration,recovery,e2e,visual}/
docs/{adr,protocols,audits}/
```

如果仓库已有等价目录/包，按实际路径合并，**不得为了符合此示例而重构全部现有工程**。

## 4. 项目感知与索引

输入：用户选定工作区绝对路径；扫描前验证路径存在且在授权范围内。扫描遵循 `.gitignore` 和排除列表（`node_modules`, `dist`, `.git/objects`, 二进制、大文件、密钥）；支持取消、限时、增量重扫。

输出：`ProjectSnapshot`（项目根、Git HEAD、扫描时间、语言/框架、包管理器、入口点、模块列表、依赖、证据路径、置信度、警告）。不要声称静态扫描就能准确理解所有代码语义。Java Spring 项目识别 Maven/Gradle、Controller/Service/Repository；TS 项目识别 workspace、Vite、React、Node、Electron。

```ts
interface ProjectSnapshot {
  id: string; projectId: string; gitHead?: string;
  scannedAt: string; languages: string[];
  frameworks: Array<{ name: string; evidence: string[] }>;
  modules: Array<{ id: string; path: string; kind: string }>;
  warnings: string[]; indexVersion: number;
}
interface ProjectAnalyzer {
  scan(projectId: string, signal: AbortSignal): Promise<ProjectSnapshot>;
}
```

## 5. 需求规划与 DAG

输入：自然语言目标、项目快照、有效 ADR、已有任务、约束。输出 `PlanDraft`：目标、范围、假设、问题、任务节点、依赖边、验收标准、风险。计划初始为 `draft`，用户编辑并 `approve` 后方可排队执行；修改已批准计划须生成新 revision，不得覆盖历史。

任务状态：`backlog → ready → running → review → done`，另有 `blocked/failed/cancelled`；依赖未满足不得 `ready`；任务 DAG 必须无环、引用有效且同项目；支持用户手动调整依赖并重新验证。任务与 Agent 角色是不同概念，不能把每个 Agent 节点直接当任务。

```ts
interface PlannedTask {
  id: string; title: string; description: string;
  role: 'architect'|'developer'|'reviewer'|'tester'|'custom';
  dependsOn: string[]; acceptanceCriteria: string[];
  expectedArtifacts: string[]; requiresApproval: boolean;
}
interface PlanDraft {
  id: string; projectId: string; revision: number;
  status: 'draft'|'approved'|'rejected';
  tasks: PlannedTask[]; assumptions: string[]; risks: string[];
}
```

## 6. 多 Agent Orchestrator

调度器由 SQLite 中的真实任务和依赖驱动，不由前端图驱动。推荐初期每项目并发 2、全局并发 3（配置项），按任务就绪度/优先级/资源限制选择；任务 Lease 采用单调 fencing token + 到期时间，提交时验证 token；失败使用有界重试与退避，避免无限循环。

Agent 路由：`role → preferred driver → fallback driver`，需要匹配工具调用、文件读写、会话能力；能力不足时提示而非静默降级。任务交接包含 `taskId, planRevision, workspaceRef, gitHead, artifacts, acceptanceCriteria, pendingIssues, provenance`；通过持久化 Mailbox 发送，ACK 去重；唤醒成功不等于任务接受。

```ts
interface OrchestrationService {
  startPlan(planId: string): Promise<string>;
  pausePlan(planId: string): Promise<void>;
  resumePlan(planId: string): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  retryTask(taskId: string): Promise<string>;
}
interface AgentAssignment {
  taskId: string; agentDefinitionId: string;
  driverId: string; runId?: string;
  leaseToken?: number;
}
```

恢复规则：应用启动先标记失联运行、检查进程/租约/副作用，能恢复则恢复，否则创建后续 Run 并引用原 Checkpoint；Git 写入/合并、部署等外部副作用禁止无条件自动重试。

## 7. 多 Agent 流程图式可视化工作台（本期重点）

### 7.1 视觉目标

参考用户截图的“顶部总览 + 中央层级 Agent 节点图 + 底部依赖流 + 右侧 Agent Chat/Inspector”信息组织方式，**不复制品牌和图标**。保留 V1.1 Apple 风格：深色优先、玻璃质感、圆角、低对比表面、清晰层级；图节点可用克制的角色强调色。避免每个卡片都长篇描述。

### 7.2 布局（桌面 1440×900 基准）

```text
┌────────────────────────────────────────────────────────────────────┐
│ ProjectOS  / 项目名      搜索         运行状态 / 设置 / 布局操作     │
├────────────┬──────────────────────────────────────┬────────────────┤
│ 导航侧栏   │ Agent Graph Canvas                   │ Inspector      │
│ 项目       │  [Orchestrator]                      │ Agent / Task   │
│ 任务       │     ├──────┬───────┐                 │ 状态 / 进度    │
│ Agent      │ [Architect][Developer][Tester]       │ 会话/事件      │
│ 文件       │     │         │        │             │ 操作 / 审批    │
│ 设置       │ [DB Task] [API Task] [QA Task]       │                │
│            │──────────────────────────────────────│                │
│            │ Dependencies Flow / Timeline         │                │
├────────────┴──────────────────────────────────────┴────────────────┤
│ Runtime / 连接 / 活动任务 / Git 分支 / 错误计数                      │
└────────────────────────────────────────────────────────────────────┘
```

布局默认：左栏 216–248px；右栏 320–380px；中央自适应，最小宽 600px；允许拖动分隔线和折叠两侧。窗口较窄时右侧变抽屉，图可平移缩放；不得用缩小文字解决空间不足。

### 7.3 图形技术

推荐 `@xyflow/react` (React Flow) 负责节点、连线、缩放、平移、选择、Minimap；`@dagrejs/dagre` 初期用于有向层级自动布局；复杂子图后续可替换 ELK。图布局仅为 UI 投影，数据库任务 DAG 是唯一依赖真相。

节点类型：`orchestrator`、`agent`、`task`、`milestone`、`approval`；边类型：`delegation`、`dependency`、`handoff`、`artifact-flow`。不同类型必须在视觉和语义上可区分，不能把所有线都叫依赖。

节点显示：角色/任务名称、真实状态、当前任务、进度（有可靠数据才显示百分比）、简短运行指标、错误提示入口。节点状态：idle / queued / running / waiting / blocked / failed / completed / paused。状态颜色和图标双重编码，避免只靠颜色识别。

### 7.4 关键交互

- 单击节点：右侧 Inspector 显示身份、任务、Run、最近事件、Artifact、工作区分支、操作；选中图节点与任务列表双向同步。
- 双击节点：打开 Agent 会话或任务详情（可配置）。
- 画布：缩放、平移、适配视图、Minimap、自动布局、重置布局、聚焦运行中/失败节点。
- 连线：默认只读；进入“编辑计划”模式才能拖拽依赖，提交前验证无环和审批；Agent 层级连线不自动改变任务依赖。
- 图更新：通过 Runtime 事件订阅增量刷新，掉线后按 `lastEventSeq` 补齐，必要时重新拉取快照；避免全图每 token 重排。
- 右侧面板：Agent Chat、运行事件、文件变更、审批、错误诊断采用 Tab；消息流和图状态使用同一 Run ID 关联。
- 用户可保存个人图布局（位置/缩放/折叠），不会改变实际调度顺序。
- 图超过 100 节点时分组/折叠/虚拟化；在 200 节点压力测试中仍可操作。

### 7.5 组件接口与数据投影

```ts
type GraphNodeKind = 'orchestrator'|'agent'|'task'|'milestone'|'approval';
type GraphEdgeKind = 'delegation'|'dependency'|'handoff'|'artifact-flow';
interface GraphNodeDTO {
  id: string; kind: GraphNodeKind; label: string;
  status: 'idle'|'queued'|'running'|'waiting'|'blocked'|'failed'|'completed'|'paused';
  projectId: string; taskId?: string; agentId?: string; runId?: string;
  progress?: { completed: number; total: number };
  updatedAt: string;
}
interface GraphEdgeDTO {
  id: string; source: string; target: string; kind: GraphEdgeKind;
}
interface GraphSnapshot {
  projectId: string; revision: number; lastEventSeq: number;
  nodes: GraphNodeDTO[]; edges: GraphEdgeDTO[];
}
interface GraphProjectionService {
  getSnapshot(projectId: string): Promise<GraphSnapshot>;
  getEventsAfter(projectId: string, seq: number): Promise<GraphEvent[]>;
}
```

事件示例：`task.status.changed`、`agent.run.started`、`agent.run.completed`、`handoff.accepted`、`approval.requested`、`artifact.created`。Graph Projection 由领域事件计算，不从 AI 自然语言回复推测运行状态。

### 7.6 设计令牌与视觉规范

- 采用 Ant Design Token + CSS Variables：8px 间距基准，圆角 12/16/20px，动画 120–220ms；尊重 `prefers-reduced-motion`。
- 玻璃拟态主要用于侧栏、顶部栏、浮动 Inspector 和浮层；代码、图节点正文、密集表格使用不透明/高可读背景。
- 暗色背景建议接近深海军蓝/石墨黑；强调色蓝紫为主，运行绿、等待琥珀、错误红，需检查 WCAG AA 文本对比度。
- 图线条细且低饱和；运行中可用轻微脉冲/边框光效，避免连续闪烁和大面积渐变。
- 空状态：`暂无 Agent` + `添加 Agent`；禁止“欢迎来到未来智能协作空间”等宣传语。
- 必须提供加载、无数据、连接中断、权限不足、任务失败、重试等状态的完整 UI。

## 8. Git Worktree 并行与质量验收

同仓库并行写入必须使用独立 Worktree 或明确的互斥写入策略。Worktree 创建前检查 Git 仓库与未提交更改，分支命名 `projectos/task-<id>`；执行后生成 diff、测试报告、变更清单。合并到主分支前必须获得用户批准，处理冲突时停止自动合并并给出差异视图。清理 Worktree 需确认无未提交成果。

质量门禁：至少支持 `lint`, `typecheck`, `test`, `build` 可配置命令；记录 exit code、耗时、日志路径、对应 commit；验证失败进入 `review/blocked` 或生成修复任务，禁止凭模型口头结论标记 done。对不提供测试命令的项目显示“未配置”，不能假装通过。

## 9. SQLite 增量迁移（建议）

先检查现有 schema；若已有等价表，扩展而非重复。以下为新实体建议，主键用 TEXT（UUID/ULID），时间戳统一 INTEGER 毫秒；所有外键启用。

```sql
CREATE TABLE IF NOT EXISTS project_snapshots (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
 git_head TEXT, payload_json TEXT NOT NULL,
 index_version INTEGER NOT NULL, scanned_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshot_project_time
 ON project_snapshots(project_id, scanned_at DESC);

CREATE TABLE IF NOT EXISTS plan_revisions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
 revision INTEGER NOT NULL, status TEXT NOT NULL,
 plan_json TEXT NOT NULL, approved_at INTEGER,
 created_at INTEGER NOT NULL, UNIQUE(project_id, revision)
);

CREATE TABLE IF NOT EXISTS agent_assignments (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL,
 agent_definition_id TEXT NOT NULL, driver_id TEXT NOT NULL,
 run_id TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_reports (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL,
 run_id TEXT, git_head TEXT, status TEXT NOT NULL,
 checks_json TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_layouts (
 project_id TEXT NOT NULL, view_id TEXT NOT NULL,
 layout_json TEXT NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(project_id, view_id)
);
```

必要时扩展 `task_dependencies`, `task_leases`, `project_events`, `outbox`, `handoffs`, `artifacts`；确保项目事件序号唯一、同事务提交状态与 outbox、消费端幂等。Graph Layout 不保存 Agent 执行状态。

## 10. IPC / API 契约

命令（示例）：
- `project.scan` / `project.snapshot.get`
- `plan.generate` / `plan.revise` / `plan.approve` / `plan.reject`
- `orchestration.start` / `orchestration.pause` / `orchestration.resume`
- `task.assign` / `task.retry` / `task.cancel`
- `graph.snapshot.get` / `graph.events.after` / `graph.layout.save`
- `verification.report.get` / `agent.inspector.get`

所有 IPC 使用 Zod Schema 验证，带 requestId、projectId、权限上下文、可取消标记和结构化错误码；事件采用 projectId + seq，Renderer 断线重连需补事件。Graph 不直接执行 Shell/Git，所有操作由 Application Service + Policy Engine 授权。

## 11. 实施里程碑与验收

### M1.3-00 现状审计（必须先做）
交付：现有包/数据库/Agent Driver/IPC/UI 对照清单、迁移风险、复用决策。验收：每项均给文件路径或缺失证据。

### M1.3-01 项目扫描
交付：扫描器、索引表、项目概览、增量重扫。验收：TS/Electron 与 Java/Spring 示例仓库识别正确；不扫描敏感文件内容；可取消。

### M1.3-02 计划与审批
交付：PlanDraft、DAG 校验、编辑/审批 UI、计划版本。验收：阻止环路和未批准执行；重启后计划仍在。

### M1.3-03 Orchestrator
交付：任务就绪调度、Agent 路由、Lease、失败重试。验收：依赖任务顺序正确；重复触发不产生重复执行；能力不匹配可解释。

### M1.3-04 Agent Graph 工作台（本期重点）
交付：React Flow 画布、层级布局、节点/边类型、Inspector、实时事件、保存布局、键盘操作。验收：真实数据驱动，节点状态与任务数据库一致；点击联动；重启布局恢复；断线补事件。

### M1.3-05 交接与记忆
交付：结构化 Handoff、Mailbox、项目知识索引。验收：跨会话接力不依赖复制完整聊天记录；旧决策标注失效。

### M1.3-06 Worktree 与质量门禁
交付：独立分支执行、diff、测试报告、人工合并审批。验收：并行写不互相覆盖，失败不自动合并，审查记录可追踪。

### M1.3-07 恢复、性能与端到端验收
交付：异常恢复、重复消息测试、视觉回归、性能报告。验收：强制终止 Runtime 后可恢复项目任务和图状态；200 节点交互流畅（在目标硬件实测并记录）。

## 12. 自动化测试用例（必须覆盖）

| ID | 场景 | 通过标准 |
|---|---|---|
| T01 | 导入真实 TS 项目 | 正确识别框架、Git HEAD 和模块 |
| T02 | 导入 Spring 项目 | Maven/Gradle 与典型分层识别 |
| T03 | 计划存在环路 | 拒绝审批，定位冲突边 |
| T04 | 未批准计划启动 | 拒绝并提示需要审批 |
| T05 | 两个 Agent 争抢同任务 | 只有有效租约提交成功 |
| T06 | 开发任务未完成时启动测试 | 测试任务保持 blocked/queued |
| T07 | Agent Driver 不可用 | 明确报错或经授权回退 |
| T08 | 工具执行成功但 Runtime 崩溃 | 不盲目重复副作用 |
| T09 | 交接消息重复投递 | 幂等消费，不重复执行 |
| T10 | 图节点点击 | Inspector 展示对应真实 Run |
| T11 | 图数据事件断流 | 按 seq 补齐并同步状态 |
| T12 | 画布布局修改并重启 | 恢复位置、缩放和折叠 |
| T13 | 200 节点压力测试 | 交互可用且无严重卡顿 |
| T14 | Worktree 并行修改 | 修改相互隔离 |
| T15 | 测试失败 | 不得标记任务完成 |
| T16 | 窗口 1280×720 | 无关键控件遮挡，Inspector 可收起 |
| T17 | 暗/亮模式与缩放 | 文字清晰、对比达标 |
| T18 | UI 文案检查 | 无重复描述、营销性长文案 |

## 13. AI 实施报告模板

每完成一个里程碑必须输出：

```text
里程碑：M1.3-XX
现状审计与复用：...
实际修改文件：...
数据库迁移：...
新增/调整接口：...
执行命令与测试结果：...
UI 截图路径（至少 1440×900、1280×720）：...
验收项逐条结果：PASS / FAIL / BLOCKED
风险与遗留问题：...
下一步建议：...
```

禁止使用“功能已完成”替代真实测试证据。对无法连接真实 AI Provider 的测试，明确标记 Mock；不得把 Mock 通过当作真实端到端通过。

## 14. 建议开发启动提示词

```text
你是 ProjectOS 项目的主工程 Agent。请读取 docs/ProjectOS_V1.3_Implementation.md。
先完成 M1.3-00：审计仓库现状并输出复用清单、缺失模块、架构差异、数据库迁移风险。
未经审计不得修改代码。审计后按 M1.3-01 至 M1.3-07 顺序增量实现。
重点实现基于真实任务/Agent Run 的 React Flow 多 Agent 层级编排画布，包含节点状态、连线语义、Inspector、事件实时同步和布局持久化。
沿用 V1.1 的现代极简与克制玻璃拟态；删除无意义解释性文案。
每个里程碑提交代码、测试、截图、验收证据；不得用假数据冒充实际执行。
```

## 15. 技术依赖与参考

- React Flow / XYFlow：`https://reactflow.dev/`；用于可交互节点图。
- Dagre：`https://github.com/dagrejs/dagre`；用于简单层级自动布局。
- Electron Security：`https://www.electronjs.org/docs/latest/tutorial/security`。
- Ant Design：`https://ant.design/`；Ant Design X：`https://x.ant.design/`。
- Open Cross-session：`https://github.com/leeguooooo/open-cross-session`；仅作为可选跨 Agent Transport Adapter 参考。

**最终定义：V1.3 的验收不以画布是否好看为终点，而以“画布能够准确呈现并控制真实项目 Agent 协作”作为成功标准。**
