# ADR-0003：类型化 Preload + Zod 双边界校验

- 状态：已接受
- 日期：2026-10-19

## 背景

Electron 安全要求 Renderer 不直接访问 Node。常见反模式是暴露
`invoke(channel: string, ...args: any[])`，这会让被攻破的 Renderer 调用任意 IPC。

## 决策

- Preload 仅暴露 `ProjectOSDesktopApi` 中的命名方法，内部统一调用一个固定 channel。
- Main 维护 `ApiSchemas` 方法白名单，并再次用 Zod 校验参数。
- Runtime 对同一输入再校验一次；不信任 Main 的单次校验。
- 返回结构化 `{ code, message, details, retryable }` 错误。
- Renderer 不允许 `node:*`、`electron`、`persistence`、`workspace` 导入；由
  `scripts/check-boundaries.mjs` 强制。
- Provider API Key 不进入 Renderer；设置更新只传 key 给 Main，Main 用 `safeStorage` 持久化。

## 后果

- 新增 API 需要同时更新 contracts、Main 白名单/处理和 Runtime dispatcher。
- 强类型和可测试的契约减少跨边界漂移；代价是少量样板代码。
