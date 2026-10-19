# 实施状态（M1–M5）

> 以真实代码与自动化验证为准。未完成项不包装成“已支持”。

## M1 — 工程骨架与本地项目持久化（完成）

| 任务 | 状态 | 证据 |
|---|---|---|
| M1-01 pnpm workspace / TS strict / ESLint / Prettier / Vitest | 完成 | `pnpm lint`, `pnpm typecheck`, `pnpm test` |
| M1-02 Electron Main/Preload/React Renderer + CSP/安全窗口 | 完成 | `apps/desktop`，截图与 E2E |
| M1-03 Runtime 子进程 + supervisor + 握手/心跳/重启 | 完成 | `apps/desktop/src/main/runtime-supervisor.ts` |
| M1-04 contracts + Zod IPC + typed preload | 完成 | `packages/contracts`, 双边界校验 |
| M1-05 SQLite 迁移 + 项目 Repository + 创建/列表/打开 | 完成 | `packages/persistence`, `tests/persistence.test.ts` |
| M1-06 项目中心 + 重启恢复 | 完成 | `scripts/e2e.mjs` |

## M2 — 单 Agent 可审计执行（核心完成）

| 能力 | 状态 | 说明 |
|---|---|---|
| Task/Session/Run 表与状态机 | 完成 | 乐观版本、Attempt、RunStep |
| Native Agent Driver + OpenAI-compatible Provider | 完成 | SSE 流式；测试用本地 fake server |
| 密钥安全存储 | 完成 | Main `safeStorage`，仅通过私有 stdio 传 Runtime |
| Context Builder 最小实现 | 完成 | 带来源、预算、截断 |
| Tool Registry + Policy + Approval | 完成 | 读/写/命令/协调工具，approval 暂停/恢复 |
| Run Event / ToolCall / Checkpoint + 流式 AI UI | 完成 | Ant Design X、运行检查器 |
| 执行/取消/超时/失败审计集成测试 | 完成 | 单元/协议/Electron E2E |

## M3 — 项目生命周期与交付物（核心完成）

| 能力 | 状态 | 说明 |
|---|---|---|
| Requirement / Milestone / Artifact / Decision 数据与页面 | 完成 | 总览创建/审批/接受，Artifact 展示 |
| Workflow Stage Guard / Quality Gate | 完成 | 8 阶段 + gate 计算 + 推进拦截 |
| Task DAG、版本并发、验收 | 完成 | 环检测、依赖完成门禁、验收 Artifact |
| 知识条目 / ADR / 检索 | 部分 | 数据层 + Context 注入；无独立知识管理页；无 FTS 检索 |

## M4 — 跨会话与多 Agent（本地完成）

| 能力 | 状态 | 说明 |
|---|---|---|
| Agent Identity / Instance / Session | 完成 | 5 个内置角色 |
| Durable Inbox / ACK / 重试 / 幂等 | 完成 | Idempotency key 去重；本地权威 |
| Handoff / Task Lease fencing / Worktree | 部分 | Handoff、Lease 完成；Worktree 未自动化 |
| 重启恢复 / 外部 Driver 能力协商 | 部分 | 恢复完成；外部 Driver 未实现 |
| OCS Adapter | 未实现 | 未核实 API，不伪造；仅保留接口 |
| 多 Agent 实际协作 | 完成 | 消息唤醒运行 E2E 验证 |

## M5 — 插件、Skill 与产品化（部分）

| 能力 | 状态 | 说明 |
|---|---|---|
| Kernel / Manifest / Capability Registry / Profile | 部分 | `packages/kernel` 有生命周期与能力注册；未开放第三方 JS |
| Skill Discovery / Router / 评估 | 部分 | 内置 Skill + 选择器 + 理由；无评估 UI |
| 安全策略增强 / 插件隔离 / 诊断 / 备份 | 部分 | 策略/审计完成；进程隔离与备份未完成 |
| Windows 便携包、安装器、更新 | 部分 | 已生成未签名 `ProjectOS-0.1.0-portable.exe`，打包冒烟通过；NSIS 安装器、签名、自动更新未完成 |

## V1.2 增量（核心子集）

| 能力 | 状态 | 说明 |
|---|---|---|
| 多 AI 连接 CRUD/默认/启停 | 完成 | SQLite v2；Main SecretVault；UI 弹层 |
| 连接测试 L1–L3/错误分类 | 完成 | `connection-diagnostics`；检查记录持久化 |
| 模型目录/发现/手动/默认模型 | 完成 | OpenAI-compatible `/models`；能力未知不猜测 |
| 旧配置迁移 | 完成 | 幂等迁移为 Legacy 默认连接；Key 不入 SQLite |
| 默认连接真实执行 | 完成 | 同步既有 ProviderManager；V1.2 E2E |
| 设置弹层 | 完成 | AI 连接/模型/通用/运行时/外部 Agent/关于 |
| 外部 Agent 检测 | 部分 | 只检测安装/版本；不执行、不探授权 |
| 路由/用量费用/外部执行/原生 Anthropic | 未完成 | 见 `docs/v1.2/acceptance-report.md` |
| 侧栏折叠修复/文案精简 | 完成 | 34 张截图验收 |

## V1.3 增量（核心子集）

| 能力 | 状态 | 说明 |
|---|---|---|
| 项目扫描/技术栈索引 | 完成 | TS/React/Vite/Electron、Java/Maven/Gradle/Spring 结构 |
| PlanDraft/环检测/审批/版本 | 完成 | 本地规则草案；批准后创建真实任务与依赖 |
| 多 Agent 图工作台 | 完成 | React Flow 投影真实 Agent/任务/依赖/Run 状态 |
| 布局保存/重启恢复 | 完成 | `graph_layouts` |
| 设置连接内联编辑 | 完成 | 不再叠加二层 Modal |
| 自动 Orchestrator 调度/交接 | 完成（基础） | start/pause/resume/cancel/recover；按依赖自动启动 Run 并自动验收 |
| Agent 路由/用量 | 完成 | 按 task/agent/project/global 路由；Run 结束记录 tokens |
| Worktree/自动合并 | 未完成 | — |
| 质量门禁 | 完成（基础） | developer/tester 后执行 typecheck/lint/test/build，失败阻止完成 |
| 事件 seq 断线补齐/200 节点 | 部分 | 事件触发全量刷新，15s 兜底；未做 200 节点压测 |
| 计划依赖可视化编辑 | 完成 | 计划弹层可编辑 dependsOn 并重新校验 |

## 明确不在 MVP

多租户、云控制台、远程 Worker、移动端、插件市场、完整 CI/CD、跨外部系统 exactly-once。
