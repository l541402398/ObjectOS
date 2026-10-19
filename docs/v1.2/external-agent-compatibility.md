# 外部 Agent 兼容矩阵

日期：2026-10-19  
约束：按用户要求，本机不执行 Claude Code / Anthropic 真实调用。

| CLI | 检测 | 执行命令 | 状态 |
|---|---|---|---|
| Claude Code 2.1.302 | `where claude` + `--version` | `claude --print --output-format stream-json --verbose --permission-mode plan/acceptEdits --allowedTools ... -- <prompt>` | 已实现，未实测 |
| Codex CLI | `where codex` | `codex exec --json --skip-git-repo-check --sandbox read-only/workspace-write -- <prompt>` | 已实现，CLI 未安装、未实测 |

## 隔离

- 只读：Claude Plan 模式 + Read/Glob/Grep，Codex `read-only` sandbox。
- 写模式：必须绑定已创建 Worktree 的计划；主工作区写模式被拒绝。
- 外部 CLI 的授权由其自身处理；ProjectOS 记录 Run、RunStep、事件与退出状态，不读取浏览器 Cookie，不注入 API Key。

## 未验证

- 真实 Claude Code 输出事件类型、退出码、取消进程树。
- Codex CLI 实际参数与 JSON 事件格式。
- 外部 CLI 的授权状态探测。
