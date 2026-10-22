# ProjectOS V1.6 Commercial UI Redesign

## Workspace / branch

- Branch: `feature/v1.6-commercial-ui-redesign`
- Worktree: `C:\Users\Administrator\Desktop\workplace\ProjectOS-commercial-ui`
- Base: `98cd5a3` (`feature/v1.6-ux`, already pushed)
- This branch is not merged into `feature/v1.6-ux`.

The original working tree was audited before creating the worktree. The only uncommitted files there were temporary prompt packages / `.tmp-*` files; no source changes were pending. All changes in this branch are confined to the worktree.

## Audit

The front end currently has two React Flow surfaces:

1. **Orchestration workspace** — orchestrator, Agent and task cards with delegation edges.
2. **Plan review DAG** — task nodes and dependency edges inside the plan review modal.

Both use `@xyflow/react` 12.12.0. There is no X6, ELK.js, dagre or second graph engine. Ant Design 6 is the component base; V1.6 already has `--plan-*` / `--orch-*` tokens and CSS glass surfaces.

No new UI dependency was introduced: React Flow, Ant Design, existing icons and CSS variables remain. License position is unchanged: Ant Design MIT, React Flow MIT, Electron MIT.

## Baseline screenshots

- `baseline-plan-review.png` — old plan review: 920px modal, stacked cards, duplicate goal, small task area.
- `baseline-agent-canvas.png` — existing orchestration canvas before this branch's stage/task node work.

## Final screenshots

- `plan-review-light.png` — dedicated wide review workspace.
- `plan-review-dark.png` — dark theme.
- `plan-review-narrow-1100.png` — narrow window (1100px), task list placed before review aside.
- `plan-review-dag.png` — task dependency mode.
- `plan-review-task-detail.png` — task detail Drawer over the workspace.
- `plan-review-risks.png` — expanded real risk list.

## What changed

### Plan review is a workspace, not a form stack

- Plan modal is now `min(1480px, 100vw - 48px)` wide and `min(880px, 100vh - 56px)` tall, centered; not edge-to-edge.
- The duplicate goal textarea was removed for an existing draft. The goal appears once as an editable workspace title.
- Summary is one line: stage path · task count · review count.
- Generation metadata is collapsed under “生成详情”.
- Main region: stage route + task stream.
- Right rail: real review status and risk list.
- Approval/rejection stay in a fixed modal footer.
- At ≤1120px the review becomes one column and the task list precedes the review rail.

### Stage nodes

Stages are derived from real `dependsOn` longest-path levels, not hardcoded. Each card now has:

- role icon (architect/developer/reviewer/tester/custom);
- index, title, task count and role/parallel marker;
- risk marker only when a task in the stage is blocking.

### Task DAG

- 252px TaskNode with kicker, two-line title, Agent initials/name and dependency count;
- real `dependsOn` edges only; missing dependencies are not drawn; cycles are reported as blocking;
- arrow markers and smoothstep paths;
- selecting a task highlights real upstream/downstream nodes, dims unrelated edges;
- default readable viewport (0.78) with controls for zoom/pan/fit;
- no fake progress/status on draft tasks.

### Task detail

Drawer preserves all editable fields: title, description, role, Agent/custom Agent, dependencies, acceptance criteria, expected artifacts, capabilities, approval requirement, delete task. Drawer is above the review modal and does not cover the fixed approval bar.

### Token additions

In `orchestration.css`:

- `--graph-node-width: 252px`
- `--graph-node-radius: 14px`
- `--graph-node-pad: 12px 13px 10px`

Existing `--plan-*` and `--orch-*` surfaces remain the source of color/contrast.

## Verification

- `pnpm lint` — PASS
- `pnpm typecheck` — PASS
- `pnpm test` — **265 passed / 3 skipped**
- `plan-review-ui-e2e` — **10 checks PASS**
- `pnpm build` — PASS
- Light, dark, narrow (1100px) screenshots captured from the running Electron app.

## Limitations / not completed

1. Only the plan review workspace and its graph were migrated in this pass. Task board, settings, run audit and Agent workbench still use the existing V1.6 layout.
2. No second standalone visual prototype was built. The baseline (card-stack modal) and the new workspace are the comparison; a second runnable design direction is still open.
3. 9 / 30 / 80 node stress screenshots were not produced. Plan validation imposes a 20-task maximum; no fake data was inserted into production pages.
4. 125% display scaling was exercised, but the Electron screenshot at `webContents.setZoomFactor(1.25)` clips the workspace at the capture boundary; the 1100px narrow screenshot is the reliable responsive evidence.
5. No Motion dependency was added; transitions use CSS and respect `prefers-reduced-motion`. Page-level motion across all routes is not migrated.
6. No new component library migration (shadcn/Radix/Tailwind) was performed. Adding a second theme system alongside Ant would create the exact theme conflict the brief forbids.
