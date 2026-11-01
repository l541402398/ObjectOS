# Restore the blue/cyan optical glass UI

The user's latest instruction rejected Soft Studio and requested the preceding blue/cyan glass
appearance. Soft Studio implementation is stopped; its design decision and screenshots are historical.

## Restored scope

The restoration source is HEAD `f71d33e8acd70ec579501873c327e5b1180ee02a` plus the saved pre-package
working diff at `docs/design/soft-studio/baseline/pre-existing-work.patch`. Previously uncommitted
UI/source-reuse work is retained. The three inactive alternative-palette experiments are archived;
the active original token/theme API is restored. The manifest records every restored file and SHA-256.

- Restored original optical blue/cyan material, light/dark palettes, navigation and page layout.
- Removed Soft Studio activation, preference control, six-section navigation and experimental flow/list
  composition. A stored `skin=soft-studio` preference no longer changes the product appearance.
- Preserved local Chinese fonts and readiness, complete startup artwork/animation, all nine named
  journey stages, graphical Agent collaboration and flow pulses, modes and existing business controls.
- Runtime, database, IPC, approval policy and user project data were not modified by this restoration.
- No Git reset/checkout, remote push, merge or release publication. Existing user archives remain.

The discontinued changes are recoverable in `.tmp/soft-studio-withdrawn/`, and their evidence remains
clearly marked withdrawn. Two direct file-write attempts hit a transient Windows `EINVAL`; verified
atomic replacement completed the restoration. No automatic approval rejection occurred.

## Evidence

`after/` contains **native Electron** captures of the restored product using an isolated persisted demo
database. These are product captures, not the supplied HTML prototype. Results include a simulated old
skin preference, the original palette, font readiness, nine stages, task inspector and settings access.
The 125% capture uses Electron app zoom, not a claim of Windows system DPI coverage.

There are 35 native product screenshots: 27 restored-page captures, seven startup/journey captures,
and one project-switch capture. The page matrix covers 1440×900, 1280×800 and 1024×768, light and
dark themes, with an additional 125% app-zoom capture. Inspected images include the restored light
Agent workspace, the narrow dark workspace and the light settings modal. The narrow canvas retains
pan/zoom and clips offscreen graph objects; it does not guarantee readable text at fit-all zoom.

## Verification

| Check | Result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS — runtime, desktop, server |
| `pnpm lint` | PASS — 0 errors, 24 existing warnings; boundaries OK |
| `pnpm test` | PASS — 102 files / 571 tests passed; 2 files / 4 tests skipped |
| `node scripts/optical-restore-e2e.mjs` | PASS — 56 checks, 27 native screenshots; no Renderer/CSP errors |
| `node scripts/startup-journey-e2e.mjs --quick` | PASS — 49 checks; original animation, named stages, focus, contrast and reduced-motion checks |
| `node scripts/optical-project-switch-e2e.mjs` | PASS — 4 checks; real project switching, task navigation, autonomous/assisted choices |
| `node scripts/e2e.mjs` | PASS — project creation and restart recovery |
| `node scripts/agent-e2e.mjs` | PASS — real approval pause and tool execution |
| `node scripts/v12-e2e.mjs` | PASS — settings, connections and native Runtime |
| `node scripts/v13-e2e.mjs` | PASS — scan, plan DAG, real graph and saved layout |
| `node scripts/v13-orchestration-e2e.mjs` | FAIL — also failed on serial retry; orchestration remained running with a pending re-review |
| `pnpm package:dir` | PASS — local unpacked Windows application built |
| `pnpm test:package` | PASS — packaged EXE creates starter files and recovers after restart |
| ESLint on the three restoration/startup test scripts | PASS |
| `git diff --check` | PASS |
| Restored-source hash verification | PASS — 44 source files match the restoration manifest; eight archived experimental files are inactive |

Logs are in `validation/`; exact native exit codes/durations are in `validation/native-checks.json`
and `validation/final-checks.json`. Screenshots and their hashes are in `source-and-image-check.json`.
The saved
manifest identifies the restored source rather than claiming the base HEAD alone contains these edits.

The additional full orchestration test did not finish within its completion wait on either run. Its
record contains a `reReview` request; the test waits for completion without resolving that request.
The underlying cause remains unverified. The failed command and serial retry output are retained in
`validation/orchestration.txt` and `validation/orchestration-serial.txt`. No approval gate or Runtime
behavior was changed to make this check pass. This is an outstanding full-loop regression, separate
from the passing plan/DAG/layout and approval/tool-loop checks.

## Scope limits

This is a visual rollback, not completion or acceptance of the abandoned redesign. Existing information
density, tiny graph text at fit-all zoom, and older page inconsistencies are retained. No claim of new
system-wide accessibility certification, paid-model integration, SSH deployment or every legacy error
state is made. The earlier completed startup/journey evidence is preserved without overwriting it.
The startup check used quick mode; a new frame-rate benchmark and Windows system-DPI check were not run.

## Start

From the repository root run `pnpm start` after this build. Restart an already open app to load the
restored renderer. Use `pnpm dev` for development. No reinstall or database reset is required.
