# ProjectOS Next UI — Frozen Design Contract

Status: VISUAL_DIRECTION_APPROVED_WITH_FIVE_FIXES

## Source of truth
- The existing working Design Lab on `feature/v1.6-liquid-glass-design-lab` is the **approved visual baseline**. Preserve its broad palette, ambient spatial language, optical layering, navigation character and stage-map/ledger relationship. The screenshots `211.png` and `212.png` from the accepted review should be copied into the repository under `docs/design/baselines/` by the development agent.
- `DESIGN_LAB.md` documents the current baseline and limitations. Consult it before editing.
- Do not reinterpret the design from a free-form prompt. Use actual reusable React components and versioned design tokens extracted from the accepted implementation.
- The design is approved as a **direction**, NOT as a defect-free final system. The five fixes below are mandatory before broad migration.

## Required five fixes
1. **Durability:** root AGENTS.md references this file, existing product rules and baseline images. Each new agent session reads them. Record changes in a design changelog and make UI screenshots part of PR review. Verify whether the executing harness actually loads AGENTS.md and configured skills.
2. **Stage journey:** stage nodes display only designed icons (accessible aria-label and tooltip on hover/focus). No always-visible stage text, descriptions or repeated counts around icons. Use one shared layout measurement (same DOM coordinate system for icons and SVG curve). Recompute on resize/zoom/theme/layout and test exact anchor alignment. Stage details appear in a separate selected-state summary/task section, not around the route.
3. **Typography:** existing lab documentation records 11.5–12px body and 10–10.5px labels, which are too small for the intended desktop reading experience. Start with 14px body, 12–13px secondary labels, 16px section headings, 22–26px page titles. Adjust with actual screenshots, do not indiscriminately scale everything. Verify computed foreground vs FINAL composited surface, not just token vs solid swatch; WCAG AA >=4.5:1 body and >=3:1 large text. Never apply opacity/filter/blur to text-bearing surfaces. Use stable Chinese font fallbacks and test 100%/125% zoom.
4. **DAG edges:** remove default dashed connections. Build a custom React Flow edge with clear solid neutral stroke, polished rounded routing and restrained highlighted edge treatment on selection/focus only; selected-path illumination must not animate continuously across the whole graph. Retain real dependsOn topology, ELK layout, visible branch/split joins, sensible ports/arrows, and reduced-motion fallback. Use React Flow custom edge API, e.g. BaseEdge + getSmoothStepPath/getBezierPath.
5. **Task inspector:** replace raw form-stacking with a designed inspector information architecture. Header: identity, compact status, primary action; body: editable concise overview, role/agent, dependencies as interactive chips, acceptance as individual checkable/editable rows, artifacts, capabilities, danger zone only when needed. Define visual rhythm and safe empty/error states. Preserve all original editable fields, validation and business semantics.

## Enforced UI copy rules
- Default show only title, key facts, state and direct actions. Explanatory copy lives in tooltip/help or user-triggered details. Remove repeated stage commentary, redundant subtitles and long field explanations. Preserve destructive-operation warnings, auth details, meaningful failure recovery, legal/security and accessibility text.
- Do not add visual-fill copy without task-based justification.

## Technical and performance constraints
- This Design Lab currently uses fake/prototype data and does not call production approval APIs. Keep that clear until formally integrated.
- Prior tests in `DESIGN_LAB.md` found the React Bits Aurora shader ~8 fps and liquid-glass-react compatibility probe ~7 fps on the measured setup; retain static optical fallback as default unless a new measured, verified solution is stable. Never replace accurate labels with visual effects.
- No changes to Planner, Scheduler, Runtime, Teamwork, IPC contracts or persistence just to enhance appearance.
- Use existing independent redesign worktree / branch, avoid destructive Git actions and do not auto-merge.

## Visual acceptance gates
A. Stage icons visually centered ON their curve endpoints (including 1100px and 125% zoom); selected state is consistent with list.
B. 4-stage/7-task sample has no redundant descriptions around route icons.
C. Body text legible at 100/125% with computed contrast captured and no clipped text.
D. DAG default edges are solid, aligned, unobtrusive; focus paths have a tasteful, accessible active treatment; no ghost branches.
E. Inspector layout looks and operates unlike an unstyled property form; no field or edit capability is lost.
F. Screenshots: plan-stage, DAG-default, DAG-focus, inspector, light, dark, 1100px, 125%; plus UI interaction recording and regression E2E.
G. PR includes changed-file list, screenshots, design-token diffs, automated-test outcomes, measured animation performance and unresolved limitations. User visually approves before rolling out to the entire frontend.

## Suggested migration order after approval
1. Shared tokens/components; 2. plan review; 3. task inspector and task board; 4. Agent workflow canvas; 5. audit/run views; 6. project center; 7. AI connections/model catalog; 8. settings and remaining routes. Verify functionality and fidelity page by page.
