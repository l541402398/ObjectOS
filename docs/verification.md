# 实际验证记录

> 采样环境：Windows 11，Node `v24.22.0`，pnpm `9.15.0`，Electron `44.9.0`，  
> 工作目录：`C:\Users\Administrator\Desktop\workplace\ProjectOS`。

以下结果来自实际命令，不是设计目标。

## 1. 静态检查

```text
$ pnpm lint
...
✔ 0 errors, 0 warnings
Dependency boundaries OK (packages, runtime, renderer).
```

- 0 errors, 0 warnings。
- 包边界检查覆盖 contracts/domain/application/persistence/…/ui/ai-ui 与 Renderer 的
  `node:*` / `electron` / persistence 禁止规则。

```text
$ pnpm typecheck
tsc -p tsconfig.json --noEmit  # exit 0
```

## 2. 单元 / 集成 / 协议测试

```text
$ pnpm test
 RUN  v5.0.5

 ✓ tests/domain.test.ts               (9 tests)
 ✓ tests/persistence.test.ts          (5 tests)
 ✓ tests/application.test.ts          (5 tests)
 ✓ tests/agent-loop.test.ts           (4 tests)
 ✓ tests/provider.test.ts             (4 tests)
 ✓ tests/workspace.test.ts            (6 tests)
 ✓ tests/policy.test.ts               (5 tests)
 ✓ tests/recovery.test.ts             (2 tests)
 ✓ tests/demo.test.ts                 (1 test)
 ✓ tests/runtime-protocol.test.ts     (3 tests)
 ✓ tests/ai-connections.test.ts       (8 tests)
 ✓ tests/orchestration.test.ts        (5 tests)
 ✓ tests/worktree.test.ts             (2 tests)

 Test Files  17 passed (17)
      Tests  68 passed (68)
```

`runtime-protocol` 启动真实的 `tsx apps/runtime/src/main.ts` 子进程，验证握手、创建项目、
错误码、无 Provider 时消息落盘与 warning、优雅关闭与重启后的数据恢复。

## 3. 构建

```text
$ pnpm build
ESM apps/runtime/dist/index.mjs   ~1.39 MB（pino 已内联）
out/main/index.js
out/preload/index.js
out/renderer/...                 main bundle + lazy Monaco/Workspace chunk
✓ built
```

- Runtime bundle 使用 ESM + `createRequire` banner，保证 CJS 依赖（cross-spawn）与
  `node:sqlite` 在 Node/Electron-as-Node 下正常加载。
- Workspace/Monaco 为 lazy chunk，不阻塞首屏。

## 4. 桌面 E2E：创建项目 + 重启恢复（T-001）

```text
$ node scripts/e2e.mjs
E2E PASS — create project through the desktop UI and recover it after restart (T-001).
  project root: C:\Users\ADMINI~1\AppData\Local\Temp\projectos-e2e-g9op9S\my-project
```

验证点：

- 通过真实 UI 打开“新建项目”并填写表单。
- Runtime 写入 SQLite 与 starter 文件（README/AGENTS）。
- 关闭 Electron 后重新启动同一数据目录，项目卡片与项目总览恢复。
- 无 Renderer console error。

## 5. Agent E2E：审批暂停、写盘、恢复循环

```text
$ node scripts/agent-e2e.mjs
AGENT E2E PASS — real approval pause, approved write, resumed loop and completed run.
  provider requests: 2
  run: run_01m59xber15gg59t20ng46bg2f (completed)
```

验证点：

- 本地 fake OpenAI-compatible SSE server 返回文本 + `write_file` tool call。
- 写文件触发 Approval，Run 进入 `waiting_approval`。
- UI 显示授权卡片；点击“批准并继续”。
- Runtime 执行真实文件写入，ToolCall 完成，模型循环恢复并返回最终文本。
- Run 状态 `completed`、Approval 状态 `approved`、`agent-output.md` 内容正确。
- Renderer 无 console error。

## 6. 命令审批 E2E：真实 run_command

```text
$ node scripts/command-e2e.mjs
COMMAND E2E PASS — command approval pause, approved execution and completed tool call.
  provider requests: 2
  node: v24.22.0 (exit 0)
```

验证点：

- fake Provider 返回 `run_command` tool call（`node --version`）。
- 命令触发 Approval；UI 批准后由 Runtime 子进程的真实 cross-spawn 执行。
- `runs.get` 中 ToolCall 状态 `completed`，`result.exitCode === 0`，
  `result.stdout` 为 `v24.22.0`。
- 验证了构建后的 Runtime bundle（而非仅 tsx 源码）在 Windows 上执行 `.cmd`/可执行文件。

## 7. V1.2 E2E：连接中心与原生执行

```text
$ node scripts/v12-e2e.mjs
V1.2 E2E PASS — modal settings, connection CRUD/test/discovery, default sync, native run, restart, external detection and collapsed rail.
  connection: V1.2 E2E Connection (fake-second)
  stream requests: 1
```

验证点：

- 点击侧栏设置不改变路由，打开全局弹层。
- UI 创建连接，L1/L2/L3 测试通过，`/models` 同步两个模型，切换默认模型。
- 关闭弹层后发送消息，使用新默认连接完成真实流式 Agent 运行。
- 重启后连接、密钥、默认模型、运行历史恢复。
- 外部 Agent 检测返回 Claude Code 与 Codex 两项。
- 1440 显式折叠侧栏 76px，项目文字隐藏，无横向溢出。

## 8. V1.3 E2E：扫描、计划、图工作台

```text
$ node scripts/v13-e2e.mjs
V1.3 E2E PASS — scan, plan DAG approval, real graph projection, saved layout, inline connection editor and restart recovery.
  project: V1.3 RBAC Project
  stack: TypeScript/JavaScript / TypeScript · React / Vite / Electron / Ant Design / Monorepo
  plan: r1 · 4 tasks · approved
  graph: 10 nodes / 12 edges
```

验证点：扫描临时 TS 项目；生成/批准 4 任务 DAG；图节点/边来自真实任务与 Agent；
布局 620/40 重启恢复；设置中新增连接为内联视图（`.ant-modal .ant-modal` = 0）。

## 8.1 V1.3 编排 E2E：自动执行、用量、恢复

```text
$ node scripts/v13-orchestration-e2e.mjs
V1.3 ORCHESTRATION E2E PASS — 4-task plan auto-executed to done, usage recorded, state persisted.
  provider requests: 4
  usage: 4 runs / 240 input / 48 output tokens
  execution: completed · 4 runs
  quality reports: 2
  worktree: projectos/plan-... · merged yes
```

计划 start 后按依赖自动启动 4 个 Agent Run；Run 完成进入 review 并由编排器自动验收；
`ai_usage_records` 记录连接/模型/tokens；计划级 Git Worktree 隔离执行并生成 diff artifact；
主工作区干净时合并且 mergedAt 持久化；重启后 execution=completed 仍在。

## 9. 跨会话唤醒（手动集成脚本）

使用同样的 fake Provider，在本地 Electron 中：

1. 创建项目与两个会话。
2. `inbox.send` 带 `wake=true` 发送 `task.delegate`。
3. 等待接收方 Run 完成。

结果：

```text
sent delivered
inbox  [{ status: 'completed', type: 'task.delegate' }]
runs   [{ status: 'completed', agent: 'Kai', summary: '跨会话消息已收到，正在处理。' }]
messages [user '请处理这个跨会话任务', assistant '跨会话消息已收到，正在处理。']
provider requests: 1
```

说明：`delivered → accepted → completed` 状态真实变化，消息写入接收会话并触发真实运行。

## 10. 生命周期 UI

手动/脚本验证：

- 在总览点击“新增需求”，填写标题/正文/验收标准并创建。
- 点击“批准需求”，需求状态变为 `approved`。
- 点击“推进阶段”，门禁满足后从 `implementation` 推进到 `testing`。
- 无 Renderer error。

## 11. 截图验收

```text
$ node scripts/screenshots.mjs
...
SCREENSHOTS PASS — 43 images written to docs/screenshots
```

- 1440×900：项目中心、总览、任务、编排工作台、Agent、跨会话、工作区、运行审计、设置、
  内联连接编辑、模型目录、折叠侧栏（Light）；总览、任务、Agent、跨会话、工作区、设置、
  折叠侧栏（Dark）。
- 1024×768：同样覆盖编排工作台、设置弹层、内联连接编辑、模型目录与折叠侧栏。
- 每张截图检查页面横向溢出（`scrollWidth <= innerWidth + 1`）与空白文件大小；
  所有截图均通过，Renderer console error 为 0。
- 设置弹层截图等待动画结束，实测 1024 下 982×696，四周无裁切。

## 12. Windows 打包

```text
$ pnpm package:win
electron-builder 26.15.3
packaging win32 x64 electron=44.9.0
building target=portable file=release\ProjectOS-0.1.0-portable.exe
```

产物：

| 文件 | 大小 | 说明 |
|---|---:|---|
| `release/ProjectOS-0.1.0-portable.exe` | 99.4 MB | 单文件便携版，双击运行 |
| `release/win-unpacked/ProjectOS.exe` | - | 解包调试版 |
| `release/win-unpacked/resources/runtime/index.mjs` | 1.39 MB | 独立 Runtime bundle |
| `release/SHA256SUMS.txt` | - | SHA256 |

SHA256：

```text
37662CFD58930BC085E56CA11FA3CB939AAD10D4552095350F5EE407452DFD1A
```

- `app.asar` 只含 `out/**`，不含 node_modules。
- Pino 已打进 Runtime；`node:sqlite` 使用 Electron 内置 Node。
- 便携包未签名（`Get-AuthenticodeSignature` = `NotSigned`）。

## 13. 打包产物实机验证

```text
$ node scripts/package-smoke.mjs
PACKAGE SMOKE PASS — packaged EXE creates a project, writes starter files and recovers after restart.
  executable: ...\release\win-unpacked\ProjectOS.exe
  runtime: ...\release\win-unpacked\resources\runtime\index.mjs
```

便携版直接启动：

- 进程正常启动，主窗口标题为 `ProjectOS`。
- Runtime 从 `%TEMP%\ProjectOS-0.1.0\resources\runtime\index.mjs` 启动并 ready。
- SQLite 迁移成功，示例项目与真实工作区文件写入成功。
- 无 `node_modules` 依赖；不需要安装 Node/Electron。

## 14. 未运行 / 未验证

- 未调用真实付费云模型；使用本地 OpenAI-compatible fake server 验证协议与执行流程。
- 已生成未签名便携版；未做 NSIS 安装器、代码签名、自动更新、卸载与干净 Windows VM 验证。
- 未实现 OCS/Claude Code/Codex Driver；外部 Agent 只做安装/版本检测，不执行任务。
- 未实现角色/项目路由、费用/预算、Anthropic 原生协议。
- V1.3 仍未实现外部 Agent 执行、原生 Anthropic 协议、事件 seq 补齐、200 节点压测。
- 迁移回滚未做故障注入；旧配置迁移与 v2/v3 建表已实测。
- 符号链接越界测试因 Windows 权限未自动化；代码使用 realpath + 前缀校验，路径穿越已有测试。
- Supervisor 崩溃退避的故障注入 E2E 未自动化；Runtime 子进程协议重启测试已覆盖数据恢复。
- Outbox ACK 丢失重投未做故障注入；收件箱幂等已覆盖。



















































