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

## A2.2a — device identity and local consent

Real device registration/proof, session-bound heartbeat, owner/admin pause/revoke and owner-proof
resume. Local project association requires a Main-owned native confirmation of canonical root,
relative directories, read/write permission, expiry and tool-call ceiling. Main secrets stay in
safeStorage; Runtime owns SQLite consent/audit; PostgreSQL receives opaque workspace references.
Local-first revoke survives service outage; encrypted clear intents survive Runtime outage and
logout. Devices explicitly report that task reception is not yet enabled. See ADR-0069 and
`reports/A2.2a-report.md` for actual evidence and limits.

## A2.2b — authorized execution bridge (remaining)

Fenced/idempotent job leases and safe reconciliation
of uncertain results. Integrate the existing AgentRunner/AssignmentResolver with an AssetBindingResolver
and trusted, frozen Run snapshots. Check scope/lease/path/tool/budget locally before each side effect.
An organization role grants no local shell access. Remote executor remains an abstraction.

Catalog pins in A2.1 are shared configuration facts. They do not install a Skill/MCP/Tool, mutate old
local Agent definitions, bind secrets, launch a Run or prove Run snapshot adoption. UI states this
boundary. A2 is not complete until the execution bridge and its negative/recovery tests pass.

The Agent collaboration drawing/connection implementation and graph-only navigation remain protected.
Requirement-owned workspaces and configurable lifecycle instances remain A3/A4.
