# ProjectOS V1.7 — 计划确认、执行入口与计划群聊

日期：2026-10-20  
版本：`1.7.0`

## 1. 计划批准后的下一步

### 右下角通知

计划批准后不再只显示一条 message，而是弹出右下角玻璃通知：

- 标题：`计划已批准 · N 个任务`
- 说明：任务已创建，但不会自动执行
- 操作：`开始执行` / `查看任务`
- 常驻，直到用户处理

开始失败时：

- 右下角错误通知常驻
- 显示真实错误
- 提供 `打开运行审计`

截图：`docs/v1.7/plan-approved-notification.png`

### 编排工作台顶部横幅

只要存在“已批准但未执行”的计划：

- 显示计划已批准
- 显示任务数 / 计划节点数
- 提供 `开始执行` / `查看任务`

失败状态显示错误和 `重新执行`。

截图：`docs/v1.7/plan-next-step.png`

### 任务看板横幅

任务看板也会显示同一个下一步入口：

- 已批准未执行 → `开始执行`
- 执行失败 → `重新执行` / `运行审计`

避免用户只看到任务列表却不知道如何继续。

## 2. 为什么 Agent 工作台只有一个 Agent

原因：

- 计划批准只创建 Task，不创建 Session
- Session 是在编排执行 tick 启动任务时才创建
- 所以执行前 Agent 工作台只有项目启动会话

修复：

- 计划批准时，按计划 Agent 预创建 `计划协作 · <Agent> · r<revision>` 会话
- 写入该 Agent 负责的任务清单
- 编排执行启动任务时复用这些会话，不再重复创建
- 编排页在批准后刷新 sessions 查询

实测：

```text
plan { tasks: 4, roles: [architect, developer, reviewer, tester] }
newSessions 4
计划协作 · Sage · r1
计划协作 · Kai · r1
计划协作 · Nova · r1
计划协作 · Iris · r1
```

## 3. 计划群聊

Agent 工作台新增 `计划群聊`：

- 自动找到当前项目已批准计划的全部 `计划协作` 会话
- 顶部显示计划目标与参与 Agent
- 合并所有参与会话的消息，按时间排序
- 用户消息去重，只显示一次
- 输入一条消息，广播给计划内全部 Agent
- 每个 Agent 在自己的计划会话中响应，群聊聚合展示
- 每 4 秒刷新
- 未配置模型时保存消息并提示

截图：`docs/v1.7/plan-group-chat.png`

### 说明

现有数据库 `sessions` 是单 Agent 模型。V1.7 没有伪造一个新的多 Agent 表，而是：

- 每个计划 Agent 有真实独立会话
- 群聊是这些会话的聚合视图
- 用户消息真实广播到全部会话
- Agent 回复真实写入各自会话

这样不会破坏已有的 Session / Run / 审批 / 审计链路。

真正“多个 Agent 在同一条 Session 内互相看到上下文”需要新的 `session_participants` 与多 Agent 消息归属模型，属于下一阶段数据模型改造。

## 4. 验证

```text
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 25 files / 118 tests passed
Plan notification E2E → PASS
Plan sessions E2E     → PASS（4 个 Agent 会话）
Plan group chat E2E   → PASS（4 参与者，用户消息仅 1 条）
package x64 / ia32    → PASS
package smoke x2      → PASS
```

## 5. 产物

- Windows x64 portable：`F7BBAF95C0737AD3D12EFF64F0B012DCC2B1B205F48E8D4005DE1EF7EF0751AA`
- Windows x64 setup：`95378BA7751F46FBF6F479D94EF6DABD141BEBABADFE65336BFA0DD8A6C23060`
- Windows ia32 portable：`55052F2566AF5EE5C86D901F7F58D20EB196B52A3669D05A2594028A0623C5D6`
- Windows ia32 setup：`70C9C708B3662256EBB86977D42A09C050719B74BBBD38B1FFDA128596EE3AEB`
- Linux AppImage：`647C9237575FB0687EFA8188B13284483ABA74C5DDDDDE08313219838DB154CE`
