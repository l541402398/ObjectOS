# ProjectOS V1.6 — 用户反馈修复（第二轮）

日期：2026-10-20  
分支：`feature/v1.6-ux`

## 1. Runtime 选择器：DeepSeek Harness / OpenCode

已修复：

- 已有数据库也会补齐缺失 Runtime Adapter
- 默认播种包含 OpenCode
- `runtime.detect` 持久化 executable / version / status
- 按 `options.adapterId` 检测，不再依赖随机数据库 ID
- 绝对路径 Runtime 直接识别
- Native Runtime 状态修正为 available / embedded

实测：

```text
ProjectOS Native    native  available embedded
Claude Code         cli     available -
OpenCode            acp     available 1.19.3
DeepSeek Harness    cli     available -
Codex/Qwen/Gemini   cli     unavailable
RUNTIME SELECTION PASS
```

Agent Studio 运行环境页现在可选 DeepSeek Harness 与 OpenCode。

## 2. 任务内快速指派 Agent

任务详情 Drawer 新增“指派 Agent”：

- 搜索
- 选择 Agent
- 清空
- 保存后看板/详情立即刷新

E2E：

```text
QUICK ASSIGN PASS 设计同步冲突合并策略 Quick Assign Agent
```

## 3. 看板整列拖放

修复：

- 拖拽期间所有任务卡 `pointer-events: none`
- 整个列（列头、列体、卡片区域）都是放置面
- 蓝色高亮仅作为反馈，不再是唯一可放置区

E2E：

```text
dragged 设计同步冲突合并策略 status ready
TASK BOARD COLUMN DROP PASS
```

## 4. Runtime 任务取消

新增：

- CLI Runtime 记录 executionId，可调用 executor.cancel()
- ACP Runtime 取消时 dispose 客户端
- 取消后 Run → cancelled
- 任务 → ready
- Attempt → cancelled
- 子进程通过 killTree 终止

E2E：

```text
status cancelled taskStatus ready
RUNTIME CANCEL PASS
```

## 5. 待复核设计图继续实现

新增：

- 项目设置 `/projects/:id/project-settings`
- 项目健康 `/projects/:id/health`
- 通知中心 `/notifications`

项目设置：

- 名称/描述/状态真实更新
- 根目录、阶段、版本、Git 状态
- 打开目录

项目健康：

- 完成率、活跃运行、受阻任务、平均周期
- Agent 执行统计
- 关键路径

通知中心：

- 真实待审批
- 真实最近活动
- 跳转审批中心

截图：

- `docs/v1.6/pages/project-settings.png`
- `docs/v1.6/pages/project-health.png`
- `docs/v1.6/pages/notifications.png`

## 6. 验证

```text
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 24 files / 113 tests passed
Runtime 选择器  → PASS
快速指派 E2E    → PASS
整列拖放 E2E    → PASS
Runtime 取消 E2E→ PASS
DSH DAG Runtime → PASS
package:win     → PASS
package-smoke   → PASS
```

## 7. 产物

- Windows：`release/ProjectOS-1.6.0-portable.exe`
  `FECEFFE82B91ED3C5A9778A2BC45D4B737693173A5ECF2D8BBBD0124AA201954`
- Linux：`release/ProjectOS-1.6.0-linux-x86_64.AppImage`
  `466205361EE73D6D4B9AF036804F1EEEC4D5066C0FF20B3BADAAFD6767090E4D`

## 8. 仍未完成

- OpenCode ACP 在 DAG 任务中 120s 超时
- 工作流节点库 / 底部日志高保真
- 工具权限、存储、网络、安全、外观、快捷键、导入项目等剩余待复核页
- 41 张新增设计稿逐页视觉确认
