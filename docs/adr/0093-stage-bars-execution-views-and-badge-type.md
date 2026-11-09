# ADR-0093 — Stage bars, 执行 views, review pending view and the badge type size

Date: 2026-11-10. Base: `feature/ux-polish-4` (PR #6, ADR-0092).

## Context

After ADR-0092 the type scale was consistent, but several screens still had more than one focal
point: the top requirement bar stacked a select, a stage track, chips and buttons over two rows;
the requirement page repeated four always-green governance pills; 任务看板 and Agent 协作 repeated
the whole stage track as boxed cards; 计划编排 had boxed metrics, duplicate buttons and English
kickers; the review pending view drew the batch action as a dashed box. Dark mode on the
requirement page still had white-filled slabs with light text. Count badges and step markers had
been forced to the 12px caption size and looked cramped.

## Decision

1. **Stage bars read the same everywhere.** The global top bar (目标 and 需求 variants) is one row:
   eyebrow, subject, a bead track with only the focus stage labelled, one primary action, and an
   overflow menu. Inside a requirement the full track is a quiet bead row with connectors; other
   states live in tooltips. The approvals chip is hidden when the next action is already 处理审批.
2. **Requirement page.** Static governance facts move into one muted caption line (tooltip has the
   details); acceptance coverage is the only live signal and toggles the matrix. Without a bound
   flow, task actions are hidden instead of disabled and the empty state explains the order.
3. **执行 views.** 任务看板 shows the requirement as one line with bead progress and folds stage
   cards into a disclosure. Agent 协作 shows the relay as a single row. 计划编排 gets an h1 with
   inline metrics (one at title size, the rest at section size, no boxes), text buttons, and no
   duplicate buttons or English kickers.
4. **Review pending view.** The batch action is a quiet row under the single primary 允许这一项;
   reject is a text action; worktree policy families are plain text toggles.
5. **Badge size.** `--ui-type-badge: 11px` is an explicit exception to the four working sizes, only
   for digits or glyphs inside fixed-size markers and count badges. Running text never uses it.
6. **Dark mode.** Requirement-page surfaces (switcher, view toggle, task ledger, deliverable cells,
   stage tiles on the board) use `--gl-*` / `--ui-*` tokens instead of white fills.
7. **Opt-in seed.** `PROJECTOS_SEED_DEMO_FLOW=1` binds one untouched requirement to the standard
   flow (manual assignment, not started) so stage bars can be shown. The default demo is unchanged.

## Consequences

- One focal point per screen is easier to keep: secondary facts are tooltips or captions.
- 运行审计 and the Agent graph canvas are unchanged in this round.
- Screenshots: `docs/ux/v6/`; evidence: `docs/v2/evidence/ux-polish-5/`.
