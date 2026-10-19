# ProjectOS V1.4 实施计划

来源：`ProjectOS_V1.4_Implementation_Updated.md`  
前置条件：V1.1–V1.3 全量目标完成并推送到 GitHub 后启动。

## 用户指定的三项前置优化（已在 V1.3 收尾阶段完成）

| 项 | 状态 | 证据 |
|---|---|---|
| Agent 图跟随 Light/Dark，不再强制深色 | 完成 | 移除内层 dark ConfigProvider；Light/Dark 截图 |
| 项目图标改为原子图标 | 完成 | `icon.png` / `icon.ico` / `icon-512.png` / Tray 图标 |
| 编译 EXE 关闭窗口后驻留托盘 | 完成 | Tray 菜单；关闭隐藏；`scripts/tray-e2e.mjs` PASS |

## 当前进度

- 已完成：健康检查、Finding/Evidence、指纹去重、提案审批、运营工作台、模式持久化、重启恢复、软预算阻断。
- 已完成：修复结果回写、interval 持久化调度。`r`n- 已完成：AutomationGrant（授权/过期/撤销/次数）。`r`n- 已完成：完整成功路径 E2E（含真实 Worktree 与质量门禁）。`r`n- 已完成：风险矩阵、approved-autofix 自动提案/批准。`r`n- 已完成：approved-autofix 自动启动修复。`r`n- 已完成：项目事件触发（task blocked / run failed）。`r`n- 进行中：P1 集成、UI 可读性专项。
- 详见 [验收报告](./acceptance-report.md)。

## V1.4 P0

1. 健康检查：Git / build / test / lint / task blocked。
2. Evidence-backed Finding：来源、文件、时间、版本、严重度、置信度。
3. Fingerprint 去重与发生历史。
4. observe / propose / approved-autofix 策略，默认 observe。
5. 持久化调度：手动、间隔、项目事件；幂等、重试、取消、暂停、恢复。
6. 修复闭环：Finding → Proposal → Approval → Task DAG → Worktree → Developer → Tester/Reviewer → Result。
7. 自主运营工作台：监测、问题、执行链、审批、运行、成本、失败原因。

## P1

- Git hooks / CI 事件；依赖安全；版本/Changelog；预算与并发；趋势图。

## 验收

真实 Git 项目植入失败测试 → 健康检查证据 → 去重 Finding → 提案 → 授权 → Worktree 修复 → 真实测试/Review → 候选结果审批 → 重启恢复；未审批不得写主分支。

## 约束

- 默认 observe，不自动写主分支。
- 所有检查/修复走 V1.3 Policy、Approval、Run、Artifact 与 Worktree。
- 复用 V1.3 编排与图，不新建第二套运行时。









