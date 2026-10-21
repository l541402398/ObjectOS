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

Agent 工作台新增 `计划群聊`。

实现方式：

- 计划批准时创建**一条真正的群聊 Session**
- 群聊参与者是计划内的全部 Agent
- 用户消息写入群聊，只出现一次
- `plan.discuss` 依次启动每个 Agent 在同一群聊 Session 中运行
- 每个 Agent 启动前读取群聊前文
- 每个 Agent 的回复以 `metadata.agentId` 标记发言者
- 消息读取层按 `metadata.agentId` 解析真实 Agent 名称
- 后续 Agent 能看到前面 Agent 的发言，再进行分析和回应
- 因此形成真实的多 Agent 头脑风暴，而不是把多个单 Agent 会话拼在一起

为避免并发写入导致上下文顺序混乱，群聊采用**顺序发言**：

```text
用户发言
  → Agent A 阅读前文并回复
  → Agent B 阅读 A 的回复并回应
  → Agent C 阅读 A/B 的回复并回应
  → ...
```

每个计划 Agent 仍保留自己的 `计划协作` 会话，用于任务执行和独立追踪；群聊 Session 只用于协作讨论。

截图：`docs/v1.7/plan-group-chat.png`

### 说明

`agentId` 覆盖只存在于 Runtime 内部调用，不暴露给 Renderer API；`run.start` 仍然只能运行 Session 绑定的 Agent。

真正多 Agent 同 Session 的持久化通过消息 `metadata.agentId` 实现，不新增数据库表，不破坏现有 Session/Run/审批/审计链路。

## 4. 验证

```text
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 25 files / 118 tests passed
Plan notification E2E → PASS
Plan sessions E2E     → PASS（4 个 Agent 会话）
Plan group chat E2E   → PASS（群聊 Session，4 参与者，用户消息仅 1 条）
package x64 / ia32    → PASS
package smoke x2      → PASS
```

## 5. 产物

- Windows x64 portable：`F7BBAF95C0737AD3D12EFF64F0B012DCC2B1B205F48E8D4005DE1EF7EF0751AA`
- Windows x64 setup：`95378BA7751F46FBF6F479D94EF6DABD141BEBABADFE65336BFA0DD8A6C23060`
- Windows ia32 portable：`55052F2566AF5EE5C86D901F7F58D20EB196B52A3669D05A2594028A0623C5D6`
- Windows ia32 setup：`70C9C708B3662256EBB86977D42A09C050719B74BBBD38B1FFDA128596EE3AEB`
- Linux AppImage：`647C9237575FB0687EFA8188B13284483ABA74C5DDDDDE08313219838DB154CE`
