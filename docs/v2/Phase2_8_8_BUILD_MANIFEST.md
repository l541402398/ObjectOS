# Phase 2.8.8 桌面安装包（Windows / Linux）

- 源码：分支 `v2.0-phase2.8.8` @ `a224e8e`（基线 `v2.0-phase2.8.7` @ `5d4a538`）
- 构建时间：2026-10-28 22:05–22:20（-07:00）
- Windows 构建主机：本机 Windows（electron-builder，Electron 43.8.2）
- Linux 构建环境：WSL Ubuntu 22.04.5，Node v22.14.0 + pnpm 9.15.0，`electron-builder --linux AppImage`
- 未签名：没有代码签名证书（Windows 显示"未知发布者"；Linux AppImage 未签名）

## 交付文件

| 平台 | 文件（相对 `release/`） | 大小 | 架构 | SHA-256 |
|---|---|---|---|---|
| Windows x64 | `ProjectOS-1.7.0-win-x64-portable.exe` | 94.1 MB | 载荷 x64（安装器为 32 位 NSIS 存根） | `5cd8bf85181703249318e67befbc3b06702fc86cb636314d54c3d93c60497ccd` |
| Windows x64 | `ProjectOS-1.7.0-win-x64-setup.exe` | 94.4 MB | 载荷 x64 | `d5d0e6d22c4896edd8f77a51a98d275d01cb7fb8ffa66e1bad82e84cd3f6821b` |
| Windows ia32 | `ProjectOS-1.7.0-win-ia32-portable.exe` | 83.2 MB | ia32 | `e574d84e005c2ef4e11b9ddb8485d315103972bcd375160551a34fd3cd15a840` |
| Windows ia32 | `ProjectOS-1.7.0-win-ia32-setup.exe` | 83.4 MB | ia32 | `91573c54566e4d1db2c74601917786239c4b55f2bcdf7620073c165055a96ece` |
| Linux x64 | `linux/ProjectOS-1.7.0-linux-x86_64.AppImage` | 130.8 MB | linux-x64 | `b6a45292f22fbb58161a323611e904da04543ada830226b7b7e03674faf8bb35` |

未打包的 Windows 目录版（可用于排查）：
`release/win-x64/win-unpacked/ProjectOS.exe`（PE 机器类型 **x64**，app.asar 33.5 MB）、
`release/win-ia32/win-ia32-unpacked/ProjectOS.exe`（**ia32**，app.asar 33.5 MB）。

> 注：Windows 安装器/便携包本身是 32 位 NSIS 存根（electron-builder 的默认做法），
> 判断架构要看解包后的载荷：已用 PE 头核对 `win-unpacked/ProjectOS.exe` = x64、`win-ia32-unpacked/ProjectOS.exe` = ia32。

## 验证

| 检查 | 结果 |
|---|---|
| Windows x64 打包冒烟（真实启动、建项目、写起始文件、重启恢复） | **PASS**：`node scripts/package-smoke.mjs`（`PROJECTOS_PACKAGE_DIR=release/win-x64/win-unpacked`） |
| Windows ia32 产物存在且载荷为 ia32 | PASS（PE 头核对） |
| Linux AppImage 结构 | PASS：`AppRun`、`ProjectOS.desktop`、`ProjectOS` 可执行、`resources/app.asar`(35.1 MB)、`resources/runtime` 齐全 |
| Linux AppImage 真实启动（Xvfb 无头） | **PASS**：进程存活，7 秒内创建 `projectos.db` + WAL；日志仅 dbus/udev 告警（WSL 无系统总线） |
| Linux 窗口级 UI 点击断言 | **未验证**：WSL Xvfb 下没有完整 dbus/X 栈，Playwright 窗口交互不稳定；建议在真实桌面发行版复测 |

## 复现命令

Windows（本机）：

```bash
pnpm package:win        # build + x64 + ia32 + 收集到 release/
pnpm test:package       # 打包冒烟（默认 release/win-unpacked）
PROJECTOS_PACKAGE_DIR=release/win-x64/win-unpacked pnpm test:package
```

Linux（WSL Ubuntu）：

```bash
wsl -d Ubuntu -- bash scripts/p288-linux-build.sh   # 装 Node、同步源码、install/build/AppImage，产物回写 release/linux
wsl -d Ubuntu -- bash scripts/p288-linux-smoke.sh   # Xvfb 下真实启动冒烟
```

## 已知限制

1. 未签名（Windows SmartScreen 可能拦截；Linux 无签名）。
2. Linux 包在 WSL 构建，未在真实 Ubuntu 桌面（GNOME/KDE）做过窗口级交互验收。
3. AppImage 未做 FUSE 挂载运行验证（本环境无 FUSE，用 `--appimage-extract` + `AppRun` 启动）。
4. 三轮构建（win-x64 / win-ia32 / linux）使用同一份源码与同一 `pnpm-lock.yaml`。
