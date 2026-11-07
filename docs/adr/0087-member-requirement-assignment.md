# ADR-0087 — Member requirement assignments with explicit local acceptance

Date: 2026-11-07 (America/Los_Angeles). Status: implementation authorized by the user continuing K4.
Base HEAD: `b395bddbf207611d606cbeeda491ff2b81417501`.

## Decision

1. Append PostgreSQL migration 7 and SQLite migration 47, without changing earlier migration bytes.
   Add server-owned member assignments, immutable briefs, optimistic revisions, command idempotence,
   reports and audit references. A member assignment is distinct from an authorized-device Worker Job.
   It does not create a second Agent runtime, select a remote directory or automatically start work.
2. Add explicit project assignment permission for project owners/maintainers. Organization membership
   and project membership are both required; an organization administrator without project permission
   cannot dispatch. Recipients must be current project owners/maintainers/contributors and organization
   members. Role labels such as leader do not grant authority. Roster/list/detail are scope-filtered;
   ordinary members see their own assignments, managers see the project's assignments.
3. Freeze title, description, criteria, priority and optional deadline when dispatched. Pending work can
   be accepted or declined by its recipient. Acceptance binds a Runtime-generated installation id and
   claim reference, not a filesystem path. These opaque references provide application idempotence,
   not cryptographic device attestation or a Worker execution grant. Membership is rechecked under the
   same organization lock as member changes. Identical commands replay results; changed id reuse fails.
4. Local acceptance requires selecting an existing local project and explicit confirmation. Runtime
   persists the fixed intent and approved Run/ToolCall before Main sends HTTP. Only a matching server
   acceptance permits an idempotent SQLite transaction to create one ordinary requirement, its default
   manual workflow and immutable assignment binding. No Git/files/model execution occurs on import.
   Unknown/crashed HTTP outcomes require explicit GET reconciliation or same-id retry, never replay.
   Manager-only control-plane commands without a local project persist their fixed payload, explicit
   consent and outcome in the Runtime outbox and server audit; they do not create a fictitious project
   to own a Run. Local acceptance/progress/delivery additionally own approved Run/ToolCall records.
   An explicitly confirmed local close records the note without cancelling server work or asserting
   success. Later explicit GET reconciliation can still resolve that same intent without a POST.
   A returned acknowledgement is not an atomic two-database transaction: preserved bindings and fresh
   authority checks protect any later execution if cancellation races local metadata creation.
5. Use the existing Native Runner, Planner, requirement workspaces and approvals. Add a bounded named
   Main↔Runtime assignment-authority channel. Freeze assignment references in Run audit; check current
   account/organization/project/claim/status before planning, every model/tool request and after human
   approval, including Git/workspace/delivery effects. Offline, logout, removal, cancellation or
   reassignment blocks further assigned work. Existing local files and personal projects remain.
   Assigned requirements temporarily reject external CLI execution, whose tool boundary cannot enforce
   these checks. Organization knowledge selection must stay in the assigned project and keeps K2 exact
   version/revocation semantics, including when no source is selected.
   The legacy plan-group discussion endpoint starts unscoped Runs without a requirement task. It is
   therefore unavailable for assigned requirements; use the existing scoped requirement workflow.
   Personal plan discussion remains available. Do not silently fall back to an unscoped discussion.
6. Progress is explicitly synchronized from Runtime-collected task/run counts, never a Renderer claim.
   Agent completion is not requirement acceptance. Submitting delivery requires current K3 independent
   human acceptance and bounded artifact/hash/commit references; source is desktop-owner-attested, not
   server-verified code. No file roots, secrets, raw model transcripts or automatic source uploads.
   A manager separately accepts or requests changes against an exact delivery report and revision.
   Work awaiting manager review/completed work cannot silently keep running. A returned/withdrawn
   delivery returns to accepted work; history remains. Knowledge publication stays a separate K3 action.
   The authority channel distinguishes execution from knowledge publication: completed/review-pending
   assignments may publish independently accepted knowledge, while cancellation/reassignment denies both.
7. Cancellation and reassignment are explicit versioned/idempotent commands. Reassignment atomically
   closes the old assignment and creates a fresh pending assignment for the new member with the same
   immutable brief. It never revives or silently rebinds the previous member's local requirement.
   Completed work cannot be reassigned in place. Only managers can cancel/reassign/review; recipients
   can decline, synchronize their own progress, submit delivery and withdraw pending review.
8. Preserve the approved Premium Liquid Glass/DAG. Add inline dispatch/inbox/detail inside existing
   organization Settings, and an assignment-origin/status section in the current requirement workspace.
   Protect dirty forms and unknown decisions. No nested Settings modal or explanatory filler.

## Validation and boundaries

Real PostgreSQL/HTTP: role/project isolation, recipient eligibility, immutable briefs, current permission
after lock waits, duplicate commands, single acceptance across two clients, decline/cancel/reassign,
report/review separation, optimistic races and restart. SQLite/Main/Runner: one requirement per accepted
claim, forged provenance rejection, fixed-scope unknown-outcome recovery, personal zero requests,
assigned work with/without K2 references, cancellation after approval and preserved local work.
Actual Electron: two isolated authenticated profiles against one service; visible leader dispatch,
member decline/accept/local mapping, progress and independent delivery review, cancellation/reassignment,
restart; 1440/1024 light/dark 100/125%, keyboard, axe and native composited contrast. Root-required checks,
actual EXE smoke, frozen build/source hashes and evidence travel with the implementation commit, pushed.

K4 is interactive member work, not unattended remote device control. K5 production TLS/backups/upgrades,
two physical machines, external-model quality and full deployment remain separate. Report the exact
test fixtures, failures and unverified permutations; do not infer visual acceptance from unit tests.
