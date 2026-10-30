# ADR-0067 — Organization A1 foundation and implementation baseline

- Date: 2026-10-29 (America/Los_Angeles)
- Status: Accepted for implementation by the user's “开始实施” instruction.
- Baseline: `ec97824d7751cc3d443ae1cdac4793e9170ed1ec`; branch `codex/org-a1-foundation`.

## Decisions

1. Preserve the existing Runtime/SQLite/Planner/AgentRunner as the local execution authority.
   The separately started organization server owns shared identity, membership and project metadata.
   It never receives permission to execute on a desktop merely because a user is an administrator.
2. Replace the deployment entry's in-memory persistence with PostgreSQL. Use Better Auth's supported
   `pg.Pool` adapter and versioned, transactional application SQL migrations. This deliberately avoids
   a second ORM for this slice; domain contracts remain independent of persistence. The isolated A0
   builder remains available to its existing PoC tests and is explicitly labelled as non-durable.
3. Persist only hashes of opaque desktop bearer tokens. Authorization codes/consents are short-lived,
   single-use, bound to PKCE and the requesting account; restarting the server cannot resurrect them.
   Recheck current organization/project membership on every scoped request. Sign-out revokes the token.
   Email verification/delivery is not configured in this slice, so matching an account email alone
   cannot redeem an invitation. The administrator receives a random single-use invitation code once
   and shares it through a trusted channel; only its hash is persisted. Listing invitations never
   reveals this code. Acceptance requires both the matching account and the code, consumed atomically.
4. Desktop Main owns the organization connection and encrypted session. Typed preload methods return
   sanitized account/organization/project views only. Renderer neither receives bearer tokens nor
   makes organization HTTP requests. Authentication does not migrate or upload local projects.
   Browser launch, callback receipt and token exchange share one total timeout/abort boundary.
   A failed secure-store write cannot commit an in-memory connected state. Every request binds to
   a connection generation through body decoding; cancelled/old responses cannot populate a new
   account or organization. Remote error bodies never become credential-bearing Renderer messages.
5. Require a configured server secret and database for the deployment entry. Non-loopback URLs must
   use HTTPS. Migrations run explicitly under a database advisory lock with checksum verification.
6. A1 is a sequence of reviewable slices: persistence/auth, desktop connection, organization/project
   experience. Organization assets, Worker dispatch, requirement workspaces and workflow execution
   remain A2–A4 and must not be represented as implemented by these slices.

## Visual authority

The user explicitly selected the approved Premium Liquid Glass baseline in this conversation.
`0686c41` and the approved DAG image remain authoritative. Precision and warm Studio screenshots
are comparison candidates, not a new visual approval. Keep semantic token aliases and the existing
component/motion architecture; correct palette drift using the frozen tokens. New organization UI
must use the shared overlay system, readable Chinese typography and true empty/error/permission
states. Every visual checkpoint includes actual Electron captures and explicit unverified items.

## Initial quality findings

- `resolveExecutable` invokes `where.exe` with the host environment even when a caller supplies an
  isolated environment/PATH. Pass the effective environment and PATH to subprocess probes.
- The plan-deadline test assumes Git/workspace preparation always takes less than 1.5 seconds.
  Production correctly charges that time to the budget. Test termination of an *active* Run by
  observing that Run first, then advancing the clock beyond the persisted deadline. Do not weaken
  runtime budgets or remove the assertions about audit facts, slots, task state and fencing cleanup.

## Validation and rollback

Run repository lint, typecheck, tests, builds, required desktop E2Es and packaged smoke. Add real
PostgreSQL restart/isolation/revocation tests and real Electron connection evidence. An unavailable
environment is SKIP/BLOCKED, never a simulated persistence PASS. The original local schema is not
changed by this slice; disconnecting the organization preserves all local projects and histories.

Primary reference: https://better-auth.com/docs/adapters/postgresql (consulted 2026-10-29).
