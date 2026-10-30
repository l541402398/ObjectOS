# ProjectOS Premium Liquid Glass — Design Tokens

Status: frozen direction, five fixes in progress/complete as recorded in
`DESIGN_CHANGELOG.md`.

Implementation source: `packages/design-tokens/src/unified.css`,
`apps/desktop/src/renderer/src/styles/system-premium.css` and the protected
`apps/desktop/src/renderer/src/features/design-lab/design-lab.css`.
The older `Docs/design-system/v1.6-commercial-ui/DESIGN_LAB.md` is historical evidence.

## Color / surfaces

| Token | Light | Dark |
|---|---|---|
| `--pdl-ink` | `#2c3b56` | `#eff4ff` |
| `--pdl-ink-2` / `--ui-ink-2` | `#4b5a73` | `#b5c2d9` |
| `--pdl-muted` / `--ui-muted` | `#4b5a73` | `#a4b4d0` |
| `--ui-accent` | `#4f64d9` | `#9badff` |
| `--pdl-accent` / `--ui-accent-strong` | `#3e50bd` | `#b2c1ff` |
| `--pdl-violet` | `#8b7cf2` | `#a595ff` |
| `--pdl-cyan` | `#43b8ce` | `#6dd4e2` |
| `--pdl-danger` | `#a74758` | `#e5919c` |
| `--pdl-warn` | `#805d18` | `#d8ae73` |
| `--pdl-ok` | `#1d6b56` | `#7ad4b7` |
| solid content | `#f4f7fd` | `#111b30` |
| reading / overlay content | opaque cool violet–blue gradient | opaque navy–violet gradient |

Historical Lab-only measurement (not a whole-system acceptance result): composited light contrast: task title 12.5:1, secondary 5.96:1,
plan meta 5.34:1, inspector body/label 6.14:1. Dark: 15.42:1 / 6.26:1 /
6.89:1 / 9.55:1. `scripts/design-lab-contrast.mjs` asserts every sample ≥4.5:1.

## Typography

2026-10-30：用户进一步指出字体锐利、单调和白底突兀。本轮在批准的光学空间内统一为随应用打包的
Noto Sans SC 可变字体（CSS 名称 ProjectOS Sans）；不依赖在线字体，不改变冷紫/青色方向。
标准页标题 600，面板/卡片标题 550，正文 400，36px 常规控件 / 10px 圆角。目标标题最高 24px，
独立页标题 26px；不再混用首页 37–40px 标题与 12.5px 关键待办标题。
完整证据和仍待验证项见 `system-premium/REPORT.md`。

| Role | Size / line / weight |
|---|---|
| Page title | 26 / 1.35 / 600 |
| Section heading | 16 / 1.5 / 600 |
| Card / inspector heading | 14 or 20 / 1.4–1.6 / 550 |
| Body | 14 / 1.55 / 400 |
| Secondary | 13 / 1.55 / 400 |
| Label | 12 / 1.35 / 500 |
| Numeric | tabular, tight tracking |
| Font stack | `ProjectOS Sans`, `PingFang SC`, `Microsoft YaHei UI`, system-ui |
| Code | platform monospace, then `ProjectOS Sans` for Chinese; no generic Chinese serif fallback |

The full local WOFF2 is 7,782,072 bytes, contains 30,890 Unicode mappings, and retains weight
100–900. Source, exact hashes and OFL-1.1 license accompany `assets/fonts/`; About exposes the
license. The renderer waits for the local face before mounting. The old `--pw-font`/`--pw-mono`
aliases are explicitly mapped: native inspection had found NSimSun when they were missing.
See `system-premium/readiness/checks.json` for actual platform font and frame evidence.

No text-bearing surface uses `opacity`, `filter` or `blur`; glass sits behind
opaque content surfaces where reading density matters.

## Glass materials

| Material | Opacity / blur | Use |
|---|---|---|
| ambient field | static gradient / shader opt-in | page background only |
| product workspace glass | translucent static optical paint + edge sheen | main frame and navigation |
| protected Lab workspace | existing optical recipe / 28px backdrop | approved Lab composition |
| optical glass | painted refraction + edge sheen | floating toolbar/action |
| elevated glass | translucent + 20px backdrop | readiness rail |
| reading content | opaque subtle cool gradient, no text blur | ledger, inspector, settings |
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
| collaboration flow | up to 12 directional paths; 3.2s / 0.7s repeat delay; explicit pause |

`prefers-reduced-motion` removes path draw, entrance transforms and any
non-essential transition.
