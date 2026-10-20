# ProjectOS V1.6 — Runtime 执行进入任务 / DAG

日期：2026-10-20  
分支：`feature/v1.6-ux`

## 完成内容

### 1. AgentRunner 增加 Runtime 分支

任务 / DAG 调度仍由 AgentRunner 承担，但现在会先检查：

- AgentDefinition 是否存在
- primaryRuntimeProfileId / runtimeProfileIds
- Runtime 协议与状态

当绑定 Runtime 为 `available` 且不是 Native：

- 不再要求模型 Provider 配置
- 直接通过 RuntimeExecutionService / AcpClient 执行
- 生成 AgentRun 事件、RunStep、消息、任务状态
- 完成后任务进入 `review`
- 失败进入 `blocked`

### 2. 真实 E2E：自定义 Agent + DSH Runtime + 任务

```text
runtime DSH DAG Runtime cli available
status completed taskStatus review steps 4
DAG RUNTIME EXECUTION PASS run_01m5cnevf4f5p50dn6ycw5je5q DSH DAG Runtime
```

验证内容：

- Agent Studio 创建自定义 Agent
- 绑定 DSH CLI Runtime
- 创建任务并指派该 Agent
- run.start 启动任务
- AgentRunner 走真实 DSH Runtime
- Run 完成，任务进入 review
- RunStep 记录 `Runtime 执行：DSH DAG Runtime`

### 3. Runtime 检测状态持久化

修复 bug：

- `runtime.detect` 之前只返回检测结果，不更新数据库
- 导致 Runtime 列表、Agent Studio 选择器一直显示 unknown/unavailable

现在检测后持久化：

- executable
- version
- status

Agent Studio 可直接选择真实可用 Runtime。

### 4. 绝对路径 Runtime 检测

修复自定义 Runtime 使用绝对路径时被 `where.exe` 判为未安装的问题：

- 绝对路径存在时直接采用
- 不再强制走 PATH 查找

## 验证

```text
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 24 files / 113 tests passed
DAG Runtime E2E → PASS（真实 DSH Runtime）
package:win     → PASS
package-smoke   → PASS
```

## 产物

- Windows：`release/ProjectOS-1.6.0-portable.exe`
  `BD794998B25A7514A39C46D2C2FE728BC85A9E50CD57F1F6C9355203192B37DC`
- Linux：`release/ProjectOS-1.6.0-linux-x86_64.AppImage`
  `A9597B9E21FA44CAE14A3C4691A97B8959FA1DE203E606896B460E499C893D60`

## 仍未完成

- ACP Runtime 在 DAG 任务中执行超时（OpenCode ACP）；DSH CLI 已通过
- Runtime 任务的取消尚未中断子进程
- 工作流节点库 / 底部日志的高保真布局
- 41 张未确认设计图的逐页复核
