# ProjectOS Design System — Premium Liquid Glass

Status: **frozen visual direction**, approved from the Design Lab baseline.
This document is the long-lived contract for the Next UI migration. It does not
grant permission to redesign the direction; it defines how it is applied.

Source of truth:

- contract: `docs/design/PROJECTOS_UI_CONTRACT.md`
- tokens: `docs/design/DESIGN.md`
- Design Lab: `apps/desktop/src/renderer/src/features/design-lab/`
- overlay rules: `docs/design/OVERLAY_SYSTEM.md`
- audit: `docs/design/OVERLAY_AUDIT.md`
- approved images: `docs/design/baselines/` and
  `docs/design-system/v1.6-commercial-ui/design-lab/`
- runtime rules: root `AGENTS.md`

## 1. Color and theme

The palette is cool, optical and low-chroma: deep navy ink, blue-violet accent,
cyan secondary, warm risk and cool success. Surfaces are not pure white slabs;
they are **focused optical surfaces** over a soft lit environment.

Light tokens (see `DESIGN.md` for the complete table):

| Role | Value |
|---|---|
| ink | `#22304d` |
| ink secondary / muted | `#52617b` |
| accent | `#4f64d9` |
| cyan | `#2a92a2` |
| success | `#28785e` |
| warning | `#97651c` |
| danger | `#b45462` |
| focused solid | `#fbfdff` |

Dark equivalents use navy solids (`#111b30`), light ink (`#eff4ff`) and
desaturated accents. Every theme must be verified with actual composited
contrast, not token-by-token ratios.

Rules:

- text never sits on a blurred or translucent plate; text-bearing surfaces are
  opaque;
- status color is semantic, not decorative;
- no raw one-off hex values in page code when a token exists;
- light and dark are both first-class; a component is not migrated until both
  are checked.

## 2. Optical glass materials

Three material levels:

| Level | Use | Rules |
|---|---|---|
| Ambient | page background / aurora | light, spatial, never text-bearing |
| Optical glass | toolbar, rail, workspace frame, floating controls | border, inner highlight, restrained blur, no text over busy imagery |
| Focused surface | Inspector, dialog, menu, ledger | opaque solid, clear border/shadow, no `backdrop-filter` |

Glass is a **material of the frame**, not a universal background for content.
Do not turn every card into a blurred rectangle. The accepted Design Lab
fallback (`OpticalGlass`) is preferred over the broken high-cost
`liquid-glass-react` filter in Electron.

## 3. Ambient light and background

- Soft blue-violet-cyan aurora, low frequency, no hard blobs.
- The default static fallback is the production path; WebGL Aurora is opt-in
  and must pass the performance check in the current environment.
- Ambient motion must be interruptible and disabled under
  `prefers-reduced-motion`.
- Background never competes with text; if it does, reduce it, do not raise text
  opacity.

## 4. Typography and Chinese typesetting

Base sans stack: `SF Pro Display`, `Inter`, `PingFang SC`, `Microsoft YaHei`,
`system-ui`.

| Role | Size | Weight | Line height |
|---|---:|---:|---:|
| Page title | 26px | 660 | 1.24 |
| Section title | 16px | 650 | 1.3 |
| Body | 14px | 450–580 | 1.55 |
| Secondary | 12.5px | 450 | 1.4 |
| Label / meta | 12px | 560–620 | 1.35 |
| Code / eyebrow | 10.5–11px | 560 | 1.3 |

Rules:

- no body copy below 12px; 10–11px is only for monospace metadata or eyebrow;
- Chinese body line-height must not be below 1.5;
- mixed CJK/Latin needs explicit spacing around inline code and Latin labels;
- long Chinese titles wrap at word/phrase boundaries and never clip;
- avoid transform/opacity/filter on text; those are for frames and entering
  surfaces only;
- verify actual rendered contrast on the final composited surface.

## 5. Spacing, radii, composition

- base unit: 4px; primary rhythm: 4/8/12/16/24/32;
- workspace inset: 21–24px; panel padding: 14–18px;
- control radius: 8–10px; cards: 12–16px; workspace: 28px; inspector: 20–22px;
- one dominant workspace per page, with a secondary rail or inspector only when
  the task needs it;
- no “dashboard of equal cards” for every page; composition follows the job.

## 6. Icons and graph nodes

- Lucide is the default icon set; icons are line-first, 1.6–1.75 stroke.
- Icon buttons need an accessible name and a visible focus ring; 38–40px is the
  desktop pointer target, not 24px.
- DAG nodes are compact cards: code, title, agent/role, stage, status.
- Nodes have a clear port on each side; selected node gets a restrained halo,
  not a saturated fill.
- Node text must not fall below 11.5px; default node size 168×72 for the Lab
  graph.

## 7. Connection lines

- XYFlow + ELK only; topology comes from persisted dependencies.
- Solid, neutral 1.2–1.5px edges, 16px rounded orthogonal corners.
- No default dashed “technical demo” lines.
- Selected/focused path: restrained blue→cyan gradient, 1.8–2px, static glow.
- Unrelated edges are de-emphasized, not hidden.
- No continuous whole-graph animation. Motion only on selection/focus and it
  must be interruptible.

## 8. Motion

- Tokens: 160ms micro, 220–260ms surface, 320–480ms spatial; standard ease
  `cubic-bezier(.22,1,.36,1)`.
- Overlay close keeps content mounted for 220ms; entering uses opacity/offset,
  not layout thrash.
- Hover/press feedback is physics-light and local.
- No looping glow, no continuous graph flow, no decorative animation that
  competes with work.
- All motion honors reduced-motion; expensive WebGL/filter effects require a
  measured fallback.

## 9. Overlay and Inspector

Use the shared system:

- `InspectorShell` — non-modal, workspace-linked detail/edit for tasks, agents,
  projects;
- `SheetShell` — modal side sheet for large secondary surfaces (run/log/diff);
- `DialogShell` — modal forms and irreversible/approval confirmations;
- `PopoverShell` — anchored selectors/menus;
- `WorkspacePanel`/`Full Workspace` — persistent canvas or plan review.

Rules:

- no page-owned drawer animation;
- no double backdrop for a nested inspector;
- one scroll owner; header/footer fixed;
- dirty close opens a confirmation;
- Escape closes the top surface; focus is trapped/restored;
- confirmations for delete/approval use a real modal Dialog;
- non-modal inspector must leave the workspace interactive.

## 10. Responsive layout

- reference desktop: 1440×900; important state at 1100px and 125% zoom;
- no horizontal document overflow at 1100px or 125%;
- Inspector width `min(480–520px, 100vw - 24px)`; dialogs
  `min(width, 100vw - 32px)`;
- below 680px the overlay occupies the available width with 8px inset;
- Electron minimum window is 1024px; do not present an 880px native window as a
  supported capture size without documenting the limitation;
- long content scrolls inside one region, not the page and panel together.

## 11. De-explanatory copy

The interface is a tool, not a product tour.

Keep only operation, state, core data, necessary label, safety warning, cost or
permission note, recovery action. Remove feature introductions, welcome copy,
repeated subtitles and decorative hints. Security/irreversible-action copy is
retained even when it is “explanatory”.

## 12. Accessibility and performance

- keyboard path for every overlay and menu;
- visible focus, accessible names, no keyboard traps;
- contrast target 4.5:1 for text; verify composited surfaces;
- no text over transform/filtered layers;
- no forced WebGL Aurora; no forced liquid-glass SVG filter;
- FPS is measured in a controlled foreground run; occluded Electron windows are
  not a performance pass;
- reduced-motion and static optical fallback are production behavior, not
  optional polish.

## 13. Forbidden legacy patterns

- default Ant table/form shell as the page identity;
- three equal white cards with drop shadows as “layout”;
- rectangular graph nodes with dashed default edges;
- permanent stage labels around the route icons;
- 10–11px body copy to force content into a viewport;
- blurred panels carrying text;
- a new bespoke drawer implementation per page;
- double masks from nested Ant/Radix overlays;
- explanatory filler subtitles, welcome banners, marketing copy;
- continuous animations/glow across the entire canvas.

## Enforcement

Before a page migration:

1. read this file, the contract, the overlay system and the current baseline;
2. inspect actual page source and its real API calls;
3. reuse the overlay primitives and tokens;
4. produce 1440×900 light/dark and 1100/125% evidence;
5. update `docs/next-ui/MIGRATION_PROGRESS.md` and `OPEN_ISSUES.md`;
6. commit a checkpoint on the migration branch.

Visual acceptance remains a human decision; a green test run is not visual
approval.
