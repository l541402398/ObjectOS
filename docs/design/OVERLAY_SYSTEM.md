# ProjectOS Overlay System — v1.6

## Scope

This is the shared layer for ProjectOS drawers, dialogs, sheets, inspectors and anchored popovers.
It is built on React 19, Radix Dialog/Popover, Tailwind-compatible CSS and Motion.

The three reviewed samples are:

| Sample | Surface | Business shape |
|---|---|---|
| Task Inspector | `InspectorShell` | read-first task identity, dependencies, acceptance, artifacts, capabilities, risk; full edit |
| Agent config | `InspectorShell` + `PopoverShell` | Agent identity, model/runtime, capabilities, permissions, skills; local sample |
| Approval dialog | `DialogShell` | impact counts, risk rows, explicit primary/danger action, modal backdrop |

Task Inspector source: `features/design-lab/TaskInspector.tsx`.
Agent sample: `features/design-lab/AgentInspector.tsx`.
Approval sample: `features/design-lab/ApprovalDialog.tsx`.
Primitives: `next-ui/overlay/overlay-context.tsx`, `overlay-shell.tsx`, `overlay.css`.

## Components

### OverlayRoot / OverlayProvider

`OverlayRoot` is mounted once around the router in `main.tsx`. It owns the overlay stack:

- base z-index `6000`, step `30` per registered surface;
- `useOverlayLayer()` returns a stable id, computed z-index and top state;
- registration methods are stable callbacks, so opening one overlay does not re-register every
  other overlay;
- no global DOM portal container is required: Radix portals to `body`.

### InspectorShell

Non-modal, right-side workspace-linked inspector. It deliberately has **no backdrop**, so the
canvas, ledger and DAG remain visible and interactive.

- Radix Dialog with `modal={false}` for portal/focus primitives; explicit Tab/Shift-Tab trap and
  focus restore for the non-modal case.
- Escape requests close through the dirty guard.
- Outside pointer/focus does not dismiss; close uses the header `×`, Escape, or the page action.
- Header/scroll/footer are separate slots, so a task inspector can put actions in the header while
  the Agent sample keeps its primary action in the footer.
- Closing keeps the surface mounted for 220ms while the exit transition runs.

### DialogShell / SheetShell

Modal Radix Dialog with a single backdrop, 20px optical surface, one `OverlayScrollArea`, and a
sticky footer. `SheetShell` is the side variant for wide secondary surfaces. Both:

- use real scroll locking through Radix;
- focus the first control and trap focus;
- intercept Escape/outside close when dirty;
- preserve content during the close transition;
- cap width/height to the Electron viewport.

### PopoverShell

Radix Popover anchored to a trigger, rendered in a portal with the layer z-index. No backdrop and
no scroll lock. Used for the Agent model selector; Escape and outside click dismiss it.

### OverlayHeader / OverlayFooter / OverlayScrollArea / InspectorSection

One typography and spacing contract:

- eyebrow 11px / title 20px / meta 12px;
- body 14px, secondary 12.5px;
- 18px horizontal inset, 16px header top;
- footer 32px controls and 11px meta;
- single scroll owner; no nested `overflow:auto` in business sections.

### Dirty-close guard

`InspectorShell` and both modal shells accept `dirty` and `onDiscard`. A dirty close opens a
compact `DialogShell`-style confirmation with one backdrop, at `z + 300` so it is above a
non-modal inspector. Entering the guard never mutates or resets the draft.

## Materials / theme

Surfaces are opaque (`--pui-ov-solid`), not translucent text plates. The backdrop is the only
blurred layer. Design Lab overlays are portaled outside `.pdl-root`, so the shell accepts
`theme` and `skin="projectos"` and carries the pdl token scope with it. Formal ProjectOS surfaces
use the same shell without the pdl skin and inherit the app theme.

## Responsive / motion

- Inspector and sheet: `min(width, 100vw - 24px)`, top/right/bottom 12–14px;
- dialogs: `min(width, 100vw - 32px)`, `max-height: min(82vh, 820px)`;
- under 680px, shells use 8px inset and full available width;
- Motion drives entrance; CSS keyframes drive exit; `prefers-reduced-motion` disables both;
- no continuous overlay animation.

## Real integration status

- Task Inspector is the accepted Lab implementation refactored onto the shared primitive. It keeps
  its local prototype mutations; the formal `PlanReviewNext` task sheet is not migrated yet.
- Agent config calls the real `window.projectos.agentDefinitions.list()` read path when opened. If
  an Agent exists, its identity/permissions are displayed with `RUNTIME`; otherwise the local
  `Nova` sample is shown. Saving is intentionally local-only in the Lab and is labelled as such.
  It does **not** call `agentDefinition.upsert`, so it does not mutate business state.
- Approval is a local Lab confirmation. It does not call a plan approval endpoint. Formal plan
  approval remains the Ant footer until the next migration step.
- No Planner/Scheduler/Runtime/Teamwork/backend contract was changed.

## Verification (actual Electron)

- `scripts/design-lab-e2e.mjs` — 31/31 checks:
  - Inspector open/focus/edit/save/close; all fields preserved;
  - unsaved close confirmation;
  - Agent Inspector open/edit/model Popover/save;
  - Approval Dialog impact/confirm/state;
  - light/dark, 1440×900, 1100px, 125%, 880 logical.
- `scripts/design-lab-contrast.mjs` — composited light/dark pass.
- Actual screenshots:
  - `docs/design-system/v1.6-commercial-ui/design-lab/lab-inspector.png`
  - `lab-inspector-edit.png`, `lab-inspector-saved.png`, `lab-unsaved-prompt.png`
  - `lab-agent-inspector.png`, `lab-agent-edit.png`, `lab-agent-saved.png`
  - `lab-approval-dialog.png`
  - `design-lab-demo.webm`
- Visual acceptance by the user is still required.

## Known issues / next migration

1. Formal Task Inspector (`PlanReviewNext`) and task board drawer are still separate surfaces.
2. Settings nested drawers/modals still use Ant; audit table enumerates them.
3. Agent sample save is local-only; it must use the formal Agent mutation path during page migration.
4. Approval sample is local-only; formal approval must use the plan execution grant/approval path.
5. Closing a modal keeps it in the DOM for 220ms by design; screen readers see the final `closed`
   state only after removal.
6. Popover z-index is above the current layer but is not included in the global focus stack; it is
   anchored and dismissed independently.
7. Chromium/Electron composites a fixed inspector above the large .pdl-workspace`n   ackdrop-filter unpredictably, leaving a faint page ghost inside the white panel.
   While any overlay is open the Lab adds .is-overlay-open and drops only that workspace
   blur; the inspector remains opaque. Do not remove this workaround without re-running the
   1200ms Electron capture check.

No other page is migrated until the three samples are visually approved.


