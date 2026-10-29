# Edge visibility — P0-A proof

## Root cause

The relationship layer was a full-size SVG **sibling** of React Flow:

```css
.aco-canvas .react-flow { z-index: 2; }
.aco-edge-layer { z-index: 1; }
```

The SVG was therefore below the entire interactive canvas. A DOM query could find 11 paths while the user saw no usable lines. The prior E2E only counted `.aco-edge`, which is not visual evidence.

## Fix

- Edge layer is now above the React Flow canvas (`z-index: 3`) and remains `pointer-events: none`; only real Handoff paths opt into stroke events.
- An SVG `<mask>` covers every laid-out node rectangle in graph coordinates, so edges visually terminate at card borders instead of being painted across node text.
- The overlay keeps one transform only: `translate(viewport.x, viewport.y) scale(viewport.zoom)`. It is not inside a second React-Flow viewport transform.
- Marker IDs are namespaced with `useId()`; multiple graph instances cannot overwrite each other's arrowheads.
- Real relationships only: assignment (`assigneeAgentId` / active task), task dependency, artifact task binding, pending approval task binding, and persisted Handoff rows.

Native React Flow edges were attempted. In this Electron runtime the custom nodes keep `measured: {}` and no handle bounds even though 24 handles are in the DOM; the native edge layer stays empty. The SVG overlay is therefore the retained engineering fallback, not a decorative substitute.

## Evidence (real Electron, 1440×900, light)

E2E check with the edge layer visible and then hidden, on the same real screenshot clip:

```json
{"visiblePixels":3903,"total":639014}
```

- `visiblePixels` counts pixels whose RGB delta is > 40 between the two screenshots.
- 3,903 pixels is visible line surface; a path count cannot produce this.
- Endpoint check maps each SVG path start/end through `getScreenCTM()` and compares to the real node border rects:

```json
{"edges":11,"aligned":11,"sample":[{"startDistance":0,"endDistance":0}, ...]}
```

- Zoomed state after a real mouse wheel event: `{"edges":11,"aligned":11,"zoom":1.4}`.
- Relationship mix: 4 assignment, 3 task dependency, 2 artifact, 1 approval, 1 handoff.

## Screenshots

- `docs/agent-overview/evidence/screenshots/overview-1440-light.png`
- `docs/agent-overview/evidence/screenshots/overview-1440-dark.png`
- `docs/agent-overview/evidence/screenshots/overview-1440-zoom.png`
- `docs/agent-overview/evidence/screenshots/overview-1024-all.png`
- `docs/agent-overview/evidence/screenshots/overview-1440-light-125.png`
- `docs/agent-overview/evidence/screenshots/overview-1440-standby.png`

## What is still not proven

- Native React Flow edge rendering, because the measurement defect is unresolved.
- A real Handoff **acceptance** (the fixture only reaches `requested`).
- Pixel visibility on a physical HiDPI display; screenshots were taken in Electron at device scale 1 / 125%.
