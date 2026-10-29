# ADR-0053 — Global goal journey projection and bar

- Status: Accepted (Phase 2.9-P0)
- Related: ADR-0031 (goal status), ADR-0047 (trusted test evidence), ADR-0048 (verification states)

## Context

A first-time user had to open 项目姿态 / 任务看板 / 编排 / 审批 / 版本与迭代 to assemble four answers: what
goal am I on, which step of the whole flow is this, is the system working, and who owns the next move.
`work.goalStatus` already carried part of the truth but only for an approved plan, only inside the work
center, and it could still say "passing" for a plan nobody had verified (fixed by ADR-0048).

## Decision

1. **One projection** (`apps/runtime/src/journey.ts`) over nine user-journey stages — 项目准备, 需求,
   计划, 审核, 授权, 执行, 验证, 审查, 交付 — derived only from persisted facts: project + git
   readiness, requirements, the selected plan revision (executing > approved > draft, with an explicit
   reason), the execution grant, real runs and pending approvals, trusted test evidence, current review
   evidence and the delivery record. It never infers success from a plan status or a task count.
2. **One API** `work.journey({ projectId | null })`. With no project it falls back to the project with
   running work (else the most recently updated) and reports background counts, which is what the
   project center needs.
3. **One persistent bar** (`GoalJourneyBar`) rendered by `AppShell.subheader`, i.e. outside
   `.po-titlebar`, so `body.po-plan-workspace-open` (which hides the titlebar) cannot hide it. It
   compacts to a single line below 1180px or in the plan full-screen workspace, and expands to a
   detail panel with each stage's state, reason and deep link.
4. **Ownership is explicit**: every stage carries `owner` (user / ai / system / none) and the next
   action carries a real route and object id. A missing model connection is a *user* action with a
   deep link into settings, not "AI will fix it".

## Consequences

- The work center keeps its detailed panels but reads the same evidence; the bar is the always-on
  summary.
- Stage completion is only reported when a persisted fact proves it; `verify` uses the trusted-test
  resolver, `code-review` the ReviewSnapshot resolver and `delivery` merge commit + post-merge result.
- The bar refreshes every 5 s and on route changes; events are not yet pushed into it (known gap).

## Verification

`tests/p29-goal-journey.test.ts` (fresh project, draft, approved-no-grant, authorized-not-started,
failed execution, delivered) and `scripts/p29-goal-journey-e2e.mjs` (real Electron from an empty
folder, 21/21 checks: no-project guidance, setup note, requirement, draft, approve, grant, start,
persistence across /work /tasks /approvals /runs /versions /orchestration, real failure surfaced with
its owner, layout at 1440/1024/125%, restart).
