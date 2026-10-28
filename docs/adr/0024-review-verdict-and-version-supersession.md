# ADR-0024 — Review 结论判定、版本绑定与取代

- **状态**：已接受，随 Phase 2.8.6 实施
- **日期**：2026-10-28
- **实现**：`packages/application/src/review-verdict.ts`（唯一判定源），被 `completion-evidence.ts` 与 `orchestrator.ts` 共同引用

## 背景

Phase 2.8.5 把「审查完成」与「审查通过」分开了，但判定本身仍是"没有命中拒绝关键词就算通过"：

```ts
return /阻断|不通过|拒绝|…/.test(conclusion) ? 'changes_requested' : 'approved'
```

后果：结论为空、含糊（"看起来还行"）、或写了系统读不懂的内容，都会被**默认放行**。而且
`completion-evidence.ts` 与 `orchestrator.ts` 各自维护一套正则，容易漂移。

## 决策

### 1. 四态显式判定，无默认通过

| Verdict | 条件 |
|---|---|
| `blocked` | 存在真实 blocker（排除 `无`/`none`/`—` 等占位符） |
| `changes_requested` | 结论明确要求修改/不通过/拒绝 |
| `approved` | 结论以明确正向词开头，且不含否定词；或不含结论矛盾的结构化 `verdict` 字段 |
| `inconclusive` | 其余一切：空、含糊、矛盾、无法解析、版本已过期 |

`inconclusive` **不是通过**。质量门禁只认 `approved`。

### 2. 结构化 verdict 优先，但不得与结论矛盾

`metadata.verdict`（或 `reviewVerdict`）取值 `approved|changes_requested|blocked` 时权威；
但若同时出现矛盾结论（verdict=approved 而 conclusion=需要修改），降级为 `inconclusive`。

### 3. 版本绑定与取代

- 创建 review Artifact 时，系统自动记录 `reviewedRevision = git rev-parse HEAD`
  （**事实采集，不是判断**；不写任何 conclusion）。
- 判定时若 `reviewedRevision ≠ 当前 revision` → `inconclusive`（过期）。
- **取代规则**：只以"当前 revision 上的 review"为准。旧 revision 的负面 review 会保留为历史，
  但当新 revision 上出现 review 时不再阻断；当前 revision 上的**所有** review 都必须通过，
  新 review 不能抹掉同版本其它未解决的阻断项。
- 历史 Review 永不删除、永不改写。

## 不变量

1. 没有 `approved` 就没有放行；`inconclusive` 一律按未通过处理。
2. 系统不写、不改 Review 的 conclusion / findings / blockers。
3. 干净审查允许 `findings: []`，不要求编造"无问题"条目。
4. 审查任务完成（证据有效）与审查通过（verdict=approved）是两个概念。
5. 审查完成、质量门禁通过、允许交付三者互不替代。

## 后果

- 含糊的审查不再静默放行，会以 `inconclusive` 呈现并阻断计划完成，进而触发 Replan。
- `completion-evidence.ts` 与 `orchestrator.ts` 共用同一实现，消除正则漂移。
