# 需求继承流程：实施与验收记录

工作分支：`codex/premium-system`。基准 HEAD：`f71d33e8acd70ec579501873c327e5b1180ee02a`。
这是当前未提交工作区的增量实施，不是一个新演示项目。没有重置、覆盖此前工作、提交、推送、合并或发布。
源文件、截图和构建产物指纹见 `manifest.json`；旧 A3.1 / A3.2a 证据保持冻结。

## 已落实的产品行为

| 用户要求 | 当前实现 |
|---|---|
| 整体移除 UC | 活跃类型、任务字段、读写 API、preload、Runtime 和界面不再使用 UC。V42 将旧分组说明保留为需求资料，并保留原任务关联与历史审计记录，然后移除旧表/列。 |
| 创建需求时选择或创建流程 | 同一新建需求弹层中选择现有模板，或进入内联流程编辑器保存新模板，再返回原表单。 |
| 每个任务继承所选流程 | 手工创建、Agent 创建、AI 计划审批创建都通过同一任务持久化路径生成节点实例。计划与任务依赖原有事务保持。 |
| 自由组合节点 | React Flow 拖入、点击添加、拖动位置、端口连线、前置节点选择、编辑要求、移除、适应画布；拒绝循环/不存在的依赖。保存真实图和布局。 |
| 提供初始流程 | 标准开发流程：需求分析→需求审核→技术设计→设计审核→开发→测试；另有轻量开发和需求梳理模板。节点库额外提供代码审查、知识更新。 |
| 节点分别分配 Agent | 手动在任务详情选择每个节点的真实 Agent；AI 分配使用当前模型服务，校验全量结果和 Agent 可用性，记录请求、结果与用量。自主模式的新任务会自动触发分配。 |
| 节点实际执行 | 复用原 AgentRunner、协调器、任务租约、Run/ToolCall/Artifact。文档需真实正文；审核需覆盖输入文档的结论；测试需实际命令成功且代码未变化。 |
| 资料双入口 | 需求页顶部的实际流程旅程点击节点阅读正文；Agent 协作图点击 Agent，在原详情面板阅读其流程产出、版本与执行次数。 |
| 减少中间操作 | 需求直接产生任务；开始流程合并准备工作区入口；授权在当前上下文处理；已开始流程在已知完成边界继续下一节点；日志和原任务验收页仍可到达。 |

模板版本不可变，执行中的需求固定使用选定版本。节点布局只是展示；持久化依赖决定执行。
重试为显式操作，会使相关后续产物进入历史；拒绝、失败、待核对不会被改成成功。
计划确认、文档审核、任务验收、测试命令授权与 Git 合入授权仍是不同事实。

实现依据：ADR-0075（过渡）和 [ADR-0076](../../../adr/0076-requirement-owned-workflows.md)。
本批扩展真实业务流程，非纯视觉迁移；没有在换主题时夹带数据/授权变更。

## 界面与对比

保留用户恢复的蓝青玻璃、已有中文字体与语义变量，不引入新的视觉主题。
需求列表在窄窗收为选择器；顶部显示所选节点名称及真实状态；任务区采用行列表。
节点详情按需展开，窄窗口排在任务列表之前且可以收起。编辑器连接提供键盘替代入口。
新建需求先读取实际工作模式，避免将尚未到达的自主配置误当手动默认值。
流程编辑使用现有弹层关闭保护；装饰图标不加入控件名称。六节点模板默认采用三列两行；
画布缩放不把少量节点放大成巨型卡片。1024 窗口的 125% 应用缩放下允许纵向滚动，保留明确滚动条。

- 历史真实产品画面：[改造前的需求/分组工作台](../requirement-work/requirements-1440-light.png)
- 当前：[1440 浅色](desktop/workbench-1440-light.png)、[1440 深色](desktop/workbench-1440-dark.png)
- 窄窗：[1024 浅色](desktop/workbench-1024-light.png)、[1024 深色](desktop/workbench-1024-dark.png)
- [拖拽编辑器](desktop/flow-editor-1440-light.png)、[AI 任务草稿确认](desktop/requirement-plan-1440-light.png)
- [完整六阶段模板](editor/six-stages-1440-light.png)、[六阶段深色](editor/six-stages-1440-dark.png)、[1024 / 125%](editor/six-stages-1024-dark-125-reduced.png)
- [旅程中的真实正文](desktop/journey-material-1440-light.png)、[Agent 详情中的正文](desktop/agent-material-1440-light.png)
- [上下文授权](desktop/workspace-approval-1440-light.png)、[未分配 Agent 的实际错误](desktop/assignment-error-1440-light.png)
- [代码审查与验证](integration/review-1440-light.png)、[合入后](integration/review-integrated-1440-light.png)

截图来自 Electron `webContents.capturePage()`。测试项目、模型回复均明确标识为验收数据；
文档由真实 Runtime 工具写入真实 SQLite，工作区与合入使用真实 Git，不是设计原型截图。

## 检查记录

命令和原始输出在 `logs/`；最终输出复制为可随仓库保存的 `.txt`，不依赖被忽略的 `.log`。
原生明细见 `desktop/checks.json`、`integration/checks.json`、`editor/checks.json`。
合计 **74 项原生检查、41 张本批最终真实截图**；早期 `failure.png` 仅为诊断，不计为验收截图。

| 命令 | 实际结果 | 输出 |
|---|---|---|
| `pnpm typecheck` | PASS | [typecheck-delivery.txt](logs/typecheck-delivery.txt) |
| `pnpm lint` | PASS；0 错误，24 项原有警告；依赖边界通过 | [lint-delivery.txt](logs/lint-delivery.txt) |
| `pnpm package:dir`（包含完整 `pnpm build`） | PASS；Runtime、桌面、服务端构建及 Windows 目录打包 | [package-final.txt](logs/package-final.txt) |
| `pnpm test:package` | PASS；打包 EXE 新建项目、写入初始文件、重启恢复 | [package-smoke-final.txt](logs/package-smoke-final.txt) |
| `pnpm run test --maxWorkers=2` | **FAIL：613 PASS / 1 超时 / 4 SKIP**，不是一次全绿 | [test-full-flow-2.txt](logs/test-full-flow-2.txt) |
| `pnpm exec vitest run tests/requirement-integration.test.ts --maxWorkers=1` | PASS，15 / 15；包含上述超时用例 | [integration-unit-final.txt](logs/integration-unit-final.txt) |
| `pnpm exec vitest run tests/requirement-flow.test.ts tests/p27-autonomy-coordinator.test.ts --maxWorkers=1` | PASS，18 / 18；包含最后的自动分配保留人工选择修正 | [flow-unit-final.txt](logs/flow-unit-final.txt) |
| `node scripts/e2e.mjs` | PASS | [e2e.txt](logs/e2e.txt) |
| `node scripts/agent-e2e.mjs` | PASS | [agent-e2e.txt](logs/agent-e2e.txt) |
| `node scripts/v12-e2e.mjs` | PASS | [v12-e2e.txt](logs/v12-e2e.txt) |
| `node scripts/v13-e2e.mjs` | PASS | [v13-e2e.txt](logs/v13-e2e.txt) |
| `node scripts/requirement-flow-e2e.mjs` | PASS，40 项，20 张截图 | [desktop-final.txt](logs/desktop-final.txt) |
| `node scripts/requirement-integration-e2e.mjs` | PASS，28 项，17 张截图 | [integration-flow-2.txt](logs/integration-flow-2.txt) |
| `node scripts/requirement-flow-visual-e2e.mjs` | PASS，6 项，4 张截图 | [editor-final.txt](logs/editor-final.txt) |
| `pnpm exec eslint scripts/requirement-flow-visual-e2e.mjs` | PASS；完整 lint 后新增的验收脚本单独检查 | [editor-script-lint.txt](logs/editor-script-lint.txt) |

全量测试的失败项是 Git 合并后中断恢复用例超过原有 30 秒限制；当时有桌面回归并行运行。
独立重跑整个相关测试文件 15 项均通过，没有提高超时阈值或删弱断言。资源竞争是推测，不能据此
将全量失败改写为通过。最后的 AI 自动分配修正后执行 18 项相关测试、类型检查、lint、构建和原生回归；
没有再执行第三轮全量测试。

拖拽编辑器与工作台检查浅/深主题、1440×900、1280×800、1024×768、axe 与横向溢出。
成果审查检查六种尺寸/主题、长内容滚动/截断、过期证据失效、授权前不写 Git、重启恢复及后续任务基线。
自动填写只补全未分配节点，不覆盖用户已经选择的 Agent；显式“AI 分配”才会重选尚未执行的节点。
125% 是应用缩放；减少动效、键盘焦点可达检查随截图记录，不冒充系统 DPI 实测。
Impeccable 源码 detect 输出 `[]` 只代表该检测器未命中规则，不能替代视觉与无障碍验收。

早期失败及修复：React Flow 的受控节点丢失测量尺寸造成隐藏；连接手柄的无角色 aria-label；
工作区完成事件的历史封装未唤醒协调器；清理字段时两处无关 SQL 占位符受影响；测试中旧分组断言。
这些均定位后修正。首轮受限环境还无法正常启动 PostgreSQL/tsx 子进程，获准后真实重跑。
桌面脚本的异步等待也改为逐次等待真实 API 结果；旧审查页外部改动测试使用明确刷新，避免依赖缓存。

## 实际设计来源

- 读取仓库要求的设计契约、材质、共享组件/弹层、迁移/视觉调查及已批准基线，沿用现有令牌与字体。
- UI UX Pro Max：读取本地 SKILL 并查询 typography/color/layout/dragging/keyboard/reduced motion，输出见 `logs/design-*.txt`。
  Noto Sans SC、拖拽的点击/键盘替代、焦点与窄窗适配与本任务相符。首个颜色结果是母婴产品，不适用；
  精炼后的 IDE 绿强调色也不替换用户冻结的蓝青主题。字体继续本地打包，不加载 Google Fonts。
- Vercel：读取本地 composition-patterns 与 react-best-practices；组合独立表单、编辑器、资料面板与已有弹层，复用查询缓存。
- Impeccable：读取本地 SKILL、craft-floor 与 audit 指南；本会话 context 已执行，不杜撰 PRODUCT.md；再次实际运行源码 detect。
  技能专用 loader 未暴露，以上为真实本地文件/脚本读取，不宣称调用了不存在的工具。
- Sim：实际阅读 `docs/design/product-workbench/sources/sim-workflow-controls.tsx.txt` 与既有工作流画布实现；
  参考集中工具栏/选中节点检查方式，不复制品牌或引擎。React Flow 测量机制读取已安装源码后修复。
- Liquid Glass React / React Bits Aurora：保留已有安装、来源与许可，沿用之前的 Electron 兼容性限制；新页没有启用新的滤镜或装饰动画。
- Motion：复用既有 overlay-shell 的 Motion 和减少动效处理；本批无额外持续动画。

## 边界与未完成项

1. 这批流程执行支持原生 Agent。外部 CLI Runtime 尚未接入流程产物协议，明确拒绝该启动路径，不能声称所有执行引擎通过。
2. 顶部可点资料的流程旅程在需求工作台；其他页面原有项目目标旅程仍保留，未把两类阶段混成一个进度。
3. 自主模式的 Agent 分配已接入；新需求任务流程由用户开始后连续推进。整条需求的自动验收/发布、旧计划授权驱动的新流程自动启动仍是后续项。
4. 单任务内节点遵守现有写租约逐个执行；任务间可并行。模板没有任意脚本/自定义执行引擎插件。
5. 插件式 Agent 组合、设置整理、需求整体验证/交付、已准备任务目录自动追上新基线、冲突解决界面仍未完成。
6. 本机真实外部模型生成质量、OS 125% DPI、人工读屏、触屏拖动、新 GPU/FPS 测量、用户最终审美验收未验证。
7. 手工模式目前按任务选择节点 Agent；需求级批量分配仍可进一步减少重复操作。

## 启动

在当前工作目录运行 `pnpm start` 使用构建后的桌面；开发方式为 `pnpm dev`。
也可直接启动仓库内 `release/win-unpacked/ProjectOS.exe`（已完成本批打包与重启恢复检查，未发布）。
进入项目 → 需求工作台 → 新建需求 → 选择/创建流程 → 手工添加或 AI 拆分任务 → 分配 Agent → 开始流程。
按实际提示批准必要操作；从顶部节点或 Agent 详情阅读真实资料。
