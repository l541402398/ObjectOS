# Phase 2.8.7 — Real-Provider E2E Harness Inventory (READ-ONLY analysis)

Scope: `scripts/phase2.8.5-autonomy-closure-e2e.mjs` (232 L), `scripts/phase2.8.2-low-intervention-e2e.mjs` (330 L),
`scripts/phase2.8.1-multi-agent-e2e.mjs` (291 L), `scripts/phase2.8.3-diagnostic-closure-e2e.mjs` (232 L),
skim of `scripts/phase2.7-real-provider-e2e.mjs` (220 L).
Authoritative sources: `apps/runtime/src/dispatcher.ts` (case names, 1723 L), `packages/contracts/src/api.ts` (input/output schemas),
`packages/contracts/src/desktop-api.ts` (the `window.projectos` surface), `apps/desktop/src/preload/index.ts` (method → IPC mapping),
`apps/runtime/src/orchestrator.ts` (scheduler), `apps/runtime/src/dispatcher.ts:142-148` (auto-replan callback).

Verdict up front: **all five scripts are SCRIPT_ORCHESTRATED.** Not one of them lets the product decide *whether* to start,
*whether* to re-plan, or *whether* to merge. None is observation-only.

---

## 0. The one structural fact that decides A vs B

Approving a plan does **not** start execution. `plan.approve` → `orchestration.approvePlan` (dispatcher.ts:1550-1553) only
creates Tasks, dependencies and per-agent Sessions in one transaction (orchestration.ts:669-734, `store.transaction`).

The runtime has exactly **two** `scheduler.start` call sites:
- `dispatcher.ts:1635` — inside `case 'orchestration.start'` (script/UI initiated).
- `dispatcher.ts:358` — `startRepair()`, only reachable from `operations.startRepair` / `autoStartRepairs` (health-check repair path).

Therefore: **SCRIPT_ORCHESTRATED begins at `orchestration.start`.** Everything before it (project, agents, plan, approval,
grant) is script scaffolding; everything after it is PRODUCT_AUTONOMOUS and must be proven by observation only.

Product-owned behaviour that needs no script trigger, once started:
- `orchestrator.ts:375-380` — `arm(planId)` → `setInterval(() => void this.tick(planId), 2_500)`: dispatch, retries,
  evidence re-collection, CompletionDecision, worktree creation, terminal status.
- `dispatcher.ts:142-148` — the scheduler is constructed with a replan callback that calls
  `this.replans.propose({ planId, trigger, reason, requestedBy: 'system:scheduler' })`. So a proposal appearing in
  `plan.replan.list` **is** product-generated; a script calling `plan.replan.propose` would not be.
- `dispatcher.ts:150-161` — `AutonomyCoordinator` (mode `autonomous`) advances gates and `nudgeProject`s running plans only;
  it never starts a plan (autonomy-coordinator.ts:112-158).
- `orchestrator.ts:316-333` — `worktree.merge` refuses unless `execution.status === 'completed'` and not already merged.

---

## 1. Per-script tables — every business action the script initiates

`S` = script-initiated (A). `O` = read-only observation (safe for B). `R` = performed by the runtime on its own.

### 1.1 `phase2.8.5-autonomy-closure-e2e.mjs`

| Line | Kind | Invoke | Payload / note |
|---|---|---|---|
| 126 | S | `projects.create` | `{name, description, rootPath, createDirectory:false, initGit:false}` → `.project` |
| 127 | S | `projectAnalysis.scan` | `projectId` (mutates snapshot/index) |
| 128,129,131 | S | `agentDefinitions.upsert` | developer / tester / architect; `permissions:{tools:[],files:true,shell:true,network:false}`, `modelRef:null` |
| 133 | S | `plans.generate` | `(projectId, goal, {mode:'ai', allowRuleFallback:false, maxTasks:2})` |
| 139-141 | S | `plans.get` + `plans.update` | reads plan, rewrites every `task.agentId` (`assignmentMode` left `auto`) |
| 144 | S | `plans.approve` | `planId` → `{plan, taskIds}` |
| 149 | O | `tasks.board` | `projectId` — used to find the tester Task and its `version` |
| 153 | S | `tasks.update` | `{taskId, expectedVersion, workType:'diagnostic'}` (ADR-2.8.3 lever) |
| 158 | S | `plans.grant.issue` | `{planId, actions:['plan.start','workspace-write'], allowedPaths:['src','tests'], maxRuns:6, maxToolCalls:120, ttlHours:3, allowOverBudget:false, note, confirm:true}` |
| **160** | **S** | **`orchestration.start`** | `(planId, 2, 1, false, grantId, crypto.randomUUID())` — positionally `{planId, concurrency:2, maxRetries:1, allowOverBudget:false, grantId, startRequestId}` |
| 79 (×163,190) | S | `approvals.decide` | `{approvalId, decision:'approved', note:'Phase 2.8.3 范围内授权'}` — emitted from inside the *wait loop* |
| 178 | S | `plans.replan.apply` | `proposalId` — human decision on a product-generated proposal |
| 180-183 | S | `plans.get` + `plans.update` | re-assign revision tasks by role regex |
| 184 | S | `plans.approve` | revision approval |
| 186 | S | `plans.grant.issue` | fresh grant for the revision |
| 188 | S | `orchestration.start` | revision start, new `startRequestId` |
| 200 | S | `worktrees.merge` | `planId` — merges branch into project root (real git write) |
| 171,164,191 | O | `plans.replan.list`, `plans.get` | the only genuine observation in this script |
| 162-167,189-194 | R | scheduler tick + auto replan | prove by `orchestrator.ts:377` and `dispatcher.ts:142-148`, not by script code |

### 1.2 `phase2.8.2-low-intervention-e2e.mjs`

| Line | Kind | Invoke | Payload / note |
|---|---|---|---|
| 156 | S | `projects.create` | same shape as above, `name: P282 A/B` |
| 157 | S | `projectAnalysis.scan` | `projectId` |
| 98 | S | `agentDefinitions.upsert` | via `createAgent(projectId, name, role, systemPrompt)` (L97-104) |
| 164 | S | `plans.generate` | `(projectId, goal, {mode:'ai', allowRuleFallback:false, maxTasks:2})` |
| 169-172 | S | `plans.get` + `plans.update` | agent re-assignment |
| 173 | S | `plans.approve` | `human.planApprovals++` |
| 175-179 | S | `plans.grant.issue` | `{..., maxRuns:4, maxToolCalls:80, ttlHours:2, confirm:true}` |
| 183 | S | `orchestration.start` | `(planId, 2, 1, false, grantId, crypto.randomUUID())` |
| 90 (×185,266,291) | S | `approvals.decide` | inside `approvePending` (L76-95), called from the wait loop |
| 244 | S | `plans.generate` (scenario B) | steered goal: "第一步…只新增 src/labels.mjs…第二步…报告失败" |
| 252-255 | S | `plans.get` + `plans.update` | B agent assignment |
| 256 | S | `plans.approve` | B |
| 258-261 | S | `plans.grant.issue` | B |
| 264 | S | `orchestration.start` | B |
| 276 | S | `plans.replan.apply` | B — applies the product's proposal |
| 278-281 | S | `plans.get` + `plans.update` | revision agent re-assignment |
| 282 | S | `plans.approve` | revision |
| 284-287 | S | `plans.grant.issue` | revision |
| 289 | S | `orchestration.start` | revision |
| 235,273,186,267,292,194,77 | O | `runs.list`, `plans.replan.list`, `plans.get`, `approvals.list` | observation |

Note: 2.8.2 never calls `worktrees.merge`; the "修复后同一测试真实通过" claim is measured by running `npm test` **itself**
(L298, `execFileSync('npm',['test'],{cwd:wtB})`) inside the worktree — script-side verification, not product evidence.

### 1.3 `phase2.8.1-multi-agent-e2e.mjs`

| Line | Kind | Invoke | Payload / note |
|---|---|---|---|
| 149 | S | `projects.create` | per scenario A/B (`bootstrap`, L141-154) |
| 150 | S | `projectAnalysis.scan` | `projectId` |
| 91-96 | S | `agentDefinitions.upsert` | `createAgent()`; two agents |
| 158 | S | `plans.generate` | `(projectId, goal, {mode:'ai', allowRuleFallback:false, maxTasks:2})` |
| 164-167 | S | `plans.get` + `plans.update` | downstream task → tester |
| 172 | S | `plans.approve` | |
| 173-177 | S | `plans.grant.issue` | `{maxRuns:4, maxToolCalls:60, ttlHours:2, allowedPaths, confirm:true}` |
| 182 | S | `orchestration.start` | `(planId, 2, 1, false, grantId, crypto.randomUUID())` |
| 83 (×185) | S | `approvals.decide` | inside `approveLowRisk` (L72-88), called from the wait loop |
| 255 | S | `worktrees.merge` | scenario B merge |
| 223,229,261,186,73 | O | `runs.list`, `approvals.list`, `plans.replan.list`, `plans.get` | observation |
| 242,251,259 | — | host-side `npm test` | script verifies the fixture itself, outside the product |

### 1.4 `phase2.8.3-diagnostic-closure-e2e.mjs`

Structurally identical to 2.8.5 (2.8.5's header still reads "Phase 2.8.3"; 2.8.3 is the single-scenario precursor).
Own line numbers:

| Line | Kind | Invoke |
|---|---|---|
| 126 | S | `projects.create` |
| 127 | S | `projectAnalysis.scan` |
| 128,129,131 | S | `agentDefinitions.upsert` (dev/qa/architect) |
| 133 | S | `plans.generate` |
| 139-142 | S | `plans.get` + `plans.update` |
| 144 | S | `plans.approve` |
| 149 | O | `tasks.board` |
| 153 | S | `tasks.update` `{taskId, expectedVersion, workType:'diagnostic'}` |
| 158 | S | `plans.grant.issue` |
| 160 | S | `orchestration.start` |
| 79 (×163,190) | S | `approvals.decide` |
| 178 | S | `plans.replan.apply` |
| 180-183,184,186,188 | S | `plans.get`+`plans.update`, `plans.approve`, `plans.grant.issue`, `orchestration.start` |
| 200 | S | `worktrees.merge` |
| 164,171,191 | O | `plans.get`, `plans.replan.list` |

### 1.5 `phase2.7-real-provider-e2e.mjs` (skim)

| Line | Kind | Invoke | Note |
|---|---|---|---|
| 80 | O | `projects.list` | picks `projects[0]` from seeded demo |
| 89 | O | `agents.list` | |
| 97 | S | `sessions.create` | `{projectId, agentId, title}` |
| 99-103 | S | `tasks.create` | full `CreateTaskInput` incl. `dependsOn:[]`, `versionId:null` |
| 121-123 | S | `runs.start` | `{projectId, sessionId, taskId, prompt}` — the script authors the prompt |
| 131,196 | O | `actions.center` | `item.kind === 'tool_approval' && item.runId === runId` |
| 133,176 | O | `runs.list` | terminal poll `['completed','failed','cancelled']` |
| 152,167 | S | real DOM click | `.ac-row` then `.ap-actions button` **`.last()`** = 批准 |

This is the only script that approves through real UI DOM; it still starts the run and writes the prompt itself.

---

## 2. Harness mechanism (identical across the four 2.8.x scripts)

**Process.** `import { _electron as electron } from 'playwright-core'` (no test runner, plain `node script.mjs`).
Launch: `electron.launch({ executablePath: resolve(root,'node_modules/electron/dist/electron.exe'), args:['.'], cwd: resolve(root,'apps/desktop'), env, timeout: 60_000 })` (2.8.5:85). `cwd` **must** be `apps/desktop`; `root = process.cwd()`
must be the repo root. `phase2.6`/`2.7` use `timeout: 30_000/40_000`. `r2b32-real-closure.mjs:44` additionally passes
`--user-data-dir=<tmp>` and copies `%APPDATA%\ProjectOS\Local State` (2.8.x does not).

**Page.** `page = await app.firstWindow()`; console/`pageerror` captured into `errors[]`; readiness gate is
`await page.waitForSelector('.po-shell', { timeout: 60_000 })` then a fixed `await page.waitForTimeout(3000)`.

**Reaching the API.** Never `ipcRenderer` directly. `page.evaluate(async (...) => window.projectos.<group>.<fn>(...args))`.
The bridge is `contextBridge.exposeInMainWorld('projectos', api)` (preload/index.ts:365); each method is a positional-argument
wrapper over `call('<method>', input)` → `ipcRenderer.invoke('projectos:request', method, input)` (preload/index.ts:30-39),
mapped in Main `ipc.ts:682` and dispatched by `dispatcher.ts` `case '<method>'`. So `window.projectos.plans.replan.list(projectId, null)`
⇒ method `plan.replan.list`, input `{projectId, planId:null}`. Errors surface as `DesktopApiError{code, details}`;
scripts rely on rejection (`try/catch` at 2.8.1:254-258, 2.8.5:199-205).

**Real DeepSeek provider.** No in-process config: the script copies the machine's real files into the scratch dir —
`for (const file of ['provider.json','ai-secrets.vault.json']) copyFileSync(join(process.env.APPDATA,'ProjectOS','data',file), join(dataDir,file))`
(2.8.5:22-29), then **deletes `connectionsMigrated`** and rewrites the JSON (2.8.5:30-35) so the app re-runs its legacy→connection
migration and installs the DPAPI-decrypted key into the runtime vault. `provider.json` shape (`apps/desktop/src/main/provider-config.ts:14-20`):
`{ baseUrl: string, model: string, temperature: number, encryptedApiKey?: base64(safeStorage-encrypted), connectionsMigrated?: boolean }`.
`encryptedApiKey` is DPAPI-bound to the Windows user, which is why the same machine/user must run the test.
Proof of readiness is `window.projectos.aiConnections.list()` returning ≥1 row (2.8.5:94-96); model id is printed, not asserted.
Runtime-side env alternative (unused here): `PROJECTOS_PROVIDER_JSON` parsed by `ProviderRuntimeConfigSchema` (apps/runtime/src/config.ts:33-42).

**Scratch workspace.** `dataDir = process.env.PROJECTOS_E2E_DATA_DIR || mkdtempSync(join(tmpdir(),'projectos-p28x-'))` (2.8.5:19);
workspace is `join(dataDir,'ws-b')` (2.8.5:99), written by hand (`package.json` with `test: node --test tests/*.test.mjs`,
`src/*`, `tests/*`), then `git init -q` + `config user.email/user.name` + `add -A` + `commit -qm fixture` via
`execFileSync('git', args, {cwd, encoding:'utf8'})` (2.8.5:121-122). Baseline failure is measured by the script itself
(`npmTest(workspace)` → `execFileSync('npm',['test'],{shell:true})` catching `error.status`, 2.8.5:67,123).

**Env.** `{...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH:'1440', PROJECTOS_WINDOW_HEIGHT:'900'}` and
`delete env.ELECTRON_RUN_AS_NODE` (mandatory — otherwise Electron runs as Node). `PROJECTOS_SEED_DEMO:'1'` only in 2.7/2.6.
Runtime reads `PROJECTOS_DATA_DIR`, optional `PROJECTOS_DB_PATH` (default `<dataDir>/projectos.db`), `PROJECTOS_SEED_DEMO`.

**Helpers.** `record(name, status, detail)` / `record(scenario, name, status, detail)` push `{name|scenario,status,detail}` and log
`[STATUS] name — detail`. `waitFor(label, fn, {timeoutMs, intervalMs})` polls `fn()` which returns `{done, value, hint}`;
returns `{ok, value, hint}` on timeout (never throws); logs every 15th (2.8.5/2.8.3) or 10th (2.8.1/2.8.2) tick.
Defaults: 900_000 ms / 2000 ms (2.8.5, 2.8.2, 2.8.3), 600_000 ms / 2000 ms (2.8.1); replan-proposal poll 180_000 ms / 3000 ms
(2.8.5:170-173). `sleep(ms)` for the poll; `approvePending`/`approveLowRisk` are the approval pumps; `createAgent`, `bootstrap`,
`planApproveGrantStart`, `runMultiAgent` are the scenario builders; `git`/`npmTest` are host-side.

---

## 3. PASS/FAIL/SKIP recording and evidence

- Status vocabulary: `PASS`, `FAIL`, `BLOCKED` (missing `provider.json` → 2.8.5:93, 2.8.2:216, 2.8.3:93, 2.8.1:205), `INFO`
  (2.8.1:237,262; 2.8.2 has INFO in the summary but never records it). **`SKIP` is counted in phase2.6's summary line
  (2.6:169) but never recorded** — and is unused in all four 2.8.x scripts.
- `summarise()` prints a `===== PHASE … =====` block, one `STATUS\t[scenario] name :: detail` line each, then
  `PASS=n FAIL=n BLOCKED=n` (plus `INFO=` in 2.8.1), the 人工介入 counters (2.8.2:314-317, 2.8.5:219, 2.8.3:219) and `dataDir=`.
- Exit code: `if (failed.length) process.exitCode = 1` (2.8.5:222, 2.8.2:320, 2.8.3:222, 2.8.1:279). Fatal errors are caught and
  pushed as a `fatal` FAIL entry, then summarised (2.8.5:226-231). `app?.close()` in `.finally`.
- Evidence files: **only screenshots.** `docs/screenshots/` (`mkdirSync` at boot) —
  `p281-01-work-center.png` (2.8.1:268), `p282-01-work-center.png` (2.8.2:306), `p283-01-work-center.png` (2.8.3:211 **and** 2.8.5:211 → same filename, they overwrite each other),
  `p27-01/02/03-*.png` (2.7:155,164,201). Each preceded by `location.hash = '#/projects/<id>/work'` + `waitForTimeout(1200-1500)`.
- Scratch data persists at the printed `dataDir` (`%TEMP%\projectos-p28x-*`) with `projectos.db`, `logs/`, `provider.json`.
- No script writes JSON/Markdown evidence. The only exception in the repo: `r2b32-real-closure.mjs:169` writes
  `docs/screenshots/closure.json` (and `closure-failure.json`), and `test-results/r2b3/` is used instead of `docs/screenshots`.
  `docs/v2/evidence/` did not exist before this file.

---

## 4. Pitfalls visible in the code

1. **Script plays the human, inside the wait loop.** `approvePending`/`approveLowRisk` (2.8.5:69-82, 2.8.3:69-82, 2.8.2:76-95,
   2.8.1:72-88) calls `approvals.decide` for every pending approval matching a tool/path/command regex, from *inside* the
   status poll (2.8.5:163,190; 2.8.2:185,266,291; 2.8.1:185). Consequence: "the product ran to completion" really means
   "the script approved everything the product asked". Any low-intervention claim is unverifiable by construction.
2. **Uncounted human steps.** `human.manualMerges` is never incremented although `worktrees.merge` is script-invoked
   (2.8.5:200, 2.8.1:255); `plans.update` re-assignment (2.8.5:141,182; 2.8.2:172,255,281; 2.8.1:167) is a human edit of the
   product's plan and is not in the counter either. `human` is therefore a lower bound written by the script itself.
3. **Tautological / permissive assertions.** 2.8.5:169 and 2.8.3:169 assert `firstStatus !== undefined`, which is true after
   any `orchestration.start`; the terminal set includes `'paused'` (2.8.5:166,193; 2.8.3:166,193), so a plan that stalled
   waiting for a human still satisfies "reached terminal" and the script proceeds to apply a replan.
   2.8.2:182 records unconditional `'PASS'` for "one approval + one grant".
4. **Fixed sleeps as readiness gates.** `waitForTimeout(3000)` after `.po-shell` (all four), plus 1200-1500 ms before
   screenshots (2.8.5:210, 2.8.2:305, 2.8.1:267) and 800-2500 ms around UI clicks in 2.7. Nothing waits for the runtime to
   report ready; a slow boot is absorbed silently or fails later as a timeout.
5. **UI selector assumptions.** `.po-shell` (ready gate), and in 2.7 `.po-work-center`, `[data-testid="action-center-button"]`,
   `.ac-panel`, `.ac-row`, `.ap-diff|.ap-list`, and `.ap-actions button` **`.last()`** (2.7:167) to mean 批准 — a positional
   selector, not a label. 2.6 relies on `.ac-head .ant-select` and `.v16-project-visual`. Any layout change breaks these
   without a schema error to fall back on.
6. **Idempotency key defeated.** `crypto.randomUUID()` is evaluated inside the renderer at every start
   (2.8.5:160,188; 2.8.2:183,264,289; 2.8.1:182), so the grant start-reservation dedupe path
   (`dispatcher.ts:1608-1633`) is never exercised; a retried start always looks new.
7. **Steered plans.** Goals pre-decide the DAG ("第一个任务只做…第二个任务…", 2.8.5:132; 2.8.2:246) with `maxTasks:2` and
   `allowRuleFallback:false`. Planner autonomy is bounded by the prompt, so `generatedBy === 'provider'` proves *a model
   answered*, not that the product derived the work.
8. **Provider proof is thin.** Only `connections.length > 0` (2.8.5:95) and `draft.generatedBy === 'provider'` (2.8.5:134);
   `generation.model` is printed but never asserted, and no `provider.test` / inference probe is done.
9. **Evidence filename collision.** 2.8.3 and 2.8.5 both write `docs/screenshots/p283-01-work-center.png`; the later run
   silently replaces the earlier artefact.
10. **No observation of the product's own ask.** Nothing reads `action.center` in the 2.8.x suite while waiting (only 2.7 and
    2.6 do), so "how many decisions did the product request" is never measured independently of the script's own pump.

---

## 5. Read-only observation APIs (exact shapes) — for the B side of the new E2E

All are exposed on `window.projectos` and are pure reads (no business mutation). Positional args are shown as the preload
signature; the right column is the wire input object.

| Preload call | Wire input | Returns (key fields) |
|---|---|---|
| `plans.get(planId)` | `{planId}` | `PlanDraft`: `status`, `revision`, `tasks[]`, `generatedBy`, `generation{model,attempts,…}`, `execution{status,concurrency,error,runIds[],workspaceRef,branch,allowedPaths,diffArtifactId,mergedAt,retries,evidenceRetries,budgetExhausted}` or `execution:null` |
| `plans.list(projectId)` | `{projectId}` | `{plans: PlanDraft[]}` (all revisions; `execution===null` proves not started) |
| `plans.replan.list(projectId, planId?)` | `{projectId, planId:null}` | `{proposals: ReplanProposalView[]}` — `trigger`, `status`, `reason`, `diff`, `grantImpact`, `generation` |
| `plans.replan.get(proposalId)` | `{proposalId}` | `ReplanProposalView` |
| `plans.grant.get(planId)` | `{planId}` | `PlanExecutionGrantView \| null` (`null` proves no authorization) |
| `tasks.board(projectId)` | `{projectId}` | `{projectId, tasks: TaskCard[], columns:[{status, taskIds[]}]}`; TaskCard carries `status`, `version`, `assigneeAgentId`, `workType`, `dependsOn`, `latestRunStatus` |
| `tasks.detail(taskId)` | `{taskId}` | `{task, dependencies[], dependents[], attempts[], runs[], artifacts[], approvals[]}` |
| `tasks.acceptancePolicy(taskId)` | `{taskId}` | `HumanAcceptancePolicy` (read-only policy probe) |
| `runs.list(projectId, limit=50)` | `{projectId, limit}` (1-200) | `{runs: RunSummary[]}` — `id, status, agentId, agentName, taskTitle, sessionTitle, pendingApprovals, error, …` |
| `runs.get(runId)` | `{runId}` | `RunDetail` (tool calls, messages, usage) |
| `approvals.list({projectId, runId})` | `{projectId, runId:null}` | `{approvals: ApprovalView[]}` — `id, status, request{toolName,args}, runId, taskId` |
| `actions.center(projectId)` | `{projectId}` | `{items: ActionItem[], summary{total,needsHuman,byKind,mode,autoAdvancedPhases}}`; item = `{id,kind,title,reason,requiredDecision,resume,risk,route,approvalId,runId,taskId,stale}` |
| `actions.autonomy(projectId)` | `{projectId}` | `{mode:'assist'|'autonomous'|'managed', autoAdvancePhases[]}` |
| `worktrees.info(planId)` | `{planId}` | `{planId, available, branch, workspaceRef, status, diff, files[{path,status,sensitive,allowed}], mergedAt}` |
| `collaboration.snapshot(projectId)` | `{projectId}` | `{agents[], sessions[], inbox[], handoffs[], deliveryStats}` |
| `events.list({projectId, limit, offset, sinceSeq?})` | `{projectId, limit:100, offset:0, sinceSeq?}` (1-500) | `{events: ProjectEventView[]}` — append-only audit trail incl. `planGrantStarted`, replan events |
| `projects.activity({projectId, limit})` | `{projectId, limit:50}` (1-200) | `{events: ProjectEventView[]}` |
| `graph.snapshot(projectId)` | `{projectId}` | `{nodes[], edges[], positions, revision, lastEventSeq}` |
| `projectAnalysis.snapshot(projectId)` / `.metrics` / `.budget(projectId)` | `{projectId}` | scan snapshot / metrics / `ProjectBudgetStatus` (spent vs soft limit) |
| `lifecycle.gateOverview(projectId, subjectType, subjectId)` | `{projectId, subjectType:'task'|'version'|…, subjectId}` | gate status + missing evidence |
| `workspace.snapshot(projectId)` / `workspace.gitDiff(projectId, path?)` | `{projectId}` / `{projectId, path?}` | file tree / `{patch, truncated}` — read-only host check |
| `project.qualityPolicy.get` via `projectAnalysis.qualityPolicy(projectId)` | `{projectId}` | `{required[], optional[]}` |

Not reachable from the renderer (dispatcher-only, no `window.projectos` method): `action.coordination.history`
(`{projectId, limit≤100}` → `{events[{id,kind,trigger,status,detail,attempts,createdAt}]}`),
`runtime.health`, `runtime.ai.credentials`. Do not plan a B-side assertion on them without adding a preload method.

**Safe B-side recipe.** After one `orchestration.start` (the single A-side act), poll only
`plans.get(planId).execution.status`, `tasks.board(projectId)`, `runs.list(projectId, 200)`,
`plans.replan.list(projectId)`, `actions.center(projectId)`, `approvals.list({projectId, runId:null})` and
`events.list({projectId, limit:200, sinceSeq})`. Any `approvals.decide`, `plans.update`, `plans.approve`,
`plans.replan.apply`, `orchestration.*` or `worktrees.merge` call after that point reclassifies the run as SCRIPT_ORCHESTRATED.
Note `plans.replan.apply` is a **human** decision by design (the product only proposes) — a true B-side test must either
assert the proposal is waiting for a human, or count the apply as the one permitted human decision.

---

## 6. Answer to "does any script already poll status without business actions?"

Partially, and never for a whole scenario:
- 2.8.5:170-173 / 2.8.3:170-173 — a clean 180 s observation-only poll of `plans.replan.list` (the single best precedent
  for B-side observation; it proves the product proposed a revision with no script trigger).
- 2.8.1:223-238, 2.8.2:235-238 — pure `runs.list` / `approvals.list` post-hoc reads.
- 2.7:128-140, 173-182 and 2.6:108-118 — pure `actions.center` / `runs.list` polls around a *script-started* run.
- Every `waitFor` that also calls `approvePending` (2.8.5:162-167,189-194; 2.8.2:184-190,265-270,290-295;
  2.8.1:184-189; 2.8.3:162-167,189-194) is mixed observation + mutation and cannot be reused for a B-side proof as-is.
