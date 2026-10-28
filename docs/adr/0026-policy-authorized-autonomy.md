# ADR-0026 — The product applies its own revisions, strictly inside the user's grant

- Status: Accepted (Phase 2.8.7)
- Related: ADR-0011 (run budget), ADR-0022 (evidence contract), ADR-0025 (review snapshot)

## Context

ProjectOS could plan, execute, replan and merge — but only if something called the APIs in the
right order. Every "autonomous" acceptance run so far was driven by an E2E script that itself
called `plans.replan.apply`, `plans.approve`, `plans.grant.issue`, `orchestration.start` and
`worktrees.merge`. That proves the endpoints, not the product.

The missing piece is a decision layer: who decides that a revision may be applied, that an
approved plan should start, and that a finished plan may be delivered?

## Decision

A single `ReplanAutopilot` (runtime) runs inside the existing `AutonomyCoordinator` pass. It is
not a second scheduler: it uses `ReplanService`, `OrchestrationService`, `PlanGrantService` and
`OrchestrationScheduler` exactly as the IPC handlers do.

Four **explicit project policies** (`ProjectAutonomySettings`, all auditable and all recorded via
`project.autonomyPolicyChanged`) govern it:

| policy | default | meaning |
|---|---|---|
| `autoStartPlans` | on | start an approved plan that already has an active, valid grant |
| `autoApplyReplans` | on | apply a revision that stays inside the live grant envelope |
| `autoDeliver` | off | merge a completed plan's worktree without a click |
| `maxAutoReplans` | 3 | how many policy-authorized revisions per project before a human looks |

All four require `mode === 'autonomous'`.

**Envelope comparison** (`evaluateReplanAuthorization`) decides `auto-apply` /
`require-approval` / `blocked` by comparing the revision against the *live* grant: actions,
allowed paths, allowed Agents, remaining Run/ToolCall budget, expiry and project soft budget. A
revision that adds a path, an Agent, a tool or budget moves to `require-approval` with the exact
delta, surfaced as a `replan_scope` Action Center item. A revision that deletes verification work
(`detectContractDowngrade`) is never auto-applied, even inside the envelope.

**No fake approval, no fake grant.**

- The revision is applied through `ReplanService.applyAuthorized(id, { kind: 'policy' })`, which
  records `authorizedBy: 'policy'` and the basis on the `plan.replan.applied` event. The human IPC
  path records `authorizedBy: 'user'`.
- The new revision is approved by `OrchestrationService.approvePlan` with a
  `plan.status.changed` event carrying `reason: 'policy.within-grant'` and `authorizedBy`.
- The grant for the new revision is **derived** (`PlanGrantService.deriveReplanGrant`): actor
  `system:autonomy-policy`, `note` naming the source grant, and every bound (`actions`, paths,
  Agents, `maxRuns`, `maxToolCalls`, `expiresAt`, `allowOverBudget`) taken from the source grant's
  remaining envelope. It can only be narrower. Supersession revokes the source grant by design, so
  the envelope is captured *before* the revision is applied.
- Autonomous starts go through `PlanGrantService.reserveStart` / `markStartSucceeded` /
  `settleStartFailure`, so the user's Run quota is consumed exactly once and an unknown failure
  does not silently burn it.

**Automatic delivery** requires, in this order: completed execution, current approving review,
no unsuperseded failing verification, worktree available, every changed file inside the granted
paths and not sensitive, target branch unchanged (`execution.baseBranch`, recorded when the
worktree is cut), clean main workspace, and a `--no-ff` merge that aborts on conflict. Any failure
is recorded as `plan.delivery.blocked` and surfaces a `plan_delivery` item; nothing is forced and
nothing is pushed to a remote.

**Escalation** is precise and resumable: a `replan_scope` item carries the proposal id, the exact
delta, and the route to the plan. Approving it calls `plan.replan.approve`, which applies the
revision, derives the grant and starts execution — the user never returns to a chat page.

## Consequences

- The product now performs the state transitions that the E2E scripts used to perform, and every
  such action is attributable in the event log.
- Autonomy cannot widen authorization: a scope increase always becomes a human decision, and the
  derived grant re-asserts the bounds so a caller bug cannot expand them.
- `autoDeliver` is off by default: merging into the user's branch stays an explicit choice.
- Run budget semantics change subtly: a derived grant starts from the source's *remaining* budget,
  so a chain of revisions cannot exceed what the user authorized once.

## Tests

`tests/p287-autonomy-pipeline.test.ts`: product auto-start without any start call, task-contract
preflight refusal, in-envelope revision applied + restarted under a derived grant with
`authorizedBy: 'policy'`, out-of-envelope Agent delta escalated with a `replan_scope` item, and the
`maxAutoReplans` stop.
