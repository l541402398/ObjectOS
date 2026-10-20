# ProjectOS V1.6 — ACP DAG、运行日志与剩余页面推进

日期：2026-10-20  
分支：`feature/v1.6-ux`

## 1. OpenCode ACP DAG 超时修复

- ACP `session/prompt` 超时从 120s 提升到 300s
- 重新验证 OpenCode ACP 真实任务链

```text
runtime OpenCode ACP DAG Runtime acp available
status completed taskStatus review steps 4
DAG RUNTIME EXECUTION PASS
```

此前 DSH CLI 任务链也已通过，现在 DAG 同时支持 DSH CLI 与 OpenCode ACP。

## 2. Runtime 任务取消

- CLI 记录 executionId 并 killTree
- ACP 取消时 dispose 客户端
- Run → cancelled
- Task → ready
- Attempt → cancelled

```text
status cancelled taskStatus ready
RUNTIME CANCEL PASS
```

## 3. 工作流页面增强

新增：

- 节点类型筛选：全部 / 总控 / Agent / Task
- 真实项目事件运行日志
- 最近 8 条事件
- 跳转运行审计

截图：`docs/v1.6/pages/orchestration.png`

## 4. 通知中心

新增 `/notifications`：

- 真实待审批
- 真实最近活动
- 审批中心跳转

截图：`docs/v1.6/pages/notifications.png`

## 5. 其他页面

- 项目设置
- 项目健康
- 资源中心
- 审批中心

均已接入真实 IPC 数据。

## 6. 验证

```text
pnpm typecheck   → PASS
pnpm lint        → PASS
pnpm test        → 24 files / 113 tests passed
Runtime 选择器   → PASS
快速指派 E2E     → PASS
整列拖放 E2E     → PASS
Runtime 取消 E2E → PASS
DSH DAG Runtime  → PASS
OpenCode ACP DAG → PASS
package:win      → PASS
package-smoke    → PASS
```

## 7. 产物

- Windows：`release/ProjectOS-1.6.0-portable.exe`
  `4B371FA87F3BFA64C8B22A9BAFD655A2B398ABD1E88E13864446F57C057A5B58`
- Linux：`release/ProjectOS-1.6.0-linux-x86_64.AppImage`
  `137894BDC69DD1993EA622B20E7AC36D5374E25F8905D9AC7B161908BFB9D6C6`

## 8. 仍未完成

- 工作流节点库创建交互（当前为真实筛选，不是任意节点创建）
- 工具权限、存储、网络、安全、快捷键、导入项目等剩余独立页
- 41 张新增稿逐页视觉确认
