import type {
  ApprovalView,
  Artifact,
  CollaborationOverview,
  CollaborationOverviewAgent,
  HandoffView,
  TaskCard,
} from '@projectos/contracts'

/**
 * UI-only focus projection for the collaboration graph.
 *
 * It does not persist, schedule or invent anything. It partitions the already persisted overview
 * into the current working set and the standby set:
 *
 * - primary: agents with a real active Run (working / waiting approval), a current task, a real
 *   assignment in the current plan, or an unfinished real Handoff;
 * - standby: all remaining available agents. They stay reachable in the dock but never enter ELK
 *   layout or fitView.
 */
export interface CollaborationFocusProjection {
  primaryAgents: CollaborationOverviewAgent[]
  standbyAgents: CollaborationOverviewAgent[]
  primaryTasks: TaskCard[]
  primaryArtifacts: Artifact[]
  primaryApprovals: ApprovalView[]
  primaryHandoffs: HandoffView[]
  hasFocus: boolean
}

function isAgentActive(agent: CollaborationOverviewAgent): boolean {
  return agent.pendingApprovals > 0 || agent.status === 'working' || agent.runStatus === 'waiting_approval' || agent.runStatus === 'waiting_tool'
}

export function projectCollaborationFocus(overview: Pick<
  CollaborationOverview,
  'agents' | 'tasks' | 'artifacts' | 'approvals' | 'handoffs' | 'plan'
>): CollaborationFocusProjection {
  const planTaskIds = new Set(overview.plan?.taskIds ?? [])
  const activeRunTaskIds = new Set(
    overview.agents
      .filter((agent) => isAgentActive(agent) && agent.taskId)
      .map((agent) => agent.taskId as string),
  )

  let taskCandidates = overview.tasks.filter((task) => task.status !== 'cancelled')
  if (planTaskIds.size > 0) {
    taskCandidates = taskCandidates.filter((task) => planTaskIds.has(task.id))
  } else if (activeRunTaskIds.size > 0) {
    taskCandidates = taskCandidates.filter((task) => activeRunTaskIds.has(task.id) || task.status === 'running' || task.status === 'review')
  } else {
    taskCandidates = taskCandidates.filter((task) => task.status === 'running' || task.status === 'review' || task.status === 'blocked')
  }

  // Keep one direct dependency layer so a primary task does not appear from nowhere. This is the
  // real persisted dependency closure, not a decorative edge.
  const primaryTaskIds = new Set(taskCandidates.map((task) => task.id))
  for (const task of taskCandidates) {
    for (const dependency of task.dependencyIds) {
      if (overview.tasks.some((item) => item.id === dependency)) primaryTaskIds.add(dependency)
    }
  }
  // One direct downstream layer keeps validation / review tasks that consume the current focus visible.
  for (const task of overview.tasks) {
    if (task.status === 'cancelled') continue
    if (task.dependencyIds.some((dependency) => primaryTaskIds.has(dependency))) primaryTaskIds.add(task.id)
  }
  const primaryTasks = overview.tasks.filter((task) => primaryTaskIds.has(task.id))

  const assignedAgentIds = new Set(primaryTasks.map((task) => task.assigneeAgentId).filter((id): id is string => Boolean(id)))
  const handoffAgentIds = new Set<string>()
  for (const handoff of overview.handoffs) {
    if (handoff.status !== 'requested' && handoff.status !== 'accepted') continue
    if (handoff.taskId && primaryTaskIds.has(handoff.taskId)) {
      handoffAgentIds.add(handoff.fromAgentId)
      handoffAgentIds.add(handoff.toAgentId)
    }
  }

  const primaryAgents = overview.agents.filter((agent) =>
    isAgentActive(agent)
    || (agent.taskId ? primaryTaskIds.has(agent.taskId) : false)
    || assignedAgentIds.has(agent.id)
    || handoffAgentIds.has(agent.id),
  )
  const primaryAgentIds = new Set(primaryAgents.map((agent) => agent.id))
  const standbyAgents = overview.agents.filter((agent) => !primaryAgentIds.has(agent.id))

  const primaryHandoffs = overview.handoffs.filter((handoff) =>
    (handoff.status === 'requested' || handoff.status === 'accepted')
    && primaryAgentIds.has(handoff.fromAgentId)
    && primaryAgentIds.has(handoff.toAgentId)
    && (!handoff.taskId || primaryTaskIds.has(handoff.taskId)),
  )
  const primaryArtifacts = overview.artifacts.filter((artifact) =>
    artifact.taskId ? primaryTaskIds.has(artifact.taskId) : false,
  )
  const primaryApprovals = overview.approvals.filter((approval) =>
    approval.status === 'pending' && approval.taskId ? primaryTaskIds.has(approval.taskId) : false,
  )

  return {
    primaryAgents,
    standbyAgents,
    primaryTasks,
    primaryArtifacts,
    primaryApprovals,
    primaryHandoffs,
    hasFocus: primaryAgents.length > 0 || primaryTasks.length > 0,
  }
}
