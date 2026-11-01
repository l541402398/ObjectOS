import { useCallback, useMemo, useState } from 'react'
import { Alert, Button, Input, Select, Tooltip } from 'antd'
import { PlusOutlined, DeleteOutlined, ArrowLeftOutlined, SaveOutlined } from '@ant-design/icons'
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Node, type NodeProps, type Edge, applyNodeChanges } from '@xyflow/react'
import { REQUIREMENT_STAGES, RequirementFlowGraphSchema, type RequirementFlowGraph, type RequirementFlowTemplate, type RequirementStage } from '@projectos/contracts'
import { useMutation } from '@tanstack/react-query'
import { errorMessage } from '../lib/errors'
import '@xyflow/react/dist/style.css'

type FlowNode = Node<{ title: string; stage: RequirementStage; output: string }, 'requirement-stage'>
const stageEntries = Object.entries(REQUIREMENT_STAGES) as Array<[RequirementStage, (typeof REQUIREMENT_STAGES)[RequirementStage]]>
function StageNode({ data, selected }: NodeProps<FlowNode>) {
  return <div className={`rq-flow-node${selected ? ' is-selected' : ''}`}>
    <Handle type="target" position={Position.Left} aria-hidden />
    <span className="rq-flow-node-label">{REQUIREMENT_STAGES[data.stage].label}</span><strong>{data.title}</strong><span>{data.output}</span>
    <Handle type="source" position={Position.Right} aria-hidden />
  </div>
}
const nodeTypes = { 'requirement-stage': StageNode }

function FlowEditorBody({ projectId, initial, onSaved, onCancel, onDirty }: {
  projectId: string; initial?: RequirementFlowTemplate; onSaved: (template: RequirementFlowTemplate) => void; onCancel: () => void; onDirty?: () => void
}) {
  const [name, setName] = useState(initial ? `${initial.name}${initial.builtin ? ' · 自定义' : ''}` : '')
  const [description] = useState(initial?.description ?? '')
  const [graph, setGraph] = useState<RequirementFlowGraph>(initial?.graph ?? { nodes: [], edges: [] })
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(initial?.layout ?? {})
  const [measurements, setMeasurements] = useState<Record<string, FlowNode['measured']>>({})
  const [dirty, setDirty] = useState(false)
  const [confirmBack, setConfirmBack] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { screenToFlowPosition, fitView } = useReactFlow<FlowNode>()
  const node = graph.nodes.find(item => item.id === selected)
  const nodes = useMemo<FlowNode[]>(() => graph.nodes.map((item, index) => ({ id: item.id, type: 'requirement-stage', selected: selected === item.id,
    position: positions[item.id] ?? { x: (index % 3) * 260, y: Math.floor(index / 3) * 150 },
    measured: measurements[item.id],
    data: { title: item.title, stage: item.stage, output: item.outputs.join('、') || REQUIREMENT_STAGES[item.stage].output } })), [graph.nodes, positions, measurements, selected])
  const edges = useMemo<Edge[]>(() => graph.edges.map(edge => ({ ...edge, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } })), [graph.edges])
  const markDirty = () => { setDirty(true); onDirty?.() }
  const change = (next: RequirementFlowGraph) => { setGraph(next); setError(null); markDirty() }
  const add = (stage: RequirementStage, position?: { x: number; y: number }) => {
    const id = `node-${crypto.randomUUID()}`, meta = REQUIREMENT_STAGES[stage], previous = graph.nodes.at(-1)
    change({ nodes: [...graph.nodes, { id, stage, kind: meta.kind, title: meta.label, role: meta.role, instructions: '', inputs: [], outputs: [meta.output], optional: false }],
      edges: [...graph.edges, ...(previous ? [{ id: `edge-${crypto.randomUUID()}`, source: previous.id, target: id }] : [])] })
    const previousPosition = previous ? positions[previous.id] ?? { x: 0, y: 0 } : null
    setPositions(current => ({ ...current, [id]: position ?? (previousPosition ? { x: previousPosition.x + 280, y: previousPosition.y } : { x: 40, y: 100 }) }))
    setSelected(id)
  }
  const connect = useCallback((source: string, target: string) => {
    const next = { ...graph, edges: [...graph.edges, { id: `edge-${crypto.randomUUID()}`, source, target }] }
    const parsed = RequirementFlowGraphSchema.safeParse(next)
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '连接无效'); return }
    setGraph(parsed.data); setError(null); setDirty(true); onDirty?.()
  }, [graph, onDirty])
  const save = useMutation({ mutationFn: async () => {
    if (!name.trim()) throw new Error('请为流程命名')
    const parsed = RequirementFlowGraphSchema.safeParse(graph)
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '请添加流程节点')
    return window.projectos.workflows.save({ projectId, name: name.trim(), description, graph: parsed.data, layout: positions,
      ...(!initial?.builtin && initial ? { templateId: initial.id, expectedVersion: initial.version } : {}) })
  }, onSuccess: onSaved })
  return <div className="rq-flow-editor">
    <div className="rq-flow-editor-bar"><Button icon={<ArrowLeftOutlined aria-hidden />} disabled={save.isPending} onClick={() => dirty ? setConfirmBack(true) : onCancel()}>返回</Button><Input aria-label="流程名称" placeholder="为这个流程命名" maxLength={120} value={name} onChange={event => { setName(event.target.value); markDirty() }} /><Button type="primary" icon={<SaveOutlined aria-hidden />} loading={save.isPending} onClick={() => save.mutate()}>保存流程</Button></div>
    {confirmBack && <Alert type="warning" message="流程还有未保存的修改" action={<div className="rq-inline-actions"><Button onClick={() => setConfirmBack(false)}>继续编辑</Button><Button danger onClick={onCancel}>放弃修改并返回</Button></div>} />}
    {(error || save.isError) && <Alert type="error" showIcon message={error ?? errorMessage(save.error)} />}
    <div className="rq-flow-stage-palette" aria-label="流程节点库">{stageEntries.map(([stage, meta]) => <Tooltip key={stage} title={`拖到画布或点击添加${meta.label}`}><Button draggable onDragStart={event => { event.dataTransfer.setData('application/projectos-stage', stage); event.dataTransfer.effectAllowed = 'copy' }} icon={<PlusOutlined aria-hidden />} onClick={() => add(stage)}>{meta.label}</Button></Tooltip>)}</div>
    <div className={`rq-flow-editor-main${node ? ' has-inspector' : ''}`}>
      <div className="rq-flow-editor-canvas" aria-label="流程编辑画布" onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDrop={event => { event.preventDefault(); const stage = event.dataTransfer.getData('application/projectos-stage') as RequirementStage; if (stage in REQUIREMENT_STAGES) add(stage, screenToFlowPosition({ x: event.clientX, y: event.clientY })) }}>
        <ReactFlow<FlowNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ maxZoom: 1 }} minZoom={0.35} maxZoom={1.6}
          onNodesChange={changes => {
            const next = applyNodeChanges(changes, nodes)
            // Keep React Flow's measured dimensions; discarding them leaves new nodes hidden.
            if (changes.some(change => change.type === 'dimensions')) setMeasurements(Object.fromEntries(next.map(item => [item.id, item.measured])))
            if (changes.some(change => change.type === 'position')) { setPositions(Object.fromEntries(next.map(item => [item.id, item.position]))); markDirty() }
          }}
          onNodeClick={(_, item) => setSelected(item.id)} onPaneClick={() => setSelected(null)} onConnect={edge => { if (edge.source && edge.target) connect(edge.source, edge.target) }}
          onEdgesDelete={deleted => change({ ...graph, edges: graph.edges.filter(edge => !deleted.some(item => item.id === edge.id)) })}
          onNodesDelete={deleted => { const ids = new Set(deleted.map(item => item.id)); change({ nodes: graph.nodes.filter(item => !ids.has(item.id)), edges: graph.edges.filter(edge => !ids.has(edge.source) && !ids.has(edge.target)) }); setSelected(null) }}
          proOptions={{ hideAttribution: true }}><Background gap={22} size={1} /><Controls showInteractive={false} /></ReactFlow>
        {!graph.nodes.length && <div className="rq-flow-canvas-empty"><strong>从一个节点开始</strong><span>拖入上方节点，或点击添加，再连接执行顺序。</span></div>}
      </div>
      {node && <aside className="rq-flow-inspector" aria-label="流程节点详情"><div className="rq-section-title"><strong>{REQUIREMENT_STAGES[node.stage].label}</strong><Button type="text" aria-label="收起节点详情" onClick={() => setSelected(null)}>收起</Button></div>
        <label htmlFor="flow-node-title">节点名称</label><Input id="flow-node-title" maxLength={120} value={node.title} onChange={event => change({ ...graph, nodes: graph.nodes.map(item => item.id === node.id ? { ...item, title: event.target.value } : item) })} />
        <label htmlFor="flow-node-instructions">执行要求</label><Input.TextArea id="flow-node-instructions" rows={4} maxLength={8000} placeholder="补充这个节点需要完成的事项" value={node.instructions} onChange={event => change({ ...graph, nodes: graph.nodes.map(item => item.id === node.id ? { ...item, instructions: event.target.value } : item) })} />
        <label>前置节点</label><Select aria-label="前置节点" mode="multiple" value={graph.edges.filter(edge => edge.target === node.id).map(edge => edge.source)} options={graph.nodes.filter(item => item.id !== node.id).map(item => ({ value: item.id, label: item.title }))} onChange={sources => {
          const next = { ...graph, edges: [...graph.edges.filter(edge => edge.target !== node.id), ...sources.map(source => ({ id: `edge-${crypto.randomUUID()}`, source, target: node.id }))] }
          const parsed = RequirementFlowGraphSchema.safeParse(next); if (parsed.success) change(parsed.data); else setError(parsed.error.issues[0]?.message ?? '连接无效')
        }} />
        <p className="rq-secondary">产出 · {node.outputs.join('、')}</p><Button danger icon={<DeleteOutlined aria-hidden />} onClick={() => { change({ nodes: graph.nodes.filter(item => item.id !== node.id), edges: graph.edges.filter(edge => edge.source !== node.id && edge.target !== node.id) }); setSelected(null) }}>移除节点</Button>
      </aside>}
    </div>
    <div className="rq-flow-editor-foot"><Select aria-label="选择要编辑的节点" placeholder="选择节点编辑名称与要求" value={selected} allowClear onChange={value => setSelected(value ?? null)} options={graph.nodes.map(item => ({ value: item.id, label: item.title }))} /><span className="rq-secondary">{graph.nodes.length} 个节点 · {graph.edges.length} 条连接</span><Button type="text" onClick={() => void fitView({ padding: 0.15, maxZoom: 1 })}>适应画布</Button></div>
  </div>
}

export function RequirementFlowEditor(props: Parameters<typeof FlowEditorBody>[0]) { return <ReactFlowProvider><FlowEditorBody {...props} /></ReactFlowProvider> }
