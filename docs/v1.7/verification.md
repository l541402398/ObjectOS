# ProjectOS V1.7 — 验证与交付

日期：2026-10-20  
版本：`1.7.0`  
分支：`feature/v1.6-ux`

## 1. 实际修改文件

### 主题基础设施

- `apps/desktop/src/renderer/src/styles/v17.css`（新增）
- `apps/desktop/src/renderer/src/assets/v17-landscape.svg`（新增）
- `apps/desktop/src/renderer/src/assets/v17-landscape-light.svg`（新增）
- `apps/desktop/src/renderer/src/main.tsx`
- `packages/ui/src/theme.ts`

### 布局与页面

- `apps/desktop/src/renderer/src/features/settings/SettingsOverviewPanel.tsx`（新增）
- `apps/desktop/src/renderer/src/features/settings/SettingsModal.tsx`
- `apps/desktop/src/renderer/src/stores/ui.ts`
- `apps/desktop/src/renderer/src/components/AppLayout.tsx`
- 设置内页删除：`RoutingPanel.tsx`、`IntegrationsSettingsPanel.tsx`、`ExternalAgentsPanel.tsx`
- 设置内页新增：`SkillsSettingsPanel.tsx`（前序轮次）
- 任务看板拖拽修复：`TaskBoardPage.tsx`、`v16.css`（前序轮次）
- Harness 自动测试与 AI 连接桥接：`RuntimeSettingsPanel.tsx`、`runtime-executor.ts`、`agent-runner.ts`、`dispatcher.ts`（前序轮次）

### 版本

- `package.json`
- `apps/desktop/package.json`
- `apps/runtime/package.json`
- `apps/runtime/src/config.ts`

## 2. 主题 Token

见 `docs/v1.7/apple-liquid-glass.md`。

核心：

- Glass Clear / Regular / Elevated / Content
- 方向性高光、内暗边、环境光
- Apple Blue / Cyan、20–24px 圆角、Apple 缓动
- 浅色与深色独立背景
- Ant Design 圆角、控件高度、字体、动效 Token

## 3. 通用玻璃类

```tsx
<div className="glass-clear">导航 / 悬浮控件</div>
<div className="glass-regular">工具栏 / 侧栏</div>
<div className="glass-elevated">Modal / Drawer / Dropdown</div>
<div className="glass-content">业务卡片 / 表单 / 表格</div>
```

## 4. 已完成页面

- 项目中心
- 任务看板
- 设置概览
- 设置全部内页
- Agent 工作台 / Agent Studio
- 知识库、资源、审批、自主运营、运行审计
- 编排工作台

以上页面共享 V1.7 材质层；设置概览为 V1.7 新增。

## 5. 验证结果

```text
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 24 files / 113 tests passed
pnpm build      → PASS
V17 VISUAL CHECK→ PASS
DPI 125/150     → PASS（overflow 0/0）
TASK DRAG FIX   → PASS
package:win     → PASS
package-smoke   → PASS
```

视觉检查：

```text
sidebarBlur  blur(42px) saturate(1.85)
modalGlass   blur(48px) saturate(1.8)
background   v17-landscape
1024 width   scrollWidth 1024 / clientWidth 1024
```

截图：

- `docs/v1.7/project-center-light.png`
- `docs/v1.7/project-center-dark.png`
- `docs/v1.7/task-board-light.png`
- `docs/v1.7/task-board-dark.png`
- `docs/v1.7/settings-overview-light.png`
- `docs/v1.7/settings-overview-dark.png`
- `docs/v1.7/project-center-1024-dark.png`

## 6. 产物

- Windows x64 / ia32 便携版与安装版：见 `docs/v1.7/windows-builds.md`
- Linux：`release/ProjectOS-1.7.0-linux-x86_64.AppImage`
- 完整哈希：`release/SHA256SUMS.txt`

## 7. 尚未解决

1. 参考包未提供自然风景摄影图，当前使用独立矢量山峦背景。
2. 未启用 Windows 11 原生 Mica/Acrylic；仅 CSS 玻璃。
3. 表格、Tree、Ant Design X 的深度定制仍需逐页视觉确认。
4. 设置内页仍以表单为主，新增了概览与材质层级，但未重写全部表单交互。
5. 未逐张对照全部 41 张新增设计稿做像素级验收。
# ProjectOS V1.7 — 最终验证补充

## Windows 双架构

- x64 与 ia32 分离构建，使用独立输出目录。
- Electron 固定 `43.8.2`，同时满足 ia32 与 Node 22 `node:sqlite`。
- portable 与 NSIS setup 都实际启动验证。

## 最终产物

- `ProjectOS-1.7.0-win-x64-portable.exe`
- `ProjectOS-1.7.0-win-x64-setup.exe`
- `ProjectOS-1.7.0-win-ia32-portable.exe`
- `ProjectOS-1.7.0-win-ia32-setup.exe`
- `ProjectOS-1.7.0-linux-x86_64.AppImage`

详细哈希见 `release/SHA256SUMS.txt`。
