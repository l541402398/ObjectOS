# Source audit — Agent overview P0 recovery

- Repository: `l541402398/ObjectOS`
- Branch: `fix/agent-overview-ux-recovery`
- Baseline: `v2.0-agent-overview` / `b4d400330819390a8876683b57e108136024cd34`
- Audited: 2026-10-30 (local 2026-10-29)
- Working tree at start: only untracked `ProjectOS_A0_Agent_UIUX_P0_Repair_Kit/` and prior `scripts/p29-settings-probe.mjs`; no tracked changes.

## Confirmed facts

| Claim | Verification |
|---|---|
| Agent overview is the production page at `/projects/:id/agents` | `AppRouter`/`AgentWorkbenchPage` route; default `viewMode` currently `overview` |
| The current page is a full-canvas graph, but the relationship layer is a sibling of React Flow | `CollaborationGraph.tsx` renders `<ReactFlow>` then `<RelationshipLayer>` |
| The edge layer used `z-index: 1` while React Flow used `z-index: 2` | `collaboration-overview.css`, `.aco-edge-layer` / `.aco-canvas .react-flow` |
| Idle agents entered layout through a synthetic anchor | `CollaborationGraph.tsx` had `aco-layout-anchor` plus `anchor-*` ELK edges; removed in P0-A |
| DOM path count was the only edge assertion | old E2E checked `.aco-edge` count; no screenshot pixel or endpoint check |
| “专业编排” is a URL mode switch to the old AgentWorkbenchPage | `AgentWorkbenchPage.tsx` `switchView('pro')`, `?view=pro` |
| Approval detail was read-only and routed to `/approvals` | `CollaborationOverview.tsx` approval inspector footer |
| A0 Precision Lab is `DEV_ONLY`; production shell is still Liquid Glass | `docs/org-upgrade/reports/A0-report.md`; `#/precision-lab` is DEV_ONLY |
| Full test suite has one pre-existing timing failure | `tests/r1-budgets.test.ts`; A0 and A1 both report it; baseline also fails |

## P0-A root causes and fixes

1. **Visible edge layer.** The SVG overlay was below the whole React Flow stacking context. In P0-A it is raised above the canvas (`z-index: 3`) with `pointer-events: none` except real Handoff paths, and an SVG mask removes line segments under node cards so lines look connected but never draw over text. Native React Flow edges were attempted first; node measurement remains empty in this environment (`measured: {}`, no handle bounds), so the same-viewport SVG path is retained and now proven by screenshot pixels.
2. **Idle agents.** All agents were forced into ELK by synthetic anchor edges. P0-A introduces `focus-projection.ts`: primary agents are working / waiting approval / assigned to a current-plan task / in a real handoff; all others go to the standby dock and never enter `children`, `edges`, or `fitView`.
3. **Assignment relation.** The graph now uses the persisted `task.assigneeAgentId` as a real assignment edge when that task is in the focused set, not only `agent.taskId`.
4. **Layout/fit stability.** ELK and fitView are keyed by the focused object ids, so a 4-second data refresh no longer re-runs layout or moves the viewport.

## Known limits still open after P0-A

- Approval is not yet executed inside the sheet (P0-B).
- The misleading `[协作总览][专业编排]` switch is still present (P0-B).
- P1-C visual masters are implemented on the project home, review room and Command Deck graph; they await user review before rollout.
- The full test-suite `r1-budgets` timing failure remains.
- E2E uses a local fake OpenAI-compatible provider and seeded artifact/handoff fixtures; it does not prove real model delivery.
