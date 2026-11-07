# K2 组织知识管理与需求开工分析

验收日期：2026-11-07（America/Los_Angeles）。基准 HEAD：
`168c9ba963d5b17ab62a615f10bcdab44a2c8fba`；分支 `codex/organization-knowledge-k2`。
本报告、ADR、源码、截图和命令输出随同一个实现提交保存。最终提交以本文件所在的 Git 提交为准。

## 实现范围

- 在原有账号与组织设置中增加知识列表、技术／业务分类筛选、草稿编辑、版本历史及发布／废弃／撤销操作。
  编辑保持内联，关闭前保护未保存内容，沿用原有字体、玻璃材料、焦点和减少动效规则。
- 需求的“组织资料”标签支持选择共享项目、检索已发布资料、选择最多八篇并填写引用理由。
  SQLite 迁移 45 保存当前账号／组织／项目、文档／版本／校验值及理由；不保存组织凭据或原文。
- 第一次规划或执行固定引用范围。新版本不会替换已选旧版本；个人需求开始后同样固定为本地范围，登录不自动上传或关联个人项目。
- 原有规划、修订规划和 Native AgentRunner 临时接收授权正文与不可信资料提示。模型请求、工具执行、审批恢复及任务审批之前重新校验。
  组织切换、退出、离线、撤权或版本撤销均拒绝继续访问。文件、命令、Git 和流程审批保持原有门禁。
- Main 独占凭据，通过固定用途、受限大小和数量的进程管道交换资料；没有新增网络／文件通用桥接或第二个 Agent 执行器。

架构决策：[ADR-0085](../../../adr/0085-requirement-knowledge-context.md)。
实施顺序：[K1–K5 方案](../../../org-upgrade/KNOWLEDGE_AND_ASSIGNMENT_PLAN.md)。

## 实际验证

真实 PostgreSQL／HTTP 验证精确版本解析、后续版本不替换、校验值不符、项目可见范围、草稿／撤销拒绝和标题／正文合计 24,000 字符上限。
引用元数据、人工理由和提示文字计入实际模型上下文统计，其字段分别有界，不计入这项正文上限。
Main 测试验证当前账号／组织绑定、请求期间切换组织后丢弃旧结果及凭据隔离。
SQLite／Runner 测试验证乐观修订、引用锁定、不持久化源正文、实际模型输入、写入获批后撤权、下一次模型请求前撤权，以及个人模式零组织请求。

桌面脚本 `node --import tsx scripts/org-knowledge-k2-e2e.mjs` 使用隔离 PostgreSQL、实际 Electron、实际注册／浏览器同意及本机需求工作流。
知识创建、发布、选择、填写理由、生成计划和撤销均通过可见控件操作。项目／模型设置仅通过既有具名 API 准备测试夹具。
脚本拦截系统浏览器打开动作，在隔离 Electron 浏览器窗口完成真实授权协议；未将此称为操作系统默认浏览器人工验收。
模型为本地确定性 SSE 夹具，确实收到旧业务版本和技术正文，未收到后续业务版本；不宣称真实外部模型质量验收。
撤销后任务审批失败，任务数仍为零，重启恢复相同固定引用。

## 命令结果

逐项真实记录见 [checks.json](checks.json)，每个命令关联原始日志。结果只在命令退出后记录。

| 命令 | 结果 | 原始输出 |
| --- | --- | --- |
| `pnpm lint` | PASS，0 error／45 个既有 warning，依赖边界通过 | `lint-1.log` |
| `pnpm typecheck` | PASS | `typecheck-1.log` |
| `pnpm run test --maxWorkers=2` | PASS，676 passed／4 skipped；113 文件通过、2 文件跳过；579.38s | `test-1.log` |
| `pnpm build` | PASS，Runtime／Desktop／Server | `build-1.log` |
| `node --import tsx scripts/org-knowledge-k2-e2e.mjs` | PASS，97 项检查／40 个 axe 状态；53 张正式截图 | `knowledge-desktop-1.log` |
| `node docs/v2/evidence/organization-knowledge-k2/run-approved-dag.mjs` | PASS，现有批准 DAG 32/32；像素诊断的既有徽标问题另列 | `approved-dag-regression.log` |
| `node --import tsx docs/v2/evidence/organization-knowledge-k2/run-knowledge-contrast.mjs` | PASS，137 项检查，40 状态／568 个文字样本，最低 4.944:1 | `composited-contrast.log` |
| `node scripts/e2e.mjs` | PASS，桌面创建与重启恢复 | `desktop-e2e-1.log` |
| `node scripts/agent-e2e.mjs` | PASS，真实审批暂停、批准写入、继续执行 | `agent-e2e-1.log` |
| `node scripts/v12-e2e.mjs` | PASS，设置、连接与 Native 路径 | `v12-e2e-1.log` |
| `node scripts/v13-e2e.mjs` | PASS，扫描、计划、真实 DAG、布局与恢复 | `v13-e2e-1.log` |
| `pnpm package:dir` | PASS，实际 Windows 解包程序 | `package-dir-1.log` |
| `pnpm test:package` | PASS，实际 EXE 创建项目、生成文件、重启恢复 | `package-smoke-1.log` |
| 过时 `node scripts/design-lab-e2e.mjs` | FAIL，默认 DAG 中查找已移除的阶段专属元素；后续还要求已被拒绝的 Modal | `design-lab-1.log` |
| 过时 `node scripts/design-lab-contrast.mjs` | FAIL，等待旧阶段任务定位超时 | `design-contrast-1.log` |

根要求的十条功能／构建／打包检查均已实际通过。两个历史视觉入口的 FAIL 原样保留；
当前视觉功能使用现有 `premium-lab-e2e.mjs` 的未改动断言，补充原生画面对比度测量。
两个证据包装器仅重定向输出／模块导入位置；对比度包装器另加严格 4.5:1 断言，未删除原断言。
原脚本校验值与具体改写记录见 `approved-dag-harness.json` 和 `composited-contrast-harness.json`。
证据包装器与最终编排脚本的定向 lint 均通过，见相应 `*-lint.log`。

4 项跳过为既有 OpenCode／DeepSeek 外部 Harness 的 3 项，以及未启用 SSH/VPS 环境的 1 项。
定向测试与首轮桌面链路已通过；失败定位与修正见 [INVESTIGATION.md](INVESTIGATION.md)。

首轮受测源码摘要：`6773423e5e9260f790bc13a4829e49510f067151326c3a2ed6d47aecaa2299da`。
[source-manifest.initial.json](source-manifest.initial.json) 保存 737 个受测源文件的 SHA256，文本统一 CRLF→LF，二进制保留原字节。
随后只修正 `scripts/org-knowledge-checks.mjs` 的过时视觉入口和逐轮清单保存，定向 lint 通过；
产品及原有功能测试的其余 736 个文件均未变化。最终摘要为
`b9bec407b76ac7ba90385796a9c2108c2e07a2d58f34ad6de5d7b5627f5b1035`，后续六条必需检查记录对应的具名清单。
首轮编排原文、逐文件差异和核对结果见 [source-verification.json](source-verification.json) 与 INVESTIGATION.md。
报告和证据包装器在 `docs/` 补充，不更改产品实现。正式命令顺序运行，未放宽测试超时。

[artifact-hashes.json](artifact-hashes.json) 记录 125 个构建／程序文件的实际 SHA256 与大小。
打包前后的 122 个受测 Runtime／Main／preload／Renderer／Server 文件完全一致，打包 Runtime 与受测构建一致。
实际程序位于 `release/win-unpacked/ProjectOS.exe`；本轮验证的是解包程序，未声称新的安装器部署或生产上线。

## 视觉与可访问性

五个新增界面状态各覆盖 1440×900／1024×768、浅／深色、100%／125%，另保留编辑器底部可达截图。
实际文件见 [screenshots/README.md](screenshots/README.md)，逐状态布局与 axe 结果见 [desktop-checks.json](desktop-checks.json)。
截图已人工抽查资料列表、编辑、详情、选择器、引用列表和旧版 DAG；视觉验收不由单元测试结果推断。
原有 Design Lab 前后 PNG 逐字节相同，正式桌面回归结束后再次核对哈希；详见
[protected-baseline-comparison.json](protected-baseline-comparison.json)。旧程序与 K1 发布文件的实际核对见 baseline-package-provenance.json。
Impeccable 检测实际运行一次，返回空发现列表，见 [impeccable-detect.json](impeccable-detect.json)。

新增页面的 40 个 axe 状态均为 0 violations，`color-contrast` 均为 incomplete，不能计为 axe 自动通过。
因此另以实际 Electron 合成背景采样 568 个可见文字样本，40 状态全部 ≥4.5:1，最低 4.944:1；
原始测量、正常截图与汇总位于 `composited-contrast/`、[composited-contrast-summary.json](composited-contrast-summary.json)。
该采样排除禁用、SVG、遮挡／屏外文字与编辑器词法颜色，不是完整 AA 认证。

当前批准 DAG 的功能／axe 回归为 32/32；其独立像素诊断发现既有浅色“待批准”徽标为 4.46:1，
低于保守的 4.5:1 阈值。深色 DAG 与两种检查器主题分别最低 5.21／4.94／5.52。
该徽标属于逐字节未变化的批准基线，已记录至 OPEN_ISSUES，留待独立视觉复核；未用功能 PASS 覆盖这项诊断。
本轮不声称 WCAG 全面认证或新 GPU／真实折射性能验收。设计来源、接受／拒绝的建议和不可用工具均记录于 DESIGN_CHANGELOG。

## 剩余边界

- K3 成果审核回写、K4 按成员派发和 K5 双桌面完整闭环尚未实现。
- 引用组织资料的需求使用 Native Agent；外部 CLI 无法执行本阶段的权限复验，因此被明确拒绝。
- 组织资料不离线缓存。开始后若需换资料集，应创建新需求；当前不提供运行中更换来源。
- 检索沿用 K1 的字面子串与标签；无附件、网页抓取、外部连接器、向量检索或大规模知识库性能结论。
- 本轮不升级用户组织数据库或部署生产服务。共享服务需使用支持精确解析的 K2 服务构建；SQLite 只追加迁移 45。
- 模型生成的分析／产物仍按原有规则持久化，可能引用资料内容；“不保存正文”指源资料注入与引用审计，不意味着自动脱敏模型输出。
- 用户原有私人邮箱截图和 `pelican-bicycle-2d.html` 保持未跟踪，未纳入交付。
