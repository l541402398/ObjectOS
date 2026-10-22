import { useEffect, useMemo, useState, type ReactElement } from 'react'
import ELK from 'elkjs/lib/elk.bundled.js'
import '@xyflow/react/dist/style.css'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import type { PlannedTask } from '@projectos/contracts'

type GraphNodeData = {
  task: PlannedTask
  index: number
  active: boolean
  risk: boolean
  selected: boolean
  related: boolean
  agent: string
}

type GraphNode = Node<GraphNodeData, 'premium-task'>

function TaskNode({ data }: NodeProps<GraphNode>) {
  return (
    <div
      className={[
        'pui-dag-node',
        data.active ? 'is-active' : '',
        data.selected ? 'is-selected' : '',
        data.related ? 'is-related' : '',
        data.risk ? 'is-risk' : '',
      ].filter(Boolean).join(' ')}
    >
      <Handle type="target" position={Position.Left} className="po-biz-port" isConnectable={false} />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-medium tracking-[.06em] text-[var(--pui-accent)]">TASK {String(data.index + 1).padStart(2, '0')}</span>
        {data.risk ? <span className="rounded-full bg-[var(--pui-danger-soft)] px-1.5 py-0.5 text-[11px] text-[var(--pui-danger)]">需复核</span> : null}
      </div>
      <h4 className="mt-1.5 line-clamp-2 min-h-[34px] text-[12.5px] font-semibold leading-[1.4] text-[var(--pui-ink)]" title={data.task.title}>{data.task.title}</h4>
      <div className="mt-2 flex items-center justify-between border-t border-[var(--pui-border)] pt-1.5 text-[11.5px] text-[var(--pui-ink-muted)]">
        <span className="truncate">{data.agent}</span>
        <span>{data.task.dependsOn.length ? `${data.task.dependsOn.length} 前置` : '起点'}</span>
      </div>
      <Handle type="source" position={Position.Right} className="po-biz-port" isConnectable={false} />
    </div>
  )
}

const nodeTypes = { 'premium-task': TaskNode }

export function TaskGraph({
  tasks,
  stages,
  activeStage,
  selectedTaskKey,
  agentLabels,
  onSelect,
}: {
  tasks: PlannedTask[]
  stages: Array<{ id: string; entries: Array<{ task: PlannedTask }> }>
  activeStage: string
  selectedTaskKey: string | null
  agentLabels: Record<string, string>
  onSelect: (taskKey: string) => void
}): ReactElement {
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [instance, setInstance] = useState<ReactFlowInstance<GraphNode, Edge> | null>(null)

  useEffect(() => {
    let cancelled = false
    const graph = new ELK()
    void graph.layout({
      id: 'projectos-plan-dag',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '28',
        'elk.layered.spacing.nodeNodeBetweenLayers': '48',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      },
      children: tasks.map((task) => ({ id: task.key, width: 188, height: 92 })),
      edges: tasks.flatMap((task) => task.dependsOn.filter((dependency) => tasks.some((item) => item.key === dependency)).map((dependency) => ({
        id: `${dependency}->${task.key}`,
        sources: [dependency],
        targets: [task.key],
      }))),
    }).then((result) => {
      if (cancelled) return
      const next: Record<string, { x: number; y: number }> = {}
      for (const child of result.children ?? []) next[child.id] = { x: child.x ?? 0, y: child.y ?? 0 }
      setPositions(next)
    }).catch((error) => {
      console.error('Plan DAG layout failed; using deterministic fallback', error)
      if (!cancelled) setPositions({})
    })
    return () => { cancelled = true }
  }, [tasks])

  useEffect(() => {
    if (!instance || Object.keys(positions).length === 0) return
    const timer = window.setTimeout(() => { void instance.fitView({ padding: 0.12, minZoom: 0.7, maxZoom: 1, duration: 260 }) }, 40)
    return () => window.clearTimeout(timer)
  }, [instance, positions])

  const stageByTask = useMemo(() => {
    const map = new Map<string, string>()
    for (const stage of stages) for (const entry of stage.entries) map.set(entry.task.key, stage.id)
    return map
  }, [stages])

  const related = useMemo(() => {
    const keys = new Set<string>()
    if (!selectedTaskKey) return keys
    const up = (key: string): void => {
      const current = tasks.find((task) => task.key === key)
      for (const dependency of current?.dependsOn ?? []) { keys.add(dependency); up(dependency) }
    }
    const down = (key: string): void => {
      for (const task of tasks) if (task.dependsOn.includes(key) && !keys.has(task.key)) { keys.add(task.key); down(task.key) }
    }
    up(selectedTaskKey)
    down(selectedTaskKey)
    return keys
  }, [selectedTaskKey, tasks])

  const nodes = useMemo<GraphNode[]>(() => tasks.map((task, index) => ({
    id: task.key,
    type: 'premium-task',
    position: positions[task.key] ?? { x: index * 280, y: index % 2 === 0 ? 12 : 34 },
    draggable: false,
    selectable: true,
    data: {
      task,
      index,
      active: stageByTask.get(task.key) === activeStage,
      risk: task.assignmentBlocked,
      selected: selectedTaskKey === task.key,
      related: related.has(task.key),
      agent: (task.agentId ? agentLabels[task.agentId] : undefined)?.split(' · ')[0] ?? '角色默认',
    },
  })), [activeStage, agentLabels, positions, related, selectedTaskKey, stageByTask, tasks])

  const edges = useMemo<Edge[]>(() => tasks.flatMap((task) => task.dependsOn.filter((dependency) => tasks.some((item) => item.key === dependency)).map((dependency) => {
    const isRelated = !selectedTaskKey || related.has(dependency) || related.has(task.key) || dependency === selectedTaskKey || task.key === selectedTaskKey
    return {
      id: `${dependency}->${task.key}`,
      source: dependency,
      target: task.key,
      type: 'smoothstep',
      className: selectedTaskKey ? (isRelated ? 'pui-edge-related' : 'pui-edge-dimmed') : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: isRelated ? '#7f99bb' : '#aeb9c8' },
      style: { stroke: isRelated ? 'rgba(103,132,172,.78)' : 'rgba(150,164,184,.3)', strokeWidth: isRelated ? 1.5 : 1 },
    }
  })), [related, selectedTaskKey, tasks])

  return (
    <div data-testid="plan-task-dag" className="pui-dag-wrap h-[300px] overflow-hidden rounded-[15px] border border-[var(--pui-border)]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={(flow) => setInstance(flow)}
        onNodeClick={(_event, node) => onSelect(node.id)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.12, minZoom: 0.7, maxZoom: 1, duration: 260 }}
        minZoom={0.35}
        maxZoom={1.5}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="rgba(110,144,203,.14)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}


