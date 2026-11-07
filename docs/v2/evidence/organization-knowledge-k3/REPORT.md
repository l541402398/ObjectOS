# K3 已验收成果的知识候选、审核与发布复用

日期：2026-11-07（America/Los_Angeles）。基准 HEAD：
`c011d95c17926b37c978c59f8133d6666241f3ec`。
分支：`codex/organization-knowledge-k3`。实现、ADR、本报告、真实日志和截图随同一提交保存；
最终提交以本文件所在的 Git 提交为准。

## 实现与使用入口

- 在需求的“组织资料”标签进入“成果验收与知识回写”。独立整体验收绑定需求／任务版本、当前 Git、
  可信人工审查、实际测试及已完成运行生成的有效产物；绑定工作流时还检查当前节点和材料。
  普通 `implemented` 标记、用户手建产物或演示数据不能替代这些证据。证据改变使旧验收失效。
- 未登录也能本地验收。登录不自动分享；用户选择产物，将其确定性整理成草稿，再编辑正文、分类、标签和
  目标项目，最后确认本次分享。此整理不是模型生成摘要。当前最多八个产物、20 个任务；候选连同来源不超过 60KB。
- 组织设置 → 账号与组织 → 组织知识 → 知识审核。候选保持项目私有；提交者可以查看自己的候选。
  审核要求组织知识发布能力和独立项目资产管理权限，不能仅凭组织管理员身份读取未授权项目。
- 待审核／退回／已发布内容不可覆盖。退回意见保留，修改后提交新候选。审核可新建文档，或选择同项目、
  同类型文档的精确当前版本进行更新。发布版本与候选结案在同一事务中完成。
- 显示相似标题、相同规范化内容校验值、同次验收来源的相关资料，最多十条。重复内容需要人工确认；
  这是有界字面与校验值提示，不是语义去重或自动合并。标题／正文／标签共同参与内容校验。
- 本地提交在 HTTP 前保存固定作用域、固定正文和来源，以及已确认的 Run／ToolCall／Approval。
  请求结果未知则待核对，不自动重发；GET 可找回同标识回执。显式重试仍使用同一标识与内容，重新检查
  当前验收和组织账号。相同需求存在未核对提交时，阻止另建候选绕过核对。
- 发布结果未知时冻结原审核决定，先读取候选核对；显式重试使用原决定。服务端幂等键、不可变终态和精确
  目标版本共同防止重复发布或覆盖并发更新。新需求可通过 K2 检索并固定引用已发布版本。

Main 从 Runtime 收集来源，Renderer 不能提交伪造的验收／运行／提交记录；秘密仍只在 Main。
结构化来源仅包含标识、版本、哈希、提交与人工验收说明，无根目录／URI 字段。任意自然语言正文、
产物标题及说明仍需人工检查，不能据此声称自动脱敏。组织服务标记为 `desktop-owner-attested`，
不宣称独立验证了用户本机代码。验收不代替项目主分支合入或生产发布授权。
为保证核对与同标识重试，确认分享的固定候选正文会保存在本机提交记录中；
这不是自动拉取组织源资料的离线缓存，也不能据此声称 SQLite 永远不含用户明确保存的知识正文。

决策：[ADR-0086](../../../adr/0086-reviewed-knowledge-writeback.md)。
方案：[K1–K5](../../../org-upgrade/KNOWLEDGE_AND_ASSIGNMENT_PLAN.md)。

## 实际验证的范围

真实 PostgreSQL／HTTP 测试覆盖迁移 6、组织／项目权限、候选隐私、不可变内容、退回、幂等提交与审核、
重复确认、并发目标版本冲突、撤权后排队请求及服务重启。SQLite 仅追加迁移 46；旧迁移保持原字节。
本地真实 Git、测试进程和 Native 产物验证独立验收、陈旧证据拒绝、审批审计、未知结果及同标识显式重试。
Main 测试覆盖 Renderer 伪造来源、请求期间切换组织、已提交但回执丢失以及重启 GET 核对。

桌面脚本 `node --import tsx scripts/org-knowledge-k3-e2e.mjs` 运行实际 Electron 与隔离 PostgreSQL。
夹具通过具名 API 准备本地代码／工作区；两个实际 Native 工作流 Agent 产生持久化产物，再执行实际测试、
人工内容审查与单独批准的 Git 合入。K3 验收、编辑、分享、退回、审核发布及下一需求选择均操作可见控件。
实际服务事务成功后刻意丢弃提交／发布 HTTP 回执，再验证读取核对且 POST 次数不增加。
后续需求的真实模型请求包含审核发布正文及精确版本，重启后保留固定引用、两个提交回执，且不自动重放。

模型是本地确定性 SSE 夹具；不宣称外部模型质量或自主开发能力。实际授权协议在隔离 Electron 浏览器窗口
完成，未称为操作系统默认浏览器人工验收。失败尝试与修正完整记录在 [INVESTIGATION.md](INVESTIGATION.md)。

## 正式检查结果

逐次实际退出结果见 [checks.json](checks.json)，首轮失败保留，未从截图或定向测试推断全量通过。

| 命令／检查 | 实际结果 | 原始输出 |
| --- | --- | --- |
| `pnpm lint` | PASS，0 error／47 warning；依赖边界通过 | `lint-final-harness.log` |
| `pnpm typecheck` | PASS | `typecheck-2.log` |
| `pnpm run test --maxWorkers=2` | PASS，115 文件通过／2 文件跳过；693 测试通过／4 跳过；646.59s | `test-2.log` |
| `pnpm build` | PASS，Runtime／Desktop／Server | `build-1.log` |
| K2 旧程序哈希核对 | PASS，EXE／ASAR／Runtime 三项一致 | `baseline-package-2.log`、`baseline-package-provenance.json` |
| 受测构建哈希记录 | PASS，235 文件 | `tested-build-1.log`、`tested-build-hashes.json` |
| `node --import tsx scripts/org-knowledge-k3-e2e.mjs` | PASS，187 项检查／56 个视觉与 axe 状态；64 张截图 | `knowledge-desktop-3.log` |
| `node docs/v2/evidence/organization-knowledge-k3/run-approved-dag.mjs` | PASS，原断言 32/32；像素诊断另列 | `approved-dag-1.log` |
| `node scripts/e2e.mjs` | PASS，项目创建与重启恢复 | `desktop-e2e-1.log` |
| `node scripts/agent-e2e.mjs` | PASS，真实审批暂停、批准写入与继续执行 | `agent-e2e-1.log` |
| `node scripts/v12-e2e.mjs` | PASS，设置、连接与 Native 运行 | `v12-e2e-1.log` |
| `node scripts/v13-e2e.mjs` | PASS，扫描、计划、真实图、布局与恢复 | `v13-e2e-1.log` |
| `pnpm package:dir` | PASS，Windows x64 解包程序 | `package-dir-1.log` |
| `pnpm test:package` | PASS，实际 EXE 创建项目、写入文件与重启恢复 | `package-smoke-1.log` |
| 打包后构建核对 | PASS，235 文件无变化，打包 Runtime 等于受测构建 | `artifact-verification-1.log`、`artifact-hashes.json` |
| 最终测试脚本／证据工具定向 lint | PASS | `final-evidence-lint.log` |
| 最终源码、截图、命令与构建汇总核对 | PASS | `final-evidence-verification.log`、`phase-summary.json` |
| 全页渲染设计检测 | 退出码 2，11 条诊断保留，不能称为无发现 | `impeccable-rendered.json` |
| 批准 DAG 原生对比度诊断 | 既有浅色徽标 FAIL，4.459:1；其他三种样本 ≥4.5 | `approved-dag-regression/checks.json` |

根要求的十项构建／功能／打包命令已实际通过。四项跳过是外部 OpenCode／DeepSeek Harness 的三项，
以及未启用 SSH/VPS 环境的一项。首轮全量失败和两个正式桌面失败未删除，详见 INVESTIGATION.md。
原始过时阶段视图脚本的 K2 失败不在本轮重复执行，也没有为它们改动批准 DAG。

最终 747 个受测源文件的摘要是
`5f0f8ad7a5e6b34e02444cb001046c13c6881f7330e2a8bad1fdef23a765965f`；
文本 CRLF→LF，二进制保留原字节，清单见 `source-manifest.json`。
完整测试通过时的摘要为 `70cc768b331a7060b7acce4f08c333fa1e24b99ac2ce044e5ae965d4f4531ce5`。
之后唯一源文件变化是 `scripts/org-knowledge-k3-e2e.mjs`：统一 CDP 启动参数、加强完整审核正文断言、
保留设计诊断并分离其退出码。其余 746 文件（包含全部产品代码和单元测试）保持一致；
执行了再次根 lint、最终脚本定向 lint及完整桌面／打包序列，没有无理由重复单元测试。
四轮清单及逐文件差异见 `source-iterations.json`，最终源码未再变化见 `source-verification.json`。

`artifact-hashes.json` 保存 238 个实际文件的哈希与大小，包含受测构建、EXE、ASAR 和打包 Runtime。
实际程序位于 `release/win-unpacked/ProjectOS.exe`。本轮不声称新安装器部署、代码签名资质或生产上线。

## 界面与剩余验证边界

新增七组状态覆盖 1440×900／1024×768、浅／深色、100%／125% 应用缩放；目录见
[screenshots/README.md](screenshots/README.md)。axe 和原生合成画面对比度逐状态记录在
[desktop-checks.json](desktop-checks.json)。187 项桌面检查通过，保留 64 张正式原生截图；
56 个 axe 状态均为 0 violations，但 `color-contrast` 全部为 incomplete，不计作 axe 对比度通过。
另测 610 个可见文字样本，最低 4.615:1。人工抽查了编辑器、放大窄窗、分享底部、内联审核及已发布结果，
并对照修正前间距截图；不是由单元测试推断视觉接受。
原生采样覆盖可见文字，排除禁用、SVG、遮挡／屏外文字及编辑器词法颜色，不是完整 AA 认证。
新增界面复用批准材料、字体、焦点和减少动效规则；没有改动受保护的 Design Lab 组成。
当前批准 DAG 回归 32/32；一致启动参数下前后 PNG 逐字节相同。其功能与像素诊断分别报告，
既有浅色“待批准”徽标 4.46:1 的 K2 问题仍保留。

源码设计检测为 `[]`；实际 CDP 全页检测退出码 2，输出 11 条诊断（8 warning／3 advisory），
见 `impeccable-rendered.json`。逐选择器上下文 `impeccable-rendered-context.json` 确认全部位于新表单之外；
低对比度文字选择器在弹窗开启时位于隐藏的背景可访问性子树。五项青色渐变建议与批准的玻璃方向冲突，
不作为更换配色的依据；背景对比度估算、卡片和全局 easing 提示保留在 OPEN_ISSUES，需在对应活动页面另验。
“检测完成”检查不代表这些诊断已经修复或全页质量通过。使用过的设计来源及不可用加载工具见
[DESIGN_CHANGELOG](../../../design/DESIGN_CHANGELOG.md)；没有新 GPU 认证。

- 本阶段没有实现 K4 按成员派发或 K5 两台桌面／生产部署。没有自动模型提炼、附件摄取、向量检索、
  外部连接器、自定义审核人策略、审核人必须异于提交人策略，或项目知识直接提升到组织公共范围。
- Native 执行与 K2 权限复验保持原样；外部 CLI 不增加组织资料支持。组织源正文不离线缓存；模型输出仍可能
  引用原资料，人工分享确认不能视为自动消除全部敏感内容。
- 验收针对需求分支，不改变已有需求状态、主分支合入或部署语义。验收成功不等于需求已经生产上线。
- 已有知识的新版本、重复内容和版本冲突通过真实 PostgreSQL／HTTP 验证；本轮完整桌面点击链路使用新文档发布。
  没有声称新版本下拉分支、20 任务上限组合或全部权限排列都完成独立截图矩阵。目标版本冲突后，
  核对服务器状态并重新打开候选、载入目标版本后再审核；未知决定不会自动变更。
- 没有新 GPU／真实折射性能结论、大型组织库吞吐结论、物理 Windows DPI／触屏／读屏器人工验收或生产数据库升级。
  服务需使用含迁移 6 的 K3 构建；真实共享服务升级、TLS、备份和双设备验收留到 K5。
- 用户原有私人邮箱截图和 `pelican-bicycle-2d.html` 保持未跟踪，不纳入本次交付。
