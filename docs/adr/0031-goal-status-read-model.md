# ADR-0031 — The work center states the goal, not the task count

- Status: Accepted (Phase 2.8.8)
- Related: ADR-0026 (policy), ADR-0028 (re-review), ADR-0030 (delivery)

## Context

Real runs produced a page that could say "100% tasks done" while the goal was undelivered, showed a
version gate as a human todo even when the product would satisfy it by itself, and scattered the
current truth (execution, verification, review, delivery) across several menus. The previous "next
step" was guessed in the renderer from whatever query happened to be loaded.

## Decision

The runtime owns a single read model, `work.goalStatus`, derived only from persisted facts:

| field | source of truth |
|---|---|
| execution | the plan revision's `execution.status/error/updatedAt` |
| verification | real recorded verification tool calls (`failingVerifications`) |
| review | the shared review resolver (`planReviewEvidence`): none / stale / current_negative / approved, with the approved snapshot fingerprint |
| delivery | `deliveryStatus`, `mergedAt`, `mergeCommit`, `deliveryEvidenceId`, `deliveryError` |
| nextAction | `owner: product` when the policy and live facts let the product continue; `human` only for real decisions |
| productSteps | what the product will do next (rendered as "AI 下一步（无需你操作）") |
| humanDecisions | Action Center items that genuinely need the user, each with its exact route |

The renderer renders this view and never re-derives policy decisions. A `replan_scope` item is
hidden when the product can apply the revision inside the grant, and a `plan_delivery` item is hidden
when `autoDeliver` is enabled and the product is entitled to merge: those are not user todos.

## Consequences

- "执行进度 / 验证进度 / 交付完成度" are three distinct values, so a task percentage can never
  imply delivery.
- Waiting for the AI no longer looks like a todo for the user.
- The primary focus, the status band and the autopilot strip all come from one server-side decision,
  so they cannot contradict each other.

## Limits

The view is a read model: it never triggers work. The autonomy pass remains the only actor, so a
"product" next action is a statement about what the pass will do, not a request the page issues.
