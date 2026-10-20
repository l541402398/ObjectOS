# ProjectOS V1.6 — Harness 安装能力

日期：2026-10-20  
分支：`feature/v1.6-ux`

## 1. 扫描后状态

运行时页和 Agent Studio 现在使用真实检测并持久化：

- 已安装 → 已安装 / 可用 + 版本
- 未安装 → 未安装 / 不可用
- 未检测 → 未检测

已安装的 Harness 不再显示“未安装”。

## 2. 未安装 Harness 的安装按钮

新增 `runtime.install` API：

- 输入 profileId
- 后端按 adapterId 使用受控 npm 包白名单
- 不允许任意 shell 命令
- 安装完成后自动重新检测并持久化状态
- 180s 超时
- 失败返回 npm 输出尾部

支持自动安装：

| Harness | npm 包 |
|---|---|
| Claude Code | `@anthropic-ai/claude-code` |
| Codex CLI | `@openai/codex` |
| OpenCode | `opencode-ai` |
| Qwen Code | `@qwen-code/qwen-code` |
| Gemini CLI | `@google/gemini-cli` |

DeepSeek Harness 显示“手动安装”，因为它是桌面应用，不是 npm CLI。

## 3. UI

- 未安装且可自动安装：显示“安装”按钮
- 点击后确认弹层：
  - 需要网络
  - 执行 npm 全局安装
  - 完成后自动检测
- 安装中显示 loading
- Native Runtime 不能安装
- 安装成功后状态变更为已安装/可用
- Agent Studio 运行环境页同步新状态

截图：`docs/v1.6/settings-runtime-install.png`

## 4. 验证

```text
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 24 files / 113 tests passed
Runtime 选择器  → PASS
Harness 安装 UI → PASS
Native 安装保护 → PASS
package:win     → PASS
package-smoke   → PASS
```

E2E：

```text
HARNESS INSTALL UI PASS native-guard=ok Codex CLI install-button=1
```

## 5. 产物

- Windows：`release/ProjectOS-1.6.0-portable.exe`
  `792142EA9D0785B84EA4DB0F97338660CCC5D1DA8A386039086EE3D43E0FF90F`
- Linux：`release/ProjectOS-1.6.0-linux-x86_64.AppImage`
  `52325FABDDA8AEAAB5A3BB1140C0D7B5F371B0A15BD629B73AE436A161A5E682`
