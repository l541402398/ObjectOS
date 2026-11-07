# K3 screenshot index

Actual Electron `webContents.capturePage()` PNGs. Each group covers 1440×900 and 1024×768,
light/dark, 100%/125% Electron zoom. Filenames use `<group>-<width>-<theme>-<zoom>.png`.
Zoom is application zoom, not a physical Windows DPI test. Reduced motion is enabled for the
repeatable matrix. The final capture list and every axe/native contrast result are in
[`../desktop-checks.json`](../desktop-checks.json).

| Group | State | Example |
| --- | --- | --- |
| `personal-acceptance` | Unlogged local acceptance | [1440 light](personal-acceptance-1440-light-100.png) |
| `candidate-editor` | Selected real output, editable candidate and sharing scope | [1440 light](candidate-editor-1440-light-100.png), [1024 dark 125%](candidate-editor-1024-dark-125.png) |
| `candidate-review` | Inline review with publication target and human note | [1440 light](candidate-review-1440-light-100.png), [1024 dark 125%](candidate-review-1024-dark-125.png) |
| `candidate-returned` | Immutable returned candidate and reason | [1440 light](candidate-returned-1440-light-100.png) |
| `submission-unknown` | Lost HTTP success response, receipt needs reconciliation | [1440 light](submission-unknown-1440-light-100.png) |
| `candidate-queue` | Returned and corrected pending records | [1024 dark 125%](candidate-queue-1024-dark-125.png) |
| `candidate-published` | Reviewed immutable published version | [1440 light](candidate-published-1440-light-100.png), [1024 dark 125%](candidate-published-1024-dark-125.png) |

Additional captures: `candidate-editor-body.png`, `candidate-editor-sharing.png`,
`submission-reconciled.png`, `publication-unknown.png`, `new-requirement-reuses-publication.png`
and `knowledge-flywheel-plan.png`.

`before-protected-dag.png` is the recorded K2 packaged EXE; `after-protected-dag.png` is this
phase's current development build, both at the approved Design Lab DAG. The harness compares
the PNG bytes. The baseline package's actual EXE/ASAR/Runtime hashes are checked before packaging.

`failure.png` and `../failure-dom.txt`, if present, belong to the retained failed preflight attempt
described in INVESTIGATION.md; they are not final acceptance captures. Earlier editor spacing is
retained in `../preflight-screenshots/`.
