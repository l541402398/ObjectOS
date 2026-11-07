# ADR-0086 — Accepted requirement outputs become reviewed organization knowledge

Date: 2026-11-07. Status: authorized by the user's request to continue K3.
Base HEAD: `c011d95c17926b37c978c59f8133d6666241f3ec`.

## Decision

1. Append PostgreSQL migration 6 and SQLite migration 46; preserve all earlier migration bytes.
   A generic requirement `implemented` flag is not an acceptance receipt. Add an independent local
   human acceptance bound to requirement/task versions, current integrated Git content, trusted
   review/actual-test records, workflow completion where bound, and non-demo completed-Run artifacts.
   Recollect before acceptance and before export; changed evidence requires fresh acceptance. This
   slice does not merge into the project main branch or change existing requirement status semantics.
2. Let the local owner select bounded output artifacts and explicitly edit a technical/business
   knowledge candidate. Initial text is a deterministic arrangement of selected outputs, never
   presented as model-generated. No silent truncation, automatic upload or publication. The selected
   content passes the existing credential/content validator. Personal work stays local unless the
   user explicitly selects an organization project and confirms sharing.
3. Main obtains provenance from the Runtime, never from renderer-supplied acceptance/run/commit
   claims. Credentials remain in Main. Export only opaque local ids, versions, hashes, commits,
   actor-attested acceptance and selected artifact references, without filesystem roots or URIs.
   The organization server records this as `desktop-owner-attested` evidence, not independent
   server verification of local code. A manual organizational publication decision is always required.
4. Record a fixed scoped submission and audit Run/ToolCall before the HTTP write. Policy requires
   explicit human confirmation. Main sends the exact persisted payload; request ids are stable.
   Interrupted/unknown results become `needs_reconciliation`; do not automatically replay. Reading
   the same request id reconciles a matching server receipt. An explicit human retry uses the same
   immutable payload/id after current scope and acceptance checks; no changed-content replay.
5. Project contributors/maintainers/owners may submit project-private candidates. Readers can see
   their own candidates; publishing-capable organization owners/admins with independent project asset
   permission review them. Knowledge candidates are immutable, with pending/returned/published
   states; returned records and reasons remain. Corrections create another candidate. No implicit
   organization-wide publication of private project outputs; no custom reviewer policy editor in K3.
6. Candidate submission and review are idempotent. Recheck current membership/project permission
   under the organization lock. Bind payload digests to ids and reject id reuse with different data.
   Publication creates a new document or a new immutable version and closes the candidate in one
   transaction. Existing-document publication requires the exact observed latest version; concurrent
   updates conflict. Returned/published decisions cannot be overwritten by a different decision.
7. Show related titles, exact content duplicates and related acceptance provenance before review.
   New-document publication requires acknowledgment of current exact published duplicates; never
   silently merge. Retrieval is bounded literal matching, not semantic deduplication. Audit records
   contain identities/references/hashes/decisions, not full prose.
8. Reuse K1 publication semantics and K2 exact-version retrieval. Reviewed publication is immediately
   searchable by a later requirement with the same project permissions. No new Agent runtime,
   attachment ingest, external connector, CLI workflow adapter, member assignment or production
   deployment is introduced. Those remain K4/K5 or later work.

## UI and validation

Extend the existing requirement organization-knowledge tab with acceptance, source selection,
candidate editing and submission receipts; extend the inline organization knowledge area with the
candidate review queue. Preserve approved Premium Liquid Glass, shared tokens and overlay rules.
No protected Design Lab edits or rejected formal review modal. Consult the required design sources
and record unavailable tooling. Validate real PostgreSQL isolation/idempotence/races, real local Git
acceptance/staleness, Main forged-provenance rejection/unknown-outcome recovery, and actual Electron
submit→return/publish→new-requirement retrieval. Capture 1440/1024 light/dark/125%, keyboard/dirty
forms, axe and native-composited contrast. Run all root-required checks and actual packaged EXE smoke;
commit and push implementation, evidence and remaining limitations together.
