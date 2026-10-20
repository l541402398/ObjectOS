# ProjectOS V1.7 — Apple Liquid Glass 改造说明

日期：2026-10-20  
分支：`feature/v1.6-ux`（沿用现有分支）  
版本：`1.7.0`

## 一、架构分析

### 1. Monorepo

- `apps/desktop`：Electron Main / Preload / Renderer。
- `apps/runtime`：Node Runtime 子进程，唯一 SQLite 写入者。
- `packages/contracts`：Zod API / IPC 契约。
- `packages/persistence`：SQLite / Drizzle。
- `packages/design-tokens`：颜色、字体、间距基础 Token。
- `packages/ui`：Ant Design 主题工厂与通用 UI。
- `packages/ai-ui`：Ant Design X 相关组件。
- `packages/provider-*`：模型 Provider 适配。

### 2. Electron 边界

- Renderer 只通过 preload 白名单 API 访问主进程。
- Main 持有窗口、密钥、Runtime supervisor。
- 主题改造只修改 Renderer CSS、Ant Design ConfigProvider 与设置信息架构，不改变 IPC、数据库、权限。

### 3. 现有主题系统

- `packages/ui/src/theme.ts` 的 `createAntdTheme(mode)`。
- `packages/design-tokens/tokens.css`。
- `app.css` / `v16.css` 提供业务布局与 V1.6 Prismatic Glass。
- V1.7 新增 `v17.css`，在 `v16.css` 之后加载，作为材质与组件覆盖层。

### 4. 参考压缩包

`projectos-glass-theme.zip` 仅有：

```text
src/styles/glass.css     4.2 KB
src/ui/GlassShell.tsx    4.0 KB
src/main.tsx
```

它是一个独立演示壳：

- 硬编码导航
- 占位 IPC
- 无路由
- 无 Ant Design X
- 无真实业务数据

结论：只复用“材质分层 + 暗色玻璃壳”的思路，不复制演示页面与 Mock 数据。业务仍以现有架构为准。

## 二、设计系统

### 1. 材质等级

| 等级 | 用途 | 背景 | 模糊 |
|---|---|---|---|
| Glass Clear | 顶部栏、侧栏、悬浮控件 | 低透明 | 26–42px |
| Glass Regular | 工具栏、次级面板 | 中透明 | 34–40px |
| Glass Elevated | Modal、Drawer、Dropdown | 高透明 + 高阴影 | 38–52px |
| Glass Content | 业务卡片、表格、表单 | 高不透明 | 14–18px |

禁止所有组件使用同一透明度；内容层优先可读性。

### 2. Token

```css
--glass-clear-bg / border / blur
--glass-regular-bg / border / blur
--glass-elevated-bg / border / blur
--glass-content-bg / border / blur

--glass-highlight        inset 顶部高光
--glass-inner-dark       inset 底部暗边
--glass-shadow-soft
--glass-shadow-float
--glass-specular         方向性环境光

--apple-blue             #0a84ff
--apple-cyan             #64d2ff
--apple-radius-card      20px
--apple-radius-panel     24px
--apple-radius-control   12px
--apple-ease             cubic-bezier(.22,1,.36,1)
```

Ant Design Token 调整：

- `borderRadius` 12 / LG 20
- `controlHeight` 36
- 字体加入 SF Pro Display / SF Pro Text / Inter
- 动效 0.16s / 0.26s / 0.4s

### 3. 背景系统

- 独立矢量山峦背景：`v17-landscape.svg`
- 浅色独立背景：`v17-landscape-light.svg`
- 背景固定在最底层 `po-shell::before`，不参与业务布局
- 明暗遮罩、环境光、湖面与云雾均为独立图层
- 可通过覆盖 `--v16-bg` 替换壁纸

### 4. 通用玻璃类

```tsx
<div className="glass-clear">顶部栏 / 悬浮控件</div>
<div className="glass-regular">侧栏 / 工具栏</div>
<div className="glass-elevated">Modal / Drawer / Popover</div>
<div className="glass-content">业务卡片 / 表格 / 表单</div>
```

## 三、实施范围

### 桌面布局

- 顶部工具栏：Clear 材质、窗口控制保持原样
- 侧边导航：Clear 材质、Apple 胶囊选中态、渐变高光
- 内容容器：Content 材质、20–24px 圆角
- 状态栏：Regular 材质

### 基础组件

已覆盖：

- Button / Input / Select / Switch
- Tabs / Dropdown / Tooltip / Popover
- Modal / Drawer
- Table / Pagination
- Form / DatePicker
- Card / Statistic
- Tree / Menu
- Message / Notification
- Ant Design X Bubble / Sender / Prompts / Conversations

### 业务页面

通过全局材质层覆盖：

- 工作台 / 项目中心
- 项目总览、任务看板、编排
- Agent 工作台 / Agent Studio
- 知识库、资源、审批、自主运营
- 运行审计
- 系统设置全部内页

新增设置概览页，作为设置中心入口与导航面板。

### 设置信息架构收敛

- 移除 Agent 路由页
- 移除第三方连接页
- 移除外部 Agent 页（与 Runtime Harness 重叠）
- 新增 Skills 管理
- 新增设置概览

## 四、Electron 与性能

- 保持 `app-region` 拖拽区不变
- 窗口按钮与最小化/最大化/关闭未修改
- 不开启系统级透明窗口
- 仅渲染层 CSS 实现玻璃
- 避免大面积嵌套 `backdrop-filter`
- 滚动表格使用 Content 层，减少模糊
- 支持 `prefers-reduced-motion`
- 支持 `prefers-reduced-transparency` 降级
- 无 `!important` 大规模覆盖，仅对 Ant Design 浮层背景做必要覆盖

## 五、兼容性

- 不修改数据库结构
- 不修改 IPC 协议（V1.7 之前已有 runtime.install 等改动）
- 不修改后端 API
- 不修改权限规则
- 不引入第二套状态管理
- 真实数据与业务状态保持
- 旧主题变量继续保留，V1.7 只覆盖材质与视觉层

## 六、已知限制

1. 参考包没有独立自然风景位图，本项目提供的是独立矢量山峦背景，可替换为授权摄影图。
2. 未启用 Windows 11 原生 Acrylic/Mica，玻璃全部为渲染层 CSS。
3. 模糊层较多时，低端 GPU 仍可能掉帧；已提供 reduced-transparency 降级。
4. 表格、Tree、Ant Design X 的深度定制仍需逐页视觉确认。
5. 设置页仍以表单为主，V1.7 增加概览页与材质层级，但没有重写全部表单交互。
