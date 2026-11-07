# K2 桌面截图索引

基准 HEAD：`168c9ba963d5b17ab62a615f10bcdab44a2c8fba`。
受测源码及逐项命令状态见上级 `source-manifest.json`、`checks.json` 和 `REPORT.md`。
账号为独立测试账号 `knowledge-k2@demo.invalid`，服务为一次性 loopback PostgreSQL／HTTP 环境。

| 文件前缀 | 实际状态 |
| --- | --- |
| `knowledge-editor-*` | 内联草稿编辑，未保存内容受关闭保护；`-end` 显示可滚动到保存操作 |
| `knowledge-list-*` | 技术／业务已发布资料列表、筛选与新增操作 |
| `knowledge-detail-*` | 具体版本、状态、校验值、正文及版本操作 |
| `requirement-source-selection-*` | 需求资料选择、精确版本及人工引用理由 |
| `requirement-citations-*` | 已保存的需求资料来源与校验值 |
| `before-protected-design-lab.png` | K1 实际 Windows 解包程序的受保护 DAG |
| `after-protected-design-lab.png` | K2 实际 Electron 的同一受保护 DAG |
| `before-settings-existing-assets.png` | 既有组织资产页面，作为新增知识入口的上下文对照 |
| `planning-uses-selected-versions.png` | 实际规划草稿，模型输入验证见 desktop-checks.json |
| `revocation-blocks-plan-approval.png` | 原版本撤销后审批被拒绝，无半创建任务 |
| `failure.png` | 第四轮已定位的测试导航错误现场，保留作调查证据；不是最终界面状态 |

后缀为窗口宽度、主题和实际缩放比例；窗口分别为 1440×900 与 1024×768。
窄屏和放大后的设置内容正常纵向滚动，设置分类沿用原有横向紧凑导航。
正式桌面检查中的每张图与 PASS／FAIL 关联在 `desktop-checks.json`；历史失败日志不改写为通过。

正式 K2 运行保存 53 张截图、97 项检查；`failure.png` 是额外保留的旧失败现场。
`../composited-contrast/` 使用同一原始流程另做 40 状态原生背景对比度采样，137 项检查全部通过，正常截图照常保留。
`../approved-dag-regression/` 是既有批准 DAG 脚本的输出重定向，32 项功能／axe 检查通过；其中浅色徽标 4.46:1 的像素诊断单列至报告。
