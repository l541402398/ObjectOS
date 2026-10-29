import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import ELK from 'elkjs/lib/elk.bundled.js'
import '@xyflow/react/dist/style.css'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import {
  ArrowRight,
  Check,
  CircleAlert,
  FileText,
  GitBranch,
  Handshake,
  ShieldAlert,
} from 'lucide-react'
import type {
  ApprovalView,
  Artifact,
  CollaborationOverviewAgent,
  HandoffView,
  RunStatus,
  RunSummary,
  TaskCard,
} from '@projectos/contracts'
import { runStatusLabel, taskStatusLabel } from '../../lib/labels'

export type GraphSelection =
  | { kind: 'agent'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'artifact'; id: string }
  | { kind: 'approval'; id: string }
  | { kind: 'handoff'; id: string }

type AgentData = { agent: CollaborationOverviewAgent; selected: boolean; related: boolean }
type TaskData = { task: TaskCard; agentName: string; runStatus: RunStatus | null; selected: boolean; related: boolean }
type ArtifactData = { artifact: Artifact; selected: boolean; related: boolean }
type ApprovalData = { approval: ApprovalView; selected: boolean; related: boolean }

type RelationshipKind = 'assignment' | 'dependency' | 'artifact' | 'approval' | 'handoff'
type Relationship = { id: string; source: string; target: string; kind: RelationshipKind; handoffId?: string }

const AGENT_SIZE = { width: 224, height: 88 }
const TASK_SIZE = { width: 212, height: 94 }
const ARTIFACT_SIZE = { width: 204, height: 80 }
const APPROVAL_SIZE = { width: 214, height: 88 }

const EDGE_COLORS: Record<RelationshipKind, string> = {
  assignment: '#9aa8bf',
  dependency: '#8ea3c4',
  artifact: '#5f9f8f',
  approval: '#c2953f',
  handoff: '#c08a3e',
}

function AgentNode({ data }: NodeProps<Node<AgentData, 'aco-agent'>>): ReactElement {
  const agent = data.agent
  const waiting = agent.pendingApprovals > 0 || agent.runStatus === 'waiting_approval'
  const statusLabel = waiting ? '等待审批' : agent.status === 'working' ? '工作中' : agent.status === 'offline' ? '离线' : '空闲'
  const tone = waiting ? 'warn' : agent.status === 'working' ? 'accent' : 'neutral'
  return (
    <div className={`aco-gnode aco-gnode-agent${data.selected ? ' is-selected' : ''}${data.related ? ' is-related' : ''}`} data-testid={`collaboration-agent-${agent.id}`}>
      <Handle type="target" position={Position.Left} className="aco-port" isConnectable={false} />
      <div className="aco-gnode-agent-top">
        <span className="aco-avatar" style={{ color: agent.accent || undefined, borderColor: agent.accent ? `${agent.accent}55` : undefined }}>{agent.name.slice(0, 1)}</span>
        <span className="aco-gnode-agent-copy">
          <strong>{agent.name}</strong>
          <span>{agent.role}</span>
        </span>
        <span className={`aco-pill is-${tone}`}><i />{statusLabel}</span>
      </div>
      <div className="aco-gnode-current" title={agent.taskTitle ?? undefined}>{agent.taskTitle ?? '暂无进行中的任务'}</div>
      <div className="aco-gnode-foot">
        <span className="aco-mono">{agent.activeRunId ? agent.activeRunId.slice(0, 12) : '无活动 Run'}</span>
        <span>{agent.pendingApprovals > 0 ? `${agent.pendingApprovals} 项审批` : `${agent.completedRuns} 次完成`}</span>
      </div>
      <Handle type="source" position={Position.Right} className="aco-port" isConnectable={false} />
    </div>
  )
}

function TaskNode({ data }: NodeProps<Node<TaskData, 'aco-task'>>): ReactElement {
  return (
    <div
      className={`aco-gnode aco-gnode-task${data.selected ? ' is-selected' : ''}${data.related ? ' is-related' : ''}${data.runStatus === 'waiting_approval' ? ' is-waiting' : ''}`}
      data-testid={`collaboration-task-${data.task.id}`}
      data-task-status={data.task.status}
    >
      <Handle type="target" position={Position.Left} className="aco-port" isConnectable={false} />
      <div className="aco-gnode-top">
        <span className={`aco-gnode-state is-${data.task.status}`}>{taskStatusLabel(data.task.status)}</span>
        <span className="aco-gnode-meta">{data.task.dependencyIds.length ? `${data.task.dependencyIds.length} 前置` : '起点'}</span>
      </div>
      <strong className="aco-gnode-title" title={data.task.title}>{data.task.title}</strong>
      <div className="aco-gnode-foot">
        <span className="aco-gnode-assignee"><i>{data.agentName.slice(0, 1)}</i>{data.agentName}</span>
        <span className={data.runStatus === 'waiting_approval' ? 'aco-warn-text' : ''}>
          {data.runStatus === 'waiting_approval' ? '等待审批' : data.runStatus ? runStatusLabel(data.runStatus) : '未启动'}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="aco-port" isConnectable={false} />
    </div>
  )
}

function ArtifactNode({ data }: NodeProps<Node<ArtifactData, 'aco-artifact'>>): ReactElement {
  return (
    <div className={`aco-gnode aco-gnode-artifact${data.selected ? ' is-selected' : ''}${data.related ? ' is-related' : ''}`} data-testid={`collaboration-artifact-${data.artifact.id}`}>
      <Handle type="target" position={Position.Left} className="aco-port" isConnectable={false} />
      <div className="aco-gnode-top">
        <span className="aco-gnode-meta"><FileText size={11} /> {data.artifact.kind}</span>
        {data.artifact.verifiedAt ? <span className="aco-verified"><Check size={10} />已核验</span> : <span className="aco-unverified">未核验</span>}
      </div>
      <strong className="aco-gnode-title" title={data.artifact.title}>{data.artifact.title}</strong>
      <div className="aco-gnode-foot">
        <span className="aco-mono">{data.artifact.id.slice(0, 12)}</span>
        <span>{data.artifact.isDemo ? 'DEMO' : '真实持久化'}</span>
      </div>
      <Handle type="source" position={Position.Right} className="aco-port" isConnectable={false} />
    </div>
  )
}

function ApprovalNode({ data }: NodeProps<Node<ApprovalData, 'aco-approval'>>): ReactElement {
  return (
    <div className={`aco-gnode aco-gnode-approval${data.selected ? ' is-selected' : ''}${data.related ? ' is-related' : ''}`} data-testid={`collaboration-approval-${data.approval.id}`}>
      <Handle type="target" position={Position.Left} className="aco-port" isConnectable={false} />
      <div className="aco-gnode-top">
        <span className="aco-gnode-state is-review"><ShieldAlert size={10} /> 人工审批</span>
        <span className="aco-gnode-meta">{data.approval.agentName}</span>
      </div>
      <strong className="aco-gnode-title" title={data.approval.title}>{data.approval.title}</strong>
      <div className="aco-gnode-foot">
        <span>{data.approval.taskTitle ?? '未关联任务'}</span>
        <span className="aco-warn-text">等待处理</span>
      </div>
      <Handle type="source" position={Position.Right} className="aco-port" isConnectable={false} />
    </div>
  )
}

const nodeTypes = {
  'aco-agent': AgentNode,
  'aco-task': TaskNode,
  'aco-artifact': ArtifactNode,
  'aco-approval': ApprovalNode,
}

function RelationshipLayer({
  relationships,
  positions,
  sizeById,
  viewport,
  selectedId,
  onSelectHandoff,
}: {
  relationships: Relationship[]
  positions: Record<string, { x: number; y: number }>
  sizeById: Map<string, { width: number; height: number }>
  viewport: { x: number; y: number; zoom: number }
  selectedId: string | null
  onSelectHandoff: (id: string) => void
}): ReactElement {
  const shapes = relationships.flatMap((edge) => {
    const source = positions[edge.source]
    const target = positions[edge.target]
    const sourceSize = sizeById.get(edge.source)
    const targetSize = sizeById.get(edge.target)
    if (!source || !target || !sourceSize || !targetSize) return []
    const isHandoff = edge.kind === 'handoff'
    const sx = source.x + sourceSize.width
    const sy = source.y + sourceSize.height / 2
    const tx = isHandoff ? target.x + targetSize.width : target.x
    const ty = target.y + targetSize.height / 2
    const bend = Math.max(34, Math.min(110, Math.abs(tx - sx) / 2))
    const d = isHandoff
      ? `M ${sx} ${sy} C ${sx + 34} ${sy}, ${tx + 34} ${ty}, ${tx} ${ty}`
      : `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`
    const highlighted = Boolean(selectedId) && (edge.source === selectedId || edge.target === selectedId)
    const dimmed = Boolean(selectedId) && !highlighted
    const color = highlighted ? '#5b7cfa' : EDGE_COLORS[edge.kind]
    return [{
      edge,
      d,
      color,
      highlighted,
      dimmed,
      isHandoff,
      midpoint: { x: isHandoff ? Math.max(sx, tx) + 18 : (sx + tx) / 2, y: (sy + ty) / 2 },
    }]
  })

  return (
    <svg className="aco-edge-layer" width="100%" height="100%" aria-hidden="true">
      <defs>
        {Object.entries(EDGE_COLORS).map(([kind, color]) => (
          <marker
            key={kind}
            id={`aco-arrow-${kind}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={selectedId ? '#5b7cfa' : color} />
          </marker>
        ))}
      </defs>
      <g transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}>
        {shapes.map(({ edge, d, color, highlighted, dimmed, isHandoff, midpoint }) => (
          <g
            key={edge.id}
            className={`aco-edge aco-edge-${edge.kind}${highlighted ? ' is-highlighted' : ''}${dimmed ? ' is-dimmed' : ''}${isHandoff ? ' is-handoff' : ''}`}
            style={{ pointerEvents: isHandoff ? 'stroke' : 'none', cursor: isHandoff ? 'pointer' : undefined }}
            onClick={isHandoff && edge.handoffId ? () => onSelectHandoff(edge.handoffId!) : undefined}
          >
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={highlighted ? 2.2 : isHandoff ? 1.7 : 1.5}
              strokeDasharray={edge.kind === 'artifact' ? '4 4' : isHandoff ? '6 4' : undefined}
              markerEnd={`url(#aco-arrow-${edge.kind})`}
            />
            {isHandoff ? (
              <g transform={`translate(${midpoint.x}, ${midpoint.y})`}>
                <rect x="-20" y="-10" width="40" height="20" rx="4" fill="var(--pw-surface)" stroke="var(--pw-warn-line)" />
                <text textAnchor="middle" dominantBaseline="middle" fill="var(--pw-warn)" fontSize="10.5" fontWeight="600">交接</text>
              </g>
            ) : null}
          </g>
        ))}
      </g>
    </svg>
  )
}

export function CollaborationGraph({
  agents,
  tasks,
  runs,
  artifacts,
  approvals,
  handoffs,
  planTaskIds,
  selected,
  onSelect,
  showAgents,
  showTasks,
  showOutputs,
}: {
  agents: CollaborationOverviewAgent[]
  tasks: TaskCard[]
  runs: RunSummary[]
  artifacts: Artifact[]
  approvals: ApprovalView[]
  handoffs: HandoffView[]
  planTaskIds: string[]
  selected: GraphSelection | null
  onSelect: (selection: GraphSelection | null) => void
  showAgents: boolean
  showTasks: boolean
  showOutputs: boolean
}): ReactElement {
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 0.8 })
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null)

  const visibleAgents = useMemo(() => (showAgents ? agents : []), [agents, showAgents])
  const visibleTasks = useMemo(() => (showTasks ? tasks.filter((task) => task.status !== 'cancelled') : []), [showTasks, tasks])
  const visibleArtifacts = useMemo(() => (showOutputs ? artifacts : []), [artifacts, showOutputs])
  const visibleApprovals = useMemo(() => (showOutputs ? approvals : []), [approvals, showOutputs])

  const orderedAgents = useMemo(() => [...visibleAgents].sort((a, b) => {
    const rank = (agent: CollaborationOverviewAgent): number => (agent.pendingApprovals > 0 || agent.runStatus === 'waiting_approval' ? 0 : agent.status === 'working' ? 1 : 2)
    return rank(a) - rank(b) || a.name.localeCompare(b.name)
  }), [visibleAgents])

  const orderedTasks = useMemo(() => {
    const depth = new Map<string, number>()
    const visit = (task: TaskCard, seen: Set<string>): number => {
      const cached = depth.get(task.id)
      if (cached !== undefined) return cached
      if (seen.has(task.id)) return 0
      seen.add(task.id)
      const value = task.dependencyIds.length === 0 ? 0 : 1 + Math.max(...task.dependencyIds.map((id) => {
        const parent = visibleTasks.find((item) => item.id === id)
        return parent ? visit(parent, seen) : 0
      }))
      depth.set(task.id, value)
      return value
    }
    for (const task of visibleTasks) visit(task, new Set())
    return [...visibleTasks].sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0) || a.title.localeCompare(b.title))
  }, [visibleTasks])

  const runByTask = useMemo(() => {
    const map = new Map<string, RunSummary>()
    for (const run of runs) {
      if (!run.taskId) continue
      const previous = map.get(run.taskId)
      if (!previous || run.createdAt > previous.createdAt) map.set(run.taskId, run)
    }
    return map
  }, [runs])

  const agentNames = useMemo(() => Object.fromEntries(agents.map((agent) => [agent.id, agent.name])), [agents])
  const selectedId = selected?.id ?? null

  const sizeById = useMemo(() => {
    const map = new Map<string, { width: number; height: number }>()
    for (const agent of visibleAgents) map.set(agent.id, AGENT_SIZE)
    for (const task of visibleTasks) map.set(task.id, TASK_SIZE)
    for (const item of visibleArtifacts) map.set(item.id, ARTIFACT_SIZE)
    for (const item of visibleApprovals) map.set(item.id, APPROVAL_SIZE)
    return map
  }, [visibleAgents, visibleApprovals, visibleArtifacts, visibleTasks])

  const relationships = useMemo<Relationship[]>(() => {
    const list: Relationship[] = []
    const agentIds = new Set(visibleAgents.map((agent) => agent.id))
    const taskIds = new Set(visibleTasks.map((task) => task.id))
    const approvalIds = new Set(visibleApprovals.map((item) => item.id))

    for (const agent of visibleAgents) {
      if (agent.taskId && taskIds.has(agent.taskId)) {
        list.push({ id: `assign-${agent.id}-${agent.taskId}`, source: agent.id, target: agent.taskId, kind: 'assignment' })
      }
    }
    for (const task of visibleTasks) {
      for (const dep of task.dependencyIds) {
        if (taskIds.has(dep)) list.push({ id: `dep-${dep}-${task.id}`, source: dep, target: task.id, kind: 'dependency' })
      }
    }
    for (const artifact of visibleArtifacts) {
      if (artifact.taskId && taskIds.has(artifact.taskId)) {
        list.push({ id: `artifact-${artifact.taskId}-${artifact.id}`, source: artifact.taskId, target: artifact.id, kind: 'artifact' })
      }
    }
    for (const approval of visibleApprovals) {
      if (approval.taskId && taskIds.has(approval.taskId) && approvalIds.has(approval.id)) {
        list.push({ id: `approval-${approval.taskId}-${approval.id}`, source: approval.taskId, target: approval.id, kind: 'approval' })
      }
    }
    for (const handoff of handoffs) {
      if (agentIds.has(handoff.fromAgentId) && agentIds.has(handoff.toAgentId)) {
        list.push({ id: `handoff-${handoff.id}`, source: handoff.fromAgentId, target: handoff.toAgentId, kind: 'handoff', handoffId: handoff.id })
      }
    }
    return list
  }, [handoffs, visibleAgents, visibleApprovals, visibleArtifacts, visibleTasks])

  const layoutKey = [
    visibleAgents.map((agent) => agent.id).join(','),
    visibleTasks.map((task) => task.id).join(','),
    visibleArtifacts.map((item) => item.id).join(','),
    visibleApprovals.map((item) => item.id).join(','),
  ].join('|')

  useEffect(() => {
    let cancelled = false
    const graph = new ELK()
    const children = [
      { id: 'aco-layout-anchor', width: 1, height: 1 },
      ...orderedAgents.map((agent) => ({ id: agent.id, ...AGENT_SIZE })),
      ...orderedTasks.map((task) => ({ id: task.id, ...TASK_SIZE })),
      ...visibleArtifacts.map((item) => ({ id: item.id, ...ARTIFACT_SIZE })),
      ...visibleApprovals.map((item) => ({ id: item.id, ...APPROVAL_SIZE })),
    ]
    const layoutEdges = [
      ...relationships
        .filter((edge) => edge.kind !== 'handoff')
        .map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
      // Layout-only spokes keep every agent in the first executable layer instead of letting
      // idle agents drift between task rows. They are never drawn as product relationships.
      ...visibleAgents.map((agent) => ({ id: `anchor-${agent.id}`, sources: ['aco-layout-anchor'], targets: [agent.id] })),
    ]
    void graph.layout({
      id: 'aco-collaboration-graph',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '24',
        'elk.layered.spacing.nodeNodeBetweenLayers': '72',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.edgeRouting': 'ORTHOGONAL',
      },
      children,
      edges: layoutEdges,
    }).then((result) => {
      if (cancelled) return
      const next: Record<string, { x: number; y: number }> = {}
      for (const child of result.children ?? []) next[child.id] = { x: child.x ?? 0, y: child.y ?? 0 }
      setPositions(next)
    }).catch((error) => {
      console.error('Collaboration graph layout failed', error)
      if (!cancelled) setPositions({})
    })
    return () => { cancelled = true }
  }, [layoutKey, orderedAgents, orderedTasks, relationships, visibleAgents, visibleApprovals, visibleArtifacts, visibleTasks])

  useEffect(() => {
    if (!instance || Object.keys(positions).length === 0) return undefined
    const fit = (): void => {
      const element = canvasRef.current
      if (!element) return
      let maxX = 0
      let maxY = 0
      for (const [id, position] of Object.entries(positions)) {
        const size = sizeById.get(id)
        if (!size) continue
        maxX = Math.max(maxX, position.x + size.width)
        maxY = Math.max(maxY, position.y + size.height)
      }
      const width = element.clientWidth
      const height = element.clientHeight
      if (maxX === 0 || maxY === 0 || width < 40 || height < 40) return
      const zoom = Math.max(0.4, Math.min(1, (width - 56) / maxX, (height - 56) / maxY))
      const next = { x: (width - maxX * zoom) / 2, y: (height - maxY * zoom) / 2, zoom }
      void instance.setViewport(next)
      setViewport(next)
    }
    const timer = window.setTimeout(fit, 90)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit())
    if (canvasRef.current) observer?.observe(canvasRef.current)
    return () => { window.clearTimeout(timer); observer?.disconnect() }
  }, [instance, positions, sizeById])

  const related = useMemo(() => {
    const ids = new Set<string>()
    if (!selectedId) return ids
    for (const edge of relationships) {
      if (edge.source === selectedId) ids.add(edge.target)
      if (edge.target === selectedId) ids.add(edge.source)
    }
    return ids
  }, [relationships, selectedId])

  const nodes = useMemo(() => {
    const list: Array<Node> = []
    for (const agent of orderedAgents) {
      list.push({
        id: agent.id,
        type: 'aco-agent',
        position: positions[agent.id] ?? { x: 0, y: 0 },
        ...AGENT_SIZE,
        data: { agent, selected: selected?.kind === 'agent' && selected.id === agent.id, related: related.has(agent.id) },
        draggable: false,
      })
    }
    for (const task of orderedTasks) {
      const run = runByTask.get(task.id)
      list.push({
        id: task.id,
        type: 'aco-task',
        position: positions[task.id] ?? { x: 0, y: 0 },
        ...TASK_SIZE,
        data: {
          task,
          agentName: task.assigneeName ?? (task.assigneeAgentId ? agentNames[task.assigneeAgentId] : undefined) ?? '待分配',
          runStatus: run?.status ?? null,
          selected: selected?.kind === 'task' && selected.id === task.id,
          related: related.has(task.id),
        },
        draggable: false,
      })
    }
    for (const artifact of visibleArtifacts) {
      list.push({
        id: artifact.id,
        type: 'aco-artifact',
        position: positions[artifact.id] ?? { x: 0, y: 0 },
        ...ARTIFACT_SIZE,
        data: { artifact, selected: selected?.kind === 'artifact' && selected.id === artifact.id, related: related.has(artifact.id) },
        draggable: false,
      })
    }
    for (const approval of visibleApprovals) {
      list.push({
        id: approval.id,
        type: 'aco-approval',
        position: positions[approval.id] ?? { x: 0, y: 0 },
        ...APPROVAL_SIZE,
        data: { approval, selected: selected?.kind === 'approval' && selected.id === approval.id, related: related.has(approval.id) },
        draggable: false,
      })
    }
    return list
  }, [agentNames, orderedAgents, orderedTasks, positions, related, runByTask, selected, visibleApprovals, visibleArtifacts])

  const taskCount = planTaskIds.length
  const isEmpty = visibleAgents.length === 0 && visibleTasks.length === 0 && visibleArtifacts.length === 0 && visibleApprovals.length === 0

  return (
    <div className="aco-canvas" data-testid="collaboration-graph" ref={canvasRef}>
      <ReactFlow
        nodes={nodes}
        nodeTypes={nodeTypes}
        onInit={(flow) => { setInstance(flow) }}
        onMove={(_event, next) => setViewport(next)}
        onNodeClick={(_event, node) => {
          const nodeType = String(node.type)
          onSelect({
            kind: nodeType === 'aco-agent' ? 'agent' : nodeType === 'aco-task' ? 'task' : nodeType === 'aco-artifact' ? 'artifact' : 'approval',
            id: node.id,
          })
        }}
        onPaneClick={() => onSelect(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.35}
        maxZoom={1.4}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1.1} color="var(--pw-grid-dot)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <RelationshipLayer
        relationships={relationships}
        positions={positions}
        sizeById={sizeById}
        viewport={viewport}
        selectedId={selectedId}
        onSelectHandoff={(handoffId) => onSelect({ kind: 'handoff', id: handoffId })}
      />
      <div className="aco-legend" aria-hidden="true">
        <span><i className="is-agent" />Agent</span>
        <span><i className="is-task" />任务</span>
        <span><i className="is-output" />成果</span>
        <span><i className="is-handoff" />交接</span>
        <span><i className="is-approval" />审批</span>
      </div>
      {isEmpty ? (
        <div className="aco-canvas-empty">
          <GitBranch size={22} />
          <strong>这张协作图还没有真实对象</strong>
          <span>批准计划后，Agent、任务、审批与成果会作为真实节点出现。</span>
        </div>
      ) : null}
      {taskCount === 0 && !isEmpty ? (
        <div className="aco-canvas-hint"><CircleAlert size={12} /> 计划尚未关联任务</div>
      ) : null}
      {handoffs.length > 0 ? (
        <div className="aco-canvas-hint is-handoff"><Handshake size={12} /> {handoffs.length} 条真实交接 <ArrowRight size={11} /></div>
      ) : null}
    </div>
  )
}
