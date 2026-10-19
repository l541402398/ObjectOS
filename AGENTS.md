# ProjectOS AI Development Rules

ProjectOS is a local-first, AI-native project lifecycle workspace. The implementation baseline is
`ProjectOS_AI开发实施设计说明书_v1.1.md`; approved ADRs live in `docs/adr/`.

## Before changing code

1. Read the design document, relevant ADRs, and the task being implemented.
2. Read the actual files before editing. Do not guess APIs or test outcomes.
3. Implement only the assigned task and its required dependencies.
4. If a change affects data migration, security, or a core contract, write an ADR first.

## Architectural invariants

- Renderer must never access Node.js, SQLite, the filesystem, or a shell directly.
  It uses only the named, typed preload API.
- The Electron Main process owns windows, IPC, secrets, and the Runtime supervisor.
- The Node Runtime child process is the **single writer** to the business SQLite database.
- Domain and Application code must not import Electron, Drizzle, or model SDKs.
- All process and trust boundaries validate with Zod.
- Chat history is never the source of truth. Tasks, sessions, runs, tool calls, approvals, inbox
  messages, handoffs, and artifacts are persisted.
- File writes, process execution, Git writes, and deploys require policy evaluation and human
  approval. Every side effect is recorded as a ToolCall before and after execution.
- Never blindly retry unknown external side effects after a crash. Mark the run
  `needs_reconciliation` and ask a human.
- Task dependencies must be acyclic. A task has at most one valid write lease, and fencing tokens
  are monotonic.
- AI connection metadata lives in SQLite; API keys live only in the Main `ConnectionSecretStore`
  (safeStorage). Never return a key to Renderer, write it to SQLite/project files, or log it.
- The active connection is the default connection synced to ProviderManager; do not invent a second
  parallel Agent runtime without an ADR.
- Connection tests must distinguish configuration, reachability and real inference; `/models`
  success is not proof that inference works.
- Settings is a global modal, not a route page. Collapsed sidebar and narrow-window layouts must
  share the same compact rules. Connection editing is an inline settings sub-view, never a nested modal.
- V1.3 graph is a projection of SQLite tasks/dependencies/agents/runs. Never let canvas layout or
  client state become the source of truth for dependencies or scheduling.
- Plan approval creates tasks and dependencies in one transaction; do not leave a half-created DAG.
- Plan generation marked `local-rules` must not be presented as model-generated.
- Renderer console/network access is restricted by CSP. The app does not listen on a TCP port.
- UI quality is an acceptance criterion. Use the design tokens in `packages/design-tokens` and the
  components in `packages/ui` / `packages/ai-ui`; do not scatter one-off colors or glass styles.

## Packages and dependency direction

Read `docs/architecture.md` and run `pnpm lint` after changing dependencies. The boundary checker
enforces the allowed `@projectos/*` imports and forbids renderer access to Node/Electron/persistence.

## Completion definition

Before marking work done, run the real commands and report actual results:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node scripts/e2e.mjs          # desktop create + restart recovery
node scripts/agent-e2e.mjs    # real approval pause + tool execution loop
node scripts/v12-e2e.mjs      # settings modal + AI connections + native run
node scripts/v13-e2e.mjs      # scan + plan DAG + real graph + saved layout
pnpm test:package             # packaged EXE smoke (after package:dir)
```

A task is not complete if a test was not run and that fact is hidden. UI tasks also need the
screenshots and visual checks in `docs/design-system.md`.
