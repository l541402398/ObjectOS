# ADR-0088 — Organization work as a primary workspace

Date: 2026-11-07. Base HEAD: `df48fa25f5f48eb4d3ae537cc28369e8a33fb5ca`.
User request: move organization work out of Settings, simplify layout and workflow while retaining
essential information and actions. This supersedes ADR-0087 decision 8's location, not its behavior.

## Decision

- Add a global `/organization` route and a primary sidebar entry, reachable without a local project
  and while signed out. Settings remains a global modal; its account section links to the workspace.
  The local-project journey strip is absent on this global workspace: leader collaboration does not
  require creating a local project. Real navigation, breadcrumb, command palette and route registry agree. Existing Settings deep links
  remain compatible through a visible workspace link; no hidden business forms stay in Settings.
- Organization workspace opens on requirement collaboration. Provide direct section navigation for
  organization knowledge, knowledge review, shared projects, members/invitations, reusable assets and
  execution devices. Keep connection/account controls compact and secondary. Member and manager
  permissions remain server-owned; no role, approval, backend, IPC or persistence changes.
- Use a persistent requirement list and contextual detail on wide windows; search/status/person/project
  filters operate only on the bounded retrieved list, never claim global counts. Show priority, deadline,
  project, assignee and state. Details expose the next valid action, brief, criteria, progress and evidence;
  exceptional actions and full audit remain available. Narrow layouts use the same data with a focused
  detail/back path. Keep selected requirement deep links and local development return navigation.
- Preserve every K4 dispatch/accept/decline/progress/delivery/review/withdraw/cancel/reassign operation,
  unknown-outcome GET/retry/manual-close controls, K1/K2 knowledge/assets and K3 review/publication,
  invitations, roles, Worker consent and job controls. Forms continue to submit the same named API.
- Reuse the draft context with a route-level unsaved-change guard, plus dirty scope/account switching
  controls. Background fetches must not temporarily remove an edited requirement form. Explicit actions
  retain the revision/report originally reviewed. Unknown mutation results remain durable operations.
- Surface assignment origin, progress/delivery and organization return link near the local requirement
  workflow, rather than burying them inside the organization-materials tab. Knowledge selection and
  writeback retain their independent evidence and confirmation gates.
- Preserve frozen Premium Liquid Glass tokens, local Noto Sans SC, shared overlays and reduced motion.
  Production navigation gains its requested organization placement via an explicit adapter; the protected
  Design Lab keeps its existing navigation projection and pixels. No graph composition/material changes.

## Verification

Real isolated Electron/PG: top-level reachability with/without a selected project, login, scope changes,
dirty navigation/back, list/detail continuity, lead dispatch/member receive/local development return,
progress and separate delivery review, knowledge review, all retained management entries and recovery.
1440/1024 light/dark 100/125% captures, native composited contrast, axe, keyboard and approved-DAG
comparison. Run root-required static/unit/build/desktop/package checks and keep real evidence in
`docs/v2/evidence/organization-workspace-ux/`. No whole-app visual acceptance inferred from unit tests.
