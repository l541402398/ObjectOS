# ADR-0007：Windows 便携版打包与资源布局

- 状态：已接受
- 日期：2026-10-19

## 背景

需要一个用户可以直接双击运行的 Windows 产物。项目包含 Electron 桌面端与独立 Node Runtime；
Runtime 不能被塞进 asar 中启动，否则 `process.execPath` 的 Node 模式与路径语义会变得复杂。

## 决策

- 使用 `electron-builder` 生成 **portable** Windows x64 单文件 EXE。
- 桌面端 main/preload/renderer 由 electron-vite 完整 bundle，`files` 不携带 `node_modules`。
- Runtime 由 tsup bundle 到单文件，通过 `extraResources` 复制到
  `resources/runtime/index.mjs`；Main 用 `process.resourcesPath` 定位。
- Pino 打进 Runtime bundle，避免解包后 Node 解析外部依赖。
- 使用 `asar: true`；不做原生 addon 重建（SQLite 使用 Electron 内置 `node:sqlite`）。
- 使用自绘品牌图标，`requestedExecutionLevel: asInvoker`，不请求管理员权限。
- 暂不签名；在文档中明确 SmartScreen 风险。

## 后果

- 单文件约 99 MB，双击即用，不依赖用户安装 Node/Electron。
- 无法热更新；更新需要替换 EXE。
- 未签名会触发 SmartScreen 警告；正式分发应购买代码签名证书并增加 NSIS 安装器/自动更新。
- 便携版业务数据仍写入 `%APPDATA%\ProjectOS`，并非“数据随身携带”的完全便携模式；可用
  `PROJECTOS_DATA_DIR` 覆盖。
