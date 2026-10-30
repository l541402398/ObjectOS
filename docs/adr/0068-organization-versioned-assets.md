# ADR-0068 — Versioned organization assets (A2.1)

- Date: 2026-10-29 (America/Los_Angeles)
- Status: implementation authorized by the user's request to continue the approved plan.
- Base: `d5c99e245d4262e2f02b81df94791c818141e68c`; branch `codex/org-a2-assets`.

## Decision

A2 is delivered in independently runnable sub-milestones allowed by the original package.
This sub-milestone implements the shared asset catalog and explicit project version bindings.
Worker registration/leases, local project linking and the AgentRunner binding resolver follow
in A2.2; a catalog binding never implies local installation, execution or a frozen local Run.
The existing Runner, local definitions and graph workspace remain the execution authority.

1. PostgreSQL is the sole writer of organization Agent/Skill/MCP/Tool definitions. Append schema
   migration 2 without changing the original migration-1 bytes/checksum. Validate every known
   migration and reject unknown or changed versions. Migrations remain explicit and transactional.
2. Organization-wide assets require `org.publish_asset`; project-private assets additionally
   require `project.manage_assets` in that project. Organization roles never imply project access.
   Read access uses current membership and visibility. All writes revalidate under the same
   organization lock used by A1 membership changes, before reading/updating asset rows.
3. Drafts use an expected revision. Publication freezes the definition and canonical SHA256.
   Subsequent edits create a new version. PostgreSQL also forbids rewriting a published definition.
   Published versions can be deprecated (no new bindings) or irrevocably revoked. Existing pins
   survive as audit facts with their effective version state; revocation does not silently delete
   a binding or substitute a newer version. Project binding changes use compare-and-set.
4. Structured definitions allow configuration and named credential references, never env-value
   bags, URL credentials or private keys. Recognizable secret formats are rejected at the shared
   schema boundary; arbitrary prose cannot be certified secret-free and remains the publisher's
   responsibility. No runtime credential distribution is introduced by this slice.
5. Named typed IPC carries sanitized asset records. Main retains auth, checks response generation
   and validates output. Renderer makes no HTTP requests. Account/org changes discard scoped data.
   Asset replies have an 8MiB streaming bound (other replies retain 1MiB), at most 100 versions
   from 64KiB write requests, and 200 visible project bindings. The UI labels its binding list as
   the current list; this slice has bounded catalog/history and no unlimited pagination claim.
6. Extend the existing organization Settings view with a table and inline version/details/editor,
   publishing confirmation, field comparison and scoped binding controls. Preserve semantic tokens,
   shared controls and bounded/reduced Motion. No new modal, graph change or new visual direction.

## Validation and limits

Use real PostgreSQL tests for v1→v2 preservation, immutable versions, stale edits, tenant/project
isolation, role removal, concurrent publication/binding and revocation. Use real Electron/browser
login and typed IPC for draft/edit/publish/diff/bind/revoke/restart, plus 1440/1024 light/dark/125%
captures, keyboard/labels/contrast/overflow checks. Run required repository and packaged regressions.
Commit evidence with implementation and push the isolated branch. User aesthetic acceptance,
full axe/screen-reader and new effect benchmarks remain explicit verification boundaries.

The frozen Design Lab still has the separately documented five-fix inconsistency. This additive
Settings feature reuses A1 surfaces; it does not migrate or restyle protected pages. No production
deployment, remote unattended execution or complete A2 delivery is claimed. Rollback uses a
pre-migration database backup; an A1 server intentionally rejects schema 2 rather than mutating it.
