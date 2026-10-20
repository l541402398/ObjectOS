# V1.5 验收报告（进行中）

## 已通过

```text
pnpm typecheck
pnpm lint
pnpm test              → 22 files / 109 tests
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

SHA256：`11B1A57D2079B2C3863D7BD2F4063D6C80288F3EC733A7BDC4B3EE2B30C53ABB` 

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
