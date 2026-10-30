# A1 implementation baseline

- Starting commit: `ec97824d7751cc3d443ae1cdac4793e9170ed1ec`.
- Working branch: `codex/org-a1-foundation`.
- Authorization: user requested implementation after reviewing the upgrade packages and explicitly
  selected the approved Premium Liquid Glass direction. Quality includes real workflows and states,
  not just screenshots. ADR: `docs/adr/0067-organization-a1-foundation.md`.

## Preserve and extend

Keep the existing local SQLite/Runtime execution authority, one Planner/Scheduler/AgentRunner,
approval policy, leases, evidence and Git Worktree. Add a separately started PostgreSQL organization
control plane. Accounts, organizations, members and shared project metadata belong to that server;
desktop filesystem paths and local execution grants remain local. No local project is silently
uploaded or associated with a server project.

A0's separate prototype and memory PoC remain historical/testing references. The warm Studio and
Precision prototypes do not supersede the user-approved Design Lab. Keep the unified semantic token
layer while correcting its unapproved palette drift. Existing page structures are retained in this
slice. Root AGENTS.md and the user-approved DAG image outrank conflicting historical baseline notes.

## This slice

1. Repair the isolated executable resolver environment and make the active-run deadline test
   independent of Git/workspace preparation speed.
2. PostgreSQL identity, organization/member/project data, explicit checksum migrations, hashed
   revocable desktop sessions, scoped transactional writes and audit records.
3. Main-owned browser/loopback/PKCE login and encrypted session, typed preload views, cancellation,
   safe offline/expiry states and cross-context request fencing.
4. A global Settings organization section: connect/exit, organization switch/create, projects,
   invitations and members. Use real APIs and no nested settings modal or fabricated data.
5. Real database restart/security tests, Electron journeys, screenshot matrix and packaged regression.

Each is verified before it is marked PASS in `reports/A1-report.md`. A test failure stays visible.
Screenshots demonstrate implementation; visual approval remains the user's decision.

## Subsequent slices

- A2: versioned organization assets and authorized Worker registration/dispatch.
- A3: requirement-owned documents, workflow context, Plan lineage and feature Worktree, with the
  project journey becoming an aggregation of requirements.
- A4: version-pinned configurable workflow instances and non-bypassable document/design/test/review gates.
- A5: integrated two-client/two-organization/two-requirement acceptance and deployable trial release.

The current organization Settings UI is not an assertion that these later slices exist. The future
information architecture remains organization → project → requirement; shared project metadata does
not yet give a remote user permission to run tools on a local computer.
