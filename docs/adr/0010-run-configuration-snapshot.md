# ADR-0010：Run 配置快照与运行中冻结

- 状态：已接受
- 日期：2026-10-21

## 背景

Agent Studio 允许编辑 Persona、Skills、Runtime 与权限。此前 Run 只保存 `agentId`，
原生循环每轮重新读取当前 AgentDefinition；运行中编辑会改变下一轮 prompt/权限，
历史 Run 也无法复现真实配置。

## 决策

- 新增 `run_snapshots`（迁移 v14），与 `agent_runs` 一对一。
- Run 创建时冻结：
  - Agent id、名称、角色、描述、capabilities、配置版本；
  - Persona（含有效 system prompt）；
  - Skills（id/name/version/source/content）；
  - 权限策略；
  - Runtime profile/id/name/protocol/version；
  - 连接/模型；
  - worktreeId、workflowNodeId（当前可为空，留给计划节点）。
- 原生循环、Runtime prompt 构建、工具过滤都从快照读取，不再实时读取可变 AgentDefinition。
- `agent_config_versions` 仍保留完整配置历史；Run 通过 `agentConfigVersion` 关联。
- 旧 Run 没有快照时，在恢复/查看时按当时可见配置生成一次兼容快照；新 Run 必须写入快照。

## 后果

- 运行中编辑 Agent 只影响后续 Run；历史 Run 可复现。
- 快照包含 Skill 内容，数据库体积会增加；通过技能数量/大小限制和后续归档策略控制。
- 旧数据兼容快照只能反映升级时配置，不能追溯升级前被覆盖的历史。
