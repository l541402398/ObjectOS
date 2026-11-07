# K3 investigation and evidence provenance

Base HEAD: `c011d95c17926b37c978c59f8133d6666241f3ec`.
All attempts below are retained. A failed attempt is not counted as acceptance.

1. Initial typecheck found an untyped evidence array and an unsupported `newId` prefix.
   Use the actual contract type and UUID acceptance ids. Initial renderer lint found a ref read
   during render; the immutable review intent now uses React state. See `typecheck-initial.log`
   and `lint-initial.log`. These are implementation failures, subsequently corrected.
2. `desktop-first.log`: the fixture called a guessed task API. Reading DesktopApi established
   `tasks.detail`; the fixture now uses that named API. Autonomy is explicitly set to assist,
   so the deterministic fixture does not accidentally trigger unrelated automatic planning.
3. `desktop-second.log`: the real server accepted a candidate, then deliberately lost its HTTP
   response. GET reconciliation succeeded without another POST, but an immediate close exposed
   a real product race: the visible receipt updated before a slow Git evidence refresh cleared
   the parent's dirty flag. A discard prompt appeared. Clear the dirty flag on the successful
   receipt itself, before the later refresh. The test now waits for the actual dialog test id
   to disappear; a role query can wrongly consider a parent hidden while a discard dialog owns
   focus. No forced clicks, removed assertions or longer timeouts were used.
4. `desktop-third.log` and `desktop-third-checks.json`: the complete native desktop journey passed,
   including return, corrected submission, response loss on publication, exact-version reuse by
   a later requirement, and restart without replay. Manual screenshot inspection then found
   excessive default heading/list spacing in the new writeback form. The scoped form CSS now
   resets those margins and uses the existing 16px heading scale. Two prior screenshots remain
   in `preflight-screenshots/` for comparison. Protected DAG styles were not changed.
5. Formal checks use `scripts/org-knowledge-checks.mjs --phase=k3`, which records each exit code,
   time, log, base HEAD and normalized per-file source manifest. The approved-DAG adapter only
   redirects output and resolves imports; its original assertions remain unchanged. Historical
   stage-first/rejected-modal probes were already diagnosed in the K2 report and are not used
   to redefine this phase's visual baseline.
6. The first complete test run (`test-1.log`, 660.93s) passed 114 files / 687 tests but failed the
   old worker suite's setup: its exact schema-version assertion still expected 5 after this phase
   appended migration 6. Its six tests consequently did not run; four unrelated environment skips
   also remained. Read the suite and searched all other exact schema expectations, then updated
   that one assertion to 6. No product code, security assertion, concurrency or timeout changed.
   The initial manifest is retained as `source-manifest.initial.json`; a fresh complete run records
   the changed test input in its own named manifest. The first failed run is not counted as green.
7. The second full run passed 115 files / 693 tests, with four optional external-environment skips
   (`test-2.log`, 646.59s). Build and tested-build hashes then passed. The first formal desktop attempt
   stopped at its strict PNG byte comparison. Native decoded pixels showed just 42 changed pixels,
   maximum channel delta 3, at the canvas outline. Unmodified images and the actual Windows pixel
   comparison script/result are retained in `preflight-screenshots/formal-first-*-dag.png`,
   `compare-pixels.ps1` and `pixel-difference-first.json`. Python/Pillow was unavailable, so the
   diagnostic uses Windows System.Drawing; no image modification or threshold is used.
   The harness enabled its optional CDP detector port only on the new build, not on the baseline.
   Both sides now receive the same startup flags. The byte-equality assertion remains intact.
   The same harness edit strengthens next-requirement proof to require the complete reviewed body,
   including a correction absent from the original local artifacts, as well as the exact version id.
   Product code and the other 746 source/test files are unchanged from the passing complete suite;
   rerun root lint and the desktop/DAG/required E2E/package sequence with a fresh named manifest.
8. Uniform CDP flags restored the exact PNG equality in the next formal desktop attempt.
   The rendered detector then exited 2 after finding 11 whole-page diagnostics; the synchronous
   process wrapper incorrectly treated this documented diagnostic exit as an operational failure
   before saving its JSON. The original output is retained in `knowledge-desktop-2.log`, with the
   safely decoded JSON in `impeccable-rendered-first.json`. Five palette warnings target the pinned
   cyan/glass background; other selectors are the original shell, sidebar, journey/action bar and
   global body easing, outside the new writeback form. Preserve and review them instead of restyling
   the approved system. The harness now saves diagnostics and actual selector/aria-hidden context;
   only an operational detector failure aborts the business journey. Native new-surface contrast
   and axe assertions are unchanged. No product source changed. Rendered detector completion is
   explicitly not reported as an empty-finding or quality PASS.

The desktop harness prepares an isolated project, Git/workflow data and a local deterministic SSE
model through existing typed APIs. Two actual Native workflow agents generate persisted artifacts;
an actual test process, trusted human review and separately approved Git integration establish the
acceptance fixture. It does not claim that a real external model independently developed the fixture
code. K3 acceptance, editing, sharing, returning, publication and next-requirement selection use visible
controls. Browser authorization uses the real registration/consent protocol in an isolated Electron
browser window; OS-default-browser manual operation is not claimed.

The response-loss hook destroys the socket only after the actual PostgreSQL transaction has committed
and the HTTP handler has produced success. POST counters distinguish GET reconciliation from replay.
The server records desktop-owner-attested local provenance, never claims independently verified local
Git. Structured source metadata omits rootPath/URI; arbitrary human-edited or model-generated prose
still requires human inspection before sharing.
