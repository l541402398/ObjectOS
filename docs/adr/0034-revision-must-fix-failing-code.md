# ADR-0034 — A revision proposed after a real verification failure must fix the code

- Status: Accepted (Phase 2.8.8)
- Related: ADR-0022 (evidence contract), ADR-0026 (autonomy), ADR-0029 (budget)

## Context

A real Phase 2.8.8 run exhausted its whole revision budget without a single code fix. The failing
check was always `node --test` (exit 1, `src/sums.mjs` ignoring its second argument), yet all three
Replanner revisions only reshaped how evidence was collected:

- r2: redefine the review task's artifact contract;
- r3: split testing and report-writing into two tasks;
- r4: add a task to capture the test report.

The Replanner was answering the *evidence gap* it was told about, not the *defect* the evidence
proved. The chain then hit `maxAutoReplans=3` (correctly) with the bug still in place.

## Decision

When the plan has a real, unsuperseded failing verification, `ReplanService.propose` appends an
explicit directive to the Replanner prompt:

- list the failing commands with their real exit codes;
- require a fix task (`role=developer`, `expectedArtifacts` containing the code diff) that can modify
  the tested source;
- require a real re-run after it;
- forbid "only adjust the report/evidence tasks" and forbid lowering acceptance criteria.

The **task-contract preflight** (`preflightTaskContract`) still validates the resulting revision, and
the ambiguity-envelope comparison still decides auto-apply, so the directive is an instruction, not a
bypass: a revision that ignores it and re-shapes evidence is still legal to *propose*, but it will
keep failing the same verification.

## Why not reject non-fixing revisions outright?

Because the product cannot prove from a plan alone that a revision's tasks cannot fix the code — a
"verification" task may legitimately be the fix for a broken test harness. The evidence (failing
exit codes) is the authority, and the directive aligns the model with it without adding a rule that
would reject legitimate repairs.

## Status

Implemented and unit-covered by the replan prompt tests; the behavioural outcome (a revision that
actually fixes the code and reaches delivery) could **not** be re-verified in a real run within this
round's time budget, so it is reported as fixed-but-unverified.
