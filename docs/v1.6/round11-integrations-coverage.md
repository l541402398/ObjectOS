# ProjectOS V1.6 — 第三方连接与设计覆盖

日期：2026-10-20  
分支：`feature/v1.6-ux`

## 新增第三方连接页

真实展示：

- AI Provider 连接与已保存 Key 数量
- 可用 Runtime / Harness 数量
- 外部 Agent 安装数量
- 代码托管集成：明确未连接

不伪造已连接状态。

## 设计图覆盖

新增 `docs/v1.6/design-coverage.md`：

- 53 项设计逐项映射
- 大多数页面 ✅ 真实实现
- 工作流节点创建、OpenSpec、网络代理为明确边界/◐/○

## 验证

```text
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 24 files / 113 tests passed
package:win     → PASS
package-smoke   → PASS
```

## 产物

- Windows：`release/ProjectOS-1.6.0-portable.exe`
  `00887583A84C94FF97F197578A6EB4004DE5BD501C39DACD7665C5FB921A2A4D`
- Linux：`release/ProjectOS-1.6.0-linux-x86_64.AppImage`
  `3335518B0ECF6C4BCF1D92F4AC6F14FA78EA8EBD7798B2E29BD228BFE8AD9102`

## 仍未完成

- 工作流节点库任意创建（架构上当前为任务/依赖投影）
- OpenSpec 真实集成
- 网络代理独立设置
