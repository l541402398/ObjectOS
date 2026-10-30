# ADR-0069 — Organization Local Worker and frozen native execution

- Date: 2026-10-29 (America/Los_Angeles)
- Status: implementation authorized by the user's continued-development request.
- Base: `4e1936965e26022379888277c6cced57c05a07e9`; branch `codex/org-a2-worker`.

## Plan alignment

This is the execution bridge required by A2, following the real A2.1 catalog. It does not jump
to requirement-owned workspaces or a workflow engine (A3/A4). Keep the existing Runtime/SQLite,
AssignmentResolver, ProviderManager and AgentRunner. Catalog pins become validated frozen Run
configuration; neither chat nor client graph state becomes authority. Preserve the existing
graph-only Agent workspace and approved Premium Liquid Glass direction.

## Trust and execution

Delivery checkpoint **A2.2a** implements identity, real heartbeat, expiring native-confirmed local
project consent, revocation, scoped persistence and recovery. It deliberately exposes
`executionReady: false`. PostgreSQL migration 3 contains Workers/grants; SQLite migration 37 contains
local identity/consent/audit. No empty job/lease tables or executable fake integration are installed.
The job/fencing/AssetBindingResolver/Run decisions below define **A2.2b**, still remaining. This
subdivision follows the original plan's independently runnable milestones; A2 is not complete.

Main serializes Worker IPC, encrypts registration proof before POST and excludes machine paths from
the strict outbound grant. An unknown grant response revokes local consent and queues the known-id
remote revoke. Cancellation before POST is marked locally settled. Logout/context changes first
persist a safeStorage revoke intent; even a stopped Runtime cannot prevent account logout. The
Runtime applies that durable local clear after recovery before any new Worker operation.

1. Append PostgreSQL migration 3 (Worker identity and project grants)
   and SQLite migration 37 (local identity, expiring project grants and consent audit).
   Append job/lease/Run receipts in the next execution checkpoint; do not precreate placeholders.
   The existing migration bytes/checksums remain intact. Runtime stays the sole local writer.
2. Main creates a random device secret and registration identity, encrypts them before enrollment,
   and keeps them out of Renderer and SQLite. Server stores only the hash and ties the device to
   the current owner desktop session. Re-enrollment requires both owner login and existing device
   proof. Revoked session/membership/device prevents new Worker authority.
3. Registration grants no filesystem permission. Linking a shared project to a local project
   requires a Main-owned human confirmation. Runtime derives and records the canonical local root,
   scope, tool allowlist, expiry and consent receipt. The server receives only an opaque workspace
   reference, never an absolute local path. A local project cannot silently belong to two orgs.
4. Execution is explicitly accepted on the owning device. Jobs have idempotent request identities,
   one active device lease, monotonic fencing, bounded budgets and frozen asset checksums. Main
   forwards device credentials to Runtime memory only, like provider credentials; no persisted
   lease token survives restart. Unknown claimed/started results require reconciliation, not retry.
5. Use the existing native AgentRunner. Resolve a project-pinned published native Agent and its
   explicitly versioned Skills through the shared catalog; validate checksums and scope. Reuse
   assignment viability checks and narrow local Agent permissions/tool catalog. Freeze all content
   and provenance in the existing Run snapshot. Updates never widen a running Run.
6. This bridge initially advertises only native `list_directory`, `read_file`, `write_file`.
   Each target is canonically checked against the consented local path scope. Existing file-write
   policy/approval and trusted file baseline still apply. Shell, CLI/ACP, arbitrary MCP execution
   and remote unattended execution are not advertised or silently substituted: directory-scoped
   grants are not an OS command sandbox. Existing personal-mode execution remains available.
7. Revalidate remote lease, current actor/project permissions, local grant/root, asset revocation,
   tool and budget before each tool and again after approval immediately before execution.
   No new side effect starts from cached/offline authority. In-flight operations cannot be undone;
   loss/crash leaves explicit local/server reconciliation facts. Logout/org switch clears local
   authority and safely stops organization Runs. Lease tokens/secrets never enter Run snapshots.
8. Server receives only minimal Run state and audit references, not raw workspace files or model
   output. A local audit link is useful only on its owning device. Result publication is separate.

## UI and evidence

Refine the existing organization Settings context into a compact, legible header; maintain explicit
account/org controls and inline editors. Add a real device table, native capabilities, project
consent, pending work, version provenance and local audit actions. No decorative statistics or fake
online/installed states. Use the existing semantic tokens and shared Radix/Motion primitives.
Record before/after 1440/1024 light/dark/125% captures, keyboard/a11y/contrast and real PG/Electron
flows, negative revoke/expiry/path/fencing tests, migration preservation and required package/E2Es.
The protected Lab's unresolved five-fix notes are not rewritten as acceptance. This additive feature
does not restyle protected pages. Open-source provenance and actual use are recorded, not asserted
without source inspection. Final aesthetic acceptance remains the user's decision.
