# ProjectOS V1.6 — 计划节点编辑与最终收口

日期：2026-10-20  
分支：`feature/v1.6-ux`

## 1. 工作流计划节点编辑

在计划弹窗中新增：

- 添加任务节点
- 删除任务节点
- 编辑任务标题 / 角色
- 编辑前置依赖
- 真实 plans.update + approve 创建任务 DAG

这不是客户端伪造图：节点仍保存为 PlanDraft tasks，批准时由后端事务创建真实 Task 与依赖。

## 2. 设计覆盖更新

- 25 新建工作流：从 ◐ 提升为 ✅（计划节点可增删）
- 33 OpenSpec：明确未集成
- 35 网络代理：只读说明系统代理

## 3. 最终验证

```text
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 24 files / 113 tests passed
package:win     → PASS
package-smoke   → PASS
screenshots     → 50 张
DPI 125/150     → PASS
Runtime 选择器  → PASS
快速指派 E2E    → PASS
整列拖放 E2E    → PASS
Runtime 取消 E2E→ PASS
DSH DAG Runtime → PASS
OpenCode ACP DAG→ PASS
```

## 4. 产物

- Windows：`release/ProjectOS-1.6.0-portable.exe`
  `F3D7289E7E6BF667205CEDB83412422C52C24F56534F6F9C11B8FB51556E61DA`
- Linux：`release/ProjectOS-1.6.0-linux-x86_64.AppImage`
  `DA0F054840417AC5B0C985925BBF0CA0EE5F91EC58EF988CE9EB8D66ECA EAD7C`

## 5. 明确边界

- OpenSpec：未集成本机 CLI，不注册为 Runtime
- 网络代理：应用级代理设置未实现，当前使用系统代理
- 41 张新增稿：已实现覆盖矩阵中标注的页面，其余以边界说明为准
