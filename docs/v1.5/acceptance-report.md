# V1.5 验收报告（进行中）

## 已通过

```text
pnpm typecheck
pnpm lint
pnpm test              → 24 files / 113 tests
node scripts/v15-e2e.mjs → PASS
```

V1.5 E2E 覆盖：

- 自定义 Agent 创建
- Persona System Prompt 预览
- Runtime Profile 默认种子
- 自定义 CLI Runtime 检测（node --version）
- 重启后 Agent 持久化
- Agent 管理 UI 打开

## 包

SHA256：`F99082C1D87FD101636C6D8ECC780842580109D47DBF17047E01409CD5D1C7D0` 

## 截图

- `docs/screenshots/1440x900-light-agent-studio.png`
- `docs/screenshots/1440x900-light-settings-runtime.png`
- 1024×768 对应截图`r`n- 共 50 张截图

## 已实现执行适配

- 自定义 CLI Runtime 真实 spawn、参数数组、超时、取消、进程树清理
- 输出归一化为事件
- 单测用临时 Node Agent 完成一次真实执行
- 尚未接入 AgentRunner/AgentRun 快照与 UI 测试入口

## 未通过 / 阻塞

- RuntimeAdapter 真实执行未接线。
- 本机仅 Claude Code；按要求未执行真实 Claude 调用；OpenCode/Qwen/DSH 未安装。
- 因此“两种 Runtime 真实任务”验收阻塞。
- Skills 导入与执行注入未完成。
- ACP 安装/握手/会话未完成。

## 结论

V1.5 配置、发现、检测、UI 基座已落地；真实多 Runtime 执行尚未完成，不能宣称 V1.5 全量验收通过。



- Runtime 管理中心提供测试入口，可执行已配置 CLI 并显示输出


已新增 AgentDefinition.run：创建 Session/AgentRun、写消息、执行 Runtime、回写 completed/failed。


- Runtime 工作目录限制在项目根内；输出做密钥脱敏。
- skill.import 支持导入 SKILL.md 内容并版本固定。


- Runtime 执行前检查 Agent Shell 权限与项目软预算；未授权直接返回 APPROVAL_REQUIRED。
- 执行输出与事件脱敏，工作目录限制在项目根。


- CLI Runtime 在 Git 项目中自动创建 projectos/runtime-* Worktree 并返回 workspaceRef（尚未专项 E2E）。

Worktree 隔离已由 tests/runtime-worktree.test.ts 真实 Git 仓库验证。

ACP initialize + session/new JSON-RPC stdio 客户端及 fixture 测试已完成。

ACP 客户端现已支持 initialize、session/new、session/prompt、session/update 事件收集与 Runtime 管理中心测试。

ACP 会话现已接入 AgentRun，并由 tests/acp-client.test.ts 覆盖 Session/Run/消息/completed 全链路。


ACP Registry 条目可导入为不可用 ACP Runtime（registryId 去重，不宣称已安装）。

Runtime 管理中心已加入 ACP 可发现列表与导入按钮。

ACP authenticate 方法已接入客户端与 AgentStudio，并由 fixture 测试验证。

Runtime 管理中心为 ACP Profile 增加认证入口。

Runtime 管理中心支持删除自定义 Runtime。

AgentDefinition 支持 JSON 导出/导入（导入生成新 ID 与 v1）。

Agent 管理 UI 增加导出/导入入口。

RuntimeProfile 更新与删除由单测覆盖；设置页删除入口已存在。

Runtime 管理中心支持编辑自定义 Runtime 的名称与可执行路径。

已安装 OpenCode 1.19.3；DSH CLI 0.2.1-rc.2 路径探测成功。DSH/OpenCode 启动参数已内置：dsh headless / opencode run。


## 两种 Runtime 真实执行（2026-10-20）

`scripts/v15-real-e2e.mjs` 使用真实 DeepSeek API Key 执行：

```text
DSH Real Agent      → completed · 12 chars · exe_...
OpenCode Real Agent → completed · 4268 chars · acp-run_...
```

- DSH：`dsh.cmd headless`，DEEPSEEK_API_KEY 环境注入
- OpenCode：`opencode acp`，ACP initialize/session/prompt
- 两者均通过 ProjectOS AgentRun，写入 Session、消息、Run 状态
- OpenCode 需要 `~/.config/opencode/opencode.json` 指定 `model: deepseek/deepseek-flash`

运行方式：

```powershell
$env:DEEPSEEK_API_KEY='<key>'
node scripts/v15-real-e2e.mjs
```

注意：不要把真实 Key 写入仓库或日志。

Runtime 管理中心 ACP Registry 导入增加确认弹层；不执行安装脚本。ACP permission request 默认拒绝并记录事件。


## DPI 复核

scripts/v15-dpi-check.mjs 在 125% 与 150% 缩放下检查：

- dpr=1.25 / 1.5
- 项目总览与 Agent 工作台横向 overflow=0
- 截图：docs/screenshots/dpi-1.25-*.png、dpi-1.5-*.png

ACP permission request 现按 Agent 的 files/shell/network 权限自动批准或拒绝，并记录事件。
