# ProjectOS V1.6 — 模型详情 / Runtime 详情与剩余页收口

日期：2026-10-20  
分支：`feature/v1.6-ux`

## 新增

### 模型详情 Drawer

- 模型名称、模型 ID、连接
- 上下文窗口、最大输出
- 流式 / 工具调用能力
- 默认模型状态
- 设为默认模型

### Runtime 详情 Drawer

- 协议、版本、可执行文件
- 来源、状态
- tool calls / permissions / worktree 能力
- 跳转 Runtime 管理

### 用量与价格

- 真实 AgentRun usage
- 按连接/模型聚合
- 真实模型价格
- 无 usage / 无价格时显示空或未知

### 设置 IA 已扩展

AI 连接、模型目录、Agent 路由、运行时、工具与插件、工具权限、外部 Agent、团队与权限、存储与安全、外观与快捷键、系统与外观、用量与价格、OpenSpec、通用、关于。

### 导入现有项目

项目中心支持导入现有目录，不复制文件、不初始化 Git。

## 验证

```text
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 24 files / 113 tests passed
screenshots     → 50 张
DPI 125/150     → PASS
package:win     → PASS
package-smoke   → PASS
OpenCode ACP DAG→ PASS
DSH DAG Runtime → PASS
```

## 产物

- Windows：`release/ProjectOS-1.6.0-portable.exe`
  `DD1997AD8D07409F522E59588906382292878D241CAB048CA0211174EBAE8268`
- Linux：`release/ProjectOS-1.6.0-linux-x86_64.AppImage`
  `1902824F78536A84EB015C6EDF4B850DC2690E9DB7678A8F0981129BEC7B9384`

## 尚未完成

- 工作流节点库创建/拖入（后端无任意节点模型）
- 第三方连接 / 插件安装详情
- 41 张新增稿逐页视觉确认
