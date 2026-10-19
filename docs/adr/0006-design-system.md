# ADR-0006：设计令牌、组件层与 UI 验收门槛

- 状态：已接受
- 日期：2026-10-19

## 背景

UI 是指定的一等验收项。各页面直接写颜色/阴影/玻璃 CSS 会导致主题不一致、低对比和不可维护。

## 决策

- `packages/design-tokens` 是唯一颜色、间距、圆角、阴影、动效来源；输出 TS + CSS variables。
- `packages/ui` 封装 AppShell、导航、页头、卡片、指标、状态、空/错/加载、检查器。
- `packages/ai-ui` 封装 Ant Design X Bubble.List / Sender / Prompts / ThoughtChain、审批卡片。
- 玻璃只用于侧栏、顶栏、悬浮/弹层/检查器；编辑区、表格、终端用实体高对比背景。
- Light/Dark/System、减少透明度、减少动效均实际生效并有回退。
- 截图验收：1440×900 与 1024×768，Light/Dark；检查横向溢出、空白截图、控制台错误。
- UI 任务未通过视觉验收不得标记完成。

## 后果

- 新页面需要复用令牌与组件，前期开发慢一些，但主题/响应式一致。
- 截图体积较大，仅保留精选图片在 `docs/screenshots`。
- 玻璃材质在低性能环境由设置项和 `prefers-reduced-transparency` 关闭。
