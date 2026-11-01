# A3.2a — 审查后的任务成果合入与前置成果传递

日期：2026-10-30。当前分支 `codex/premium-system`，基准 HEAD
`f71d33e8acd70ec579501873c327e5b1180ee02a`，本批与此前修改均保留在工作区，未提交、推送、合并主分支或发布。
设计继续使用已恢复的蓝青 Premium Liquid Glass。决策见 [ADR-0074](../../../adr/0074-reviewed-task-integration.md)。

## 实际完成

- 在需求工作台增加「成果审查」。左侧阅读真实改动，右侧集中验证命令与人工审查；分支、提交和操作历史按需展开。
  使用共享 DialogShell、Motion、已有设计变量和中文字体。窄窗口按上下顺序阅读，主要操作保留在固定页脚。
- Runtime 完整读取任务内容，显示当前审查、验证与合入条件。代码、文档、UC、任务范围或目标分支变化后，旧审批失效。
  人工审查存为已有 Artifact，并由 Runtime 内部关联表证明来源；自由填写的 Artifact 快照不能冒充可信审查。
- 验证使用真实 Run / ToolCall / 人工审批和既有命令适配器。退出成功且执行前后源内容与范围一致才计为通过。
  审批确认立即返回，较长命令在后台执行；超时或中断结果进入人工核对，不自动重试。
- 完成任务验收、当前内容审查与实际验证后，另外申请 Git 合入审批。只提交明确列出的改动，检查暂存内容，
  合入需求分支。项目主分支保持原状；任务成果已合入不表示需求已交付。
  完成状态由当前内容/范围及真实合入提交共同证明，阻止对同一成果重复申请；新增改动重新经过审查和验证。
- 按需求串行处理成果操作。取消 Run 不能提前释放仍在执行或待核对的工作目录。合并冲突中止后保留任务提交；
  重启后的人工核对只登记能证明的提交结果，不重放提交、合并或验证命令。
- 后续任务只有在同一需求的前置任务验收并合入后才能准备工作区。其基线包含真实合入提交，开始执行和工具操作前再次检查。
- V39 仅新增操作与可信审查关联表；V1–V38 未修改。Renderer 仍只调用命名 preload API，没有文件系统或 Git 权限。

## 使用方式

运行 `pnpm start`，进入项目的「研发 → 需求工作台」。完成任务验收后打开「成果审查」，检查改动并记录结论，
填写实际验证命令并到审批页批准。验证通过后申请合入需求，到审批页再次批准。后续任务此时可准备独立工作区。
所有验证、失败、拒绝和合入操作都有运行记录。重新打开面板显示上次实际执行的命令，不能把默认命令误认为已验证命令。

## 界面证据

截图由真实 Electron `webContents.capturePage()` 采集，使用独立临时测试项目、真实 SQLite、Git 和 Node 测试命令。
测试内容是明确标注的验收数据，产品没有示例进度或伪造审批。

- 改造前工作台：[A3.1 浅色](../requirement-work/requirements-1440-light.png)。原证据未覆盖。
- [真实加载状态](review-loading-1440-light.png)、[无改动空状态](review-empty-1440-light.png)、[密集长文件列表](review-dense-long-1440-light.png)、[长内容滚动](review-dense-scroll-1440-light.png)、[已合入状态](review-integrated-1440-light.png)。
- [审查初始状态](review-initial-1440-light.png)、[内容变化的错误提示](stale-review-error-1440-light.png)。
- [1440 浅色](review-1440-light.png)、[1440 深色](review-1440-dark.png)。
- [1280 浅色](review-1280-light.png)、[1280 深色](review-1280-dark.png)。
- [1024 浅色](review-1024-light.png)、[1024 深色](review-1024-dark.png)、[125% 与减少动效](review-1024-dark-125-reduced.png)。
- [验证审批](verify-approval-1440-light.png)、[合入审批](integrate-approval-1440-light.png)、[合入后的需求工作台](integrated-workbench-1440-light.png)。

本批复用既有光学材质，不引入新的玻璃库或图形动效。实际检查了 A3.1 工作台基线及当前原生截图；
继续使用先前已查阅的 UI UX Pro Max、Vercel composition / React 和 Impeccable 源文件。
补查 UI UX Pro Max 的 focus states / reduced motion / focus-not-obscured，运行 Impeccable detect，结果见
[impeccable-detect.json](impeccable-detect.json)。已有图形源、Sim、Liquid Glass React、React Bits 的来源及性能限制沿用
[A3.1 来源记录](../requirement-work/REPORT.md)。本次没有重写画布、引入外部视觉效果，亦未重新声称其帧率。
当前环境仍未提供这些参考技能的专用加载工具，查阅的是本地 SKILL.md 和脚本。

## 验证记录

最终命令状态、截图与源文件哈希见 `checks.json`、`manifest.json`、`delivery-e2e.json` 和 `logs/`。

| 实际命令 | 结果 | 覆盖与限制 |
| --- | --- | --- |
| `pnpm run test --maxWorkers=2` | PASS，601 通过、4 SKIP | 104 个测试文件通过；真实 OpenCode/DeepSeek 与 SSH 环境测试跳过。日志 `all-tests-verified.log` |
| `pnpm run test tests/requirement-integration.test.ts tests/requirement-work.test.ts tests/phase0-migration.test.ts --maxWorkers=1` | PASS，31 通过 | 末次重复合入保护修正后回归；日志 `targeted-verified.log` |
| `pnpm typecheck` | PASS | `typecheck-delivery.log` |
| `pnpm lint` | PASS，0 错误、24 条既有警告 | 边界检查通过；`lint-delivery.log` |
| `pnpm package:dir`（内部执行 `pnpm build`） | PASS | Runtime、Desktop、Server 构建与 Windows 打包；`package-build-delivery.log` |
| `node scripts/requirement-integration-e2e.mjs` | PASS，28 项、17 张截图 | 真实验证、单独审批、重启、完成状态、前置成果、6 组尺寸/主题可访问性检查 |
| `node scripts/requirement-work-e2e.mjs` | PASS，30 项、17 张截图 | 项目切换、文档/任务编辑、隔离执行、冲突保护；输出保存在 `workspace-regression/` |
| `node scripts/e2e.mjs` | PASS | 桌面创建项目与重启恢复 |
| `node scripts/agent-e2e.mjs` | PASS | 审批暂停、真实工具写入与恢复执行 |
| `node scripts/v12-e2e.mjs` | PASS | 设置、连接管理、本地测试模型、原生运行与重启 |
| `node scripts/v13-e2e.mjs` | PASS | 扫描、计划审批、真实 DAG、布局保存与重启 |
| `pnpm test:package` | PASS | 最终本地 EXE 创建项目、写入初始文件、重启恢复 |

时序：全量 601 项通过之后，补充了重复合入保护与长列表对齐。末次产品代码经过 31 项相关测试、类型检查、lint、构建，以及上述全部桌面/打包回归；全量 601 项未在末次小修后再次重跑。

读取并检查了实际加载、空状态、深浅主题、1280、1024/125% 和密集长文本截图；没有页级横向溢出，主要操作可见，长内容可滚动。6 组标准尺寸/主题的 axe 检查均为 0 违规。焦点、减少动效为脚本检查；不代表屏幕阅读器或 OS DPI 验收。

最终程序：`release/win-unpacked/ProjectOS.exe`。证据脚本 lint 与语法检查通过。初次失败的诊断截图归档到 `diagnostics/`；已修复的测试/实现问题及其日志仍保留。

本记录在后续“简化人工流程”改造前封存，用作可比较的功能与视觉基线。

已经查明并处理的问题：

1. 初版重复调用 Git 读取同一内容，导致 Windows 测试超时。改为一次完整文件采集、复用当前审查快照、合并 Git 身份读取。
   首个完整集成场景由超时降至约 22 秒，包含准备、验证、审批、合入及创建后续目录；这不是单次界面加载耗时。
2. 前置成果列表经过 Zod 解析后的字段顺序不同，被旧字符串比较误认为内容变化。改为规范化快照比较与稳定哈希。
3. Git 全局安装了 LFS 不代表当前文件使用 LFS。现在检查实际文件属性，普通仓库不会因此被误阻止；
   真正使用自定义过滤器或合并驱动的文件仍需人工处理。
4. Windows Git 检出使用 CRLF，冲突测试改用与平台无关的行尾比较，保留内容与分支断言。
5. 全量测试与构建、桌面采集同时运行时产生进程争用；保留断言和超时，使用较低测试并行度做最终回归。
6. 已合入内容原先仍显示可申请入口，补充基于真实提交与当前内容的完成判断，并在 Runtime 拒绝重复请求。
7. 桌面重启测试必须先等审批请求保存成功。已修正测试脚本的竞态，没有将尚未完成的请求冒充持久化记录。

## 尚未完成与边界

- 需求整体验证、最终验收/交付，以及把托管任务接入自主调度，继续属于下一批。旧计划、自主/辅助模式保持原行为；
  旧计划调度器仍明确拒绝不具备完整需求执行协议的托管任务。
- 已准备工作区如果后来新增依赖且基线不包含成果，会明确阻止执行；自动同步已有工作区、冲突解决界面还未接通。
  目前支持在前置任务合入后准备新工作区。跨需求依赖不自动拼接。
- 本批提供本机所有者的显式内容审查。Agent 能力组合、可配置文档/审查流程、设置整理及 A2.2b 远程作业桥均未宣称完成。
- 不支持自动集成包含受保护文件、符号链接、子模块或自定义 Git 过滤器/合并驱动的任务。完整捕获有明确的
  10,000 文件、单文件 64 MiB、合计 256 MiB 上限；超限报错，不能静默截取后放行。文本预览截断会明确提示。
- 既有扩展 `v13-orchestration-e2e.mjs` 的重新审查等待问题未在本批处理；本批通过的是规定的 `v13-e2e.mjs`。
- 125% 为应用缩放；未验证 Windows 系统 DPI、其他 OS、手工屏幕阅读器、真实外部模型或跨机器团队执行。
- 使用者对整体美感的最终认可仍需实际体验；自动化可访问性检查和单元测试不等于视觉认可。
