# ADR-0081 — Audited Git delivery and organization native jobs

Date: 2026-11-05 (America/Los_Angeles). Status: implementation authorized by the user.

The user requested remote synchronization, organization execution, approval/audit parity for legacy
merges, Agent automatic and fully manual conflict modes, timeout fixes, real desktop/DeepSeek
acceptance, and a code/evidence commit and push. This extends ADR-0030/0069/0074/0079/0080.

## Git authority

Append SQLite migration 44; preserve migrations 1–43. Persist operations with frozen repository,
branch, source/target/remote commits, complete content digest, approval, Run and ToolCall links.
All mutations evaluate policy and require an operation-specific human approval. Acknowledging an
approval does not claim success; operations run asynchronously and save actual results.

Fetch updates only the explicitly configured remote tracking ref. Pull integrates the fetched,
reviewable commit (never an unbounded `git pull`); push sends the exact reviewed local commit,
without force, after comparing the remote's current tip. No credentials appear in Renderer,
SQLite, artifacts or logs. Unknown external outcomes become needs_reconciliation and are never
replayed on recovery. Read-only reconciliation checks observable commit/ref facts.

Conflict modes are explicit: `manual` preserves a private merge workspace for human resolution;
`agent` uses the existing native AgentRunner in that same bounded workspace. Neither mutates the
target while resolving. Store base/ours/theirs, resolutions and their author/run. Require complete
resolution, fresh full-content review and real verification before separately approving target
integration. Changing either side invalidates authorization. Publication is a separate approval.
Legacy `worktree.merge` requests this same approval/audit path; autonomous delivery must not treat
a pending approval as a completed merge. Record post-merge checks and actual commit lineage.

## Organization execution

Append PostgreSQL migration 4 and a local job receipt ledger. The server owns job identity,
requester/project permission, an immutable published Agent/Skill configuration, one active Worker
lease and monotonically increasing fencing. Lease tokens stay in Main/Runtime memory; only hashes
live on the server. Expired started/claimed work requires reconciliation, never automatic reassignment.

Users submit jobs from the existing organization settings, choose an enrolled Worker and a shared
project with an active native directory grant. The owning desktop explicitly accepts each job.
Main authenticates requests; Runtime uses the existing AgentRunner, ProviderManager, capacities,
Task leases and file approvals. No second runtime or unattended shell/MCP bridge is introduced.
Native tools are limited to the consented read/list/write scope and budget. Recheck server lease,
current membership/project/Worker/grant/asset authority and canonical local paths before every
tool, including immediately after file approval. Revocation/offline/context loss blocks further
side effects; logout stops organization Runs. Persist local receipt before starting a Run and send
only minimal status and audit references to the server, never local paths or file/model contents.

## Performance and acceptance

Remove duplicate Git process launches within one trusted capture; do not cache mutable approval
facts across operations or widen timeouts. Profile and run the unchanged 30-second scenario and
full suite without competing build/test jobs. Preserve the approved glass system and reuse existing
settings/approval/review components. Capture real desktop workflows, manual authentication/consent,
DeepSeek execution, conflict modes, negative authorization/fencing cases, crash recovery and package
smoke. Commit code, ADRs, screenshots and command outcomes together, then push the review branch.
