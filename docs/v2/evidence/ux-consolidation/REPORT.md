# UX consolidation — evidence (ADR-0090)

Branch `feature/ux-consolidation`, stacked on `feature/approval-simplify-v2` (PR #3).

## Information architecture

| | Before | After |
|---|---|---|
| Sidebar 研发 | 研发工作中心 · 需求工作台 · 任务看板 · Agent 协作 · 审批 · 运行审计 | 工作台 · 需求工作台 · 执行 · 审批 |
| Home | project index **and** `/work` (duplicate card grid) | project index = 工作台; `/work` → redirect |
| Approvals | `/approvals` review room + `/approvals/center` (old 3-column antd page) | one review room, lenses 工具请求 / 交付审批 / 记录; `/approvals/center` → `?lens=history` |
| Execution | 4 sidebar entries | 执行 + view rail 任务看板 · Agent 协作 · 运行审计 · 计划编排, breadcrumb 研发 › 执行 › … |
| Stage bar | two rows, 9 labelled steps | one row, only the current stage labelled; full list in expand panel |
| 运行审计 | approval-card grid + antd table + sheet | day-grouped timeline + inline detail + step timeline; 事件流 lens |
| 部署中心 readiness | 3 bordered cards | connected 3-step track |

All previous routes still resolve (redirects keep the query string; `?approval=` deep links choose the lens).

## Screenshots (1440×900, light + dark)

`docs/ux/v3/1440x900-{light,dark}-NN-*.webp`; selected "before" frames as `before-*.webp`.
Captured with `tools/capture.mjs` + `tools/routes-after.json` against the demo workspace.

## Checks

- `pnpm typecheck`, desktop `tsc --noEmit`, `pnpm lint`: pass (warnings only, none new from this change).
- `vitest run`: 725/730 passed, 1 failed — `tests/workspace.test.ts › rejects traversal and absolute paths`,
  the same failure as on the base branch. No new failures.
- `pnpm build`: pass.
