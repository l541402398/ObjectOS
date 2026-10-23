---
name: projectos-glass-ui
description: "ProjectOS 的 Premium Liquid Glass UI 与页面布局执行规范。用于修改光学玻璃、页面壳、信息架构、导航、Settings/Overlay 视觉、色彩/排版/材质或做 UI 视觉评审时；确保沿用 0686c41 已批准基线与现有 tokens/components，而不是重新设计。"
tags: [projectos, ui, liquid-glass, design-system, layout]
metadata:
  version: "1.0.0"
  owner: projectos
  source: docs/AI_TOOL_ROUTING.md
---

# ProjectOS Glass UI

## 何时使用

- 改页面视觉、玻璃材质、背景/环境光、排版、圆角、阴影、页面壳、导航、信息密度。
- 新增/修改 Drawer、Modal、Inspector 的外观。
- 用户说“看起来不对/不够高级/和 Design Lab 不一致”。

## 必读（按顺序）

1. `AGENTS.md`
2. `docs/AI_TOOL_ROUTING.md` R-01 / R-02
3. `docs/next-ui/VISUAL_BASELINE.md`
4. `docs/design/PROJECTOS_UI_CONTRACT.md`（五个 mandatory fixes）
5. `docs/design/DESIGN.md`
6. `docs/design/OVERLAY_SYSTEM.md`
7. `apps/desktop/src/renderer/src/features/design-lab/design-lab.css`
8. 当前目标页面源码 + `styles/next-ui-app.css`

## 输入

- 目标路由/页面/组件。
- 当前截图（真实 Electron，不是 dev preview）。
- 是否涉及数据/交互；若涉及，列出真实 API。
- 目标窗口尺寸/主题；默认检查 1440×900、1100px、125%。

## 执行步骤

1. **判定**：这是视觉/布局改动，还是业务/交互缺陷？业务缺陷走 `projectos-ux-audit`，不要用换皮解决。
2. **查依赖**：确认使用的组件库已安装；禁止为风格新增 shadcn/ui、dnd-kit 或第二个设计系统。
3. **定位 tokens**：优先 `--pdl-*`（Design Lab）或 `packages/design-tokens`；禁止散落 hex。
4. **保留结构**：页面壳/导航/信息架构不变；只改目标 surface。
5. **玻璃约束**：
   - 文字 surface 必须不透明；不在文字上使用 opacity/filter/blur。
   - 大面积固定 surface 优先静态/低 blur；不要嵌套多层 backdrop-filter。
   - 浮层用 `OpticalGlass` 静态光学层；`liquid-glass-react` 只做探针。
6. **改动范围**：只包当前页 `.pdl-root`；不全局重设 legacy 组件；不删除业务字段。
7. **实现**：使用现有 `next-ui/ui`、`overlay-shell`、`OpticalGlass`、`StatusPill`、Lucide。
8. **视觉验证**：打包或真实 Electron 截图；light/dark；1440/1100/125%；检查重影/裁切/层级。
9. **功能验证**：对应 E2E；真实点击/滚动；控制台无错误。
10. **记录**：更新 `docs/design/DESIGN_CHANGELOG.md` 或 `docs/AI_EXPERIENCE_LOG.md`；重要偏离写入 OpenViking。

## 关联组件/文件

- `apps/desktop/src/renderer/src/features/design-lab/{OpticalGlass,StageJourney,TaskGraph,TaskInspector}.tsx`
- `apps/desktop/src/renderer/src/features/design-lab/design-lab.css`
- `apps/desktop/src/renderer/src/styles/next-ui-app.css`
- `apps/desktop/src/renderer/src/next-ui/ui/*`
- `packages/design-tokens/src/tokens.css`

## 工具依赖

- `skill`: `ui-ux-pro-max`, `impeccable`, `vercel-react-best-practices`, `vercel-composition-patterns`
- Playwright-core Electron 截图
- `node scripts/design-lab-contrast.mjs`
- `node scripts/phase5-pages-e2e.mjs`

## 禁止事项

- 重新设计已批准基线；恢复旧 `PLAN REVIEW · R1` Modal。
- 用全局 CSS 覆盖所有页面来解决单页问题。
- 在正文表面叠 blur/透明层；用低对比度“高级灰”。
- 为视觉引入未评估依赖；改 IPC/DB/Planner/Scheduler。
- 只跑单测就宣称视觉完成；用 dev preview 截图冒充打包应用。

## 验收标准

- [ ] 与 `0686c41` / `APPROVED_design_lab_DAG.jpeg` 并排无结构/材质退化。
- [ ] 文字清晰、无重影/裁切；正文对比度 ≥4.5:1。
- [ ] 1440×900、1100px、125% light/dark 截图。
- [ ] 目标 E2E 通过；真实数据/空态/错误态未被破坏。
- [ ] `impeccable detect --json` 无新增问题（若可用）。
- [ ] 未验证项明确列出。
