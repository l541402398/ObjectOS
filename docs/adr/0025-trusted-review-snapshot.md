# ADR-0025 — Reviews are bound to trusted workspace content snapshots

- Status: Accepted (Phase 2.8.7)
- Supersedes: the `reviewedRevision = git rev-parse HEAD` binding from ADR-0024
- Related: ADR-0022 (task evidence contract), ADR-0024 (review verdict), ADR-0026 (autonomy policy)

## Context

ADR-0024 made review verdicts explicit and version-bound, but the binding was a commit id:
`reviewedRevision = git rev-parse HEAD`. An Agent working in a worktree can rewrite files without
committing, so HEAD stays identical while the reviewed code has already changed. The first
implementation of ADR-0024 also only collected a snapshot when the Agent *did not* supply a
`reviewedRevision`, which meant an Agent could name any commit and keep an old approval current.

Three modules then decided "is there an approving review?" with three rules
(`CompletionDecision`, `OrchestrationScheduler`, `GateEvaluation`), so one positive review could
override a contradictory one in one module and not in another.

## Decision

1. A review is bound to **file content**, not to a commit. `ReviewSnapshot` records, for the
   reviewed scope only: project/plan/task/run, the trusted worktree identity (real path, branch,
   head, linked-worktree flag), the git baseline commit (informational), every reviewed path with
   its SHA-256 (or `null` when absent), the worktree's staged/unstaged/untracked/deleted/renamed
   changes, the referenced Diff/Artifact/Evidence ids, the reviewer identity, and one fingerprint.
2. The fingerprint is computed over the sorted `(path, sha256)` pairs only. Committing unchanged
   bytes, or copying the same bytes into another checkout, does **not** invalidate a review; any
   byte change, addition or deletion does.
3. The runtime collects snapshots, never the Agent. Whatever an Agent writes into
   `metadata.reviewSnapshot` / `metadata.reviewedRevision` is discarded and replaced.
4. Path safety is enforced while collecting: absolute paths, `..` escapes, symlinks (never
   followed), non-regular files and real paths outside the workspace are rejected and recorded in
   `changes.rejected`. A missing file is recorded as `sha256: null`, never omitted.
5. Scope is the review's own `reviewedObjects`. Project-wide or dependency-wide reviews must say
   so explicitly (`scope: 'project'` or `scopeRoots`), which widens the snapshot to the changed
   files under those roots. Unrelated files elsewhere never invalidate a narrow review.
6. Freshness is classified once, in `classifyReviewFreshness`, and consumed by
   `reviewVerdictOf` and by `resolveReviewEvidence`:
   - `current` — the stored snapshot matches current content, or (no snapshot) the revision matches;
   - `stale` — content/revision moved on; kept as audit, not decisive;
   - `unverifiable` — no snapshot and no revision, or the caller cannot verify; can never approve.
   A structured `verdict: 'approved'` is checked **after** the freshness gate, so it cannot bypass it.
7. `resolveReviewEvidence` is the single rule for approval, supersession and multi-review
   conflicts: a real blocker on current content blocks; approval needs at least one current review
   and agreement among **all** current reviews; historical negatives do not permanently block a
   re-reviewed version; no current review means no approval.
8. `GateEvaluation` accepts a `review_record` evidence row only while its provenance still names
   the current plan revision and its content fingerprint (`reviewRecordStillCurrent`). The
   scheduler records that evidence from a real approving review
   (`plan.reviewEvidenceRecorded`) — it is never fabricated, and the verdict is never invented.
9. Historical review artifacts are never overwritten or deleted. Staleness is derived, not stored
   destructively.

## Consequences

- A review can no longer be "approved once, valid forever". Any content change requires a new
  review, which is the intended cost.
- Review artifacts written before this ADR have no snapshot and become `unverifiable`, so they no
  longer approve anything. This is a fail-closed migration; the review task can always be re-run.
- A review of only commits/artifacts (no file scope) cannot be content-verified and therefore
  cannot approve. Reviewers must name the files they actually read.
- The snapshot adds a fingerprint column-sized payload to artifact metadata (bounded by the
  reviewed scope; project-wide reviews include only changed files).

## Tests

`tests/p287-review-snapshot.test.ts` covers: hashing real bytes, uncommitted edit invalidation
(HEAD unchanged), untracked files, staged/unstaged/deleted/renamed changes, scope widening,
symlink rejection, structured-approval bypass, historical negative supersession, current
multi-review conflict, unresolved blockers, unverifiable/no-context refusal, stale-only refusal,
`review_record` binding round-trip and currency.
