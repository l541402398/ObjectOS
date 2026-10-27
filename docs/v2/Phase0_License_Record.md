# ProjectOS V2.0 Phase 0 — 开源参考与许可证记录

> 本文件记录本轮参考的 8 个开源项目，不复制其代码/资产。ProjectOS 仍为 MIT；AGPL 代码不进入本仓库。

| 项目 | 参考 commit | 许可证 | 本轮用途 | 是否复制代码/资产 |
|---|---|---|---|---|
| Plane | `a9e7036` | AGPL-3.0 | 迭代/模块/状态组/保存视图的**概念**参考 | 否 |
| Aperant | `20250db` | AGPL-3.0 | 复杂度分层/QA 升级的**概念**参考 | 否 |
| Orchestrator.inc | `c7a99e1` | Apache-2.0 | durable facts/derived status、controller epoch 的**概念**参考 | 否 |
| AWR | `174c4a2` | Apache-2.0 | 证据/检查点/上下文包的**概念**参考；不采用线性 EvidenceLevel | 否 |
| Argo CD | `985a528` | Apache-2.0 | GitOps/同步/漂移/回滚的适配器边界参考 | 否 |
| Grafana | `b8041bb` | AGPL-3.0 | 可观测性查询/告警概念参考 | 否 |
| SigNoz | `1e89b49` | MIT（`ee/`、`cmd/enterprise/` 除外） | OpenTelemetry/告警/服务健康概念参考 | 否 |
| Rundeck | `d8f1e02` | Apache-2.0 | 作业/执行/审计边界参考 | 否 |

## 约束

- 不把 AGPL-3.0（Plane、Aperant、Grafana）代码、样式资产、图标、截图或数据库 schema 复制进 ProjectOS。
- Apache-2.0/MIT 如未来复用，必须记录来源、文件、修改、NOTICE/许可证文本。
- 不新增嵌入式 Argo/Grafana/SigNoz/Rundeck 服务；只做适配器。
- 本记录不是法律意见；正式分发前由用户/法务复核。

## 本轮结论

- Phase 0 没有新增第三方源码/资产，因此没有新的许可证义务。
- 参考项目只用于架构/状态机/证据模型的概念对照。
