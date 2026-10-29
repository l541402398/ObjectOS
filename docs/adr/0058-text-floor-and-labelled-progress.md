# ADR-0058 — 12px floor for content text, and a labelled percentage

- Status: Accepted (Phase 2.9-P0)
- Related: design tokens, ADR-0054 (shell migration)

## Context

The user reported: "内页中的小字体发虚，都看不清啊，好多页面都是这样". A computed-style sweep found 605
declarations below 12px across the product CSS (8.5px tags in the approval workbench, 9.5–11px in the
work center, deployment console, release workbench, lifecycle, resources, overlays) and inline
`fontSize` values in a few TSX files. At 125% Windows scaling those fractional sizes rasterise badly.

## Decision

1. Every content text declaration below 12px is raised to **12px** in product styles (605 declarations
   across 20 files). The approved Design Lab (`features/design-lab/**`) is excluded: its smaller type is
   part of the protected visual baseline.
2. Non-content ornaments keep their size only when they carry no information; the sweep is verified by
   measuring computed font sizes in real Electron, not by reading CSS.
3. Project cards and the project-center hero must label what a percentage measures. "75% 生命周期进度"
   became "1/4 任务完成 · 1 个已完成 · 3 个未完成"; cards show "25% 任务". The duplicated journey row that
   was added to the hero was removed — the global bar already answers that question and the row made the
   hero look abrupt.

## Verification

- `scripts/p29-visual-sweep.mjs`: 9 business pages × 1440/1024, each asserting a real heading, no
  "页面不存在", no horizontal overflow, the journey bar present, and **zero** content text below 12px —
  18/18 PASS.
- `scripts/p29-approvals-readonly-e2e.mjs`: approval page computed text all ≥12px.
- `scripts/p29-center-hero-check.mjs`: hero has no journey row, no bare percentage, no tiny text, one
  labelled task ratio (1440 + 1024 screenshots).
