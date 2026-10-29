# ADR-0055 — A decided approval is evidence, not a form

- Status: Accepted (Phase 2.9-P0)
- Related: ADR-0026 (policy envelope), ADR-0047 (trusted evidence)

## Context

The user reported: "已经执行审批的记录，怎么还能继续点击审批". The approval workbench rendered the
decision form (note box, 批准, 拒绝) for every selected row, including rows already `approved` or
`rejected`. Clicking them either failed server-side or looked like a second decision was possible.

## Decision

1. When the selected approval is not `pending`, the right-hand rail renders a **read-only decision
   summary** (`data-testid="approval-decided"`): status, request time, decision time, related agent and
   the persisted decision text. No note box, no 批准/拒绝 buttons.
2. The detail header colours the status tag (green/red/gold) so a decided record is recognisable at a
   glance in history.
3. The API still enforces the rule; the UI no longer invites an impossible action.

## Verification

`scripts/p29-approvals-readonly-e2e.mjs` against a real profile with decided approvals: decided block
present, 0 approve buttons, 0 reject buttons, 0 textareas, traceability text present (4/4 PASS), plus a
computed-font check that the page has no content text below 12px.
