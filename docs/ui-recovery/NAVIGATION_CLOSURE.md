# Navigation closure — graph workspace consolidation

Updated 2026-10-29, branch `codex/org-a1-foundation`, baseline `ec97824`.
The user explicitly requested retaining the existing graph/connection implementation and removing
the chat-style inner page. This supersedes the earlier P0-B decision to keep an explicit legacy room.

## Current routes and actions

| Capability | Current product entry | Return / context |
|---|---|---|
| Agent collaboration | `/projects/:projectId/agents` | Single full-width graph; pan/zoom/filter/selection are retained |
| Agent instruction | Select an Agent → compact execution section in its detail surface | Close the detail; the same graph remains underneath |
| Existing execution context | Agent detail context selector | Only the selected Agent/project's persisted sessions are offered |
| Create execution context | Agent detail → 新建上下文 | Real `sessions.create`; no full-page chat route |
| Start/stop run | Agent detail → 执行指令 / 停止运行 | Existing `sessions.sendMessage(startRun:true)` / `runs.cancel`; real status from persisted Run |
| Recent output | Agent detail → collapsed read-only snapshot | No message bubbles or second chat workspace |
| Agent Studio | Graph toolbar → Agent 管理 | Actual modal is now rendered; close returns to graph |
| Plan DAG | Graph toolbar → 计划 DAG | `/orchestration?return=agents`, visible 返回协作图 |
| Approval | Real graph Approval node or Agent/task detail | Existing risk confirmation + `approval.decide` |
| Run audit | Agent/task/artifact/approval/handoff detail | Existing `/runs?run=...`; shell history preserves navigation |
| Artifact / handoff | Real graph object / edge | Read persisted body, provenance and transfer details; no chat room required |

## Legacy links

- `?workspace=sessions` and `?view=pro` no longer select another UI. The obsolete mode parameter
  is removed while staying on the graph.
- A valid `?session=...` selects that persisted session's Agent detail/context, then consumes the
  navigation request. Foreign project/Agent sessions cannot be chosen as an execution context.
- Old “会话工作台”, “打开会话” and “返回协作总览” room-navigation buttons are removed.
- Stored sessions/messages, native AgentRunner, approvals and handoffs are unchanged.

## Verification

`tests/agent-context.test.ts` + `tests/collaboration-focus.test.ts`: **5 PASS**. They cover explicit/
active/latest context precedence, project/Agent filtering, legacy-link normalization and the
unchanged activity focus projection.

`scripts/agent-overview-e2e.mjs` retains its real projection, relationship pixels, endpoint alignment,
approval/risk/duplicate-decision, artifacts, reduced-motion and restart checks. Its navigation checks
now require in-graph context controls, no `.po-agent-workspace` / `.po-sender`, and legacy session
links returning to the same graph. The evidence directory supports
`PROJECTOS_OVERVIEW_EVIDENCE_DIR`; A1 runs preserve the old committed captures.

Final command output and actual screenshots are authoritative for this round; the old P0-B chat
navigation PASS statements do not apply to the current product.

## Remaining gaps

- Runs/tasks still rely on shell/history for some graph-return paths.
- Graph viewport/filter/selection restore through sessionStorage in the current window, rather
  than a shareable URL.
- Full historical session conversation has no separate UI after the requested chat-page removal;
  persisted history and Run audit remain available to the existing APIs and audit surfaces.
- Permission-denial and short-TTL approval UI negatives retain the fixture limitations recorded by
  the earlier report; they are not silently claimed as passed.
