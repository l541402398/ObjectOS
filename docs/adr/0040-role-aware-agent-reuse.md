# ADR-0040 — A revision reuses an authorized Agent of the right role

- Status: Accepted (Phase 2.8.8)
- Related: ADR-0026 (grant envelope), ADR-0034 (revision must fix), ADR-0039 (demotion)

## Context

A real Phase 2.8.8 run showed every new task in revisions r2–r4 assigned to **P288 Dev**, including
tester and reviewer tasks, so the "multi-Agent plan" silently collapsed onto one Agent. The user asked
whether that was a bug or a deliberate single-Agent configuration. The database answered:

- the project had 8 Agents (5 built-ins + P288 Dev / QA / Reviewer), so it was **not** a configuration;
- r1 assignments were correct (developer → P288 Dev, tester → P288 QA, reviewer → P288 Reviewer);
- r2+ new tasks (`rerun-node-test-after-fix`, `verify-node-test-after-reapply`,
  `review-reapply-and-final-tests`) were pinned to P288 Dev with the reason
  「正式指定：用户已选 P288 Dev」.

Two defects produced that:

1. **Reuse picked by capability, not by role.** When the resolver chooses an Agent outside the grant,
   `ReplanService` reuses an authorized Agent — but it took the *first* authorized Agent listing the
   capability. All three E2E Agents declare the same broad set (`implement`, `test`, `review`), so the
   developer won every role.
2. **The reason was overwritten.** `assignPlanAgents` replaced `assignmentReasons` with the resolver's
   own list, erasing 「复用当前执行授权范围内同能力 Agent」 and leaving a message that reads like a
   user decision.

## Decision

1. `pickAuthorizedAgentForRole` ranks only Agents that are **authorized** and capable, by:
   - an Agent already assigned to a same-role task in this revision (**strongest** — the revision's
     own binding),
   - a role-name keyword match (开发/实现/工程师, 测试/质量/qa, 审查/评审/review, 架构/architect),
   - then deterministic id order.
   It never widens the grant: the candidate set is exactly `grant.allowedAgentIds` filtered by capability.
2. `mergeAssignmentReasons` keeps the revision's reason when the resolver agrees on the same Agent and
   appends the resolver's reasons (deduped, capped at 12). If the resolver changes the Agent, the list
   is rebuilt from the resolver's reasons — stale reasons must not describe a different Agent.

## Consequences

- Multi-Agent plans stay multi-Agent across revisions; a revision's new tester task goes to the same
  QA that already tests, and a new reviewer task to the reviewer.
- The audit trail explains reuse in the revision's own words, so "why is this the same Agent?" is
  answerable from plan JSON.
- Testers/reviewers with overlapping capabilities can no longer be silently replaced by a developer.

## Tests

`tests/p288-role-reuse.test.ts` (same-role task wins, role-name match, never a developer for a tester
role, deterministic fallback, null when nobody is capable) and
`tests/p288-assignment-reasons.test.ts` (merge on same Agent, reset on a changed Agent, dedupe + bound).
