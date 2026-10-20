# ProjectOS V1.6 — 用量价格页与全量截图

日期：2026-10-20  
分支：`feature/v1.6-ux`

## 新增：用量与价格

设置中心新增“用量与价格”：

- 真实 AgentRun usage
- Runs / Input tokens / Output tokens / 估算费用
- 按连接与模型聚合
- 模型价格列表
- 无 usage / 无价格时显示“未知/空”，不虚构费用

数据来源：

- `aiUsage.summary`
- `aiPricing.list`

## 全量截图重跑

```text
SCREENSHOTS PASS — 50 images written to docs/screenshots
```

覆盖：

- 1440×900 Light / Dark
- 1024×768 Light / Dark
- 项目中心、总览、任务、知识库、运营、编排、Agent、跨会话、工作区、审计、设置、连接编辑器、模型目录、路由、Runtime、Agent Studio

## DPI

```text
scale=1.25 dpr=1.25 overflow=0/0
scale=1.5  dpr=1.5  overflow=0/0
V1.5 DPI CHECK PASS
```

## 验证

```text
pnpm build      → PASS
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 24 files / 113 tests passed
screenshots     → PASS（50）
DPI 125/150     → PASS
package:win     → PASS
package-smoke   → PASS
```

## 产物

- Windows：`release/ProjectOS-1.6.0-portable.exe`
  `56F63204134E05F1C33A04250F47EEF3A43B354DE052868564431403C1C9FDA6`
- Linux：`release/ProjectOS-1.6.0-linux-x86_64.AppImage`
  `2B0BC89EED19BE7AE5FBC4F96E168E54C486B7EEE154821B5CB3A562DB134B97`

## 仍未完成

- 工作流节点库创建/拖入（后端目前没有任意节点类型模型）
- 模型详情、插件详情、第三方连接等剩余独立页
- 41 张新增稿逐页视觉确认
