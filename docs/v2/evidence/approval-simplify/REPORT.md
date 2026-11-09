# Approval simplification v2 — evidence (ADR-0089)

Base: `codex/organization-workspace-ux` @ `e908d0e2`. Branch: `feature/approval-simplify-v2`.

## Capture

Real Electron app (`pnpm build`), isolated data dir, `PROJECTOS_SEED_DEMO=1` plus the opt-in
`PROJECTOS_SEED_DEMO_REVIEW_QUEUE=1` (adds 5 persisted approvals to the demo Run: two file writes,
`pnpm test`, `.env.local`, `git commit`). 1440×900, light and dark switched through the real theme
menu, reduced motion. Tools: `tools/capture.mjs` with `routes-v2.json` (non-destructive) and
`routes-v2-flow.json` (decides approvals; run once per theme on fresh data).

```
PROJECTOS_SEED_DEMO_REVIEW_QUEUE=1 xvfb-run -a node tools/capture.mjs <repo> <out> tools/routes-v2.json
THEMES=light PROJECTOS_SEED_DEMO_REVIEW_QUEUE=1 xvfb-run -a node tools/capture.mjs <repo> <out> tools/routes-v2-flow.json
```

Screenshots: `docs/ux/v2/*.webp`. Console/page errors during every capture: none.

## Observations recorded honestly

- The demo Run is a seeded record in the project root, so the badge reads **主工作区** and auto-allow
  correctly does not apply ("不属于已批准计划，按工具策略逐次审批"). A real plan Run in a plan worktree
  shows **隔离 Worktree** (covered by tests, not by these screenshots).
- Approving seeded demo approvals fails per item with the real runtime reason (no model provider / no
  live task lease). The dock shows that as a warning with the first reason (`batch-partial`).
  Rejecting works; rejecting one item ends the demo Run and the remaining items are reported as
  skipped ("已随同一 Run 一并结束"), not as failures (`cleared`).

## Checks

See the PR description for typecheck / lint / test numbers compared with the base.
