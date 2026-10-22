# Reference Prototype Adaptation — Premium Liquid Glass

## Branch

- Base: `feature/v1.6-premium-liquid-glass` `58dad84`
- Continue on the same independent branch.
- Not merged.

## Reference source verified

Source: `C:\Users\Administrator\Desktop\workplace\projectos-premium-ui-sample`

Commands actually run:

```text
npm install --no-audit --no-fund   # up to date
npm run build                     # tsc -b + vite build, PASS
npm run preview -- --port 5199    # served HTTP 200
```

The running prototype was captured with a real Electron `BrowserWindow` at
1440×900, not a README-only inspection:

- `reference-prototype-light.png`
- `reference-prototype-dark.png`

## What was actually migrated

| Reference | ProjectOS adaptation |
|---|---|
| `StageJourney.tsx` SVG path + optical stop orbs | `StageJourney.tsx`; dynamic stages, role icons, risk dot, SVG path length Motion, spring hover |
| `TaskGraph.tsx` ELK + React Flow | `TaskGraph.tsx`; real `PlannedTask[]` and `dependsOn`, ELK layered layout, task selection, path emphasis |
| `styles.css` ambient halos / glass surfaces / route / ledger | `next-ui.css` scoped materials and route/stop/ledger styles |
| `App.tsx` workspace composition + floating inspector | Plan review workspace + Radix floating task sheet; real callbacks |
| `TaskInspector` visual language | Structured inspector: role buttons, Agent menu, dependency chips, acceptance rows, artifact chips, capability toggles, approval switch |
| Motion route path / inspector / hover | Motion path draw, workspace rise, sheet slide, risk expand; reduced-motion |

Not copied:

- `src/data.ts` sample tasks;
- sample navigation rail and demo-only toast;
- static approval buttons;
- fake status counts;
- prototype `main.tsx` or global application entry.

## Real business adapter

The visual components receive:

- `PlanDraft.tasks` as `PlannedTask[]`;
- `draft.tasks[].dependsOn` as the ELK edge source;
- real role labels and `agentOptions`;
- real risk/assignment-blocked data;
- existing `onUpdateTask`, `onAddTask`, `onRemoveTask`, `onUpdateGoal`, `onOpenCustomAgent`;
- existing approval/rejection actions in the Ant modal footer.

No Runtime, Scheduler, Planner, persistence, IPC or approval API was changed.

## Screenshots (real Electron app)

- `adapted-light.png`
- `adapted-dark.png`
- `adapted-dag.png`
- `adapted-detail.png`
- `adapted-long-zh.png`

## Verification

- `pnpm lint` — PASS
- `pnpm typecheck` — PASS
- `pnpm test` — 265 passed / 3 skipped
- `pnpm build` — PASS
- `pnpm package:dir` — PASS
- `pnpm test:package` — PASS
- `plan-review-ui-e2e` — 10 checks PASS
- `r2b1-planner-ui-e2e` — 10 checks PASS
- `custom-agent-from-plan-ui-e2e` — 3 checks PASS

### 125% check

The E2E sets Electron zoom to 1.25 and reads the real layout:

```json
{"innerWidth":1152,"clientWidth":1152,"scrollWidth":1152,"dpr":1.25,"visual":1152,"modal":1104,"modalRight":1128}
```

`scrollWidth === clientWidth` and `modalRight < clientWidth`, so the layout has no
horizontal overflow at 125%. Electron's `capturePage()` still returns a 1152px
image that crops the right side when the content was rendered at the pre-zoom
width; the 1100px narrow screenshot remains the reliable visual capture. This
is a capture limitation, not a layout overflow according to the measured DOM.

### Long Chinese

`adapted-long-zh.png` uses a 43-character Chinese task title; it wraps to two
lines in the inspector header and truncates in the compact ledger without
breaking the layout.

## Not yet achieved / limits

1. The reference prototype's left navigation rail, top brand bar, full-page hero
   and status card are not copied into the plan-review modal. The sample remains
   constrained by the existing Ant modal shell.
2. Ant Modal and footer still wrap the adapted content; Ant removal is not done.
3. Other pages are not migrated.
4. The reference TaskGraph screenshot is not included; the adapted DAG is the
   real ProjectOS ELK graph.
5. 9 / 30 / 80 node stress states were not generated; plan validation caps at 20.
6. No screen recording; interactions are reproduced by E2E.
7. The 125% screenshot crop remains a capture artifact; measured DOM has no overflow.
8. Visual acceptance remains with the user; test pass is not visual acceptance.
