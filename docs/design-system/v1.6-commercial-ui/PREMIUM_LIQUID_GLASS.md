# ProjectOS Premium Liquid Glass — Stage Sample

## Branch

- Parent: `feature/v1.6-next-ui` `5e6032d`
- Branch: `feature/v1.6-premium-liquid-glass`
- Worktree: `C:\Users\Administrator\Desktop\workplace\ProjectOS-commercial-ui`
- Not merged; this is the visual sample for user acceptance.

## Scope

Only the three approved scenes were migrated:

1. Plan review workspace.
2. Task detail inspector.
3. Task dependency DAG.

No other page was migrated, per the instruction to wait for visual acceptance before continuing.

## Optical materials

Implemented as distinct materials in `apps/desktop/src/renderer/src/styles/next-ui.css`:

| Material | Implementation |
|---|---|
| Ambient Background | layered radial blue / violet / cyan light with a quiet dot field; no large animated blur |
| Workspace Glass | soft translucent workspace canvas with edge reflection |
| Stage Glass | `pui-stage-node`: tinted optical surface, top reflection, corner light, risk/selected borders |
| Task Ledger | `pui-ledger`: dense solid content surface for task readability |
| Review Rail | `pui-risk-panel`: elevated translucent panel |
| Task Sheet | `pui-detail-sheet`: floating glass sheet with deeper shadow |
| Focused Surface | accent border + 3–4px translucent focus ring |

Avoided:

- same white translucency on every component;
- backdrop-filter on every nested element;
- large saturated page gradients;
- animated glow loops;
- fake progress.

## Cinematic composition

- Plan review is one bounded workspace, not a stack of white cards.
- Stage route is a connected optical path with glass wafer nodes, role icons, counts and flow links.
- Task ledger is a single dense reading surface with stage separators, not per-stage cards.
- Review rail is a separate floating glass instrument.
- Task inspector is a focused right-side sheet, not a raw form column.
- DAG has a luminous dot field, glass nodes and real dependency edges.

## Motion

Using `motion/react` (MIT):

- Workspace enters with a short opacity/6px rise.
- Risk rail expands/collapses with height + opacity.
- Task detail sheet enters from the right with a 220ms custom cubic ease.
- DAG path highlight has a subtle dash flow only while a task is selected.
- Reduced-motion disables flow and transition animations.

No continuous page-level animation or exaggerated glow.

## Structured task inspector

Raw selects/textarea stack was replaced with:

- inline title and description fields;
- role as icon + label segmented buttons;
- Agent as a glass dropdown list;
- dependencies as removable chips + add menu;
- acceptance criteria as individual editable rows with add/remove;
- artifacts as removable chips + add field;
- capabilities as toggle chips (required / hard);
- custom approval switch;
- delete task.

All edits still flow into the existing `PlannedTask` draft and the existing approve API.

## Screenshots

- `liquid-glass-light.png`
- `liquid-glass-dark.png`
- `liquid-glass-dag.png`
- `liquid-glass-detail.png`
- `liquid-glass-narrow.png`
- Baseline: `baseline-plan-review.png`

## Verification

- `pnpm lint` — PASS
- `pnpm typecheck` — PASS
- `pnpm test` — 265 passed / 3 skipped
- `pnpm build` — PASS
- `plan-review-ui-e2e` — 10 checks PASS
- `r2b1-planner-ui-e2e` — 10 checks PASS
- `custom-agent-from-plan-ui-e2e` — 3 checks PASS
- packaged Electron smoke — PASS (independent package build; rerun after branch commit)

## Known limits

1. Ant Modal shell and footer still wrap the sample. Full Ant removal is Stage 6.
2. 125% display screenshot is clipped at the Electron capture boundary; the 1100px narrow screenshot is the reliable responsive check.
3. 9 / 30 / 80 node states were not produced; plan validation caps plans at 20 tasks.
4. No screen recording was produced. The E2E scripts reproduce the interactions.
5. Only the plan-review sample is migrated; other pages remain on the existing front end.
6. Visual acceptance belongs to the user; tests passing is not presented as visual acceptance.
