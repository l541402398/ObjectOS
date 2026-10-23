# ProjectOS AI 技术路由注册表

状态：**ACTIVE / 项目级权威路由**
最后更新：2026-10-23
维护分支：`chore/ai-tool-routing`
基线：`fix/plan-review-inspector-actions` @ `cfa26ef`
视觉基线：commit `0686c41` / tag `visual-baseline-approved-0686c41`
执行入口：根 `AGENTS.md` + 本文件 + `.agents/skills/`

> 本文件是 ProjectOS 开发的技术选型与执行路由。仓库文件是权威记录；
> OpenViking 用于跨会话检索和经验召回，不替代仓库事实。
> 任何与本文件冲突的旧聊天摘要、旧记忆或未批准设计都不具有优先级。

---

## 0. 当前环境事实（已核实，不得假设）

| 项目 | 实测值 | 核实方式 |
|---|---|---|
| DSH | 正在运行，Web GUI 可用 | 当前会话 runtime |
| OpenViking | `healthy`，VikingFS | `mcp__openviking__health` |
| OpenViking 插件 | `@openviking/dsh-memory-plugin@0.5.29` | profile `package.json` |
| OpenViking 端点 | `https://ov.afann.xyz` | profile `cordis.patch.yml` |
| OpenViking 工具 | `health/find/search/read/list/tree/grep/glob/remember/add_resource/add_skill` 可用 | 本会话实际调用 |
| 项目记忆 peer | `github.com-l541402398-objectos` | `list viking://user/bruce/peers` |
| OpenViking 项目资源 | 导入前仅有 `viking://resources/ov-smoke` | `list viking://resources` |
| OpenViking Skills | 导入前 `viking://~/skills` 与 `viking://agent/skills` 均为空 | `tree` 实际结果 |
| 根 `AGENTS.md` | 被 DSH 注入并读取 | 本会话 system reminder 实际包含其规则 |
| 项目级 Skills | 本文件同批创建于 `.agents/skills/`；此前无项目级 Skill | 文件系统检查 |
| GPU | `Ctyun CVGDOD Controller`，`AdapterRAM: 0`；`gpu_compositing=disabled_software` | 性能审计实测 |
| Node / pnpm | Node 24.22.0 / pnpm 9.15.0 | 运行时与审计记录 |
| Electron | 43.8.2 | `apps/desktop/package.json` / 安装包 |
| React | 19.3.1 | 安装依赖 |
| 构建 | electron-vite 6 / Vite 8 / Tailwind 4 | 安装依赖 |
| 测试 | Vitest 5；Playwright-core 1.64.1；Electron E2E 脚本 | 仓库脚本与依赖 |

### 已加载的通用 Skills（实际加载，不是“已安装即生效”）

本会话通过 `skill` 工具实际加载并读取：

- `ui-ux-pro-max`
- `impeccable`
- `vercel-react-best-practices`
- `vercel-composition-patterns`
- `openviking-memory`
- `openviking-skills`
- `ov-experience-memory`

本地发现位置：

```text
C:\Users\Administrator\.dsh\skills\
  ui-ux-pro-max\
  impeccable\
  vercel-react-best-practices\
  vercel-composition-patterns\
C:\Users\Administrator\.dsh\profiles\desktop\node_modules\
  @openviking\dsh-memory-plugin\skills\
    openviking-memory\
    openviking-skills\
    ov-experience-memory\
```

这些通用 Skill **不能**替代 ProjectOS 专用路由；它们提供设计、React 性能和 OpenViking 操作规范。

---

## 1. 强制任务路由协议

收到新的 ProjectOS 开发任务后，按顺序执行：

1. **分类**：从第 2 节选择任务类型；一个任务可组合最多 3 个类型。
2. **查路由**：读取本文件对应 R-xx 条目；若任务跨 UI/性能/验证，必须同时读相应条目。
3. **查 OpenViking**：对任务目标 + 组件 + 约束做一次 `find` 或 `search`；
   优先项目 peer；读取命中的完整 URI，不只看摘要。
4. **读 Skill**：从 `.agents/skills/` 读取对应 `SKILL.md`；
   通用 Skill 仍按 `AGENTS.md` 要求加载。
5. **核对代码与依赖**：读取实际文件、`package.json`、相关 E2E/截图；
   不凭记忆或 GitHub Star 判断。
6. **确定方案**：在回复开头列明：
   - 任务分类
   - 选择的 Skill
   - 复用的开源组件/库（含版本）
   - 依据（本文件条目 + 代码/测试/截图）
   - 不采用的候选及原因
7. **修改代码**：最小改动；不改变业务契约；不擅自引入依赖。
8. **验证**：执行第 7 节对应验收；记录真实命令结果。
9. **闭环**：成功/失败写入 `docs/AI_EXPERIENCE_LOG.md`；重复问题必须转成 E2E/检测规则。

如果 OpenViking 检索失败，明确记录“检索不可用/无结果”，继续以仓库为准，**不得编造召回**。

---

## 2. 任务类型路由表

| ID | 任务类型 / 触发条件 | 首选方案 | 项目组件/库 | 专用 Skill |
|---|---|---|---|---|
| R-01 | 光学玻璃、Premium Liquid Glass、页面视觉、Settings/Overlay 视觉 | 已批准 Design Lab 材质 + 项目 tokens；静态光学降级 | `design-lab.css`、`OpticalGlass`、`packages/design-tokens`、Radix/Motion | `projectos-glass-ui` |
| R-02 | 信息架构、页面布局、导航、信息密度、页面壳 | 15 路由全屏工作台；左 rail + 页面 header + 内容区；沿用 `next-ui-app.css` | `AppLayout`、`next-ui-app.css`、`packages/ui` | `projectos-glass-ui` |
| R-03 | 交互状态、Drawer/Modal/Inspector、焦点、关闭、滚动、状态标签 | 共享 Overlay primitives；真实业务状态；命中区域/层级可测 | `overlay-shell.tsx`、`overlay.css`、`InspectorShell`、`DialogShell`、Radix | `projectos-ux-audit` |
| R-04 | 工作流 DAG、Plan Review、依赖图、ELK 布局 | React Flow + ELK；真实 `PlanDraft` 拓扑；DAG 不可降级为列表 | `@xyflow/react`、`elkjs`、`TaskGraph`、`PlanReviewWorkspace` | `projectos-workflow-design` |
| R-05 | 任务看板、列/卡片、拖拽、筛选、任务详情 | 原生 HTML5 DnD + 真实任务 API；不引入 dnd-kit（未安装） | `TaskBoardPage`、`board-workspace.css`、TanStack Query | `projectos-workflow-design` |
| R-06 | Agent Team Work、跨会话、Inbox/Handoff、Agent 工作台 | 真实 sessions/handoffs/inbox API；不伪造团队状态 | `CollaborationPage`、`AgentWorkbenchPage`、collaboration contracts | `projectos-workflow-design` |
| R-07 | 运行审计、Runs、工具调用、日志持续更新 | 真实 runs/tool_calls；保留表格/时间线；增量刷新而非全量轮询 | `RunsPage`、run contracts、TanStack Query | `projectos-workflow-design` |
| R-08 | Electron 卡顿、FPS、启动、内存、IPC、渲染性能 | 先 measured baseline；大面积 blur/事件风暴优先；保留视觉 | `perf-benchmark.mjs`、CDP、Electron metrics | `projectos-performance` |
| R-09 | 视觉回归、截图、对比、UI 验收、发布前检查 | 打包 Electron + 多分辨率/主题截图 + E2E；不拿 dev preview 冒充 | Playwright-core、`phase5-pages-e2e.mjs`、`plan-review-workspace-e2e.mjs`、`scripts/screenshots.mjs` | `projectos-visual-regression` |
| R-10 | 新依赖/替换技术栈/引入开源组件 | 先做兼容性/许可证/维护/性能评估；默认不引入 | 第 4 节矩阵 | 对应 R-xx + `projectos-ux-audit` |

---

## 3. 逐项技术规范

### R-01 光学玻璃 UI

**触发**：改页面材质、玻璃、渐变、阴影、Overlay 皮肤、视觉基线。

**已批准方案**：
- 唯一视觉事实：`0686c41` + `APPROVED_design_lab_DAG.jpeg` + `docs/next-ui/VISUAL_BASELINE.md`。
- 材质来源：`design-lab.css` 的 `--pdl-*`；页面级作用域 `.pdl-root`。
- 文本层必须不透明；`opacity/filter/blur` 不得作用于承载文字的 surface。
- 浮层：`OpticalGlass` 静态光学层优先；`liquid-glass-react` 仅作兼容性对照。

**组件/库**：
`OpticalGlass.tsx`、`StageJourney.tsx`、`TaskGraph.tsx`、`design-lab.css`、`packages/design-tokens`、Radix primitives、Motion。

**边界**：
- 不做自由重设计；不改布局/导航/信息架构。
- 不把旧 `PLAN REVIEW · R1` Modal 当基线。
- 不因视觉效果修改 Planner/Scheduler/IPC/DB。
- **已知冲突，未裁决**：`PROJECTOS_UI_CONTRACT.md` 的 five-fix #3 要求正文 14px；已批准 Design Lab 截图的实际排版是 8.5–11.5px 紧凑字号（`design-lab.css` 实测）。按 AGENTS.md「截图优先」，当前不得自行放大；若要把 #3 落为全局排版，必须先取得用户新批准并做完整截图对比。**不要把这条当成已完成的字号迁移。**

**失败方案**：
- `liquid-glass-react@1.1.1` 默认启用：实测约 7 FPS，且 Chromium 下 SVG filter 发暗/不可读；只保留兼容性探针。
- React Bits Aurora 强制 GPU：约 8 FPS；默认使用静态 fallback，Aurora 仅在测得稳定时 opt-in。
- 全局 `backdrop-filter` 叠层：大面积全屏 blur 在软件合成下导致 25–40 FPS；改为大面静态/低 blur，保留边缘高光。
- 设置弹层光学皮肤：Electron Modal 内出现文字重影；未解决前保持 legacy，不重复试验。

**验收**：
- 与批准基线并排截图（light/dark，1440/1100/125%）。
- 计算对比度 ≥4.5:1（正文）；文字不被 blur/透明层污染。
- `design-lab-e2e` / `phase5-pages-e2e` 通过；无控制台错误。

**来源/状态**：`docs/design/PROJECTOS_UI_CONTRACT.md`、`VISUAL_BASELINE.md`、`DESIGN.md`、`PERFORMANCE_AUDIT.md`；**已验证**。

---

### R-02 信息架构与页面布局

**触发**：新页面、页面壳、导航、布局密度、响应式布局。

**已批准方案**：
- 15 路由工作台（见 `BASELINE_AND_RECOVERY.md`），全局 Settings 是 Modal 不是路由。
- 页面壳：左侧 rail/侧栏 + 页面 header + 主内容；保持全屏工作台构图。
- 页面迁移按 `MIGRATION_PROGRESS.md` 顺序；每次只做一个 page slice。
- 只对当前页包 `.pdl-root`，不全局重设 legacy 组件。

**组件/库**：
`AppLayout`、`next-ui-app.css`、`packages/ui`（AppShell/PageElements/StatusPill）、Lucide、Tailwind 4。

**边界**：
- 不改后端/真实数据路径。
- 不删除 Settings 全局 Modal 约束（ADR-0008）。
- 不引入 shadcn/ui 作为并行设计系统；项目已有 `next-ui/ui` + `packages/ui`。

**验收**：
- 路由可达、侧栏折叠/展开、1100px/125% 不溢出。
- 真实数据、空态、错误态可见；页面 E2E 通过。

**来源/状态**：`BASELINE_AND_RECOVERY.md`、`PROJECTOS_DESIGN_SYSTEM.md`；**已验证**。

---

### R-03 交互状态与 Overlay

**触发**：Drawer/Modal/Inspector、关闭 X、滚动、焦点、状态标签、审批入口。

**已批准方案**：
- 共享 `InspectorShell` / `DialogShell` / `SheetShell`；单一 scroll owner；Radix Dialog 焦点/Portal；Motion 进出场。
- 非模态 Inspector 无 backdrop；关闭保留 220ms exit；脏关闭走 guard。
- 交互必须用**真实元素命中测试**验证，不只看坐标/截图。
- 状态标签必须来自真实业务状态；已批准计划不得显示“待批准”。

**组件/库**：
`next-ui/overlay/overlay-shell.tsx`、`overlay.css`、`TaskInspector.tsx`、`PlanReviewNext.tsx`、`PlanReviewWorkspace.tsx`、Radix Dialog/Popover。

**失败方案**：
- Ant message 全局层 (`z-index: 2010`) 覆盖右上关闭按钮：`elementFromPoint` 命中 `.ant-message-list-content`；修复为 message 不拦截指针 + 提升浮层层级。
- 硬编码计划状态：已批准计划显示“待批准”，用户误以为缺少审批；必须映射真实 `plan.status`。
- 用 `page.locator().click()` 代替真实 `mouse.click`：会漏掉遮挡/偏移，必须做坐标命中与元素命中双重验证。

**验收**：
- 真实鼠标点击 X 中心可关闭（100%/125%）。
- 滚轮在内容区/头部/底部均可滚动（无溢出时允许不滚动）。
- 状态标签与 DB/API 状态一致；审批按钮只在 draft 出现。
- 对应 E2E 断言 + 截图。

**来源/状态**：`PLAN_INSPECTOR_FIX.md`、`OVERLAY_SYSTEM.md`；**已验证（draft 全屏抽屉）**；已批准 legacy 视图仍有独立的只读行为，需按 R-03 复测。

---

### R-04 工作流 DAG 与 Plan Review

**触发**：DAG 缩放/拖拽/选择、Plan Review 打开、ELK 布局、依赖边。

**已批准方案**：
- React Flow 12.12 + ELK 0.12 layered；
- `PlanReviewWorkspace` 是草稿的正式全屏工作区；
- `PlanReviewNext` 是已批准/只读的 legacy 视图，不是新草稿入口；
- 真实 `PlanDraft`、`tasks`、`dependsOn`、审批 API；不可把 DAG 降级为列表。

**关键实现约束**：
- ELK 只对 `tasks` 拓扑变化重算；不要每帧/每次选择重算。
- DAG 缩放不要 `setState` 每个 viewport 事件；用 ref/class 或节流。
- Plan Review 打开时暂停后台 runtime 事件的 graph/snapshot 失效风暴；关闭/审批后显式刷新。
- 节点拖拽不得导致整页无意义重渲染；用 memo/selector，但必须有 profile 证据。
- 默认边为实线中性色；选中路径静态高亮，不做持续流动动画。

**失败方案**：
- `PlanReviewNext` 旧 R1 Modal 作为正式方案：明确拒绝。
- 每次 `onMove` 更新 React state：无意义重渲染。
- 在每个 runtime event 全量 invalidate graph/snapshot：12–13 次重复查询。
- 把 DAG 改为列表“提升性能”：禁止。

**验收**：
- `plan-review-workspace-e2e.mjs`（13 checks）通过。
- DAG 节点数/边数与真实数据一致；缩放/选择/审批可用。
- 打包应用 FPS 基线：优化前 35.1 → 优化后 49.5（本机软件合成）；不得回退到 <35。

**来源/状态**：`PLAN_REVIEW_WORKSPACE_MIGRATION.md`、`PERFORMANCE_AUDIT.md`、`PLAN_INSPECTOR_FIX.md`；**已验证**。

---

### R-05 任务看板

**触发**：看板列/卡片、拖拽、筛选、任务详情。

**已批准方案**：
- 原生 HTML5 drag/drop（`draggable`, `dataTransfer`），真实任务 API；
- 不安装 dnd-kit；当前需求没有证明需要额外 DnD 库；
- 卡片密度/列宽遵循 `board-workspace.css`，保留搜索/筛选/Inspector。

**边界**：
- 不改任务状态机；拖拽失败必须回滚/提示；
- 不引入虚拟列表，除非 profiler 证明列表规模导致瓶颈。

**验收**：`phase5-pages-e2e` 48 checks；拖拽/搜索/详情真实数据；1100px 无横向溢出。

**来源/状态**：`TaskBoardPage.tsx`、`board-workspace.css`、Phase 5 E2E；**已验证**。

---

### R-06 Agent Team Work / 跨会话

**触发**：Agent 工作台、协作中心、Inbox、Handoff、团队运行。

**已批准方案**：
- 真实 `sessions` / `handoffs` / `agent_inbox` / collaboration snapshot；
- 团队状态由真实运行/交接驱动，不伪造“已完成”；
- 使用现有 preload API；不改 mailbox authority/lease 语义。

**边界**：不把聊天记录当事实；不自动重试未知外部副作用；写操作需 policy/approval。

**验收**：collaboration E2E / v18 teamwork；真实 inbox/handoff 数据；无伪造空态。

**来源/状态**：`docs/cross-session.md`、ADR-0004/0005；**已验证（现有 E2E）**。

---

### R-07 运行审计 / Runs

**触发**：Runs 页面、日志流、工具调用审计、运行状态。

**已批准方案**：
- 真实 `agent_runs` / `run_steps` / `tool_calls`；保留审计链；
- 事件驱动增量刷新；不要高频全量轮询；
- 日志持续更新不能阻塞主线程。

**边界**：不隐藏失败/拒绝记录；不改 Runtime 审计边界（ADR-0009）。

**验收**：Runs E2E/审计页截图；真实 ToolCall 可见；空闲 CPU 无持续高占用。

**来源/状态**：`RunsPage`、`PERFORMANCE_AUDIT`；**部分验证**（resize/run audit 有未复现回退，待复测）。

---

### R-08 Electron 性能

**触发**：卡顿、启动慢、FPS 低、内存增长、IPC 慢。

**已批准方案**：
- 必须测 **打包 EXE**，不是 Vite dev；
- 基线工具：`scripts/perf-benchmark.mjs`（rAF、long task、React commits、CDP、主进程 metrics、IPC probe）；
- 先测后改；优先大面积 blur、事件风暴、关闭仍挂载组件、无意义 setState；
- 保留视觉；不得默认关闭硬件加速；不得用“简化功能”换性能。

**已知约束**：
- 本机软件合成，DAG 35→49.5 FPS、Plan Review 25.5→40.8 FPS；不能宣称普遍 60 FPS。
- 大面 `backdrop-filter` 是首要成本；页面 header 已移除，侧栏 12px，Plan workspace 无 blur。
- `project.overview`/`workspace.snapshot` 单次约 1.7s，属于后端查询成本，未改契约。
- 运行审计/窗口缩放有未复现回退，需单独复测。

**验收**：优化前后 JSON + FPS/长任务对比；视觉回归；Phase5/Plan E2E；30s idle 内存稳定。

**来源/状态**：`docs/performance/PERFORMANCE_AUDIT.md` + raw JSON；**已验证（本机）**。

---

### R-09 视觉回归

**触发**：任何 renderer UI 改动、发布前、修复布局/overlay。

**已批准方案**：
- 打包 Electron + Playwright-core；
- 截图矩阵：light/dark、1440×900、1100px、125% DPI；
- 先看真实窗口，再看截图；检查文字清晰、无重影、无裁切、无错误层级；
- 对照 `docs/next-ui/visual-regression/APPROVED-design-lab-dag.png` 与 `plan-approved-status.png`。

**推荐命令**：

```powershell
pnpm build
node scripts/phase5-pages-e2e.mjs
node scripts/plan-review-workspace-e2e.mjs
node scripts/design-lab-e2e.mjs
node scripts/design-lab-contrast.mjs
pnpm test:package
```

**边界**：dev preview 不能作为视觉验收；单元测试全绿不等于视觉通过；不伪造截图。

**验收**：变更截图 + 对比说明 + E2E + 未验证项列表。

**来源/状态**：`scripts/*e2e.mjs`、`docs/next-ui/visual-regression`；**已验证**。

---

## 4. 开源项目 / 依赖矩阵（已核实）

| 项目 | GitHub | 当前版本 | 许可证 | 状态 | 用途 / 边界 |
|---|---|---|---|---|---|
| shadcn/ui | https://github.com/shadcn-ui/ui | 未安装 | MIT | **参考，不引入** | 已有 `next-ui/ui` + `packages/ui`；不建立第二套设计系统 |
| Radix Primitives | https://github.com/radix-ui/primitives | dialog 1.3.1 / popover 1.3.1 / scroll-area 1.4.0 / tabs 1.2.1 / tooltip 1.4.1 | MIT | **已安装** | Overlay/焦点/Portal；不重写可访问性 |
| Motion | https://github.com/motiondivision/motion | 14.6.0 | MIT | **已安装** | 进入/退出/spring；尊重 reduced-motion；不做持续全屏动画 |
| React Flow | https://github.com/xyflow/xyflow | 12.12.0 | MIT | **已安装** | DAG 画布/节点/边/缩放；真实拓扑 |
| ELK.js | https://github.com/kieler/elkjs | 0.12.0 | EPL-2.0 OR GPL-3.0-or-later | **已安装** | 分层布局；仅拓扑变化时重算；选择 EPL-2.0 使用，不修改库 |
| dnd-kit | https://github.com/clauderic/dnd-kit | 未安装 | MIT | **未引入** | 看板已用原生 HTML5 DnD；无 profiler 证据不新增 |
| Playwright | https://github.com/microsoft/playwright | core 1.64.1 | Apache-2.0 | **已安装** | Electron E2E/截图；不是运行时依赖 |
| Ant Design | https://github.com/ant-design/ant-design | 6.6.6 | MIT | **已安装/legacy** | 旧页面表单/弹层；新 UI 不扩大 Ant 视觉面 |
| Tailwind CSS | https://github.com/tailwindlabs/tailwindcss | 4.3.3 | MIT | **已安装** | `next-ui` 工具类；不替代 tokens |
| Lucide | https://github.com/lucide-icons/lucide | 1.61.0 | ISC | **已安装** | 图标统一；保留 aria-label |
| Electron | https://github.com/electron/electron | 43.8.2 | MIT | **已安装** | 主进程/窗口/安全边界；不改安全配置 |
| Liquid Glass React | https://github.com/rdev/liquid-glass-react | 1.1.1 | MIT | **实验/拒绝默认** | 7 FPS + Chromium filter 异常；仅兼容性探针 |
| React Bits Aurora | https://github.com/DavidHDev/react-bits | local adaptation | MIT + Commons Clause | **opt-in/默认关闭** | 8 FPS；静态 fallback 默认；保留 attribution |
| Sim Studio | https://github.com/simstudioai/sim | 仅参考 | Apache-2.0 | **参考** | 只学习工作流编辑器构图；不复制品牌/源码 |

> 版本来自 `package.json` 与安装包元数据；许可证来自 npm 包 `license` 字段/上游仓库。
> 任何新增依赖必须先更新本表，并附兼容性、许可证、维护状态、性能证据。

---

## 5. 已尝试失败 / 禁止回退

| 方案 | 失败证据 | 结论 |
|---|---|---|
| 旧 `PLAN REVIEW · R1` Modal | 用户明确拒绝；`REJECTED-current-real-plan-review.png` | 禁止作为正式 Plan Review |
| 全局/大面积 `backdrop-filter` | 软件合成下 DAG 35 FPS、Plan 25 FPS；全关可到 54–64 FPS | 大面静态化/低 blur；不做全局 blur 堆叠 |
| `liquid-glass-react` 默认 | 7 FPS + 暗块/不可读 | 只做探针，不用于正文表面 |
| Aurora 强制 GPU | 8 FPS | 默认静态 fallback |
| Settings 光学皮肤 | Electron Modal 内文字重影/双字 | 保持 legacy；未解决前不重复 |
| Ant message 遮挡右上按钮 | `elementFromPoint` 命中 `.ant-message-list-content` | message 不拦截指针；关键控件层级可测 |
| 已批准计划显示“待批准” | DB `status=approved` 但 UI 硬编码 | 状态必须来自真实 plan.status |
| 关闭仍挂载 AgentStudio | runtime.list ~2.2s/次 | 条件挂载 + 5min staleTime |
| Plan Review 期间全量 invalidate | 12–13 次重复 snapshot/graph 查询 | 打开时暂停后台失效，关闭后刷新 |
| 每次 onMove setState | 无意义重渲染 | ref/class 或节流（仍需 profile 证明） |

---

## 6. 性能 / 兼容性约束（硬约束）

1. 渲染进程不得直接访问 Node/FS/DB/Shell；只走 preload。
2. 不改 IPC 契约、SQLite 单写者、安全配置、CSP。
3. 不改已批准视觉基线；重要偏离需用户批准 + 新截图。
4. 不默认关闭硬件加速；不通过删除功能/模糊/阴影“假优化”。
5. 大面 blur 必须实测；本机软件合成是最坏情况。
6. 新依赖必须评估：许可证、维护、包体积、Electron/Chromium 兼容、性能。
7. 不使用 `any` 绕过契约；不伪造 E2E/截图。
8. 保留真实数据/空态/错误态；不把本地规则生成说成 AI 生成。
9. 测试使用临时 `PROJECTOS_DATA_DIR` / `--user-data-dir`，不碰用户真实数据。
10. 不 reset/clean/force-push/自动合并 stable。

---

## 7. 真实验收标准

### 通用

```powershell
pnpm ai:route-check   # 路由文件/技能/依赖声明离线检查
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### UI / Overlay / DAG

```powershell
node scripts/phase5-pages-e2e.mjs          # 48 checks
node scripts/plan-review-workspace-e2e.mjs # 13 checks
node scripts/design-lab-e2e.mjs            # 31 checks
node scripts/design-lab-contrast.mjs
```

### 打包

```powershell
pnpm package:dir
pnpm test:package
```

### 性能

```powershell
node scripts/perf-benchmark.mjs <packageRoot> docs/performance/<run>.json
```

### 视觉

- 打包应用截图：light/dark、1440/1100/125%。
- 与批准基线并排查看；无重影/裁切/层级遮挡。
- 记录未验证项；不把“单元测试通过”当视觉验收。

---

## 8. 例外与变更流程

改变本表已批准方案时，必须：

1. 说明触发的 R-xx 与现有方案。
2. 给出兼容性/许可证/维护/性能证据。
3. 说明影响范围与回滚方式。
4. 涉及视觉基线/安全/数据契约时，先取得用户批准。
5. 更新本文件、`docs/AI_EXPERIENCE_LOG.md` 与 OpenViking 记忆。
6. 重新跑对应 E2E + 截图。

---

## 9. 经验闭环

- 成功：记录任务类型、组件/版本、命令、验收结果、可复用步骤。
- 失败：记录根因、证据、避免再次踩坑的约束。
- 重复 UI 问题：必须新增/修改 E2E 或检测脚本，不能只写一条记忆。
- 记录位置：`docs/AI_EXPERIENCE_LOG.md`；长期检索：OpenViking。

---

## 10. OpenViking 映射

- 本文件导入 `viking://resources/projectos/ai-tool-routing`（异步处理）。
- 设计/性能/修复文档作为同目录资源导入。
- 专用 Skills 注册到 `viking://~/skills`（个人）或 `viking://agent/skills`（共享，需用户明确同意）。
- 项目 peer：`github.com-l541402398-objectos`；跨 worktree/克隆共享。
- 资源是全局 `viking://resources`；记忆在 peer 下。两者共享范围不同，检索时必须区分。
- 新会话验证记录：`docs/ai/OPENVIKING_RETRIEVAL_VALIDATION.md`。

---

## 11. 维护信息

| 字段 | 值 |
|---|---|
| Owner | ProjectOS maintainers / executing DSH agent |
| 复核周期 | 每次技术选型/依赖升级/视觉基线变更 |
| 过期条件 | 依赖主版本变化、ADR 变更、视觉基线重新批准 |
| 事实来源 | 仓库代码/文档/测试优先；OpenViking 为辅 |
| 禁止 | 未验证的 GitHub Star/博客/聊天摘要作为选型依据 |
