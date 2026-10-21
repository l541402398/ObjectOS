# ProjectOS V1.7 — ACP 回复显示原始 JSON 修复

日期：2026-10-21

## 问题

Agent 使用 ACP Runtime 时，聊天回复显示为：

```json
{"stopReason":"end_turn","usage":{"inputTokens":505,...}}
```

## 根因

`AcpClient.prompt()` 返回的是 JSON-RPC `session/prompt` 的结果对象，只包含：

- `stopReason`
- `usage`
- `_meta`

真正的语言回复通过 ACP 的 `session/update` 通知逐块返回：

```json
{
  "method": "session/update",
  "params": {
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": { "type": "text", "text": "..." }
    }
  }
}
```

原实现忽略了这些通知，直接 `JSON.stringify(result)` 写入 assistant message。

## 修复

- 新增 ACP 文本提取器：
  - `acpTextFromEvent`
  - `acpTextFromEvents`
  - `acpTextFromResult`
- 只提取 `agent_message_chunk` / `agent_message` 的可见文本
- 不把 `agent_thought_chunk`、工具调用、usage 当作回复
- `AgentRunner` 与 `RuntimeRunService` 都改为累加文本块
- 无文本时显示明确提示，不再回退到原始 JSON
- ACP 原始 result 仅写入 RunStep 元数据，不进入聊天正文

## 验证

```text
ACP fixture:
  session/update agent_message_chunk "hello"
  assistant message content === "hello"
  PASS

pnpm typecheck → PASS
pnpm lint → PASS
pnpm test → 26 files / 121 tests passed
package x64/ia32 → PASS
package smoke x2 → PASS
```

## 注意

旧版本已经写入数据库的 JSON 消息不会自动改写；更新后重新发起 Run 即显示正常语言回复。

## 产物哈希

```text
801043B972DE6EE115F714CBC0748AD9238485260D8979223FF28693939011B2  ProjectOS-1.7.0-win-x64-portable.exe
B25FD3D64E0D6F82253B28F42C608D81774A7ABABF628AD63A0A8BB307F2BDF4  ProjectOS-1.7.0-win-x64-setup.exe
602ABDA72F1C76B1B419C86232813C42423E4CF980A4ABABF779A77A77232DDF  ProjectOS-1.7.0-win-ia32-portable.exe
8EDFCB279CE23FEC1A9B37A155528EE5E097E296D0FC1763E7746D34EFDA0778  ProjectOS-1.7.0-win-ia32-setup.exe
C2AAB204C98FF80C7B24183C5024D60F1969C7D546C99CF61347612E7FFD464B  ProjectOS-1.7.0-linux-x86_64.AppImage
```
