# ProjectOS V1.7 — Agent 工作台一体化布局

日期：2026-10-20

## 1. 计划生成即创建 Agent 会话

- `plan.generate` / `plan.revise` / `plan.update` 后自动补齐：
  - 每个计划 Agent 的 `计划协作` 会话
  - 一条 `计划群聊` 会话
- 不再等到批准或执行才创建
- 计划批准时复用已创建会话，不重复生成
- 计划群聊在草案阶段即可打开和讨论
- 顶部“计划群聊”按钮已移除
- 群聊会话带 `群聊` 标签，点击会话直接打开群聊面板
- 跨会话中心仍提供计划群聊入口

## 2. 三栏合并为一个整体

- 移除左侧固定会话栏
- 移除右侧固定运行检查器
- 对话区成为完整主面板
- 顶部会话切换条：
  - 显示当前会话
  - 下拉箭头
  - 点击向下展开会话列表
  - 列表高度 236px，可滚动，不再顶满页面
  - 会话名称单行省略
- 运行检查器改为右侧书签式外凸入口：
  - 常态收起
  - 点击“运行检查器”书签滑出
  - 再次点击或关闭按钮收起
  - 面板使用玻璃 Elevated 材质、20px 圆角

## 3. 视觉

- 会话下拉框使用玻璃浮层 + 圆角 + 阴影
- 运行检查器使用玻璃抽屉
- 会话行增加群聊标签
- 修复浅色主题下 Provider banner 主按钮白字对比

截图：

- `docs/v1.7/agent-session-dropdown.png`
- `docs/v1.7/agent-run-drawer.png`

## 4. 验证

```text
DRAFT SESSIONS → 计划群聊 + 4 个计划协作会话
group disabled → false
old session pane → 0
session toggle → 1
run bookmark → 1
AGENT LAYOUT PASS
Plan group E2E → PASS
pnpm typecheck → PASS
pnpm lint → PASS
pnpm test → 26 files / 121 tests passed
package x64/ia32 → PASS
package smoke x2 → PASS
```
