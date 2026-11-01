# ADR-0075: Direct requirement tasks and guided manual work

Status: Accepted for implementation, 2026-10-30.

The user explicitly removed UC decomposition as a required step. The product flow is
requirement → tasks → assigned Agents. A requirement remains the delivery unit; each
development task retains its independently approved worktree and branch.

## Decisions

- Allow requirement-linked development tasks without a useCaseId. Do not create hidden,
  synthetic UC records. Existing UC links remain valid and are checked for ownership.
- Workspace preparation, frozen execution context, verification and integration must
  support this direct link. An absent UC has a null version, distinct from version 0.
  Existing UC-bound snapshots and records remain compatible.
- Append migration V40 to make the trusted review ledger's UC version nullable while
  preserving existing rows. Recreate the insert guard without the mandatory-UC condition;
  retain project/requirement/group ownership checks and the immutable delivery-scope guard.
  Do not edit V1–V39 or change permission policy.
- Present a flat task list. Existing group information remains accessible as historical
  context; users can create and assign a task directly from a requirement.
- Use one context-sensitive primary action per task and handle the associated tool
  approval beside the current work. Show the exact requested scope, expiry and errors.
  Approval still targets one persisted approval ID and requires deliberate confirmation.
- Starting development may request workspace preparation and, after an explicit
  approval-and-start action succeeds, start the existing native Agent run. This is a
  foreground user action, not a new scheduler or permission to approve later tools.
  Closing the view or restarting must not silently replay side effects or start a run.
- Keep task acceptance policies, independent high-risk approvals, real verification,
  Git integration authorization and requirement delivery distinct. Simplify navigation
  and presentation; do not mark incomplete gates passed or invent progress.

## Validation

Exercise direct requirement tasks through creation, isolated execution, review, actual
verification, integration and successor preparation. Retest legacy UC-bound work and
V39 review preservation. Capture and test the manual path, approval rejection/expiry,
loading/errors, keyboard access, responsive layouts and light/dark themes.

Prior A3.2a evidence is frozen in docs/v2/evidence/requirement-integration/.
New interaction evidence belongs in docs/v2/evidence/requirement-guided-flow/.
