---
name: projectos-ux-audit
description: "ProjectOS 真实桌面交互缺陷的审计与修复规范。用于用户报告抽屉/弹窗/审批/关闭/滚动/焦点/状态标签异常，或要做 UI/UX 审查时；必须复现真实 Electron 命中、层级和业务状态，而不是只改样式。"
tags: [projectos, ux, audit, overlay, accessibility, drawer]
metadata:
  version: "1.0.0"
  owner: projectos
  source: docs/AI_TOOL_ROUTING.md
---

# ProjectOS UX Audit

## 何时使用

- 用户说“按钮点不到/没反应/位置偏移/不能滚动/审批入口消失/状态不对”。
- 修改 Drawer、Modal、Inspector、Popover、Settings、Plan Review。
- 发布前做交互/可访问性审查。

## 必读

1. `AGENTS.md`
2. `docs/AI_TOOL_ROUTING.md` R-03（以及相关 R-xx）
3. `docs/design/OVERLAY_SYSTEM.md`
4. `docs/design/OVERLAY_AUDIT.md`
5. `docs/next-ui/PLAN_INSPECTOR_FIX.md`
6. 当前组件源码/CSS 与对应 E2E

## 输入

- 可复现步骤、窗口尺寸/DPI、主题。
- 预期行为 vs 实际行为。
- 计划状态（draft/approved/rejected）与真实数据。
- 截图/录屏（如有）。

## 执行步骤

1. **先判业务状态**：查真实 API/DB/状态字段。已批准计划不应有“批准”动作；状态标签必须来自真实状态。
2. **真实复现**：启动 Electron，按用户路径操作；不要只看静态截图。
3. **命中测试**：
   - `elementFromPoint(center)` 检查实际目标。
   - 对比视觉 `getBoundingClientRect` 与点击点。
   - 检查 `z-index`、pointer-events、覆盖层（尤其 Ant message）。
4. **滚动测试**：`scrollHeight/clientHeight`；滚轮在内容/头部/底部；620px 高窗口。
5. **焦点/键盘**：Tab trap、Escape、focus restore、aria-modal/aria-label。
6. **根因修复**：修层级/命中/状态/滚动所有权；不靠“把按钮做大”掩盖遮挡。
7. **回归**：新增/更新 E2E，覆盖坐标点击、滚轮、状态；真实业务动作（批准/拒绝）。
8. **证据**：截图 + DOM 数值 + E2E 输出；记录未验证项。

## 已验证根因

- Ant message `.ant-message-list-content` 覆盖右上关闭 X：点击命中的是消息容器；修复为消息不拦截 + 正确层级。
- 已批准计划 `status=approved`，但顶部硬编码“待批准”；导致误以为审批入口丢失。
- 计划草稿/已批准走不同组件：草稿 `PlanReviewWorkspace` 有抽屉审批；已批准 `PlanReviewNext` 只读。
- 关闭后组件保留 220ms exit：测试要等待完成，不要误判为未关闭。
- 只读浏览器截图/坐标缩放会误判；必须用 CSS/DPR 换算。

## 工具依赖

- Playwright-core Electron（`_electron.launch`）
- `page.mouse.click`（真实坐标）+ `page.locator`（语义）
- `getBoundingClientRect` / `elementsFromPoint`
- 对应 E2E：`plan-review-workspace-e2e.mjs`、`phase5-pages-e2e.mjs`、`task-drawer-ui-e2e.mjs`

## 禁止事项

- 只看截图就下结论；用 dev preview 代替打包 Electron。
- 用 `locator.click()` 单独证明命中；它会绕过遮挡/偏移。
- 把已批准计划当成待审批；伪造审批按钮。
- 用 `z-index: 99999` 全局压制；先找覆盖层和滚动所有权。
- 修改后端/状态机来迁就 UI。

## 验收标准

- [ ] 真实鼠标点击关键控件中心成功；100%/125% 均验证。
- [ ] 滚轮/键盘/焦点符合预期；无背景滚动穿透。
- [ ] 状态标签与真实业务状态一致。
- [ ] 新增 E2E 断言；原有 E2E 不回归。
- [ ] 截图 + DOM 证据 + 根因说明。
- [ ] 未验证/仍存在项明确列出。
