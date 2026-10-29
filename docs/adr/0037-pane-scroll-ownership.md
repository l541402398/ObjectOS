# ADR-0037 — Master-detail pages own their scrolling

- Status: Accepted (Phase 2.8.8 UX)
- Related: ADR-0031 (goal status), `docs/design/PROJECTOS_UI_CONTRACT.md`

## Context

在「审批」工作台，左侧事项一多，滚动条出现在**整个内页**上：`.po-main` 是滚动容器，而页面根
（`.ap-shell`）没有高度约束，`.ap-body` 只有 `min-height: 480px`，所以列表把页面撑高，整页滚动。
真实复现（56 条真实审批，1440×900）测得 `mainScrolls = 3528px`；鼠标放在左栏滚轮滚的是整页。

「交付 · 资源与连接」（`/connections` → `ResourceCenter`）是同一个三栏 master-detail 结构
（`.rc-shell / .rc-body / .rc-list / .rc-main / .rc-inspector`），同样存在该问题。

## Decision

带内部栏的页面**自己拥有滚动**，整页不滚动：

1. 页面根 `height: 100%`（`.ap-shell`、`.rc-shell`），填满主区域；
2. 主区域行 `flex: 1 1 auto; min-height: 0`（去掉固定 `min-height: 480px`，否则 620px 高窗口仍会整页滚动）；
3. 每个栏 `min-height: 0`，滚动栏 `overflow-y: auto` + `overscroll-behavior: contain`，避免滚动链穿透到页面。

这是纯布局改动：不改业务状态、不改数据、不改 token 与视觉语言；`.po-main` 仍是其它普通页面的滚动容器。

## Verification (real Electron, real data)

- 审批：56 条真实审批，1440×900 / 1024×700 / 620h → `mainScrolls=0, docScrolls=0`；
  列表 `4105/585`、`4105/260`、`4105/385`；滚轮在列表内 → `list=800, main=0, window=0`。
- 资源与连接：真实侧边栏点击进入 `/connections`，用产品 API 创建 12 条真实资源后：
  1440 `648/504`、1024 `648/306`、620h `648/304`；`mainScrolls=0`；滚轮 `list=144/342/344, main=0`。
- 脚本：`scripts/p288-pane-scroll-e2e.mjs`、`scripts/p288-connections-scroll-e2e.mjs`
  （两者都断言"页面不滚动 + 栏内滚轮生效 + 页面不动"，覆盖三种窗口）。

## Limits

资源数据不足时，验收脚本会用**明确标注的布局探针行**验证布局；本轮 `/connections` 用产品 API
创建了 12 条真实资源记录（隔离测试 profile），因此该页结论不依赖探针。
