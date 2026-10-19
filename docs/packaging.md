# Windows 打包与直接运行

## 产物

当前已生成（Windows x64）：

| 产物 | 路径 | 说明 |
|---|---|---|
| 便携版 EXE | `release/ProjectOS-0.1.0-portable.exe` | 单文件，双击直接运行，无需安装 |
| 解包目录 | `release/win-unpacked/ProjectOS.exe` | 用于调试/冒烟测试 |

- 便携版大小约 **99.4 MB**。
- 未做数字签名；Windows SmartScreen 可能提示“未知发布者”，选择“更多信息 → 仍要运行”。
- 仅支持 Windows x64；macOS/Linux 需要对应构建。

SHA256：

```text
DA8D6EA7E04580BF63C049C1AADA4F8E2600D0173875B966EDDCCDA8DF3648F8  ProjectOS-0.1.0-portable.exe
```

## 运行

```text
双击 release\ProjectOS-0.1.0-portable.exe
```

默认数据目录：

```text
%APPDATA%\ProjectOS\data
```

项目文件放在你创建/选择的本地目录，不写入数据库。可通过环境变量覆盖数据目录：

```powershell
$env:PROJECTOS_DATA_DIR = "D:\ProjectOSData"
.\release\ProjectOS-0.1.0-portable.exe
```

首次启动没有示例项目；需要演示数据时设置 `PROJECTOS_SEED_DEMO=1`，或在项目中心点击“载入示例项目”。

## 打包结构

```text
ProjectOS-0.1.0-portable.exe
└─ 解包到临时目录（每次运行）
   ├─ ProjectOS.exe
   ├─ resources/app.asar          # Renderer + main/preload bundle
   └─ resources/runtime/index.mjs # 独立 Node Runtime bundle
```

- `app.asar` 只包含 `out/**`，不携带 `node_modules`：main/preload/renderer 已由 electron-vite
  bundle，Runtime 已由 tsup bundle。
- Runtime 通过 `extraResources` 放到 `resources/runtime/index.mjs`，Main 使用
  `process.resourcesPath` 定位。
- Pino 已打进 Runtime bundle，因此解包目录不需要 Node 依赖。
- `node:sqlite`、`node:fs`、`node:child_process` 使用 Electron 内置 Node。
- 便携版解包位置每次可能在 `%TEMP%\ProjectOS-0.1.0`，但业务数据始终在 `%APPDATA%\ProjectOS`。

## 重新打包

```bash
pnpm install
pnpm package:win       # build + electron-builder --win portable
# 或只生成解包目录，便于快速验证
pnpm package:dir
```

构建配置：`apps/desktop/electron-builder.yml`。  
关键点：

- `asar: true`
- `files` 仅 `out/**/*` + `package.json`，排除 sourcemap 与 node_modules
- `extraResources` 复制 `apps/runtime/dist/index.mjs` 到 `resources/runtime/index.mjs`
- `win.icon` 使用 `apps/desktop/resources/icon.ico`
- `npmRebuild: false`（无原生 addon）

## 验证

已实际运行：

```text
$ node scripts/package-smoke.mjs
PACKAGE SMOKE PASS — packaged EXE creates a project, writes starter files and recovers after restart.
  executable: ...\release\win-unpacked\ProjectOS.exe
  runtime: ...\release\win-unpacked\resources\runtime\index.mjs
```

还直接启动了便携版 EXE，确认：

- 进程正常启动，主窗口标题为 `ProjectOS`。
- Runtime 从 `%TEMP%\ProjectOS-0.1.0\resources\runtime\index.mjs` 启动。
- SQLite 迁移、示例种子、工作区文件写入成功。
- 无 `node_modules` 依赖。

## 未完成

- 未签名（无 Authenticode 证书），SmartScreen 可能拦截。
- 未做安装器（NSIS）、自动更新、卸载器、代码签名与 CI 发布。
- 未在干净 Windows 虚拟机验证；当前验证机已安装 Node/Electron，但打包产物不依赖它们。





























