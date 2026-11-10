# ADR-0094 — UX refactor consolidation fixes: contextual review jumps, dark-safe surfaces, and E2E parity

Date: 2026-11-10. Base: `feature/ux-polish-5` (`0c223c0`, ADR-0089..0093).

## Context

Code and visual audit of the ADR-0089..0093 refactor (`feature/approval-simplify-v2` through
`feature/ux-polish-5`) identified remaining issues directly affecting the refactor's goals ("fewer
manual steps and back-and-forth jumps, no half-finished screens, no nested rectangular cards"):

1. **Context-dropping jumps into and out of the Review Room.** Approval rows on 工作台, banners and
   run actions in 运行审计, and the 待授权 block in 项目态势 opened `/approvals` without `?approval=<id>`
   or an origin parameter, and the Review Room back link only knew 需求工作台, Agent 协作, or 工作台.
2. **Incomplete states and stale reads.** The 记录 lens rendered the empty state on read failure
   instead of an error with retry; `['release-approvals', projectId]` was never invalidated by
   runtime events; `NextStepPanel` lacked `plan_review` / `replan_scope` / `plan_delivery` labels
   and fell through to "处理对账"; deep-linked `?approval=` could be overwritten before initial fetch
   settled; `RunsPage ?run=` showed empty when a run fell outside the first 100 list items; runtime
   `journey.ts` still emitted retired `/work` routes and `action-center.ts` emitted `&scope=delivery`
   instead of `&lens=delivery`.
3. **Keyboard & accessibility regressions.** Page-level `keydown` listeners intercepted `ArrowUp` /
   `ArrowDown` globally (breaking keyboard scrolling inside `.rv-diff` and tablists); batch dock
   confirmation dropped focus to `<body>`; `KpiRail` used `<div role="link">` with an `aria-label`
   that hid the value and status text from assistive tech; polling stage bead tracks carried
   `aria-live="polite"`.
4. **Residual card-in-card, raw colours/radii, and dark-mode gaps.** `.rv-evidence` inside `.rv-sheet`,
   `.rq-criteria-matrix`, `.rq-gov-pill`, and `.lc-disclosure` remained boxed panels; `review.css`
   retained `#fff`, raw `rgba(0,0,0,…)`, raw shadows, and duplicate `.rv-kind-action` rules;
   `requirement-flow.css` kept light-only fills and `#047857` / `#2563eb` / `#b45309` status inks,
   while `:root[data-theme='dark'] :is(.rq-dl-stage-code…)` overrode `.ok` / `.warn` specificity;
   `type-scale.css` applied `:root` rules outside `.po-shell`.
5. **Retired-selector breakage across E2E and screenshot scripts.** 18 scripts under `scripts/`
   still waited on `.po-work-center`, `.wc-goal-*`, `.po-run-detail-panel`, or heading `审批工作台`.

Per explicit user sequencing, backend policy hardening (`verifyCommandFamily` flag restrictions,
run-scoped allowance scoping, `approval.preview` secret redaction) and `lineDiff` truncation
changes are deferred to a dedicated post-refactor security/correctness pass.

## Decision

1. **Contextual Review Room navigation.** Entry points pass `?approval=<id>` when a target approval
   is known and `return=runs&run=<id>` or `return=overview` when entering from 运行审计 or 项目态势;
   `StudioReviewRoom` returns to and labels the exact origin. Deep-linked `focusId` is preserved
   while the initial approvals query is loading/fetching.
2. **Shared action-kind table and live delivery invalidation.** `lib/action-kinds.ts` is the single
   source of kind labels and CTAs for `ActionCenterPanel` and `NextStepPanel`. `AppLayout`
   invalidates `['release-approvals', eventProjectId]` and `['release-overview']` on project events
   and uses `event.projectId` in approval toast actions. All three Review Room lenses surface an
   explicit `role="alert"` error state with `重试`.
3. **Scoped list keyboard navigation and focus restoration.** `lib/list-keys.ts` keeps `j` / `k`
   page-wide (outside inputs/dialogs/menus/diff) while scoping `ArrowUp` / `ArrowDown` to the queue
   or free body focus. Entering batch confirmation focuses the audit note input; cancelling or
   submitting restores focus to the queue item. Interactive `KpiRail` blocks render as native
   `<button type="button">` elements.
4. **Runtime route parity.** `journey.ts` emits `/projects/:id?intent=requirement` when no
   requirement exists and `/projects/:id/requirements` when requirements exist; `action-center.ts`
   emits `&lens=delivery`. `isRequirementIntentRoute` continues recognising legacy `/work` URLs.
5. **Token hygiene, unboxed sections, and dark-safe requirement ledger.** Added `--ui-on-brand`,
   `--ui-shadow-brand(-hover)`, `--ui-knob`, and `--ui-shadow-knob` to `packages/design-tokens/src/unified.css`.
   Flattened `.rv-evidence`, `.rq-criteria-matrix`, `.rq-gov-pill`, and `.lc-disclosure` into
   hairline-divided sections; removed dead `.lc-relationship` / `.lc-scope-*` CSS; converted
   `.rq-dl-*` ledger/stage status rules to dark-safe `--ui-*` tokens and fixed dark stage-code
   specificity; scoped `type-scale.css` shared page rules to `.po-shell` so `#/design-lab` is
   unaffected.
6. **E2E & screenshot script alignment.** Updated `scripts/*.mjs` from `.po-work-center` /
   `.po-run-detail-panel` / `审批工作台` to `.studio-workbench` / `.ra-page` / `.rv-room` (`审阅与决策`).

## Consequences

- Navigating from 工作台, 项目态势, or 运行审计 into 审阅与决策 lands on the target request and returns to
  the originating view in one click.
- Protected Design Lab (`#/design-lab`) remains untouched and verified via `scripts/premium-lab-e2e.mjs`.
- Deferred items tracked for post-refactor pass: H1 (`verifyCommandFamily` / auto-allow defaults),
  H2 (`lineDiff` truncation & raw JSON slice indicator), and M1–M6 backend approval edge cases.
