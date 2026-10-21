# ProjectOS V1.7 — 编排工作台全屏工作流与节点抽屉

日期：2026-10-20

## 改造内容

- 编排内页改为全宽工作流画布
- 移除固定 Inspector 侧栏
- 移除底部“运行日志”和“依赖流”卡片
- 点击画布节点时从右侧弹出主题化 Drawer
- Drawer 内用 Tab 切换：
  - 节点：原有 Inspector（概览 / 活动 / 文件 / 授权）
  - 运行日志：项目事件流
  - 依赖流：任务依赖链
- 点击画布空白处关闭 Drawer
- Drawer 内容独立滚动，长日志不会撑开页面

## 视觉

- Drawer 使用 V1.7 玻璃 Elevated 材质
- Tab 与画布使用统一主题
- 修复 Drawer mask 与 content 的 z-index，保证 Tab 可点击
- 全宽画布保留筛选、保存布局、适配、缩放、MiniMap

截图：`docs/v1.7/orchestration-drawer.png`

## 验证

```text
canvas full width  → PASS
Drawer tabs        → 节点 / 运行日志 / 依赖流
Drawer tab click   → PASS
pnpm typecheck     → PASS
pnpm lint          → PASS
pnpm test          → 26 files / 121 tests passed
package x64/ia32   → PASS
package smoke x2   → PASS
```

## 产物哈希

```text
A305BAACFCAFF72B410218B0E1DDF6C283F249E55623E087101F7FB303A6EE2E  ProjectOS-1.7.0-win-x64-portable.exe
A8476DE0BA8FC7DBC06698AFD27EDDE76CF47CC4B2A3ECB8B3F76F62C516FD9C  ProjectOS-1.7.0-win-x64-setup.exe
137749D130B084923017102925B0DC36B52D59FF26382ED39ED76261C78D27BB  ProjectOS-1.7.0-win-ia32-portable.exe
82F58D81AAADDE24CBECC6547F8C2387DF3167CE845092A036C0DA595EED5AE4  ProjectOS-1.7.0-win-ia32-setup.exe
8F2F5EF040B2D693A7B8386BB0CCDC64BC6051F7144D4B4188DEF4E676E6C96D  ProjectOS-1.7.0-linux-x86_64.AppImage
```
