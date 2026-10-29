# ADR-0045 — Breadcrumb with history back for inner pages

- Status: Accepted (Phase 2.8.8 UX)
- Related: ADR-0037 (pane scrolling), DESIGN_CHANGELOG

## Context

用户反馈：系统没有类似面包屑的导航，从一个内页跳到另一个内页后**无法回到上一个内页**，
只能从左侧一级菜单逐级点回去。

核对现状后发现两件事：

1. 标题栏其实已有一个 `ProjectOS / 项目名 / 页面` 的路径，但字号 `--text-small`、颜色
   `--color-text-tertiary`、无分隔符层级语义，读起来像装饰而不是导航；用户根本没把它当成面包屑。
2. **没有"返回上一页"**：运行审计 → 审批 之后只能再点左侧菜单回到运行审计。

## Decision

把标题栏路径升级为真正的面包屑，并补上历史返回：

- 结构：`项目中心 › 项目名 › 分组 › 当前页`。前两级可点击（项目中心 → `/`，项目 → 项目页），
  分组（研发 / 交付 / 项目）是语境不可点，当前页 `aria-current="page"`，整体包在
  `<nav aria-label="导航路径">` 里；
- 新增「返回上一页」按钮：`window.history.state.idx > 0` 时可用，`navigate(-1)`；不可用时
  `disabled` 并给出说明，绝不做"看起来能点但没反应"的控件；
- 可读性：字号 12.5px（12px 地板之上）、次级文字色；分组用二级色（三级色实测 3.86:1 不达标），
  悬停/聚焦有可见反馈，聚焦环使用既有 `--color-accent-soft`；
- 位置保持在标题栏内：页面根有 `height: 100%` 的页面（审批、资源）如果把面包屑塞进 `.po-main`，
  会重新引入整页滚动（ADR-0037 的回归），所以层级导航放在高度固定的标题栏里，不占页面高度。

## Verification (real Electron, real project)

`scripts/p288-breadcrumb-e2e.mjs`：

```
面包屑包含 项目中心 › 项目 › 分组 › 当前页 — 层级1=项目中心 | 层级2=P288 PRODUCT_AUTONOMOUS | 分组=研发 | 当前页=运行审计
当前页带 aria-current=page
亮色对比度 — 返回/层级/分组 6.57:1 · 当前页 13.96:1
暗色对比度 — 返回/层级/分组 12.75:1 · 当前页 18.42:1
侧栏跳转 运行审计 → 审批 →「返回」→ 运行审计（真实点击）
点项目层级回到项目页
1100×700 与 1440×900@125% 不溢出标题栏，标题栏高度仍 45px
PASS=11 FAIL=0
```

截图：`docs/screenshots/p288-breadcrumb-runs.png`、`p288-breadcrumb-light.png`、
`p288-breadcrumb-dark.png`、`p288-breadcrumb-1100x700.png`、`p288-breadcrumb-1440x125.png`。

## Consequences

- 内页之间可以按历史返回，也可以按层级上跳；左侧菜单不再是唯一出口。
- 一处实现覆盖所有内页（含弹窗/抽屉之外的普通页面路由），不需要每页传参。
- 分组映射是静态表：新增页面时必须同时登记所属分组，否则该层级不显示（页面仍可用）。

## Limits

只验证了 5 组真实路由（runs / approvals / project 页 / 两个尺寸）；对 `#/settings`、`#/design-lab`
这类不在项目内的路由，面包屑退化为 `项目中心 › 当前页`，未单列验证。
