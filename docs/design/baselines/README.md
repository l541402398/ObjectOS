# Approved Visual Baselines

Status: **approved icon-only Premium Liquid Glass Design Lab**  
Approved tag: `visual-baseline-approved-icons-10d84f4`  
Approved commit: `10d84f4`  
Corrected: 2026-10-22 after user clarified that the approved stage route has **no text under the icons**

## Current approved set

| File | Surface |
|---|---|
| `approved-light.png` | 1440×900 light Design Lab, icon-only stage route |
| `approved-dark.png` | 1440×900 dark Design Lab, icon-only stage route |
| `approved-stage-route.png` | approved stage route / workspace composition |
| `approved-dag.png` | ELK + React Flow dependency map |

These files are protected. Do not re-add always-visible stage names, descriptions or
counts under the icons. Stage details live in the tooltip and selected-stage summary.

## Rejected candidate

`0686c41` showed stage names, descriptions and counts under the icons. It was
previously misidentified as approved. The screenshots are retained for history as:

- `rejected-labels-0686c41-light.png`
- `rejected-labels-0686c41-dark.png`

Do not use those as the acceptance baseline.

## Historical post-fix captures

`post-fix-*` captures are retained as historical implementation evidence. They are
closer to the approved icon-only direction than the rejected label versions, but
the authoritative reference is now `approved-light.png` / `approved-dark.png`.

The five required fixes are tracked in
`docs/design/PROJECTOS_UI_CONTRACT.md` and `docs/design/DESIGN_CHANGELOG.md`.
