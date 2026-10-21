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

## 修复：Ubuntu 与 Windows 都覆盖

新增 `resolveExecutable()`，不是只依赖 `which` / `where`。

### Ubuntu / macOS

1. 显式绝对路径。
2. 当前 PATH。
3. 常见用户目录：
   - `~/.local/bin`
   - `~/.npm-global/bin`
   - `~/.npm/bin`
   - `~/.volta/bin`
   - `~/.bun/bin`
   - `~/.cargo/bin`
   - `~/.asdf/shims`
   - `~/.local/share/pnpm`
   - `~/Library/pnpm`（macOS）
4. 系统目录：
   - `/usr/local/bin`
   - `/usr/bin`
   - `/snap/bin`
   - `/opt/homebrew/bin`（macOS）
   - `/home/linuxbrew/.linuxbrew/bin`
5. nvm / fnm 的 Node 版本目录。
6. 登录 shell 兜底：

```bash
bash -lc 'command -v -- "$1"' projectos-resolve codex
```

### Windows

1. 当前 PATH，并按 `PATHEXT` 尝试：
   - `.COM`
   - `.EXE`
   - `.BAT`
   - `.CMD`
2. `where.exe`。
3. 常见安装位置：
   - `%APPDATA%\npm`（npm 全局，Codex / Claude / Qwen / Gemini）
   - `%LOCALAPPDATA%\pnpm`
   - `%LOCALAPPDATA%\Volta\bin`
   - `%LOCALAPPDATA%\Microsoft\WindowsApps`
   - `%USERPROFILE%\scoop\shims`
   - `%ProgramData%\chocolatey\bin`
   - `%USERPROFILE%\.local\bin`
   - `%USERPROFILE%\.bun\bin`
4. nvm-windows：
   - `%NVM_HOME%`
   - `%APPDATA%\nvm`
5. fnm：
   - `%APPDATA%\fnm\node-versions`
6. DeepSeek Harness 仍保留 `%LOCALAPPDATA%\Programs\DeepSeek Harness\...` 专用回退。

这样即使用户从桌面双击、没有终端 PATH，Windows 的 `codex.cmd` / `claude.cmd` 也能被找到。

## 验证

```text
tests/executable-resolver.test.ts
  ✓ finds a CLI in ~/.local/bin when desktop PATH does not contain it
  ✓ finds Codex in the Windows npm global prefix without PATH
  ✓ finds a Windows .cmd variant in PATH
  ✓ finds an absolute executable and rejects a missing one
  ✓ returns null when no candidate exists

Test Files  25 passed
Tests       118 passed
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


## DeepSeek Harness 的“假已安装”问题

如果 `~/.local/bin/dsh` 存在，但执行 `dsh --version` 返回：

```text
dsh: could not locate the @deepseek-ai/dsh installation
```

说明 `dsh` 只是一个启动 shim，真正的 npm 包已丢失或不完整。

现在检测逻辑会识别：

```text
could not locate
Cannot find module
MODULE_NOT_FOUND
ENOENT
```

并标记为：

```text
安装不完整：dsh: could not locate the @deepseek-ai/dsh installation
```

不会再显示“可用”。

### 修复

```bash
npm install -g @deepseek-ai/dsh
```

如果原来的 `dsh` 安装在 `~/.local/bin`，使用同一前缀：

```bash
npm install -g --prefix ~/.local @deepseek-ai/dsh
```

然后：

1. 设置 → 运行时 → 检测环境
2. DeepSeek Harness 应显示“可用”
3. 点击“测试”，系统自动执行真实测试

DeepSeek Harness 已加入自动安装白名单：

```text
@deepseek-ai/dsh
```

安装完成后会自动重新检测。
