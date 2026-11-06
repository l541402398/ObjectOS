# 远端同步、冲突处理与组织执行闭环

基准 HEAD：`0c2973ef4efbc0f6c5a1b512c55533d4c206ce00`，分支 `codex/premium-system`。
本报告与代码、ADR、原始检查输出和截图一起提交。最终检查的执行时间及源码摘要见
[`final-checks.json`](final-checks.json)，逐文件摘要见 `manifest.json`；提交本身提供最终版本号，避免在文件中伪造自引用提交哈希。
本报告取代上一批报告中“远端同步、组织执行和旧合并入口尚未完成”以及“测试超时”的阶段性结论。

## 已实现的行为

- 远端获取、快进同步、冲突工作区、验证、合入和推送均有独立操作、Run、ToolCall、审批与终态。分叉时同步停止；不会隐式改写历史或自动发布。
- 冲突提供 **Agent 自动处理** 与 **全人工解决**。两种方式都在隔离 worktree 中处理，目标分支在合入审批前保持原样。保留共同基线、目标、来源的原文，解决后仍可比对。
- 审查和真实验证绑定当前源／目标提交、文件内容及索引指纹。内容或远端发生变化后，旧审批、审查、验证不能放行。未知外部结果进入待核对，不盲目重试。
- 旧 `worktree.merge` 入口经生产调度器统一转入受审计的合入申请，待审批不会回报“已经合入”。计划仍须满足当前审查、真实测试、PlanGrant 与版本门禁；合入后另行验证。
- 组织远程任务使用现有 Native AgentRunner。服务端校验成员、项目、在线设备、有效授权、已发布且固定版本的 Agent／Skill、租约、预算与 fencing。Main 持有凭据；Runtime 单写本地业务库。每次工具操作及审批恢复后重新校验权限；撤销、失联和未知结果不会自动重放。
- 登录等待与服务端既有 10 分钟授权窗口一致；关闭再打开设置仍显示正在等待的登录。设备码单次使用与 PKCE／state 校验保持有效。此修复没有扩大测试超时限制。
- worktree 身份、仓库 commonDir、登记分支、完整已提交改动、敏感路径及自定义过滤／合并驱动均受检查。新任务采用短哈希路径，规避 Windows 深目录问题；旧未知结果保留待核对记录。
- 主流程不再要求填写验证命令或使用终端。直接运行项目声明的测试；无可识别验证配置时阻止放行。执行参数保留在审批与审计详情。

设计／安全决策：ADR [0079](../../../adr/0079-worktree-identity-and-merge-boundary.md)、
[0080](../../../adr/0080-compact-requirement-workspaces.md)、
[0081](../../../adr/0081-audited-sync-conflicts-and-organization-jobs.md)、
[0082](../../../adr/0082-automatic-verification-selection.md)、
[0083](../../../adr/0083-desktop-login-progress.md)。

## 真实桌面验收

验收操作通过可见的 Electron 桌面窗口和实际控件完成，没有用业务 API 或直接写数据库代替操作。
原生窗口控制器在本机会话中不可用，采用 Playwright 操作实际 Electron 窗口；这不等同于物理鼠标测试。
组织使用本机临时 PostgreSQL 与真实 HTTP 服务，Git 使用真实本地 bare 远端及第二份工作副本。
夹具脚本只准备仓库、两端冲突和长行文件；产品内申请、审批、编辑、审查、验证、合入及推送均走桌面。
数据库读取仅用于事后导出审计证据。

| 场景 | 实际结果与证据 |
| --- | --- |
| 获取与同步 | 单独审批后 fetch、快进 pull 成功；两端分叉后 pull 明确失败且未擅自合并。截图 01–04。 |
| 全人工解决 | 三方对比、键盘编辑、申请保存、独立真实 `node --test`、当前内容审查、独立合入和推送均成功。截图 06–12。 |
| DeepSeek 解决 | 真实模型读取上下文并申请写入；错误方案在桌面被拒绝，模型修正后再次审批。验证、审查、合入、推送分别完成。截图 13、19–22。 |
| 登录与设备 | 浏览器授权返回实际桌面；重启后账号、设备与已批准的目录授权仍可恢复。截图 14–16。 |
| 发布资产与任务 | 实际创建组织与共享项目，发布 Agent／Skill 1.0.0 并绑定版本，提交任务后由目录所属桌面显式接单。截图 15、17。 |
| 远程写入 | 真实 DeepSeek 在文件写入前暂停审批，批准后写入并读回；服务端任务 completed，本机 receipt 与 Run 关联。截图 24–25。 |
| 安装包展示 | 完整窗口、文件切换、并排／行内、换行、改动导航、长行与文件末尾可达；选择框 Escape 不会误关父窗口；反复切换及关闭无 model disposal 错误。最终截图 `final-*` 与矩阵文件。 |

**模型自动处理不等于语义正确。** 本轮模型曾把目标分支的 `Welcome` 改回 `Hello there`，丢失目标改动。
该写入在真实审批中被拒绝，并记录共同基线和两侧意图；模型随后保留 `Welcome` 与来源的 `!!!`。
见 [`19-agent-corrected-write-audit.txt`](19-agent-corrected-write-audit.txt)。审查、实际测试与发布边界不能被“冲突标记已消失”代替。

人工与 Agent 流程完成后，本地 main 与真实测试远端 main 均为
`6653b308c7c51faee71578ced935059e0d9ecf1b`。
最终长行及普通改动截图另在可丢弃的验收工作区准备了未提交文件，不混入该已验收提交。

组织成功任务：`3d0227c7-2a31-4073-a789-671a89711e0b`，
Run：`run_01m6qqz7yvb423d7zah12r2ejx`；授权仅限 `org` 子目录，预算 20 次，实际使用 2 次。
实际文件 `org/remote-result.txt` 为 `Organization native job passed.\n`。
失败的首次任务及错误原因保留，没有改成成功或自动重试。
全部操作关联、真实模型使用量、审批决定、工具结果、固定资产版本与两端提交见
[`persisted-delivery-audit.json`](persisted-delivery-audit.json)。

## 实际检查

| 检查 | 结果 | 原始输出 |
| --- | --- | --- |
| `pnpm lint` | PASS，0 error／45 warning | `lint-verified.log` |
| `pnpm typecheck` | PASS | `typecheck-verified.log` |
| `pnpm test --maxWorkers=2` | PASS，651 passed／4 skipped；111 文件通过、2 文件跳过；524.05s | `all-tests-verified.log` |
| 原超时集成用例定向复测 | PASS，总计 22.81s，原 30s 限制未扩大 | `performance-final.log` |
| Git／登录／authority 回归 | PASS，33 tests | `agent-login-regression.log` |
| 组织任务与真实 PostgreSQL 回归 | PASS | `remote-final-tests.log` |
| `pnpm build` | PASS，`pnpm package:dir` 内实际执行 | `package-dir.log` |
| `node scripts/e2e.mjs` | PASS，桌面创建与重启恢复 | `e2e.log` |
| `node scripts/agent-e2e.mjs` | PASS，真实审批暂停、执行与恢复 | `agent-e2e.log` |
| `node scripts/v12-e2e.mjs` | PASS，设置、连接及 Native 路径 | `v12-e2e.log` |
| `node scripts/v13-e2e.mjs` | PASS，扫描、计划 DAG、图与布局 | `v13-e2e.log` |
| `pnpm package:dir` + `pnpm test:package` | PASS，最终 EXE 构建与启动冒烟 | `package-dir.log`、`package-smoke.log` |
| 最终 EXE 人工流程与展示检查 | PASS，详见 `desktop-checks.json`、`visual-matrix.json` | `packaged-ui-session.log` |

4 项跳过为原有可选外部 OpenCode Harness 的 3 项，以及未配置 VPS 的 SSH 部署 1 项。
本轮真实 DeepSeek Native 桌面验收另行实际完成，不用可选外部 CLI 的跳过充当成功。
全量测试后只调整编辑器颜色与提交／证据脚本；最终构建、lint、typecheck、组织回归及安装包检查随后重新运行。
历史失败日志保留，最终结论以本表和 `final-checks.json` 为准。

## 视觉与验收边界

- `visual-matrix.json` 对应 1440×900／1024×768、浅色／深色、100%／125% 共 8 组完整原生窗口截图；125% 使用实际原生尺寸捕获，避免按 CSS 像素截断证据。编辑区和底部操作在视口内。
- 使用语义颜色区分删除、新增、双方冲突，文字与行同时高亮。浅色新增背景上的注释对比度问题已定位并改用现有主文字 token，最终可访问性输出见 `code-a11y-final.json`；自动工具无法判定的透明／分层背景仍标记 incomplete，不宣称全面 WCAG 认证。
- 最终展示遵守既有 Premium Liquid Glass，未改动批准的 Design Lab DAG。实际参考、技能加载与不可用项记录在 `docs/design/DESIGN_CHANGELOG.md`。未宣称新增玻璃特效的帧率／兼容性资格。
- 已验收本地 bare 远端与本地 PostgreSQL 组织环境；生产组织部署、外部 HTTPS／SSH 认证、VPS 发布和跨互联网中断没有在本轮桌面环境逐一验收。超大／二进制文件只提供明确受限预览，不宣称在线完整编辑。
- 旧计划入口的生产路由与门禁已作代码检查；本轮实际桌面完成的合入链路为人工／Agent 冲突流程及上一批真实需求任务交付。没有把旧计划的另一套完整生产发布验收冒充为本轮桌面结果。
- 私人邮箱在文字证据中脱敏；含成员邮箱的上一批 `11-organization-members.png` 保留本地、从提交排除。其余账号区在截图捕获时遮盖。API key、设备凭据、数据库和 safeStorage 文件不提交。

未更改用户原有的 `pelican-bicycle-2d.html`。上一批报告为历史快照，其中的“尚未提交／推送”描述不表示本次最终提交状态。
