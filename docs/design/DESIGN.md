# ProjectOS Premium Liquid Glass — Design Tokens

Status: frozen direction, five fixes in progress/complete as recorded in
`DESIGN_CHANGELOG.md`.

Implementation source: `apps/desktop/src/renderer/src/features/design-lab/design-lab.css`
and `Docs/design-system/v1.6-commercial-ui/DESIGN_LAB.md`.

## Color / surfaces

| Token | Light | Dark |
|---|---|---|
| `--pdl-ink` | `#22304d` | `#eff4ff` |
| `--pdl-ink-2` | `#5f6e89` | `#b5c2d9` |
| `--pdl-muted` | `#5f6e89` | `#8e9eb9` |
| `--pdl-accent` | `#5061dc` | `#9badff` |
| `--pdl-violet` | `#8b7cf2` | `#a595ff` |
| `--pdl-cyan` | `#43b8ce` | `#6dd4e2` |
| `--pdl-danger` | `#b45462` | `#e5919c` |
| `--pdl-warn` | `#86621f` | `#d8ae73` |
| `--pdl-ok` | `#1d7460` | `#7ad4b7` |
| solid content | `#fbfdff` | `#111b30` |

Measured composited light contrast: task title 12.5:1, secondary 5.96:1,
plan meta 5.34:1, inspector body/label 6.14:1. Dark: 15.42:1 / 6.26:1 /
6.89:1 / 9.55:1. `scripts/design-lab-contrast.mjs` asserts every sample ≥4.5:1.

## Typography

| Role | Size / line / weight |
|---|---|
| Page title | 26 / 1.24 / 660 |
| Section heading | 16 / 1.3 / 650 |
| Body | 14 / 1.55 / 450 |
| Secondary | 13 / 1.5 / 450 |
| Label | 12 / 1.35 / 620 |
| Numeric | tabular, tight tracking |
| Font stack | `SF Pro Display`, `Inter`, `PingFang SC`, `Microsoft YaHei`, system-ui |

No text-bearing surface uses `opacity`, `filter` or `blur`; glass sits behind
opaque content surfaces where reading density matters.

## Glass materials

| Material | Opacity / blur | Use |
|---|---|---|
| ambient field | static gradient / shader opt-in | page background only |
| workspace glass | translucent + 28px backdrop | main frame |
| optical glass | painted refraction + edge sheen | floating toolbar/action |
| elevated glass | translucent + 20px backdrop | readiness rail |
| solid content | opaque | ledger, inspector |
| focused surface | accent ring + higher opacity | selected node/role |

## Spacing / radii

- Base 4px; workspace 24px; panel gaps 14px; controls 6–10px.
- Radii: 8–10px controls, 14–18px trays, 22px inspector, 28px workspace.

## Motion

| Token | Value |
|---|---|
| fast | 180ms |
| base | 220ms |
| enter | 300–360ms |
| spring | stiffness 360, damping 36 |
| ease | `cubic-bezier(.22,1,.36,1)` |
| path draw | 900ms once |
| selected DAG path | static gradient + one-time reveal; no continuous flow |

`prefers-reduced-motion` removes path draw, entrance transforms and any
non-essential transition.
