# V1.5 验收报告（进行中）

## 已通过

```text
pnpm typecheck
pnpm lint
pnpm test              → 20 files / 106 tests
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

SHA256：`293ED9178649F15D7AF9403C9C71BB65C0EC62978772B1B7ABF6571BDFE0DD30` 

## 截图

- `docs/screenshots/1440x900-light-agent-studio.png`
- `docs/screenshots/1440x900-light-settings-runtime.png`
- 1024×768 对应截图`r`n- 共 50 张截图

## 未通过 / 阻塞

- RuntimeAdapter 真实执行未接线。
- 本机仅 Claude Code；按要求未执行真实 Claude 调用；OpenCode/Qwen/DSH 未安装。
- 因此“两种 Runtime 真实任务”验收阻塞。
- Skills 导入与执行注入未完成。
- ACP 安装/握手/会话未完成。

## 结论

V1.5 配置、发现、检测、UI 基座已落地；真实多 Runtime 执行尚未完成，不能宣称 V1.5 全量验收通过。

