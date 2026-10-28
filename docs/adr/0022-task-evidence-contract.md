# ADR-0022 — 任务证据契约：证据必须真实生成，不得由系统补写

- **状态**：已接受，随 Phase 2.8.4 实施
- **日期**：2026-10-28
- **影响范围**：`apps/runtime/src/agent-runner.ts`（`create_artifact` 工具）、完成判定 `completion-evidence.ts`、Planner/Replanner 任务契约

## 背景

连续多轮（2.8.2 / 2.8.3）失败原因相同：**Planner 创建了真实任务，但 Agent 不知道要产出什么形状的证据**，任务执行完仍被判失败，整条自主链停住。

Phase 2.8.4 源码检查发现了更严重的一层：`agent-runner.ts` 里存在
`normalizeReviewArtifactMetadata`，当产物标题含"审查/评审"且未提供 `artifactType` 时，它会**自动编造**：

```
artifactType: 'review'
reviewedObjects: [uri ?? 'workspace']      // 编造被审查对象
findings: body 的前 8 行 或 [title]         // 编造发现
conclusion: body 文本 或 title              // 编造结论
blockers: ['无阻塞项']                      // 编造"无阻塞"
```

这直接违反领域底线："不得通过插入空 findings、虚假 conclusion 或伪造 passed Artifact 使测试通过"。
它让审查任务看起来"有证据"，而证据内容是系统编的，不是 Agent 判断的。

## 决策

1. **删除伪造逻辑**。系统不再补写任何审查字段。
2. **改为严格校验 + 字段级错误回传**。`create_artifact` 在 `artifactType === 'review'` 时校验：
   - `reviewedObjects`：非空数组（真实对象：文件、Diff、Commit、Artifact id）
   - `scope`：非空字符串
   - `findings`：非空数组（确无问题时显式写一条"无阻塞问题"）
   - `conclusion`：非空字符串（通过 / 需要修改 / 阻断交付）
   - `blockers`：字符串数组（无阻塞写 `[]`）
3. 不合格时抛 `BAD_REQUEST`，错误信息逐字段列出，作为工具结果返回给 Agent，使其**在预算内自行修正输出格式**，而不是让用户手工填 JSON。
4. `metadata` 原样落库，不做任何隐式规范化。

## 不变量

1. 系统**永不**生成 `reviewedObjects` / `findings` / `conclusion` / `blockers` 的内容。
2. 审查任务可以合法完成于 `conclusion = 需要修改 / 阻断交付`——**审查发现问题 = 审查任务成功**，但质量门禁不得因此通过。
3. 无效产物被拒绝，不落库，不产生"半成品证据"。
4. 完成判定仍按 ADR-0021 区分：任务完成 ≠ 测试通过 ≠ 门禁通过 ≠ 允许交付。
5. 被审查代码的同一步骤不能自我宣布通过；独立审查复用既有 Reviewer 角色与证据策略。

## 后果

- 审查任务要么产出真实结构化结论，要么明确失败并提示缺字段——不再出现"看起来有 review Artifact 但内容为空"。
- 需要 Planner/Replanner 在任务描述中说明所需字段；工具描述已列出字段清单。
- 与 ADR-0021（诊断意图）互补：一个管"失败可以是成功"，一个管"证据不能被编造"。
