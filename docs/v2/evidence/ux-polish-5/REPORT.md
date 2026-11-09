# UX polish 5 — evidence (ADR-0093)

Branch `feature/ux-polish-5` → `feature/ux-polish-4` (stacks on PR #6).

## Scope
- Stage bars: global 目标/需求 bar as one row; requirement full track as quiet bead row.
- 需求工作台: caption line instead of governance pills; acceptance toggle; no-flow state; dark-mode surfaces.
- 执行: 任务看板 requirement line, Agent 协作 single-row relay, 计划编排 header metrics and kicker cleanup.
- 审批 pending view: quiet batch row, text reject, plain policy toggles.
- 发布中心 empty path, 项目态势 里程碑 / Agent 活动 rows, `--ui-type-badge` audit.
- Opt-in seed `PROJECTOS_SEED_DEMO_FLOW=1` (default demo unchanged).

## Screenshots
`docs/ux/v6/before-*.webp` / `after-*.webp` (1440×900). Full sets (1440 light/dark, 1100 light) were
captured with `PROJECTOS_SEED_DEMO_REVIEW_HISTORY=1 PROJECTOS_SEED_DEMO_RESOURCES=1 PROJECTOS_SEED_DEMO_FLOW=1 PROJECTOS_SEED_DEMO_REVIEW_QUEUE=1`.
`before-08-requirement-noflow` comes from the polish-4 capture (same UI as the base branch).

## Checks (after the last edit)
- `pnpm typecheck`, desktop `tsc --noEmit`: pass.
- `pnpm lint`: 0 errors, 51 warnings (base 52; no new warnings).
- `vitest`: 728/733, only failure `tests/workspace.test.ts` (same as base 727/732); +1 test for `seedDemoFlow`.
- `pnpm build`: pass.

## Known limits
- 运行审计 and the Agent graph canvas are unchanged.
- The demo has no pending delivery approvals, so the 交付审批 lens shows its empty state.
- At 1100px the requirement page shows the stage detail panel before the task list (existing grid).
