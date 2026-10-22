# ProjectOS Next UI — Stage 1–3 Delivery

## Branch / worktree

- Base branch: `feature/v1.6-commercial-ui-redesign` at `4aa03e1`
- Next UI branch: `feature/v1.6-next-ui`
- Worktree: `C:\Users\Administrator\Desktop\workplace\ProjectOS-commercial-ui`
- Not merged into `feature/v1.6-ux` or the base redesign branch.

The worktree was created from a clean baseline. The original checkout was audited and its only uncommitted items were temporary prompt packages, which were not copied or committed.

## Stage status

| Stage | Status |
|---|---|
| Stage 0 — baseline/audit | Complete |
| Stage 1 — new UI foundation | Complete for the plan-review slice |
| Stage 2 — two runnable directions | Partial: old Ant workspace (baseline) and Next workspace are both runnable; no separate third prototype |
| Stage 3 — plan review rewrite | Complete for this slice |
| Stage 4 — graph migration | Not started beyond the Next task-node graph |
| Stage 5 — other pages | Not started |
| Stage 6 — remove Ant | Not started |

## Installed dependencies

| Package | License | Use |
|---|---|---|
| `tailwindcss` 4 + `@tailwindcss/vite` | MIT | utility styling and theme variables |
| `@radix-ui/react-dialog` | MIT | task detail sheet |
| `@radix-ui/react-tabs` | MIT | stage/DAG switch |
| `@radix-ui/react-tooltip` | MIT | stage hover summaries |
| `@radix-ui/react-scroll-area` | MIT | task/risk scrolling |
| `@radix-ui/react-slot` | MIT | shadcn-style button composition |
| `class-variance-authority`, `clsx`, `tailwind-merge` | MIT | local shadcn-style primitives |
| `lucide-react` | ISC | icon system |
| `motion` | MIT | risk expand/collapse and sheet transitions |
| `react-resizable-panels` | MIT | resizable review main/aside workspace |

No second graph engine was added. `@xyflow/react` remains the graph engine (MIT). `elkjs` was evaluated but removed because the current topological layout is sufficient and an unused dependency would add risk. Ant Design remains only on the pages not yet migrated; it is not used by the Next plan-review component.

## Tailwind / Ant coexistence

Tailwind v4 preflight is **not imported**. The new Net UI uses:

```css
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
```

and a scoped `.pui-root` base reset. This prevents Tailwind from resetting Ant pages that remain online during the staged migration. The Next shell is being rendered inside the existing Ant modal for Stage 3; the content, tabs, tooltip, task sheet and resizable layout are new Next components.

## New source layout

- `apps/desktop/src/renderer/src/next-ui/ui/button.tsx` — shadcn-style button
- `.../badge.tsx`
- `.../tabs.tsx`
- `.../tooltip.tsx`
- `.../dialog.tsx`
- `.../scroll-area.tsx`
- `.../cn.ts`
- `apps/desktop/src/renderer/src/styles/next-ui.css` — tokens, scoped reset, glass, typography, motion fallback
- `apps/desktop/src/renderer/src/features/orchestration/components/PlanReviewNext.tsx` — Next plan review workspace
- `apps/desktop/electron.vite.config.ts` — Tailwind Vite plugin
- `apps/desktop/src/renderer/src/main.tsx` — Next UI stylesheet

## Plan review changes

- Goal appears once, editable inline; no duplicate textarea.
- Summary: stage path · task count · review count.
- Resizable main/aside workspace; no card-stack modal.
- Radix Tabs switch between stage route and DAG.
- Stage cards use role icons, task counts, risk markers and hover summaries.
- Task rows are compact; task detail opens a Radix Dialog sheet.
- Task detail preserves all editable fields: title, description, role, Agent/custom Agent, dependencies, acceptance, artifacts, capabilities, approval and delete.
- Risk rail shows blocking vs advisory; non-blocking risks do not disable approval.
- Fixed footer approval/rejection remains the existing business action.
- Generation details are collapsed.
- Next DAG node uses custom TaskNode with Agent, title, risk and dependency count; edges use real `dependsOn`, arrows, path highlighting.
- Motion: risk expand, sheet transition; reduced-motion is respected.

## Screenshots

- Baseline: `baseline-plan-review.png`, `baseline-agent-canvas.png`
- Next light: `next-plan-review-light.png`
- Next dark: `next-plan-review-dark.png`
- Next DAG: `next-plan-review-dag.png`
- Next task sheet: `next-plan-review-detail.png`
- Next narrow window: `next-plan-review-narrow.png`

## Verification actually run

- `pnpm lint` — PASS
- `pnpm typecheck` — PASS
- `pnpm test` — 265 passed / 3 skipped (before the final Next UI selector tweaks; run again before merge)
- `pnpm build` — PASS
- `scripts/plan-review-ui-e2e.mjs` — 10 checks PASS (light/dark/narrow/DAG/sheet/approval)
- `scripts/r2b1-planner-ui-e2e.mjs` — 10 checks PASS
- `scripts/custom-agent-from-plan-ui-e2e.mjs` — 3 checks PASS

## Known gaps / defects

1. Only the plan-review page is migrated to Next UI. Task board, settings, run audit, agents, and remaining pages still use the existing Ant/V1.6 front end.
2. The Ant modal shell and footer still wrap the Next plan-review content; Stage 6 removal of Ant is not done.
3. 125% display scaling screenshot is clipped at the Electron capture boundary; the 1100px narrow screenshot is the reliable responsive evidence.
4. 9 / 30 / 80 node stress states were not produced. Plan validation currently caps plans at 20 tasks; no fake production data was inserted.
5. A second independent visual prototype (beyond old Ant workspace vs Next workspace) is not implemented.
6. Graph migration for V1.3 orchestration and other visual pages is not done; only the plan-review DAG uses the Next component.
7. No page-level route transition system yet; Motion is used in local panels/sheets.
