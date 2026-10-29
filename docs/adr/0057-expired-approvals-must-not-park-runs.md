# ADR-0057 — Expired approvals must not park a run forever

- Status: Accepted (Phase 2.9-P0)
- Related: ADR-0053 (journey), ADR-0055 (decided approvals), ADR-0031 (goal status)

## Context

A real DeepSeek run stopped on `run_command` approvals. One approval's TTL passed while it was still
`pending`: the Run stayed parked, ActionCenter marked the item `stale` and hid it, the work center said
"无需操作", and the journey said "执行暂停，等待恢复" with an AI owner — while nothing could ever resume
it. The decision API only expired such approvals when a human happened to click them.

## Decision

`expireStaleApprovals(store, logger)` settles every `pending` approval whose `expires_at` passed:

- approval → `expired` with a clear reason;
- its tool call → `denied` with "审批已过期，操作未执行";
- a parked Run (`waiting_approval`, `waiting_tool`, `running`, `suspended`) → `failed` with an
  actionable message, its task attempt failed and the task blocked, with events recorded;
- terminal runs are never rewritten.

It runs at the beginning of every autonomy pass, so a tick or a restart settles them within one pass.

The journey additionally stops hiding a stale tool approval while the execution is parked: it shows the
real approval id, labels it "审批已过期，需要重新发起" and links to
`/projects/:id/approvals?approval=<apr_…>`.

## Verification

`scripts/p29-approval-expiry-e2e.mjs` on a real profile copy: a pending expired approval existed, one
tick settled it (`approvalStatus=expired`), and the journey moved from "等待你批准" to the next real
state (`EXPIRY_SETTLED=true`).
