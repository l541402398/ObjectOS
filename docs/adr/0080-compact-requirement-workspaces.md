# ADR-0080 — Compact new workspace paths and no unaudited baseline writes

Date: 2026-11-05 (America/Los_Angeles). Status: implementing from real desktop failure.

The real DeepSeek desktop journey failed during approved worktree preparation with Git for
Windows 2.56: `fatal: '$GIT_DIR' too big`. The nested data/project/requirement/tasks/task layout
exceeded the platform path budget. The operation correctly stopped as needs_reconciliation.

- New destinations use `data/w/<SHA256(project,requirement)[0:24]>/i` and
  `data/w/<same scope>/t-<SHA256(task)[0:24]>`. Full identities and canonical roots remain in SQLite
  and in the existing approval snapshot. Destination collisions are rejected, never adopted.
- Stored existing workspace roots remain authoritative and are not moved. Old pending approvals
  whose computed destinations differ expire before writing; new paths require a new approval.
- Reject destinations longer than 240 characters on Windows before requesting preparation.
  Extremely deep configured data roots require human relocation; no OS/global Git setting changes.
- Preserve the interrupted operation and partial Git facts. Do not retry, remove or rename its
  directories/branches. Validate the fix using a new requirement and task.
- Inspection also found that the pre-existing uncommitted `ensureProjectGitBaseline` addition
  called Git init/add/commit while constructing a preview, before any ToolCall or approval.
  Remove those unaudited writes. An unborn/non-repository source is explicitly blocked with a
  readable initial-commit requirement. A future automatic baseline needs its own frozen file scope,
  sensitive-path refusal, policy evaluation, ToolCall and human approval; it is not inferred here.

No existing migration bytes, business ownership, Renderer code, credential storage or organization
protocol changes. Add a real Git deep-path preparation test and a no-write unborn-repository test.
