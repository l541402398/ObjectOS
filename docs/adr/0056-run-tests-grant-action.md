# ADR-0056 — `run-tests` grant action (bounded process authorization)

- Status: Accepted (Phase 2.9-P0)
- Related: ADR-0026 (policy envelope), ADR-0032 (read-only families), ADR-0041 (granted actions)

## Context

A plan grant carried only `plan.start` and `workspace-write`. Process execution was never covered, so a
real agent run asked the user to approve every command: `node --version`, three different `node -p`
checks, `node --test test/hello.test.js`, … The exact-command reuse added earlier only helps when the
*same* command repeats, which an agent never does. The user's report: "怎么现在一直让我审批啊，你刚运行
测试，我不点就不继续执行".

## Decision

1. New grant action `run-tests`, chosen explicitly in the grant panel (default on) and in the one-click
   approve+grant dialog.
2. It authorizes **only** an allowlist: `node --test`, `node --version`, `npm/pnpm/yarn test[:script]`,
   `(npx) vitest run`, `(npx) jest`, `pytest`, `go test`, `cargo test`, and read-only
   `git status|diff|log|rev-parse|ls-files`.
3. Any shell composition (`&&`, `;`, `|`, `$()`, redirection), any other program, `node -e/-p`, package
   installs, git writes, deploys and external runtimes still require a per-call human decision.
4. The grant action survives persistence: `rows.ts` no longer drops unknown actions; it keeps exactly
   the three schema values.
5. The grant issue schema accepts up to three actions.

## Verification

`tests/p29-run-tests-grant.test.ts` (3 tests): allowlist classification includes `npm run test:unit`,
rejects `node -e`, `rm -rf .`, `curl`, `git commit`, `node --test && rm -rf .`, pipes and `cat`; an allow
decision with the action, a per-call approval without it, and `rm -rf .` still requires approval.
