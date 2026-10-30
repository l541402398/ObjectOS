# Premium Liquid Glass 全系统实施与字体/加载修复

工程检查完成，等待用户对实际画面的主观复核。分支：`codex/premium-system`。
执行检查时的基础 HEAD：`7746a49b53875ce33107f99623da0409dc1137f5`。
产品源码、完整截图、原始检查输出和下述清单随同一产品提交保存；提交完成后的实际 id
记录在相邻交付索引中，避免伪造尚不存在的提交哈希。

## 本次交付

- 依据用户批准的 DAG 工作台统一产品菜单、页面、弹层、材质和文字层级，保留真实业务操作。
- 本地完整 Noto Sans SC 可变字体、明确的代码中文回退和旧字体变量映射；原生检查证明此前审批
  代码区曾落到 NSimSun。卡片/抽屉/设置采用冷色阅读面，修复残余小字号和强制配色。
- 路由、设置分类、任务/运行详情读取就绪后整体呈现；首次挂载等待本地字体。最近选择优先，
  关闭后迟到的读取不会重新打开；八项延迟读取测试与原生冷进入帧检查分别验证。
- 辅助、自主、托管三种模式保留并验证持久化；协作保持绘图连线，选中/运行关系有可暂停流向，
  实时响应减少动效。版本拥有迭代，环境由项目共用；部署入口显示真实准备条件。
- Runtime、Main、Server、SQLite、审批权限和执行语义未改动。

## 实际执行结果

| 命令 | 结果 | 输出 |
|---|---|---|
| `pnpm lint` | PASS，0 errors / 25 warnings | [lint](../../design/system-premium/validation/font-final-lint.txt) |
| `pnpm typecheck` | PASS，修正新增测试参数后复测 | [typecheck](../../design/system-premium/validation/typecheck-repaired.txt) |
| `pnpm test` | PASS，571 tests；4 SKIP | [test](../../design/system-premium/validation/test.txt) |
| `pnpm build` | PASS | [build](../../design/system-premium/validation/build.txt) |
| `node scripts/e2e.mjs` | PASS | [desktop](../../design/system-premium/validation/desktop-e2e.txt) |
| `node scripts/agent-e2e.mjs` | PASS | [agent](../../design/system-premium/validation/agent-e2e.txt) |
| `node scripts/v12-e2e.mjs` | PASS | [v12](../../design/system-premium/validation/v12-e2e.txt) |
| `node scripts/v13-e2e.mjs` | PASS | [v13](../../design/system-premium/validation/v13-e2e.txt) |
| `node scripts/premium-lab-e2e.mjs` | 32 PASS | [Lab](../../design/system-premium/validation/premium-lab.txt) |
| `node scripts/premium-usability-e2e.mjs` | 15 PASS | [usability](../../design/system-premium/validation/premium-usability.txt) |
| `node scripts/premium-readiness-e2e.mjs` | 12 PASS | [readiness](../../design/system-premium/readiness/checks.json) |
| `node scripts/premium-system-ui.mjs` | 389 PASS / 288 screenshots / 100 axe runs | [pages/settings](../../design/system-premium/after/inventory.json) |
| `node scripts/premium-overlays-e2e.mjs` | 408 PASS / 72 axe runs | [overlays](../../design/system-premium/overlays/checks.json) |
| `node scripts/premium-walkthrough.mjs` | PASS，10 段原生操作 | [video](../../design/system-premium/walkthrough/product-ui.webm) |
| `pnpm package:dir` | PASS | [package](../../design/system-premium/validation/package-dir.txt) |
| `pnpm test:package` | PASS，EXE 创建项目及重启恢复 | [smoke](../../design/system-premium/validation/package-smoke.txt) |
| `pnpm exec vitest run tests/ui-readiness.test.ts` | 8 PASS，最后测试参数修正后复测 | [readiness unit](../../design/system-premium/validation/readiness-unit-repaired.txt) |
| `pnpm exec eslint tests/ui-readiness.test.ts` | PASS | [test lint](../../design/system-premium/validation/readiness-lint-repaired.txt) |

首轮全套脚本的类型检查 FAIL 和早先诊断失败均保留；最新结果按时间合并，不改写历史。
4 个 SKIP 是显式启用的外部 Harness / SSH 服务测试。构建、单测或 axe 通过不等同于视觉批准。

## 实际画面与可追溯性

- [完整报告和前后对照](../../design/system-premium/REPORT.md)
- [审批文字与材质](../../design/system-premium/after/approvals-1440-light.png)
- [浅色任务检查器](../../design/system-premium/overlays/task-detail-1440-light.png)
- [1024 / 暗色 / 125% 任务检查器](../../design/system-premium/overlays/task-detail-1024-dark-125.png)
- [部署准备](../../design/system-premium/after/deployments-1440-light.png)
- [真实计划 DAG](../../design/system-premium/overlays/real-plan-1440-light.png)
- [源码/截图 SHA256 与命令索引](../../design/system-premium/evidence-manifest.json)
- [Electron 弹窗时间与测试启动调查](../../design/system-premium/diagnostics/electron-popup-investigation.json)

采用 1440/1024、亮/暗、100%/125% 原生矩阵；非图表正文至少 12px，关键正文 14px。
原生背景抽样未发现低于 4.5:1 的样本；这不是 WCAG 认证。流向采样约 62.3 fps，暂停约
64.1 fps，最多 12 条运动路径。冷进入测试为 4 倍 CPU 降速，五类目标均没有框文分离采样帧。

未验证：人工屏幕阅读器听读、其他操作系统、实际外部部署、损坏字体文件的人工体验、新登录
组织的全部状态组合以及用户的主观审美接受。已有 A2.2a 组织功能证据独立保留。本轮不启用
尚未交付的组织执行能力。用户报告的 Windows 异常只定位到测试启动阶段，没有原生转储，
不声称定位具体 C++ 原因；后续完整回归期间未发现新的同类系统弹窗事件。
