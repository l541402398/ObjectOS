# A1 foundation and graph-only Agent workspace — acceptance record

Date: 2026-10-29 (America/Los_Angeles). Branch: `codex/org-a1-foundation`.
Starting HEAD: `ec97824d7751cc3d443ae1cdac4793e9170ed1ec`. The implementation and evidence are
committed together; the exact implementation SHA is recorded in the adjacent evidence manifest
after commit. No merge to `main`, production deployment or local-project import is performed.

## Delivered scope

- A separately started PostgreSQL organization service: explicit checksum migrations, persisted
  identities/organizations/members/projects, scoped writes inside transactions, audit records,
  hashed/revocable desktop sessions and single-use invitation codes. Organization membership never
  silently becomes project access or local execution permission.
- Real system-browser login protocol, PKCE and one-use loopback callback; Main owns encrypted
  credentials. IPC exposes sanitized views. Cancellation, total login deadline, secure-store failure,
  offline revocation, account/organization changes and stale responses have regression coverage.
- A real global Settings section for connection, organizations, shared project metadata, members,
  invitations and project roles. Forms are inline; no nested settings modal. Return to local mode
  preserves local execution history and files. Shared projects are not presented as linked local
  workspaces or executable Workers.
- The user explicitly selected the approved Premium Liquid Glass direction. The single semantic
  token layer and legacy aliases remain; the unapproved warm palette drift is corrected to the
  approved cool optical palette. New controls use the common typography, focus and Motion rules.
- The user supplied two videos and explicitly requested retention of the existing collaboration
  drawing/connection approach and removal of the chat-style inner page. The second video was
  decoded and reviewed at 1s/8s. The original `CollaborationGraph.tsx` and `focus-projection.ts` have
  no diff from the starting HEAD. The full-page chat branch is removed; old session links resolve
  to graph-object context. A selected Agent has compact instruction/run controls and folded output;
  approvals and audit remain real. User-supplied video/frames are not copied into product assets.

## Actual checks

| Command / check | Result |
|---|---|
| `pnpm lint` | PASS — 0 errors / 29 existing warnings; dependency boundaries OK |
| `pnpm typecheck` | PASS — exit 0 |
| `pnpm test` | PASS — 536 passed / 4 skipped / 0 failed; 100 files |
| `pnpm build` | PASS — Runtime, desktop Main/preload/renderer and separately runnable server |
| `node scripts/e2e.mjs` | PASS — create local project + restart recovery |
| `node scripts/agent-e2e.mjs` | PASS — graph-context instruction, actual approval pause, approved file write and completed Run |
| `node scripts/v12-e2e.mjs` | PASS — global settings, connection CRUD/probe/discovery/default, graph-context native Run, restart and compact rail |
| `node scripts/v13-e2e.mjs` | PASS — project scan, transactional plan approval, persisted graph/layout, inline connection editor, recovery |
| `node --import tsx scripts/org-a1-e2e.mjs` | PASS — 30 real PostgreSQL/Electron/browser/IPC checks, including OS safeStorage and both server/desktop restart |
| `PROJECTOS_OVERVIEW_EVIDENCE_DIR=docs/org-upgrade/evidence/A1/graph node scripts/agent-overview-e2e.mjs` | PASS — 30 checks; visible-edge pixels/endpoints, focus, graph-only context, real approval, zoom, reduced motion and Runtime recovery |
| `node --import tsx scripts/org-server-artifact-smoke.mts` | PASS — compiled JavaScript migration + PostgreSQL server `/health` |
| `pnpm package:dir` | PASS — Windows x64 unpacked app |
| `pnpm test:package` | PASS — actual packaged EXE creates/writes/restarts and recovers |

The four skipped unit/integration cases are the opt-in real SSH/VPS and external model/CLI Harness
scenarios. No live infrastructure or real paid-model execution was attempted this round. The graph
E2E uses a local fake provider and explicitly seeded persisted artifacts/handoff; it proves UI/IPC
and persistence behavior, not autonomous model quality. The organization E2E uses actual PostgreSQL,
actual Electron and an unprivileged isolated browser session for the browser handoff.

## Visual and interaction evidence

- [Organization connection](../evidence/A1/screenshots/connection-1440-light.png)
- [Shared projects](../evidence/A1/screenshots/projects-1440-light.png)
- [Members](../evidence/A1/screenshots/members-1440-dark.png)
- [125% native capture](../evidence/A1/screenshots/projects-1440-light-125.png)
- [Agent relation canvas](../evidence/A1/graph/screenshots/overview-1440-light.png)
- [Selected Agent context](../evidence/A1/graph/screenshots/agent-inspector-1440-light.png)
- Raw checks: `../evidence/A1/electron-checks.json` and `../evidence/A1/graph/electron-checks.json`.

The organization matrix includes 1440/1024, light/dark and actual 125% zoom. Browser registration
and consent pages are captured separately. Native `webContents.capturePage` avoids the Chromium
zoom screenshot clipping observed during QA. Keyboard reachability, form labels and overflow are
checked; Impeccable source detection returned `[]`. This is not a full axe/WCAG, screen-reader or
foreground FPS benchmark. Final aesthetic acceptance remains the user's decision.

Comparison uses the existing approved Design Lab and historical Agent overview captures, with
the current graph geometry/source preserved. Final native captures wait for overlay opacity 1
and an additional 1200ms compositor settle. An earlier native capture caught the 240ms entrance
mid-transition and looked translucent; the settled screenshot was inspected and is opaque. No
product opacity or choreography was changed to hide that capture error.
The final copy review also replaced development jargon in the shared-project boundary note with
a plain explanation of local-directory and execution permissions; the app was rebuilt/repackaged
and the organization journey/screenshots rerun after that wording-only change.

## Failures found and corrected during this implementation

1. The executable resolver used host PATH in subprocess probes despite an injected environment;
   probes now receive the effective environment. The deadline test now observes an actual running
   task before advancing time, retaining budget/audit/lease assertions.
2. A Windows guard-test teardown removed files before stopping the runner and without transient
   handle retries. It now shuts down the runner before closing/removing its own isolated fixture.
3. Raw dot-segment paths could reach vendor organization APIs without the new audit/invitation
   controls. The persistent server canonicalizes paths, rejects encoded/ambiguous variants and
   exposes only four explicitly allowed vendor identity endpoints. Raw `node:http` negative tests
   assert rejection and unchanged organization counts. Generic project-role writes exclude owner.
4. Real browser navigation exposed two issues that HTTP-only tests missed: `no-referrer` made the
   form Origin opaque, and self-only form CSP blocked the redirect to the loopback port. Same-origin
   referrer policy and an exact, validated callback origin fix both; null Origin and invalid callback
   origins/ports remain rejected.
5. Email matching alone was insufficient invitation proof. Acceptance now additionally requires a
   one-use random code; only its hash is stored and listing invitations never reveals it.
6. Approving a tool from Agent context previously closed the whole inspector. Agent/Task context
   now stays open through completion; only a consumed Approval-node selection is closed.
7. Legacy E2Es assumed a retired chat route and shared browser profile. They now use graph-object
   controls and isolated browser profiles while keeping their real file/approval/Run assertions.
   A dark-token assertion was updated to the user-approved palette rather than the rejected warm one.

## Explicit remaining boundaries

- This is the A1 foundation, not a deployed multi-tenant production platform. Production mail/email
  ownership verification, distributed limiting, database RLS, device/session administration and
  extended account profile fields require subsequent work. Pending invitation metadata/rejection
  currently follows the matching account email; no email-ownership assurance is claimed.
- Worker dispatch and asset publishing (A2), requirement-owned Worktree/Plan/workflow (A3/A4), and
  integrated two-client production/trial acceptance (A5) remain unimplemented by this slice.
- No production service was deployed. HTTPS outside loopback is required. Deployment secrets are
  not committed. The example environment file contains placeholders only.
- Native React Flow edge measurement still uses the existing documented SVG compatibility layer.
  This drawing method is preserved intentionally, with pixel/coordinate evidence.
- Existing Design Lab source and older five-fix progress notes conflict. This slice does not alter
  the protected Lab or falsely claim all five fixes have passed. Dense legacy graph metadata and
  a full overlay/a11y/performance sweep remain separate work.
