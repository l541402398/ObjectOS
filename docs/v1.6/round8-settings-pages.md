# ProjectOS V1.6 — 剩余设置页与导入项目

日期：2026-10-20  
分支：`feature/v1.6-ux`

## 新增待复核设计页

### 工具权限

- 按 Agent 展示文件写入 / Shell / 网络权限
- 三项可真实切换并写入 AgentDefinition
- 权限在 Runtime 执行时由后端校验

截图：`docs/v1.6/settings-permissions.png`

### 存储与安全

- 真实数据目录、数据库路径
- 打开数据目录
- 已保存 Key 的连接数量
- 待审批数量
- 网络代理说明
- 平台与版本

截图：`docs/v1.6/settings-data-security.png`

### 外观与快捷键

- 浅色 / 深色 / 系统
- 减少动效
- 减少透明度
- 快捷键列表

截图：`docs/v1.6/settings-appearance.png`

### OpenSpec

- 明确标记未启用
- 不将 OpenSpec 标记为 Runtime
- 不伪造已安装状态

截图：`docs/v1.6/settings-openspec.png`

### 导入现有项目

项目中心新增“导入项目”：

- 使用现有目录
- 不复制/移动文件
- 不初始化 Git
- 真实 projects.create

## 已有并保留

- 项目设置
- 项目健康
- 通知中心
- 资源中心
- 审批中心
- Agent Studio 五 Tab
- AI 连接极简配置
- Runtime 管理 / 工具与插件 / 团队权限 / 系统与外观

## 验证

```text
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 24 files / 113 tests passed
package:win     → PASS
package-smoke   → PASS
Runtime 选择器  → PASS
快速指派 E2E    → PASS
整列拖放 E2E    → PASS
Runtime 取消 E2E→ PASS
OpenCode ACP DAG→ PASS
DSH DAG Runtime → PASS
```

## 产物

- Windows：`release/ProjectOS-1.6.0-portable.exe`
  `4F3B2CA3CE6BDB24A38C5029E07EA110ECC17B3E0D4F90269BA020FFCDEB48C5`
- Linux：`release/ProjectOS-1.6.0-linux-x86_64.AppImage`
  `8ACB859612B2E7E1EE9F3561EEBD9C4265F4A8C23EB0D2E809E7E475CE828118`

## 仍未完成

- 工作流节点库创建交互
- Token 用量/价格、模型详情、插件详情、第三方连接等剩余独立页
- 41 张新增稿逐页视觉确认
- 全量 1440/1024/DPI 截图重跑
