# ADR-0089 — Verified-worktree auto-allow, batch approvals and a reachable next action

Date: 2026-11-10. Base HEAD: `e908d0e2` (`codex/organization-workspace-ux`).
User request: fewer approval clicks without losing safety — auto-allow only inside a *verified*
isolated git worktree, approve many similar requests at once, and always know the next action.
Supersedes the experimental PR #1/#2 that targeted the old `main` architecture.

## Context

The base already has plan execution grants (ADR-0026/0032/0056): a granted plan may write inside its
allowed paths and run `run-tests` commands without per-call approval. It did **not** check *where*
that happened: a grant-covered write in the project's main working tree (non-git fallback, a recovered
Run, a mis-recorded root) was auto-allowed the same as one in the plan worktree.

## Decision

1. **Isolation is a precondition of every grant auto-allow** (`write_file`, `run-tests` commands and the
   new verification families). `verifyIsolatedWorktree` (packages/worktree, synchronous) requires, in
   order: the workspace exists and is not itself a symlink; it is not the project root (realpath); it is
   the worktree persisted on the plan execution (`workspaceRef`); `git rev-parse` toplevel equals it;
   `--absolute-git-dir` differs from `--git-common-dir` (a linked worktree, not a clone/main tree); the
   common dir equals the project's; it appears in `git worktree list --porcelain`; its branch equals the
   plan branch. Any failure ⇒ `require_approval` (never deny) and a `plan.grant.isolationRejected`
   audit event naming the failed check.
2. **Verification families** (packages/policy `verifyCommandFamily`): `test`, `lint`, `typecheck`, `build`,
   matched as single invocations with conservative argument shapes; shell metacharacters, installs,
   `--fix`, watch/UI modes, registries, `dlx` and arbitrary `npx` tools are rejected. When the plan grant
   covers `workspace-write`, the selected families run unattended inside the verified worktree; each use
   consumes the grant's tool budget and records `authorizationBasis: 'verified-worktree'`.
3. **Project toggle** `worktreeAutoAllow` (default **on**) and `worktreeAutoAllowFamilies` (default all four)
   live in the existing autonomy settings. Off ⇒ grant-covered writes and family commands ask again.
4. Unchanged and always per-call: main-workspace writes, protected/critical paths (`.env`, secrets, keys,
   `.git`, auth/migrations/manifests), arbitrary shell, git commit/push/delivery, deploys, network egress.
   Policy `deny` is never overridden.
5. **Batch approvals** (`approval.decideBatch`): a multi-selection or "the rest of this kind in this Run".
   Each item goes through the normal `decideApproval` (snapshot drift, expiry, lease checks per item);
   outcomes are reported per id. Only *batchable* kinds can be approved together (plain writes outside
   critical paths, verification families); everything else is `skipped` with its reason. Rejection may be
   batched for any runner-owned approval. Git delivery / integration / requirement approvals are excluded.
   `rememberForRun` stores a `run_kind_allowances` row (migration V48) scoped to one Run and one kind,
   8 h TTL, consulted only after Policy and the PlanGrant neither allowed nor denied.
6. **Next action**: the Action Center gains `plan_review` (draft plans) and its plan routes now point at the
   real `/orchestration?plan=` destination instead of the non-existent `/plans` route.
7. `approval.preview` returns the Run-workspace baseline, proposed content/command and the isolation verdict
   so the review UI can show a real diff and *why* a request needs a human.

## Consequences

- Non-git projects (which fall back to the project root) no longer get grant-covered auto-allow; they
  ask per call or use "approve this kind in this Run".
- Tests that relied on auto-allow in the project root now use a real plan worktree fixture.
