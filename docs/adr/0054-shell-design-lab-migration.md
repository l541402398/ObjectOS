# ADR-0054 — Shell adopts the approved Design Lab material and composition

- Status: Accepted (batch 1 of the migration; page bodies pending)
- Related: ADR-0044 (overlays follow the app theme), `docs/design/VISUAL_BASELINE.md`

## Context

The user reviewed the 编排工作台 rendering and said the Design Lab (0686c41) material and composition
look better than the previous system look, and explicitly allowed replacing the current system style
with it. The journey bar work (ADR-0053) needed a visual language anyway.

A full-product restyle in one pass cannot be visually accepted, and the UI contract forbids restyling
without side-by-side screenshots. So the migration is batched.

## Decision (batch 1)

`apps/desktop/src/renderer/src/styles/shell-design-lab.css` declares the Design Lab optical tokens at
`:root` (`--pdl-*`, light + dark) and applies them to the **shell only**:

- ambient canvas becomes the Design Lab 132° gradient plus the violet/cyan/accent radial field;
- `.po-sidebar.glass-panel` and `.po-main` use the Design Lab optical glass recipe (surface gradient,
  strong inner highlight, `--pdl-shadow`, `--pdl-line-strong` borders in dark);
- the titlebar and status bar stay transparent over the canvas; breadcrumb colours follow `--pdl-ink`;
- the goal journey bar uses the same surface, ink and state colours (`--pdl-ok/accent/warn`).

The Design Lab page keeps its own `.pdl-root` scope, so this does not change it.

## Consequences

- The shell now reads as one optical surface instead of stacked flat cards; dark mode keeps the same
  recipe with the Design Lab dark tokens.
- Page bodies (work center, board, approvals, runs, orchestration panels, overlays) still use the old
  card styles: they are batch 2+, each shipped with a before/after screenshot and a contrast check.
- No business behaviour changed; this is tokens and shell surfaces only.

## Verification

Screenshots from the real Electron first-run E2E: `docs/screenshots/p29-journey-1440.png`,
`p29-journey-1024.png`, `p29-journey-1440-125.png`, `p29-journey-no-project.png`,
`p29-journey-restart.png`; layout check at 1440/1024/125% (no horizontal overflow, career bar 56px,
9 stages visible, no truncated labels).
