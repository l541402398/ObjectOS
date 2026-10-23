# ProjectOS AI 经验闭环日志

状态：ACTIVE
最后更新：2026-10-23
配套规范：`docs/AI_TOOL_ROUTING.md`

> 这里记录**可复用的实施方法**与**失败约束**。仓库文件是权威；OpenViking 仅负责长期检索。
> 每条成功/失败必须能指向代码、命令、截图或 E2E。不要把大日志/密钥写进来。

## 记录格式

```markdown
### EXP-YYYYMMDD-NN · 标题
- 类型：success | failure | constraint
- 任务分类：R-xx
- 环境/版本：
- 症状/目标：
- 根因/方法：
- 证据：
- 可复用步骤：
- 禁止/边界：
- 验收：
- 关联文件/提交：
```

## 成功经验

### EXP-20261023-01 · Design Lab 玻璃性能与视觉同时保留
- 类型：success
- 任务分类：R-01 / R-08
- 环境：Windows，Electron 43.8.2，软件合成 GPU
- 症状：DAG/Plan Review 卡顿；大面积 backdrop-filter。
- 方法：
  - 页面 header 去掉大面 blur；侧栏 24→12px；Plan workspace 去掉全屏 blur；
  - 保留渐变/边框/高光/布局；
  - 用 `perf-benchmark.mjs` 做同场景前后对比，而不是凭感觉。
- 证据：DAG 35.1→49.5 FPS，Plan 25.5→40.8 FPS；`docs/performance/PERFORMANCE_AUDIT.md`。
- 可复用步骤：先测大面 blur → 只降大面静态 surface → 截图确认材质 → 同场景复测。
- 禁止/边界：不要全局删除 blur/阴影；不要关硬件加速当默认方案。
- 验收：Phase5 48 + Plan 13 + 视觉截图 + package smoke。

### EXP-20261023-02 · 关闭仍挂载组件导致 IPC 慢查询
- 类型：success
- 任务分类：R-08
- 症状：DAG 页面每次挂载 `runtime.list` ~2.2s。
- 根因：`AgentStudioModal` 关闭时仍无条件挂载，内部 `useRuntimeProfiles()` 执行。
- 方法：仅在 `agentStudioOpen` 时挂载；runtime profiles 增加 5 分钟 staleTime。
- 证据：DAG IPC 中 runtime.list 消失；`PERFORMANCE_AUDIT.md`。
- 可复用步骤：检查 Modal/Drawer 条件挂载；检查 hooks 是否在关闭状态仍运行。
- 验收：DAG IPC 采样 + Phase5。

### EXP-20261023-03 · 计划评审事件风暴收敛
- 类型：success
- 任务分类：R-04 / R-08
- 症状：打开 Plan Review 时 project.snapshot/graph 重复 12–13 次。
- 根因：Orchestration 仍订阅 runtime 事件并对 graph/snapshot 全量 invalidate。
- 方法：`planOpen` 时暂停后台 invalidation；关闭/审批后显式刷新。
- 证据：`optimized-ipc4.json` / `optimized-ipc5.json`；单次 snapshot/graph。
- 验收：Plan E2E + IPC probe。

## 失败经验 / 禁止重复

### FAIL-20261023-01 · 旧 R1 Plan Review Modal
- 类型：failure
- 任务分类：R-04
- 根因：把正式 R1 Modal 当作已批准基线；用户明确拒绝。
- 证据：`REJECTED-current-real-plan-review.png`、`VISUAL_BASELINE.md`。
- 禁止：任何新计划审核不得恢复 R1 Modal；草稿用 `PlanReviewWorkspace`。
- 验收：截图与 `0686c41` 指纹一致。

### FAIL-20261023-02 · liquid-glass-react / Aurora 默认启用
- 类型：failure
- 任务分类：R-01 / R-08
- 证据：liquid-glass 探针 7 FPS、暗块；Aurora 8 FPS。
- 禁止：作为默认正文/全屏材质；只保留 opt-in/兼容性探针。
- 验收：静态 OpticalGlass fallback；截图/性能数据。

### FAIL-20261023-03 · 设置弹层玻璃皮肤文字重影
- 类型：failure
- 任务分类：R-01 / R-03
- 症状：Electron Settings Modal 文字双影；透明/无 blur/opaque 均复现。
- 当前结论：未解决；保持 legacy。
- 禁止：未做 1200ms Electron 实拍前再次全量套用。
- 验收：真实截图清晰、无重影；否则回退。

### FAIL-20261023-04 · Ant message 覆盖关闭按钮
- 类型：failure
- 任务分类：R-03
- 症状：X 视觉位置点击无效；`elementFromPoint` 命中 `.ant-message-list-content`。
- 方法：message pointer-events:none + 提升 inspector 层级 + 36px 命中区。
- 证据：`PLAN_INSPECTOR_FIX.md`。
- 禁止：用 `locator.click()` 单独证明；必须真实坐标 + 元素命中。

### FAIL-20261023-05 · 已批准计划显示“待批准”
- 类型：failure
- 任务分类：R-03 / R-04
- 根因：`PlanReviewNext` 顶部状态硬编码；计划实际 `status=approved`。
- 方法：状态标签映射真实 `draft.status`；已批准计划无审批按钮是正确的。
- 证据：`plan-approved-status.png`；本地 DB `plan_revisions.status=approved`。
- 禁止：把已批准计划当 draft；把“待批准”当任务级审批。

## 重复问题 → 质量门禁

| 重复问题 | 已转成的门禁 |
|---|---|
| Drawer 关闭/滚动/命中 | `scripts/plan-review-workspace-e2e.mjs` 13 checks；真实 mouse click；滚轮 |
| Plan 状态误标 | 真实 API 创建 approved plan + 截图/状态断言 |
| 大面积 blur 性能 | `scripts/perf-benchmark.mjs` + `PERFORMANCE_AUDIT.md` 阈值 |
| AgentStudio 关闭仍请求 | DAG IPC 采样；`runtime.list` 不应出现 |
| 旧 R1 Modal 回退 | 视觉基线截图 + `VISUAL_BASELINE.md` 审查 |
| 页面视觉退化 | Phase5 48 checks + 1440/1100/125 截图 |

## 维护

- 每次成功/失败任务结束更新；不允许只写聊天记忆。
- 重要结论同步到 OpenViking，但引用本文件/代码/测试，不复制大日志。
- 过期条目标注 SUPERSEDED 并说明替代方案，不静默删除。
