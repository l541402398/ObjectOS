# A1 organization connection — UI implementation and review record

- Date: 2026-10-29 (America/Los_Angeles).
- Baseline: `ec97824d7751cc3d443ae1cdac4793e9170ed1ec`.
- Branch: `codex/org-a1-foundation`.
- User decision in this session: continue with the approved **Premium Liquid Glass**, refine
  typography and interaction; do not promote Precision or the warm Studio candidate to a new baseline.
- Status: implementation and source checks complete; the real organization Electron journey ran
  **30 PASS / 0 FAIL**, including native-capture 125% screenshots. Full a11y/visual acceptance is
  not implied by those functional checks. Agent-graph changes have their own final E2E record.

## Scope and composition

`SettingsModal` remains the global shared `DialogShell`. The new `账号与组织` section is reachable
from the sidebar and command palette. Creating an organization/project, inviting or managing a
member, and assigning project roles open inline content inside that section. There is no nested
modal or second backdrop.

- Local mode: a compact optical connection surface with one server address and a system-browser
  sign-in action. Pending sign-in has an explicit cancel action; no progress is invented.
- Connected mode: account and server identity, connection state, organization selector, and one
  active resource view. Projects and members use compact semantic tables. Invitations are actionable
  account-scoped rows. New forms appear only when requested.
- Invitations require a separate one-time code delivered by the inviter through a trusted channel.
  The generated code is masked by default with explicit show/copy actions; its mutation has zero
  retention after unmount. Acceptance requires the code; rejection does not. It is not persisted
  in UI preferences or scope queries, and screenshots should keep the mask in place.
- Offline/expired state: explicit status, recovery action and local-project preservation. Offline
  revocation has a visible retry. Errors appear beside the operation, not only in transient toasts.
- Shared project records are labelled as team metadata. Local directory association/execution is
  a later slice; this screen has no fake “open/run project” action.

The UI calls only the named typed `window.projectos.organization` methods. Connection views contain
no bearer token. Query keys include server, account and organization. Scoped query caches are
cancelled and removed **before** account/organization changes; scoped content is hidden while a
change is pending.

## Palette correction

The semantic layer and its compatibility aliases remain. `index.ts`, `tokens.css`, and
`unified.css` were synchronized to the approved blue-violet/cyan optical world. Warm hardcoded
sidebar/titlebar/main surfaces were replaced by the same semantic glass values. Page structures,
the protected Design Lab and execution behavior were not redesigned by this change.

The action color remains `#4F64D9`. The initial light canvas `#E9EEF8` produced only **4.34:1** for
that text color in the existing token test. Light canvas/sunken surface therefore use `#EFF4FC`
(**4.57:1**). A stronger semantic success/warning/danger/info text variant preserves legibility.
The existing contrast and CSS/TypeScript synchronization tests pass unchanged: **20/20**.

Body and forms use 14px; supporting content uses 12–13px with 1.5+ line height. Text-bearing
surfaces are opaque, focus rings remain visible, and labels are explicit. Native inputs/selects
support keyboard and password-manager-compatible browser authentication. Motion is a bounded
180ms content offset on resource changes, disabled by `useReducedMotion`; no new blur/filter or
WebGL effect is introduced.

## Sources actually consulted

The session has no dedicated skill-loader tool. The files below were read from actual checked-out
sources; this is a limitation of tool loading, not a claim that the unavailable tool ran.

| Source | Actual proof / application |
|---|---|
| UI/UX Pro Max | `.tmp/reference-uiux/.claude/skills/ui-ux-pro-max/SKILL.md`, commit `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03`; source search script queried typography, color, layout, accessible authentication and reduced motion. Spatial-gray palette and external web-font import were rejected in favor of the approved palette and installed CJK fallback. |
| Vercel composition | `.tmp/reference-vercel/skills/composition-patterns/SKILL.md` and `rules/patterns-explicit-variants.md`, commit `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62`; connection, creation, project, member and invitation components are composed separately. |
| Vercel React | Same commit, `skills/react-best-practices/SKILL.md`, `rules/async-parallel.md`; scoped React Query data and mutation invalidation, no synchronous IO or graph/layout work in renderer. |
| Impeccable | `.tmp/reference-impeccable/cursor-plugin/skills/impeccable/SKILL.md`, `reference/craft-floor.md`, `reference/operate.md`, commit `02523aec3e4c4580102d996d1b6a71fbe062e03f`; context ran once at the parent level, existing contract/user brief supplies context, no invented `PRODUCT.md`. Final source detector on the changed organization surface returned `[]`. |
| Sim Studio | Parent inspected actual `canvas-menu.tsx` at commit `a52fc509b5b8a18df519ff0781f00c8d45711164`. This UI slice changes no graph composition and copies no Sim source or brand assets. |
| Liquid Glass React | Installed `liquid-glass-react` 1.1.1 package and `dist/index.esm.js` inspected, together with the existing Electron-safe `OpticalGlass.tsx`. Package effect is not enabled here. Previous measured compatibility limits remain; no new FPS claim. |
| React Bits | Existing attributed `features/design-lab/Aurora.jsx` inspected (MIT + Commons Clause notice preserved). No shader added/enabled. |
| Motion | Installed Motion 14.6.0 and existing overlay source inspected; this slice uses `motion/react` and `useReducedMotion`. |

Source links: [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill),
[Vercel Agent Skills](https://github.com/vercel-labs/agent-skills),
[Impeccable](https://github.com/pbakaus/impeccable), [Sim](https://github.com/simstudioai/sim).
No external project component/brand code was copied into this UI.

## Five-fix baseline check and limits

The current root contract and approved DAG screenshot remain authoritative. Source inspection of
`StageJourney.tsx` / `design-lab.css` found that the protected Lab still contains always-visible
stage-copy/count markup and an active-edge dashed looping animation, despite an older progress
document claiming all five fixes complete. This slice does not modify that protected graph or use
that old claim as acceptance. A full graph/page rollout must independently resolve those items
and capture comparisons with the approved screenshot.

## Actual checks / remaining verification

| Check | Result |
|---|---|
| `pnpm exec vitest run tests/design-tokens.test.ts` | PASS — 20/20, unchanged assertions |
| Changed renderer `pnpm exec eslint …` | PASS — 0 errors; 4 existing AppLayout warnings |
| Impeccable source `detect --json` | PASS — `[]`; source scan only |
| Whole-repo `pnpm typecheck` | PASS — final exit 0; checkpoint Main error typing was corrected |
| Actual organization Electron screenshots / 1440 + 1024 / light + dark / 125% | A1 real journey 30 PASS / 0 FAIL; native 125% capture resolves the earlier clipped Playwright image; source `docs/org-upgrade/evidence/A1/electron-checks.json` |
| Full axe / screen reader / foreground FPS | Not claimed by this source record |
| User visual acceptance | Pending actual screenshot review |

## User-directed Agent graph consolidation

The user's follow-up explicitly retains the existing drawn relationship canvas and removes the
chat-style inner page. Actual reference frames were viewed at `.tmp/video-frames/reference-clear-1.png`
and `reference-clear-8.png`: several execution Agents feed a central aggregation object through
separate curved endpoints, then produce document artifacts, with a material-handoff event strip.
The video is evidence for relationship semantics, not authorization to copy its external branding
or impose permanent three-column UI. Reference frames remain outside committed product evidence.

`CollaborationGraph.tsx` and `focus-projection.ts` are unchanged: the existing SVG relationship
layer, ELK layout, ports, focus set, pan and zoom remain intact. `AgentWorkbenchPage` now renders
only that collaboration workspace plus the real Agent-management overlay. The obsolete full-page
message composer, chat message list and group-chat view were removed. Neither stored messages nor
session/Runner/backend capabilities were deleted.

Selecting an Agent opens its existing detail surface with a compact execution action section:
choose or create a persisted context, submit an instruction through the existing approval-aware
`sessions.sendMessage` path, inspect the real Run state and stop an active Run. The most recent
persisted output is a collapsed read-only snapshot, without message bubbles or a second chat page.
Current Agent approvals continue through the existing in-node risk confirmation. Run/task/artifact/
handoff details and audit routes remain available.

Legacy `?workspace=sessions&session=...` and `?view=pro` links resolve to the same graph. A valid
session selects its own Agent/context; foreign Agent/project contexts are filtered. The formerly
unreachable Agent-management dialog is now rendered alongside the graph.

Actual targeted checks: `tests/agent-context.test.ts` (3) + `tests/collaboration-focus.test.ts` (2)
**5/5 PASS**; changed graph-view ESLint **0 errors / 0 warnings**; typecheck passed at the checkpoint.
Final real Electron graph evidence is produced by `scripts/agent-overview-e2e.mjs` with
`PROJECTOS_OVERVIEW_EVIDENCE_DIR` pointing to A1, preserving historical screenshots. Pixel,
endpoint, approval, projection and restart assertions are retained; navigation assertions now
require the graph-context action section and the absence of the removed chat page.
