# Phase 5 — Agent & Collaboration Slice

Date: 2026-10-23  
Branch: `feature_dev_ux`  
Status: **third Phase 5 slice implemented; remaining routes not started**  
Approved reference: `0686c41` / `APPROVED_design_lab_DAG.jpeg`

## Scope

- **Agent Workbench** (`/projects/:id/agents`)
- **Collaboration / Cross-session** (`/projects/:id/collaboration`)

Both keep real sessions, messages, runs, approvals, inbox and handoff data.

## What changed

### Agent Workbench

Files:

```text
apps/desktop/src/renderer/src/pages/AgentWorkbenchPage.tsx
apps/desktop/src/renderer/src/styles/agents-workspace.css
```

- New `AGENT WORKBENCH` optical console header with real provider/agent/session
  signals.
- Real actions retained: refresh, model settings, Agent management, new
  session.
- Provider banner restyled with warning material.
- Chat pane, session switch and run inspector use Design Lab surfaces and
  border/shadow tokens.
- No changes to message sending, run cancellation, approval or session
  selection behavior.
- Light/dark theme follows `useResolvedTheme()`.

### Collaboration

Files:

```text
apps/desktop/src/renderer/src/pages/CollaborationPage.tsx
apps/desktop/src/renderer/src/styles/collaboration-workspace.css
```

- New `CROSS-SESSION` header with real Agent/session/message/handoff counts.
- Real actions retained: Agent Workbench, manual delivery.
- Provider banner, four metrics, inbox rows, Agent roster and handoff cards
  restyled with the same optical material and type scale.
- Real confirm/wake/handoff actions unchanged.
- Light/dark theme follows `useResolvedTheme()`.

## Screenshots

| State | File |
|---|---|
| Agent Workbench before | [agents-before.png](visual-regression/phase5-pages/agents-before.png) |
| Agent Workbench 1440 light | [agents-1440-light.png](visual-regression/phase5-pages/agents-1440-light.png) |
| Agent Workbench 1440 dark | [agents-1440-dark.png](visual-regression/phase5-pages/agents-1440-dark.png) |
| Collaboration before | [collab-before.png](visual-regression/phase5-pages/collab-before.png) |
| Collaboration 1440 light | [collab-1440-light.png](visual-regression/phase5-pages/collab-1440-light.png) |
| Collaboration 1440 dark | [collab-1440-dark.png](visual-regression/phase5-pages/collab-1440-dark.png) |

## Verification

```text
pnpm lint       PASS (0 errors)
pnpm typecheck  PASS
pnpm test       PASS — 48 files, 266 passed, 3 skipped
pnpm build      PASS
node scripts/phase5-pages-e2e.mjs
                PASS — 22 checks
```

E2E additions:

- Agent Workbench header, real chat session and run inspector render.
- Collaboration header, real inbox rows and four signals render.
- Previous Overview / Center / Approvals / Board checks remain green.
- No page errors.

## Package

```text
release/win-phase5-pages/ProjectOS-1.7.0-win-x64-portable.exe
commit:   9134914
size:     98,510,852 bytes
SHA256:   151E43DB535A6B6A6B3FC07D3C484810C76C47C3A9AA7A9DB6DD980AC8ABC9C9
```

Unsigned portable build; `pnpm test:package` passed.

## Known limitations

1. Agent message bubbles retain the business message component styling; only
   the workspace around them was migrated.
2. Provider-not-configured banner remains a real product state and is kept.
3. 1100px and 125% captures for these pages are not done yet.
4. Remaining routes: Orchestration canvas, Workspace, Knowledge, Operations,
   Resources, Settings, Health, Runs.
5. No stable merge.

## Stop condition

This slice stops for user visual confirmation of Agent Workbench and
Collaboration before the next route group.

