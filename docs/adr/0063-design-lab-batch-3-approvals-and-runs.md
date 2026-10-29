# ADR-0063 — Design Lab material, batch 3: 审批工作台 + 运行审计

- Status: Accepted (Phase 2.9-P0, batch 3 of the migration)
- Related: ADR-0054 (shell), ADR-0061 (batch 2), ADR-0055 (decided approvals read-only)

## Context

Batch 1 moved the shell and batch 2 the two most-used pages. 审批工作台 (`ap-*`) and 运行审计 were the next
two pages a first-time user meets, and they still rendered as flat bordered panels that did not match the
Design Lab material.

## Decision

Append the Design Lab optical recipe to `pages-design-lab.css` for:

- approvals: the workbench shell, queue column, filter pills, rows (hover/selected), kind badges, detail
  panel, facts block, code block and the decision rail;
- runs: the audit table surface, header/row separators, row hover and the run detail panel.

Only materials change. The read-only decision block from ADR-0055, the queue behaviour and every API call
remain as they were.

## Verification

- `scripts/p29-visual-sweep.mjs` over 9 pages: **light 18/18**, **dark 19/19** (the dark run also asserts
  `--pdl-ink=#eff4ff`), no horizontal overflow, no content text below 12px, journey bar present.
- Screenshots (real Electron): `docs/screenshots/p29-sweep-approvals-1440.png` / `-1024.png` / `-1440-dark.png`
  / `-1024-dark.png`, `p29-sweep-runs-*.png` in the same four variants.
- Not yet migrated: 版本与迭代、发布/部署、资源与连接、设置弹层 (batch 4+).
