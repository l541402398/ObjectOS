# Plan Review Inspector Fixes

Date: 2026-10-23
Branch: `fix/plan-review-inspector-actions`

## Issues fixed

1. Pending-approval task drawer had no plan approval action.
2. The drawer close X looked clickable but clicks near the icon were swallowed.
3. The drawer did not reliably scroll with the wheel.

## Root causes

### Approval

`TaskInspector` only rendered a `返回计划审核` footer. The real
`拒绝计划/批准计划` actions lived in the page footer behind the inspector and
were therefore unreachable while a task was open.

Fix: `TaskInspector` now accepts optional `onApprove`, `onReject`,
`approveDisabled` and `approveHint`. `PlanReviewWorkspace` passes the real
handlers, so the drawer footer has working plan-level actions. The Design Lab
demo still uses the original return-only footer.

### Close-button hit target

The Ant Design message layer (`.ant-message-list-content`) spans the top of
the window and sat above the inspector (`z-index: 30`). Hit testing at the
visible X returned the message container, not the button; only the left edge
of the button was clickable.

Fix: message toasts are click-through (`pointer-events: none`), and the
inspector backdrop is raised above transient messages (`z-index: 3000`). The
close button is now a 36x36 target positioned explicitly at the drawer's
top-right.

### Wheel scrolling

The scroll area existed, but wheel input over the drawer chrome did not move
it. The inspector now forwards wheel deltas from head/footer chrome to the
scroll container, contains overscroll, and uses explicit `overflow-y: auto`.

### Why an existing plan showed no change

The reported plan was already **approved** in the local database
(`plan_revisions.status = approved`). Approved plans use the read-only legacy
`PlanReviewNext` surface, not the draft-only full-screen workspace. That
surface hard-coded the status pill as `待批准`, which contradicted its own
`已批准只读` metadata and made the missing approval action look like a bug.

Fix: the pill now reads from the real plan status (`待批准 / 已批准 / 已拒绝 /
已被替代`), and approved task rows read `已批准` instead of `待审批`. An
approved plan intentionally has no approve action; create a new plan or use
`修订为新版本` to get a draft, then approve that draft.

## Verification

- `scripts/plan-review-workspace-e2e.mjs` — 13 checks, including approval
  actions, wheel scrolling and close hit target.
- Real click at the X icon center closes the drawer at 100% and 125% scale.
- Real `批准计划` in the drawer closes the workspace (manual packaged check).
- 620px-tall window: drawer scrollTop moved 0 → 231 with a wheel event.
- Visual: [plan-inspector-fixed.png](visual-regression/plan-inspector-fixed.png)

## Files

- `apps/desktop/src/renderer/src/features/design-lab/TaskInspector.tsx`
- `apps/desktop/src/renderer/src/features/design-lab/design-lab.css`
- `apps/desktop/src/renderer/src/features/orchestration/components/PlanReviewWorkspace.tsx`
- `apps/desktop/src/renderer/src/styles/next-ui-app.css`
- `scripts/plan-review-workspace-e2e.mjs`
