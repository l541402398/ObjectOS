# ADR-0077: Requirement default owners and revocable start intents

Status: Accepted for implementation, 2026-10-30. Extends ADR-0076; does not replace its
workflow, evidence or isolation rules.

## Context

ADR-0076 made every requirement task inherit the requirement's frozen workflow. In manual and
assisted use the person still had to choose an Agent for every node of every task and click
"start" once per task. The handoff plan (batch 1) asks to reduce those repeated operations
without hiding approvals or turning one click into a permanent permission.

## Decision

### Requirement-level default owners

- `requirement_flow_bindings.assignments_json` is the requirement's per-node default owner. It
  already seeded new task steps; it is now editable after binding through the typed API
  `requirement.flow.defaults`, guarded by the binding `version` (optimistic concurrency).
- Editing defaults never rebuilds task flow instances and never bumps the requirement version
  (that version is part of every node's evidence scope). `requirement.flow.bind` remains the
  only way to change the template, and only before execution.
- Each step records `assignment_source` (`default`, `manual`, `ai`; `NULL` for legacy rows,
  treated like a human choice). Single-task overrides stay `manual`.
- Applying defaults is two steps: `requirement.flow.assignment.preview` returns every step's
  proposed action and a token over binding version + step versions;
  `requirement.flow.assignment.apply` re-derives the preview in one transaction and fails if the
  token changed. It fills only unassigned `pending` steps. Replacing an existing owner requires the
  step to be listed explicitly in `replaceStepIds`; started/finished steps are never changed.

### Requirement-level start intent

- `requirement.flow.startAll` persists a `requirement_flow_start_intents` row (unique
  `request_key`) and one item per task, then evaluates each task in Runtime: task finished,
  flow completed/running/paused/blocked, missing or unavailable Agents, unfinished or
  unintegrated dependencies, budget, frozen binding version, active runs and workspace state.
  Eligible idle tasks are moved to `running` with a conditional update, so duplicate or concurrent
  requests cannot create a second Run. Results are returned per task and stored for reload.
- A repeated request with the same key replays the stored result and performs no new work.
- Before the requirement's shared integration worktree exists, only one task may hold a pending
  workspace preparation. Other eligible tasks wait as `waiting_workspace` and request their own
  approval after the first preparation finishes. (Desktop acceptance showed that two concurrent
  first preparations make the second approval stale, because the first one creates the shared
  worktree; the existing rule that a changed frozen scope is rejected is kept, not relaxed.)
- The intent is a scoped, revocable *start authorization*: each item stores a hash of the task
  version and its node owners, and the intent stores requirement and binding versions. When a
  dependency is later accepted and integrated, the Runtime starts a waiting item only if that
  scope still matches; otherwise the item is cancelled with a visible reason.
- `requirement.flow.stopAll` revokes active intents of the requirement and pauses their running
  flows. Already running Runs and pending tool approvals stay visible and are handled through the
  existing records; no new node is started afterwards. Pausing a single task cancels its intent
  items, so a human pause is never resumed automatically.
- Starting does **not** approve anything. Workspace creation, file writes, commands, Git
  integration and deployment keep their own policy evaluation and human approvals. Opening a page,
  switching the work mode or restarting the app never creates an intent.
- Paused tasks are not resumed by a bulk start; they are resumed from the task detail.

### Work modes

Manual, assisted and autonomous keep their meaning. Autonomous mode still fills missing owners
with validated AI choices. In every mode, automatic continuation is limited to intents that a
person created. Linking ADR-0022 plan execution grants (tool-call reuse) to requirement
workflows is **not** part of this decision; the existing grant behaviour is unchanged.

## Persistence

V43 appends `task_flow_steps.assignment_source`, `requirement_flow_start_intents` and
`requirement_flow_start_items`. Earlier migrations are unchanged.

## Validation

Unit tests cover: three tasks sharing six stage defaults, a preserved single-task override,
stale preview tokens, invalid Agents, idempotent and concurrent start requests without duplicate
Runs, dependency waiting and later continuation, revoked intents not starting new nodes, pause
not resumed, budget denial and restart. Desktop evidence lives in
`docs/v2/evidence/requirement-defaults-start/`.
