# ADR-0072 — Soft Studio product surface

Status: **WITHDRAWN by the user's later 2026-10-30 instruction.** The user rejected this appearance
and requested restoration of the previous blue/cyan optical glass UI. The original product skin,
navigation and page layouts have been restored from the pre-package working snapshot. The decision
below is historical, not the active design contract. See `docs/design/optical-restore/REPORT.md`.

The user explicitly supplied `projectos-design-package-v2.zip` and authorized implementation in the
current branch, retaining ongoing work. This changes the product aesthetic selected in ADR-0070.
It is not permission to replace the runtime, introduce mock production data, or change authorization.
The latest task also explicitly prohibits remote push, merging and release publication.

## Sources and conflicts

- Input archive SHA-256: `FD257866A299E14A0DADEDE0B55503E94DDA7ABA782982A185BC79EB7EC1BE77`.
  START-HERE, Codex brief, all eight Markdown chapters, tokens, preview CSS, verification README
  and four supplied previews were read. The actual offline HTML prototype was opened and operated
  in Edge; inspection and reference images are in `docs/design/soft-studio/baseline/`.
  The supplied PDF was not independently rendered; the complete Markdown text was used.
- Current starting HEAD: `f71d33e8acd70ec579501873c327e5b1180ee02a`, branch `codex/premium-system`.
  Existing modifications were captured in `baseline/pre-existing-work.patch`, and native screenshots
  of that built working state were saved before activation. No reset or parallel app was created.
- Historical V1.6 archive SHA-256: `0951013850D9CF15D72310FA3EABF30576A059061589F773B1114B77DB6786EB`.
  It was extracted and compared with the checked-in text (identical after line-ending normalization).
  Its full-glass / blue material direction is superseded for product pages; safety and lifecycle rules remain.
- The frozen `#/design-lab` and `#/precision-lab` are reference surfaces and retain their optical skin.
  They are not used as new product acceptance screenshots. The rejected R1 modal remains rejected.
- Recent complete local Chinese fonts and font-readiness gating are retained. The archive's main-branch
  font audit predates that repair. Removing these would reintroduce the observed fallback glyph problem.
- Earlier explicit user instruction retained graphical Agent collaboration as its primary view.
  Accordingly Agent still opens the real collaboration graph, not the prototype's default chat.
- Current project index is `StudioProjectHome`; `/overview` is lifecycle management. Both are retained,
  with clear contextual navigation. Existing legacy routes and query strings continue to work.

## Decision

One canonical `packages/design-tokens/src/soft-studio.json` supplies both Ant Design and generated
semantic CSS. New product default is Soft Studio; a persisted appearance preference can restore the
optical palette. Geometry, semantic components and accessibility improvements are shared.

Six primary sections are Overview, Tasks, Agent, Workspace, Operations and Activity. Existing features
remain reachable through contextual views, menus and the command palette. Runtime normal state appears
once in the status bar; errors and recovery actions remain prominent. The named journey stages remain.

Task flow remains a projection of typed Runtime graph snapshots. All assigned/unassigned tasks and real
edges are retained. Selection/status refreshes preserve locally dragged positions. Explicit save merges
the full graph with existing positions and reports failures without discarding the user's layout.
No database, IPC, execution protocol, approval policy or scheduling change is included.

## Evidence and limitations

The supplied prototype captures are reference-only. Product acceptance uses isolated real Electron
profiles with persisted Runtime data, native captures, and existing execution/approval E2Es.
Results and remaining gaps are recorded in `docs/design/soft-studio/REPORT.md`. Do not infer visual
acceptance from a successful build. App zoom at 125% does not prove Windows display scaling at 125%.

Mandatory source consultation continues from this working task: local UI UX Pro Max, Vercel composition
and performance guidance, Impeccable, pinned Sim controls/sidebar, pinned shadcn tabs, installed Motion,
Liquid Glass and Aurora compatibility evidence. Source snapshots/licenses are in
`docs/design/product-workbench/sources/` and `src/next-ui/vendor/`. There is no skill-loader tool exposed
for the three third-party skills; their actual local SKILL.md files were read directly. No claim of a
skill-tool invocation or new shader acceptance is made. No new dependency or copied brand asset is used.
