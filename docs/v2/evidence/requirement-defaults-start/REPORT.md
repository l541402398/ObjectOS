# 第一批：需求级默认负责人、批量应用与受控启动

工作分支 `codex/premium-system`，HEAD `f71d33e8acd70ec579501873c327e5b1180ee02a`，在未提交工作区上增量实施。
未提交、未推送、未合并、未发布。契约见 [ADR-0077](../../../adr/0077-requirement-defaults-and-start-intents.md)。

## 减少了哪些操作

| 以前 | 现在 |
|---|---|
| 每个任务 × 每个节点逐一选 Agent（3 任务 × 6 节点 = 18 次选择） | 需求级一次设置 6 个默认负责人；新任务直接继承；已有任务经预览一次应用 |
| 每个任务单独点“开始流程” | 需求级“开始执行 N 个任务”一次请求，Runtime 逐项检查并返回原因 |
| 依赖任务需人工等前置合入后再点开始 | 启动意图持久化；前置合入后在范围未变时自动申请该任务的工作区授权 |
| AI 拆分后先确认、再逐个开始 | “确认并开始”：确认计划后请求受策略约束的启动（仍需各项授权） |

## 仍需用户处理的审批

工作区准备（Git 分支/目录）、写文件、执行命令、测试命令、Git 合入与部署仍各自独立审批。“开始执行”和“确认并开始”不授予任何权限。
需求首个工作区创建共享集成分支前，同一需求只允许一个待批工作区请求，其余任务显示“排队申请工作区”，避免第二个审批因基线变化失效（桌面验收发现的真实问题）。

## 实现

- V43：`task_flow_steps.assignment_source`、`requirement_flow_start_intents`、`requirement_flow_start_items`（只追加）。
- 新 typed API：`requirement.flow.defaults`、`requirement.flow.assignment.preview/apply`、`requirement.flow.startAll`、`requirement.flow.stopAll`；未复用 `requirement.flow.bind`。
- 默认负责人修改不重建实例、不提升需求版本（节点证据范围不失效）；应用只填未分配节点，替换必须逐项勾选；已开始节点锁定。
- 启动：请求键幂等 + 按需求串行 + 条件更新，重复/并发请求不产生第二个 Run；任务暂停后不再自动恢复；停止自动推进会撤销意图并暂停运行中流程。
- 界面：需求页按真实状态只显示一个主操作（处理授权 / 处理问题 / 开始执行 / 确认安排 / 查看成果）；“任务安排”弹层；开始结果逐项显示原因；节点显示“需求默认 / 单独指定 / AI 分配”。

## 检查记录（本次实际运行）

| 命令 | 结果 | 输出 |
|---|---|---|
| `pnpm lint` | PASS（0 error，24 项原有 warning） | [lint](logs/lint.txt) |
| `pnpm typecheck` | PASS | [typecheck](logs/typecheck.txt) |
| 新增与相关单测（defaults-start、requirement-flow、p27 协调器、迁移两项） | PASS 33/33 | [unit-flow-targeted](logs/unit-flow-targeted.txt) |
| `tests/requirement-integration.test.ts` 单独运行 | PASS 15/15 | [unit-integration](logs/unit-integration.txt) |
| `pnpm build` | PASS | [build](logs/build.txt) |
| `scripts/requirement-defaults-start-e2e.mjs`（新） | PASS 53 项，23 张截图 | [log](logs/e2e-defaults-start.txt)、[checks](desktop/checks.json) |
| `scripts/requirement-flow-e2e.mjs`（回归，输出到新目录） | PASS 40 项 | [log](logs/e2e-requirement-flow.txt) |
| `scripts/requirement-integration-e2e.mjs`（回归） | **FAIL**：25 项通过后，在“改动较大，预览已截断”提示处等待超时；原因未定位 | [log](logs/e2e-requirement-integration.txt) |
| `node scripts/e2e.mjs` / `agent-e2e` / `v12-e2e` / `v13-e2e` | PASS | [logs](logs/) |
| `pnpm run test --maxWorkers=2` | **FAIL：624 PASS / 1 超时 / 4 SKIP** | [test-full](logs/test-full.txt) |
| `pnpm package:dir` / `pnpm test:package` | PASS | [package](logs/package-dir.txt)、[smoke](logs/test-package.txt) |

全量失败项与上一批相同：`requirement-integration.test.ts` 的同一用例 30 秒超时；该文件单独运行 15/15 通过。两项失败按用户指示记录为未解决，尚未确认是否与本批相关，不能写成全绿。

## 截图（Electron `capturePage`，模型回复为明确标识的本地测试 fixture）

- [待安排](desktop/arrange-needed-1440-light.png)、[设置默认负责人](desktop/arrangement-defaults-1440-light.png)、[预览 1440 浅色](desktop/arrangement-preview-1440-light.png)、[预览 1024 深色 125%](desktop/arrangement-preview-1024-dark-125-reduced.png)
- [可开始](desktop/ready-to-start-1440-light.png)、[开始结果 1440](desktop/start-results-1440-light.png)、[深色](desktop/start-results-1440-dark.png)、[1024 深色 125%](desktop/start-results-1024-dark-125-reduced.png)
- [上下文授权](desktop/approval-in-context-1440-light.png)、[停止后](desktop/stopped-1440-light.png)、[重启后](desktop/after-restart-1440-light.png)
- [AI 拆分确认并开始](desktop/plan-confirm-start-1440-light.png)、[开始结果](desktop/plan-start-results-1440-light.png)

以上截图为本批界面初版；之后的全局玻璃材质改造见 [glass-shell](../glass-shell/REPORT.md)。

## 未完成与未验证

1. 自主模式与既有计划执行授权（PlanGrantService）的衔接未做；当前自动推进只来自人发起的启动意图。
2. 预算不足的拒绝路径有实现，未单独测试；`requirement-integration` 桌面回归与全量单测各 1 项失败未定位。
3. 外部 CLI 流程、需求整体验收、已准备工作区追基线、第二至五批内容未开始。
4. 系统 125% DPI、读屏、触屏、真实外部模型质量未验证。
