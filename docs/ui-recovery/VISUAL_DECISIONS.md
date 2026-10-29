# Visual decisions — P0 recovery + P1-C masters

## P0 baseline

The graph is one full canvas; idle agents are folded into a dock; edges are visible above the canvas with a node mask; node approval happens in-sheet with a real API and explicit risk confirmation.

## P1-C implemented masters

### 1. Agent collaboration — Command Deck canvas

- Warm paper / graphite working surface with a copper accent, instead of Precision white panels.
- Agent capsules, task command cards, artifact file tokens and approval tags keep their graph relationships.
- No permanent three columns; the graph is the page, with the standby dock and on-demand inspector.
- Both Light and Dark are first-class token sets (not a white page inverted).

### 2. Project home — editorial dashboard

- One dominant mission hero: current plan goal, stage, progress ring, live task/Run/approval counts.
- Asymmetric “In flight” focus list + “Needs a human” ledger; recent execution as a horizontal tape.
- Not six equal KPI cards, not the graph layout repeated.
- Real sources: `useBootstrap`, `usePlans`, `useTaskBoard`, `useRuns`, `useApprovals`, `useAgents`.
- `/work` keeps the previous WorkCenter page as an explicit legacy route.

### 3. Requirements/approval — review room

- Queue → document → decision rail; the document is the visual centre, not a table.
- Request parameters, path/content, command and run/task/expiry metadata are the evidence.
- Decision uses the same `approval.decide` API and risk checkbox as P0-B; no optimistic state.
- `/approvals` is the new review room; `/approvals/center` retains the professional audit center.

## Reference use

- `reference-ui/agent-command-deck.html` supplied the spatial and hierarchy direction; its demo data and exact colors were not copied.
- Eigent: agent run card hierarchy. Angy: compact agent status. Dify: trace/evidence reading. Dify is custom-licensed; no code or assets copied.
- ProjectOS Liquid Glass AppShell, GoalJourneyBar, navigation and design tokens remain; page surfaces are scoped to `.studio-theme` / `.aco-deck`.

## Visual evidence

- Agent: `overview-1440-light.png`, `overview-1440-dark.png`, `overview-1024-all.png`, `overview-1440-light-125.png`, `overview-1440-standby.png`
- Project home: `studio-project-home-1440-light.png`, `studio-project-home-1440-dark.png`, `studio-project-home-1024-light.png`, `studio-project-home-1024-dark.png`, `studio-project-home-1440-125.png`
- Review room: `studio-review-1440-light.png`, `studio-review-1440-dark.png`, `studio-review-1024-light.png`, `studio-review-1024-dark.png`, `studio-review-1440-125.png`

## Review gate

These three pages are the P1-C samples for visual review. They are not yet rolled out to every page. The next step is user review of these screenshots; only after approval should the visual language be propagated.
