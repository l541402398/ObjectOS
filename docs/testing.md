# 测试与验证矩阵

## 运行命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node scripts/e2e.mjs
node scripts/agent-e2e.mjs
node scripts/command-e2e.mjs
node scripts/v12-e2e.mjs
node scripts/v13-e2e.mjs
node scripts/v13-orchestration-e2e.mjs
node scripts/package-smoke.mjs   # 需先 pnpm package:dir
```

`test:e2e` / `test:agent` / `test:command` 会先重新 build 再执行。截图：

```bash
pnpm screenshots   # 构建后生成 1440x900 / 1024x768 的 Light/Dark 截图
```

> 这些 Electron 脚本需要桌面会话，并会移除 `ELECTRON_RUN_AS_NODE`，避免 Electron 以 Node 模式启动。

## 测试分层

| 层级 | 位置 | 覆盖 |
|---|---|---|
| Domain 单测 | `tests/domain.test.ts` | 任务/Run 状态机、DAG、完成门禁、阶段门禁 |
| Persistence | `tests/persistence.test.ts` | 迁移、乐观并发、事务回滚、Lease fencing、跨会话幂等 |
| Application | `tests/application.test.ts` | 项目、任务、生命周期推进、邮箱、Handoff |
| Provider | `tests/provider.test.ts` | SSE 文本/tool call 拼装、usage、鉴权、无 Key 错误 |
| Agent loop | `tests/agent-loop.test.ts` | 工具调用、审批暂停、失败、最大轮次 |
| Recovery | `tests/recovery.test.ts` | 崩溃后 needs_reconciliation、待审批保留、过期审批取消 |
| Workspace / Policy | `tests/workspace.test.ts`, `tests/policy.test.ts` | 路径穿越、只读命令、审批分类、脱敏 |
| Runtime 协议 | `tests/runtime-protocol.test.ts` | 真实子进程握手、请求、错误码、重启后数据恢复 |
| AI 连接/诊断 | `tests/ai-connections.test.ts` | 多连接默认唯一、模型、L1–L3、401/404 分类、发现 |
| 编排/扫描/图 | `tests/orchestration.test.ts` | 扫描、计划环检测、图投影、质量门禁 exit code |
| Electron E2E | `scripts/e2e.mjs` | UI 创建项目 → 关闭 → 重启恢复 |
| Electron Agent E2E | `scripts/agent-e2e.mjs` | 真实流式 Provider、审批暂停、批准写盘、恢复循环、Run 完成 |
| Electron Command E2E | `scripts/command-e2e.mjs` | 命令审批、真实 `run_command`、退出码/stdout/ToolCall 记录 |
| V1.2 E2E | `scripts/v12-e2e.mjs` | 设置弹层、连接 CRUD/测试/发现、默认同步、真实运行、重启、折叠侧栏 |
| V1.3 E2E | `scripts/v13-e2e.mjs` | 扫描、计划审批、真实图、布局持久化、内联连接编辑、重启 |
| Provider Responses | `tests/provider-responses.test.ts` | Responses SSE、function_call、usage、done |
| Worktree | `tests/worktree.test.ts` | 创建分支工作树、diff、脏主区拒绝合并、干净合并 |
| V1.3 编排 E2E | `scripts/v13-orchestration-e2e.mjs` | 4 任务自动执行到 done、质量门禁报告、用量记录、重启恢复 |
| Packaged EXE 冒烟 | `scripts/package-smoke.mjs` | `release/win-unpacked/ProjectOS.exe` 创建项目、写 starter、重启恢复 |

## 设计说明书测试矩阵对照

| ID | 场景 | 当前状态 | 证据 / 说明 |
|---|---|---|---|
| T-001 | 新建项目后重启 | 通过 | `scripts/e2e.mjs`：真实 Electron UI 创建 + 重启 |
| T-002 | 两个 Run 争抢同一 Task | 通过（仓储层） | `tests/persistence.test.ts` Lease fencing；运行层也检查 active run |
| T-003 | 环形任务依赖 | 通过 | `tests/domain.test.ts` + `tests/application.test.ts` |
| T-004 | Outbox 投递后 ACK 丢失 | 部分 | 收件箱幂等已测；Outbox 重投/ACK 模拟未自动化 |
| T-005 | Tool 已执行但结果未持久化时崩溃 | 通过（逻辑） | `tests/recovery.test.ts` 进入 needs_reconciliation；无自动重试 |
| T-006 | Runtime 中途退出 | 部分 | 子进程重启恢复数据已测；Supervisor 退避重启未做故障注入 E2E |
| T-007 | Renderer 未授权命令 | 部分 | 双边界 Zod + 白名单 + 包边界/渲染器检查；无恶意 Renderer 自动化 |
| T-008 | 路径穿越/符号链接越界 | 通过（路径穿越） | `tests/workspace.test.ts`；符号链接测试需 Windows 权限，未自动化 |
| T-009 | 外部 Agent 不支持 Checkpoint | 不适用 | 当前未实现外部 Driver；能力协商接口保留 |
| T-010 | 开发 → 测试 Handoff | 通过 | `tests/application.test.ts` 请求/接受/责任人更新 |
| T-011 | DB 迁移中断/校验 | 部分 | checksum 与事务迁移实现；中断注入未自动化 |
| T-012 | 不可信 Skill 请求 Shell | 通过（策略 + E2E） | `tests/policy.test.ts` 命令需审批；`scripts/command-e2e.mjs` 验证批准后真实执行与记录 |

## 实际结果（本机）

环境：Windows 11，Node 24.22.0，pnpm 9.15.0，Electron 44.9.0。

```text
pnpm lint      → 0 errors, 0 warnings
pnpm typecheck → pass (strict, noEmit)
pnpm test      → 27 files / 131 tests passed
pnpm build     → runtime bundle + Electron out/main, out/preload, out/renderer
e2e.mjs        → PASS (T-001)
agent-e2e.mjs  → PASS (approval + write + resume + completed, 2 provider requests)
command-e2e.mjs → PASS (approval + run_command exit 0 + stdout recorded)
v12-e2e.mjs    → PASS (modal settings + connection test/discovery + native run + restart + collapsed rail)
v13-e2e.mjs    → PASS (scan + plan DAG + real graph + layout persistence + inline connection editor)
package-smoke.mjs → PASS (packaged EXE create + starter files + restart)
```

V1.2 验收用例（AI-001–AI-014）见 [`docs/v1.2/acceptance-report.md`](v1.2/acceptance-report.md)。  
V1.3 验收用例（T01–T18）见 [`docs/v1.3/acceptance-report.md`](v1.3/acceptance-report.md)。

截图：`docs/screenshots/`（47 张，1440×900 与 1024×768，Light/Dark，含编排工作台、设置弹层、内联连接编辑与折叠侧栏）。

## 未覆盖 / 风险

- 未使用真实第三方模型 API 做付费调用；E2E 使用本地 OpenAI-compatible fake server，验证了
  协议与循环，但生产模型的限流、上下文长度、供应商差异仍需实际配置验证。
- 已生成未签名 Windows 便携包，并做打包冒烟；仍缺少 NSIS 安装器、代码签名、升级/回滚验证。
- 外部 Agent 已有执行器、Run 级 ToolCall 与 task lease；写模式要求隔离 Worktree。
  外部 CLI 内部工具调用仍无法逐工具观测，属于已知审计边界。
- 路由、费用、Anthropic 原生协议未实现，见 V1.2 验收报告。
- V1.3 仍未实现外部 Agent 执行、原生 Anthropic 协议、事件 seq 补齐、200 节点压测。
- Electron 崩溃重启的 UI 状态恢复有事件驱动刷新，但没有专门的故障注入 E2E。


























