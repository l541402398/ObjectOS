# ADR-0035 — write_file accepts workspace-relative paths and normalizes absolute ones inside it

- Status: Accepted (Phase 2.8.8)
- Related: ADR-0026 (grant), ADR-0032 (approval families), ADR-0034 (revision must fix)

## Context

The Phase 2.8.8 run that finally produced a real fix revision failed at the last step:

```
task.moved  "修复 src/sums.mjs 使 sum 返回两个参数之和" → blocked
note: 修正未落盘：write_file 到 src/sums.mjs 的相对路径写入被拒绝
      （路径 ../../../../../../../../Administrator/... 不在计划授权路径范围内：src, tests）
```

The Agent had the absolute worktree path in its context and passed it back to `write_file`. The path
resolved outside the authorized scope, the grant denied it (correctly — the write scope must be
enforced), the tool call failed, and the task was blocked; with downstream tasks still in `backlog`
the scheduler concluded "nothing can progress" and failed the plan.

Nothing was unsafe — but the product turned a *mechanically correctable* argument mistake into a
terminal plan failure at the last step of the whole chain.

## Decision

1. `write_file` normalizes its `path` argument before any policy decision:
   - an **absolute** path that resolves inside the current workspace becomes its workspace-relative
     form (so passing the worktree path back is harmless);
   - an **absolute** path outside the workspace fails with a `BAD_REQUEST` that states the expected
     form and the workspace root (retryable inside the Agent's budget, not a policy denial);
   - a relative path containing `..` also fails with a `BAD_REQUEST` explaining that a
     workspace-relative path is required.
2. The grant keeps enforcing the authorized scope on the *normalized* path. This ADR does not widen
   any authorization: it only removes an argument-format trap and makes the failure message
   actionable.

## Consequences

- A model that echoes the absolute path no longer blocks the plan.
- Escapes are still rejected, with an error the Agent can correct instead of a dead task.
- The distinction "policy denial" vs "bad argument" becomes explicit in the audit trail.

## Tests

`tests/p288-write-path.test.ts`: relative path, `./` prefix, absolute-in-workspace normalization,
absolute-outside rejection, `../` rejection, empty path.
