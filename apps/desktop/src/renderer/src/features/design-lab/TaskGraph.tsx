import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import ELK from 'elkjs/lib/elk.bundled.js'
import '@xyflow/react/dist/style.css'
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference'
import type { LabTask } from './data'

type NodeData = { task: LabTask; active: boolean; related: boolean; onActivate: (id: string) => void }
type GraphNode = Node<NodeData, 'pdl-task'>
type GraphEdge = Edge<{ highlighted: boolean }, 'pdl-edge'>

function LabDependencyEdge(props: EdgeProps<GraphEdge>) {
  const id = `pdl-focus-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [path] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    borderRadius: 10,
    offset: 18,
  })
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" x2="1">
          <stop stopColor="var(--pdl-accent)" />
          <stop offset="1" stopColor="var(--pdl-cyan)" />
        </linearGradient>
      </defs>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        interactionWidth={18}
        style={{ ...props.style, stroke: props.data?.highlighted ? `url(#${id})` : 'var(--pdl-edge)' }}
      />
    </>
  )
}

function LabTaskNode({ data }: NodeProps<GraphNode>) {
  return (
    <div
      className={`pdl-node${data.active ? ' is-selected' : ''}${data.related ? ' is-related' : ''}${data.task.risk ? ' is-risk' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${data.task.code} ${data.task.title}，${data.task.agent}`}
      onClick={() => data.onActivate(data.task.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          data.onActivate(data.task.id)
        }
      }}
    >
      <Handle type="target" position={Position.Left} className="pdl-port" isConnectable={false} />
      <div className="pdl-node-top">
        <span>{data.task.code}</span>
        {data.task.risk ? <i className="pdl-node-risk" /> : null}
      </div>
      <strong>{data.task.title}</strong>
      <div className="pdl-node-foot">
        <span className="pdl-node-agent">
          <i>{data.task.agent.slice(0, 1)}</i>
          {data.task.agent}
        </span>
        <span>{data.task.dependsOn.length ? `${data.task.dependsOn.length} 前置` : '起点'}</span>
      </div>
      <Handle type="source" position={Position.Right} className="pdl-port" isConnectable={false} />
    </div>
  )
}

const nodeTypes = { 'pdl-task': LabTaskNode }
const edgeTypes = { 'pdl-edge': LabDependencyEdge }
const taskSize = { width: 174, height: 104 }

export function LabTaskGraph({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: LabTask[]
  selectedId: string | null
  onSelect: (id: string) => void
}): ReactElement {
  const reduce = useReducedMotionPreference()
  const graphRef = useRef<HTMLDivElement>(null)
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [instance, setInstance] = useState<ReactFlowInstance<GraphNode, GraphEdge> | null>(null)
  const topologyKey = JSON.stringify(tasks.map(({ id, dependsOn }) => ({ id, dependsOn })))

  useEffect(() => {
    const topology = JSON.parse(topologyKey) as Array<Pick<LabTask, 'id' | 'dependsOn'>>
    let cancelled = false
    const elk = new ELK()
    void elk
      .layout({
        id: 'pdl-root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          'elk.spacing.nodeNode': '26',
          'elk.layered.spacing.nodeNodeBetweenLayers': '42',
          'elk.edgeRouting': 'ORTHOGONAL',
          'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        },
        children: topology.map((task) => ({ id: task.id, ...taskSize })),
        edges: topology.flatMap((task) =>
          task.dependsOn.map((parent) => ({
            id: `${parent}->${task.id}`,
            sources: [parent],
            targets: [task.id],
          })),
        ),
      })
      .then((result) => {
        if (cancelled) return
        const next: Record<string, { x: number; y: number }> = {}
        for (const child of result.children ?? []) next[child.id] = { x: child.x ?? 0, y: child.y ?? 0 }
        setPositions(next)
      })
      .catch((error) => {
        console.error('Design Lab ELK layout failed', error)
        if (!cancelled) setPositions({})
      })
    return () => {
      cancelled = true
    }
  }, [topologyKey])

  useEffect(() => {
    if (!instance || !graphRef.current || Object.keys(positions).length === 0) return
    let timer: number
    const fit = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void instance.fitView({ padding: 0.12, minZoom: 0.2, maxZoom: 1, duration: reduce ? 0 : 180 })
      }, 80)
    }
    const observer = new ResizeObserver(fit)
    observer.observe(graphRef.current)
    fit()
    return () => { observer.disconnect(); window.clearTimeout(timer) }
  }, [instance, positions, reduce])

  const related = useMemo(() => {
    const set = new Set<string>()
    if (!selectedId) return set
    const up = (id: string): void => {
      const task = tasks.find((item) => item.id === id)
      for (const parent of task?.dependsOn ?? [])
        if (parent !== selectedId && !set.has(parent)) {
          set.add(parent)
          up(parent)
        }
    }
    const down = (id: string): void => {
      for (const task of tasks)
        if (task.dependsOn.includes(id) && !set.has(task.id)) {
          set.add(task.id)
          down(task.id)
        }
    }
    up(selectedId)
    down(selectedId)
    return set
  }, [selectedId, tasks])

  const nodes = useMemo<GraphNode[]>(
    () =>
      tasks.map((task, index) => ({
        id: task.id,
        type: 'pdl-task',
        // Match ELK/CSS before ResizeObserver measures the card. React Flow otherwise
        // hides unmeasured nodes, including while a new plan replaces another canvas.
        initialWidth: taskSize.width,
        initialHeight: taskSize.height,
        position: positions[task.id] ?? { x: index * 270, y: index % 2 === 0 ? 20 : 44 },
        draggable: false,
        selectable: true,
        data: { task, active: selectedId === task.id, related: related.has(task.id), onActivate: onSelect },
      })),
    [onSelect, positions, related, selectedId, tasks],
  )

  const edges = useMemo<GraphEdge[]>(
    () =>
      tasks.flatMap((task) =>
        task.dependsOn.map((parent) => {
          const highlighted =
            selectedId !== null &&
            (related.has(parent) || related.has(task.id) || parent === selectedId || task.id === selectedId)
          return {
            id: `${parent}->${task.id}`,
            source: parent,
            target: task.id,
            type: 'pdl-edge',
            data: { highlighted },
            className: selectedId ? (highlighted ? 'pdl-edge is-active' : 'pdl-edge is-muted') : 'pdl-edge',
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 13,
              height: 13,
              color: highlighted ? 'var(--pdl-accent)' : 'var(--pdl-edge)',
            },
            style: { strokeWidth: highlighted ? 1.8 : 1.2 },
          }
        }),
      ),
    [related, selectedId, tasks],
  )

  return (
    <div ref={graphRef} className="pdl-dag" data-testid="design-lab-dag">
      <ReactFlow<GraphNode, GraphEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(flow) => setInstance(flow)}
        fitView
        fitViewOptions={{ padding: 0.12, minZoom: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        elementsSelectable
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={22} size={1} color="rgba(112, 139, 189, .18)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div className="pdl-dag-legend" aria-hidden="true">
        <span>
          <i className="is-start" />
          起点
        </span>
        <span>
          <i className="is-risk" />
          需复核
        </span>
        <span>
          <i className="is-path" />
          当前路径
        </span>
      </div>
    </div>
  )
}
