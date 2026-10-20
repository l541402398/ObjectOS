# ProjectOS V1.6 — 任务拖拽卡死修复

日期：2026-10-20  
分支：`feature/v1.6-ux`

## 根因

为实现“拖到列任意位置都能放下”，此前给所有任务卡设置了：

```css
.po-board.is-dragging .po-task-tile { pointer-events: none; }
```

问题：被拖拽的源卡片本身也被设为 `pointer-events: none`，浏览器会在 dragstart 后丢失源元素，导致：

- 卡片变灰
- 拖拽中断
- 页面停留在 dragging 状态
- 后续交互卡死

## 修复

1. 只禁用**非源卡片**：

```css
.po-board.is-dragging .po-task-tile:not(.is-dragging) {
  pointer-events: none;
}
```

2. 为源卡片增加 `onDragEnd`：
   - 清除 `draggingId`
   - 清除 `dropTarget`

3. 看板容器增加 `onDragEnd` 兜底：
   - 即使拖拽被 Esc 或系统取消，也恢复状态

## 验证

真实鼠标拖拽：

```text
status ready stuckClass 0
TASK DRAG FREEZE FIX PASS
```

验证内容：

- 源卡片不再变灰丢失
- 可以拖到目标列任意位置
- 松开后任务状态更新
- 拖拽结束后无 `is-dragging` 残留
- 页面不再卡死

## 回归

```text
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 24 files / 113 tests passed
package:win     → PASS
package-smoke   → PASS
```

## 产物

- Windows：`release/ProjectOS-1.6.0-portable.exe`
  `B5AD5F702D77E48FD95E383D35577FCBB10C077CFD66E06576FE670397E97160`
- Linux：`release/ProjectOS-1.6.0-linux-x86_64.AppImage`
  `91BB5B260DCB23A6351C0D721BB3D84DBB1C3EEF7EFB5DCE4FC003DAA9708777`
