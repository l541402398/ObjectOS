# ADR-0042 — Plan completion is an event that drives an autonomy pass

- Status: Accepted (Phase 2.8.8)
- Related: ADR-0028 (re-review), ADR-0030 (delivery), ADR-0041 (policy forwarding)

## Context

After ADR-0041 made `autoDeliver` actually persist, a real closure run finished every task, the
review approved the current content, the real `node --test` went from exit 1 to **exit 0** — and
`deliveryStatus` stayed `none` with `deliveryError: null` and **no delivery attempt at all**.

Root cause: the autonomy coordinator only schedules a pass from persisted project events
(`run.* / task.* / artifact.* / plan.* / approval.*` → `*.settled`). Completion was written straight
into `plan_json.execution` (`status: 'completed'`) with **no event**, so the final pass in the queue
was one that ran *before* completion was persisted; after the last `run.status.changed` there was
nothing left to enqueue a pass. `autoDeliverCompleted` iterates completed plans, but no pass ever ran
again to see one.

## Decision

Emitting the completion is part of completing:

1. a first-class event type `plan.execution.completed` (`plan.*`, so `classifyEvent` maps it to
   `plan.settled` and the coordinator queues a pass);
2. the orchestrator appends it in the same block that saves `status: 'completed'`, carrying the
   revision, task ids, branch/base/branch commit and the diff artifact id;
3. `summarizeProjectEvent` gives it a user-facing Chinese summary (ADR-0038) —
   「计划第 N 版执行完成，成果待交付」.

A `project.event` payload was rejected for this: `classifyEvent` cannot see the payload, so a custom
kind would not schedule anything, and mapping *every* custom event to a pass would let
`plan.delivery.blocked` re-trigger delivery in a loop.

## Consequences

- The happy path now delivers: completion → pass → gate → merge → post-merge verification.
- The same event gives the UI a real "计划执行完成" row instead of silence, and `goalStatus`
  refreshes when the plan actually completes.
- Completion remains persisted exactly once (the event is appended in the same block, after
  `saveExecution`).

## Tests

`tests/p288-event-copy.test.ts` requires a Chinese summary for the new type (the suite iterates every
`PROJECT_EVENT_TYPES` value). The end-to-end effect (a merge commit and post-merge verification after
completion) is verified by the real PRODUCT_AUTONOMOUS run, not by a unit test.
