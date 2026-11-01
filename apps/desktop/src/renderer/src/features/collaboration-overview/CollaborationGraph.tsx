import { AgentAvatar, resolveAgentWorkActivity } from '@projectos/ui'
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import { motion } from 'motion/react'
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference'
import ELK from 'elkjs/lib/elk.bundled.js'
import '@xyflow/react/dist/style.css'
import {
  Background,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import {
  Waves,
  Check,
  CircleAlert,
  FileText,
  GitBranch,
  Handshake,
  ChevronDown,
  ShieldAlert,
  Layers,
} from 'lucide-react'
import {
  REQUIREMENT_STAGES,
  type ApprovalView,
  type Artifact,
  type CollaborationOverviewAgent,
  type HandoffView,
  type RequirementFlowStep,
  type RequirementMaterial,
  type RequirementStage,
  type RunStatus,
  type RunSummary,
  type TaskCard,
  type TaskFlow,
} from '@projectos/contracts'
import { runStatusLabel, taskStatusLabel } from '../../lib/labels'
import { CanvasControls } from '../../next-ui/vendor/CanvasControls'

export type GraphSelection =
  | { kind: 'agent'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'stage'; id: string }
  | { kind: 'artifact'; id: string }
  | { kind: 'approval'; id: string }
  | { kind: 'handoff'; id: string }

export interface StageNodeInfo {
  step: RequirementFlowStep
  stageIndex: number
  totalStages: number
  taskTitle: string
  requirementId: string
  requirementTitle: string
  agentRole: string | null
  artifactCount: number
  reviewApproved: boolean
}

type AgentData = {
  agent: CollaborationOverviewAgent
  stageSummary: string | null
  stageCountLabel: string | null
  artifactCount: number
  activity: 'coding' | 'writing'
  selected: boolean
  related: boolean
}
type TaskData = {
  task: TaskCard
  agentName: string
  runStatus: RunStatus | null
  requirementTitle: string | null
  stageProgress: { completed: number; total: number; activeLabel: string | null } | null
  selected: boolean
  related: boolean
}
type StageData = {
  info: StageNodeInfo
  selected: boolean
  related: boolean
}
type ArtifactData = {
  artifact: Artifact
  producerName: string | null
  stageLabel: string | null
  reviewVerdict: string | null
  selected: boolean
  related: boolean
}
type ApprovalData = { approval: ApprovalView; selected: boolean; related: boolean }

type RelationshipKind = 'assignment' | 'dependency' | 'stage-flow' | 'artifact' | 'approval' | 'handoff'
type Relationship = { id: string; source: string; target: string; kind: RelationshipKind; handoffId?: string }

const AGENT_SIZE = { width: 248, height: 112 }
const TASK_SIZE = { width: 232, height: 112 }
const STAGE_SIZE = { width: 218, height: 108 }
const ARTIFACT_SIZE = { width: 232, height: 104 }
const APPROVAL_SIZE = { width: 240, height: 108 }

const EDGE_COLORS: Record<RelationshipKind, string> = {
  assignment: 'var(--ui-edge)',
  dependency: 'var(--ui-edge)',
  'stage-flow': 'var(--ui-accent)',
  artifact: 'var(--ui-teal)',
  approval: 'var(--ui-warn)',
  handoff: 'var(--ui-accent)',
}

const ARTIFACT_KIND_LABELS: Record<string, string> = {
  document: '文档',
  design: '技术设计',
  code: '代码产物',
  'test-report': '测试报告',
  diff: '变更 Diff',
  'release-note': '发布说明',
  other: '产物',
}

function activityForStage(stage: RequirementStage | null | undefined, fallbackRole?: string, fallbackTitle?: string): 'coding' | 'writing' {
  if (stage === 'development' || stage === 'testing') return 'coding'
  if (stage) return 'writing'
  const resolved = resolveAgentWorkActivity({
    status: 'working',
    role: fallbackRole,
    taskTitle: fallbackTitle,
  })
  return resolved === 'writing' ? 'writing' : 'coding'
}

function stepStatusMeta(status: RequirementFlowStep['status']): { label: string; stateClass: string; tone: 'ok' | 'accent' | 'warn' | 'danger' | 'neutral' } {
  if (status === 'completed') return { label: '已完成', stateClass: 'is-done', tone: 'ok' }
  if (status === 'running' || status === 'starting') return { label: '执行中', stateClass: 'is-running', tone: 'accent' }
  if (status === 'waiting_approval') return { label: '等待审批', stateClass: 'is-review', tone: 'warn' }
  if (status === 'failed' || status === 'needs_reconciliation') return { label: '执行异常', stateClass: 'is-blocked', tone: 'danger' }
  if (status === 'ready') return { label: '待开始', stateClass: 'is-ready', tone: 'neutral' }
  return { label: '待流转', stateClass: 'is-pending', tone: 'neutral' }
}

function AgentNode({ data }: NodeProps<Node<AgentData, 'aco-agent'>>): ReactElement {
  const agent = data.agent
  const waiting = agent.pendingApprovals > 0 || agent.runStatus === 'waiting_approval'
  const statusLabel = waiting
    ? '等待审批'
    : agent.status === 'working'
      ? '工作中'
      : data.stageCountLabel
        ? data.stageCountLabel
        : agent.status === 'offline'
          ? '离线'
          : '空闲'
  const tone = waiting ? 'warn' : agent.status === 'working' ? 'accent' : data.stageCountLabel?.includes('完成') ? 'ok' : 'neutral'
  const currentLine = data.stageSummary ?? agent.taskTitle ?? '暂无进行中的任务'
  return (
    <div className={`aco-gnode aco-gnode-agent${data.selected ? ' is-selected' : ''}${data.related ? ' is-related' : ''}`} data-testid={`collaboration-agent-${agent.id}`}>
      <Handle type="target" position={Position.Left} className="aco-port" isConnectable={false} />
      <div className="aco-gnode-agent-top">
        <AgentAvatar
          name={agent.name}
          role={agent.role}
          size={40}
          status={agent.status === 'working' ? 'working' : 'idle'}
          activity={data.activity}
          taskTitle={agent.taskTitle ?? undefined}
        />
        <span className="aco-gnode-agent-copy">
          <strong>{agent.name}</strong>
          <span>{agent.role}</span>
        </span>
        <span className={`aco-pill is-${tone}`}><i />{statusLabel}</span>
      </div>
      <div className="aco-gnode-current" title={currentLine}>{currentLine}</div>
      <div className="aco-gnode-foot">
        <span className="aco-mono">
          {data.artifactCount > 0
            ? `产出 ${data.artifactCount} 份成果`
            : agent.activeRunId
              ? agent.activeRunId.slice(0, 12)
              : '无活动 Run'}
        </span>
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
        <span className="aco-gnode-meta">
          {data.stageProgress
            ? `阶段 ${data.stageProgress.completed}/${data.stageProgress.total}`
            : data.task.dependencyIds.length
              ? `${data.task.dependencyIds.length} 前置`
              : '起点'}
        </span>
      </div>
      <strong className="aco-gnode-title" title={data.task.title}>{data.task.title}</strong>
      {data.requirementTitle ? (
        <div className="aco-gnode-sub" title={`所属需求：${data.requirementTitle}`}>
          需求：{data.requirementTitle}
        </div>
      ) : null}
      <div className="aco-gnode-foot">
        <span className="aco-gnode-assignee">
          <AgentAvatar
            name={data.agentName}
            size={22}
            status={data.task.status === 'running' ? 'working' : 'idle'}
            taskTitle={data.task.title}
            taskDescription={data.task.description}
            taskLabels={data.task.labels}
          />
          {data.agentName}
        </span>
        <span className={data.runStatus === 'waiting_approval' ? 'aco-warn-text' : ''}>
          {data.stageProgress?.activeLabel
            ? data.stageProgress.activeLabel
            : data.runStatus === 'waiting_approval'
              ? '等待审批'
              : data.runStatus
                ? runStatusLabel(data.runStatus)
                : '未启动'}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="aco-port" isConnectable={false} />
    </div>
  )
}

function StageNode({ data }: NodeProps<Node<StageData, 'aco-stage'>>): ReactElement {
  const { info } = data
  const { step } = info
  const meta = stepStatusMeta(step.status)
  const stageDef = REQUIREMENT_STAGES[step.stage]
  const isWorking = step.status === 'running' || step.status === 'starting'
  const activity = activityForStage(step.stage, info.agentRole ?? undefined, step.title)
  return (
    <div
      className={`aco-gnode aco-gnode-stage is-stage-${step.status}${data.selected ? ' is-selected' : ''}${data.related ? ' is-related' : ''}`}
      data-testid={`collaboration-stage-${step.id}`}
      data-stage={step.stage}
      data-stage-status={step.status}
    >
      <Handle type="target" position={Position.Left} className="aco-port" isConnectable={false} />
      <div className="aco-gnode-top">
        <span className="aco-stage-badge">
          <Layers size={10} /> 阶段 {info.stageIndex}/{info.totalStages}
        </span>
        <span className={`aco-gnode-state ${meta.stateClass}`}>{meta.label}</span>
      </div>
      <strong className="aco-gnode-title" title={`${step.title}（${ info.taskTitle }）`}>
        {step.title}
      </strong>
      <div className="aco-gnode-sub" title={stageDef?.output ? `阶段目标产出：${stageDef.output}` : info.taskTitle}>
        {info.artifactCount > 0
          ? `已产出 ${info.artifactCount} 份 · ${info.reviewApproved ? '审核通过' : stageDef?.output ?? '阶段产物'}`
          : `预期产出：${stageDef?.output ?? '阶段结果'}`}
      </div>
      <div className="aco-gnode-foot">
        <span className="aco-gnode-assignee">
          {step.agentName ? (
            <>
              <AgentAvatar
                name={step.agentName}
                role={info.agentRole ?? undefined}
                size={22}
                status={isWorking ? 'working' : 'idle'}
                activity={activity}
                taskTitle={step.title}
              />
              <strong>{step.agentName}</strong>
            </>
          ) : (
            <span>待分配 Agent</span>
          )}
        </span>
        <span className="aco-mono">
          {step.status === 'completed' ? '✓ 已流转' : isWorking ? '● 正在执行' : '待接力'}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="aco-port" isConnectable={false} />
    </div>
  )
}

function ArtifactNode({ data }: NodeProps<Node<ArtifactData, 'aco-artifact'>>): ReactElement {
  const kindLabel = ARTIFACT_KIND_LABELS[data.artifact.kind] ?? data.artifact.kind
  return (
    <div className={`aco-gnode aco-gnode-artifact${data.selected ? ' is-selected' : ''}${data.related ? ' is-related' : ''}`} data-testid={`collaboration-artifact-${data.artifact.id}`}>
      <Handle type="target" position={Position.Left} className="aco-port" isConnectable={false} />
      <div className="aco-gnode-top">
        <span className="aco-gnode-meta">
          <FileText size={11} /> {data.stageLabel ? `${data.stageLabel} · ${kindLabel}` : data.artifact.kind}
        </span>
        {data.reviewVerdict === 'approved' ? (
          <span className="aco-verified"><Check size={10} />审核通过</span>
        ) : data.artifact.verifiedAt ? (
          <span className="aco-verified"><Check size={10} />已核验</span>
        ) : (
          <span className="aco-unverified">真实产物</span>
        )}
      </div>
      <strong className="aco-gnode-title" title={data.artifact.title}>{data.artifact.title}</strong>
      <div className="aco-gnode-foot">
        {data.producerName ? (
          <span className="aco-gnode-assignee">
            <AgentAvatar name={data.producerName} size={20} status="idle" />
            <span>产出 · {data.producerName}</span>
          </span>
        ) : (
          <span className="aco-mono">{data.artifact.id.slice(0, 12)}</span>
        )}
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
  'aco-stage': StageNode,
  'aco-artifact': ArtifactNode,
  'aco-approval': ApprovalNode,
}

function RelationshipLayer({
  relationships,
  positions,
  sizeById,
  viewport,
  selectedId,
  runningIds,
  flowEnabled,
  onSelectHandoff,
}: {
  relationships: Relationship[]
  positions: Record<string, { x: number; y: number }>
  sizeById: Map<string, { width: number; height: number }>
  viewport: { x: number; y: number; zoom: number }
  selectedId: string | null
  runningIds: Set<string>
  flowEnabled: boolean
  onSelectHandoff: (id: string) => void
}): ReactElement {
  const uid = useId().replace(/:/g, '')
  const reduceMotion = useReducedMotionPreference()
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
    const color = highlighted ? `url(#${uid}-focus)` : EDGE_COLORS[edge.kind]
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

  const flowing = new Set(flowEnabled && !reduceMotion ? shapes.filter(({ edge, highlighted, dimmed }) => !dimmed && (highlighted || runningIds.has(edge.source) || runningIds.has(edge.target))).slice(0, 12).map(({ edge }) => edge.id) : [])
  // The former 40,000px mask forced a huge offscreen repaint on every moving pulse.
  // Cover the actual graph plus its curved handoff paths, in the same world coordinates.
  const occupied = [...sizeById].flatMap(([id, size]) => positions[id] ? [{ ...positions[id], ...size }] : [])
  const maskX = Math.min(0, ...occupied.map((item) => item.x)) - 128
  const maskY = Math.min(0, ...occupied.map((item) => item.y)) - 128
  const maskWidth = Math.max(0, ...occupied.map((item) => item.x + item.width)) + 128 - maskX
  const maskHeight = Math.max(0, ...occupied.map((item) => item.y + item.height)) + 128 - maskY
  return (
    <svg className="aco-edge-layer" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-focus`}><stop stopColor="var(--ui-accent)" /><stop offset="1" stopColor="var(--ui-teal)" /></linearGradient>
        <mask id={`${uid}-mask`} maskUnits="userSpaceOnUse" x={maskX} y={maskY} width={maskWidth} height={maskHeight}>
          <rect x={maskX} y={maskY} width={maskWidth} height={maskHeight} fill="white" />
          {[...sizeById.entries()].map(([id, size]) => {
            const position = positions[id]
            if (!position) return null
            return <rect key={id} x={position.x - 2} y={position.y - 2} width={size.width + 4} height={size.height + 4} rx="10" fill="black" />
          })}
        </mask>
        {Object.entries(EDGE_COLORS).map(([kind, color]) => (
          <marker
            key={kind}
            id={`${uid}-arrow-${kind}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
          </marker>
        ))}
      </defs>
      <g transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`} mask={`url(#${uid}-mask)`}>
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
              strokeWidth={highlighted ? 2 : 1.5}
              markerEnd={`url(#${uid}-arrow-${edge.kind})`}
            />
            {flowing.has(edge.id) ? (
              <motion.g className="aco-flow-pulse" data-edge-id={edge.id}
                style={{ offsetPath: `path('${d}')`, offsetRotate: '0deg', pointerEvents: 'none' }}
                initial={{ offsetDistance: '0%', opacity: 0 }}
                animate={{ offsetDistance: ['0%', '100%'], opacity: [0, 0.9, 0.9, 0] }}
                transition={{ duration: 3.2, repeat: Infinity, repeatDelay: 0.7, ease: 'linear', opacity: { times: [0, 0.12, 0.85, 1] } }}>
                <circle r="8" fill="var(--ui-accent)" opacity="0.14" />
                <circle r="3.5" fill="var(--ui-accent)" stroke="var(--ui-surface)" strokeWidth="1.25" />
              </motion.g>
            ) : null}
            {isHandoff ? (
              <g transform={`translate(${midpoint.x}, ${midpoint.y})`}>
                <rect x="-20" y="-10" width="40" height="20" rx="4" fill="var(--pw-surface)" stroke="var(--pw-warn-line)" />
                <text textAnchor="middle" dominantBaseline="middle" fill="var(--pw-accent-ink)" fontSize="12" fontWeight="600">交接</text>
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
  taskFlows = [],
  materials = [],
  requirementTitles = {},
  selected,
  onSelect,
  showAgents,
  showTasks,
  showOutputs,
  standbyAgents,
  initialViewport,
  onViewportChange,
}: {
  agents: CollaborationOverviewAgent[]
  tasks: TaskCard[]
  runs: RunSummary[]
  artifacts: Artifact[]
  approvals: ApprovalView[]
  handoffs: HandoffView[]
  planTaskIds: string[]
  taskFlows?: TaskFlow[]
  materials?: RequirementMaterial[]
  requirementTitles?: Record<string, string>
  selected: GraphSelection | null
  onSelect: (selection: GraphSelection | null) => void
  showAgents: boolean
  showTasks: boolean
  showOutputs: boolean
  standbyAgents: CollaborationOverviewAgent[]
  initialViewport?: { x: number; y: number; zoom: number } | null
  onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void
}): ReactElement {
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const lastLayoutKey = useRef('')
  const lastFitKey = useRef('')
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [viewport, setViewport] = useState(initialViewport ?? { x: 0, y: 0, zoom: 0.8 })
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null)
  const [standbyOpen, setStandbyOpen] = useState(false)

  const visibleAgents = useMemo(() => (showAgents ? agents : []), [agents, showAgents])
  const visibleTasks = useMemo(() => (showTasks ? tasks.filter((task) => task.status !== 'cancelled') : []), [showTasks, tasks])
  const visibleArtifacts = useMemo(() => (showOutputs ? artifacts : []), [artifacts, showOutputs])
  const visibleApprovals = useMemo(() => (showOutputs ? approvals : []), [approvals, showOutputs])

  const agentRoleById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.role])),
    [agents],
  )
  const materialByArtifactId = useMemo(
    () => new Map(materials.map((item) => [item.artifactId, item])),
    [materials],
  )
  const runById = useMemo(
    () => new Map(runs.map((run) => [run.id, run])),
    [runs],
  )
  const taskFlowByTaskId = useMemo(
    () => new Map(taskFlows.map((flow) => [flow.taskId, flow])),
    [taskFlows],
  )

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

  const visibleStages = useMemo<StageNodeInfo[]>(() => {
    if (!showTasks) return []
    const list: StageNodeInfo[] = []
    for (const task of orderedTasks) {
      const flow = taskFlowByTaskId.get(task.id)
      if (!flow || flow.steps.length === 0) continue
      const reqTitle = requirementTitles[flow.requirementId] ?? '当前需求'
      flow.steps.forEach((step, idx) => {
        const stepMaterials = materials.filter(
          (m) => m.stepId === step.id || step.artifactIds.includes(m.artifactId),
        )
        const reviewApproved = stepMaterials.some((m) => m.reviewVerdict === 'approved')
        list.push({
          step,
          stageIndex: idx + 1,
          totalStages: flow.steps.length,
          taskTitle: task.title,
          requirementId: flow.requirementId,
          requirementTitle: reqTitle,
          agentRole: step.agentId ? agentRoleById.get(step.agentId) ?? null : null,
          artifactCount: Math.max(step.artifactIds.length, stepMaterials.length),
          reviewApproved,
        })
      })
    }
    return list
  }, [agentRoleById, materials, orderedTasks, requirementTitles, showTasks, taskFlowByTaskId])

  const stepByArtifactId = useMemo(() => {
    const map = new Map<string, RequirementFlowStep>()
    for (const flow of taskFlows) {
      for (const step of flow.steps) {
        for (const artId of step.artifactIds) {
          map.set(artId, step)
        }
      }
    }
    for (const mat of materials) {
      if (mat.stepId && !map.has(mat.artifactId)) {
        for (const flow of taskFlows) {
          const found = flow.steps.find((s) => s.id === mat.stepId)
          if (found) {
            map.set(mat.artifactId, found)
            break
          }
        }
      }
    }
    for (const art of artifacts) {
      if (map.has(art.id)) continue
      const stepId = typeof art.metadata?.workflowStepId === 'string' ? art.metadata.workflowStepId : null
      if (stepId) {
        for (const flow of taskFlows) {
          const found = flow.steps.find((s) => s.id === stepId)
          if (found) {
            map.set(art.id, found)
            break
          }
        }
      } else if (art.runId) {
        for (const flow of taskFlows) {
          const found = flow.steps.find((s) => s.runId === art.runId)
          if (found) {
            map.set(art.id, found)
            break
          }
        }
      }
    }
    return map
  }, [artifacts, materials, taskFlows])

  const runByTask = useMemo(() => {
    const map = new Map<string, RunSummary>()
    for (const run of runs) {
      if (!run.taskId) continue
      const previous = map.get(run.taskId)
      if (!previous || run.createdAt > previous.createdAt) map.set(run.taskId, run)
    }
    return map
  }, [runs])

  const [flowEnabled, setFlowEnabled] = useState(true)
  const reduceMotion = useReducedMotionPreference()
  const runningIds = useMemo(() => new Set([
    ...agents.filter((agent) => agent.runStatus === 'running').map((agent) => agent.id),
    ...[...runByTask.entries()].filter(([, run]) => run.status === 'running').map(([id]) => id),
    ...visibleStages
      .filter((s) => s.step.status === 'running' || s.step.status === 'starting' || s.step.status === 'waiting_approval')
      .map((s) => s.step.id),
  ]), [agents, runByTask, visibleStages])
  const agentNames = useMemo(() => Object.fromEntries(agents.map((agent) => [agent.id, agent.name])), [agents])
  const selectedId = selected?.id ?? null

  const sizeById = useMemo(() => {
    const map = new Map<string, { width: number; height: number }>()
    for (const agent of visibleAgents) map.set(agent.id, AGENT_SIZE)
    for (const task of visibleTasks) map.set(task.id, TASK_SIZE)
    for (const stage of visibleStages) map.set(stage.step.id, STAGE_SIZE)
    for (const item of visibleArtifacts) map.set(item.id, ARTIFACT_SIZE)
    for (const item of visibleApprovals) map.set(item.id, APPROVAL_SIZE)
    return map
  }, [visibleAgents, visibleApprovals, visibleArtifacts, visibleStages, visibleTasks])

  const relationships = useMemo<Relationship[]>(() => {
    const list: Relationship[] = []
    const agentIds = new Set(visibleAgents.map((agent) => agent.id))
    const taskIds = new Set(visibleTasks.map((task) => task.id))
    const stageIds = new Set(visibleStages.map((stage) => stage.step.id))
    const approvalIds = new Set(visibleApprovals.map((item) => item.id))

    const assignmentKeys = new Set<string>()
    // Connect agents to their workflow stage nodes when stages are visible
    for (const stage of visibleStages) {
      const { step } = stage
      if (step.agentId && agentIds.has(step.agentId)) {
        const key = `${step.agentId}:${step.id}`
        if (!assignmentKeys.has(key)) {
          assignmentKeys.add(key)
          list.push({ id: `assign-${step.agentId}-${step.id}`, source: step.agentId, target: step.id, kind: 'assignment' })
        }
      }
    }

    for (const agent of visibleAgents) {
      if (agent.taskId && taskIds.has(agent.taskId)) {
        const flow = taskFlowByTaskId.get(agent.taskId)
        if (!flow || flow.steps.length === 0 || stageIds.size === 0) {
          assignmentKeys.add(`${agent.id}:${agent.taskId}`)
          list.push({ id: `assign-${agent.id}-${agent.taskId}`, source: agent.id, target: agent.taskId, kind: 'assignment' })
        }
      }
    }
    // A persisted task assignment is a real relationship even when the task has no active Run yet.
    for (const task of visibleTasks) {
      if (!task.assigneeAgentId || !agentIds.has(task.assigneeAgentId)) continue
      const flow = taskFlowByTaskId.get(task.id)
      if (flow && flow.steps.length > 0 && stageIds.size > 0) continue
      const key = `${task.assigneeAgentId}:${task.id}`
      if (assignmentKeys.has(key)) continue
      assignmentKeys.add(key)
      list.push({ id: `assign-${task.assigneeAgentId}-${task.id}`, source: task.assigneeAgentId, target: task.id, kind: 'assignment' })
    }

    // Connect task -> stage 1 -> stage 2 -> ... -> stage N for each requirement task flow
    for (const task of visibleTasks) {
      const flow = taskFlowByTaskId.get(task.id)
      if (!flow || flow.steps.length === 0) continue
      const stepsInGraph = flow.steps.filter((s) => stageIds.has(s.id))
      if (stepsInGraph.length > 0) {
        list.push({
          id: `stage-start-${task.id}-${stepsInGraph[0]!.id}`,
          source: task.id,
          target: stepsInGraph[0]!.id,
          kind: 'stage-flow',
        })
        for (let i = 0; i < stepsInGraph.length - 1; i += 1) {
          const fromStep = stepsInGraph[i]!
          const toStep = stepsInGraph[i + 1]!
          list.push({
            id: `stage-next-${fromStep.id}-${toStep.id}`,
            source: fromStep.id,
            target: toStep.id,
            kind: 'stage-flow',
          })
        }
      }
    }

    for (const task of visibleTasks) {
      for (const dep of task.dependencyIds) {
        if (!taskIds.has(dep)) continue
        const depFlow = taskFlowByTaskId.get(dep)
        const lastDepStep = depFlow?.steps.length ? depFlow.steps[depFlow.steps.length - 1] : null
        const sourceId = lastDepStep && stageIds.has(lastDepStep.id) ? lastDepStep.id : dep
        list.push({ id: `dep-${sourceId}-${task.id}`, source: sourceId, target: task.id, kind: 'dependency' })
      }
    }

    for (const artifact of visibleArtifacts) {
      const step = stepByArtifactId.get(artifact.id)
      if (step && stageIds.has(step.id)) {
        list.push({ id: `artifact-${step.id}-${artifact.id}`, source: step.id, target: artifact.id, kind: 'artifact' })
      } else if (artifact.taskId && taskIds.has(artifact.taskId)) {
        list.push({ id: `artifact-${artifact.taskId}-${artifact.id}`, source: artifact.taskId, target: artifact.id, kind: 'artifact' })
      } else {
        const mat = materialByArtifactId.get(artifact.id)
        const run = artifact.runId ? runById.get(artifact.runId) : null
        const producerAgentId = mat?.agentId ?? run?.agentId ?? null
        if (producerAgentId && agentIds.has(producerAgentId)) {
          list.push({ id: `artifact-${producerAgentId}-${artifact.id}`, source: producerAgentId, target: artifact.id, kind: 'artifact' })
        }
      }
    }

    for (const approval of visibleApprovals) {
      if (!approvalIds.has(approval.id)) continue
      const matchingStage = visibleStages.find(
        (s) =>
          (s.step.runId && s.step.runId === approval.runId) ||
          (s.step.taskId === approval.taskId && s.step.status === 'waiting_approval'),
      )
      if (matchingStage && stageIds.has(matchingStage.step.id)) {
        list.push({ id: `approval-${matchingStage.step.id}-${approval.id}`, source: matchingStage.step.id, target: approval.id, kind: 'approval' })
      } else if (approval.taskId && taskIds.has(approval.taskId)) {
        list.push({ id: `approval-${approval.taskId}-${approval.id}`, source: approval.taskId, target: approval.id, kind: 'approval' })
      }
    }

    for (const handoff of handoffs) {
      if (agentIds.has(handoff.fromAgentId) && agentIds.has(handoff.toAgentId)) {
        list.push({ id: `handoff-${handoff.id}`, source: handoff.fromAgentId, target: handoff.toAgentId, kind: 'handoff', handoffId: handoff.id })
      }
    }
    return list
  }, [handoffs, materialByArtifactId, runById, stepByArtifactId, taskFlowByTaskId, visibleAgents, visibleApprovals, visibleArtifacts, visibleStages, visibleTasks])

  const layoutKey = [
    visibleAgents.map((agent) => agent.id).join(','),
    visibleTasks.map((task) => task.id).join(','),
    visibleStages.map((stage) => `${stage.step.id}:${stage.step.status}:${stage.step.agentId ?? ''}`).join(','),
    visibleArtifacts.map((item) => item.id).join(','),
    visibleApprovals.map((item) => item.id).join(','),
  ].join('|')

  useEffect(() => {
    if (lastLayoutKey.current === layoutKey) return
    lastLayoutKey.current = layoutKey
    let cancelled = false
    const graph = new ELK()
    const children = [
      ...orderedAgents.map((agent) => ({ id: agent.id, ...AGENT_SIZE })),
      ...orderedTasks.map((task) => ({ id: task.id, ...TASK_SIZE })),
      ...visibleStages.map((stage) => ({ id: stage.step.id, ...STAGE_SIZE })),
      ...visibleArtifacts.map((item) => ({ id: item.id, ...ARTIFACT_SIZE })),
      ...visibleApprovals.map((item) => ({ id: item.id, ...APPROVAL_SIZE })),
    ]
    const layoutEdges = relationships
      .filter((edge) => edge.kind !== 'handoff')
      .map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] }))
    const hasStages = visibleStages.length > 0
    void graph.layout({
      id: 'aco-collaboration-graph',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': hasStages ? '18' : '24',
        'elk.layered.spacing.nodeNodeBetweenLayers': hasStages ? '44' : '72',
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
  }, [layoutKey, orderedAgents, orderedTasks, relationships, visibleAgents, visibleApprovals, visibleArtifacts, visibleStages, visibleTasks])

  useEffect(() => {
    if (!instance || Object.keys(positions).length === 0) return undefined
    if (lastFitKey.current === '' && initialViewport) {
      lastFitKey.current = layoutKey
      void instance.setViewport(initialViewport)
      setViewport(initialViewport)
      return undefined
    }
    if (lastFitKey.current === layoutKey) return undefined
    lastFitKey.current = layoutKey
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
      const zoom = Math.max(0.32, Math.min(1, (width - 48) / maxX, (height - 48) / maxY))
      const next = { x: (width - maxX * zoom) / 2, y: (height - maxY * zoom) / 2, zoom }
      void instance.setViewport(next)
      setViewport(next)
    }
    const timer = window.setTimeout(fit, 90)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit())
    if (canvasRef.current) observer?.observe(canvasRef.current)
    return () => { window.clearTimeout(timer); observer?.disconnect() }
  }, [initialViewport, instance, layoutKey, positions, sizeById])

  const related = useMemo(() => {
    const ids = new Set<string>()
    if (!selectedId) return ids
    for (const edge of relationships) {
      if (edge.source === selectedId) ids.add(edge.target)
      if (edge.target === selectedId) ids.add(edge.source)
    }
    return ids
  }, [relationships, selectedId])

  const allSteps = useMemo(() => taskFlows.flatMap((flow) => flow.steps), [taskFlows])

  const nodes = useMemo(() => {
    const list: Array<Node> = []
    for (const agent of orderedAgents) {
      const agentSteps = allSteps.filter((s) => s.agentId === agent.id)
      const activeStep = agentSteps.find((s) => s.status === 'running' || s.status === 'starting' || s.status === 'waiting_approval')
      const completedSteps = agentSteps.filter((s) => s.status === 'completed')
      const agentArtifactCount = artifacts.filter((art) => {
        const mat = materialByArtifactId.get(art.id)
        if (mat?.agentId === agent.id) return true
        const step = stepByArtifactId.get(art.id)
        if (step?.agentId === agent.id) return true
        const run = art.runId ? runById.get(art.runId) : null
        return run?.agentId === agent.id
      }).length

      const stageSummary = agentSteps.length > 0
        ? `负责阶段：${agentSteps.map((s) => `${s.title}${s.status === 'completed' ? '✓' : s.status === 'running' || s.status === 'starting' ? '(执行中)' : s.status === 'waiting_approval' ? '(待审批)' : ''}`).join('、')}`
        : null
      const stageCountLabel = agentSteps.length > 0
        ? completedSteps.length === agentSteps.length
          ? `已完成 ${completedSteps.length} 阶段`
          : completedSteps.length > 0
            ? `完成 ${completedSteps.length}/${agentSteps.length} 阶段`
            : '待接力阶段'
        : null
      const activity = activityForStage(activeStep?.stage ?? agentSteps[0]?.stage, agent.role, agent.taskTitle ?? undefined)

      list.push({
        id: agent.id,
        type: 'aco-agent',
        position: positions[agent.id] ?? { x: 0, y: 0 },
        ...AGENT_SIZE,
        data: {
          agent,
          stageSummary,
          stageCountLabel,
          artifactCount: agentArtifactCount,
          activity,
          selected: selected?.kind === 'agent' && selected.id === agent.id,
          related: related.has(agent.id),
        },
        draggable: false,
      })
    }
    for (const task of orderedTasks) {
      const run = runByTask.get(task.id)
      const flow = taskFlowByTaskId.get(task.id)
      const completedStages = flow ? flow.steps.filter((s) => s.status === 'completed').length : 0
      const activeStage = flow?.steps.find((s) => s.status === 'running' || s.status === 'starting' || s.status === 'waiting_approval')
      const reqTitle = task.requirementId ? requirementTitles[task.requirementId] ?? null : null
      const activeAgentName =
        activeStage?.agentName ??
        task.assigneeName ??
        (task.assigneeAgentId ? agentNames[task.assigneeAgentId] : undefined) ??
        flow?.steps[0]?.agentName ??
        '待分配'
      list.push({
        id: task.id,
        type: 'aco-task',
        position: positions[task.id] ?? { x: 0, y: 0 },
        ...TASK_SIZE,
        data: {
          task,
          agentName: activeAgentName,
          runStatus: run?.status ?? null,
          requirementTitle: reqTitle,
          stageProgress: flow && flow.steps.length > 0
            ? {
                completed: completedStages,
                total: flow.steps.length,
                activeLabel: activeStage
                  ? `当前：${activeStage.title}`
                  : completedStages === flow.steps.length
                    ? '全阶段完成'
                    : null,
              }
            : null,
          selected: selected?.kind === 'task' && selected.id === task.id,
          related: related.has(task.id),
        },
        draggable: false,
      })
    }
    for (const stage of visibleStages) {
      list.push({
        id: stage.step.id,
        type: 'aco-stage',
        position: positions[stage.step.id] ?? { x: 0, y: 0 },
        ...STAGE_SIZE,
        data: {
          info: stage,
          selected: selected?.kind === 'stage' && selected.id === stage.step.id,
          related: related.has(stage.step.id),
        },
        draggable: false,
      })
    }
    for (const artifact of visibleArtifacts) {
      const mat = materialByArtifactId.get(artifact.id)
      const step = stepByArtifactId.get(artifact.id)
      const run = artifact.runId ? runById.get(artifact.runId) : null
      const producerName =
        mat?.agentName ??
        step?.agentName ??
        run?.agentName ??
        (mat?.agentId ? agentNames[mat.agentId] : undefined) ??
        null
      const stageLabel =
        mat?.stepTitle ??
        step?.title ??
        (mat?.stage ? REQUIREMENT_STAGES[mat.stage]?.label : null) ??
        null
      const reviewVerdict = mat?.reviewVerdict ?? (artifact.metadata?.verdict === 'approved' ? 'approved' : null)

      list.push({
        id: artifact.id,
        type: 'aco-artifact',
        position: positions[artifact.id] ?? { x: 0, y: 0 },
        ...ARTIFACT_SIZE,
        data: {
          artifact,
          producerName,
          stageLabel,
          reviewVerdict,
          selected: selected?.kind === 'artifact' && selected.id === artifact.id,
          related: related.has(artifact.id),
        },
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
  }, [agentNames, allSteps, artifacts, materialByArtifactId, orderedAgents, orderedTasks, positions, related, requirementTitles, runById, runByTask, selected, stepByArtifactId, taskFlowByTaskId, visibleApprovals, visibleArtifacts, visibleStages])

  const taskCount = planTaskIds.length + taskFlows.length
  const isEmpty = visibleAgents.length === 0 && visibleTasks.length === 0 && visibleStages.length === 0 && visibleArtifacts.length === 0 && visibleApprovals.length === 0

  return (
    <div className="aco-canvas" data-testid="collaboration-graph">
      <div className="aco-canvas-bar">
        {taskCount === 0 && !isEmpty ? (
          <span className="aco-canvas-hint"><CircleAlert size={12} /> 计划尚未关联任务</span>
        ) : null}
        {visibleStages.length > 0 ? (
          <span className="aco-canvas-hint is-stage-flow">
            <Layers size={12} /> 需求整体流转视图 · {visibleTasks.length} 个任务 · {visibleStages.length} 个流转阶段 · {visibleAgents.length} 位参与 Agent
          </span>
        ) : null}
        {handoffs.length > 0 ? (
          <span className="aco-canvas-hint is-handoff"><Handshake size={12} /> {handoffs.length} 条交接</span>
        ) : null}
        <div className="aco-legend" aria-hidden="true">
          <span><i className="is-agent" />Agent</span>
          <span><i className="is-task" />需求任务</span>
          {visibleStages.length > 0 ? <span><i className="is-stage" />流程阶段</span> : null}
          <span><i className="is-output" />Agent 产出</span>
          <span><i className="is-handoff" />交接</span>
          <span><i className="is-approval" />审批</span>
        </div>
        <button type="button" className="aco-flow-toggle" aria-pressed={flowEnabled && !reduceMotion}
          aria-label={reduceMotion ? '流向脉冲已随减少动效关闭' : flowEnabled ? '暂停流向脉冲' : '开启流向脉冲'}
          disabled={reduceMotion} title="展示关联方向；节点标签表示执行状态" onClick={() => setFlowEnabled((value) => !value)}>
          <Waves size={14} aria-hidden />流向
        </button>
      </div>
      <div className="aco-canvas-viewport" ref={canvasRef}>
      <ReactFlow
        nodes={nodes}
        nodeTypes={nodeTypes}
        onInit={(flow) => { setInstance(flow) }}
        onMove={(_event, next) => { setViewport(next); onViewportChange?.(next) }}
        onNodeClick={(_event, node) => {
          const nodeType = String(node.type)
          onSelect({
            kind:
              nodeType === 'aco-agent'
                ? 'agent'
                : nodeType === 'aco-task'
                  ? 'task'
                  : nodeType === 'aco-stage'
                    ? 'stage'
                    : nodeType === 'aco-artifact'
                      ? 'artifact'
                      : 'approval',
            id: node.id,
          })
        }}
        onPaneClick={() => onSelect(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.1}
        maxZoom={1.4}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1.1} color="var(--pw-grid-dot)" />
        <CanvasControls />
      </ReactFlow>
      <RelationshipLayer
        relationships={relationships}
        positions={positions}
        sizeById={sizeById}
        viewport={viewport}
        selectedId={selectedId}
        runningIds={runningIds}
        flowEnabled={flowEnabled}
        onSelectHandoff={(handoffId) => onSelect({ kind: 'handoff', id: handoffId })}
      />
      {isEmpty ? (
        <div className="aco-canvas-empty">
          <GitBranch size={22} />
          <strong>{standbyAgents.length > 0 ? '当前没有执行中的工作' : '这张协作图还没有真实对象'}</strong>
          <span>{standbyAgents.length > 0 ? '待命 Agent 已收起；批准计划或启动运行后，执行节点会出现在这里。' : '批准计划后，Agent、任务、审批与成果会作为真实节点出现。'}</span>
        </div>
      ) : null}
      {standbyAgents.length > 0 ? (
        <div className={`aco-standby${standbyOpen ? ' is-open' : ''}`} data-testid="standby-agents">
          <button
            type="button"
            className="aco-standby-toggle"
            aria-expanded={standbyOpen}
            onClick={() => setStandbyOpen((open) => !open)}
          >
            <span className="aco-standby-avatars" aria-hidden="true">
              {standbyAgents.slice(0, 3).map((agent) => (
                <i key={agent.id} style={{ color: agent.accent || undefined, borderColor: agent.accent ? `${agent.accent}55` : undefined }}>{agent.name.slice(0, 1)}</i>
              ))}
            </span>
            <span>待命 Agent · {standbyAgents.length}</span>
            <ChevronDown size={13} className="aco-standby-chevron" />
          </button>
          {standbyOpen ? (
            <div className="aco-standby-list">
              {standbyAgents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className="aco-standby-row"
                  data-testid={`standby-agent-${agent.id}`}
                  onClick={() => {
                    onSelect({ kind: 'agent', id: agent.id })
                    setStandbyOpen(false)
                  }}
                >
                  <i style={{ color: agent.accent || undefined }}>{agent.name.slice(0, 1)}</i>
                  <span><strong>{agent.name}</strong><small>{agent.role}</small></span>
                  <em>{agent.status === 'offline' ? '离线' : '空闲'}</em>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      </div>
    </div>
  )
}
