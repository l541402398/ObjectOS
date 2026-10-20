# ProjectOS V1.6 — 用户反馈修复与待复核页面推进

日期：2026-10-20  
分支：`feature/v1.6-ux`

## 1. Runtime 选择器修复

用户反馈只能选 Claude Code。

修复：

- 默认 Runtime 补齐 OpenCode、DeepSeek Harness 等 Adapter
- 已有数据库时只补缺失 Adapter，不重置现有配置
- `runtime.detect` 现在把 executable / version / status 持久化
- 检测按 `options.adapterId` 识别，而不是数据库随机 ID
- 绝对路径 Runtime 不再被 `where.exe` 误判
- Native 状态改为真实 available / embedded

实机检测结果：

```text
ProjectOS Native    native  available embedded
Claude Code         cli     available -
OpenCode            acp     available 1.19.3
DeepSeek Harness    cli     available -
```

Agent Studio 运行环境 Tab 现在同时显示并可选：

- ProjectOS Native
- Claude Code
- OpenCode
- DeepSeek Harness

截图：`docs/v1.6/round2-agent-studio-tab3.png`

## 2. 任务内快速指派 Agent

任务详情 Drawer 新增“指派 Agent”行：

- 直接显示 Agent 下拉
- 支持搜索
- 支持清空
- 保存后立即刷新任务与看板
- 不需要跳转 Agent 管理

E2E：

```text
QUICK ASSIGN PASS 设计同步冲突合并策略 Quick Assign Agent
```

## 3. 看板整列拖放

问题：只有拖到蓝色边框区域才能落下。

修复：

- 拖拽期间任务卡 `pointer-events: none`
- 整个列（列头 + 列体 + 卡片区域）都是可放置面
- 保留 dragover 高亮，但不再要求精确落点

E2E：

```text
dragged 设计同步冲突合并策略 status ready
TASK BOARD COLUMN DROP PASS
```

## 4. 待复核设计图：新增页面

已按 `02_新增独立设计图` 继续实现：

- 项目设置（`47_project_settings`）
  - 名称、描述、状态真实更新
  - 真实根目录、阶段、版本、Git 状态
  - 打开目录
- 项目健康（`43_project_health`）
  - 完成率、活跃运行、受阻任务、平均周期
  - 真实 Agent 执行统计
  - 关键路径
  - 跳转编排 / 自主运营

截图：

- `docs/v1.6/pages/project-settings.png`
- `docs/v1.6/pages/project-health.png`

此前已实现并保留：资源中心、审批中心、Agent Studio 五 Tab、AI 连接极简表单、工具与插件、团队与权限、系统与外观。

## 5. 验证

```text
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 24 files / 113 tests passed
Runtime 选择器  → PASS（OpenCode + DeepSeek Harness）
快速指派 E2E    → PASS
整列拖放 E2E    → PASS
package:win     → PASS
package-smoke   → PASS
```

## 6. 产物

- Windows：`release/ProjectOS-1.6.0-portable.exe`
  `18D887B4ADADA0B68ACB2B1CB1158A4D7FE26DBE3DF7BDB46EF21D18D92371A6`
- Linux：`release/ProjectOS-1.6.0-linux-x86_64.AppImage`
  `F67E5F03FD20B078B0BB5ACF5C5C4589A8A9F27846EB18F6D8EE555D0889403E`

## 7. 仍未完成

- OpenCode ACP 在 DAG 中 120s 超时；DSH CLI 已通过
- Runtime 任务取消尚未中断子进程
- 工作流节点库 / 底部日志高保真
- 通知中心、工具权限、存储、网络、安全、导入项目等剩余待复核页面
- 41 张新增稿尚未逐页视觉确认
