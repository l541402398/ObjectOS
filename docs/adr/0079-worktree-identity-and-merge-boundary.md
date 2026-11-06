# ADR-0079 — Worktree identity and merge boundary

Date: 2026-11-05 (America/Los_Angeles). Status: implementing.

The functional audit found that the legacy plan worktree helper adopted any directory with a
readable HEAD and checked only uncommitted files before merging. A foreign repository, wrong
branch, or already committed out-of-scope change could therefore cross the intended boundary.

- Reuse requires an exact registered worktree, canonical root, common repository and branch.
  Existing foreign, nested, detached or mismatched directories are rejected without modification.
- Check the complete source-versus-target committed diff as well as pending changes. Parse Git
  paths with NUL delimiters and disable pathspec interpretation so Unicode and special names do
  not bypass scope checks. System commits and merges disable repository hooks and signing.
- Freeze source/target commits; dry-run the merge and merge that exact source commit. Conflicts
  stop for human resolution. No model resolves a conflict and publishes it silently. A changed
  result requires a fresh review, verification and approval through the existing workflow.
- Never abort an unrelated Git operation. Only abort this merge if its original target HEAD is
  still present, and verify restoration. An unproven outcome explicitly requires reconciliation.
- This is local integration, not remote publication. No fetch/pull/push or deployment authority
  is added. Remote freshness and a reviewed remote synchronization operation remain a separate
  gap; locally cached tracking refs cannot prove that a remote is current.

Existing ADR-0030 and ADR-0074 review/approval/audit contracts remain in force. Tests cover foreign
directory reuse, branch changes, committed scope violations, Unicode paths, conflicts and hooks.
Desktop acceptance and actual command results are recorded in docs/v2/evidence/2026-11-05-functional-audit/.
