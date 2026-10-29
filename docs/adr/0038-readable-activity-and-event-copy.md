# ADR-0038 — Activity and event streams speak Chinese, and 「全部」 actually works

- Status: Accepted (Phase 2.8.8 UX)
- Related: ADR-0031 (goal status)

## Context

项目中心「最近动态」里出现 `run.status.changed`、`project.event`、`tool.completed`，用户无法知道发生了什么；
右上角「全部」是一个 `<span>`，根本没有点击处理。运行审计的「项目事件流」也把原始 `eventType`
直接显示成一列。

根因：`summarizeProjectEvent` 只覆盖了一部分事件类型，其余走 `default: summary = event.eventType`；
事件流页面直接用 `event.eventType`。另外 bootstrap 每个项目只取 6 条动态、总量截断到 10，
即使「全部」可点也没有更多内容可看。

## Decision

1. **唯一文案来源**：`packages/domain/src/events.ts` 的 `summarizeProjectEvent` 覆盖全部已知事件类型，
   并把内部枚举翻译成用户语言：
   - `run.status.changed` → 「Agent 运行等待你的审批 / 已完成 …」（带任务标题）；
   - `plan.status.changed` → 「计划第 2 版已暂停（等待审批期间暂停）」，`reason` 走白名单文案；
   - `tool.*` → 「请求使用工具：run_tests / 工具执行完成 / 工具执行失败」；
   - `plan.execution.failure_classified` → 「执行受阻：质量门禁未通过（AI 可以尝试修订计划）」，不再泄露 `quality_gate`；
   - `project.event`（custom）→ 按 `payload.kind` 映射（自动交付、交付阻断、已安排复审…），未知则「项目有新的记录」；
   - `plan.replan.proposed` → 「真实验证未通过，AI 提出修订方案，等待应用或你的决定」。
   `default` 一律返回中文兜底（「项目有新的更新」），**永不**回落到原始点分类型。
2. **徽标分类**：新增 `eventTypeLabel(type)`，运行审计事件流显示「运行 / 工具 / 计划 / 任务 / 审批 …」，
   原始类型只放在 `title` tooltip 里供排查。
3. **「全部」是真控件**：卡片标题的「全部」改为 `<button>`，`aria-expanded` 切换「全部 / 收起」，
   展开后在卡片内 320px 高度滚动（不撑高整页）；bootstrap 每个项目取 20 条、总量 40 条，
   让「全部」有真实内容；不足 6 条时显示「N 条」而不是假按钮。

## Verification (real Electron, real data)

`scripts/p288-activity-copy-e2e.mjs`（真实项目数据，1440×900）：

```
最近动态文案为可理解的中文（无原始事件类型） — 6 条动态：执行受阻：真实验证未通过
「全部」是可点击控件（不是静态文字）        — <BUTTON> 全部 aria-expanded=false
点击「全部」展开全部动态并可收起            — label=收起 rows=6→20
展开后列表在卡片内滚动，不撑高整页          — compactScrolls=true docScrolls=0
再次点击可收起                              — label=全部 rows=6
运行审计事件流徽标为中文分类                — 100 行，首行=计划 / tooltip=plan.execution.failure_classified
```

单元测试 `tests/p288-event-copy.test.ts` 遍历 `PROJECT_EVENT_TYPES` 的**每一个**类型，断言：
摘要不等于原始类型、不含点分英文、含中文，且 tone 合法；徽标永不含 `.`。

## Consequences

- 新增事件类型时，测试会强制要求提供中文摘要（否则 CI 失败）。
- 原始类型仍是审计事实（事件载荷 + tooltip），只是不再作为用户界面文案。
