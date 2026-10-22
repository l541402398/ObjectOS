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
import { motion } from 'motion/react'
import { PremiumDependencyEdge, type PremiumEdgeData } from './PremiumDependencyEdge'
import type { LabTask } from './data'

type NodeData = { task: LabTask; active: boolean; related: boolean }
type GraphNode = Node<NodeData, 'pdl-task'>

function LabTaskNode({ data }: NodeProps<GraphNode>) {
  return (
    <motion.div
      className={`pdl-node${data.active ? ' is-selected' : ''}${data.related ? ' is-related' : ''}${data.task.risk ? ' is-risk' : ''}`}
      initial={false}
      animate={{ opacity: data.active || data.related ? 1 : 0.88 }}
      transition={{ duration: 0.2 }}
    >
      <Handle type="target" position={Position.Left} className="pdl-port" isConnectable={false} />
      <div className="pdl-node-top">
        <span>{data.task.code}</span>
        {data.task.risk ? <i className="pdl-node-risk" /> : null}
      </div>
      <strong>{data.task.title}</strong>
      <div className="pdl-node-foot">
        <span className="pdl-node-agent"><i>{data.task.agent.slice(0, 1)}</i>{data.task.agent}</span>
        <span>{data.task.dependsOn.length ? `${data.task.dependsOn.length} 前置` : '起点'}</span>
      </div>
      <Handle type="source" position={Position.Right} className="pdl-port" isConnectable={false} />
    </motion.div>
  )
}

const nodeTypes = { 'pdl-task': LabTaskNode }
const edgeTypes = { premiumDependency: PremiumDependencyEdge }
type PremiumEdge = Edge<PremiumEdgeData, 'premiumDependency'>

export function LabTaskGraph({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: LabTask[]
  selectedId: string | null
  onSelect: (id: string) => void
}): ReactElement {
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [instance, setInstance] = useState<ReactFlowInstance<GraphNode, PremiumEdge> | null>(null)

  useEffect(() => {
    let cancelled = false
    const elk = new ELK()
    void elk.layout({
      id: 'pdl-root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '26',
        'elk.layered.spacing.nodeNodeBetweenLayers': '42',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      },
      children: tasks.map((task) => ({ id: task.id, width: 168, height: 72 })),
      edges: tasks.flatMap((task) => task.dependsOn.map((parent) => ({
        id: `${parent}->${task.id}`,
        sources: [parent],
        targets: [task.id],
      }))),
    }).then((result) => {
      if (cancelled) return
      const next: Record<string, { x: number; y: number }> = {}
      for (const child of result.children ?? []) next[child.id] = { x: child.x ?? 0, y: child.y ?? 0 }
      setPositions(next)
    }).catch((error) => {
      console.error('Design Lab ELK layout failed', error)
      if (!cancelled) setPositions({})
    })
    return () => { cancelled = true }
  }, [tasks])

  useEffect(() => {
    if (!instance || Object.keys(positions).length === 0) return
    const timer = window.setTimeout(() => {
      void instance.fitView({ padding: 0.12, minZoom: 0.7, maxZoom: 1, duration: 300 })
    }, 40)
    return () => window.clearTimeout(timer)
  }, [instance, positions])

  const related = useMemo(() => {
    const set = new Set<string>()
    if (!selectedId) return set
    const up = (id: string): void => {
      const task = tasks.find((item) => item.id === id)
      for (const parent of task?.dependsOn ?? []) { set.add(parent); up(parent) }
    }
    const down = (id: string): void => {
      for (const task of tasks) if (task.dependsOn.includes(id) && !set.has(task.id)) { set.add(task.id); down(task.id) }
    }
    up(selectedId)
    down(selectedId)
    return set
  }, [selectedId, tasks])

  const nodes = useMemo<GraphNode[]>(() => tasks.map((task, index) => ({
    id: task.id,
    type: 'pdl-task',
    position: positions[task.id] ?? { x: index * 270, y: index % 2 === 0 ? 20 : 44 },
    draggable: false,
    selectable: true,
    data: { task, active: selectedId === task.id, related: related.has(task.id) },
  })), [positions, related, selectedId, tasks])

  const edges = useMemo<PremiumEdge[]>(() => tasks.flatMap((task) => task.dependsOn.map((parent) => {
    const highlighted = selectedId !== null && (related.has(parent) || related.has(task.id) || parent === selectedId || task.id === selectedId)
    const focused = parent === selectedId || task.id === selectedId
    return {
      id: `${parent}->${task.id}`,
      source: parent,
      target: task.id,
      type: 'premiumDependency',
      data: { highlighted, focused },
      className: selectedId && !highlighted ? 'is-muted' : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: highlighted ? '#8fa8eb' : 'var(--pdl-muted)' },
    }
  })), [related, selectedId, tasks])

  return (
    <div className="pdl-dag" data-testid="design-lab-dag">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(flow) => setInstance(flow)}
        onNodeClick={(_event, node) => onSelect(node.id)}
        fitView
        fitViewOptions={{ padding: 0.12, minZoom: 0.7, maxZoom: 1 }}
        minZoom={0.35}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={22} size={1} color="rgba(112, 139, 189, .18)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div className="pdl-dag-legend" aria-hidden="true">
        <span><i className="is-start" />起点</span>
        <span><i className="is-risk" />需复核</span>
        <span><i className="is-path" />当前路径</span>
      </div>
    </div>
  )
}
