# ADR-2.8.3 — 负向验证（Diagnostic）的完成语义

- **状态**：已接受，随 Phase 2.8.3 实施
- **日期**：2026-10-28
- **影响范围**：`packages/application/src/completion-evidence.ts`、任务契约 `workType`、Planner/Replanner 产出的任务

## 背景

Phase 2.8.2 的真实运行暴露了一个领域缺陷：

Tester 的任务是「运行 `npm test`，并如实报告失败结果」。它**确实执行了测试并拿到退出码 1**，
正确发现了 `src/visibility.mjs` 的缺陷。但 CompletionDecision 要求验收任务必须提供
**通过的**测试报告，于是这个"发现失败"的任务永远无法完成，计划只能暂停，
失败 → 自动 Replan → 修复 的闭环因此走不通。

根因是把四件不同的事混为一谈：

| 概念 | 含义 | 谁决定 |
|---|---|---|
| Task Execution | 任务是否按职责做完 | 任务契约 + 真实执行记录 |
| Verification Result | 被验证对象是否通过 | 测试/检查的真实退出码 |
| Evidence Validity | 结果是否可信可追溯 | 持久化的 ToolCall + Exit Code + Run |
| Quality Gate | 成果能否进入后续阶段 | GateEvaluation（只认正向证据） |

## 决策

引入**显式的验证意图** `workType = 'diagnostic'`，作为任务契约的一部分。
**绝不根据任务标题推断**（标题含"测试/检查/失败"不足以判定）。

- `diagnostic`：任务职责是"执行检查并如实记录结果"。带真实退出码（0 或非 0）的
  已完成 `run_tests`/`run_command` 记录即满足其完成条件。
- 其它（默认，含 `acceptance`）：维持现状，测试必须通过。

## 不变量（必须由测试守住）

1. **诊断任务的完成不产生"通过"证据**：`hasTest` 仍然只认 `exitCode === 0`、
   已验证 test-report Artifact 或 passed 的 Quality Gate。诊断路径不写 `hasTest`。
2. **失败不会被改写成通过**：原始 ToolCall 结果不被修改；不新增 passed Artifact。
3. **门禁不受影响**：GateEvaluation 仍读取正向证据；诊断任务完成不会让 Gate 或版本阶段推进。
4. **不覆盖历史**：修复后重新执行会产生新的 ToolCall 与新的退出码，旧的失败记录保留。
5. **无退出码不算证据**：工具未返回 `exitCode`/`code` 时，`hasDiagnostic = false`。
6. **意图必须显式**：`workType` 为空或其它值时一律按 acceptance 处理。

## 后果

- 失败发现可以合法完成任务 → Replanner 能拿到结论 → 修复链路可继续。
- 质量门禁、Release、版本阶段推进的语义完全不变。
- Planner 需要能为"诊断型"任务标注 `workType: 'diagnostic'`；未标注时保守按验收处理。
