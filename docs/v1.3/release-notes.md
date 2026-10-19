# ProjectOS V1.3 核心增量 Release Notes

## 新增

- **项目扫描**：识别语言、框架、包管理器、模块、关键依赖，生成 ProjectSnapshot。
- **计划与审批**：自然语言目标生成 4 任务 DAG（架构→开发→审查→测试），可编辑标题/角色；
  批准后创建真实任务与依赖。
- **编排工作台**：React Flow 画布展示真实 Agent、任务与依赖；点击节点联动 Inspector；
  MiniMap、缩放、保存/恢复布局。
- **设置连接内联编辑**：新增/编辑连接改为设置内容区子视图，不再出现二层悬浮 Modal。

## 数据库

v3：`project_snapshots`、`plan_revisions`、`graph_layouts`。

## 未包含

- 自动多 Agent 调度/串行交接。
- Git Worktree、自动合并、lint/test/build 质量门禁报告。
- 事件 seq 断线补齐、200 节点压测、图依赖编辑。
- 真实 Provider 计划生成（当前为本地规则草案，UI 已标注）。

## 升级

覆盖安装/替换 EXE，保留 `%APPDATA%\ProjectOS`。首次启动自动应用 v3 迁移。
