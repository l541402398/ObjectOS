# ADR-0036 — Canonical workspace paths before containment checks

- Status: Accepted (Phase 2.8.8)
- Related: ADR-0026 (grant scope), ADR-0035 (write path form)

## Context

Across every Phase 2.8.8 real run, `write_file` was denied inside the plan's own worktree:

```
write_file "src/sums.notes.mjs" → denied
reason: 路径 ../../../../../../../../Administrator/AppData/Local/Temp/…/worktrees/prj_…/src/sums.notes.mjs
        不在计划授权路径范围内
```

The workspace root arrives as a **Windows 8.3 short path** (`C:\Users\ADMINI~1\AppData\Local\Temp\…`),
while `path.resolve()` expands the same location to its long form
(`C:\Users\Administrator\AppData\…`). `path.relative(shortRoot, longTarget)` therefore produced
`..\..\..\Administrator\…`, and every legitimate workspace-relative write looked like an escape.

That is why the agent could never fix the code with the safe tool: it either gave up, or wrote files
through approved `node -e` shell commands. The grant was not wrong — its inputs were two different
spellings of the same directory.

## Decision

1. `canonicalWorkspaceRoot()` resolves the root through `realpath` (`realpathSync.native`, then
   `realpathSync`, then the plain absolute path) and is used on **both** sides of every containment
   comparison:
   - `resolveGrantTarget` (grant write authorization),
   - `normalizeWorkspaceWritePath` (tool argument normalization, ADR-0035).
2. The authorized scope is still the project-relative path: canonicalizing changes only how the same
   location is spelled, never which locations are allowed.
3. If the target does not exist yet (a new file), the resolved (non-canonical) path is used for the
   relative computation after the root has been canonicalized, which is sufficient because the root
   is the only side that can carry the short-name form.

## Consequences

- Workspace-relative writes are authorized in the plan's own worktree on Windows, whatever spelling
  the runtime received for the root.
- Escapes are still rejected: an absolute path outside the canonical root and any `..` segment still
  fail, now with the retryable error from ADR-0035.
- The bug was invisible on Linux/macOS and on Windows when the temp path had no short-name form,
  which is why earlier phases never hit it.

## Tests

`tests/p288-canonical-root.test.ts`: canonical root of a temp directory, and a grant write through a
root variant with a trailing separator that must still be authorized.
