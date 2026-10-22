# ProjectOS AI Development Rules

ProjectOS is a local-first, AI-native project lifecycle workspace. The implementation baseline is
`ProjectOS_AI开发实施设计说明书_v1.1.md`; approved ADRs live in `docs/adr/`.

## Required UI source of truth

Before changing any ProjectOS renderer UI, read `docs/design/PROJECTOS_UI_CONTRACT.md`, `docs/design/DESIGN.md` (tokens and materials), `docs/design/DESIGN_CHANGELOG.md`, the current Design Lab implementation and `docs/design/baselines/` images. The selected product aesthetic is the approved Premium Liquid Glass Design Lab, not an invitation to restyle it freely. Preserve its semantic components, tokens and motion system.

Apply all five outstanding Design Lab fixes in `PROJECTOS_UI_CONTRACT.md` before major page migration. Any deviation requires a documented rationale and new screenshots. Do not create filler or explanatory text. Do not change backend behavior during design migration.

For every UI task: (1) inspect relevant source/tokens, (2) check design contract and loaded skills, (3) implement, (4) run visual/a11y/function tests, (5) produce comparison screenshots and report unverified items. Green unit tests never imply visual acceptance. The executing DSH harness loads this root `AGENTS.md`; configured skills are listed by the runtime and must be loaded with the skill tool when applicable.

### Mandatory UI design/implementation sources

Every agent doing design or renderer UI must **actually consult and, where exposed as a skill, load with the `skill` tool**:

| Source | Required use |
|---|---|
| **UI UX Pro Max** skill | load `ui-ux-pro-max`; query typography, color, layout, accessibility and motion guidance. Reject database results that conflict with the frozen Premium Liquid Glass direction, with a documented reason. |
| **Vercel Agent Skills** | load `vercel-composition-patterns` and `vercel-react-best-practices`; use composition and React performance rules. |
| **Impeccable** skill | load `impeccable`; run context/audit/detect where available. Do not invent PRODUCT.md context. |
| **Sim Studio** (`simstudioai/sim`) | inspect the actual workflow editor/canvas/menu source before changing graph composition; study, do not copy brand assets. Apache-2.0. |
| **Liquid Glass React** (`rdev/liquid-glass-react`) | inspect the installed package and test its actual Electron effect before using it; record compatibility and performance evidence. MIT. |
| **React Bits** (`DavidHDev/react-bits`) | inspect the selected effect source (currently Aurora); preserve attribution and license (MIT + Commons Clause). |
| **Motion** (`motion.dev`) | use Motion for React for choreography; honor reduced-motion and interruptibility. |

Do not claim a source was used without a file, command, screenshot, or test that
proves it. Record results in `docs/design/DESIGN_CHANGELOG.md`; unavailable
sources/features are listed as limitations, not silently skipped.

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
