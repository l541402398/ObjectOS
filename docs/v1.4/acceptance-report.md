# V1.4 验收报告（进行中）

## 已实现

| 能力 | 状态 | 证据 |
|---|---|---|
| 健康检查 | 完成（首版） | Git 状态、test/lint/build 质量门禁、任务阻塞；health_check_runs |
| Evidence-backed Finding | 完成（首版） | finding_evidence、Git SHA、命令输出摘要、内容哈希 |
| 指纹去重 | 完成 | project + checkId + 归一化错误哈希；occurrenceCount |
| 修复提案 | 完成（首版） | repair_proposals / proposal_findings；pending_approval → approved/rejected |
| 自主运营工作台 | 完成（首版） | `/projects/:id/operations`；检查、Findings、提案、模式 |
| 模式设置 | 完成（持久化） | observe / propose / approved-autofix |
| 修复计划启动 | 完成（首版） | 提案批准后生成计划、审批、启动 scheduler 并创建 Worktree |
| 修复结果回写 | 完成（首版） | 计划 completed → proposal completed + findings resolved；failed → proposal failed |
| 间隔触发器 | 完成（首版） | automation_triggers + API + 30s due timer；重启保留 nextRunAt |
| 项目事件触发 | 完成（首版） | task.blocked / run.failed 事件触发健康检查，60s 去抖 |
| AutomationGrant | 完成（首版） | 24h/5 次默认授权；过期/撤销/次数校验；startRepair 无授权拒绝 |
| UI 可读性 | 完成（首版） | 全部 8–10px 字号提升到 10–11px；Light/Dark 截图复核 |
| 风险矩阵 | 完成（首版） | low/medium 可自动；high/critical 强制人工；需有效 Grant |
| approved-autofix 自动执行 | 完成（首版） | 检查后自动提案/批准，低/中风险且授权有效时自动 startRepair |
| 完整修复成功路径 | 完成（E2E） | Finding → Proposal → Grant → Worktree → 质量门禁通过 → Proposal completed + Finding resolved |`r`n| 重启恢复 | 完成（E2E） | Findings、Proposal、planId 与 mode 重启后保留 |
| 软预算阻断 | 完成 | 超预算启动需确认；`BUDGET_EXCEEDED` |

## 未完成

- P1：CI / 依赖安全 / Changelog / 趋势图`r`n- 项目事件触发与 lease
- 修复执行结果回写 Finding/Proposal 状态（当前计划已启动，完成态未回写）
- P1：CI / 依赖安全 / Changelog / 趋势图
- 预算并发/重试 circuit breaker
- Git hooks / CI / 依赖安全 / Changelog 趋势
- 真实 Claude/付费 API 验收（按用户要求未测）

## 测试

```text
pnpm test → 17 files / 68 tests
node scripts/v14-e2e.mjs → PASS
node scripts/v14-success-e2e.mjs → PASS
  finding resolved / proposal completed / worktree created
  findings: 1
  proposals: 1 · executing
  mode: propose
```









