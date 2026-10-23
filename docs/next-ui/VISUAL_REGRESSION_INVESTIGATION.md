# ProjectOS Next UI — 视觉基线纠正与回归调查

日期：2026-10-22  
状态：**已停止 UI 修改；等待用户确认具体回归页面**  
当前分支：`feature/projectos-next-ui-full-migration`  
当前 HEAD：`98557bc`（正式页任务清单修正）；Design Lab 认可版本仍为 `10d84f4`  
已认可基线：`10d84f4` / tag `visual-baseline-approved-icons-10d84f4`  
未合并 stable

## 1. 先纠正上一轮的错误结论

上一轮我把 `0686c41`（图标下有阶段名称、说明、任务数）误认为用户认可的版本，
并准备按那个版本恢复。用户已明确指出：

> 昨天认可的是图标上没有文字的这一版。

因此：

- **已认可版本 = icon-only 版本**。
- `0686c41` 的标签版是**被排除的候选**，不是 approved baseline。
- 之前关于“`8c4e578` 删除阶段文案导致视觉回归”的结论**不成立**。
- 已删除错误 tag `visual-baseline-approved-0686c41`。
- 新建正确 tag：`visual-baseline-approved-icons-10d84f4` @ `10d84f4`。
- 恢复 Worktree `ProjectOS-visual-baseline-0686c41` 保留但标记为**废弃候选**，
  不得用于覆盖当前 Design Lab。

## 2. 当前 Design Lab 与用户认可图一致

用户提供的 icon-only 截图与当前 `#/design-lab` 的截图一致：

- 四个阶段图标
- 无图下文字
- 平滑曲线
- 任务序列 + readiness 面板

证据：

```text
docs/next-ui/visual-regression/current-10d84f4.png
```

因此 **Design Lab 的阶段路线不是本次回归点**。

## 3. 已确认的真正问题

用户认可的是 **Design Lab 路由 `#/design-lab`**，不是正式 Plan Review Dialog。
当前正式页面虽然也用了 icon-only 路线，但整体不是同一界面：

- 顶部出现 `PLAN REVIEW · R1` 和版本列；用户认可版没有 R1。
- 指标是“任务 / 阶段 / 待复核 / 版本”；用户认可版是“工作项 / 阶段 / 待复核”。
- 列表标题是“任务清单”；用户认可版是 `TASK SEQUENCE` + “准备审核的工作”。
- 正式页用 12.5px 紧凑字体；Design Lab 用更大的标题和任务字号。
- 正式页装在业务 DialogShell 中；Design Lab 是完整工作台布局。

因此：**不是 Design Lab 被改坏，而是正式业务页从未按 Design Lab 实现，却被错误地称为“已迁移/已认可”。**

另外两个可能因素：

1. 全局 `next-ui-app.css` 对正式页面统一覆盖，削弱页面个性。
2. 旧包/旧实例被单实例锁拉到前台，造成“新包没生效”的错觉。

## 4. 当前状态保护

### 当前分支

```text
feature/projectos-next-ui-full-migration @ 10d84f4
```

工作区当前只包含本轮调查文档、基线截图和 `AGENTS.md` 规则更新；
没有新的业务页面代码改动。

### 已保存的未完成修复

```text
backup/next-ui-before-restore-20261022 @ ef7bfee
```

包含：

- `StageJourney` tooltip 改动
- `PremiumDependencyEdge.tsx`
- `next-ui-app.css` 调整
- `PlanReviewNext` 与剩余问题文档改动

### 外部备份

```text
C:\Users\Administrator\Desktop\workplace\_projectos-next-ui-pre-restore-20261022
```

- `next-ui-all-branches.bundle`（483 MB）
- `uncommitted-worktree.patch`
- `history-80.txt`
- `reflog-80.txt`
- `package-sha256.txt`

未保存任何数据库、API Key、Token 或用户凭据。

### 未执行

- 未执行 `git reset --hard`
- 未执行 `git clean -fd`
- 未强制覆盖文件
- 未强制推送
- 未合并 stable
- 未删除分支或 Worktree

## 5. 候选 Commit 结论

| Commit | 内容 | 结论 |
|---|---|---|
| `0686c41` | Design Lab 标签版（图标下有文字） | **废弃候选**，不是用户认可版本 |
| `8c4e578` | icon-only 阶段路线 + Tooltip | 与用户认可方向一致，可作为历史参考 |
| `fa75923` | 共享 Overlay 接入 Design Lab | 架构可保留，但 inspector 视觉需对比 |
| `10d84f4` | 当前 HEAD / 当前 Design Lab | **用户认可的 icon-only 基线** |

注意：`8c4e578` 仍包含有价值的实线 DAG、typography 调整；也有需要复核的
玻璃材质变化。不能凭 commit 标题整体接受或否定。

## 6. 当前可保留成果

- 业务功能、IPC、SQLite、Planner、Scheduler、Runtime 未修改
- Overlay/Inspector 架构
- Settings 焦点守卫
- Workspace 1100px 收窄 + Monaco wrap
- Orchestration 真正 CSS Grid
- DAG 实线边与节点轮廓
- 打包与测试脚本
- 真实 Electron 截图与 MP4

## 7. 当前禁止事项

- 不继续全系统 UI 重构
- 不恢复 0686 标签版
- 不删除/覆盖旧分支
- 不合并 stable
- 不在没有用户指出具体页面的情况下继续“猜”视觉问题

## 8. 下一步需要用户确认

请指出“越改越差”的**具体页面和当前截图**，优先级：

1. 正式计划审核 `PLAN REVIEW · R1` 的 Dialog 版？
2. Task Board / Task Inspector？
3. Project Center / Orchestration / Agent Workbench？
4. 还是 Design Lab 本身某个尺寸/暗色状态？

确认页面后，只在隔离 Worktree 中做单页对比和恢复，
不再进行全系统批量修改。

## 9. 当前截图与基线

- 已认可：`docs/next-ui/visual-regression/current-10d84f4.png`
- 错误候选：`docs/next-ui/visual-regression/rejected-labels-0686c41.png`
- 对照图：`docs/next-ui/visual-regression/comparison-0686-vs-10d84.png`
  （该图现在只用于证明“标签版不是 approved”，不再作为恢复目标）

## 10. 停止状态

已停止 UI 修改。等待用户指定具体回归页面后，再在隔离分支进行单页恢复。



