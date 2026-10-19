# V1.3 验收报告（核心增量）

日期：2026-10-19  
范围：`ProjectOS_V1.3_Implementation.md` 的扫描、计划、图工作台与 UI 增量。  
结论：**核心可运行子集完成，不等于 V1.3 全量完成**。

## 1. 已完成

- 项目扫描：TS/React/Vite/Electron/Ant Design/Monorepo、Java/Maven/Gradle/Spring 结构识别；
  生成 `ProjectSnapshot` 并持久化。
- 计划：本地规则生成 4 个角色的 PlanDraft，DAG 校验/环检测，草稿可编辑标题、角色与依赖；
  批准后通过既有 TaskService 创建真实任务与依赖。
- 自动编排：计划 start/pause/resume/cancel、按依赖自动启动 Run、Run 完成自动验收推进、
  重启恢复；4 任务计划已完整跑到 done。
- Agent 路由与用量：task/agent/project/global 作用域、priority 与默认回退；Run 结束记录
  连接/模型/tokens，设置内汇总。
- 图工作台：React Flow 画布，真实 Agent、任务、依赖、Run 状态投影；Inspector 与节点联动；
  MiniMap/缩放/平移；保存布局并在重启后恢复。
- 设置内联连接编辑：新增/编辑连接不再叠加第二个 Modal，改为设置内容区的子视图。
- 迁移 v3：`project_snapshots`、`plan_revisions`、`graph_layouts`。

## 2. 未完成

- 自动 Orchestrator 调度基础版本已完成；失败重试/退避与质量门禁报告仍未接。
- Git Worktree 隔离、自动合并、质量门禁报告。
- 200 节点压测、事件 seq 断线补齐、布局分组/折叠。
- 图节点审批节点、artifact-flow 边、里程碑节点。
- 项目扫描的 Java 依赖深度解析与增量扫描。

## 3. 验收项

| ID | 结果 | 证据 |
|---|---|---|
| T01 导入真实 TS 项目 | 通过 | `tests/orchestration.test.ts`；V1.3 E2E 识别 TS/React/Vite/Electron/Monorepo |
| T02 导入 Spring 项目 | 通过（结构） | 单测识别 Maven/Gradle/Spring 提示；未做真实 Spring 仓库 |
| T03 计划环路 | 通过 | 单测 `validatePlanDraft` 抛环形错误 |
| T04 未批准计划启动 | 通过 | `orchestration.start` 拒绝 draft，必须 approved |
| T05 两 Agent 争抢任务 | 通过（V1.1） | 既有 Lease fencing 单测 |
| T06 依赖未完成测试任务 | 通过（V1.1） | TaskService 依赖门禁；编排只提升依赖为 done 的 backlog |
| T07 Driver 不可用 | 部分 | 编排启动失败会暂停计划并记录错误，未做授权回退 |
| T08 工具成功但崩溃 | 通过（V1.1） | recovery 单测 |
| T09 交接重复投递 | 通过（V1.1） | inbox 幂等测试 |
| T10 图节点点击 | 通过 | V1.3 E2E 点击任务节点，Inspector 出现 |
| T11 事件断流补 seq | 部分 | sinceSeq 补取遗漏事件 + 全量图刷新；非逐事件增量 patch |
| T12 布局重启恢复 | 通过 | V1.3 E2E 保存 620/40，重启后读回 |
| T13 200 节点 | 通过（投影） | 202 节点/399 边，投影 11ms；浏览器交互压测未做 |
| T14 Worktree 并行 | 通过（计划级） | 独立分支执行、diff artifact、主工作区干净时合并；E2E 合并成功 |
| T15 测试失败不得完成 | 通过（基础） | 质量门禁执行 typecheck/lint/test/build；失败生成 test-report、blocked、execution failed |
| T16 1280×720 | 通过（1024/1440 截图） | 编排页 inspector 下移 |
| T17 Light/Dark | 通过 | 43 张截图 |
| T18 文案检查 | 部分 | 编排页无营销文案；旧页面仍有少量字段说明 |

## 4. 实际命令

```text
pnpm lint       → 0 errors, 0 warnings
pnpm typecheck  → pass
pnpm test       → 12 files / 55 tests passed（新增 orchestration 4）
node scripts/v13-e2e.mjs → PASS
  scan: TypeScript/JavaScript · React/Vite/Electron/Ant Design/Monorepo
  plan: r1 · 4 tasks · approved
  graph: 10 nodes / 12 edges
  layout: 620/40 persisted after restart
  settings: `.po-ai-editor` inline, `.ant-modal .ant-modal` = 0
```

## 5. 截图

- `docs/screenshots/1440x900-light-orchestration.png`
- `docs/screenshots/1024x768-light-orchestration.png`
- `docs/screenshots/1440x900-light-settings-connection-editor.png`
- `docs/screenshots/1024x768-light-settings-connection-editor.png`
- 共 43 张（1440×900 / 1024×768，Light/Dark）。

## 6. 已知限制

- 计划生成是**本地规则**，不是模型生成；UI 标记 `本地规则草案`。
- 图投影每 5 秒轮询，不是严格的事件 seq 增量；不能宣称断线补齐。
- 任务自动执行/多 Agent 串行交接未接线；图展示的是真实数据库状态，不是模拟状态。
- v13 E2E 使用本地临时项目，不是真实 RBAC 业务代码；未接真实 Provider 调用。





