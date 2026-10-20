# ProjectOS V1.6 — Harness 真实安装验证

日期：2026-10-20  
分支：`feature/v1.6-ux`

## 真实安装 E2E

通过 ProjectOS `runtime.install` 实际安装 Qwen Code：

```text
installing Qwen Code unavailable
install result available null 58s
REAL HARNESS INSTALL PASS Qwen Code available
```

验证：

- 扫描显示未安装
- 点击安装后执行受控 npm 全局安装
- 安装耗时约 58s
- 安装完成后自动重新检测
- 状态持久化为 available
- Agent Studio Runtime 选择器同步可用

脚本：`scripts/v16-harness-install-real-e2e.mjs`

## 安装保护

- Native Runtime 拒绝安装
- 仅允许 npm 白名单 Harness
- 不允许任意 shell 命令
- 180s 后端超时 / 240s IPC 超时
- DeepSeek Harness 为桌面应用，显示手动安装

## 验证

```text
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 24 files / 113 tests passed
Harness 安装 UI → PASS
Real install    → PASS（Qwen Code，58s）
package:win     → PASS
package-smoke   → PASS
```

## 产物

- Windows：`release/ProjectOS-1.6.0-portable.exe`
  `792142EA9D0785B84EA4DB0F97338660CCC5D1DA8A386039086EE3D43E0FF90F`
- Linux：`release/ProjectOS-1.6.0-linux-x86_64.AppImage`
  `52325FABDDA8AEAAB5A3BB1140C0D7B5F371B0A15BD629B73AE436A161A5E682`
