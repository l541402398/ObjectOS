# ADR-0033 — Review tasks are read-only, and review prose is parsed without inventing a verdict

- Status: Accepted (Phase 2.8.8)
- Related: ADR-0025 (snapshot), ADR-0028 (re-review), ADR-0032 (approval families)

## Context

Two defects surfaced in real DeepSeek runs of the autonomous loop.

1. **A reviewer that edits the reviewed files invalidates its own snapshot.** One run produced five
   reviews in a row, each stale by the time it finished, because the review task's Agent "fixed"
   comments while reviewing. Autonomous re-review then looped: review → content changed → stale →
   re-review.
2. **The verdict parser misread real review prose.**
   - rejection matched the word `fail` inside `tests 2 / pass 2 / fail 0`, so a clean review became
     `inconclusive`;
   - approval was anchored at the start (`^通过`), so a conclusion like
     「根据当前工作区…判定为通过（PASS）」 was not recognised;
   - `未通过` was not in the rejection vocabulary at all.
   A review that says "changes requested" was also classified as an *unclassifiable* pause, so no fix
   revision was proposed.

## Decision

1. **Review tasks are read-only at the policy layer.** For a task whose labels include `reviewer`,
   `PlanGrantService.authorizeToolCall` denies `write_file` outright, allows strictly read-only
   command families (ADR-0032), and routes everything else to per-call approval. A review can no
   longer mutate the content it is reviewing.
2. **Verdict parsing reads prose conservatively** (`packages/application/src/review-verdict.ts`):
   - zero-count phrases (`fail 0`, `0 failures`, `no errors`, `失败 0 个`) are removed before
     rejection matching;
   - rejection vocabulary gains `不通过`, `未通过`, `没有通过`, alongside the existing blocking and
     `changes requested` terms;
   - approval is an explicit positive token at a word boundary **anywhere** in the conclusion
     (start, whitespace, `：`, `(`), not only at the start;
   - a conclusion containing both a real rejection and an approval stays `inconclusive`.
3. **A negative review is an implementation failure**: `classifyExecutionFailure` recognises
   「审查未通过/审查要求修改/changes requested」 as `implementation` with `replan: true`, so the fix
   goes through a refined revision instead of an unclassifiable pause.

## Consequences

- The snapshot cannot be invalidated by the reviewer itself, which removes the worst re-review loop.
- The parser accepts the way real models write verdicts while still refusing ambiguous conclusions.
- A review that asks for changes now reliably drives the fix path.

## Tests

`tests/p288-review-task-guard.test.ts` (write denied for review task, allowed for developer task,
arbitrary execution still needs approval) and `tests/p288-review-prose.test.ts` (zero counts, prose
PASS, explicit negatives, mixed conclusions, and failure classification).
