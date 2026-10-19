# V1.1–V1.3 全量补齐清单

目标：不再以“核心子集”收尾，按设计文档 P0/P1 全量交付。此文件是持续验收台账，完成一项必须附真实测试/证据。

## 本轮已完成（2026-10-19）

| 能力 | 状态 | 证据 |
|---|---|---|
| Agent 路由（task/agent/project/global + priority + 默认回退） | 完成 | `agent_backend_bindings`、`aiRouting.*`、`AIConnectionService.resolveForRun`、设置 → Agent 路由 |
| 路由凭据隔离（Main → Runtime 内存注册表） | 完成 | `runtime.ai.credentials`；SQLite/Renderer 不含密钥 |
| 跨连接 Provider 选择 | 完成 | `ProviderManager.createProvider(connectionId, modelId)`；V1.2/Agent E2E 回归 |
| 用量记录与汇总 | 完成 | `ai_usage_records`，Run 结束去重写入；设置内 Runs/tokens/费用 |
| 自动编排（start/pause/resume/cancel/recover） | 完成 | `PlanExecution`、`OrchestrationScheduler`；4 任务计划自动跑到 done |
| 自动验收推进 | 完成 | Run 完成 → review → 质量门禁 → 自动验收 done |
| 图实时刷新 | 完成（快照级） | runtime event 触发 graph/board/plan 失效；15s 兜底轮询 |
| 计划依赖编辑 | 完成 | 计划弹层多选依赖，审批前重新校验 DAG |
| 编排重启恢复 | 完成（基础） | `execution=completed` 持久化；running 计划启动时重新 arm |
| Anthropic Messages 原生协议 | 已实现（未做真实 API 测试） | Messages SSE、tool_use/tool_result、usage；按用户要求未测试 Claude Code/Anthropic |
| OpenAI Responses 原生协议 | 完成（本地 fake 测试） | Responses SSE、function_call、usage、tool 循环 |
| 外部 Agent 执行（只读） | 已完成（未调用 Claude 实测） | Claude Code --print stream-json、Plan 模式、只读工具白名单、Run/事件记录、取消 |
| 质量门禁 | 完成（基础） | developer/tester Run 后执行 typecheck/lint/test/build；失败 artifact + blocked + execution failed |
| Git Worktree（计划级） | 完成 | 独立分支执行、diff artifact、主工作区干净才允许合并、UI 合并/丢弃 |
| 已批准计划 revision | 完成 | plan.revise 创建新草稿，不覆盖历史；E2E 验证 r2 |
| 知识全文检索 | 完成 | SQLite FTS5、knowledge.search、知识库页面、扫描索引 |
| 200 节点投影性能 | 完成（投影） | 202 节点/399 边，单测 11ms |
| 编排失败重试/退避 | 完成 | maxRetries=2、指数退避、E2E 注入 500 后自动恢复并完成 |
| 图键盘/筛选 | 完成 | f 适配、s 保存、Esc 清除、节点文本筛选 |
| 关键路径 | 完成（函数） | criticalPathTasks + 单测；UI 展示未接 |

## 仍待完成（继续实施）

| 需求 | 文档 | 当前状态 |
|---|---|---|
| 外部 Agent 写模式与真实 Claude/Codex 调用 | V1.2 AI-009 P0 | 只读执行已接，写模式未开放；按要求未实测 |
| seq 断线补齐（当前是事件触发全量快照） | V1.3 T11 | 部分 |
| 旧决策失效标记 | V1.3 M1.3-05 | 未实现 |
| 项目指标面板（关键路径函数已具备） | V1.3 P1 | UI 未接 |
| 真实 Anthropic/OpenAI 付费 API 验收 | V1.3 验收 | 未做 |

## 门禁

```text
pnpm lint / typecheck / test（56）
node scripts/agent-e2e.mjs
node scripts/v12-e2e.mjs
node scripts/v13-e2e.mjs
node scripts/v13-orchestration-e2e.mjs
pnpm test:package
```

未运行或有保留的项不得标记完成。







