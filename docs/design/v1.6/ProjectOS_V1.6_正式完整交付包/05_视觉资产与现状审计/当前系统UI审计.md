# ProjectOS 当前 UI / UX 盘点（设计重做输入）

版本：V1.5  
日期：2026-10-20  
平台：Windows 桌面（Electron），已有 Ubuntu 22.04 AppImage 构建产物  
用途：供设计团队基于现有功能与界面重新设计 UX，而不是从零猜功能。

---

## 1. 产品定位

ProjectOS 是一个本地优先、AI 原生的项目全生命周期桌面工作台：

- 项目：需求、阶段、任务、里程碑、交付物
- Agent：自定义 Agent、Persona、Skills、Runtime、模型与权限
- 执行：AgentRun、工具审批、流式事件、运行审计
- 编排：计划 DAG、多 Agent 自动执行、质量门禁、Git Worktree
- 自主运营：健康检查、Finding、修复提案、预算与调度
- 知识：本地 FTS5 全文检索

核心概念必须区分：

- **模型 Provider**：DeepSeek、OpenAI、Anthropic 等模型服务
- **Runtime**：真正执行 Agent 的引擎，如 DSH、OpenCode、Claude Code、自定义 CLI/ACP
- **Agent**：名称、人设、技能、Runtime、权限的组合

---

## 2. 全局框架

### 2.1 窗口与导航

- 自定义标题栏，Windows 无系统标题栏；macOS 使用 hiddenInset
- 左侧导航，可折叠
- 顶部命令入口：搜索、Runtime 状态、主题、设置、窗口控制
- 导航分组：
  - 工作台
  - 工程
  - 全局

### 2.2 全局组件

- Command Palette：搜索 / 跳转 / 新建任务 / 打开设置等
- 主题切换：Light / Dark / System
- Runtime 状态胶囊：ready / connecting / unavailable
- 通知入口
- 项目切换器

### 2.3 设计 Token 现状

- 字体：系统无衬线 + Consolas 等宽
- 正文 14px，辅助 13px，小号 12px；标题 16/20/28/34
- Light/Dark 两套 token
- 玻璃拟态仅用于侧栏、工具栏、弹层
- 圆角：卡片 12–16，按钮 8–10，弹层 18
- 高密度桌面布局，非移动端

截图：

- `screenshots/1440x900-light-overview.png`
- `screenshots/1440x900-dark-overview.png`
- `ui-review/command-palette.png`

---

## 3. 页面清单

> `ui-review/` 是本次为设计团队重新采集的 1440×900 Light 全量界面。  
> `screenshots/` 是现有 1440×900 / 1024×768、Light/Dark、DPI 截图。

### 3.1 项目中心 `/`

目的：选择项目、创建项目、进入最近项目。

主要区域：

- 页头：项目中心、载入示例项目、新建项目
- 空状态 / 最近项目
- 本地项目卡片网格
- 最近项目摘要

交互：

- 新建项目 → 弹窗
- 项目卡片 → 项目总览
- 载入示例项目

截图：

- `ui-review/page-project-center.png`
- `ui-review/modal-new-project.png`
- `screenshots/1440x900-light-project-center.png`

### 3.2 项目总览 `/projects/:id`

目的：项目生命周期与健康状态总览。

主要区域：

- 项目头：名称、描述、路径、Git、更新时间
- 生命周期阶段条
- 指标卡：任务进度、活跃 Agent、待授权、交付物
- 里程碑
- 需求与验收
- 近期活动
- Agent 活动
- 待授权
- 项目上下文
- 项目指标（右侧）
- 软预算编辑器

交互：

- 推进阶段
- 新建任务
- 查看任务
- 里程碑完成
- 决策 / 需求 / 交付物

截图：

- `ui-review/page-overview.png`
- `screenshots/1440x900-light-overview.png`
- `screenshots/1440x900-light-settings-routing.png` 不相关，忽略

### 3.3 任务看板 `/projects/:id/tasks`

目的：任务状态、依赖、Agent 分配。

主要区域：

- 页头：筛选、新建任务
- 列：Backlog / Ready / In Progress / Review / Done / Blocked / Cancelled
- 任务卡：标题、优先级、Agent、依赖、运行次数、交付物数
- 受阻与取消汇总
- 任务详情 Drawer

交互：

- 新建 / 编辑任务
- 拖拽移动
- 打开详情
- 依赖管理
- 运行 Agent

截图：

- `ui-review/page-task-board.png`
- `ui-review/modal-new-task.png`
- `ui-review/drawer-task-detail.png`
- `screenshots/1440x900-light-tasks.png`

### 3.4 知识库 `/projects/:id/knowledge`

目的：本地 FTS5 全文检索。

主要区域：

- 搜索框
- 结果列表
- 高亮摘要
- 空状态

交互：

- 搜索
- 跳转来源

截图：

- `ui-review/page-knowledge.png`
- `screenshots/1440x900-light-knowledge.png`

### 3.5 自主运营 `/projects/:id/operations`

目的：健康检查、Finding、修复提案、自动模式。

主要区域：

- 页头：模式、自动检查间隔、运行健康检查
- 检查列
- Findings 列（多选生成提案）
- 修复提案列（批准 / 拒绝 / 启动修复）
- 项目洞察：依赖、CI、hooks、审计、趋势、Changelog

交互：

- 运行检查
- 生成提案
- 批准 / 拒绝
- 启动修复（授权 24h/5 次）
- 设置自动模式与间隔

截图：

- `ui-review/page-operations.png`
- `screenshots/1440x900-light-operations.png`

### 3.6 编排工作台 `/projects/:id/orchestration`

目的：计划、Agent 层级图、任务 DAG、执行与 Worktree。

主要区域：

- 项目指标条
- 计划操作：扫描、生成计划、开始 / 暂停 / 继续 / 取消
- 层级图：Orchestrator → Agent → Task
- 依赖连线
- 右侧 Inspector：概览 / 活动 / 文件 / 授权
- 依赖流
- MiniMap
- 节点筛选、键盘快捷键
- 计划弹层、Worktree Diff 弹层

交互：

- 生成 / 修订计划
- 批准计划
- 开始执行
- 打开 Agent / 任务
- 保存布局 / 适配
- 合并 / 丢弃 Worktree

截图：

- `ui-review/page-orchestration.png`
- `ui-review/modal-plan.png`
- `screenshots/1440x900-light-orchestration.png`
- `screenshots/1440x900-dark-orchestration.png`

### 3.7 Agent 工作台 `/projects/:id/agents`

目的：与 Agent 会话、运行、审批、工具调用。

主要区域：

- 页头：刷新、模型设置、Agent 管理、新建会话
- 会话列表
- 当前会话消息
- 运行状态、工具调用、审批卡
- 输入框

交互：

- 新建 Agent 会话
- 发送消息
- 审批工具
- 取消运行
- 打开 Agent 管理

截图：

- `ui-review/page-agent-workbench.png`
- `ui-review/modal-new-session.png`
- `ui-review/modal-agent-studio.png`
- `screenshots/1440x900-light-agent-workbench.png`

### 3.8 跨会话中心 `/projects/:id/collaboration`

目的：Agent 之间的消息、收件箱、交接。

主要区域：

- 收件箱
- 消息详情
- Handoff
- 投递统计

交互：

- 查看消息
- 接受 / 拒绝交接
- 发消息

截图：

- `ui-review/page-cross-session.png`
- `screenshots/1440x900-light-cross-session.png`

### 3.9 工作区 `/projects/:id/workspace`

目的：文件树 + Monaco 编辑器。

主要区域：

- 文件树
- 编辑器
- 当前文件状态

交互：

- 打开文件
- 编辑 / 保存
- 目录切换

截图：

- `ui-review/page-workspace.png`
- `screenshots/1440x900-light-workspace.png`

### 3.10 运行审计 `/projects/:id/runs`

目的：查看 Agent 运行、步骤、Token、错误。

主要区域：

- 运行列表
- 运行详情
- 步骤 / 工具 / 错误

交互：

- 选择运行
- 查看事件与步骤
- 取消运行

截图：

- `ui-review/page-runs.png`
- `screenshots/1440x900-light-runs.png`

---

## 4. 设置与弹窗

设置是全局弹层，不是路由页面。

### 4.1 AI 连接

- 连接卡片
- 搜索 / 过滤
- 新增连接
- 默认连接
- 健康状态

截图：`ui-review/settings-ai-connections.png`

### 4.2 连接编辑器

- 内联在设置内，不是嵌套弹窗
- 基础 / 认证 / 模型 / 网络 / 高级
- API Key 遮挡
- 保存 / 测试 / 取消

截图：`ui-review/settings-connection-editor.png`

### 4.3 模型目录

- 连接选择
- 模型列表
- 能力标记
- 默认模型

截图：`ui-review/settings-models.png`

### 4.4 Agent 路由

- 角色 → 连接 / 模型
- 全局默认
- 路由策略
- 模型价格
- 用量

截图：`ui-review/settings-routing.png`

### 4.5 运行时

- 本机 Runtime 健康
- Agent Runtime 列表
- 检测环境
- 自定义 Runtime
- 测试
- 编辑 / 删除
- ACP Registry 可发现列表
- 认证

截图：`ui-review/settings-runtime.png`

### 4.6 外部 Agent

- 检测 Claude Code / Codex
- 只读 / Worktree 写模式
- 运行
- 兼容性说明

截图：`ui-review/settings-external.png`

### 4.7 通用 / 关于

截图：

- `ui-review/settings-general.png`
- `ui-review/settings-about.png`

---

## 5. 弹窗与抽屉清单

| 名称 | 截图 | 说明 |
|---|---|---|
| 新建项目 | `ui-review/modal-new-project.png` | 名称、路径、初始化 Git |
| 新建任务 | `ui-review/modal-new-task.png` | 标题、描述、优先级、验收标准、Agent |
| 总览快速新建任务 | `ui-review/modal-new-task-from-overview.png` | 简化入口 |
| 任务详情 | `ui-review/drawer-task-detail.png` | 任务信息、依赖、运行、交付物 |
| 计划 | `ui-review/modal-plan.png` | 计划 revision、任务 DAG、批准 |
| Agent 管理 | `ui-review/modal-agent-studio.png` | 名称、角色、Persona、Skills、Runtime、权限、导入导出 |
| 新建会话 | `ui-review/modal-new-session.png` | 选择 Agent、标题 |
| 命令面板 | `ui-review/command-palette.png` | 全局搜索与命令 |
| 连接编辑器 | `ui-review/settings-connection-editor.png` | 设置内联 |

未单独截图但存在：

- Worktree Diff
- 合并 / 丢弃确认
- 审批卡
- 里程碑 / 需求 / 决策弹窗
- 运行取消确认

---

## 6. 关键用户流程

### 6.1 项目与任务

```text
项目中心 → 新建项目 → 总览 → 推进阶段 → 任务看板 → 新建任务
→ Agent 工作台 → 运行 → 审批 → 交付物
```

### 6.2 Agent 创建

```text
Agent 工作台 → Agent 管理 → 名称/角色 → Persona → Skills
→ Runtime → 模型 → 权限 → 预览提示词 → 保存版本
```

### 6.3 计划与编排

```text
编排工作台 → 扫描 → 生成计划 → 调整依赖 → 批准
→ 开始执行 → Agent 层级图 → 质量门禁 → Worktree 合并
```

### 6.4 自主运营

```text
运行健康检查 → Finding → 生成提案 → 批准
→ 授权 24h/5 次 → 启动修复 → Worktree 执行
→ Finding resolved / Proposal completed
```

---

## 7. 当前 UX 问题（重设计重点）

1. **信息密度过高**：编排图、运行审计、设置页在 1024×768 下偏拥挤。
2. **设置分组过长**：运行时页面同时有健康、Runtime 列表、Registry、系统信息。
3. **弹窗尺寸不统一**：Agent 管理、计划、任务详情高度差异大。
4. **Runtime 编辑仍是浏览器 prompt**，不是正式表单。
5. **工具审批缺少独立卡片**：ACP 权限按 Agent grants 自动批准/拒绝，用户看不到“待批准工具”的完整上下文。
6. **Runtime 概念仍偏工程化**：普通用户容易把 Provider、Runtime、Agent 混淆。
7. **空状态偏多**：Operations、Knowledge、Runs 在没有数据时信息不足。
8. **图表视觉**：编排图节点文字仍偏小，Inspector 与画布比例需重新设计。
9. **缺少 onboarding**：第一次进入没有引导“先建项目、再配模型、再选 Runtime”。
10. **Linux 产物**：只有 AppImage，尚未做 Ubuntu 桌面实际启动验证。

---

## 8. 设计要求

- 保留 V1.3 层级图：Orchestrator → Agent → Task、依赖连线、Inspector、实时状态、布局持久化
- 保留 V1.4 文字清晰度：正文 ≥14px、辅助 ≥13px、对比度 ≥4.5:1
- Light/Dark 都必须完整
- Windows 100/125/150% DPI 必须无横向溢出
- 不使用营销文案；只保留操作必需信息
- 设置必须是全局弹层；连接编辑必须内联
- Runtime 状态必须真实，不允许装饰性“已连接”
- 不把模型 Provider 与 Runtime 混为一谈

---

## 9. 截图包结构

```text
UI-REVIEW.md
ui-review/        26 张：1440×900 Light，页面 + 弹窗 + 设置
screenshots/      54 张：1440×900 / 1024×768、Light/Dark、DPI 125/150
```

关键对照：

- 浅色：`screenshots/1440x900-light-*.png`
- 深色：`screenshots/1440x900-dark-*.png`
- 小屏：`screenshots/1024x768-*.png`
- DPI：`screenshots/dpi-1.25-*.png`、`dpi-1.5-*.png`

---

## 10. 交付

- 当前 Windows 包：`release/ProjectOS-0.1.0-portable.exe`
- 当前 Ubuntu AppImage：`release/ProjectOS-0.1.0-linux-x86_64.AppImage`
- 设计输入：本 MD + 截图包
