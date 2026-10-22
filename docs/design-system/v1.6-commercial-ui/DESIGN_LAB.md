# ProjectOS Premium Liquid Glass — Design Lab

## Start

```powershell
pnpm dev:design-lab
```

This starts the real Electron app with `PROJECTOS_START_ROUTE=design-lab`; the
window opens directly at `#/design-lab`. The lab is outside `AppLayout`, so it
does not use the Ant page shell.

Equivalent manual launch:

```powershell
$env:PROJECTOS_START_ROUTE = 'design-lab'
pnpm dev
```

The Design Lab is a local prototype. It uses `features/design-lab/data.ts` only;
it does not call approval, create tasks, start Agents, or write the business DB.

## Branch

- Branch: `feature/v1.6-liquid-glass-design-lab`
- Base: `feature/v1.6-premium-liquid-glass` `d76b686`
- Not merged.
- Worktree: `C:\Users\Administrator\Desktop\workplace\ProjectOS-commercial-ui`

## Skills actually installed and used

Cloned source:

- `C:\Users\Administrator\Desktop\workplace\design-skills\ui-ux-pro-max`
- `C:\Users\Administrator\Desktop\workplace\design-skills\vercel-agent-skills`

Installed into the DSH discoverable skill directory:

```text
C:\Users\Administrator\.dsh\skills\
  ui-ux-pro-max\
  vercel-composition-patterns\
  vercel-react-best-practices\
```

The runtime catalog changed after installation and the three skills were loaded
with the `skill` tool in this session. They are therefore active, not merely
vendored documentation.

- UI UX Pro Max commit: `623a9a9037d006ea727f8213f084d02a6b6f11b5` (MIT)
- Vercel Agent Skills commit: `063bee94c3f4df8453406c830b0a7df0f2860278`
  (per-skill metadata declares MIT; the repository root has no separate LICENSE
  file, so the metadata is the recorded license).

Commands run from UI UX Pro Max:

```text
python .claude/skills/ui-ux-pro-max/scripts/search.py
  "AI project management workflow desktop productivity premium glass"
  --design-system --persist -p "ProjectOS Premium Liquid Glass"
  --variance 7 --motion 6 --density 8
```

The generated master recommendation was reviewed and **rejected** as a visual
direction: it returned a generic Flat Design/teal-orange system that conflicts
with the already selected Premium Liquid Glass direction. Its accessibility,
spacing, motion and delivery checklists were still used.

Follow-up searches used:

```text
"glassmorphism premium desktop optical glass" --domain style
"focus visible modal dialog keyboard" --domain ux
```

Those returned the Glassmorphism material profile (blur 10–20px, translucent
light, edge reflection, z-depth) and the focus/keyboard checks applied to the
inspector.

Vercel Skills used:

- `vercel-react-best-practices`: lazy route loading, memoized derived data,
  adaptive expensive-effect fallback, no unnecessary re-render subscriptions.
- `vercel-composition-patterns`: separated `LabStageJourney`, `LabTaskGraph`,
  `TaskInspector`, and `OpticalGlass` instead of growing one boolean-prop page.

## Open source research and integration

| Project | License | What was inspected | What is used |
|---|---|---|---|
| Sim Studio | Apache-2.0 | `workflow.tsx`, `canvas-menu.tsx`, editor layout and canvas interaction | Composition learning only: rail + floating view toolbar + canvas + inspector + footer; no source copied |
| liquid-glass-react 1.1.1 | MIT | package source, SVG filter, displacement maps | Installed; mounted in the glass compatibility probe; rejected as default because of Electron rendering |
| React Bits Aurora | MIT + Commons Clause | `Aurora.tsx` shader/component from the registry | Source adapted locally as `Aurora.jsx`, with attribution; shader + adaptive fallback |
| Motion for React | MIT | — | Route/view transitions, stage shared halo, inspector spring, risk height transition, DAG node opacity |
| XYFlow / React Flow | MIT | — | `LabTaskGraph` canvas, ports, controls, selection |
| ELK.js | EPL-2.0 | — | Layered automatic layout for seven demo tasks |
| Tailwind CSS 4 | MIT | — | Already integrated; lab CSS uses tokens and utilities |
| Radix UI | MIT | — | Existing dialog/tabs/tooltip primitives; lab inspector uses a dedicated accessible overlay |
| Lucide | ISC | — | All interface icons |

No Sim Studio brand asset or source file was copied.

## Performance / compatibility environment\n\n- Windows desktop, Electron **43.8.2**, React **19.3.1**.\n- Window 1440×900 for primary measurements; 1100×800 for compact.\n- webContents.setBackgroundThrottling(false) only for the frame probe so an\n  unfocused window does not report a false 4–6 fps.\n- Frame probe: 2 s equestAnimationFrame count after the adaptive decision.\n- GPU compositing was left at Electron defaults.\n\n## Liquid Glass React evaluation (real evidence)

`liquid-glass-react@1.1.1` is installed and mounted when the beaker button in the
top bar is pressed (`玻璃兼容性对照`). Its `.glass__warp` computes:

```text
filter: url("#_r_u_")
backdrop-filter: blur(...) saturate(...)
```

In this Electron/Chromium build the library's SVG filter produces a dark,
unreadable rectangle over the light tray, and the probe measured **7 fps**.
Screenshot: `lab-liquid-glass-library.png`.

The reproducible fallback is `OpticalGlass.tsx`:

- painted ambient-refraction layer;
- `feTurbulence` + `feGaussianBlur` + `feDisplacementMap` (not only
  `backdrop-filter`);
- edge sheen, inner highlight, translucent border;
- static once rendered, so the default workspace measures 44–69 fps depending on
  window focus (the E2E run recorded 44 fps with the system foreground forced).

Limitation: the fallback refracts a painted light field rather than a captured
snapshot of the live DOM behind it. It reproduces the optical edge/material
behavior without the library's broken Chromium filter. This is documented rather
than presented as the library's shader.

## Ambient background

`Aurora.jsx` is adapted from the React Bits Aurora registry component
(MIT + Commons Clause; attribution retained in the file). It uses WebGL2.

Real measurements:

| Mode | FPS over 2 s |
|---|---:|
| Aurora shader forced on, 1440×900 | **8 fps** |
| liquid-glass-react probe visible | **7 fps** |
| Adaptive CSS optical fallback | **44–69 fps** (final run: 69/69) |

At runtime the lab probes the first 1.2s and automatically switches to the
static optical fallback below 42 fps. `?aurora=on` forces the shader;
`?aurora=off` forces the fallback. This is the low-performance degradation path.

## Layout and scenes

- **A — Plan review workspace**: left navigation rail, full-width glass
  workspace, plan header, stage journey, task ledger, readiness rail, approval
  footer. No Ant modal.
- **B — Task inspector**: right floating focused surface, role/Agent menus,
  dependency chips, editable acceptance rows, artifact chips, capability
  toggles, approval switch, Escape/focus trap, prototype-only actions.
- **C — DAG**: React Flow canvas with ELK layered automatic layout, ports,
  parallel branch, node selection, upstream/downstream emphasis, zoom/pan/fit.

## Design tokens

### Color

| Token | Light | Dark |
|---|---|---|
| `--pdl-ink` | `#22304d` | `#eff4ff` |
| `--pdl-ink-2` | `#5f6e89` | `#b5c2d9` |
| `--pdl-muted` | `#7c8ba3` | `#8e9eb9` |
| `--pdl-accent` | `#596be5` | `#9badff` |
| `--pdl-violet` | `#8b7cf2` | `#a595ff` |
| `--pdl-cyan` | `#43b8ce` | `#6dd4e2` |
| `--pdl-danger` | `#b45462` | `#e5919c` |
| `--pdl-warn` | `#a57635` | `#d8ae73` |
| workspace | pearl white glass | deep navy glass |
| solid content | `rgba(249,251,255,.88)` | `rgba(18,29,52,.9)` |
| inspector | `#fbfdff` | `#111b30` |

### Typography

- Family: `SF Pro Display`, `Inter`, `PingFang SC`, `Microsoft YaHei`,
  system-ui.
- Display: 25px / 1.25 / 660.
- Section: 13px / 1.3 / 650.
- Body: 11.5–12px / 1.45–1.6.
- Label: 10–10.5px / 620, +0.03em.
- Numeric: tabular, 18–32px, tight tracking.
- No body text below 10px; task titles and inspector fields have been raised
  from the first pass to avoid “shrink to fit”.

### Spacing / shapes

- Base unit 4px; workspace padding 24px; card gap 14px; control gaps 6–10px.
- Radii: controls 8–10px, glass trays 14–18px, workspace 28px, inspector 22px.
- Main workspace width: fluid; fixed content panels use `minmax(0, 1fr)` to avoid
  overflow.

### Glass materials

| Material | Use |
|---|---|
| Ambient aurora / static optical field | background only |
| Workspace glass | main workspace, 28px radius |
| Optical glass | floating view toolbar and inspector action |
| Elevated glass | readiness rail |
| Solid content | task ledger, inspector body |
| Focused surface | selected task, role, DAG node |

### Accessibility checks

Measured light-theme contrast on `#fbfdff`:

| Token | Ratio |
|---|---:|
| ink | 12.89:1 |
| muted (raised from `#7c8ba3`) | 5.05:1 |
| accent | 5.04:1 |
| warning | 5.45:1 |
| success | 5.54:1 |

Dark-theme muted/accent/warn/success are 6.3:1 or higher. Focus rings are visible
on every interactive control; the inspector traps Tab, closes on Escape, makes
the workspace `inert`, and restores focus on close. The design lab is a
pointer-first desktop workspace, so the skill's 44px touch target minimum is not
met by the 30–38px desktop chrome; this is recorded as a limitation rather than
silently claimed as a mobile pass.

### Motion

| Token | Value |
|---|---|
| fast | 180ms |
| base | 220ms |
| enter | 300–360ms |
| spring | stiffness 360, damping 36 |
| ease | `cubic-bezier(.22,1,.36,1)` |
| path draw | 900ms ease-out, once |
| DAG edge flow | 2.8s linear, selected path only |

All non-essential motion is disabled by `prefers-reduced-motion`; Aurora and
optical effects degrade to static fields.

## Verification

- `pnpm lint` — PASS
- `pnpm typecheck` — PASS
- `pnpm test` — 265 passed / 3 skipped
- `pnpm build` — PASS
- `pnpm package:dir` — PASS
- `pnpm test:package` — PASS
- `scripts/design-lab-e2e.mjs` — 15/15 checks PASS
- `scripts/design-lab-perf.mjs` — forced Aurora 8fps, library probe 7fps
- Interaction recording: `design-lab-demo.webm` (20.1s, 1280×800 VP9)

## Screenshots

- `lab-light.png` — full workspace, 1440×900
- `lab-dark.png` — independent dark theme
- `lab-inspector.png` — focused task inspector
- `lab-inspector-edit.png` — long Chinese title and added acceptance row
- `lab-dag.png` — ELK + React Flow dependency map
- `lab-dag-focus.png` — selected DAG node with inspector opened
- `lab-dag-path.png` — node focus/path after closing inspector
- `lab-1100.png` — 1100px window
- `lab-125.png` — Electron zoom 1.25 (capture crop limitation)
- `lab-880-native.png` — minimum real Electron window (1024 CSS px)
- `lab-liquid-glass-library.png` — library probe, dark filter defect
- `lab-aurora-forced.png` — forced shader, 8fps evidence

## Known limits

1. Electron's minimum window width is 1024px; a native 880px window could not be
   produced. The 125% measurement reports `clientWidth=880`, `scrollWidth=880`,
   but `capturePage()` crops the right edge. This is recorded rather than hidden.
2. Aurora WebGL is too expensive on this machine (8fps); the shader is therefore
   opt-in/forced and the static optical fallback is the default.
3. liquid-glass-react's SVG filter is visually broken in this Chromium/Electron
   environment (dark fill) and measures 7fps; it remains installed and mounted
   only in the compatibility probe.
4. The optical fallback warps a painted light layer, not a DOM snapshot.
5. This is a local prototype; approval/reject buttons are explicitly labelled as
   prototype interactions and do not call the real API.
6. Only the Design Lab was built. No formal ProjectOS page was replaced.
7. Visual acceptance is the user's decision; test metrics are not presented as
   visual acceptance.



