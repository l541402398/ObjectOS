# Navigation closure — P0-B

## Route decision

- `/projects/:projectId/agents` is the single default team-work entry. It always renders the collaboration graph.
- `?workspace=sessions` is the explicit, contextual **legacy session workspace** (chat, group chat, session creation, Agent Studio, Handoff). It is not a fixed mode switch: it is reached from an Agent node's “打开会话”, from the toolbar “会话工作台”, or a directly pasted URL.
- `?view=pro` is no longer a product mode. An old bookmark is redirected to the graph (query removed) and the graph stays usable.
- `/projects/:projectId/orchestration?return=agents` is the real plan DAG. It has a visible “返回协作图” button when opened from the graph.
- `/approvals` is the new document-first review room; `/approvals/center` retains the professional audit center. Approval can be decided in the graph, review room or center, all through the same API.

## Functional inventory of the old Agent workspace (not deleted)

| Capability | Old location | Current entry | Return path |
|---|---|---|---|
| Session list / open session | `AgentWorkbenchPage` | Agent inspector “打开会话”; toolbar “会话工作台” | “返回协作总览” button |
| Send message / streaming | `AgentWorkbenchPage` | same legacy workspace | same |
| Create session | `AgentWorkbenchPage` | same legacy workspace | same |
| Group chat / plan collaboration | `AgentWorkbenchPage` | same legacy workspace (group panel) | same |
| Agent Studio / Agent management | `AgentWorkbenchPage` + `AgentStudioModal` | toolbar “Agent 管理” from graph; legacy page | drawer close / back |
| Handoff view | `AgentWorkbenchPage` | graph Handoff edge/agent inspector; legacy group panel | close inspector / back |
| Plan DAG | `/orchestration` | toolbar “计划 DAG” | “返回协作图” |
| Approval list / audit | `/approvals` | graph activity, approval sheet “审批中心” | browser/app back; direct graph return is not yet a first-class button |

The old page remains reachable until each capability has a graph-native replacement. No chat/session/Handoff data was deleted.

## Verified navigation closure (real Electron E2E)

| From → To | Assertion | Result |
|---|---|---|
| Graph → Agent inspector → 会话工作台 | URL has `workspace=sessions`; legacy workspace renders; “返回协作总览” exists | PASS |
| 会话工作台 → 返回协作总览 | `.aco-root` returns; selected Agent inspector restores from session storage | PASS |
| Graph → 计划 DAG | `/orchestration?return=agents` renders; “返回协作图” exists | PASS |
| 计划 DAG → 返回协作图 | `.aco-root` returns | PASS |
| Graph → 审批节点 → 允许本次 | real `approval.decide`; sheet closes; pending disappears; Run resumes | PASS |
| Graph → 产物 → 运行审计/任务看板 | existing routes; task route returns through shell navigation | PASS (run link), task route not yet E2E-asserted |
| Activity → approvals/runs | real route; E2E uses history back | PASS |
| Old `?view=pro` deep link | redirected to graph, no fixed “专业编排” switch | PASS (code + build) |
| Permission-insufficient approval | No role/permission denial path exists in this local app; backend only enforces it | BLOCKED (cannot simulate without inventing auth) |
| Expired approval | No short-TTL approval fixture in this E2E | SKIP (not tested; not claimed) |

## Remaining navigation gaps

- `/runs` and `/tasks` have no explicit graph-return control; browser history works but is not a designed control. `/approvals` now has a visible “返回协作图” control.
- The graph restores selection/filter/viewport from sessionStorage for the current window; it is not persisted in the URL, so a new window does not restore viewport.
- The old session page is a legacy explicit route, not yet fully migrated into a graph-native conversation drawer.
