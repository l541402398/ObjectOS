# Soft Studio implementation evidence

**WITHDRAWN.** The user rejected this direction and requested the previous blue/cyan glass appearance.
The notes and screenshots below record the discontinued experiment; they are not current product
acceptance. The restoration report is [optical-restore/REPORT.md](../optical-restore/REPORT.md).

In progress. Base HEAD `f71d33e8acd70ec579501873c327e5b1180ee02a`; branch `codex/premium-system`.
This report covers the working changes after that HEAD, not a released build. No remote push authorized.

## Batch 1: shared frame and live task flow

Implemented canonical light/dark tokens, early skin selection, reversible appearance preference,
six project sections and contextual subviews. Normal execution-service state is consolidated in the
status bar; failure/recovery stays visible. Named journey stages and full startup remain.

Flow now uses real execution status, preserves all tasks and real dependency/delegation edges, keeps
locally moved positions across selection/refetch, and merges hidden positions when saving. It has a
compact toolbar, optional inspector/minimap and collapsible activity/diagnostics. Existing execution
grant, start/pause/resume/cancel, plan review and tool approvals remain. Task list uses the existing
task query and detail surface; task deep links are supported.

Conflicting orchestration CSS rules were removed from three old style locations and consolidated in
one workspace stylesheet. No new runtime or static production graph was introduced.

## Input and baseline

See ADR-0072 for archive hashes, inspected sources and decisions. `baseline/product-before-*` are native
Electron captures of the current branch before Soft Studio activation; `reference-prototype-*` are
explicitly design references, not acceptance. `product-baseline.json` records the actual window sizes.

## Validation ledger

- First interim type check: FAIL (one unchecked indexed position type). Corrected to fall back to the
  node's position; follow-up checks below are authoritative.
- Batch 1 type/unit/build: running; see `validation/*-batch1.txt`.
- Native Soft Studio screenshots, focus/contrast/error/reduced-motion and 125% app zoom: pending.
- Full lint/type/test/build, create/recovery, real approval/tool execution, settings, graph persistence,
  packaged EXE smoke: pending after implementation stabilizes.
- Overview, Agent, workspace, operations, activity and settings refinement: pending next batch.

No pending item above is reported as passed. Final results will replace these entries after execution.
