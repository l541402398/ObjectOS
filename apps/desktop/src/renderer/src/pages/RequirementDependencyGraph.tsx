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
import type {
  RequirementFlowGraph,
  RequirementFlowStep,
  RequirementMaterial,
  TaskCard,
  TaskFlow,
} from '@projectos/contracts'
import { AgentAvatar, resolveAgentWorkActivity } from '@projectos/ui'
import { useReducedMotionPreference } from '../hooks/useReducedMotionPreference'

export interface ReqDagItem {
  id: string
  kind: 'task' | 'stage'
  taskId: string
  stepId?: string
  nodeId?: string
  code: string
  title: string
  subtitle: string
  agentName: string
  agentRole?: string
  status: 'completed' | 'running' | 'waiting_approval' | 'failed' | 'ready' | 'pending'
  statusLabel: string
  dependsOn: string[]
  materialTitle?: string
  materialCount: number
  isWorking: boolean
  workActivity: 'coding' | 'writing'
}

type NodeData = {
  item: ReqDagItem
  active: boolean
  related: boolean
  onActivate: (item: ReqDagItem) => void
}

type GraphNode = Node<NodeData, 'rq-dl-node'>
type GraphEdge = Edge<{ highlighted: boolean }, 'rq-dl-edge'>

const STAGE_EXPECTED_OUTPUT: Record<string, string> = {
  requirement_analysis: '需求分析文档',
  requirement_review: '需求审核结论',
  technical_design: '技术设计文档',
  design_review: '技术设计审核结论',
  development: '开发成果与代码',
  code_review: '代码审查结论',
  testing: '实际测试报告',
  custom: '阶段交付物',
}

function ReqDependencyEdge(props: EdgeProps<GraphEdge>): ReactElement {
  const id = `rq-dl-focus-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
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
          <stop stopColor="#4f46e5" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        interactionWidth={18}
        style={{
          ...props.style,
          stroke: props.data?.highlighted ? `url(#${id})` : 'rgba(100, 116, 139, 0.42)',
        }}
      />
    </>
  )
}

function ReqDagNode({ data }: NodeProps<GraphNode>): ReactElement {
  const { item } = data
  const toneClass =
    item.status === 'completed'
      ? 'is-done'
      : item.status === 'running'
        ? 'is-running'
        : item.status === 'waiting_approval'
          ? 'is-warn'
          : item.status === 'failed'
            ? 'is-risk'
            : 'is-pending'

  return (
    <div
      className={`rq-dl-dag-node ${item.kind === 'task' ? 'is-task-root' : 'is-stage-node'} ${toneClass}${
        data.active ? ' is-selected' : ''
      }${data.related ? ' is-related' : ''}`}
      role="button"
      tabIndex={0}
      data-testid={`rq-dag-node-${item.id}`}
      aria-label={`${item.code} ${item.title}，${item.agentName}`}
      onClick={() => data.onActivate(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          data.onActivate(item)
        }
      }}
    >
      <Handle type="target" position={Position.Left} className="rq-dl-port" isConnectable={false} />
      <div className="rq-dl-node-top">
        <span className="rq-dl-node-code">{item.code}</span>
        <span className={`rq-dl-node-status ${toneClass}`}>{item.statusLabel}</span>
      </div>
      <strong className="rq-dl-node-title">{item.title}</strong>
      <span className="rq-dl-node-sub">{item.materialTitle ? `📄 ${item.materialTitle}` : item.subtitle}</span>
      <div className="rq-dl-node-foot">
        <span className="rq-dl-node-agent">
          <AgentAvatar
            name={item.agentName}
            role={item.agentRole}
            size={20}
            status={item.isWorking ? 'working' : 'idle'}
            activity={item.workActivity}
          />
          <b>{item.agentName}</b>
        </span>
        <span className="rq-dl-node-dep">
          {item.materialCount > 0
            ? `${item.materialCount} 份产出`
            : item.dependsOn.length
              ? `${item.dependsOn.length} 前置`
              : '起点'}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="rq-dl-port" isConnectable={false} />
    </div>
  )
}

const nodeTypes = { 'rq-dl-node': ReqDagNode }
const edgeTypes = { 'rq-dl-edge': ReqDependencyEdge }
const nodeSize = { width: 208, height: 122 }

function mapStepTone(status: RequirementFlowStep['status']): {
  normalized: ReqDagItem['status']
  label: string
} {
  if (status === 'completed') return { normalized: 'completed', label: '✓ 已完成' }
  if (status === 'running' || status === 'starting') return { normalized: 'running', label: '● 执行中' }
  if (status === 'waiting_approval') return { normalized: 'waiting_approval', label: '待授权' }
  if (status === 'failed' || status === 'needs_reconciliation') return { normalized: 'failed', label: '需处理' }
  if (status === 'ready') return { normalized: 'ready', label: '可开始' }
  return { normalized: 'pending', label: '待流转' }
}

export function RequirementDependencyGraph({
  graph,
  tasks,
  taskFlows,
  materials,
  selectedTaskId,
  onSelectTask,
  onOpenStageMaterial,
}: {
  graph?: RequirementFlowGraph
  tasks: TaskCard[]
  taskFlows: TaskFlow[]
  materials: RequirementMaterial[]
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
  onOpenStageMaterial?: (nodeId: string) => void
}): ReactElement {
  const reduce = useReducedMotionPreference()
  const graphRef = useRef<HTMLDivElement>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(selectedTaskId)
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [instance, setInstance] = useState<ReactFlowInstance<GraphNode, GraphEdge> | null>(null)

  const items = useMemo<ReqDagItem[]>(() => {
    const result: ReqDagItem[] = []
    tasks.forEach((task, tIdx) => {
      const tf = taskFlows.find((f) => f.taskId === task.id)
      const steps = tf?.steps ?? []
      const activeStep =
        steps.find((s) => s.status === 'running' || s.status === 'starting' || s.status === 'waiting_approval') ??
        steps.find((s) => s.status === 'ready') ??
        steps[steps.length - 1]
      const doneSteps = steps.filter((s) => s.status === 'completed' && !s.stale).length
      const taskMaterials = materials.filter((m) => m.taskId === task.id)
      const isTaskRunning = tf?.status === 'running'
      const isTaskDone = tf?.status === 'completed' || task.status === 'done'

      const parentTaskSteps = task.dependencyIds
        .map((depTaskId: string) => {
          const depFlow = taskFlows.find((f) => f.taskId === depTaskId)
          const lastStep = depFlow?.steps[depFlow.steps.length - 1]
          return lastStep?.id ?? depTaskId
        })
        .filter(Boolean)

      result.push({
        id: task.id,
        kind: 'task',
        taskId: task.id,
        code: `TASK ${String(tIdx + 1).padStart(2, '0')}`,
        title: task.title,
        subtitle: steps.length > 0 ? `流程进度 ${doneSteps}/${steps.length} 阶段` : '交付任务起点',
        agentName: activeStep?.agentName ?? '待分配',
        agentRole: '任务负责人',
        status: isTaskDone ? 'completed' : isTaskRunning ? 'running' : 'ready',
        statusLabel: isTaskDone ? '✓ 已完成' : isTaskRunning ? `阶段 ${doneSteps}/${steps.length}` : '交付任务',
        dependsOn: parentTaskSteps,
        materialCount: taskMaterials.length,
        isWorking: Boolean(isTaskRunning),
        workActivity: 'coding',
      })

      steps.forEach((step, sIdx) => {
        const incomingStepIds: string[] = []
        if (graph?.edges && graph.edges.length > 0) {
          const parentNodeIds = graph.edges.filter((e) => e.target === step.nodeId).map((e) => e.source)
          for (const pNodeId of parentNodeIds) {
            const pStep = steps.find((s) => s.nodeId === pNodeId)
            if (pStep) incomingStepIds.push(pStep.id)
          }
        }
        if (incomingStepIds.length === 0) {
          if (sIdx === 0) incomingStepIds.push(task.id)
          else if (steps[sIdx - 1]) incomingStepIds.push(steps[sIdx - 1]!.id)
        }

        const stepMaterials = materials.filter(
          (m) => m.stepId === step.id || (m.taskId === task.id && m.nodeId === step.nodeId),
        )
        const latestMat = stepMaterials[0]
        const tone = mapStepTone(step.status)
        const isWorking = step.status === 'running' || step.status === 'starting'
        const workActivity: 'coding' | 'writing' =
          step.stage === 'development' || step.stage === 'testing'
            ? 'coding'
            : step.stage
              ? 'writing'
              : resolveAgentWorkActivity({
                  status: 'working',
                  role: step.stage,
                  taskTitle: step.title,
                }) === 'writing'
                ? 'writing'
                : 'coding'

        result.push({
          id: step.id,
          kind: 'stage',
          taskId: task.id,
          stepId: step.id,
          nodeId: step.nodeId,
          code: `STAGE ${String(sIdx + 1).padStart(2, '0')}`,
          title: `${step.title}${tasks.length > 1 ? ` · T${tIdx + 1}` : ''}`,
          subtitle: `预期产出：${STAGE_EXPECTED_OUTPUT[step.stage] ?? '阶段交付物'}`,
          agentName: step.agentName ?? '待分配',
          agentRole: step.stage,
          status: tone.normalized,
          statusLabel: tone.label,
          dependsOn: incomingStepIds,
          materialTitle: latestMat?.title,
          materialCount: stepMaterials.length,
          isWorking,
          workActivity,
        })
      })
    })
    return result
  }, [graph, materials, taskFlows, tasks])

  const topologyKey = JSON.stringify(items.map(({ id, dependsOn }) => ({ id, dependsOn })))

  useEffect(() => {
    const topology = JSON.parse(topologyKey) as Array<Pick<ReqDagItem, 'id' | 'dependsOn'>>
    if (topology.length === 0) return
    let cancelled = false
    const elk = new ELK()
    void elk
      .layout({
        id: 'rq-dl-root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          'elk.spacing.nodeNode': '28',
          'elk.layered.spacing.nodeNodeBetweenLayers': '46',
          'elk.edgeRouting': 'ORTHOGONAL',
          'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        },
        children: topology.map((item) => ({ id: item.id, ...nodeSize })),
        edges: topology.flatMap((item) =>
          item.dependsOn.map((parent) => ({
            id: `${parent}->${item.id}`,
            sources: [parent],
            targets: [item.id],
          })),
        ),
      })
      .then((result) => {
        if (cancelled) return
        const next: Record<string, { x: number; y: number }> = {}
        for (const child of result.children ?? []) {
          next[child.id] = { x: child.x ?? 0, y: child.y ?? 0 }
        }
        setPositions(next)
      })
      .catch((error) => {
        console.error('Requirement DAG ELK layout failed', error)
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
        void instance.fitView({ padding: 0.12, minZoom: 0.25, maxZoom: 1.05, duration: reduce ? 0 : 180 })
      }, 60)
    }
    const observer = new ResizeObserver(fit)
    observer.observe(graphRef.current)
    fit()
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [instance, positions, reduce])

  const related = useMemo(() => {
    const set = new Set<string>()
    if (!selectedItemId) return set
    const up = (id: string): void => {
      const curr = items.find((item) => item.id === id)
      for (const parent of curr?.dependsOn ?? []) {
        if (parent !== selectedItemId && !set.has(parent)) {
          set.add(parent)
          up(parent)
        }
      }
    }
    const down = (id: string): void => {
      for (const item of items) {
        if (item.dependsOn.includes(id) && !set.has(item.id)) {
          set.add(item.id)
          down(item.id)
        }
      }
    }
    up(selectedItemId)
    down(selectedItemId)
    return set
  }, [items, selectedItemId])

  const nodes = useMemo<GraphNode[]>(
    () =>
      items.map((item, index) => ({
        id: item.id,
        type: 'rq-dl-node',
        initialWidth: nodeSize.width,
        initialHeight: nodeSize.height,
        position: positions[item.id] ?? { x: index * 240, y: index % 2 === 0 ? 24 : 56 },
        draggable: false,
        selectable: true,
        data: {
          item,
          active: selectedItemId === item.id,
          related: related.has(item.id),
          onActivate: (clicked) => {
            setSelectedItemId(clicked.id)
            onSelectTask(clicked.taskId)
          },
        },
      })),
    [items, onSelectTask, positions, related, selectedItemId],
  )

  const edges = useMemo<GraphEdge[]>(
    () =>
      items.flatMap((item) =>
        item.dependsOn.map((parent) => {
          const highlighted =
            selectedItemId !== null &&
            (related.has(parent) || related.has(item.id) || parent === selectedItemId || item.id === selectedItemId)
          return {
            id: `${parent}->${item.id}`,
            source: parent,
            target: item.id,
            type: 'rq-dl-edge',
            data: { highlighted },
            className: selectedItemId ? (highlighted ? 'rq-dl-edge is-active' : 'rq-dl-edge is-muted') : 'rq-dl-edge',
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 13,
              height: 13,
              color: highlighted ? '#4f46e5' : 'rgba(100, 116, 139, 0.55)',
            },
            style: { strokeWidth: highlighted ? 2.1 : 1.35 },
          }
        }),
      ),
    [items, related, selectedItemId],
  )

  const selectedItem = items.find((i) => i.id === selectedItemId) ?? items[0] ?? null
  const totalEdges = items.reduce((acc, i) => acc + i.dependsOn.length, 0)

  return (
    <div className="rq-dl-dag-wrap" data-testid="requirement-dependency-map">
      <div className="rq-dl-dag-head">
        <div>
          <span className="rq-dl-eyebrow">DEPENDENCY MAP · 需求全链路依赖与阶段流转图</span>
          <h4>
            共 {tasks.length} 项交付任务 · {items.filter((i) => i.kind === 'stage').length} 个阶段节点 · {totalEdges} 条依赖连线
          </h4>
        </div>
        <div className="rq-dl-dag-legend-inline">
          <span><i className="is-done" />已完成</span>
          <span><i className="is-running" />执行中</span>
          <span><i className="is-pending" />待流转</span>
          <span><i className="is-path" />上下游高亮路径</span>
        </div>
      </div>

      <div ref={graphRef} className="rq-dl-dag-canvas">
        <ReactFlow<GraphNode, GraphEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={(flow) => setInstance(flow)}
          fitView
          fitViewOptions={{ padding: 0.12, minZoom: 0.25, maxZoom: 1.05 }}
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
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
      </div>

      {selectedItem && (
        <div className="rq-dl-dag-inspector-bar">
          <div className="rq-dl-dag-inspector-main">
            <span className="rq-dl-node-code">{selectedItem.code}</span>
            <strong>{selectedItem.title}</strong>
            <span className="rq-secondary">负责 Agent：{selectedItem.agentName}</span>
            {selectedItem.materialTitle && (
              <span className="rq-dl-material-pill">📄 已产出：{selectedItem.materialTitle}</span>
            )}
          </div>
          <div className="rq-dl-dag-inspector-actions">
            {selectedItem.nodeId && selectedItem.materialCount > 0 && onOpenStageMaterial && (
              <button
                type="button"
                className="rq-dl-link-btn"
                onClick={() => onOpenStageMaterial(selectedItem.nodeId!)}
              >
                查看该阶段产出资料 →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
