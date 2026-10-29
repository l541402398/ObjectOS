# ADR-0044 — Overlays render in the app theme

- Status: Accepted (Phase 2.8.8 UX)
- Related: ADR-0031 (goal status), `docs/design/OVERLAY_SYSTEM.md`, DESIGN_CHANGELOG

## Context

用户报告任务详情抽屉「字体、组件颜色对比有问题，文案看不清」。真实复现（真实项目、真实任务）：

- 抽屉面板是**浅色**（`--pui-ov-solid = #fbfdff`，因为 `data-theme` 缺失 → 走 light token）；
- 抽屉内容里的正文/字段名用的是**应用级**颜色 token，而当时应用是暗色主题，
  于是 `--color-text-secondary (#c6d0e6)` / `--color-text-tertiary (#93a1c0)` 叠在白色面板上
  —— 浅灰字压白底，几乎不可读。

根因：`InspectorShell` / `ModalShell` 的 `theme` 是**可选**的，绝大多数调用点（任务抽屉就是其中之一）
没有传，于是 `data-theme` 属性根本没渲染，面板永远落到 light token；而面板内的业务组件用的是全局主题 token。
两套主题系统在同一棵树里各走各的。

## Decision

`next-ui/overlay` 的三种外壳（Dialog / Sheet / Inspector）在调用方未显式指定主题时，
**默认使用应用当前解析后的主题**（`useResolvedTheme()`，来自 `stores/ui`）。
调用方仍可显式覆盖（例如将来的浅色"纸张"式面板），但默认不再出现"面板一套主题、内容另一套主题"。

## Consequences

- 抽屉/弹窗跟随明暗切换：暗色下深色面板 + 浅色文字，亮色下浅色面板 + 深色文字，两套 token 同源。
- 一处修复覆盖所有 overlay 调用点，无需逐个页面传 `theme`。
- 视觉语言不变：仍使用既有 `--pui-ov-*`、既有玻璃材质与动效，只纠正主题归属。

## Verification (real Electron, real task)

`scripts/p288-drawer-contrast-e2e.mjs`（真实项目 6 个任务，真实点击任务卡打开抽屉）：

```
亮色 抽屉跟随应用主题 — panel data-theme=light background=rgb(251, 253, 255)
亮色 文字对比度达标   — 标题 12.89:1 · 眉标 5.05:1 · 元信息 5.05:1 · 正文 16.04:1
暗色 抽屉跟随应用主题 — panel data-theme=dark background=rgb(17, 27, 48)
暗色 文字对比度达标   — 标题 15.58:1 · 眉标 6.33:1 · 元信息 6.33:1 · 正文 16.02:1
PASS=6 FAIL=0
```

截图：`docs/screenshots/p288-drawer-light.png`、`p288-drawer-dark.png`。

## Limits

本脚本只采样面板标题、眉标、元信息与正文（4 个节点）；表格内部更细的单元格、按钮悬浮态未逐一采样，
由既有视觉回归与后续抽查覆盖。
