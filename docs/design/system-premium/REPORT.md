# 全系统 Premium Liquid Glass 改造与易用性修复

状态：本轮工程实现与原生桌面回归完成，供用户视觉复核；不宣称主观审美已获批准。
基础 HEAD：`7746a49b53875ce33107f99623da0409dc1137f5`，分支 `codex/premium-system`。

## 视觉授权与边界

依据 ADR-0070、0071 及本会话用户的明确要求实施。唯一视觉方向为
`../baselines/2026-10-29-user-confirmed-DAG.png`（SHA256
`9461548a137c95c44b2f07b76382a8da4e76a671d0df8c0585b7fe2d7419c9af`）。
保留光学玻璃、冷色空间、细边框、紧凑图节点与真实产品菜单；不采用被否定的 R1 Modal。
本轮仅 Renderer、共享 UI/设计令牌及验收脚本；没有改变 Runtime、调度、审批、数据库或服务器行为。

## 用户反馈与实际修复

- 材质混杂：移除旧 v16/v17 对全局壳的重复覆盖，历史颜色族映射至统一语义令牌。
  导航、页面与设置/表单/检查器/确认框共用同一视觉层。玻璃用于空间结构，文字工作面保持清晰。
- 不协调：原生字体检查证明并非字体完全丢失，而是两套字体栈、37.44px 的首页目标标题与
  12.5px 的关键待办标题，以及 34/36px、7/11px 的按钮尺寸并存。统一到批准 Lab 的字体栈、
  26/24/16/14/13/12px 的职责层级、36px 常规控件和 10px 圆角；删去首页重复点阵和段落英文标牌。
- 功能关系：版本规定交付范围；迭代通过 `versionId` 属于版本，简单项目可以直接安排任务；
  环境通过 `projectId` 由项目共用。版本形成发布包，发布包部署到环境的实际目标。
  环境创建保留原有 API，入口归到部署中心；版本页突出范围、迭代和按需展开的门禁。
- 空部署页：依据真实发布包/环境/目标数量显示准备步骤和下一步行动，避免空三栏与不可操作按钮。
  现有部署历史、执行、审批、验证、对账与回滚保留。目标选择按当前环境过滤。
- 保留辅助/自主/托管三种模式，首页与待办面板共用已持久化设置；不增加自动批准或授予权限。
  首页可以直接提出需求，下一步来自现有持久化待办和项目旅程。其他待办按需展开。
- 页面切换：路由提前读取目标页所需数据并复用现有查询缓存，读取时保留上一页；移除整页文字淡入，
  支持中断和快速再次导航。错误仍由页面显示，不把读取失败解释为无数据。
- 用户后续明确指出字体仍锐利、单调。实际平台字体检查发现缺失的 `--pw-font`/`--pw-mono`
  使审批代码区落到新宋体（NSimSun），不是审美猜测。现补齐映射，并打包完整 Noto Sans SC
  可变字体，中文、英文、数字共用字形体系；代码保留平台等宽字符并显式为中文指定同一字体。
  任务卡片仍残留的 12.5px 标题改为 14px，面板/卡片标题为 550、页标题为 600、正文为 400。
  文字主色由 `#22304D` 调整为 `#2C3B56`；卡片、设置与抽屉用轻微冷紫/蓝色阅读层替代纯白大面。
  原批准 DAG 的外框、空间配色、实线图和信息结构保留；此调整依据用户明确后续反馈。
- 加载问题继续修至具体读取：运行页原预读 50 条而实际使用 100 条；资源页、文件正文及设置分类
  还有缺项。现在准备相同查询键与依赖读取后再切换，任务/运行详情也在内容就绪后打开。
  快速切换采用最近选择，关闭取消迟到的打开，删除任务详情延迟 320ms 清空状态的竞争。
  首次挂载前等待本地字体，避免字体度量变化。项目中心也准备最近项目的成员摘要。
  八个延迟读取测试覆盖先后顺序、取消与错误保留；
  另以真实 IPC、首次进入和 4 倍 CPU 降速逐帧检查，见 `readiness/checks.json`。
- 协作图：保留绘图连线及真实节点，选中/运行关系支持有方向的有限脉冲（最多 12 条）、暂停与实时
  减少动效。动画不代表工具已执行。原 40,000px 掩膜改为实际图范围。原生对照进一步发现主要瓶颈是详情的全屏模糊遮罩：
  暂停脉冲后仍约 10fps，去掉滤镜约 56fps。改用无背幕 Inspector 后，实际脉冲与暂停均约 62fps。
  对照数据见 `before/font-and-overlay-performance-audit.json`，最终结果见 `usability/checks.json`。
- 弹层：表单与命令式确认统一至共享 Shell；稳定注册/焦点处理；下拉菜单留在所属表单焦点范围。
  连接和模型表单的校验错误留在表单，不再成为未捕获 Promise 异常。
- 实际截图复查修复了首页窄屏按钮挤压统计、运营操作栏溢出、通知列表撑宽、导航横向滚动条、
  125% 下真实计划高度超出画面，以及改变尺寸后 DAG 保持旧镜头的问题。
  审批主文标题固定为 24px / 1.4，避免随窗口长到 32px；正文为 14px。
- 人工逐页对照发现概览仍加载旧风景图、34px 标题及文字阴影；删除这段历史样式，回到共享 PageHeader。
  知识库也改用同一 PageHeader；设置概览删除无功能的 LIQUID GLASS 标牌及重复标题。
  协作图提示条会遮住节点，现移入独立工具栏，画布和关系投影共用剩余的实际视口。
- 第二轮完整弹层回归复现真实计划节点偶发不可见，单独重放未复现。检查安装的 React Flow 实现，
  确认未测量节点会被设为 hidden；补齐与 ELK/CSS 一致的初始尺寸，避免只依赖首个 ResizeObserver 通知。
  新增每个窗口/主题/缩放状态的逐节点可见性检查。原失败和单独重放日志分别在
  `diagnostics/second-overlay-matrix.json`、`diagnostics/plan-visibility-reproduction.txt`，
  最终完整重跑记录为 `validation/premium-overlays.txt`。不把单次未复现解释为问题消失。
- 全矩阵还发现暗色主按钮被历史 `!important` 强制为白字，以及取消子确认框时设置父窗口被关闭。
  已移除冲突颜色规则，并限制只有最上层弹层能触发关闭。原失败项保存在
  `diagnostics/first-matrix-findings.json`，不以最终成功记录覆盖历史问题。

## 五项 Lab 前置要求

1. 本轮证据与设计记录随提交保存；用户截图优先于历史冲突说明。
2. 阶段路线图标与曲线共用坐标，只有图标与聚焦/悬停提示。
3. 正文及辅助标签提高可读性，使用原生合成背景抽样补充 axe。抽样工具不是 WCAG 认证。
4. DAG 使用实线圆角连接；选中路径静态强调，不对整个计划图循环动画。
5. 任务检查器保留全部可编辑字段、依赖校验与连续输入焦点；生产计划使用真实 Agent 和能力选项。

## 实际查阅的设计来源

- UI UX Pro Max：`.tmp/reference-uiux`，commit `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03`。
  查询字体、颜色、布局、可访问性与动效；拒绝偏离冻结玻璃方向的替代配色和在线字体加载。
  最终核对的五组原始查询保存在 `diagnostics/uiux-*.json`：采用文本重排、可见焦点、减少动效；
  不采用金融/绿色 CTA 配色、Noto 线上加载或繁体衬线组合。移动触控间距建议只作参考，
  不覆盖本桌面基线；协作流向是一个整体关系视图，按选中/运行边限量与暂停，不将整页装饰循环动画化。
- Vercel Agent Skills：`.tmp/reference-vercel`，commit `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62`。
  实际查阅 composition 与 React best practices；用于组合式弹层、稳定事件及共享查询准备。
- Impeccable：`.tmp/reference-impeccable`，commit `02523aec3e4c4580102d996d1b6a71fbe062e03f`。
  实际读取 SKILL、craft floor、operate/audit/critique 指导。context 在本会话已运行；未编造 PRODUCT.md。
  字体、玻璃和批准稿中的标牌以用户明确视觉要求优先；其通用反模式建议不能推翻冻结方向。
- Sim Studio：实际画布/菜单源码，commit `a52fc509b5b8a18df519ff0781f00c8d45711164`，Apache-2.0；
  参考画布和工具面板职责，未复制品牌资产。
- Liquid Glass React 1.1.1、React Bits Aurora：实际安装/源码与已有 Electron 测试记录已检查。
  既有约 7/8 fps 和兼容问题仍然限制采用；保留静态光学背景，不启用 shader。保留原许可/署名。
- Motion 14.6.0：检查安装实现，使用真实 Motion 路径运动和中断；实时减少动效 Hook 同时响应系统与应用设置。
- shadcn Table，commit `c257f688cf4de7ec10cc1be84cad29cd4631182c`（MIT）：参考可扫描数据布局。
- Noto Sans SC：[Google Fonts 固定源码](https://github.com/google/fonts/blob/6157dfaa640ca5738b4d1a7070fe389c3036d7fc/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf)
  与 [OFL-1.1 许可](https://github.com/google/fonts/blob/6157dfaa640ca5738b4d1a7070fe389c3036d7fc/ofl/notosanssc/OFL.txt)。
  fontTools 4.68.0 / Brotli 1.2.1 无损压缩，未删字；7,782,072 字节，30,890 Unicode 映射，100–900 字重。
  原始/产物 SHA256 及来源在 `apps/desktop/src/renderer/src/assets/fonts/SOURCE.json`；关于页面可查看许可。
  仅开发转换工具在 `.tmp`，不增加运行依赖。拒绝线上字体加载的原决定保留。

## 用户报告的 Electron 异常

系统 Application Popup 事件 26（记录 232664，2026-10-30 09:56:43.522Z）与错误截图的地址和
0x80000003 完全匹配，时间对应受限执行环境中的隔离测试启动。该测试目录只有空 user 文件夹，
没有业务数据或 desktop/runtime 日志。允许正常原生执行后的下一次启动于 09:57:45.694Z 开始，
09:57:47.176Z Runtime 就绪，09:58:19.230Z 退出码为 0。
证据见 `diagnostics/electron-popup-investigation.json`。这定位到测试启动阶段；没有原生转储，
不宣称定位了某条 C++ 指令。未关闭 Electron 安全机制；后续原生检查统一在正常原生执行环境运行。

当前工具没有专用 skill 加载接口；通过实际本地 SKILL/源码读取替代，不声称使用了不可用的工具。
来源访问的历史命令记录亦见 `docs/org-upgrade/design/A1_ORGANIZATION_UI.md` 与 `A2_ASSET_UI.md`。

## 最终验证与证据

`before/` 是原生旧界面及用户问题截图；`probe/`、`overlay-probe/` 是诊断，可能包含失败状态，
不构成最终验收。`lab/`、`after/`、`overlays/`、`usability/` 保存最终脚本结果与截图。
最终命令状态由 `evidence-manifest.json` 按执行时间合并 `validation/checks.json`、`rechecks.json`
和 `font-rechecks.json`，相邻文件保留原始输出。全套首轮的类型检查因新测试遗漏路由参数失败；
修正测试的 URL/pattern/context 后，`typecheck-repaired.txt` 与八项专项测试、测试文件 lint 均通过。
不删除失败历史，不将早先中断或仅单项成功的结果充作完整验收。

| 检查 | 最终结果 |
|---|---|
| `pnpm lint` | PASS，0 errors / 25 warnings；新测试末次 ESLint 也通过 |
| `pnpm typecheck` | PASS，见 `validation/typecheck-repaired.txt` |
| `pnpm test` | PASS，102 文件 / 571 tests；2 文件 / 4 外部测试 SKIP |
| `pnpm build` | PASS |
| desktop / agent / v12 / v13 E2E | 全部 PASS；真实创建恢复、审批暂停/执行、设置连接、扫描/计划/图布局 |
| Design Lab | 32 PASS / 0 FAIL；4 axe 状态无违规 |
| 易用性 / 流向 | 15 PASS；脉冲约 62.3 fps，暂停约 64.1 fps；系统减少动效即时生效 |
| 字体 / 首次读取 | 12 PASS；五类冷页面/弹层在 4 倍 CPU 降速下无框文分离采样帧 |
| 全系统页面 / 设置 | 389 PASS，288 截图，100 axe 检查无违规 |
| 主要弹层 / 真实计划 | 408 PASS，72 axe 检查无违规；8 个真实 DAG 状态节点均可见 |
| 交互录屏 | PASS，10 段真实原生桌面操作，无 Renderer 异常 |
| `pnpm package:dir` / `pnpm test:package` | PASS；打包 EXE 创建项目并重启恢复 |

最终页面原生合成对比抽样未发现低于 4.5:1 的样本；这仍是补充诊断，不是完整 WCAG 认证。
Impeccable 对本轮部署、模式、系统样式和弹层源码检测
结果为 `[]`（`source-detector.json`）；它不是原生像素或主观审美验收。

最终本地字体由原生平台字体接口确认，英文代码为 Consolas，代码中文为 Noto Sans SC；所有业务
信息仍来自实际 IPC 与隔离的持久化示例。屏幕阅读器人工听读、跨操作系统渲染、实际外部服务部署、
损坏字体文件时的人工体验与用户主观视觉批准不在自动测试结论内。

## 改造前后对照入口

这些是原生 Electron 实际画面，均未用效果图替代。标准矩阵是 1440/1024 窗口宽度、亮/暗主题、
100%/125% 原生缩放，记录各自实际视口；长内容允许在内容区纵向滚动。

| 场景 | 改造前 | 当前实现 |
|---|---|---|
| 工作中心 | [旧首页](before/project-home-1440-light.png) | [浅色](after/project-home-1440-light.png) / [暗色](after/project-home-1440-dark.png) |
| 审批 | [用户指出的材质混杂](before/user-reported-mixed-material.png) | [浅色](after/approvals-1440-light.png) / [窄屏放大](after/approvals-1024-light-125.png) |
| 部署 | [用户指出的空三栏](before/user-reported-deployment.png) | [准备步骤](after/deployments-1440-light.png) / [暗色](after/deployments-1440-dark.png) |
| 项目中心 | [旧界面](before/project-center-1440-light.png) | [1024 / 125%](after/project-center-1024-light-125.png) |
| 版本和迭代 | [旧界面](before/versions-1440-light.png) | [所有权与交付关系](after/versions-1440-light.png) |
| 设置 | [旧界面](before/settings-2-1440-light.png) | [统一连接设置](after/settings-2-1440-light.png) |
| 真实计划 | 以批准 DAG 为方向 | [计划画布](overlays/real-plan-1440-light.png) / [任务检查器](overlays/real-plan-inspector-1440-light.png) |
| 字体与阅读面 | [本次反馈前的审批](before/typography-feedback/approvals-1440-light.png) | [修正后审批](after/approvals-1440-light.png) / [浅色详情](overlays/task-detail-1440-light.png) / [暗色窄屏 125%](overlays/task-detail-1024-dark-125.png) |

协作方向脉冲、减少动效、缓存切换与三种模式的实际结果见 `usability/checks.json`。
[原生交互录屏](walkthrough/product-ui.webm)由 `scripts/premium-walkthrough.mjs` 单独生成；录制负载不混入帧率测量。
新的组织登录/资产状态组合未在本轮重新走完整服务流程；对应 A2.2a 证据仍单独保留。
