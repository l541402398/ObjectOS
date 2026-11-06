# 2026-11-05 功能排查与真实桌面验收

> 本文为阶段性历史快照。后续实现、最终测试与提交证据见 [闭环报告](../delivery-organization-closure/REPORT.md)。其中成员页截图含私人邮箱，仅保留本地，不随提交发布；文字证据已脱敏。

基准 HEAD：`0c2973ef4efbc0f6c5a1b512c55533d4c206ce00`。
分支：`codex/premium-system`。实际执行 `git fetch origin --prune`、
`git pull --ff-only origin codex/premium-system`，结果 Already up to date，ahead/behind 为 0/0。
启动时的 15 个已修改文件和 `pelican-bicycle-2d.html` 均保留；见 `initial-status.txt`。
本批没有修改 Renderer 产品源码，没有提交、推送、远端合并或部署。

## 本批实现

决策见 [ADR-0079](../../../adr/0079-worktree-identity-and-merge-boundary.md)。

- Worktree 复用验证真实仓库根、注册目录、common Git 目录及当前分支，拒绝外部仓库、嵌套目录及错分支。
- 合入检查覆盖分支中**已经提交的完整改动**及未提交文件，阻止用先提交的方式绕过授权路径与敏感文件检查。
- 使用 NUL 分隔解析真实文件名，中文与 `[]` 等文件名不再被 Git 引号或 pathspec 解释改变。
- 冻结并合入明确源提交，合入前再次检查双方 HEAD、分支和干净状态；冲突预演失败停止并要求人工处理。
- 系统提交/合入关闭仓库 hooks 与签名，拒绝文件使用的自定义过滤器及 union/custom 合并驱动。
- 只尝试中止本次已知合并；不能证明恢复到原始目标状态时明确要求人工核对。
- 增加真实 Git 回归用例，另提供本机组织验收环境和两条纯界面桌面测试脚本。

启动时已经存在的 `ensureBaselineCommit` 自动 Git 初始化增量属于原有未提交修改，未计为本批实现。
后续真实模型验收发现深路径故障，追加 [ADR-0080](../../../adr/0080-compact-requirement-workspaces.md)：
新任务目录改用短哈希路径，已有登记根不搬迁；超长目录在写入前阻止。另移除需求准备预览中原有的未经审批
Git init/add/commit；没有初始提交的项目需先建立基线，不再在生成审批预览时擅自提交当前文件。
深路径和预览无写入用例加入后，`compact-worktree-tests.log` 记录 34 项通过。

## 经理提出的冲突合并问题

当前策略：**无冲突也必须经过内容审查和真实验证；有冲突先停止，由人工确认解决结果；不自动发布。**
Git 能合并只证明文本/树合并成功，不能保证业务语义正确。

| 场景 | 已有行为与本批结论 |
| --- | --- |
| 任务成果合入需求分支 | ADR-0074：当前内容/任务/需求版本审查、实际验证、独立 Git 审批；审批后重新核对源/目标；冲突保留任务提交并停止。合入需求不等于项目交付。 |
| 旧计划自主交付 | ADR-0030：显式 autoDeliver 策略、有效 PlanGrant、当前审查/测试、版本门禁、合入后复测；真实合并提交和验证 Artifact 分开记录。并非远端 push 或上线。 |
| 冲突解决 | 没有已验收的 Agent 自动解决冲突并发布流程。需要人工解决后重审、重测、重新授权；不能用旧审批认可新内容。 |
| 提交前 pull | 本次开发仓库已实际 pull。产品内工作区合入尚未提供带审批和审计的远端 fetch/pull/push 流程，因此不能保证产品自动追到远端最新提交。 |
| 目标本地分支变化 | 本批 legacy helper 冻结双方提交并在写入前重查；需求合入既有协议也绑定目标 HEAD。需要针对变化后的结果重新验证。 |

审计应同时回答：谁/哪条策略授权、拉取前后和 base/source/target/result 提交、逐文件内容指纹、冲突文件及解决理由、
作者与独立审查者、验证命令/退出码/输出、最终发布审批、失败/中断处理。
需求成果路径已经保存 Run、ToolCall、审批、快照、操作记录和提交；旧自主交付另保存合入后验证 Artifact。
**旧手工 `worktree.merge` 入口的审计/审批与自主交付门禁仍不完全等价，不能宣称所有入口均已统一。**
远端同步、Agent 冲突解决专门记录、旧入口统一审计以及需求最终交付仍是后续开发项。

## 实际桌面验收

`functional-desktop-ui-e2e.mjs` 与 `organization-desktop-ui-e2e.mjs` 直接启动真实 Electron，
通过页面表单、按钮和键盘操作；没有调用 `window.projectos`/业务 HTTP API，没有预置业务 SQLite、
没有注入登录 cookie、没有替换系统浏览器或原生确认框。账号注册和设备登录授权由用户在实际系统浏览器完成。

- 个人模式 8 项通过：创建项目与真实 README、创建带流程的需求、添加任务、退出/重启恢复、
  未登录个人模式、实际浏览器登录请求、PKCE 返回桌面、Renderer 无异常。
- 组织 13 项通过：登录会话恢复、创建组织/共享项目、所有者记录、真实设备登记、
  未启用任务接收的明确显示、暂停/恢复、组织/项目恢复、退出、退出后重启恢复、个人项目保留、Renderer 无异常。
- 本地 PostgreSQL 为真实独立进程；监听 `127.0.0.1`。`scripts/org-desktop-local.mts` 可启动新的临时验收服务，
  停止时清理其专用临时数据库。账号/组织角色不产生本机目录权限。
- 真实 DeepSeek 完整界面链路也已通过：5 位 Agent 接力完成 6 阶段和 6 份资料，分别批准两个
  文件写入、`node --test add.test.cjs` 和版本检查；测试退出码 0。完成本机任务验收后重新记录
  两文件覆盖审查，另行申请/批准独立验证，再单独申请/批准 Git 合入。全程业务操作来自桌面界面。
  合入提交为 `f140df7c27cd459357fe26d90837da05e4633604`，源提交见 `real-model-audit.json`。
  项目主分支仍为 `435d645472256ad6ef76f7bcad7907b6e340ef37`，两个新增文件没有出现在主目录。
  重启实际桌面后，已合入、内容审查和验证通过状态全部恢复；见截图 29–34 与 `real-model-ui-checks.json`。
- 实际查阅 `05-restart-recovered.png`、`07-browser-login-pending.png`、`14-worker-resumed.png`；
  截图均来自真实桌面 Renderer，位于 `screenshots/`。账户栏在后续截图中使用测试截图遮罩，未改变产品代码。

最初 Windows 原生操作工具的截图连续超时，备用工具能读 AX 但报 `coordinate input geometry is unavailable`；
因此改用仓库已有的 Electron 界面测试方式。**没有把物理鼠标/原生权限框测试计为通过。**
组织脚本首轮遗漏进入设备详情、第二轮未等待数据加载、第三轮末尾关闭按钮名称不匹配；均保留失败日志。
实际登记成功且没有重复登记；最终继续同一已退出会话验证项目保留，没有要求用户重新登录或注入凭据。

## 登录、组织、Worktree 的剩余边界

- 登录、组织、共享项目、所有者记录、设备登记/暂停/恢复/退出已由真实桌面操作验证。
- `packages/organization-contracts/src/local-worker.ts` 明确 `executionReady: false`，设备详情也显示“任务接收：尚未启用”。
  A2.2b 的远端 Job/租约/fencing、组织资产绑定解析、冻结 Run、逐工具复核和结果对账尚未交付。
- 本批未验证第二成员邀请接受、降权/跨组织隔离的纯界面链路；不能以服务单测代替这部分桌面验收。
- 未通过原生目录授权框。用户随后提供 DeepSeek 测试连接，已通过桌面配置/连通/真实推理 L1/L2/L3，
  完成上述真实模型执行、测试、验收和需求合入链路。
  首次旧长路径失败及 needs_reconciliation 原样保留；新需求使用短路径成功启动，没有重试未知操作。
  现有 agent/v12 回归的本地测试 Provider 与这次真实 DeepSeek 验收分开记录。
- Worktree 的目录/分支/完整改动检查有真实 Git 测试；本批未用纯桌面界面完成所有冲突分支场景。
- 没有 Renderer 改造，没有宣称通过新一轮 1024/深浅色/125%/屏幕阅读器/原生 DPI 的视觉验收。

## 命令记录

具体日志保存在本目录；`required-e2e.json`、`desktop-ui-checks.json`、`organization-ui-checks.json`
保存可核对结果。最终检查汇总见 `checks.json`（整理时更新）。

- `pnpm lint`：PASS，0 errors / 44 warnings，依赖边界通过（新脚本加入后另做末次检查）。
- `pnpm typecheck`：PASS（新脚本加入后另做末次检查）。
- `pnpm build`、`pnpm package:dir`：PASS。
- `node scripts/e2e.mjs`、`node scripts/agent-e2e.mjs`、`node scripts/v12-e2e.mjs`、`node scripts/v13-e2e.mjs`：全部 PASS。
- `pnpm test:package`：PASS，实际 Windows EXE 创建文件并重启恢复。
- 首轮 `pnpm build` 普通权限被构建工具读取上级目录权限阻止，完整本机环境重跑通过；原日志保留。
- 首次 `pnpm test --maxWorkers=1` 参数被 pnpm 拒绝，没有执行测试；改为 `pnpm run test --maxWorkers=2`。
- 首次 Worktree 测试暴露 Windows 短路径和真实路径比较不一致；修正 canonical 比较后，第二轮 20 项通过。
- `pnpm run test --maxWorkers=2`：**FAIL**，637 PASS / 1 FAIL / 4 SKIP，110 文件，598.44 秒。
  唯一失败为需求成果合入与前置成果传递用例超过原有 30 秒限制。
- `pnpm exec vitest run tests/requirement-integration.test.ts -t 'uses real reviewed, verified output' --maxWorkers=1`：
  PASS，原断言和 30 秒限制不变；1 PASS / 14 因测试名称过滤未执行，26.72 秒。
  复测结果支持存在并发负载敏感性，**不能将先前失败的全量命令改写为 PASS**。
- 深路径修复后：`pnpm lint` / `pnpm typecheck` / `pnpm package:dir` / `pnpm test:package` 与 4 条
  规定桌面 E2E 再次通过（`*-compact.log` / `required-e2e-compact.json`）。最终打包 Runtime 与构建文件 SHA256 相同。
- `pnpm exec vitest run tests/requirement-work.test.ts tests/worktree.test.ts --maxWorkers=1`：34 PASS。
- `pnpm exec vitest run tests/requirement-integration.test.ts --maxWorkers=1`：14 PASS / 1 FAIL，
  同一条 30 秒用例在构建/桌面并发负载下再次超时（`integration-compact.log`）。
- 最终修复版单独复测同一用例：PASS，1 PASS / 14 因名称过滤未执行，29.76 秒，仍未放宽原 30 秒限制。
  这说明性能余量较小，**本轮全量检查不是全绿**。未修改测试超时或隐藏失败。

最终 Windows 程序为 `release/win-unpacked/ProjectOS.exe`，已用同一验收配置重新打开供查看；
交互验收的临时调试监听已关闭。本机组织服务为本次临时环境，账号已真实退出。
末次新增 JS 验收工具通过单独 ESLint 检查；该命令报告 `.mts` 启动工具被现有 ESLint 配置忽略，
没有将忽略项冒充 lint 覆盖。启动工具已实际运行并完成真实 PostgreSQL/组织服务验收。

模型配置参考 [DeepSeek 官方模型文档](https://api-docs.deepseek.com/quick_start/pricing/) 与
[Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/)；实际使用 `deepseek-flash`。
密钥仅通过桌面密码输入框提交到既有 Main 安全存储，没有写进源码、证据或测试脚本。
