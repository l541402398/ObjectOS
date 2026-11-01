# ADR-0074 — Reviewed task integration and dependency baselines

Date: 2026-10-30. Status: implementing the next authorized batch of ADR-0073.

## Decision

Requirements remain delivery units, UCs group tasks, and task worktrees remain the execution
boundary. Add an additive V39 operation ledger; do not modify previously applied migrations.
This batch connects task results to the requirement integration branch, not the project branch
or a remote. Integrated is not delivered. Requirement-wide acceptance and automatic scheduling
remain separate follow-up work.

- A real preview binds task/document/UC versions, dependency results, both branches and HEADs,
  and the complete Git-visible file content. Changed paths, review coverage and verification
  are visible. Sensitive paths, links, submodules, unfinished Git operations and foreign roots
  fail closed. No staging or Git writes occur on preview/review reads.
- Human review is an explicit local-owner record, collected by Runtime from the current files
  and persisted as an existing review Artifact. It does not grant Git or command permission.
  Current negative or incomplete reviews continue to block; a fresh review cannot erase them.
- Verification executes a user-specified command through the existing approved-command adapter,
  with a real Run/ToolCall/Approval. Trust requires a successful exit and identical complete
  content before and after the command. Older unbound successful commands do not prove current
  content. Generated ignored output is not source content. Unknown command outcomes require
  existing run reconciliation; they are never retried automatically.
- Integration requires completed task acceptance, current approving review covering every
  changed path, current successful verification, and a separate expiring human Git approval.
  Freeze and revalidate all inputs immediately before executing. Commit only enumerated,
  reviewed source changes; validate the staged blobs before committing; disable Git hooks and
  signing for the system-owned commit/merge. Never reuse the legacy broad plan merge helper.
- Merge the exact source commit into the exact requirement branch. Serialize operations per
  requirement, block competing task runs, and record intent and outcomes in the operation ledger
  and ToolCall. A merge conflict may be aborted only as part of this approved merge operation;
  report failure after proving the original clean target was restored. Other uncertain outcomes
  become needs_reconciliation. Human-triggered reconciliation reads exact commits/parents/content
  and records proven facts, without replaying or cleaning up Git.
- Expose whether the exact current content and requirement/UC/task versions have already been
  integrated, proved by the recorded source commit still present in the target history. Show the
  completed state and reject a duplicate integration request. New content or changed scope must
  obtain fresh evidence; a previous completed operation alone cannot mark it integrated.
- A dependent task may be prepared only after each same-requirement predecessor is accepted and
  integrated at its current task version. The frozen base must contain those integration commits.
  Check again before execution. Cross-requirement dependencies and stale prepared bases stay
  visibly blocked; this batch does not infer permission to rewrite a task's existing worktree.
- Preserve the approved optical blue/cyan UI, typed preload, existing task acceptance policies,
  leases, approval channels and legacy task behavior. No server protocol or team runtime changes.

## Verification

Test review/content coverage, failed/stale verification, reject/expire/stale approval, concurrent
operations, conflicts, crash reconciliation and dependent task content. Regress existing workspace
preparation and native execution. Capture real desktop review/approval/error/responsive screens;
record commands and remaining acceptance gaps in docs/v2/evidence/requirement-integration/.
