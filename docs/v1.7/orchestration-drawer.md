# ProjectOS V1.7 — 编排工作台全屏工作流与节点抽屉

日期：2026-10-20

## 改造内容

- 编排内页改为全宽工作流画布
- 移除固定 Inspector 侧栏
- 移除底部“运行日志”和“依赖流”卡片
- 点击画布节点时从右侧弹出浮动玻璃面板（不是顶满全高的 Drawer）
- Drawer 内用 Tab 切换：
  - 节点：原有 Inspector（概览 / 活动 / 文件 / 授权）
  - 运行日志：项目事件流
  - 依赖流：任务依赖链
- 点击画布空白处或按 Esc 关闭面板
- 面板内容独立滚动，长日志不会撑开页面

## 视觉

- 面板顶部距窗口 86px、底部 38px、右侧 22px，不顶满
- 24px 大圆角 + 双层高光 + 环境阴影
- 面板使用 V1.7 玻璃 Elevated 材质
- 自定义固定定位层，不锁 body 滚动，不再触发页面上下抖动
- 日志以玻璃卡片展示，事件类型为胶囊标签
- 节点信息、日志、依赖流各占一个 Tab
- 全宽画布保留筛选、保存布局、适配、缩放、MiniMap

截图：`docs/v1.7/orchestration-panel-node.png`、`docs/v1.7/orchestration-panel.png`

截图：`docs/v1.7/orchestration-drawer.png`

## 验证

```text
canvas full width  → PASS
Panel tabs         → 节点 / 运行日志 / 依赖流
Panel tab click    → PASS
No page jump       → PASS
pnpm typecheck     → PASS
pnpm lint          → PASS
pnpm test          → 26 files / 121 tests passed
package x64/ia32   → PASS
package smoke x2   → PASS
```

## 产物哈希

```text
1899B4B57235EAA8BEDBAA623B0D15F1D99CE09630B787D40EE816A99AB83395  ProjectOS-1.7.0-win-x64-portable.exe
6F72B8D91009B07EFE8B7A13796E439254298B89FC29854644CF992172F0D8DF  ProjectOS-1.7.0-win-x64-setup.exe
C9BF33D400FC7357C25A1CEA3C927C5D9DAB4670C3E46CE32A03D2A9AACCA277  ProjectOS-1.7.0-win-ia32-portable.exe
9EB8B7C98BF4FD5E1BB27D4C480C5FFF2118E86A0F1F082F798F11068CF80EBE  ProjectOS-1.7.0-win-ia32-setup.exe
8D512387BBBC29A36B5B4BCA4B1A5E61D5707F9EE50C67EAB74C228B5FB8DC93  ProjectOS-1.7.0-linux-x86_64.AppImage
```
