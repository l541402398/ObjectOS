# V1.3 迁移报告

## v3 新增表

- `project_snapshots`：项目扫描快照，保留最近 10 次/项目；`payload_json` 存完整快照。
- `plan_revisions`：计划版本；`UNIQUE(project_id, revision)`；`plan_json` 存完整 PlanDraft，
  `status/goal/approved_at` 便于查询。
- `graph_layouts`：按 `(project_id, view_id)` 保存节点位置；不参与调度。

## 兼容

- 只新增表，不改 v1/v2。
- Plan 审批通过既有 TaskService 创建任务；任务 DAG/事件/Outbox 仍在同一事务。
- 扫描失败只返回错误，不写入半成品。
- 图布局丢失自动重排，不影响任务依赖。

## 回滚

- 删除 v3 表并移除 `schema_migrations` version 3 行；项目/任务/运行不受影响。
- 回滚后编排工作台不可用，其他页面正常。

## 未测试

- 大项目扫描超时/取消（有 AbortSignal 接口但无 UI 取消按钮）。
- 计划审批事务中断的故障注入。
