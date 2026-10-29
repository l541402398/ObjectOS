# ADR-0032 — Read-only inspection approvals are scoped, not repeated per command

- Status: Accepted (Phase 2.8.8)
- Related: ADR-0026 (grant envelope), ADR-0030 (delivery)

## Context

A real product-autonomous run required **33 tool approvals**, most of them read-only inspection
(`git status`, `git diff`, `grep`, `node --check`). Process execution is deliberately not covered by a
PlanGrant, and the existing reuse only matched the *exact* command string — so every new look-only
command asked the user again. Phase 2.8.7 "solved" this in the E2E by widening the script's
allow-list, which improves the number without improving the product.

## Decision

A strictly read-only command is mapped to a **family** (`git-status`, `git-diff`, `grep`,
`node-check`, …). Once any command of that family has been approved inside a plan, another command of
the same family may reuse that decision while the plan grant is alive, and each reuse is recorded as a
`plan.grant.consumed` event with `readOnlyFamily` and the source approval id.

A command is only eligible when it is unambiguously read-only:

- it matches a fixed family pattern (`git status|diff|log|show|rev-parse|ls-files|ls-tree|grep|blame|hash-object|cat-file|merge-base`, `grep|rg`, `ls|dir|find`, `cat|head|tail|wc`, `node --check`, version queries);
- it contains **no** chaining, redirection, substitution or newline (`; & | > < \` $`), because those turn a read into a write or an execution;
- the approval was decided inside this plan (matched through `agent_runs.task_id ∈ plan.createdTaskIds`) and is not older than the grant expiry.

Everything else keeps its own approval: `node -e`, `npm test`, any command with side effects, any
network access, and all Git writes. The grant itself still never authorizes process execution, and a
write can still not be smuggled through a read-only family.

## Consequences

- Repeated look-only inspection no longer interrupts the user; the audit trail still names the exact
  approval that was reused and the family it belonged to.
- Safety is preserved by construction: the eligible set is a closed list, and chaining/redirection is
  rejected even inside a known family.
- Model behaviour still matters: a model that writes files through `node -e` will keep asking for
  approvals, which is why the run prompt now steers writes to `write_file` (grant-covered inside the
  authorized paths).

## Tests

`tests/p288-readonly-approvals.test.ts`: family mapping for inspection commands, and refusal for
`node -e` writes, `npm test`, chaining (`&&`, `;`), redirection (`>`), substitution (`$()`), Git
writes and network commands.
