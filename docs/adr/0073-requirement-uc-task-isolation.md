# ADR-0073 — Requirement delivery, UC grouping and isolated development tasks

Date: 2026-10-30 (America/Los_Angeles). Status: implementation authorized by the user.
Baseline: `codex/premium-system`, `f71d33e8acd70ec579501873c327e5b1180ee02a` plus the existing working changes.

## Decision

The user clarified the production workflow: a requirement has a requirements document and a
technical design containing UCs. UCs may be implemented by one or multiple people. Requirements
remain delivery/acceptance units; UCs group assignable development tasks; development workspaces
belong to tasks, independent of the current assignee. This refines D4 of ADR-ORG-0001.

- Keep the existing project, requirement, task, AgentRunner, ToolCall and approval authorities.
  Add nullable requirement/UC task links and an additive migration. Old plans and projects remain
  readable and retain their existing behavior; do not reparent historical tasks automatically.
- A requirement integration branch collects task changes. Each development task has a distinct
  branch and linked Git worktree based on an explicit commit. Git objects are shared; working files
  are separate. A UC is not another mandatory branch. Reassignment retains the task workspace.
- Workspace preparation is a separately approved Git operation recorded before and after execution
  as an actual Run/ToolCall/Approval. Plan approval and organization roles do not authorize it.
  Freeze root, branch, base commit and requirement/UC versions in the request, then recheck before
  mutation. Refuse stale, missing, foreign, or ambiguous paths; never fall back to the project root.
- The Runtime chooses a managed task's execution root. Renderer cannot supply one. Native Agent
  runs retain existing policy, budgets, leases and tool approvals. Existing plan scheduling must
  reject managed tasks until it can integrate their dependency outputs and evidence correctly.
- A crash during workspace preparation is an unknown operation requiring reconciliation, never
  implicit permission to recreate or delete a worktree. Waiting/rejected/failed states remain visible.
  The human-triggered reconciliation endpoint checks the original approved snapshot against actual
  roots, repository, branches, clean content and exact base commits. It only registers verified results
  in SQLite. A confirmed absent task permits a fresh approval; mismatches remain blocked. No Git write,
  cleanup, branch adoption from a different base, or retry occurs during reconciliation.
- Later task integration is serialized per requirement, checks exact source/target revisions and
  existing acceptance evidence, and requires its own approval. Requirement delivery additionally
  verifies the integrated result. Task success never implies requirement delivery.

## Delivery batches

1. Local vertical slice: persisted requirement → UC → task links, real UI for creating/grouping
   work, approved isolated workspace preparation and native Agent execution in the selected task
   workspace, restart/migration/negative-path tests. Preserve blue/cyan optical glass and old entries.
2. Reviewed task integration, dependency baselines, requirement-level verification/delivery, and
   integration with automatic scheduling; organization execution bridge and authoritative server
   synchronization remain explicit prerequisites for team execution on different machines.
3. Versioned Agent capability composition and configurable workflow instances/document gates.
4. Settings ownership/entry consolidation without deleting supported operations or weakening policy.

Batch 1 does not claim shared-server requirement synchronization, automatic workflow execution,
task merge, or end-to-end requirement delivery. These must remain visible gaps, not enabled-looking
placeholder buttons. No alternative runtime or prototype application is introduced.

## Validation

Verify old database checksums/data preservation, cross-project/UC rejection, missing Git base,
approval rejection/expiry/stale base/duplicate decision, two separate task worktrees, fixed execution
roots, restart recovery and actual approved tool writes. Inspect real Electron screenshots at
1440/1280/1024, light/dark, 125% app zoom, focus, long labels and reduced motion. Record actual check
results and gaps beside evidence. No remote push, merge or publication is authorized in this task.
