# Phase 2.8.7 — Forensics: the ~900 s `plan execution = running` in the Phase 2.8.5 real-provider E2E

READ-ONLY analysis. No existing DB, worktree, branch or source file was modified. Every DB was copied
(`projectos.db` + `-wal` + `-shm`) to `%TEMP%\p287-forensics\<run>\` and only the copies were queried, with
`C:\Users\Administrator\miniconda3\python.exe` + `sqlite3`. Application logs were read in place (read-only).

**Verdict up front.** The plan did not "hang while working" and it did not exceed any budget. It sat in
`execution.status = "running"` because **one `run_command` tool call was parked in `waiting_approval` and its
approval request was never decided** (`approvals.status` still `pending`, `decided_at` NULL, no
`approval.decided` event). In the Phase 2.8.5 run the last state-changing write is `07:31:16.263`; the runtime
stayed alive until `07:45:26.517` = **895 s of `running`, of which 850 s were pure waiting**. A second,
independent defect keeps it that way: the plan execution row never transitions out of `running` (no timeout,
no failure classification, no reconciliation marker), so the row is stale and unsettleable at teardown.

---

## 1. Candidate DB inventory

Live data dir `C:\Users\Administrator\AppData\Roaming\ProjectOS\data` — **not usable for this question**:
`projectos.db` 999 424 B, mtime **2026-10-26 22:45:29** (older than every P2.8.x run; it is the dev-profile DB).

Real run data lives in `%TEMP%` (19 dirs named `p28x-ui*`, no `projectos-p283-*` dirs exist; `p28x-ui` is the
actual harness naming). Dir mtimes 2026-10-28 01:37 → 07:45. Chosen (3 newest with real-provider plan/run data):

| data dir | DB size | DB mtime | why chosen |
|---|---|---|---|
| `%TEMP%\p285-ui3` | 2 158 592 B (+4 132 392 B WAL) | 2026-10-28 07:45:11 | **P2.8.5 run — the ~900 s case** (`exec=running`, 19 tool calls, real `deepseek-flash`) |
| `%TEMP%\p284-ui` | 1 454 080 B | 2026-10-28 06:39:08 | longest `exec=running` observed (1 085.6 s) |
| `%TEMP%\p282-ui3` | 2 207 744 B | 2026-10-28 04:47:57 | longest non-terminal span overall (901.8 s) but `exec=paused` + replan — used as contrast |

Others were used only for the census in §6 (`p281-ui*`, `p282-ui*`, `p283-ui*`, `p285-ui*`, `p285-ui2`).

## 2. Schema names actually used (no `plans` table exists)

`plan_revisions` (plan HEAD + `plan_json` incl. `execution{}`), `plan_replan_proposals`,
`plan_execution_grants`, `plan_grant_start_reservations`, `plan_command_approvals`, `agent_runs`,
`tool_calls`, `approvals` (not `approval_requests` — that table is empty), `artifacts`, `project_events`,
`autonomy_events` (has `attempts`), `sessions`, `messages`, `ai_usage_records`, `planner_usage_records`,
`run_steps`, `task_attempts`, `tasks`, `task_leases`, `gate_evaluations`, `run_snapshots`, `checkpoints`.
All timestamps are INTEGER epoch-ms (rendered local, `America/Los_Angeles`).

## 3. Primary case — `p285-ui3`, plan rev 2

Plan `pln_01m61epwr0n722t1p1dn9mrejt`, project `prj_01m61ekz09yyw1wrvev6jdfa5s` ("P283 Diagnostic Closure").

| field | value |
|---|---|
| `plan_revisions.status` | `approved` |
| `plan_revisions.created_at / updated_at` | `07:30:30.912` / `07:30:32.328` |
| `execution.status` | **`running`** |
| `execution.startedAt` | `07:30:31.319` (`1793197831319`) |
| `execution.updatedAt` | `07:30:32.328` — never advanced again |
| `execution.maxWallClockMs` / `deadlineAt` | `7 200 000` / `09:30:31.319` (`1793205031319`) |
| `execution.budgetExhausted` | `null` |
| grant `pgr_01m61epx118xez06gasz0zj30t` | max_runs 6 (used 1), max_tool_calls 120 (used 1), expires `10:30:31.201`, **not revoked** |

### 3.1 Timeline (only rows that exist; nothing is interpolated)

| time | object | fact |
|---|---|---|
| 07:30:31.319 | plan rev2 | `execution.status=running`, `startedAt` set |
| 07:30:32.316 | `run_01m61epy3wwz1jfk5veyp2ky64` | started, task `tsk_01m61epwxek470ehr9gy2f934z`, agent `agt_01m61ekza6rhvweht0qf3sh30j`, deadline `08:00:32.316` |
| 07:30:33 → 07:31:13 | 18 tool calls | 15 completed, 3 failed (`不允许管道、重定向或命令串联`), total tool wall time **4.42 s** |
| 07:30:52 / :54 / :59 | 3× `run_command` | failed by policy (pipe/`;` rejected) — retried 3×, ~7 s lost, then abandoned |
| 07:31:16.256 | `tol_01m61er910k7gtwv6q2d2jw6b7` | `run_command` args `git ls-tree --name-only HEAD src` → `status=waiting_approval`, `started_at` NULL |
| 07:31:16.259 | approval `apr_01m61er913jbn3hqxxeh52b87b` | `requested_at`; `status=pending`; `decided_at` NULL; `expires_at` `08:01:16.259` |
| 07:31:16.260 | event seq 148 | `run.status.changed` → `waiting_approval` |
| 07:31:16.263 | event seq 149 | `approval.requested` — **last project_event of this project** |
| 07:31:16.520 | `gate_evaluations` | last gate re-evaluation (114 failed evaluations `07:29:03.972 → 07:31:16.520`) |
| 07:31:16.522 | runtime.log | last `autonomy coordination pass` of the session |
| 07:31:16.522 → 07:44:22.149 | — | **785.6 s with zero log lines, zero events, zero DB writes for this project** |
| 07:44:22.149 | runtime.log | `runtime request rejected` `code=CONFLICT`, `method=approval.decide`, `任务租约已失效，旧执行者不能继续提交任务状态` |
| 07:44:32.568 | runtime.log | `CONFLICT` / `version.transition` / `版本门禁未通过：缺少 test_report（需要 passed/source_observed）` |
| 07:45:26.517 | runtime.log | last line (`agent run finished` of the **demo** project run); process ends |
| 07:45:26.517 | — | plan row still `execution.status=running` in the DB (verified on the copy) |

### 3.2 The blocking object

`approval apr_01m61er913jbn3hqxxeh52b87b` — `title="授权 run_command"`, `detail="Agent 请求执行命令：\n\ngit ls-tree --name-only HEAD src"`,
`request_json.grantReason="计划授权不覆盖进程、Git 写或外部 Runtime 操作，需逐次审批"`,
`status=pending`, `decided_at=NULL`. Its tool call is `status=waiting_approval` with `started_at=NULL`
(never began executing). Its task lease is **valid**: `task_leases` for `tsk_01m61epwxek470ehr9gy2f934z`,
holder `run:run_01m61epy3wwz1jfk5veyp2ky64`, `fencing_token=1`, `expires_at=08:14:32.374` — i.e. the lease
was *not* the reason this approval stayed pending.

All 12 approvals before it in the same run were decided by an automated approver within **0.1–2.0 s**
(`apr_01m61eq2732…` 0.06 s, `…eq3s0d6r…` 1.19 s, `…eqj0jjw8…` 0.06 s, `…eqm4ttj3…` 2.02 s, `…eqs0vdr0…` 1.19 s,
`…eqzvcb68…` 0.40 s, `…er3as2y1…` 1.14 s, `…er5gj31z…` 1.26 s). Number 13 was not. Decision text on the
successful ones: `Phase 2.8.3 范围内授权`.

### 3.3 Duration accounting (`p285-ui3`)

| metric | value | derivation |
|---|---|---|
| wall clock in `running` | **895.2 s** | `exec.startedAt 07:30:31.319` → runtime end `07:45:26.517` |
| blocked in `waiting_approval` | **850.3 s** | `07:31:16.260` → `07:45:26.517` |
| productive | 45.0 s | `startedAt` → park |
| model steps | 15 (`budget_json.stepsUsed`) | exact call count not persisted |
| tokens | in **198 381**, out **4 195** | `agent_runs` accumulator; no `ai_usage_records` row (written only on run completion), `estimated_cost` NULL, `ai_model_prices` empty → **cost not recorded** |
| tool calls | 19 in 45 s, Σ 4.42 s, mean 0.25 s, max 1.14 s | `tool_calls` |
| largest inter-tool gap | 7.1 s (07:30:38.108 → 07:30:45.246) | no internal idle gap explains the 900 s |
| repeated identical calls | `run_tests {node --test tests/visibility.test.mjs}` ×2, `run_tests {npm test}` ×2 | **not a retry storm**: each pair is a before-fix/after-fix evidence pair (exit 1 → exit 0), 0.7 s and 1.1 s |
| failed tool calls | 3 (`run_command`, policy `不允许管道…`) | ~7 s |

## 4. Contrast case A — `p284-ui` (longest `running`: 1 085.6 s)

Plan `pln_01m61aqb7yte3gnr7j4035tj45` (`prj_01m61aqaw601ct6mrd9xjx239f`), `execution.status=running`,
`startedAt 06:21:02.702`, `updatedAt 06:21:03.785`, `deadlineAt 08:21:02.702`.

- Run `run_01m61aqq8rzgfd1wpq3wntde3z`: 14 tool calls, Σ 1.51 s, all within `06:21:04 → 06:21:32`.
- 5 approvals auto-decided (0.18–1.88 s), then `apr_01m61ark6xg3r5yqx9554g3kz6` (`run_tests`)
  requested `06:21:32.381` → **`pending`, never decided**, tool call `waiting_approval`.
- Last `autonomy coordination pass` `06:21:32.643`; then `runtime shutting down` `06:39:08.317` — a
  **1 055.7 s log gap**. Productive time 29.7 s, blocked 1 055.9 s. Same failure shape, no CONFLICT line.

## 5. Contrast case B — `p282-ui3` (901.8 s, but *not* `running`)

Plan `pln_01m613nrj9ddakq52xvftmc8r3`: all 4 runs **completed** (last `04:18:54.046`); `execution.status=paused`
at `04:18:50.954` with `error="任务「运行 npm test 并如实报告失败结果」缺少有效完成依据：预期产物：测试报告…"`
(evidence gate: no verified test report / gate pass / successful `run_tests`). Row stayed non-terminal until
`04:32:50.629` (901.8 s) because the auto-replan proposal `rpp_01m613qyag3rz0a4q8v14eyqzb` sat
`status=proposed`, `requested 04:19:18.629` → `decided 04:32:50.637` = **812.0 s waiting for a human to
apply it** (`decided_reason="用户应用修订提案"`). A second proposal `rpp_01m614jkvs3nzaaz2j130p6074`
(`04:33:49.200`) was still `proposed` at DB end. So this 900 s is **waiting for a replan decision**, not an
approval and not a stuck tool call.

## 6. This is systematic, not a one-off (census over all 19 `p28x-ui*` DBs, 20 plan-exec rows)

| data dir | plan | rev | `exec` | exec start | last project_event | pending approvals | `waiting_approval` runs | start→DB mtime |
|---|---|---|---|---|---|---|---|---|
| p281-ui2 | `…dmcd3ah8qf` | 1 | running | 01:44:58 | 01:45:58 | 1 | 1 | 48.5 s |
| p281-ui3 | `…98g71zzm4f` | 1 | running | 01:55:38 | 01:55:51 | 1 | 1 | **987.0 s** |
| p281-ui4 | `…q6xx2903c1` | 1 | running | 02:15:28 | 02:15:58 | 1 | 1 | **958.8 s** |
| p282-ui | `…v8hcv65hh7` | 1 | running | 03:54:49 | 03:55:39 | 1 | 1 | 34.5 s |
| p282-ui2 | `…mxs2gcqyrqg` | 1 | running | 04:06:18 | 04:07:02 | 1 | 1 | 26.9 s |
| p283-ui | `…4qhn8sn8t0` | 1 | running | 05:07:19 | 05:08:39 | 1 | 1 | 69.6 s |
| **p284-ui** | `…7j4035tj45` | 1 | running | 06:21:02 | 06:21:32 | 1 | 1 | **1 085.6 s** |
| p285-ui2 | `…bf2kj3mmycj` | 1 | paused | 07:25:26 | 07:28:31 | 1 | 1 | 186.8 s |
| **p285-ui3** | `…1p1dn9mrejt` | 2 | **running** | 07:30:31 | 07:31:16 | 1 | 1 | **880.3 s** |

Every non-completing plan-execution row carries **exactly one pending approval and exactly one
`waiting_approval` run**. Separately, in *every* p28x run the autonomy coordinator logged
`autonomy coordination pass` with `(advanced=0, nudged=1)` — 98/98 passes in `p285-ui3`, 25/25 in `p284-ui`,
145/145 in `p285-ui2` — and the passes **stop at the same instant the run parks in `waiting_approval`**
(`p285-ui3` 07:31:16.522 vs park 07:31:16.260; `p284-ui` 06:21:32.643 vs park 06:21:32.381) and never resume.

## 7. Did the plan exceed its configured wall-clock deadline? **No.**

`execution.maxWallClockMs = 7 200 000` (2 h) in *all* P2.8.x revisions → `deadlineAt` = start + 2 h
(`p285-ui3`: `09:30:31.319`; `p284-ui`: `08:21:02.702`). The processes died at `07:45:26` / `06:39:08`,
i.e. **12 % / 25 % of the plan budget consumed**, `budgetExhausted=null`, grant quotas untouched
(1/6 runs, 1/120 tool calls). Run-level budget `maxWallClockMs=1 800 000` → run deadline `08:00:32.316`
(`p285-ui3`), also never reached. **No timeout fired because nothing was near a limit** — that is precisely
why the failure produced no error at all.

## 8. Events the task asked about

- `plan.execution.failure_classified` — **present, 2 rows, only for the *previous* revision**
  (`seq 86` 07:30:11.776 `failureClass=implementation, trigger=evidence_exhausted, replan=true`;
  `seq 87` 07:30:11.796 `failureClass=verification_failed`). **Nothing for rev 2**: no classification,
  no timeout, no `needs_reconciliation` marker — the row simply stays `running`.
- `plan.replan.proposed` — 1 row (`seq 88` 07:30:28.737 → proposal `rpp_01m61epa23qxk3q8p885tbyzp0`,
  `trigger=evidence_exhausted`, applied 07:30:30.934, `model_calls=1`, 16 939 ms).
- `plan.grant.invalidated` (`seq 89` 07:30:30.925, `reason="计划被 r2 替代"`), `plan.task.reused` ×2 (`seq 96/97`).
- `autonomy_events` — 138 rows, kinds `task.settled` 42 / `run.settled` 48 / `approval.settled` 34 /
  `evidence.settled` 11 / `handoff.settled` 3, **all `status=processed`, `attempts=1` (max 1)** → no
  retry storm, no pending autonomy work. The last `approval.settled` for this run is `07:31:16.263`
  (`evt_01m61er917b6my0y6st4fjkj2h`), i.e. autonomy *did* try to advance the plan once after the park
  and then nothing else ever happened.

## 9. Classification (exactly one primary + one contributing)

**(c) waiting for approval — PRIMARY.** The plan was blocked on
`apr_01m61er913jbn3hqxxeh52b87b` / `tol_01m61er910k7gtwv6q2d2jw6b7` (`git ls-tree --name-only HEAD src`)
from `07:31:16.259` to process end `07:45:26.517` (850 s), with `status=pending`, `decided_at=NULL`, and no
`approval.decided` event. 12 preceding approvals in the same run were auto-decided in ≤2.0 s, so the channel
worked until that point. This is *not* normal long work: productive time was 45 s and the last tool call
never even started (`started_at=NULL`).

**(e) scheduler state inconsistency — CONTRIBUTING.** Nothing in the persisted state machine can leave
`running`: (i) no approval-expiry sweep is recorded (both approvals expire 30 min after request —
`08:01:16.259`, `06:51:32.381` — and both processes died before those instants, so the sweep may exist but
never got a chance to run); (ii) the coordinator produced passes with `advanced=0` and stopped permanently
when the wait appeared; (iii) `plan_revisions.execution.status` was still `running` at teardown with
`budgetExhausted=null`, no failure classification and no reconciliation flag, so the row is stale and
**needs reconciliation (f)** rather than an inferred cause.

**Explicitly excluded:** (a) normal long work — 45 s of work, 850 s of silence. (b) external operation —
no long-running tool (max tool duration 1.14 s). (d) no-progress loop — repeated calls are 2× each and
semantically paired (fail-then-pass evidence), costing ~1.8 s; the 98 `advanced=0` coordination passes are a
symptom of the wait, not its cause. (g) budget/deadline exceeded — see §7.

## 10. What I could not determine (persisted facts are silent)

1. **Why the automated approver stopped after 12 approvals.** No client-side record exists in SQLite; the
   E2E driver is outside the DB. The commands were the same tool class as the 12 approved ones, so a
   tool-type rule is not demonstrable.
2. **Which approval the rejected `approval.decide` at `07:44:22.149` targeted.** Rejected requests are not
   persisted. Our task's lease was valid until `08:14:32.374`, whereas the demo run
   `run_01m61fg42y8r11bchkdt2y9nqn` had a pending approval requested at `07:44:17.632` whose task
   (`n7svw9jhy1`) has **no `task_leases` row at all** — the timing (4.5 s later) and the missing lease both
   point at *that* approval, so the CONFLICT line cannot be used to explain our 13-minute wait. It is also
   why the plan did not resume even then.
3. **Whether an approval-expiry sweep exists.** Both approvals' `expires_at` (30 min) fall *after* process
   shutdown, so the DB cannot show it.
4. **Exact model-call count and cost.** Only `stepsUsed=15`, `input_tokens=198381`, `output_tokens=4195`
   survived; `ai_usage_records` has no row for the unfinished run and `estimated_cost`/`ai_model_prices`
   are empty.
5. **Why the runtime was torn down at `07:45:26`** (E2E timeout vs. script step transition) — no such
   record exists; the desktop log ends with a `version.transition` CONFLICT at `07:44:32.568`.

## 11. Reproduction

```powershell
$dst = "$env:TEMP\p287-forensics"; New-Item -ItemType Directory -Force $dst
Copy-Item "$env:TEMP\p285-ui3\projectos.db*" "$dst\p285-ui3\" -Force   # db + -wal + -shm
# query the COPY only
& C:\Users\Administrator\miniconda3\python.exe -X utf8 schema.py   # tables; scripts kept in $dst
```
Key one-liners (on a copy): `SELECT status,decided_at,requested_at,expires_at FROM approvals WHERE id='apr_01m61er913jbn3hqxxeh52b87b'`
→ `pending|NULL|1793197876259|1793199676259`; `SELECT status,started_at FROM tool_calls WHERE id='tol_01m61er910k7gtwv6q2d2jw6b7'`
→ `waiting_approval|NULL`.
