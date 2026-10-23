# ProjectOS V1.6 Electron Performance Audit

Date: 2026-10-23  
Branch: `perf/electron-v1.6-audit`  
Base: `feature_dev_ux` @ `49f9413`  
Target: packaged Windows Electron app (`release/win-perf-final/win-unpacked`)  
No stable merge and no UI redesign.

## 1. Context and evidence sources

OpenViking health check:

```json
{"ok": true, "storage": "VikingFS", "message": "OpenViking is healthy"}
```

OpenViking search for ProjectOS architecture/performance history returned only
memory-service/plugin records; it contained **no ProjectOS performance
investigation**. No historical performance claim is treated as fact.

Repository facts verified directly:

- Electron `43.8.2`, React `19.3.1`, Ant Design `6.6.6`, TanStack Query `5.104.4`,
  React Flow `12.12`, ELK `0.12`, Motion `14.6`.
- Approved visual baseline remains `0686c41` / `visual-baseline-approved-0686c41`.
- `APPROVED_BASELINE_INVESTIGATION.md` confirms the approved surface is
  Design Lab DAG at `#/design-lab`, not the old `PLAN REVIEW · R1` modal.
- Benchmark targets the packaged app, not Vite preview.
- Working trees and branches were left intact; no reset, clean, force-push or
  merge was used.

## 2. Environment limitation: software compositing

The benchmark host exposes a virtual display adapter:

```text
Ctyun CVGDOD Controller
AdapterRAM: 0
```

Measured Electron GPU status:

```json
{
  "gpu_compositing": "disabled_software",
  "rasterization": "disabled_software",
  "2d_canvas": "unavailable_software",
  "webgl": "unavailable_software",
  "opengl": "disabled_off"
}
```

Therefore all numbers are a **software-rendering worst case**. This also means
large `backdrop-filter` surfaces are disproportionately expensive. Hardware
acceleration was not disabled by the app; the host has no usable GPU.

## 3. Benchmark method

Script: `scripts/perf-benchmark.mjs`

Each scenario launches the packaged EXE with:

```text
--disable-background-timer-throttling
--disable-renderer-backgrounding
--disable-backgrounding-occluded-windows
```

plus `page.bringToFront()`. rAF cadence, long tasks, React root commits,
CDP Performance metrics, main-process app metrics and main-process IPC handler
timings are sampled around the same action window.

Baseline package: `release/win-phase5-pages` (source before this audit).  
Optimized package: `release/win-perf-final` (this branch).

Raw data:

```text
docs/performance/baseline-v3.json
docs/performance/optimized-final2.json
docs/performance/optimized-ipc4.json
docs/performance/optimized-ipc5.json
```

## 4. Baseline vs optimized (packaged, focused window)

| Scenario | Baseline FPS | Optimized FPS | Baseline long tasks | Optimized long tasks |
|---|---:|---:|---:|---:|
| Project Center idle | 62.7 | 63.4 | 0 ms | 0 ms |
| Center → Project Overview | 45.4 | 46.6 | 315 ms | 299 ms |
| Task Board scroll + detail | 46.3 | **53.0** | 106 ms | 51 ms |
| Sidebar collapse/expand | 40.2 | **45.5** | 91 ms | 0 ms |
| DAG zoom + node select | 35.1 | **49.5** | 0 ms | 0 ms |
| Plan Review open + interaction | 25.5 | **40.8** | 325 ms | 267 ms |
| Project Settings + Settings modal | 37.8 | 38.6 | 89 ms | 66 ms |
| Run Audit idle/update | 56.7 | 44.8 | 146 ms | 90 ms |
| Resize 1440 → 1100 → 1440 | 44.9 | 31.5 | 0 ms | 0 ms |
| 5 s idle | 64.0 | 64.1 | 0 ms | 0 ms |

Cold start to first interactive project center:

```text
baseline:   2.31 s
optimized:  2.06–2.59 s across runs
```

Key gains:

- DAG **+41% FPS** (35.1 → 49.5).
- Plan Review **+60% FPS** (25.5 → 40.8).
- Task Board **+14.5% FPS**, long tasks 106 → 51 ms.
- Sidebar **+13% FPS**, long tasks 91 → 0 ms.

Run Audit and Resize show regressions in this run and are **not claimed as
improved**; they need a repeat run before acceptance.

## 5. Root causes and evidence

### 5.1 Excessive large-area backdrop blur (critical)

A DAG page has 9 active blur layers. The two largest are:

| Surface | Size | Blur |
|---|---:|---|
| sidebar | 232 × 814 | 24 px saturate(1.2) |
| page header | 1131 × 108 | 24 px saturate(1.12) |

Controlled CSS experiment on the same DAG interaction:

```text
baseline                         40.3 FPS
shell blur off                   47.9 FPS
page-header blur off             47.6 FPS
shell + header blur off          60.9 FPS
all backdrop-filters off         64.0 FPS
```

Plan Review idle experiment:

```text
.pdl-workspace 10px              52.8 FPS
.pdl-workspace none              64.3 FPS
```

The repository currently contains 119 `backdrop-filter` declarations. The
approved visual can be retained with smaller kernels on large static surfaces;
the gradient, border, highlight and glass layers remain.

### 5.2 Closed Agent Studio still fetched runtime profiles (high)

`AgentStudioModal` was mounted unconditionally inside `OrchestrationWorkspace`.
Its `useRuntimeProfiles()` ran even when the modal was closed, calling
`runtime.list` (2.1–2.2 s on this host) on orchestration mount.

IPC probe showed:

```text
DAG scenario before:  runtime.list 1 call / 2.18 s
```

After conditionally mounting the modal only when open and adding a 5-minute
stale time to runtime profiles:

```text
DAG scenario after:   runtime.list absent
Settings switch:      only aiConnections.list (2 ms)
```

### 5.3 Plan Review event invalidation storm (high)

With the full-screen Plan Review open, the still-mounted Orchestration page
subscribed to every runtime event and invalidated graph/snapshot queries.

Before guard (IPC probe, plan scenario):

```text
project.snapshot.get   12 calls
graph.snapshot.get     13 calls
total                   114 calls
```

After guarding invalidations while `planOpen` and lazy runtime discovery:

```text
project.snapshot.get    1 call
graph.snapshot.get      1 call
total                   68 calls (includes page mount)
```

The first `project.overview` (1.7 s) and `workspace.snapshot` (1.7 s) remain
backend/query costs; they are no longer multiplied by event storms.

### 5.4 DAG zoom state churn (medium)

`onMove` previously called `setCompactGraph(...)` on every viewport event. The
canvas only needs a CSS class. It now toggles the class on the canvas ref; no
React state update is scheduled for zoom.

Measured commit counts are noisy (143 → 168 on a fixed 3 s scenario) and do
not show a commit reduction, so this is recorded as a low-risk structural
cleanup, not a claimed commit win.

### 5.5 Data/IPC costs (remaining)

Main-process IPC probe results after optimization:

```text
Plan Review:
  project.overview       1 call / 1.74 s
  workspace.snapshot     1 call / 1.73 s
  app.bootstrap          1 call / 0.67 s
  approval/event/plan    0.42–0.50 s each

DAG:
  workspace.snapshot     1 call / 0.38 s
  project.scan           1 call / 0.36 s
  graph.snapshot.get     2 calls / 11 ms total
```

These are real backend/query costs, not renderer paint. They need separate
index/query work and were not changed in this audit to protect contracts.

## 6. Implemented optimizations

| Change | Files | Scope |
|---|---|---|
| Reduced sidebar blur 24→12 px; status/buttons 6 px | `styles/next-ui-app.css` | shell |
| Removed backdrop blur from all large page headers | `styles/next-ui-app.css` | 14 pages |
| Removed `.pdl-workspace` full-screen blur; topbar none; rail/review 10 px; viewbar/orbs 8 px | `styles/next-ui-app.css` | Plan Review |
| Lazy-mount Agent Studio only when open | `OrchestrationWorkspace.tsx` | orchestration |
| Runtime profiles stale time 5 min | `lib/queries.ts` | settings/resources/agent studio |
| Skip runtime-event invalidations while Plan Review is open | `OrchestrationWorkspace.tsx` | plan review |
| Canvas zoom class toggled directly, no state | `OrchestrationWorkspace.tsx` | DAG |

No visual tokens, layout, business calls, IPC contracts or database schema were
changed. The approved glass gradients, borders and highlights remain.

## 7. Visual regression

| Before | After |
|---|---|
| [DAG before](visual/dag-before.png) | [DAG after](visual/dag-after.png) |
| [Plan before](visual/plan-before.png) | [Plan after](visual/plan-after.png) |

The before/after captures preserve layout, typography, colors, node positions,
tabs, buttons and data. Only the blur kernel/backdrop layers changed; no
content or interaction was removed.

## 8. Engineering and functional regression

```text
pnpm lint       PASS (0 errors, 2 pre-existing warnings)
pnpm typecheck  PASS
pnpm test       PASS — 48 files, 266 passed, 3 skipped
pnpm build      PASS
phase5-pages-e2e.mjs       PASS — 48 checks
plan-review-workspace-e2e  PASS — 10 checks
package smoke              PASS
```

## 9. Idle memory soak (30 s)

```text
t=0    heap 18.4 MB   working set 414.7 MB   CPU 0.0%
t=5    heap 18.4 MB   working set 435.3 MB   CPU 1.5%
t=10   heap 18.4 MB   working set 414.6 MB   CPU 0.1%
t=15   heap 18.4 MB   working set 414.7 MB   CPU 0.0%
t=20   heap 18.4 MB   working set 414.7 MB   CPU 0.0%
t=25   heap 18.4 MB   working set 414.7 MB   CPU 0.0%
t=30   heap 18.4 MB   working set 403.9 MB   CPU 0.1%
```

No JS heap growth and no continuous CPU usage during idle. This is a 30 s
soak, not a multi-hour leak proof.

## 10. Remaining issues / next phase

1. **Software GPU is the hard ceiling.** Even with all blur disabled, page
   transitions remain ~55–64 FPS; page mount/React work still limits.
2. **Backend query latency:** `project.overview` and `workspace.snapshot`
   ~1.7 s; `runtime.list` ~2.1 s before caching. Needs SQL/index/query review.
3. **Run Audit and Resize regressions** in the final run were not reproduced;
   repeat with a dedicated scenario before claiming.
4. **Settings modal remains legacy** and is not part of this performance
   optimization.
5. **No virtualization** was introduced; board and tables were not proven to
   be list-bound. Do not add virtual lists without profiling data.
6. 1100 / 125% final visual audit remains outstanding.

## 11. Package

```text
release/win-perf-final/ProjectOS-1.7.0-win-x64-portable.exe
size: 98,515,992 bytes
SHA256: 4F8527ED755D4DD7091FAC9377681C46DAC496F8F9C6A037A1479B5A725292F4
signature: NotSigned
package smoke: PASS
```

## 12. Decision log

- Optimize the **largest static blur surfaces** first; do not globally remove
  glass or hardware acceleration.
- Keep all approved visual tokens/materials; no layout or feature changes.
- Do not ship the diagnostic IPC probe; it was removed before the final build.
- Do not claim 60 FPS everywhere; report measured gains and regressions.
