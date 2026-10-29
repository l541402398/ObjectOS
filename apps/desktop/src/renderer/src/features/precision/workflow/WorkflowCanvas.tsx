import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import ELK from 'elkjs/lib/elk.bundled.js'
import '@xyflow/react/dist/style.css'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type XYPosition,
} from '@xyflow/react'
import { Lock, Workflow } from 'lucide-react'
import {
  WORKFLOW_KINDS,
  type WorkflowEdgeDef,
  type WorkflowKind,
  type WorkflowNodeDef,
} from '../data'

export const FLOW_NODE_WIDTH = 214
export const FLOW_NODE_HEIGHT = 88

type FlowNodeData = {
  label: string
  kind: WorkflowKind
  kindLabel: string
  role: string
  mandatory: boolean
  outputs: number
  index: number
  selected: boolean
}
type GraphNode = Node<FlowNodeData, 'pw-flow'>

function WorkflowNodeCard({ data }: NodeProps<GraphNode>): ReactNode {
  const meta = WORKFLOW_KINDS[data.kind]
  return (
    <div className={`pw-flow-node is-${meta.tone}${data.selected ? ' is-selected' : ''}${data.mandatory ? ' is-mandatory' : ''}`}>
      <Handle type="target" position={Position.Top} className="pw-flow-port" />
      <div className="pw-flow-node-top">
        <span className="pw-flow-index pw-mono">{String(data.index).padStart(2, '0')}</span>
        <span className="pw-flow-kind">{data.kindLabel}</span>
        {data.mandatory ? <Lock size={10} className="pw-flow-lock" aria-label="组织强制门禁" /> : null}
      </div>
      <strong className="pw-flow-node-title">{data.label}</strong>
      <div className="pw-flow-node-foot">
        <span>{data.role || '未指定角色'}</span>
        <span className="pw-flow-outputs pw-num">{data.outputs} 项输出</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="pw-flow-port" />
    </div>
  )
}

const nodeTypes = { 'pw-flow': WorkflowNodeCard }

function FlowInner({
  nodes,
  edges,
  positions,
  selectedId,
  layoutNonce,
  fitNonce,
  onSelect,
  onNodeMoved,
  onLayout,
  onDropNode,
  onConnect,
}: {
  nodes: WorkflowNodeDef[]
  edges: WorkflowEdgeDef[]
  positions: Record<string, XYPosition>
  selectedId: string | null
  layoutNonce: number
  fitNonce: number
  onSelect: (id: string | null) => void
  onNodeMoved: (id: string, position: XYPosition) => void
  onLayout: (positions: Record<string, XYPosition>) => void
  onDropNode: (kind: WorkflowKind, position: XYPosition) => void
  onConnect: (source: string, target: string) => void
}): ReactNode {
  const instanceRef = useRef<ReactFlowInstance<GraphNode, Edge> | null>(null)
  const { screenToFlowPosition } = useReactFlow()
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<GraphNode>([])

  useEffect(() => {
    if (!fitNonce) return
    void instanceRef.current?.fitView({ padding: 0.08, minZoom: 0.5, maxZoom: 1, duration: 260 })
  }, [fitNonce])

  const graph = useMemo(
    () => nodes.map((node, index) => ({
      id: node.id,
      type: 'pw-flow' as const,
      position: positions[node.id] ?? { x: index * 250, y: 0 },
      data: {
        label: node.title,
        kind: node.kind,
        kindLabel: WORKFLOW_KINDS[node.kind].label,
        role: node.role,
        mandatory: node.mandatory,
        outputs: node.outputs.length,
        index: index + 1,
        selected: node.id === selectedId,
      },
      draggable: true,
      selectable: true,
      width: FLOW_NODE_WIDTH,
      height: FLOW_NODE_HEIGHT,
    })),
    [nodes, positions, selectedId],
  )

  useEffect(() => {
    setFlowNodes(graph)
  }, [graph, setFlowNodes])

  useEffect(() => {
    let cancelled = false
    const elk = new ELK()
    void elk
      .layout({
        id: 'pw-flow-root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'DOWN',
          'elk.spacing.nodeNode': '24',
          'elk.layered.spacing.nodeNodeBetweenLayers': '40',
          'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
          'elk.edgeRouting': 'SPLINES',
        },
        children: nodes.map((node) => ({ id: node.id, width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT })),
        edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
      })
      .then((result) => {
        if (cancelled) return
        const next: Record<string, XYPosition> = {}
        for (const child of result.children ?? []) next[child.id] = { x: child.x ?? 0, y: child.y ?? 0 }
        onLayout(next)
      })
      .catch((error: unknown) => {
        console.error('Workflow ELK layout failed', error)
      })
    return () => {
      cancelled = true
    }
    // layoutNonce is an explicit "re-layout" request from the toolbar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutNonce, nodes.map((node) => node.id).join('|'), edges.map((edge) => `${edge.source}>${edge.target}`).join('|')])

  const rfEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => {
        const active = selectedId !== null && (edge.source === selectedId || edge.target === selectedId)
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: 'smoothstep',
          label: edge.label,
          className: `pw-flow-edge${active ? ' is-active' : ''}${edge.conditional ? ' is-conditional' : ''}${selectedId && !active ? ' is-muted' : ''}`,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: active ? 'var(--pw-edge-active)' : 'var(--pw-edge)',
          },
          style: {
            stroke: active ? 'var(--pw-edge-active)' : 'var(--pw-edge)',
            strokeWidth: active ? 1.8 : 1.35,
            strokeDasharray: edge.conditional ? '5 4' : undefined,
          },
          labelStyle: { fontSize: 10.5, fill: 'var(--pw-muted)', fontWeight: 500 },
          labelBgStyle: { fill: 'var(--pw-surface)', fillOpacity: 0.94 },
          labelBgPadding: [5, 2] as [number, number],
          labelBgBorderRadius: 4,
        }
      }),
    [edges, selectedId],
  )

  return (
    <div className="pw-flow-canvas">
      <ReactFlow
        nodes={flowNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onInit={(flow) => {
          instanceRef.current = flow
        }}
        defaultViewport={{ x: 70, y: 18, zoom: 0.82 }}
        onNodesChange={onNodesChange}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        onNodeDragStop={(_event, node) => onNodeMoved(node.id, node.position)}
        onConnect={(params) => {
          if (params.source && params.target) onConnect(params.source, params.target)
        }}
        connectionLineStyle={{ stroke: 'var(--pw-accent)', strokeWidth: 1.6 }}
        minZoom={0.32}
        maxZoom={1.4}
        nodesConnectable
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(event) => {
          event.preventDefault()
          const raw = event.dataTransfer.getData('application/x-projectos-node')
          if (!raw || !(raw in WORKFLOW_KINDS)) return
          const position = screenToFlowPosition({ x: event.clientX - FLOW_NODE_WIDTH / 2, y: event.clientY - FLOW_NODE_HEIGHT / 2 })
          onDropNode(raw as WorkflowKind, position)
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.1} color="var(--pw-grid-dot)" />
        <Controls showInteractive={false} className="pw-flow-controls" />
        <MiniMap
          className="pw-flow-minimap"
          pannable
          zoomable
          nodeColor="var(--pw-accent-line)"
          maskColor="rgba(15, 23, 36, 0.06)"
        />
      </ReactFlow>
      {flowNodes.length === 0 ? (
        <div className="pw-flow-empty">
          <Workflow size={20} />
          <strong>流程还没有节点</strong>
          <span>从左侧节点库拖入节点开始编排。</span>
        </div>
      ) : null}
    </div>
  )
}

export function WorkflowCanvas(props: {
  nodes: WorkflowNodeDef[]
  edges: WorkflowEdgeDef[]
  positions: Record<string, XYPosition>
  selectedId: string | null
  layoutNonce: number
  fitNonce: number
  onSelect: (id: string | null) => void
  onNodeMoved: (id: string, position: XYPosition) => void
  onLayout: (positions: Record<string, XYPosition>) => void
  onDropNode: (kind: WorkflowKind, position: XYPosition) => void
  onConnect: (source: string, target: string) => void
}): ReactNode {
  const handleLayout = useCallback((next: Record<string, XYPosition>) => props.onLayout(next), [props])
  return (
    <ReactFlowProvider>
      <FlowInner {...props} onLayout={handleLayout} />
    </ReactFlowProvider>
  )
}
