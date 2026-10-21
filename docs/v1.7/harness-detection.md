# ProjectOS V1.7 — Harness 检测与状态隔离

## Harness 状态是否被写死

没有。

- Harness 状态保存在**每个用户自己的 SQLite** `runtime_profiles` 中。
- 应用包内没有 `projectos.db`。
- 默认种子只写入 `status: unknown`；ProjectOS Native 为 `available/embedded`。
- 每次 `runtime.list` 都会重新执行 `detect()`，检测结果再写回当前用户数据库。
- 本机安装的 Qwen Code 只影响本机用户数据，不会进入代码或安装包。
- 测试与截图使用独立 `PROJECTOS_DATA_DIR` 临时目录。

相关代码：

- `apps/runtime/src/agent-studio.ts`
- `apps/runtime/src/dispatcher.ts`（`runtime.list` 每次都 detect）
- `apps/runtime/src/executable-resolver.ts`

## 为什么 Ubuntu 扫描不到 Codex CLI

AppImage 从桌面启动时不会加载 shell 的 PATH。`codex` 可能安装在：

```text
~/.local/bin
~/.npm-global/bin
~/.nvm/versions/node/*/bin
~/.volta/bin
~/.bun/bin
~/.asdf/shims
/usr/local/bin
/snap/bin
```

而旧检测只调用 `which codex`，依赖当前进程 PATH，因此失败。

## 修复

新增 `resolveExecutable()`：

1. 检查显式绝对路径。
2. 扫描当前 PATH。
3. Windows 使用 `where.exe`。
4. 扫描常见用户级 bin 目录。
5. 扫描 nvm / fnm 的 Node 版本目录。
6. Linux/macOS 最后通过登录 shell 执行：

```bash
bash -lc 'command -v -- "$1"' projectos-resolve codex
```

这样即使 AppImage 没有继承 shell PATH，也能找到 Codex、Claude Code、Qwen、Gemini、OpenCode 等 CLI。

## 验证

```text
tests/executable-resolver.test.ts
  ✓ finds a CLI in PATH
  ✓ finds a CLI in ~/.local/bin when desktop PATH does not contain it
  ✓ finds an absolute executable and rejects a missing one
  ✓ returns null when no candidate exists

Test Files  25 passed
Tests       117 passed
```

## 仍无法识别时

在终端执行：

```bash
which codex
readlink -f "$(which codex)"
codex --version
```

如果 `which codex` 有输出但应用仍显示未安装，可在 Runtime 设置里编辑 Codex 的可执行路径为绝对路径。

前提是 `codex` 必须是真实可执行文件，而不是 shell alias/function。
