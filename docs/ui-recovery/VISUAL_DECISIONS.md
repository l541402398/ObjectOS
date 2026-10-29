# Visual decisions and P1-C scope

## What P0-A/P0-B changed visually

- The agent graph remains one full canvas; idle agents are folded into a compact bottom-right dock instead of being scattered through the graph.
- Edges are now visible above the canvas with a node mask, stronger 1.8px strokes and a closed arrowhead at the target. Handoff keeps a dashed, labeled treatment.
- The approval sheet now keeps the decision block visible above the footer, with an explicit risk checkbox and real API submission.
- No global color or shell rewrite was performed in P0. That is deliberate: visual exploration starts only after the P0 interaction defects are reviewable.

## P1-C direction (not implemented yet)

The three production pages must use three different compositions, not a shared three-column card template:

1. **Agent collaboration — Command Deck canvas**
   - Graphite/deep neutral working surface with a warm paper inspector.
   - Execution cluster is the visual centre; agents are identity capsules, tasks are small command cards, approvals are status tags attached to tasks, artifacts are file tokens.
   - Bottom Activity Tape; inspector appears on demand; no permanent three columns.
2. **Organization/project home — editorial dashboard**
   - One dominant progress/focus area with a real current goal, plan status and recent run evidence.
   - Supporting content as compact editorial rows/timeline, not six equal KPI cards.
3. **Requirements and approvals — review room**
   - Document-first reading column, diff/evidence in a contextual margin, decision rail only when a real approval is selected.
   - The approval decision remains the same safe API path proven in P0-B.

## Reference use

- `reference-ui/agent-command-deck.html` is the information-architecture and spatial reference. Its demo data is not product data, and its colors are not copied mechanically.
- Eigent: agent run card hierarchy. Angy: compact agent status. Dify: trace panel interaction. All are reference-only; Dify is custom-licensed and no code/assets are copied.
- ProjectOS keeps the approved Premium Liquid Glass shell outside the page; page-level visual masters may use a deeper working surface, but must not silently replace the whole shell.

## Review gate

P1-C is **not started** in this delivery. The next step is three real Electron visual masters at 1440/1024, light/dark/125%, followed by user visual review before any rollout. The P0 pages are the baseline those samples must improve.
