# ProjectOS V1.6 — 第一轮：审计、设计系统与 Shell 改造

日期：2026-10-20  
分支：`feature/v1.6-ux`  
设计输入：`docs/design/v1.6/ProjectOS_V1.6_正式完整交付包`

---

## 1. 已读取的资料

- `README_请先阅读.md`
- `04_功能设计与优化文档/00_优化设计文档定位说明.md`
- `04_功能设计与优化文档/01_V1.6完整实施说明书.md`（63 KB，41 章）
- `04_功能设计与优化文档/02_功能需求PRD.md`
- `04_功能设计与优化文档/03_UI_UX优化规范.md`
- `04_功能设计与优化文档/04_开发AI执行与验收指令.md`
- `06_设计索引与验收清单/design_index.csv`
- 12 张 `01_已确认设计图`
- 41 张 `02_新增独立设计图`（索引核对）
- `03_设计图HTML_CSS参考源码`
- `05_视觉资产与现状审计` 中的背景母版与审计说明
- `08_早期版本功能基线`：V1.3 / V1.4 / V1.5

冲突处理：主实施说明书 > 已确认设计图 > 历次优化文档 > 历史实现。

---

## 2. 现有代码架构扫描

| 层 | 实际位置 | 结论 |
|---|---|---|
| Electron Main / preload / IPC | `apps/desktop/src/main`、`preload` | 保留，本轮未改 |
| Renderer / React / AntD | `apps/desktop/src/renderer/src` | 保留 |
| 全局 Shell | `packages/ui/src/components/AppShell.tsx`、`SidebarNavigation.tsx` | 复用并加 V1.6 材质层 |
| 设计 Token | `packages/design-tokens/src/tokens.css`、`index.ts` | 复用变量，新增 V1.6 派生层 |
| 页面样式 | `apps/desktop/src/renderer/src/styles/app.css` | 保留，新增 `v16.css` 覆盖层 |
| SQLite / 迁移 | `packages/persistence/src/migrations.ts` | 本轮未改 |
| V1.3 DAG | `features/orchestration` | 保留 |
| V1.4 自主运营 | `pages/OperationsPage.tsx` 及 runtime services | 保留 |
| V1.5 Agent/Skills/Runtime/ACP | `apps/runtime/src/agent-studio.ts` 等 | 保留 |
| Harness 扫描 | `runtimeProfiles.detect` / `RuntimeSettingsPanel` | 保留 |
| AI Provider / 模型 / 路由 | settings + provider manager | 保留 |

未新建任何平行 Agent、Runtime、数据库或执行系统。

---

## 3. 功能 / UI 差距矩阵

状态：✅ 已有可复用；◐ 部分完成；○ 未实现。

| 页面 / 能力 | 现有 | V1.6 要求 | 差距 | 下一阶段 |
|---|---|---|---|---|
| 全局 Shell | ✅ | 光学玻璃、山峦背景、统一圆角 | 本轮完成基础版 | 继续精修 |
| 左侧导航 | ◐ | 展开/收起无竖排、无跳动 | 本轮修复并自动化验证 | 完成 |
| 项目中心 | ◐ | 统计卡、项目卡、右侧工作/Agent/资源栏、项目表 | 结构与设计稿差异大 | 阶段 2 P0 |
| 项目详情 | ◐ | 项目 Hero、右侧上下文、里程碑/需求/活动 | 现有信息完整，布局不同 | 阶段 4 |
| 任务看板 | ✅ | 视觉重设计、Inspector、筛选 | 需换肤与布局 | 阶段 4 |
| 工作流编排 | ✅ | 保留 V1.3 DAG、节点库、Inspector、日志 | 功能保留，需高保真重绘 | 阶段 3 |
| Agent 工作台 | ◐ | 会话/运行/审批/预览 | 结构需重做 | 阶段 3 |
| Agent Studio | ◐ | 三栏 + 5 Tabs + 实时预览 | 当前为单表单弹窗 | 阶段 2 P0 |
| 知识库 | ✅ | 视觉重设计、空状态 | 需换肤 | 阶段 4 |
| 资源中心 | ○ | 文件、集成、资源使用 | 仅 Workspace 文件树 | 阶段 4 |
| 运行审计 | ✅ | 视觉重设计、真实 usage | 需换肤与详情布局 | 阶段 4 |
| AI 连接 | ◐ | 极简 Provider/地址/Key/测试/模型 | 已有真实能力，字段偏多 | 阶段 2 P0 |
| 模型目录 | ✅ | 视觉重设计、模型详情 | 需换肤 | 阶段 2 |
| Agent 路由 | ✅ | 视觉重设计、用量/价格 | 需换肤 | 阶段 4 |
| Runtime 管理 | ✅ | 动态 Harness、认证、诊断 | 功能已有，需重绘 | 阶段 3 |
| 工具与插件 | ○ | 工具/MCP/插件管理 | 未实现 | 阶段 4 |
| 外部 Agent | ✅ | 视觉重设计 | 需换肤 | 阶段 4 |
| 团队与权限 | ○ | 成员、角色、项目权限 | 未实现 | 阶段 4 |
| 系统设置 | ◐ | 存储、网络、安全、外观、快捷键、通知、关于 | 仅通用/关于 | 阶段 4 |
| 审批中心 | ◐ | 集中审批、危险操作策略 | 仅项目内卡片 | 阶段 3 |
| OpenSpec | ○ | 可选规范工作流 | 未实现 | 阶段 4 |
| 命令面板 | ✅ | 视觉重设计 | 需换肤 | 阶段 4 |
| 深浅主题 | ✅ | Prismatic Glass 双主题 | 本轮完成基础版 | 持续 |
| DPI / 可访问性 | ✅ | 100/125/150% + AA | 已有 DPI 基线 | 每页验收 |

---

## 4. 本轮实际代码修改

### 新增

- `apps/desktop/src/renderer/src/styles/v16.css`
  - Prismatic Glass Token 派生
  - 山峦环境背景与蓝紫光
  - 玻璃侧栏、标题栏、状态栏、卡片、指标、项目卡、Modal
  - 深浅主题独立配色
  - 导航折叠原子布局修复
  - reduced-motion / reduced-transparency 降级
  - 1024–1179px 紧凑规则

- `apps/desktop/src/renderer/src/assets/v16-mountains.jpg`
- `apps/desktop/src/renderer/src/assets/v16-hero.jpg`
- `scripts/v16-visual-check.mjs`
- `scripts/v16-sidebar-check.mjs`
- `docs/v1.6/round1-*.png`

### 修改

- `apps/desktop/src/renderer/src/main.tsx`
  - 在 `app.css` 后加载 `v16.css`

### 保留

- `packages/ui` 结构、AntD、路由、IPC、SQLite、Runtime 全部未改

---

## 5. 侧边栏动画修复

问题根因：

- `.po-sidebar-inner` 宽度为 100%，跟随父级宽度动画收缩
- 导航文字参与宽度过渡，中间态被挤压/换行
- 折叠态依赖 `display:none` 与宽度动画叠加，出现跳动

修复：

- 侧栏内部宽度改为受控固定宽度，折叠时原子切换到 68px
- 外层玻璃栏单独做 320ms 宽度动画
- 标签、品牌、项目名全部 `nowrap + overflow hidden`
- 图标容器固定 19px，折叠态居中
- 连续点击不累积中间态

自动化验证 `scripts/v16-sidebar-check.mjs`：

```text
mid  : label display=none, whiteSpace=nowrap, shell=is-collapsed
final: collapsed=true, width=68, labelHeight=0
V1.6 SIDEBAR ANIMATION CHECK PASS
```

---

## 6. Electron 实机截图

本轮已启动真实 Electron（1586×992，Demo 数据）：

- `docs/v1.6/round1-project-center-dark.png`
- `docs/v1.6/round1-project-center-light.png`
- `docs/v1.6/round1-overview-dark.png`
- `docs/v1.6/round1-settings-dark.png`
- `docs/v1.6/round1-sidebar-mid-collapse.png`
- `docs/v1.6/round1-sidebar-final.png`

### 与参考图差异（已知）

| 项 | 参考 | 当前 |
|---|---|---|
| 项目中心布局 | 统计 + 项目卡 + 右栏 + 项目表 | 继续工作 + 4 指标 + 最近项目 + 活动 |
| 侧栏宽度 | ~208px | 232px |
| 标题栏 | 品牌 + 全局搜索 | 面包屑 + 全局搜索 |
| 卡片光照 | 更强边缘高光/折射 | 玻璃渐变近似 |
| 项目卡缩略图 | 独立插画 | 渐变光晕 |
| 字号层级 | 32/20/14/13 | 已对齐主层级 |
| 背景 | 山峦母版 | 使用同一母版资源 |

本轮目标是 Shell/Token/导航；页面结构将在阶段 2 重排。

---

## 7. 测试

```text
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 24 files / 113 tests passed
pnpm build      → PASS
Electron 启动   → PASS
侧栏动画自动化  → PASS
```

---

## 8. 下一阶段

1. 项目中心高保真重排（统计、项目卡、右栏、项目表）
2. 设置中心重新分组与 AI 连接极简流程
3. Agent Studio 三栏 + 五 Tabs + 实时预览
4. 工作流/任务/审计换肤
5. 工具插件、团队权限、系统设置、OpenSpec 页面
6. 全页截图对照、DPI、深浅主题、打包

---

## 9. 风险

- 设计稿中部分数据/模型/权限为示例，不能写入默认值
- 41 张新增图尚未逐页确认，页面实现需标记“待复核”
- 真正折射效果未实现，当前为可降级玻璃近似，符合规范允许范围
- 大范围页面重排必须保持现有 IPC/契约，不引入第二套业务层
