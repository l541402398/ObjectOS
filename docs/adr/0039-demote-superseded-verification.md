# ADR-0039 — A revision that adds the repair demotes the verification it supersedes

- Status: Accepted (Phase 2.8.8)
- Related: ADR-0022 (evidence contract), ADR-0034 (revision must fix), ADR-0038 (activity copy)

## Context

With ADR-0034 in place, the Replanner finally produced repair revisions. They still never reached the
repair, because the revision **kept the old verification task ahead of it**:

```
r2 tasks:
  add-sums-notes-module      developer  deps []
  run-sums-tests             tester     deps [add-sums-notes-module]   ← kept from r1
  review-sums-and-test-evidence reviewer deps [run-sums-tests]
  fix-sums-second-argument   developer  deps [review…]
  verify-sums-tests-pass     tester     deps [fix…]
```

The kept tester ran while the code was still broken, so it could not produce a *passing* test report.
Its completion contract demands verified test evidence, evidence retries were exhausted, and the plan
paused — leaving the repair and its verification in `backlog`. The chain never got to the fix, so no
exit-1 → exit-0 transition, no re-review approval, no delivery.

Re-ordering that tester behind the repair is not always possible: the repair legitimately depends on
the review that consumes the tester's finding, so adding `test → fix` would create a cycle.

## Decision

When a revision **adds a repair task** (a new `developer` task whose title/description asks for a fix,
or whose expected artifacts are code/diff), every **kept** task from the source plan that is a
`tester` and still runs *upstream* of that repair is demoted to a **diagnostic** task:

- `workType: 'diagnostic'` is written into the revision and materialized onto the Task;
- a diagnostic task's duty is to run the check and report the **real** exit code — a failing result
  is valid negative evidence (`evaluateCompletion` already implements this contract);
- its rationale records why, and the audit trail (the failing report, the review that read it) is
  preserved;
- the revision's **own post-repair verification** stays a normal task and remains the only gate.

`PlannedTask` gains an optional `workType`, carried onto the created Task. Tasks that already depend
on the repair (i.e. verify the new content) are never demoted, and a revision without a repair task
changes nothing.

## Consequences

- The chain can proceed: diagnostic test → review (may reject) → repair → post-repair verification →
  re-review → gate → delivery.
- The plan still fails honestly if the post-repair verification fails or the re-review rejects; the
  demotion moves the gate, it never removes it.
- The demotion is recorded in plan JSON, the task rationale and the materialized `workType`, so a
  reviewer can see which verification was report-only and why.

## Tests

`tests/p288-repair-demotion.test.ts`: demotes the kept pre-repair tester (and only it), leaves a
revision without a repair untouched, does not demote a verification that already depends on the
repair, and proves a diagnostic task with a real exit 1 report satisfies completion.
