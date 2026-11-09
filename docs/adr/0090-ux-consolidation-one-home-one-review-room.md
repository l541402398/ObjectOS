# ADR-0090 — UX consolidation: one home, one review room, execution views

Date: 2026-11-10. Base: `feature/approval-simplify-v2` (PR #3, ADR-0089).
User request: finish the product — no second, inconsistent approval experience, fewer entry
points, a less dominant stage bar and no remaining "grid of bordered cards" pages.

## Context

After ADR-0089 the project sidebar exposed six peer entries under 研发 (研发工作中心 / 需求工作台 /
任务看板 / Agent 协作 / 审批 / 运行审计) plus a two-row nine-step stage bar on every page. Two of them
duplicated others: `/work` (WorkCenterPage) re-rendered the project home with card grids, and
`/approvals/center` (ApprovalsPage) was an older three-column antd approval page next to the new
review room. 运行审计 mixed an approval-card grid, an antd table and a sheet detail.

## Decision

1. **One home.** The project index (StudioProjectHome) is the only "what is happening / what do I need
   to do" page, labelled **工作台**. `/work` redirects to it (query preserved). WorkCenterPage is deleted.
2. **One review room, three lenses.** `/approvals` has `工具请求` (the ADR-0089 queue), `交付审批`
   (pending release/deployment approvals, decided in place through `release.decideApproval`) and
   `记录` (decided tool + delivery approvals grouped by day, searchable, with a decision trail).
   Lens lives in `?lens=`; `?approval=<id>` deep links pick the right lens automatically.
   `/approvals/center` redirects to `?lens=history`; ApprovalsPage is deleted.
3. **执行 groups the execution views.** The registry gains `navLabel` / `navParent`: 任务看板 is the
   sidebar entry **执行**; Agent 协作, 计划编排 and 运行审计 set `navParent: 'tasks'` and are reached
   through a segmented `ViewTabs` rail, the breadcrumb (研发 › 执行 › 运行审计) and the command
   palette (each child shows "执行 视图"). Routes are unchanged, so every existing link still works.
   The Design Lab projection (`productNavigation`) is frozen to its previous rows.
4. **Compact stage bar.** GoalJourneyBar renders one row: goal, a bead track where only the current
   stage carries a label and state, and the next action. Future beads collapse below 1080px; the full
   stage list stays in the expand panel.
5. **运行审计 rebuilt** as a day-grouped run timeline (status orb, duration bar, filters, search, j/k)
   with inline detail (facts ledger, actions, changed files, a step timeline) and a 运行 | 事件流
   switch (`?lens=events`). Pending tool approvals are a single banner into the review room instead
   of duplicated approval cards. Reconciliation keeps its dialog.
6. **部署中心** readiness is a connected three-step track instead of three bordered cards.

## Consequences

- Sidebar 研发: 工作台 / 需求工作台 / 执行 / 审批 (4 entries instead of 6).
- The `/work` goal-submission form is gone; goals are raised from the home (提出需求) and NextStepPanel.
- `wc-next*` styles still live in `pages/work-center.css`, now imported by NextStepPanel.
- E2E scripts that clicked `研发工作中心` were updated to `工作台` (not re-run in this change).
