# ADR-0092 — Type scale and information hierarchy

Date: 2026-11-10. Base: `feature/ux-polish-3` (PR #5, ADR-0091).

## Context

User feedback: many pages carry too much text, large and small type are mixed, and there is no
obvious place to look first. An audit at 1440×900 and 1100×800 found ad-hoc font sizes (9–30px,
more than 20 distinct values), English eyebrows above Chinese titles, stacked helper sentences,
zero-value counters, and nested boxes.

## Decision

1. **Type scale (tokens in `packages/design-tokens/src/unified.css`).** Four working sizes plus one
   display size:

   | token | size | use |
   | --- | --- | --- |
   | `--ui-type-title` | 22px | page title, one per page |
   | `--ui-type-section` | 16px | section / card title |
   | `--ui-type-body` | 14px | body, row titles, controls |
   | `--ui-type-caption` | 12px | meta, labels, helper text (muted) |
   | `--ui-type-display` | 32px | reserved for the single key number on a page |

   Plus `--ui-leading-tight` 1.25 / `--ui-leading-body` 1.55, `--ui-weight-strong` 650 /
   `--ui-weight-medium` 550, spacing rhythm `--ui-space-1..6` (4/8/12/16/24/32). Legacy
   `--ui-text-*` aliases map onto the scale. Utility classes live in
   `apps/desktop/src/renderer/src/styles/type-scale.css` (`.t-display/.t-title/.t-section/.t-body/
   .t-caption/.t-muted/.t-num/.t-oneline`). Hard-coded `font-size: Npx` in the touched page styles
   were mechanically mapped onto the tokens (≤12.5→caption, ≤14.5→body, ≤18→section, ≤26→title).
2. **Shared primitives.** `PageHeader` description is one muted line (ellipsis); meta is caption and
   muted; card subtitles are one muted caption line.
3. **One focal point per page**, secondary info demoted (muted, shorter, or behind title/tooltip):
   - 项目态势: KPI rail directly under the header; only 任务进度 uses display size. Lifecycle is a
     single-row track without a card or subtitle; only the active stage is labelled in ink.
   - 审阅与决策 · 记录: summary numbers at section size, compact durations, one-line reasons.
   - 资源与连接 / 发布 / 部署: English eyebrows removed; one-line descriptions.
   - 部署中心 setup: one headline + one prerequisite track (duplicate “交付什么/交付到哪里” map removed).
   - 发布中心: no card-in-card; one header row; zero counters hidden; empty state is one prompt.
   - 需求工作台: eyebrow and “00 00 00” counters removed; the requirement title is the focal point.
   - 版本与迭代: relationship banner and duplicate 项目状态 card removed; subtitles cut.
   - 知识库: index card becomes a spec sheet (stack as the focal line, no nested boxes).
   - 任务看板: team roster becomes a single-row dock (34px avatars, no per-agent cards).
4. Accent colour is limited to the focal item and primary action; status colour stays on dots.

## Consequences

- New UI should use the tokens/classes, not raw pixel sizes.
- Some dense legacy surfaces outside this pass still contain raw sizes; they collapse to the scale
  through the legacy aliases but were not individually reviewed.
