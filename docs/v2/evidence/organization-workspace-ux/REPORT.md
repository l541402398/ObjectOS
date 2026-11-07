# Organization workspace UX — ADR-0088

Base/test HEAD: `df48fa25f5f48eb4d3ae537cc28369e8a33fb5ca` plus the working tree recorded in each source manifest. This report and native evidence travel with the implementation commit. Date: 2026-11-07.

## Request and result

Organization work was buried in the global Settings dialog; list/detail/receipt navigation discarded context and collaboration actions were buried in the local requirement materials tab. The implementation makes organization work a first-level workspace with direct section navigation and preserves K1–K4 capabilities.

- Primary sidebar, breadcrumb, command palette and global route agree on `#/organization`. It works before login and without a local project. Settings shows identity and a visible workspace link. The local-project journey strip does not appear here: managers can dispatch without creating a local project.
- Direct sections: requirement collaboration, organization knowledge, knowledge review, shared projects, members/permissions, invitations, configuration assets and execution devices. Account details/exit use the registered shared popover and confirmation dialog.
- Wide windows retain the requirement list beside details. Search, project/person/status filters apply only to the bounded retrieved list, with an explicit truncation note. Priority, deadline, project, owner, dispatcher, brief, criteria and report evidence remain available. Narrow windows focus the same detail and return to the preserved filters with keyboard focus restored.
- Current valid actions appear near the detail heading. A successful dispatch/accept/decision updates the detail with a compact receipt notice. Unknown outcomes retain explicit GET/retry/manual-close controls, and outstanding results are visible above the collapsed history after restart.
- Dirty dispatch, assignment decisions, knowledge edits/review and receipt edits use the existing draft context plus route/history and unload protection; organization/account changes and refresh are disabled while dirty. Background reads do not remove edited assignment details, and decisions retain the revision/report the user reviewed. This does not expand the existing protection contract to every older administrative inline editor.
- Local assigned requirements expose origin/status, progress/delivery, organization materials, return-to-assignment and separate knowledge acceptance/writeback beside the requirement heading. Reporting uses a fixed shared footer. Knowledge publication remains a separate organization review.

No Main/preload/Runtime/server/contracts/migration or approval policy changes. All writes retain the same named APIs and authorization. The frozen Lab still calls its original navigation projection; only production uses the new adapter. No graph, material, palette, font or animation redesign.

## Sources and design decisions

Read the root instructions, implementation baseline/architecture, ADR-0087 and wrote ADR-0088 before navigation changes. Reconsulted UI contract, DESIGN, design system/changelog, overlay system/audit, recovery/migration/issues/visual/regression documents, current Lab/navigation/optical implementation and the approved DAG image. The screenshot has precedence over contradictory historical stage/R1 documents.

Local UI UX Pro Max typography/color/layout/keyboard/motion queries are `design-query-1.log` through `design-query-5.log`. Keep packaged Noto Sans SC; reject suggested remote/TC fonts and new navy/green palettes against the approved optical direction. Adopt persistent navigation context, native labels/focus and reduced-motion feedback.

Actual local Vercel composition/context and React performance rules were consulted, including explicit variants, async parallel reads, generic context and avoiding nested component definitions. Assignment list, dispatch, detail and report remain separate components. Impeccable context from K2/K3/K4 in this conversation was retained; craft-floor was read immediately before UI edits. The runtime exposes no skill-loader tool, so mandatory local skill files were read directly; no tool-based loading is claimed and no PRODUCT.md was invented. Actual positional source detection and native CDP detection are separate evidence.

Actual Sim Studio editor/menu, installed Liquid Glass React and React Bits Aurora source/license/performance inspections from K2/K3/K4 in this same conversation are reused; their recorded limitations remain. No new graph effect, GPU compatibility qualification, borrowed brand assets or motion system was introduced. Existing Motion/shared-overlay choreography and reduced-motion rules remain.

## Verification

Command attempts, exact source snapshots and retained failures are recorded below. `checks.json` preserves each coordinator attempt and exact source manifest; preliminary attempts are retained separately. Source scanning alone is not visual acceptance.

The native harness retains K4's two-account PostgreSQL/Electron workflow and independent knowledge publication assertions, adapting only visible navigation and normal receipt presentation to this UI. Additional checks cover global signed-out reachability, a single command-palette destination, direct section entry, primary/history dirty protection, refocus stability, bounded list filtering, local/organization return and visible outstanding reconciliation. Fixtures are isolated; deterministic model output is not an external inference-quality result.

`comparison-before/` contains unchanged committed K4 native screenshots, with hashes in `comparison-before-provenance.json`. They compare the previous modal layout with the new workspace; fixture timestamps/IDs differ, so these are qualitative comparisons. The protected DAG uses a separate identical-launch before/after byte comparison and the unchanged approved-DAG assertions.

Limitations: subjective user visual acceptance remains separate; Chromium zoom is not OS DPI. Two isolated profiles on one Windows host are not physical dual-machine or production deployment acceptance. Existing global/Lab diagnostics are reported separately and are not silently restyled.


## Retained investigations

`iteration-ledger.json` names every failed preliminary/native attempt and its preserved evidence. Login/execution headings were corrected. Harness timing now waits for real route data and closed overlays; receipt navigation assertions follow the new persistent detail. A strict DAG comparison once found 30 differing pixels (maximum channel delta 2); identical media/font readiness resolved capture consistency without a tolerance, mask or protected product edit. The complete native matrix found a real 4.382:1 narrow/light back-link failure on the optical background. Only `.ow-back-list` now uses the existing ink token; the 4.5:1 threshold remains unchanged. Final results below must come from the fresh complete matrix, not accumulated quick successes.

The full 715-test suite ran while renderer refinements/harness fixes were being made. Its original source snapshot is retained. No business, Main/preload, Runtime/server, package or unit test source changed; `unit-and-ui-source-provenance.json` records that scope. The final renderer is covered by later real native checks/build/type checks. Four opt-in skips belong to external OpenCode/DeepSeek and SSH/VPS fixtures; they were not enabled or represented as passing.

The new native flow exercises connected accounts and an intentionally lost acceptance response. Forced offline/expired account matrices, every older administrative CRUD/Worker-consent/job combination, OS DPI, physical dual-machine operation and production deployment are not newly qualified by this UI change. Those controls remain available through their existing APIs/tests. Existing administrative inline editors do not all participate in the newer draft guard.


## Final visual and behavior evidence

- Complete two-account acceptance: **561 PASS**, 128 scoped axe states with **0 violations**, 3,053 native text measurements, minimum **4.659:1**, 137 native captures. Glass produces axe color-contrast incompletes; native compositor sampling supplements them and excludes disabled, SVG and obscured/offscreen text. This is not a whole-app WCAG certificate.
- The full-page detector then found the new `协作` caption at approximately 4.2:1 after scrolling the dispatch form, outside the earlier assignment-only audit scope. Native PNG background samples confirmed roughly 4.1–4.3:1 there. Change exactly `.ow-nav-group` from the existing secondary ink token to the existing primary ink token; no other product source changed after complete acceptance. `nav-contrast-followup/caption-only-product-delta.json` verifies that reverting this one declaration restores the exact earlier CSS hash and all other product sources are identical.
- Final caption follow-up: **107 PASS**, 25 scoped axe states with **0 violations**, 349 native text measurements, minimum **5.023:1**, 27 captures. It explicitly measures both full workspace and scrolled workspace at 1440/1024, light/dark, 100/125%, plus signed-out and final member overview. The scrolling audit includes the navigation itself; it does not repeat the earlier scope gap. This is a targeted CSS qualification; the full business workflow remains the separate 561-check snapshot with identical TS/TSX/Main/preload/Runtime/server sources.
- Both original K4-to-workspace and packaged-workspace-to-final-caption protected DAG PNG comparisons are **byte-identical**. The unchanged approved-DAG harness also passes **32/32**.
- Final full-page detector retains **2 diagnostics**: one frozen cyan/glass palette warning (rejected as restyling guidance against the user-approved screenshot) and one global easing advisory. The caption contrast diagnostic is absent. Original 3-diagnostic output and the 4.382:1 back-link failure remain preserved. No detector ignores, pixel masks, tolerance changes or global palette edits were introduced.
- Actual manual review covers eight representative complete-run captures, plus final scrolled-caption/member-overview images. See `manual-screenshot-review.json` and the follow-up review. Remaining matrix captures have automated accessibility/compositor/overflow evidence; subjective user visual approval is not inferred.

See [before/after comparison](COMPARISON.md) and [final workspace overview](nav-contrast-followup/screenshots/workspace-overview-1440-light.png). Root screenshots record the complete acceptance snapshot; final follow-up screenshots include the one-declaration caption correction. The final package is rebuilt and byte-checked after that correction.


## Actual command results and delivered bytes

Final source snapshot: `075a8a12dff7b428e6f1141b1b8bed8649c649dae564b538e63e3251d8884e59`. Actual test HEAD is the base HEAD above; named manifests distinguish complete behavior acceptance from the final scoped CSS qualification. `final-source-verification.json` verifies the working tree without mismatches using the coordinator's exact CRLF normalization, including JSX. Its initial ad-hoc normalization omission is recorded; the protected Aurora product file did not change.

| Check | Result | Actual log | Source snapshot |
|---|---|---|---|
| `pnpm lint` | PASS | [lint-3.log](lint-3.log) | `075a8a12dff7` |
| `pnpm typecheck` | PASS | [typecheck-2.log](typecheck-2.log) | `8f15cdd382c9` |
| `pnpm run test --maxWorkers=2` | PASS | [test-1.log](test-1.log) | `648be0561078` |
| `pnpm build` | PASS | [build-3.log](build-3.log) | `075a8a12dff7` |
| `C:\Program Files\nodejs\node.exe --import tsx scripts/organization-workspace-ux-e2e.mjs` | PASS | [organization-workspace-desktop-3.log](organization-workspace-desktop-3.log) | `a0b4ecdf32f9` |
| `C:\Program Files\nodejs\node.exe --import tsx scripts/organization-nav-contrast-e2e.mjs` | PASS | [navigation-contrast-1.log](navigation-contrast-1.log) | `075a8a12dff7` |
| `C:\Program Files\nodejs\node.exe docs/v2/evidence/organization-workspace-ux/run-approved-dag.mjs` | PASS | [approved-dag-1.log](approved-dag-1.log) | `a0b4ecdf32f9` |
| `C:\Program Files\nodejs\node.exe scripts/e2e.mjs` | PASS | [desktop-e2e-1.log](desktop-e2e-1.log) | `a0b4ecdf32f9` |
| `C:\Program Files\nodejs\node.exe scripts/agent-e2e.mjs` | PASS | [agent-e2e-1.log](agent-e2e-1.log) | `a0b4ecdf32f9` |
| `C:\Program Files\nodejs\node.exe scripts/v12-e2e.mjs` | PASS | [v12-e2e-1.log](v12-e2e-1.log) | `a0b4ecdf32f9` |
| `C:\Program Files\nodejs\node.exe scripts/v13-e2e.mjs` | PASS | [v13-e2e-1.log](v13-e2e-1.log) | `a0b4ecdf32f9` |
| `pnpm package:dir` | PASS | [package-dir-2.log](package-dir-2.log) | `075a8a12dff7` |
| `pnpm test:package` | PASS | [package-smoke-2.log](package-smoke-2.log) | `075a8a12dff7` |
| `C:\Program Files\nodejs\node.exe docs/v2/evidence/organization-workspace-ux/artifact-provenance.mjs final` | PASS | [artifact-verification-2.log](artifact-verification-2.log) | `075a8a12dff7` |

Final lint: 0 errors / 48 existing warnings. Vitest: 117 files PASS / 2 files SKIP, 715 tests PASS / 4 opt-in SKIP. Final package smoke actually launches the unpacked Windows EXE, creates/writes a project, and recovers it after restart. Packaging leaves all 235 tested build files unchanged; 122 desktop ASAR entries match tested bytes, and the packaged Runtime matches its build. Raw digests are in `artifact-hashes.json`. Earlier package/behavior snapshots remain under `before-nav-caption-fix/`; final native and packaged checks qualify the one CSS declaration.

Staged source/document whitespace checks are clean. The whole staged-evidence whitespace diagnostic reports nine raw CLI logs with a final blank line; those outputs are preserved verbatim rather than edited to look clean. This does not change lint/test results.
