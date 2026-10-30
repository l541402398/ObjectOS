# A2 implementation sequence

Base: `d5c99e245d4262e2f02b81df94791c818141e68c`. A1 is committed and pushed. The user
authorized continued development on 2026-10-29 (America/Los_Angeles). The original upgrade
package explicitly permits independently runnable sub-milestones; each carries evidence and a push.

## A2.1 — versioned shared configuration

- Organization Agent/Skill/MCP/Tool catalog with real drafts, optimistic edits, immutable
  publication, field comparison, deprecation, irreversible revocation and explicit project pins.
- Organization and project-private visibility, separate project permissions, audited transactions,
  cross-scope skill-reference rejection, and named credential references without credential values.
- Existing global Settings and Premium Liquid Glass components; inline editing and confirmations,
  scoped caches, read-only/loading/error states and a recovery action for project reads.
- Additive PostgreSQL migration 2; migration-1 checksum/data retained. Main owns all HTTP/auth.
- Actual PostgreSQL/Electron/browser tests, screenshots and packaged regressions; see
  [A2.1 report](reports/A2.1-report.md) and ADR-0068.

## A2.2 — authorized execution bridge (remaining)

Worker registration, identity and capability/version checks; local project association;
organization/project grants, heartbeat/revocation and fenced/idempotent leases; safe reconciliation
of uncertain results. Integrate the existing AgentRunner/AssignmentResolver with an AssetBindingResolver
and trusted, frozen Run snapshots. Check scope/lease/path/tool/budget locally before each side effect.
An organization role grants no local shell access. Remote executor remains an abstraction.

Catalog pins in A2.1 are shared configuration facts. They do not install a Skill/MCP/Tool, mutate old
local Agent definitions, bind secrets, launch a Worker or prove Run snapshot adoption. UI states this
boundary. A2 is not complete until the execution bridge and its negative/recovery tests pass.

The Agent collaboration drawing/connection implementation and graph-only navigation remain protected.
Requirement-owned workspaces and configurable lifecycle instances remain A3/A4.
