# Global UI unification — token layer, shell and three core pages

- Branch: `feat/ui-unification`
- Base: `fix/agent-overview-ux-recovery` / `43451e2eddbd11fd199d59af57b32b6d61f002df`
- Scope of this phase: **one semantic token layer + AppShell + Project home + Agent graph + Review room**.
- Business-page composition migration is intentionally **not** included yet; it waits for visual review.

## 1. Audit findings

The renderer had five independent palette families:

| Family | Source | Problem |
|---|---|---|
| `--pdl-*` | `styles/shell-design-lab.css` | blue/violet shell, photographic blue field, cool `::before`/`::after` |
| `--nx-*` | `styles/next-ui-app.css` | second blue accent (`#4f64d9`), cold glass |
| `--studio-*` | `features/studio/studio.css` | warm copper palette, disconnected from shell |
| `--pw-*` | `features/collaboration-overview/collaboration-overview.css` | warm Precision palette, disconnected again |
| `--color-*` | `packages/design-tokens/src/tokens.css` + Ant theme | blue primary, cold surface tokens |

Additional hardcoded cold values were found in `v16.css` / `v17.css` / `goal-journey.css`:
blue active navigation (`#2563eb` / `#0a4fbf`), blue journey action gradient (`#6475e9 → #6faced`), and the v16/v17 photographic blue background. These were the direct cause of the blue shell wrapping the warm project page.

## 2. One semantic layer

New file: `packages/design-tokens/src/unified.css`, imported last in `main.tsx`.

Canonical tokens:

| Semantic token | Light | Dark |
|---|---|---|
| `--ui-bg-app` | `#e8e0d2` | `#0b1118` |
| `--ui-bg-workspace` | `#efe7da` | `#111922` |
| `--ui-glass` / `--ui-glass-strong` | warm cream alpha | warm graphite alpha |
| `--ui-surface` / raised | `#fbf6ec` / `#fffbf4` | `#131b24` / `#19232e` |
| `--ui-ink` / `--ui-ink-2` / muted | `#1d232b` / `#494640` / `#5e564a` | `#f0ebe1` / `#c8c2b6` / `#a49e92` |
| `--ui-accent` | `#8e3c1b` copper | `#e08a5b` copper |
| `--ui-ok` / warn / danger | `#30543f` / `#7a4e12` / `#a23a34` | `#87b99a` / `#d7a352` / `#e08078` |
| border / divider | warm ink alpha | warm white alpha |
| radius / shadow / blur / font | one scale | one scale |

`lightPalette` and `darkPalette` in `packages/design-tokens/src/index.ts` use the same values, so Ant Design components, CSS variables and `tokens.css` are one system. Contrast tests pass at 4.5:1.

Legacy families are **aliases only**:

- `--pdl-*` and `--nx-*` now resolve to `--ui-*` (the old blue definitions were replaced in their source files).
- `.studio-theme` and `.aco-deck` map `--studio-*` / `--pw-*` to `--ui-*`; page-local definitions remain only as compatibility names.
- `tokens.css` values were synchronized with the TypeScript palette (`tests/design-tokens.test.ts` passes).

## 3. Shell

- Replaced the v16/v17 photographic blue `::before` / `::after` field with warm radial light over a warm gradient.
- Replaced blue hardcoded sidebar, titlebar, journey and main glass gradients with semantic glass surfaces; the glass is still optical, not flat paint.
- Replaced blue active-nav and journey-action styles with copper.
- Removed the cold outer frame / warm content split: titlebar, sidebar, journey and page now share one temperature.

Measured screenshot pixels (same three pages):

| | sidebar | main | titlebar |
|---|---|---|---|
| Light home/agent | `249,243,231` | `251,246,236` | `242,235,222` |
| Light review | `249,243,231` | `255,251,244` | `242,235,222` |
| Dark home/agent | `19,27,37` | `19,27,36` | `13,20,27` |
| Dark review | `19,27,37` | `25,35,46` | `13,20,27` |

The maximum light delta between sidebar and main is 6/255; dark is 6–7/255. This is the objective check that the cold/warm jump is gone.

## 4. Core pages

- **StudioProjectHome** — editorial mission hero + asymmetric in-flight/needs-human + run strip; consumes the unified tokens; `/work` keeps the previous WorkCenter page.
- **CollaborationOverview** — Command Deck graph now uses warm relationship colors (taupe assignment, sage dependency, green artifact, amber approval, copper handoff), no blue edges; all P0 behavior preserved.
- **StudioReviewRoom** — document-first review room, copper decision rail; no change to approval API.
- AntD buttons/inputs/dropdowns inherit the same palette via `createAntdTheme`.

## 5. Validation

- Real Electron E2E: **30 PASS / 0 FAIL** (same P0/P1 fixture; now also captures the three visual masters).
- `pnpm typecheck`: PASS.
- `pnpm lint`: 0 errors; 29 pre-existing warnings; dependency boundaries OK.
- `pnpm test`: **495 passed / 0 failed / 4 skipped**.
- `pnpm build` / `package:dir` / `test:package`: PASS.

## 5.1 Cross-page shell baseline

The same Electron run captured task board, run audit, approval center and project settings. Their inner compositions remain old (some business widgets still use local blue status dots/cards), so they are baseline evidence for the next batch, not a completed page redesign. The shell, titlebar, journey, sidebar and primary buttons are unified across them.

## 6. Not done / known limits

1. **Business-page composition is not migrated.** Project center, task board, orchestration, runs, versions/releases/deployments, resources, knowledge, operations, settings and overlays are token-aligned but still use their old layouts. This is deliberate: first review the shell and three masters, then batch-migrate.
2. **Dense graph metadata** still uses some 9–11px labels (run IDs, technical tags). Primary body/actions are 12px+; the floor is enforced in the design-token test only for the shared stylesheet list, not every graph micro-label.
3. **Glass performance not benchmarked this round.** No new backdrop-filter layer was added; the blue photographic layer was removed, but FPS/memory measurements are still pending.
4. **Modal/Drawer/Dropdown sweep** uses tokens, but not every overlay has a new screenshot.
5. **No axe full audit.**
6. E2E still uses a local fake provider and persisted fixtures; it does not prove real model delivery.

## 7. Review gate

Please review `docs/ui-recovery/screenshots/three-pages-light.png`, `three-pages-dark.png` and `shell-before-after.png`. After visual approval, the same token layer should be applied batch-by-batch to the business pages; this branch does not claim a finished global redesign.
