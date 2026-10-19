import {
  now,
  type AgentView,
  type GraphEdge,
  type GraphLayout,
  type GraphNode,
  type GraphNodeStatus,
  type GraphSnapshot,
  type Run,
  type TaskCard,
} from '@projectos/contracts'
function taskStatus(status: TaskCard['status']): GraphNodeStatus {
  switch (status) {
    case 'backlog':
      return 'idle'
    case 'ready':
      return 'queued'
    case 'running':
      return 'running'
    case 'review':
      return 'waiting'
    case 'blocked':
      return 'blocked'
    case 'done':
      return 'completed'
    case 'cancelled':
      return 'paused'
    default:
      return 'idle'
  }
}

function agentStatus(status: AgentView['status']): GraphNodeStatus {
  if (status === 'working') return 'running'
  if (status === 'offline') return 'paused'
  return 'idle'
}

export interface GraphProjectionInput {
  projectId: string
  projectName: string
  lastEventSeq: number
  agents: AgentView[]
  tasks: TaskCard[]
  latestRuns: Record<string, Run | null>
  layout?: GraphLayout | null
}

export function buildGraphSnapshot(input: GraphProjectionInput): GraphSnapshot {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const updatedAt = now()
  const active = Object.values(input.latestRuns).some(
    (run) => run && ['running', 'waiting_tool', 'waiting_approval', 'queued'].includes(run.status),
  )
  nodes.push({
    id: `orchestrator:${input.projectId}`,
    kind: 'orchestrator',
    label: input.projectName,
    subtitle: `${input.agents.length} Agents · ${input.tasks.length} Tasks`,
    status: active ? 'running' : 'idle',
    projectId: input.projectId,
    updatedAt,
  })

  input.agents.forEach((view, index) => {
    const id = `agent:${view.agent.id}`
    nodes.push({
      id,
      kind: 'agent',
      label: view.agent.name,
      subtitle: view.agent.role,
      status: agentStatus(view.status),
      projectId: input.projectId,
      agentId: view.agent.id,
      runId: view.activeRunId,
      updatedAt,
    })
    edges.push({
      id: `delegation:orchestrator:${view.agent.id}`,
      source: `orchestrator:${input.projectId}`,
      target: id,
      kind: 'delegation',
    })
    void index
  })

  const taskById = new Map(input.tasks.map((task) => [task.id, task]))
  const depthCache = new Map<string, number>()
  const depth = (task: TaskCard, trail = new Set<string>()): number => {
    if (depthCache.has(task.id)) return depthCache.get(task.id)!
    if (trail.has(task.id)) return 0
    trail.add(task.id)
    const parents = task.dependencyIds
      .map((id) => taskById.get(id))
      .filter((parent): parent is TaskCard => Boolean(parent))
    const value = parents.length === 0 ? 0 : Math.max(...parents.map((parent) => depth(parent, trail) + 1))
    depthCache.set(task.id, value)
    return value
  }
  const byDepth = new Map<number, TaskCard[]>()
  for (const task of input.tasks) {
    const level = depth(task)
    const list = byDepth.get(level) ?? []
    list.push(task)
    byDepth.set(level, list)
  }

  for (const task of input.tasks) {
    const latestRun = input.latestRuns[task.id] ?? null
    nodes.push({
      id: `task:${task.id}`,
      kind: 'task',
      label: task.title,
      subtitle: `${task.assigneeName ?? '未分配'} · ${task.status}`,
      status: taskStatus(task.status),
      projectId: input.projectId,
      taskId: task.id,
      agentId: task.assigneeAgentId,
      runId: latestRun?.id ?? null,
      progress:
        task.acceptanceCriteria.length > 0
          ? { completed: task.status === 'done' ? task.acceptanceCriteria.length : 0, total: task.acceptanceCriteria.length }
          : undefined,
      updatedAt: task.updatedAt,
    })
    for (const dependency of task.dependencyIds) {
      edges.push({
        id: `dependency:${dependency}:${task.id}`,
        source: `task:${dependency}`,
        target: `task:${task.id}`,
        kind: 'dependency',
      })
    }
    if (task.assigneeAgentId) {
      edges.push({
        id: `delegation:${task.assigneeAgentId}:${task.id}`,
        source: `agent:${task.assigneeAgentId}`,
        target: `task:${task.id}`,
        kind: 'delegation',
      })
    }
  }

  const positions: Record<string, { x: number; y: number }> = {}
  const saved = input.layout?.positions ?? {}
  const orchestratorId = `orchestrator:${input.projectId}`
  positions[orchestratorId] = saved[orchestratorId] ?? { x: 320, y: 0 }
  input.agents.forEach((view, index) => {
    const id = `agent:${view.agent.id}`
    positions[id] = saved[id] ?? { x: index * 230, y: 130 }
  })
  for (const [level, tasks] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    tasks.forEach((task, index) => {
      const id = `task:${task.id}`
      positions[id] = saved[id] ?? { x: 80 + level * 220, y: 310 + index * 105 }
    })
  }

  return {
    projectId: input.projectId,
    revision: input.lastEventSeq,
    lastEventSeq: input.lastEventSeq,
    nodes,
    edges,
    positions,
    generatedAt: now(),
  }
}
