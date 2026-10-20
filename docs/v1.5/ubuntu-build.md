# Ubuntu 22.04 构建

## 产物

- `release/ProjectOS-0.1.0-linux-x86_64.AppImage`
- SHA256 记录在 `release/*.AppImage.sha256`

## 本机 WSL 构建

环境：

- WSL Ubuntu 22.04.5
- Node 22.20.0（Node 24 在该 WSL1 内核下无法执行）
- pnpm 9.15.0

步骤：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @projectos/desktop exec electron-builder --linux AppImage
```

AppImage 已在本机 WSL 实际构建成功。

## 常驻构建端

- 本地：`pnpm package:linux`
- CI：`.github/workflows/linux-build.yml`
  - GitHub Actions `ubuntu-22.04`
  - Node 22 + pnpm 9.15
  - 构建 AppImage 并上传 artifact
  - 支持手动触发与 `v*` tag

## 运行

AppImage 需要 Ubuntu 桌面环境（X11/Wayland）与 FUSE：

```bash
chmod +x ProjectOS-0.1.0-linux-x86_64.AppImage
./ProjectOS-0.1.0-linux-x86_64.AppImage
```

它不是纯终端 TUI；通过终端启动后会打开 Electron 桌面窗口。

无 FUSE 时可：

```bash
./ProjectOS-0.1.0-linux-x86_64.AppImage --appimage-extract-and-run
```

## 已知限制

- `.deb` 构建在 Windows/WSL 下因 fpm 下载长期挂起，未生成；CI 可继续补 deb target。
- 未在真实 Ubuntu 桌面会话中启动验证（仅构建产物与 ELF 校验）。
- 需要系统安装 `libfuse2`（Ubuntu 22.04）。
