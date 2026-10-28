# ADR-0027 — A plan parked on an unanswered approval is not "running"

- Status: Accepted (Phase 2.8.7)
- Evidence: `docs/v2/evidence/p287-900s-forensics.md`
- Related: ADR-0026 (autonomy policy)

## Context

A Phase 2.8.5 real-provider E2E was observed sitting in plan status `running` for ~900 s. Forensics
of the persisted database found the actual cause, and it was systematic:

- plan `pln_01m61epwr0n722t1p1dn9mrejt` (r2) entered `running` at `07:30:31.319`; its
  `execution.updatedAt` froze at `07:30:32.328` and never moved again;
- one tool call (`run_command "git ls-tree --name-only HEAD src"`) was parked at
  `waiting_approval`, and its approval request `apr_01m61er91…` (07:31:16) was **still pending**
  with no `approval.decided` event — the last project event is `seq 149` at `07:31:16.263`;
- 895.2 s of "running" was 45.0 s of work and **850.3 s of waiting**; 19 tool calls totalled 4.42 s;
- the plan wall-clock deadline was 09:30 and the Run deadline 08:00, so nothing timed out;
- 9 of 20 plan-execution rows across p281–p285 end with exactly one pending approval and one
  `waiting_approval` Run (longest 1085.6 s);
- the autonomy coordinator logged `advanced=0` for 100 % of its passes and stopped as soon as the
  Run parked, so nothing ever resumed it.

The state machine had no edge out of "running while a human has not answered": no timeout, no
failure classification, no reconciliation marker. Observers — UI, coordinator, E2E — therefore saw
a healthy run that never progressed.

## Decision

1. **Park detection, evidence-based** (`detectApprovalPark`): an active Run in `waiting_approval`
   whose tool calls are all parked (none `running`/`approved`/`proposed`) and whose last Run step or
   tool call is at least 15 s old is a *parked* Run. A working Run is never parked.
2. The scheduler transitions the plan from `running` to `paused` with the exact waiting object in
   `execution.error` (`等待审批：<tool> <command|path>（运行 <runId>）`) and appends
   `plan.status.changed` with `reason: 'approval.waiting'`. `paused` is the truth: the plan cannot
   advance without a human, and it is resumable.
3. **Automatic resume**: when the approval is decided, the next autonomy pass resumes any plan
   paused with that marker and no remaining pending approval, recording
   `reason: 'approval.settled'`, `authorizedBy: 'policy'`. No chat message, no button.
4. The approval itself is never auto-decided. Expiry semantics stay owned by the approvals table;
   this ADR only makes the *plan state* honest and the *resume* automatic.

## Consequences

- A stalled approval can no longer burn the wall clock silently: the plan leaves `running`, the
  Action Center already lists the pending tool approval with its exact object, and the plan resumes
  itself once decided.
- Observers can distinguish "working" from "waiting for approval" from persisted state, which is
  what the 2.8.7 E2E asserts.
- The 15 s idle threshold is a constant (`APPROVAL_PARK_IDLE_MS`), not a configuration, so tests can
  inject `idleMs`/`at` and stay deterministic.

## Not decided here

- Why the automated approver stopped after 12 approvals in that run is **not** determinable from
  persisted facts (rejected `approval.decide` requests are not stored). This ADR does not guess.
- Approval expiry sweeps are out of scope; the approvals table already carries `expires_at` and the
  Action Center marks expired items `stale`.

## Tests

`tests/p287-autonomy-pipeline.test.ts` ("ADR-0027 approval park is not running") materialises a Run,
a parked tool call and a pending approval, asserts the park is detected with the exact object, and
asserts a fresh Run is not mistaken for parked.
