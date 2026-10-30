# ProjectOS Overlay Audit

## Current migration — 2026-10-30

The system migration uses shared DialogShell/SheetShell/InspectorShell, FormDialog and
ProductDialogs for the remaining declarative forms and imperative confirmations. Settings
connection editing remains inline. Agent collaboration detail now uses a non-modal Inspector,
retaining canvas interaction and avoiding full-window blur during pulse animation. Open-layer
registration, topmost focus ownership, one backdrop and return focus are covered by the native
overlay journeys in `system-premium/REPORT.md`. The historical inventory below is retained as
the migration origin; its old “No” values are not the current implementation status.

## Historical inventory — 2026-10-22

Scope: every renderer `Modal`, `Drawer`, `Dialog`, `Popover`, `Sheet` and custom fixed/portal
surface under `apps/desktop/src/renderer/src`. Planner, Scheduler, Runtime, Teamwork and backend
contracts were not modified.

Method: `Select-String`/source reading of all renderer TSX (raw hit list saved during the audit),
followed by manual inspection of each call site and its parent. Counts reflect the source at the
time of this audit, not the number of visual variants.

## Inventory

| # | Surface / page | Source | Purpose | Library | Nested overlay | Clipping / scroll / stacking risk | Text / contrast | Migrated to new system | Reuse |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | Agent Studio (create/edit) | `components/AgentStudioModal.tsx:426` | Full Agent editor | Ant `Modal` | Contains #2 | `zIndex=5000`; 94vw; inner panes scroll; large surface | Dense 10–12px controls; small labels | No | InspectorShell for detail + DialogShell for editor |
| 2 | Agent Studio run test | `components/AgentStudioModal.tsx:770` | Run prompt/output | Ant `Modal` | Inside #1 | Double mask; inner modal over 5000 parent | `<pre>` output can overflow | No | DialogShell (nested modal, no blur behind) |
| 3 | Command palette | `components/CommandPalette.tsx:55` | Search/action launcher | Ant `Modal` | No | Fixed 640px; keyboard focus | 11–12px rows | No | DialogShell command variant |
| 4 | Orchestration plan generator | `features/orchestration/pages/OrchestrationWorkspace.tsx:1582` | Create plan prompt | Ant `Modal` | No | Large form; footer actions | Dense explanatory text | No | DialogShell editor |
| 5 | Orchestration worktree diff | `.../OrchestrationWorkspace.tsx:1812` | Diff viewer | Ant `Modal` | No | 900px wide; code overflow | Monospace/scroll | No | SheetShell viewer |
| 6 | Plan review task detail | `features/orchestration/components/PlanReviewNext.tsx:297` | Real Task Inspector | Radix `Dialog` (`next-ui/ui/dialog`) | **Inside Ant Modal** | Custom z=3000/3001; double overlay; right sheet 560px; parent modal clips/scales | 11–14px; custom sheet CSS | Partial: Radix, not new Overlay system | InspectorShell; do not create another Task Inspector |
| 7 | Settings | `features/settings/SettingsModal.tsx:88` | Global settings shell | Ant `Modal` | Contains #8–#14 | 1180px; sections scroll inside fixed modal; nested portals | 10–12px settings type | No | DialogShell with internal nav, not InspectorShell |
| 8 | Model catalog — add model | `features/settings/ModelCatalogPanel.tsx:262` | Add model form | Ant `Modal` | Opens from #7 | Nested modal over settings; mask stacking | Dense fields | No | DialogShell |
| 9 | Model catalog — detail | `ModelCatalogPanel.tsx:246` | Read-only model details | Ant `Drawer` | From #7 | Portals outside settings, but double mask; 460px | `v16-model-detail` 10–12px | No | InspectorShell detail |
| 10 | Runtime — custom | `RuntimeSettingsPanel.tsx:328` | Create Runtime | Ant `Modal` | From #7 | Nested modal | Dense form | No | DialogShell |
| 11 | Runtime — ACP auth | `RuntimeSettingsPanel.tsx:337` | Auth profile | Ant `Modal` | From #7 | Nested modal; auth fields  | Dense form | No | DialogShell |
| 12 | Runtime — edit | `RuntimeSettingsPanel.tsx:357` | Edit Runtime | Ant `Modal` | From #7 | Nested modal | Dense form | No | DialogShell |
| 13 | Skills — detail | `SkillsSettingsPanel.tsx:70` | Read-only Skill | Ant `Drawer` | From #7 | Duplicate drawer pattern; 560px | 10–12px | No | InspectorShell detail |
| 14 | Tools — Runtime detail | `ToolsSettingsPanel.tsx:54` | Read-only Runtime | Ant `Drawer` | From #7 | Duplicate drawer pattern; 460px | 10–12px | No | InspectorShell detail |
| 15 | Task board — create | `pages/TaskBoardPage.tsx:752` | Create task | Ant `Modal` | Possibly with #18 | 620px; nested form | Dense labels | No | DialogShell editor |
| 16 | Task board — edit | `TaskBoardPage.tsx:766` | Edit task | Ant `Modal` | With #18 possible | Same as #15 | Dense labels | No | DialogShell editor |
| 17 | Task board — acceptance | `TaskBoardPage.tsx:780` | Approval/acceptance | Ant `Modal` | With #18 possible | Footer buttons; risk text | Mixed 10–13px | No | DialogShell confirmation |
| 18 | Task board — detail | `TaskBoardPage.tsx:886` | Full task detail | Ant `Drawer` | From row; can open #15–17 | Page-level drawer; scroll tabs; no focus trap parity | 10–12px tabs | No | InspectorShell; real target for Task Inspector migration |
| 19 | Agent workbench — new session | `pages/AgentWorkbenchPage.tsx:683` | New Agent session | Ant `Modal` | No | Form + selectors | Dense | No | DialogShell |
| 20 | Agent workbench — group chat | `AgentWorkbenchPage.tsx:711` | Plan group chat | Ant `Drawer` | Can open #19 | 620px; page drawer | Dense | No | SheetShell |
| 21 | Project overview — create lifecycle item | `pages/ProjectOverviewPage.tsx:680` | Create milestone/decision | Ant `Modal` | No | 560px | Dense | No | DialogShell |
| 22 | Project overview — advance stage | `ProjectOverviewPage.tsx:739` | Stage transition confirm | Ant `Modal` | No | Confirm only | Short copy | No | DialogShell confirm |
| 23 | Runs — run detail | `pages/RunsPage.tsx:280` | Run inspection | Ant `Modal` | Can open #24 | 920px; logs/pre | Dense code | No | SheetShell viewer |
| 24 | Runs — reconcile | `RunsPage.tsx:388` | Human reconciliation | Ant `Modal` | Inside/over #23 | Double overlay possible | Form | No | DialogShell confirm |
| 25 | Collaboration — send message | `pages/CollaborationPage.tsx:519` | Cross-session message | Ant `Modal` | No | 560px | Dense | No | DialogShell editor |
| 26 | Project center — create/import | `pages/ProjectCenterPage.tsx:389` | Create/import project | Ant `Modal` | No | Wide form | Dense | No | DialogShell editor |
| 27 | Legacy plan workbench detail | `features/orchestration/components/PlanReviewWorkbench.tsx:484` | Old plan task sheet | Ant `Drawer` | Ant modal | Duplicate implementation; appears legacy/unrouted | 10–12px | No | Delete/redirect to #6 or #18 after confirmation |

## Findings

### 1. Duplicate task detail implementations

There is more than one task-detail surface:

- the accepted Design Lab `TaskInspector` (now on the shared InspectorShell);
- the live formal `PlanReviewNext` task sheet using `next-ui/ui/dialog`;
- the task board `TaskBoardPage` Drawer;
- the legacy `PlanReviewWorkbench` Drawer.

The Design Lab inspector is the accepted information architecture, but the **formal live task
surface is still the separate `PlanReviewNext` sheet**. This audit does not create a fifth one.
Migration should make `PlanReviewNext` (and then the task drawer) adopt `InspectorShell` while
keeping each page's real query/mutation callbacks.

### 2. Nested overlay and double mask

Confirmed cases:

- Agent Studio → run-test modal (#1 → #2).
- Plan review Ant modal → Radix task detail (#6).
- Settings modal → drawers/modals (#7 → #8–#14).
- Task board detail drawer plus create/edit/acceptance modals (#18 ↔ #15–#17).
- Runs detail and reconcile (#23/#24).

Ant promotes nested overlays to `body`, so the parent's visual frame and the child's mask coexist.
The result is a second dim layer, focus ambiguity and z-index races. New `OverlayRoot` assigns a
monotonic layer per surface (base `6000`, step `30`); `InspectorShell` is explicitly non-modal and
has no mask, so a Task Inspector + Agent panel cannot stack two masks.

### 3. Clipping / width / viewport

- Settings drawers are 460–560px and live inside a 1180px dialog, but their own scroll and header
  are not shared with settings; on 1100px viewport the right edge is cramped.
- Plan review sheet is rendered inside an Ant modal; it is subject to the parent dialog's
  transform/overflow and can visually detach from the mask.
- Agent Studio is `min(1480px, 94vw)`, larger than the 1440×900 test viewport after window chrome.
- Existing drawers have no common max-height contract; long content relies on Ant body scroll.

New shells constrain with `min(width, 100vw - N)` and a single `OverlayScrollArea`; the inspector
uses `top/right/bottom: 12px`, so it never exceeds the Electron viewport.

### 4. z-index and focus

Current values seen: Ant defaults ~1000, Radix plan detail `3000/3001`, Agent Studio `5000`,
Ant dropdowns 1050+. The new stack starts at `6000` and increments, with confirmation dialogs
rendered above the current surface. Focus is handled by Radix for modal shells and by an explicit
Tab/Shift-Tab trap plus restore for non-modal `InspectorShell`. Escape is intercepted before close
when the draft is dirty.

### 5. Scroll lock / close animation

Ant handles body scroll per modal; nested Ant + Radix can release in the wrong order. The new
modal shells use Radix scroll locking and keep the surface mounted for 220ms while closing, so the
content does not disappear before the exit transition. Non-modal inspectors intentionally do not
lock the workspace; a discard confirmation is the only modal over them.

### 6. Typography and inner layout

The inventory shows three recurring inner layouts:

1. **Detail inspector** — label/value rows and sections (`v16-model-detail`, task drawers).
2. **Editor form** — stacked fields with footer actions.
3. **Confirmation** — short impact/risk copy and one primary action.

They must not be collapsed into one form template. The shared layer owns the header/footer/scroll
and typography; business content keeps its own section IA. Current legacy surfaces still use
10–12px type; they are not claimed as migrated.

## Reuse decision

| Group | Base component | Why |
|---|---|---|
| Task / Agent / Model / Skill / Runtime detail | `InspectorShell` | Non-modal, workspace-linked, long scroll, read-first |
| Create/edit forms, command palette | `DialogShell` | Modal, explicit commit/cancel, focus trap |
| Diff, run/log, large secondary editor | `SheetShell` | Side sheet, wide content, modal mask |
| Model/runtime selectors, menus | `PopoverShell` | Anchored, no mask, dismissal independent |
| Destructive/approval | `DialogShell` | Real modal, danger hierarchy, no accidental dismiss |
| Shared header/footer/scroll/section | `OverlayHeader`, `OverlayFooter`, `OverlayScrollArea`, `InspectorSection` | One typography, material and spacing contract |

## Migration order after visual approval

1. `PlanReviewNext` task sheet → `InspectorShell`; remove its private sheet CSS. This is the real
   Task Inspector counterpart and the first duplicate to retire.
2. Settings detail drawers (Model/Skill/Runtime) → `InspectorShell`; convert their three
   near-identical `.v16-model-detail` bodies into a small shared detail section composition.
3. Settings nested editors (custom Runtime/ACP/model) → `DialogShell`; keep the settings modal as a
   single DialogShell and render editors as nested dialogs with one backdrop.
4. Task board drawer → `InspectorShell`; create/edit/acceptance modals → `DialogShell`.
5. Runs detail → `SheetShell`; reconcile → `DialogShell`.
6. Agent Studio + run test → `SheetShell`/`DialogShell` with an explicit "run test" child layer.
7. Remaining project/collaboration forms → `DialogShell`.
8. Delete or redirect the legacy `PlanReviewWorkbench` after confirming it is unrouted.

No page is migrated until the three samples are visually approved.
