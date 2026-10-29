# ADR-0046 — Reproducible multi-platform package builds

- Status: Accepted (Phase 2.8.8)
- Related: `docs/v2/Phase2_8_8_BUILD_MANIFEST.md`, `scripts/package-smoke.mjs`

## Context

用户要求"给我 Linux、Windows 系统编译成的执行打包"。仓库已有 Windows 打包脚本
（`package:win` → portable + NSIS，x64 与 ia32）与冒烟脚本（`scripts/package-smoke.mjs`），
但 Linux 只有 `scripts/package-linux.sh`，它假设在一台已经装好 Node/pnpm 的 Linux 主机上运行；
本机只有 WSL Ubuntu（无 Node、无 pnpm、无 X，15 GB 可用），而且此前没有把 Linux 产物的验证方式固定下来。

## Decision

把两个平台的可复现路径都写成脚本，并把"产物 + 校验值 + 验证结果"记成清单：

1. Windows：`pnpm package:win`（build → x64 → ia32 → `collect-win-artifacts.mjs`），
   `PROJECTOS_PACKAGE_DIR=release/win-x64/win-unpacked pnpm test:package` 做真实启动冒烟；
2. Linux：`scripts/p288-linux-build.sh` 在 WSL 内完成
   **装 Node 22 + corepack pnpm 9.15 → rsync 源码（排除 node_modules/release/out/.git）→
   `pnpm install --frozen-lockfile` → `pnpm build` → `electron-builder --linux AppImage` →
   sha256 → 回写 `release/linux/`**；
3. Linux 冒烟：`scripts/p288-linux-smoke.sh`，因为本环境没有 FUSE，先用 `--appimage-extract`
   展开，再在 `xvfb-run` 下启动 `squashfs-root/AppRun`，判定标准是"进程存活 + 数据目录出现
   `projectos.db`"；
4. 架构核对：安装器/便携包本身是 32 位 NSIS 存根，不能据此判断架构，改用 PE 头核对解包后的
   `ProjectOS.exe`（`scripts/p288-payload-arch.mjs`：0x8664=x64，0x14c=ia32）；
5. `scripts/p288-artifact-manifest.mjs` 输出每个产物的体积与 SHA-256，写入
   `docs/v2/Phase2_8_8_BUILD_MANIFEST.md`。

## Consequences

- 同一份源码与同一 `pnpm-lock.yaml` 能在两个平台产出可安装包，校验值可复核；
- Linux 构建不依赖手工步骤，脚本会自己准备 Node 与 pnpm；代价是首次运行要下载 Node 与整仓依赖；
- 仍没有代码签名，Windows 会提示"未知发布者"，Linux 无签名；
- Linux 的验证到"真实启动 + 数据库落盘"，**没有**窗口级点击断言（WSL 缺 dbus/X 栈）。

## Verification

见 `docs/v2/Phase2_8_8_BUILD_MANIFEST.md` 的"验证"表：Windows x64 打包冒烟 PASS、Linux 结构检查 PASS、
Linux Xvfb 启动 PASS（7 秒内建库）、ia32/ x64 载荷架构经 PE 头核对。
