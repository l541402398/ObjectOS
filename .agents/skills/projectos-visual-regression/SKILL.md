---
name: projectos-visual-regression
description: "ProjectOS 视觉回归与发布前 UI 验收规范。用于任何 renderer UI 改动、截图对比、1100/125% 检查、Design Lab/Plan Review/页面迁移验收；必须使用打包 Electron 与批准基线，不允许用单元测试或 dev preview 代替。"
tags: [projectos, visual-regression, playwright, screenshots, acceptance]
metadata:
  version: "1.0.0"
  owner: projectos
  source: docs/AI_TOOL_ROUTING.md
---

# ProjectOS Visual Regression

## 何时使用

- 任何 renderer UI/CSS/组件改动。
- 发布包验收、页面迁移、Overlay/Plan Review 修复。
- 用户说“看起来不对/和之前不一样”。

## 必读

1. `AGENTS.md`
2. `docs/AI_TOOL_ROUTING.md` R-09
3. `docs/next-ui/VISUAL_BASELINE.md`
4. `docs/next-ui/visual-regression/APPROVED-design-lab-dag.png`
5. `docs/design/PROJECTOS_UI_CONTRACT.md`
6. 目标页面的最新截图/基线

## 输入

- 变更范围/路由。
- 目标窗口：1440×900、1100px、125%。
- 主题：light/dark。
- 基线截图/commit。

## 执行步骤

1. **构建真实产物**：`pnpm build`；必要时 `pnpm package:dir`。
2. **启动打包 Electron**（不是 Vite preview）；使用临时 `PROJECTOS_DATA_DIR` / `--user-data-dir`。
3. **固定数据/状态**：演示种子或真实测试项目；记录计划状态（draft/approved）。
4. **截图矩阵**：
   - 1440×900 light/dark；
   - 1100px；
   - 125% DPI（`--force-device-scale-factor=1.25`）；
   - 关键交互状态（默认/选中/抽屉/审批/滚动）。
5. **逐张检查**：文字清晰、无重影、无裁切、无错误层级、布局/数据/按钮位置。
6. **自动验证**：`phase5-pages-e2e`、`plan-review-workspace-e2e`、`design-lab-contrast`。
7. **打包冒烟**：`pnpm test:package`。
8. **记录**：截图路径、对比结论、未验证项；不以“测试全绿”替代视觉结论。

## 已验证基线/证据

- `docs/next-ui/visual-regression/APPROVED-design-lab-dag.png`
- `plan-inspector-fixed.png`
- `plan-approved-status.png`
- `docs/performance/visual/*.png`

## 工具依赖

- `playwright-core@1.64.1`
- `scripts/phase5-pages-e2e.mjs`（48 checks）
- `scripts/plan-review-workspace-e2e.mjs`（13 checks）
- `scripts/design-lab-e2e.mjs`（31 checks）
- `scripts/design-lab-contrast.mjs`
- `scripts/package-smoke.mjs`

## 禁止事项

- dev server 截图当打包验收。
- 只看一张 1440 截图；跳过 1100/125/dark。
- 用旧数据/不同路由截图证明一致。
- 伪造通过；隐藏未验证项。
- 用 CSS 缩放/截图裁剪掩盖布局问题。

## 验收标准

- [ ] 打包 EXE + 固定数据。
- [ ] light/dark、1440/1100/125% 截图齐全。
- [ ] 与批准基线并排无结构/材质/文字退化。
- [ ] Phase5 + Plan E2E + package smoke 通过。
- [ ] 未验证项列表。
- [ ] 关键截图提交到 `docs/next-ui/visual-regression/` 或对应目录。
