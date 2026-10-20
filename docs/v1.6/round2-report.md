# ProjectOS V1.6 — 第二轮实施报告

日期：2026-10-20  
分支：`feature/v1.6-ux`  
版本：`1.6.0`

## 1. 本轮完成

### 项目中心高保真重排

按已确认稿 `01_project_center_confirmed.png` 重做：

- 4 个实时统计卡：项目、任务、运行中 Agent、任务成功率
- 最近项目视觉卡网格
- 快速开始：新建、载入示例、继续工作
- 项目进度柱状图
- 任务状态环形图（使用真实任务统计）
- 最近动态
- 项目列表表格
- 右侧：待授权、运行中的 Agent、本地资源

数据全部来自 `app.bootstrap` / `project.overview`，无虚构数字。

截图：`docs/v1.6/round1-project-center-dark.png`

### Agent Studio 三栏工作台

按 `Agent_Studio_Visual_Reference.png` 与 `50_agent_studio_light.png` 重做：

- 左侧：模板搜索、9 个模板、从空白创建、已有 Agent 列表
- 中间：5 个 Tab
  - 基础信息
  - 人设与提示词
  - 技能
  - 运行环境
  - 高级设置
- 右侧：实时预览、配置检查
- 底部固定操作栏：取消 / 上一步 / 下一步 / 创建 / 保存
- 所有 Tab 保持挂载，切换不丢草稿
- Runtime 打开时自动真实检测
- 创建、编辑、导入、导出、提示词预览、运行测试、删除保持真实 IPC
- 已用 Playwright 实测创建 Agent 并落库：

```text
AGENT STUDIO CREATE PASS agt_01m5chz26qn2wzfraefdjs2sky
```

截图：

- `docs/v1.6/round2-agent-studio-light.png`
- `docs/v1.6/round2-agent-studio-dark.png`
- `docs/v1.6/round2-agent-studio-tab0..4.png`

### 设置中心

- 宽度提升到 1180，玻璃层、左侧导航选中态
- 新增：
  - 工具与插件
  - 团队与权限
  - 系统与外观
- 系统页展示真实数据目录、版本、平台、快捷键、安全说明
- 团队页展示真实 Agent 与权限摘要
- 工具页展示真实 Runtime 能力与 Skills，未注册 MCP 明确显示未注册
- AI 连接表单：
  - 默认只保留名称、服务商、Base URL、API Key、默认模型
  - 协议、Temperature、超时、启用开关收进“高级设置”
  - 不虚构已连接状态

截图：

- `docs/v1.6/round2-settings-ai-dark.png`
- `docs/v1.6/round2-settings-ai-editor-dark.png`
- `docs/v1.6/round2-settings-runtime-dark.png`
- `docs/v1.6/round2-settings-tools-dark.png`
- `docs/v1.6/round2-settings-team-dark.png`
- `docs/v1.6/round2-settings-system-dark.png`

### 新增真实页面

- 资源中心 `/projects/:id/resources`
  - 项目文件、目录、文件大小
  - Runtime / Skills / AI 连接真实计数
  - 文件列表
- 审批中心 `/projects/:id/approvals`
  - 待审批 / 全部筛选
  - 真实审批标题、Agent、任务、详情
  - 批准 / 拒绝调用真实 approval API

截图：

- `docs/v1.6/pages/resources.png`
- `docs/v1.6/pages/approvals.png`

### 全局页面

已统一套用 Prismatic Glass 外壳并截图：

- 项目总览
- 任务看板
- 知识库
- 自主运营
- 编排工作台
- Agent 工作台
- 运行审计

截图目录：`docs/v1.6/pages/`

## 2. 真实业务验证

- V1.5 真实 Runtime E2E 仍通过：

```text
DSH Real Agent      → completed
OpenCode Real Agent → completed
```

- Agent Studio 通过 UI 创建 Agent 并写入 SQLite
- 设置页真实读取 `app.preferences.get`
- 团队页读取真实 AgentDefinition
- 工具页读取真实 Runtime/Skills
- 资源页读取真实 workspace snapshot

## 3. 验证

```text
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 24 files / 113 tests passed
pnpm package:win→ PASS
package-smoke   → PASS
v15-real-e2e    → PASS
v15-dpi-check   → PASS（125% / 150%）
screenshots     → 50 张
```

## 4. 版本与产物

- 版本：`1.6.0`
- Windows 包：`release/ProjectOS-1.6.0-portable.exe`
- 大小：99.5 MB
- SHA256：

```text
8428544B0DAA784F9E0AE2DEEC5AF853A84A0A82C524B44897795CB398D0F9DD
```

## 5. 与参考稿差异

| 项 | 参考稿 | 当前 |
|---|---|---|
| 项目中心 | 5 个项目卡、右侧工作列表、资源使用 | 真实数据量少时只显示 1 张卡，右栏为待授权/Agent/本地资源 |
| Agent Studio | 左 300px、右 360px | 252px / 300px，1480 宽弹窗 |
| Agent Studio 标签 | 分类为胶囊、标签 Chip | 分类 Select，暂无标签字段 |
| Agent 头像 | 设计插画 | Emoji/首字母 + 渐变底 |
| 工作流 | 节点库 + 画布 + Inspector + 日志 | 保留真实 DAG + Inspector，节点库/日志尚未高保真重排 |
| AI 连接 | 左侧服务商列表 + 中间配置 + 右侧状态 | 列表 + 内联编辑器，未做三栏服务商状态栏 |
| 光效 | 真实折射 | CSS 玻璃近似，符合规范降级路径 |

## 6. 已知未完成

- 工作流节点库、底部运行日志的高保真布局
- 项目详情 Hero / 项目设置 / 项目健康页
- 工具插件安装、MCP Server、团队多用户
- OpenSpec 可选工作流（当前明确未注册，不伪造）
- 41 张新增设计图仍为“待复核”，未全部逐页确认
- Linux 1.6.0 AppImage 尚未重新打包

## 7. 下一步

1. 工作流页高保真重排（不破坏 DAG）
2. 项目详情 Hero 与项目设置
3. AI 连接三栏服务商管理
4. 工具/MCP/OpenSpec 可选能力
5. 1024/DPI 全量回归
6. Linux 1.6.0 构建、截图包、最终验收与推送


## 8. Linux 1.6.0

- AppImage：release/ProjectOS-1.6.0-linux-x86_64.AppImage
- SHA256：78F00BB61BFE9D34AE790E50F7B9AD242AE4226AA921B505790ECD9916342354

## 9. Windows 1.6.0

- SHA256：
