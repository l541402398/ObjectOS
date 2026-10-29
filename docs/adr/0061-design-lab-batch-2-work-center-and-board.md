# ADR-0061 — Design Lab material, batch 2: 研发工作中心 + 任务看板

- Status: Accepted (Phase 2.9-P0, batch 2 of the migration)
- Related: ADR-0054 (shell batch 1), ADR-0058 (12px floor), protected baseline `0686c41`

## Context

The user approved the Design Lab material/composition and asked to replace the old system look
("设计风格和样式可以保留并替换掉当前的系统风格和样式"). Batch 1 covered the shell (ambient canvas, sidebar,
main sheet, journey bar). The two most-used pages — 研发工作中心 and 任务看板 — still used flat cards with
their own borders and shadows, so the product read as two different design systems.

## Decision

`apps/desktop/src/renderer/src/styles/pages-design-lab.css` maps the Design Lab optical recipe onto the
**shared card primitives** (`po-card`, `po-metric`) and the two pages' surfaces:

- work center: focus panel, goal-state tiles, autopilot note, callouts, task rows, agent rows;
- task board: columns, column heads, task tiles, next-step banners.

Only materials change (surface gradient, inner highlight, `--pdl-*` lines, radii, shadows, ink colours).
No layout, no information architecture, no behaviour, no dependency or IPC change. The Design Lab page
itself is untouched (its own `.pdl-root` scope).

Alongside it, two consistency fixes found while migrating:

1. Work center's 真实测试 tile mapped the **old** verification strings (`passing/failing`), so a passed
   verification rendered neutral. It now maps `passed/failed/stale/verifying` to
   success/warning/active/neutral.
2. `goalStatus` hid expired tool approvals as stale, so the work center said "当前状态：无需操作" next to a
   paused execution. It now surfaces a stale tool approval while a plan execution is parked (ADR-0057
   remains the settlement mechanism).

## Verification

- `scripts/p29-visual-sweep.mjs`: 9 pages × 1440/1024 — real heading present, no "页面不存在", no
  horizontal overflow, journey bar present, zero content text below 12px: **18/18 PASS**.
- Screenshots: `docs/screenshots/p29-sweep-work-1440.png`, `p29-sweep-tasks-1440.png` (plus the 1024
  variants) captured from real Electron with a real profile.
- Not yet migrated (batch 3+): 审批、运行审计、版本与迭代、发布/部署、资源与连接、设置弹层。
