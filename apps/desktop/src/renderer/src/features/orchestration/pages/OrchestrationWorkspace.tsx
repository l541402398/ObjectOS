import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  App as AntApp,
  Button,
  Input,
  Modal,
  Popconfirm,
  Select,
  Tabs,
  Tag,
} from 'antd'
import {
  ApartmentOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  CompressOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  LockOutlined,
  MessageOutlined,
  NodeIndexOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  SettingOutlined,
  StopOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type {
  AgentDefinition,
  ApprovalView,
  GraphNode,
  PlanDraft,
  PlanExecutionGrantIssueInput,
  PlannedTask,
  RunStep,
  WorktreeInfo,
} from '@projectos/contracts'
import { ErrorState, LoadingBlock, StatusPill } from '@projectos/ui'
import { PlanGrantPanel } from '../components/PlanGrantPanel'
import { AgentStudioModal } from '../../../components/AgentStudioModal'
import { DialogShell, OverlayFooter, OverlayHeader, OverlayScrollArea, SheetShell } from '../../../next-ui/overlay/overlay-shell'
import { hasPlanBlockingIssues } from '../components/plan-review-logic'
import { PlanReviewNext } from '../components/PlanReviewNext'
import { ReplanPanel } from '../components/ReplanPanel'
import {
  qk,
  useAgents,
  useApprovals,
  useBootstrap,
  useCollaboration,
  useGraph,
  usePlanGrant,
  usePlans,
  useReplanProposals,
  useProjectBudget,
  useProjectEvents,
  useProjectSnapshot,
  useRunDetail,
  useTaskDetail,
  useWorkspace,
} from '../../../lib/queries'
import { errorMessage } from '../../../lib/errors'
import { formatRelative } from '../../../lib/format'
import { useQueryClient } from '@tanstack/react-query'
import { useResolvedTheme } from '../../../stores/ui'
import './orchestration.css'

interface WorkbenchData extends Record<string, unknown> {
  graph: GraphNode
  taskCount?: number
  doneCount?: number
  hiddenCount?: number
  progress?: number
  accent?: string
  currentTask?: string
}

type FlowNode = Node<WorkbenchData, 'workbench'>

interface ReassignCandidateView {
  agentId: string
  name: string
  score: number
  reasons: string[]
  capabilities?: string[]
  addedCapabilities?: string[]
  runtime?: string
  raisesRuntimeRisk?: boolean
}

interface ReassignmentPayload {
  status?: string
  candidates?: ReassignCandidateView[]
  reasons?: string[]
  originalError?: string
  originalAgent?: { name?: string; runtime?: string; capabilities?: string[] }
  runtimeChange?: { from?: string; to?: string | null; increased?: boolean }
  toAgentId?: string | null
  requiresConfirmation?: boolean
}

const ROLE_ACCENTS: Record<string, string> = {
  产品负责人: '#4c8dff',
  架构师: '#a78bfa',
  开发工程师: '#34d399',
  代码审查员: '#e8a33d',
  测试工程师: '#f472b6',
}

function roleAccent(role: string | undefined): string {
  return (role && ROLE_ACCENTS[role]) || '#4c8dff'
}

function nodeStyle(accent: string | undefined): CSSProperties {
  return { '--flow-accent': accent ?? '#4c8dff' } as CSSProperties
}

const ROLE_LABELS: Record<PlannedTask['role'], string> = {
  architect: '架构',
  developer: '开发',
  reviewer: '审查',
  tester: '测试',
  custom: '自定义',
}

const STATUS_TONE: Record<GraphNode['status'], 'success' | 'warning' | 'danger' | 'neutral' | 'accent'> = {
  idle: 'neutral',
  queued: 'accent',
  running: 'accent',
  waiting: 'warning',
  blocked: 'danger',
  failed: 'danger',
  completed: 'success',
  paused: 'neutral',
}

const STATUS_TEXT: Record<GraphNode['status'], string> = {
  idle: '空闲',
  queued: '排队',
  running: '运行中',
  waiting: '等待',
  blocked: '阻塞',
  failed: '失败',
  completed: '完成',
  paused: '暂停',
}

function WorkbenchNode({ data, selected }: NodeProps<FlowNode>) {
  const node = data.graph
  if (node.kind === 'orchestrator') {
    return (
      <div className={`po-flow-orchestrator ${selected ? 'is-selected' : ''}`.trim()}>
        <Handle type="target" position={Position.Top} className="po-flow-handle" />
        <div className="po-flow-orchestrator-icon"><ApartmentOutlined /></div>
        <div className="po-flow-orchestrator-main">
          <span className="po-flow-kicker">ORCHESTRATOR</span>
          <strong>{node.label}</strong>
          <span>{node.subtitle}</span>
        </div>
        <span className={`po-flow-state is-${node.status}`}>{STATUS_TEXT[node.status]}</span>
        <Handle type="source" position={Position.Bottom} className="po-flow-handle" />
      </div>
    )
  }
  if (node.kind === 'agent') {
    return (
      <div className={`po-flow-agent ${selected ? 'is-selected' : ''}`.trim()} style={nodeStyle(data.accent)}>
        <Handle type="target" position={Position.Top} className="po-flow-handle" />
        <div className="po-flow-agent-head">
          <span className="po-flow-avatar"><RobotOutlined /></span>
          <div>
            <strong>{node.label}</strong>
            <span>{node.subtitle}</span>
          </div>
          <span className={`po-flow-state is-${node.status}`}>{STATUS_TEXT[node.status]}</span>
        </div>
        <div className="po-flow-agent-task">
          {data.currentTask ?? '暂无任务'}
        </div>
        <div className="po-flow-agent-metrics">
          <span><strong>{data.taskCount ?? 0}</strong> 任务</span>
          <span><strong>{data.doneCount ?? 0}</strong> 完成</span>
          <span><strong>{Math.round((data.progress ?? 0) * 100)}%</strong></span>
          {data.hiddenCount ? <em>+{data.hiddenCount}</em> : null}
        </div>
        <div className="po-flow-progress"><span style={{ width: `${(data.progress ?? 0) * 100}%` }} /></div>
        <Handle type="source" position={Position.Bottom} className="po-flow-handle" />
      </div>
    )
  }
  return (
    <div className={`po-flow-task ${selected ? 'is-selected' : ''}`.trim()} style={nodeStyle(data.accent)}>
      <Handle type="target" position={Position.Top} className="po-flow-handle" />
      <div className="po-flow-task-icon"><CheckCircleOutlined /></div>
      <div className="po-flow-task-main">
        <strong>{node.label}</strong>
        <span>{node.subtitle}</span>
      </div>
      <span className={`po-flow-dot is-${node.status}`} />
      <Handle type="source" position={Position.Bottom} className="po-flow-handle" />
    </div>
  )
}

const nodeTypes = { workbench: WorkbenchNode }

/** Below this zoom node metadata is hidden so only legible title and status remain. */
const COMPACT_GRAPH_ZOOM = 0.85

function buildLayout(
  snapshot: NonNullable<ReturnType<typeof useGraph>['data']>,
  selectedId: string | null,
): { nodes: FlowNode[]; edges: Edge[]; agents: GraphNode[]; tasks: GraphNode[] } {
  const orchestrator = snapshot.nodes.find((node) => node.kind === 'orchestrator')
  const agents = snapshot.nodes.filter((node) => node.kind === 'agent')
  const tasks = snapshot.nodes.filter((node) => node.kind === 'task')
  const tasksByAgent = new Map<string, GraphNode[]>()
  for (const task of tasks) {
    if (!task.agentId) continue
    const list = tasksByAgent.get(task.agentId) ?? []
    list.push(task)
    tasksByAgent.set(task.agentId, list)
  }
  const visibleByAgent = new Map<string, GraphNode[]>()
  for (const [agentId, list] of tasksByAgent) {
    const sorted = [...list].sort((a, b) => {
      const rank = (status: GraphNode['status']): number =>
        status === 'running' || status === 'waiting' || status === 'queued'
          ? 0
          : status === 'blocked' || status === 'failed'
            ? 1
            : status === 'completed'
              ? 3
              : 2
      return rank(a.status) - rank(b.status) || b.updatedAt - a.updatedAt
    })
    visibleByAgent.set(agentId, sorted.slice(0, 2))
  }
  const saved = snapshot.positions
  const nodes: FlowNode[] = []
  if (orchestrator) {
    nodes.push({
      id: orchestrator.id,
      type: 'workbench',
      position: saved[orchestrator.id] ?? { x: 278, y: 0 },
      data: { graph: orchestrator },
      selected: orchestrator.id === selectedId,
    })
  }
  agents.forEach((agent, index) => {
    const agentTasks = tasksByAgent.get(agent.agentId ?? '') ?? []
    const visible = visibleByAgent.get(agent.agentId ?? '') ?? []
    const doneCount = agentTasks.filter((task) => task.status === 'completed').length
    nodes.push({
      id: agent.id,
      type: 'workbench',
      position: saved[agent.id] ?? { x: index * 168, y: 124 },
      data: {
        graph: agent,
        taskCount: agentTasks.length,
        doneCount,
        hiddenCount: agentTasks.length - visible.length,
        progress: agentTasks.length ? doneCount / agentTasks.length : 0,
        accent: roleAccent(agent.subtitle),
        currentTask: visible[0]?.label,
      },
      selected: agent.id === selectedId,
    })
  })
  const agentIndex = new Map(agents.map((agent, index) => [agent.agentId ?? '', index]))
  for (const [agentId, visible] of visibleByAgent) {
    const parent = agentIndex.get(agentId) ?? 0
    const accent = roleAccent(agents.find((agent) => agent.agentId === agentId)?.subtitle)
    visible.forEach((task, index) => {
      nodes.push({
        id: task.id,
        type: 'workbench',
        position: saved[task.id] ?? { x: parent * 168 + 7, y: 302 + index * 62 },
        data: { graph: task, accent },
        selected: task.id === selectedId,
      })
    })
  }
  const edges: Edge[] = snapshot.edges
    .filter((edge) => edge.kind === 'delegation')
    .map((edge) => {
      const related = !selectedId || edge.source === selectedId || edge.target === selectedId
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        className: `po-flow-edge is-${edge.kind}${related ? ' is-related' : ' is-dimmed'}`,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 13,
          height: 13,
          color: related ? 'rgba(126, 154, 190, .82)' : 'rgba(126, 154, 190, .3)',
        },
        style: {
          stroke: related ? 'rgba(126, 154, 190, .62)' : 'rgba(126, 154, 190, .25)',
          strokeWidth: related ? 1.35 : 1,
        },
      }
    })
  return { nodes, edges, agents, tasks }
}

export default function OrchestrationWorkspace() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message, notification } = AntApp.useApp()
  const bootstrap = useBootstrap()
  const project = bootstrap.data?.projects.find((item) => item.id === projectId) ?? null
  const snapshotQuery = useProjectSnapshot(projectId)
  const plansQuery = usePlans(projectId)
  const agentsQuery = useAgents(projectId)
  const graphQuery = useGraph(projectId)
  const approvalsQuery = useApprovals(projectId)
  const eventsQuery = useProjectEvents(projectId, 20)
  const workspaceQuery = useWorkspace(projectId)
  const collaborationQuery = useCollaboration(projectId)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [planOpen, setPlanOpen] = useState(false)
  const [goal, setGoal] = useState('')
  const [draft, setDraft] = useState<PlanDraft | null>(null)
  const [planMode, setPlanMode] = useState<'ai' | 'local'>('ai')
  const [generating, setGenerating] = useState(false)
  const [planElapsed, setPlanElapsed] = useState(0)
  const [plannerError, setPlannerError] = useState<string | null>(null)
  const [agentStudioOpen, setAgentStudioOpen] = useState(false)
  const [customAgentTaskKey, setCustomAgentTaskKey] = useState<string | null>(null)

  useEffect(() => {
    if (!generating) {
      setPlanElapsed(0)
      return
    }
    const startedAt = Date.now()
    setPlanElapsed(0)
    const timer = window.setInterval(() => setPlanElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250)
    return () => window.clearInterval(timer)
  }, [generating])
  const [grantBusy, setGrantBusy] = useState(false)
  const [replanBusy, setReplanBusy] = useState(false)
  const [savingLayout, setSavingLayout] = useState(false)
  const [worktreeInfo, setWorktreeInfo] = useState<WorktreeInfo | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [seqCursor, setSeqCursor] = useState(0)
  const [seqGap, setSeqGap] = useState(false)
  const [nodeFilter, setNodeFilter] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | 'orchestrator' | 'agent' | 'task'>('all')
  const [compactGraph, setCompactGraph] = useState(false)
  const seqCursorRef = useRef(0)
  const saveLayoutRef = useRef<() => void>(() => undefined)
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>([])
  const [inspectorTab, setInspectorTab] = useState('overview')
  const [detailTab, setDetailTab] = useState('node')
  const flowRef = useRef<ReactFlowInstance<FlowNode> | null>(null)
  const autoScan = useRef(false)
  const resolvedTheme = useResolvedTheme()
  const [planModalWidth, setPlanModalWidth] = useState(920)
  const [reviewModalWidth, setReviewModalWidth] = useState(1200)
  useEffect(() => {
    const update = (): void => {
      const scale = typeof window !== 'undefined' && window.devicePixelRatio > 1 ? window.devicePixelRatio : 1
      const available = Math.max(520, (window.innerWidth - 80) / scale)
      setPlanModalWidth(Math.min(920, Math.floor(available)))
      // clientWidth is the CSS layout viewport and tracks Electron zoom more
      // reliably than visualViewport.width, which can remain at the pre-zoom
      // width when webContents.setZoomFactor changes the device scale.
      const layoutWidth = document.documentElement.clientWidth || window.innerWidth
      setReviewModalWidth(Math.max(720, Math.min(1480, layoutWidth - 48)))
    }
    update()
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [])

  const snapshot = snapshotQuery.data?.snapshot ?? null
  const latestPlan = plansQuery.data?.plans[0] ?? null
  const budgetQuery = useProjectBudget(projectId)
  const grantPlanId =
    draft?.status === 'approved'
      ? draft.id
      : latestPlan?.status === 'approved'
        ? latestPlan.id
        : null
  const grantQuery = usePlanGrant(grantPlanId)
  const currentGrant = grantQuery.data ?? null
  const latestGrant = latestPlan && grantPlanId === latestPlan.id ? currentGrant : null
  const replanQuery = useReplanProposals(projectId, grantPlanId, Boolean(grantPlanId))
  const agentOptions = useMemo(
    () => (agentsQuery.data?.agents ?? []).map((view) => ({
      value: view.agent.id,
      label: `${view.agent.name} · ${view.agent.role}`,
    })),
    [agentsQuery.data],
  )
  const planAgentOptions = useMemo(
    () => [...agentOptions, { value: '__custom__', label: '＋ 新建自定义 Agent' }],
    [agentOptions],
  )
  const layout = useMemo(
    () => (graphQuery.data ? buildLayout(graphQuery.data, selected?.id ?? null) : { nodes: [], edges: [], agents: [], tasks: [] }),
    [graphQuery.data, selected?.id],
  )
  const selectedRun = useRunDetail(selected?.runId ?? null)
  const selectedTaskDetail = useTaskDetail(selected?.kind === 'task' ? selected.taskId ?? null : null)

  useEffect(() => {
    setFlowNodes(layout.nodes)
  }, [layout.nodes])

  useEffect(() => {
    if (!graphQuery.data) return
    const seq = graphQuery.data.lastEventSeq
    seqCursorRef.current = Math.max(seqCursorRef.current, seq)
    setSeqCursor(seqCursorRef.current)
  }, [graphQuery.data])

  useEffect(() => {
    let syncing = false
    const unsubscribe = window.projectos.runtime.onEvent((envelope) => {
      const event = envelope.event as unknown as { projectId?: string; type?: string }
      if (event.projectId && event.projectId !== projectId) return
      void (async () => {
        if (!syncing && seqCursorRef.current > 0) {
          syncing = true
          try {
            const missed = await window.projectos.events.list({
              projectId,
              sinceSeq: seqCursorRef.current,
              limit: 200,
            })
            const latest = missed.events.reduce((max, item) => Math.max(max, item.seq), seqCursorRef.current)
            if (latest > seqCursorRef.current + 1) setSeqGap(true)
            if (latest > seqCursorRef.current) {
              seqCursorRef.current = latest
              setSeqCursor(latest)
            }
          } catch {
            // snapshot invalidation remains the fallback
          } finally {
            syncing = false
          }
        }
        await queryClient.invalidateQueries({ queryKey: qk.graph(projectId) })
      })()
      void queryClient.invalidateQueries({ queryKey: qk.snapshot(projectId) })
      if (event.type?.startsWith('task.') || event.type === 'run.status.changed') {
        void queryClient.invalidateQueries({ queryKey: qk.board(projectId) })
        void queryClient.invalidateQueries({ queryKey: qk.plans(projectId) })
      }
    })
    return unsubscribe
  }, [projectId, queryClient])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.key === 'f') {
        event.preventDefault()
        void flowRef.current?.fitView({ padding: 0.04 })
      } else if (event.key === 's') {
        event.preventDefault()
        saveLayoutRef.current()
      } else if (event.key === 'Escape') {
        setSelected(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const visibleNodes = useMemo(() => {
    const keyword = nodeFilter.trim().toLowerCase()
    return flowNodes.filter((node) => {
      const graph = (node.data as WorkbenchData).graph
      if (kindFilter !== 'all' && graph.kind !== kindFilter) return false
      if (!keyword) return true
      return graph.label.toLowerCase().includes(keyword) || (graph.subtitle ?? '').toLowerCase().includes(keyword)
    })
  }, [flowNodes, nodeFilter, kindFilter])
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes])
  const visibleEdges = useMemo(
    () => layout.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    [layout.edges, visibleIds],
  )

  const invalidate = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.snapshot(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.plans(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.graph(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.board(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.bootstrap }),
      queryClient.invalidateQueries({ queryKey: qk.sessions(projectId) }),
    ])
  }

  const scan = async (): Promise<void> => {
    try {
      await window.projectos.projectAnalysis.scan(projectId)
      await invalidate()
      message.success('项目扫描完成')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  useEffect(() => {
    if (autoScan.current || snapshotQuery.isLoading) return
    if (snapshotQuery.data?.snapshot) return
    autoScan.current = true
    void scan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotQuery.isLoading, snapshotQuery.data])

  const openPlanModal = (): void => {
    setPlannerError(null)
    if (latestPlan && ['draft', 'approved'].includes(latestPlan.status)) {
      setDraft(latestPlan)
      setGoal(latestPlan.goal)
      setPlanMode(latestPlan.generatedBy === 'provider' ? 'ai' : 'local')
    } else {
      setDraft(null)
      setGoal('')
      setPlanMode('ai')
    }
    setPlanOpen(true)
  }

  const generate = async (mode: 'ai' | 'local' = planMode): Promise<void> => {
    if (goal.trim().length < 3) {
      message.warning('请输入目标')
      return
    }
    setPlanMode(mode)
    setGenerating(true)
    setPlannerError(null)
    try {
      const plan = await window.projectos.plans.generate(projectId, goal.trim(), {
        mode,
        allowRuleFallback: false,
        maxTasks: 12,
      })
      setDraft(plan)
      await queryClient.invalidateQueries({ queryKey: qk.plans(projectId) })
      message.success(mode === 'ai' ? 'AI 已生成计划草稿，请校验后批准' : '已生成本地规则草稿')
    } catch (error) {
      // AI failures are shown inline (with the explicit local-rule fallback);
      // a toast on top of the modal would obscure the actionable error.
      setPlannerError(errorMessage(error))
      if (mode === 'local') message.error('生成计划失败')
    } finally {
      setGenerating(false)
    }
  }

  const updateDraftTask = (index: number, patch: Partial<PlannedTask>): void => {
    setDraft((current) => {
      if (!current) return current
      const tasks = current.tasks.map((task, taskIndex) => (taskIndex === index ? { ...task, ...patch } : task))
      return { ...current, tasks }
    })
  }

  const openCustomAgent = (taskKey: string): void => {
    setCustomAgentTaskKey(taskKey)
    setAgentStudioOpen(true)
  }

  const attachCreatedAgent = (agent: AgentDefinition): void => {
    if (!customAgentTaskKey) return
    const index = draft?.tasks.findIndex((task) => task.key === customAgentTaskKey) ?? -1
    if (index >= 0) {
      updateDraftTask(index, {
        role: 'custom',
        agentId: agent.id,
        // The new Agent owns the task's capability contract. Do not keep a
        // previous role's hard capability (e.g. architect) on this node.
        hardCapabilities: [],
        requiredCapabilities: [],
        assignmentBlocked: false,
        assignmentReasons: [`手动指定：用户创建自定义 Agent ${agent.name}`],
      })
    }
    setCustomAgentTaskKey(null)
  }

  const addDraftTask = (): void => {
    setDraft((current) => {
      if (!current) return current
      const key = `custom-${Date.now().toString(36)}`
      return {
        ...current,
        tasks: [...current.tasks, {
          key,
          title: '新任务节点',
          description: '',
          role: 'developer' as const,
          assignmentReasons: [],
          assignmentBlocked: false,
          dependsOn: [],
          acceptanceCriteria: ['完成后由人工确认'],
          expectedArtifacts: [],
          requiresApproval: true,
        }],
      }
    })
  }

  const removeDraftTask = (key: string): void => {
    setDraft((current) => current ? {
      ...current,
      tasks: current.tasks.filter((task) => task.key !== key).map((task) => ({ ...task, dependsOn: task.dependsOn.filter((dep) => dep !== key) })),
    } : current)
  }

  const startPlan = async (
    planId: string,
    forceBudget = false,
    grantId: string | null = null,
  ): Promise<void> => {
    try {
      const result = await window.projectos.orchestration.start(
        planId,
        2,
        2,
        forceBudget,
        grantId,
        typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${planId}:${Date.now()}`,
      )
      setDraft((current) => (current?.id === planId ? result : current))
      await invalidate()
      await queryClient.invalidateQueries({ queryKey: qk.planGrant(planId) })
      notification.destroy('plan-ready')
      message.success('计划开始执行')
    } catch (error) {
      const text = errorMessage(error)
      notification.error({
        key: 'plan-start-error',
        placement: 'bottomRight',
        duration: 0,
        message: '计划未能开始执行',
        description: (
          <div className="v17-plan-notification-body">
            <p>{text}</p>
            <div className="v17-plan-notification-actions">
              <Button size="small" onClick={() => navigate(`/projects/${projectId}/runs`)}>打开运行审计</Button>
              <Button size="small" onClick={() => notification.destroy('plan-start-error')}>关闭</Button>
            </div>
          </div>
        ),
      })
    }
  }

  const issueGrant = async (input: PlanExecutionGrantIssueInput, start: boolean): Promise<void> => {
    setGrantBusy(true)
    try {
      const grant = await window.projectos.plans.grant.issue(input)
      await queryClient.invalidateQueries({ queryKey: qk.planGrant(input.planId) })
      await invalidate()
      if (start) {
        const plan = await window.projectos.plans.get(input.planId)
        if (plan.execution?.status === 'paused') {
          const result = await window.projectos.orchestration.resume(input.planId)
          setDraft(result)
          await invalidate()
          await queryClient.invalidateQueries({ queryKey: qk.planGrant(input.planId) })
          message.success('已授权并继续执行')
        } else {
          await startPlan(input.planId, grant.allowOverBudget, grant.id)
        }
      } else {
        message.success('已授予计划执行权限；尚未启动执行')
      }
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setGrantBusy(false)
    }
  }

  const revokeGrant = async (grantId: string): Promise<void> => {
    if (!draft) return
    setGrantBusy(true)
    try {
      await window.projectos.plans.grant.revoke({ grantId, reason: '用户在计划面板撤销执行授权' })
      const refreshed = await window.projectos.plans.get(draft.id)
      setDraft(refreshed)
      await queryClient.invalidateQueries({ queryKey: qk.planGrant(draft.id) })
      await invalidate()
      message.info('已撤销计划执行授权；活动 Run 已请求取消')
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setGrantBusy(false)
    }
  }

  const proposeReplan = async (
    reason: string,
    trigger: 'user_requested' | 'constraints_changed',
  ): Promise<void> => {
    if (!draft) return
    setReplanBusy(true)
    try {
      const proposal = await window.projectos.plans.replan.propose({
        planId: draft.id,
        trigger,
        reason,
        allowOverBudget: false,
      })
      await queryClient.invalidateQueries({ queryKey: qk.replanProposals(draft.projectId, draft.id) })
      if (proposal.status === 'failed') {
        notification.error({
          key: 'replan-failed',
          placement: 'bottomRight',
          message: '修订提案未生成',
          description: proposal.error ?? '模型输出未通过校验，旧计划未被修改。',
          duration: 0,
        })
      } else {
        message.success('已生成修订提案；应用前不会修改计划或授权')
      }
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setReplanBusy(false)
    }
  }

  const applyReplan = async (proposalId: string): Promise<void> => {
    setReplanBusy(true)
    try {
      const result = await window.projectos.plans.replan.apply(proposalId)
      setDraft(result.plan)
      setPlanOpen(true)
      await invalidate()
      await queryClient.invalidateQueries({ queryKey: qk.planGrant(result.plan.id) })
      message.success(`已应用为计划 r${result.plan.revision} 草稿；请重新批准并授权`)
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setReplanBusy(false)
    }
  }

  const rejectReplan = async (proposalId: string): Promise<void> => {
    setReplanBusy(true)
    try {
      await window.projectos.plans.replan.reject(proposalId, '用户在计划面板拒绝修订')
      await queryClient.invalidateQueries({ queryKey: qk.replanProposals(draft?.projectId ?? '', draft?.id ?? '') })
      message.info('已拒绝修订提案；旧计划保持不变')
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setReplanBusy(false)
    }
  }

  const approve = async (): Promise<void> => {
    if (!draft) return
    try {
      const updated = await window.projectos.plans.update({
        planId: draft.id,
        goal: draft.goal,
        tasks: draft.tasks,
        assumptions: draft.assumptions,
        risks: draft.risks,
      })
      const result = await window.projectos.plans.approve(updated.id)
      setDraft(result.plan)
      await invalidate()
      await queryClient.invalidateQueries({ queryKey: qk.planGrant(result.plan.id) })
      message.success(`计划已批准，创建 ${result.taskIds.length} 个任务；请设置执行授权`)
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const reject = async (): Promise<void> => {
    if (!draft) return
    try {
      const result = await window.projectos.plans.reject(draft.id)
      setDraft(result)
      await invalidate()
      message.success('计划已拒绝')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const revise = async (): Promise<void> => {
    if (!draft) return
    try {
      const revised = await window.projectos.plans.revise({
        planId: draft.id,
        goal: draft.goal,
        tasks: draft.tasks,
        assumptions: draft.assumptions,
        risks: draft.risks,
      })
      setDraft(revised)
      await invalidate()
      message.success(`已创建 r${revised.revision} 草稿`)
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const controlExecution = async (action: 'pause' | 'resume' | 'cancel'): Promise<void> => {
    if (!draft) return
    try {
      const result =
        action === 'pause'
          ? await window.projectos.orchestration.pause(draft.id)
          : action === 'resume'
            ? await window.projectos.orchestration.resume(draft.id)
            : await window.projectos.orchestration.cancel(draft.id)
      setDraft(result)
      await invalidate()
      await queryClient.invalidateQueries({ queryKey: qk.planGrant(draft.id) })
      message.success(action === 'pause' ? '已暂停' : action === 'resume' ? '已继续' : '已取消')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const saveLayout = useCallback(async (): Promise<void> => {
    if (!flowRef.current) return
    setSavingLayout(true)
    try {
      const positions: Record<string, { x: number; y: number }> = {}
      for (const node of flowRef.current.getNodes()) positions[node.id] = node.position
      await window.projectos.graph.saveLayout(projectId, positions)
      await queryClient.invalidateQueries({ queryKey: qk.graph(projectId) })
      message.success('布局已保存')
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setSavingLayout(false)
    }
  }, [projectId, queryClient, message])

  useEffect(() => {
    saveLayoutRef.current = () => {
      void saveLayout()
    }
  }, [saveLayout])

  const loadWorktree = async (): Promise<void> => {
    if (!draft) return
    try {
      setWorktreeInfo(await window.projectos.worktrees.info(draft.id))
      setDiffOpen(true)
    } catch (error) {
      message.error(errorMessage(error))
    }
  }
  const assignSelectedTask = async (agentId: string | null): Promise<void> => {
    const task = selectedTaskDetail.data?.task
    if (!task) return
    try {
      await window.projectos.tasks.update({
        taskId: task.id,
        expectedVersion: task.version,
        assigneeAgentId: agentId,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.graph(projectId) }),
        queryClient.invalidateQueries({ queryKey: qk.board(projectId) }),
        queryClient.invalidateQueries({ queryKey: qk.task(task.id) }),
        queryClient.invalidateQueries({ queryKey: qk.plans(projectId) }),
      ])
      message.success('执行 Agent 已更新')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const [reassignChoice, setReassignChoice] = useState('')
  const [reassignBusy, setReassignBusy] = useState(false)
  const refreshReassign = async (taskId: string): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.graph(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.plans(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.collaboration(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.task(taskId) }),
      queryClient.invalidateQueries({ queryKey: qk.board(projectId) }),
    ])
  }
  const confirmReassign = async (planId: string, taskId: string, agentId: string): Promise<void> => {
    if (!agentId) return
    setReassignBusy(true)
    try {
      await window.projectos.orchestration.reassign(planId, taskId, agentId)
      await refreshReassign(taskId)
      message.success('已确认替代 Agent，统一调度器将启动该任务')
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setReassignBusy(false)
    }
  }
  const declineReassign = async (planId: string, taskId: string): Promise<void> => {
    setReassignBusy(true)
    try {
      await window.projectos.orchestration.declineReassign(planId, taskId, '用户在编排面板取消替代')
      await refreshReassign(taskId)
      message.info('已取消替代方案，任务保持阻塞，请修订计划或手动处理')
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setReassignBusy(false)
    }
  }

  const mergeWorktree = async (): Promise<void> => {
    if (!draft) return
    try {
      const info = await window.projectos.worktrees.merge(draft.id)
      setWorktreeInfo(info)
      setDraft(await window.projectos.plans.get(draft.id))
      await invalidate()
      message.success('已合并到主分支')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const discardWorktree = async (): Promise<void> => {
    if (!draft) return
    try {
      await window.projectos.worktrees.discard(draft.id)
      setDraft(await window.projectos.plans.get(draft.id))
      await invalidate()
      message.success('Worktree 已丢弃')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const counts = useMemo(() => {
    const nodes = graphQuery.data?.nodes ?? []
    return {
      agents: nodes.filter((node) => node.kind === 'agent').length,
      tasks: nodes.filter((node) => node.kind === 'task').length,
      running: nodes.filter((node) => node.status === 'running' || node.status === 'queued').length,
      blocked: nodes.filter((node) => node.status === 'blocked' || node.status === 'failed').length,
    }
  }, [graphQuery.data])


  const selectedAgent = selected?.kind === 'agent' ? selected : null
  const selectedTask = selected?.kind === 'task' ? selected : null
  const reassignPlan =
    (plansQuery.data?.plans ?? []).find((plan) => plan.createdTaskIds.includes(selectedTask?.taskId ?? '')) ?? null
  const reassignHandoff = collaborationQuery.data?.handoffs.find(
    (handoff) => handoff.taskId === selectedTask?.taskId && handoff.status === 'accepted',
  )
  const reassignPayload = (reassignHandoff?.payload?.reassignment ?? null) as ReassignmentPayload | null
  const reassignCandidates = Array.isArray(reassignPayload?.candidates) ? reassignPayload!.candidates! : []
  const activeReassignChoice = reassignCandidates.some((candidate) => candidate.agentId === reassignChoice)
    ? reassignChoice
    : reassignCandidates[0]?.agentId ?? ''
  const selectedTasks = selectedAgent
    ? layout.tasks.filter((task) => task.agentId === selectedAgent.agentId)
    : []
  const agentTasks = selectedAgent ? selectedTasks : []
  const currentTask = agentTasks.find((task) => ['running', 'waiting', 'queued'].includes(task.status)) ?? agentTasks[0]
  const taskTitles = new Map(layout.tasks.map((task) => [task.taskId ?? '', task.label]))
  const dependencyChains = layout.tasks.filter((task) => {
    const raw = graphQuery.data?.edges.find((edge) => edge.kind === 'dependency' && edge.target === task.id)
    return Boolean(raw)
  })
  const pendingApprovals = (approvalsQuery.data?.approvals ?? []).filter((approval) => approval.status === 'pending')
  const drawerTitle = selectedAgent ? selectedAgent.label : selectedTask ? selectedTask.label : (project?.name ?? '节点详情')
  const drawerSubtitle = selectedAgent
    ? `${selectedAgent.subtitle} · ${STATUS_TEXT[selectedAgent.status]}`
    : selectedTask
      ? `${selectedTask.subtitle} · ${STATUS_TEXT[selectedTask.status]}`
      : `总控节点 · ${counts.agents} Agents / ${counts.tasks} Tasks`
  const drawerStatus = selected ? STATUS_TEXT[selected.status] : ''
  const drawerTone = selected ? STATUS_TONE[selected.status] : 'neutral'

  useEffect(() => {
    if (!selected) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  if (graphQuery.isLoading) {
    return (
      <div className="po-page">
        <LoadingBlock rows={8} label="正在加载编排图" />
      </div>
    )
  }

  if (graphQuery.isError) {
    return (
      <div className="po-page">
        <ErrorState
          title="无法加载编排图"
          message={errorMessage(graphQuery.error)}
          onRetry={() => void graphQuery.refetch()}
        />
      </div>
    )
  }

  const inspectorContent = (() => {
    if (selectedAgent) {
      return (
        <>
          <div className="po-inspector-identity">
            <span className="po-inspector-avatar"><RobotOutlined /></span>
            <div>
              <strong>{selectedAgent.label}</strong>
              <span>{selectedAgent.subtitle} · {STATUS_TEXT[selectedAgent.status]}</span>
            </div>
            <StatusPill tone={STATUS_TONE[selectedAgent.status]}>{STATUS_TEXT[selectedAgent.status]}</StatusPill>
          </div>
          <Tabs
            size="small"
            activeKey={inspectorTab}
            onChange={setInspectorTab}
            items={[
              {
                key: 'overview',
                label: '概览',
                children: (
                  <div className="po-inspector-panel">
                    <div className="po-inspector-metrics">
                      <span><strong>{agentTasks.length}</strong>任务</span>
                      <span><strong>{agentTasks.filter((task) => task.status === 'completed').length}</strong>完成</span>
                      <span><strong>{agentTasks.filter((task) => task.status === 'running').length}</strong>运行</span>
                    </div>
                    <div className="po-inspector-label">当前任务</div>
                    {currentTask ? (
                      <div className="po-inspector-task">
                        <strong>{currentTask.label}</strong>
                        <span>{currentTask.subtitle}</span>
                        <Button type="link" size="small" onClick={() => navigate(`/projects/${projectId}/tasks`)}>
                          打开任务
                        </Button>
                      </div>
                    ) : (
                      <div className="po-inspector-empty">暂无任务</div>
                    )}
                    <div className="po-inspector-label">Agent 配置</div>
                    <div className="po-inspector-kv">
                      <span>Agent ID</span><code>{selectedAgent.agentId}</code>
                      <span>活跃 Run</span><code>{selectedAgent.runId ?? '—'}</code>
                      <span>角色</span><span>{selectedAgent.subtitle}</span>
                    </div>
                    <div className="po-inspector-actions">
                      <Button size="small" icon={<MessageOutlined />} onClick={() => navigate(`/projects/${projectId}/agents`)}>
                        打开会话
                      </Button>
                      <Button size="small" icon={<FileTextOutlined />} onClick={() => navigate(`/projects/${projectId}/tasks`)}>
                        任务看板
                      </Button>
                    </div>
                  </div>
                ),
              },
              {
                key: 'activity',
                label: '活动',
                children: (
                  <div className="po-inspector-panel">
                    {selectedRun.data ? (
                      <div className="po-inspector-activity">
                        <div className="po-inspector-run-status">
                          <StatusPill tone={STATUS_TONE[selectedRun.data.run.status === 'completed' ? 'completed' : 'running']}>
                            {selectedRun.data.run.status}
                          </StatusPill>
                          <span>{selectedRun.data.steps.length} 步骤</span>
                        </div>
                        {selectedRun.data.steps.slice(-6).reverse().map((step: RunStep) => (
                          <div className="po-inspector-event" key={step.id}>
                            <span className={`po-event-dot is-${step.status}`} />
                            <div>
                              <strong>{step.title}</strong>
                              <span>{formatRelative(step.createdAt)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="po-inspector-activity">
                        {(eventsQuery.data?.events ?? []).slice(0, 6).map((event) => (
                          <div className="po-inspector-event" key={event.id}>
                            <span className="po-event-dot is-completed" />
                            <div>
                              <strong>{event.summary}</strong>
                              <span>{formatRelative(event.createdAt)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'files',
                label: '文件',
                children: (
                  <div className="po-inspector-panel">
                    {(workspaceQuery.data?.entries ?? []).slice(0, 10).map((entry) => (
                      <div className="po-inspector-file" key={entry.path}>
                        <FileTextOutlined />
                        <span>{entry.path}</span>
                        <em>{entry.type === 'directory' ? '目录' : `${Math.max(1, Math.round(entry.size / 1024))} KB`}</em>
                      </div>
                    ))}
                    {!workspaceQuery.data?.entries.length ? <div className="po-inspector-empty">暂无文件</div> : null}
                  </div>
                ),
              },
              {
                key: 'approvals',
                label: '授权',
                children: (
                  <div className="po-inspector-panel">
                    {pendingApprovals.length ? pendingApprovals.slice(0, 5).map((approval: ApprovalView) => (
                      <div className="po-inspector-approval" key={approval.id}>
                        <strong>{approval.title}</strong>
                        <span>{approval.agentName} · {formatRelative(approval.requestedAt)}</span>
                        <Button type="link" size="small" onClick={() => navigate(`/projects/${projectId}/agents`)}>
                          去处理
                        </Button>
                      </div>
                    )) : <div className="po-inspector-empty">无待授权</div>}
                  </div>
                ),
              },
            ]}
          />
        </>
      )
    }
    if (selectedTask) {
      return (
        <>
          <div className="po-inspector-identity">
            <span className="po-inspector-avatar is-task"><CheckCircleOutlined /></span>
            <div>
              <strong>{selectedTask.label}</strong>
              <span>{selectedTask.subtitle}</span>
            </div>
            <StatusPill tone={STATUS_TONE[selectedTask.status]}>{STATUS_TEXT[selectedTask.status]}</StatusPill>
          </div>
          <div className="po-inspector-panel">
            <div className="po-inspector-kv">
              <span>任务 ID</span><code>{selectedTask.taskId}</code>
              <span>执行 Agent</span>
              <Select
                allowClear
                size="small"
                value={selectedTaskDetail.data?.task.assigneeAgentId ?? selectedTask.agentId ?? undefined}
                placeholder="未分配"
                options={agentOptions}
                style={{ minWidth: 170 }}
                onChange={(agentId) => void assignSelectedTask(agentId ?? null)}
              />
              <span>运行</span><code>{selectedTask.runId ?? '—'}</code>
            </div>
            <div className="po-inspector-actions">
              <Button size="small" onClick={() => navigate(`/projects/${projectId}/tasks`)}>打开任务</Button>
              {selectedTask.runId ? <Button size="small" onClick={() => navigate(`/projects/${projectId}/runs?run=${selectedTask.runId}`)}>运行记录</Button> : null}
            </div>
          </div>
          {reassignPayload?.status === 'needs_confirmation' && reassignPlan ? (
            <div className="po-reassign" data-testid="reassign-panel">
              <div className="po-reassign-head">
                <span className="po-reassign-kicker">HANDOFF FALLBACK</span>
                <strong>交接替代待确认</strong>
                <StatusPill tone="warning">需要确认</StatusPill>
              </div>
              <p className="po-reassign-error">
                原接收方启动失败：{String(reassignPayload.originalError ?? '原因未记录')}
              </p>
              <div className="po-reassign-diff">
                <span>
                  原 Agent：{reassignPayload.originalAgent?.name ?? reassignHandoff?.toAgentName ?? '—'}
                  {reassignPayload.originalAgent?.runtime ? ` · ${reassignPayload.originalAgent.runtime}` : ''}
                </span>
                {reassignPayload.runtimeChange?.to ? (
                  <span className={reassignPayload.runtimeChange.increased ? 'is-warn' : ''}>
                    Runtime：{reassignPayload.runtimeChange.from ?? '未知'} → {reassignPayload.runtimeChange.to}
                  </span>
                ) : null}
              </div>
              <div className="po-reassign-candidates" role="listbox" aria-label="候选替代 Agent">
                {reassignCandidates.map((candidate) => {
                  const selectedCandidate = candidate.agentId === activeReassignChoice
                  return (
                    <button
                      key={candidate.agentId}
                      type="button"
                      role="option"
                      aria-selected={selectedCandidate}
                      className={`po-reassign-candidate${selectedCandidate ? ' is-selected' : ''}`}
                      onClick={() => setReassignChoice(candidate.agentId)}
                    >
                      <span className="po-reassign-check">
                        {selectedCandidate ? <CheckCircleOutlined /> : <span className="po-reassign-dot" />}
                      </span>
                      <span className="po-reassign-body">
                        <span className="po-reassign-name">
                          <strong>{candidate.name}</strong>
                          <span>评分 {candidate.score}</span>
                        </span>
                        <span className="po-reassign-meta">
                          {candidate.runtime ?? '内置 Provider'} ·{' '}
                          {(candidate.capabilities ?? []).length > 0
                            ? (candidate.capabilities ?? []).join(' / ')
                            : '无能力标签'}
                        </span>
                        {candidate.addedCapabilities && candidate.addedCapabilities.length > 0 ? (
                          <em className="po-reassign-warn">权限扩大：{candidate.addedCapabilities.join('、')}</em>
                        ) : (
                          <em className="po-reassign-ok">无权限扩大</em>
                        )}
                        {candidate.raisesRuntimeRisk ? (
                          <em className="po-reassign-warn">Runtime 风险高于原 Agent</em>
                        ) : null}
                        {candidate.reasons.length > 0 ? (
                          <span className="po-reassign-reason">{candidate.reasons.slice(0, 3).join('；')}</span>
                        ) : null}
                      </span>
                    </button>
                  )
                })}
              </div>
              {reassignPayload.reasons && reassignPayload.reasons.length > 0 ? (
                <div className="po-reassign-blocker">
                  <strong>需人工确认：</strong>
                  {reassignPayload.reasons.join('；')}
                </div>
              ) : null}
              <div className="po-reassign-actions">
                <Button
                  size="small"
                  type="primary"
                  loading={reassignBusy}
                  disabled={!activeReassignChoice}
                  onClick={() => void confirmReassign(reassignPlan.id, selectedTask.taskId ?? '', activeReassignChoice)}
                >
                  确认替代
                </Button>
                <Button
                  size="small"
                  loading={reassignBusy}
                  onClick={() => void declineReassign(reassignPlan.id, selectedTask.taskId ?? '')}
                >
                  取消替代
                </Button>
              </div>
              <div className="po-reassign-status">
                任务状态：{selectedTaskDetail.data?.task.status ?? selectedTask.status} · 确认后由统一调度器启动，不会在此直接执行
              </div>
            </div>
          ) : reassignPayload?.status === 'confirmed' ? (
            <div className="po-reassign is-confirmed" data-testid="reassign-confirmed">
              <div className="po-reassign-head">
                <span className="po-reassign-kicker">HANDOFF FALLBACK</span>
                <strong>已确认替代 Agent</strong>
                <StatusPill tone="success">已确认</StatusPill>
              </div>
              <div className="po-reassign-diff">
                <span>替代 Agent：{reassignHandoff?.toAgentName ?? reassignPayload.toAgentId ?? '—'}</span>
                <span>任务状态：{selectedTaskDetail.data?.task.status ?? selectedTask.status}</span>
              </div>
              <div className="po-reassign-status">调度器将按顺序启动并记录新的 Run；原交接与旧 Run 保留审计。</div>
            </div>
          ) : reassignPayload?.status === 'declined' ? (
            <div className="po-reassign is-declined" data-testid="reassign-declined">
              <div className="po-reassign-head">
                <span className="po-reassign-kicker">HANDOFF FALLBACK</span>
                <strong>已取消替代方案</strong>
                <StatusPill tone="neutral">已取消</StatusPill>
              </div>
              <div className="po-reassign-status">任务保持阻塞；请修订计划或手动处理后再启动。</div>
            </div>
          ) : null}
        </>
      )
    }
    return (
      <div className="po-inspector-panel">
        <div className="po-inspector-overview">
          <span className="po-flow-kicker">PROJECT</span>
          <strong>{project?.name ?? '项目'}</strong>
          <span>{project?.description || '未填写描述'}</span>
        </div>
        <div className="po-inspector-metrics">
          <span><strong>{counts.agents}</strong>Agent</span>
          <span><strong>{counts.tasks}</strong>任务</span>
          <span><strong>{counts.running}</strong>运行</span>
        </div>
        <div className="po-inspector-label">最近计划</div>
        {plansQuery.data?.plans.length ? plansQuery.data.plans.slice(0, 4).map((plan) => (
          <button type="button" className="po-plan-row" key={plan.id} onClick={() => { setDraft(plan); setPlanOpen(true) }}>
            <span><strong>r{plan.revision} · {plan.goal}</strong><em>{plan.tasks.length} 任务 · {formatRelative(plan.updatedAt)}</em></span>
            <StatusPill tone={plan.status === 'approved' ? 'success' : plan.status === 'rejected' ? 'danger' : 'warning'}>
              {plan.status === 'approved' ? '已批准' : plan.status === 'rejected' ? '已拒绝' : '草稿'}
            </StatusPill>
          </button>
        )) : <div className="po-inspector-empty">暂无计划</div>}
        <div className="po-inspector-actions">
          <Button size="small" icon={<PlusOutlined />} onClick={openPlanModal}>
            生成计划
          </Button>
        </div>
      </div>
    )
  })()

  return (
    <div className="po-page po-page-wide po-orchestration-page">
        <header className="po-orch-header">
          <div className="po-orch-identity">
            <div className="po-orch-kicker"><NodeIndexOutlined /> 编排工作台</div>
            <div className="po-orch-name">
              <h1>{project?.name ?? '项目'}</h1>
              <Tag color="blue">进行中</Tag>
            </div>
            <div className="po-orch-sub">
              <span>{project?.id}</span>
              <span>阶段 {project?.currentStage}</span>
              <span>扫描 {snapshot ? formatRelative(snapshot.scannedAt) : '未完成'}</span>
            </div>
          </div>
          <div className="po-orch-metrics">
            <div><span>Agents</span><strong>{counts.agents}</strong></div>
            <div><span>Tasks</span><strong>{counts.tasks}</strong></div>
            <div><span>Active</span><strong>{counts.running}</strong></div>
            <div><span>Blocked</span><strong className={counts.blocked ? 'is-danger' : ''}>{counts.blocked}</strong></div>
          </div>
          <div className="po-orch-actions">
            <Button icon={<FileSearchOutlined />} onClick={() => void scan()} loading={snapshotQuery.isFetching}>扫描</Button>
            <Button icon={<SettingOutlined />} onClick={() => navigate(`/projects/${projectId}/agents`)}>Agent</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openPlanModal}>
              生成计划
            </Button>
          </div>
        </header>

        <div className="po-orch-progress-line">
          <span>项目推进</span>
          <div><i style={{ width: `${Math.round((project?.stats.progress ?? 0) * 100)}%` }} /></div>
          <strong>{Math.round((project?.stats.progress ?? 0) * 100)}%</strong>
          <span className="po-grow" />
          <span>任务 DAG 是唯一依赖真相</span>
        </div>

        {latestPlan?.status === 'approved' && !latestPlan.execution ? (
          <div className="v17-next-step-banner">
            <div className="v17-next-step-icon">{latestGrant?.valid ? <SafetyCertificateOutlined /> : <CheckCircleOutlined />}</div>
            <div className="v17-next-step-copy">
              <strong>{latestGrant?.valid ? '计划已批准，已授予有限执行权限' : '计划已批准，但尚未授权执行'}</strong>
              <span>
                {latestGrant?.valid
                  ? `已授权 ${latestGrant.allowedTaskIds.length} 个任务、${latestGrant.allowedAgentIds.length} 个 Agent；${latestGrant.actions.includes('workspace-write') ? `仅允许在 ${latestGrant.allowedPaths.join('、')} 写文件` : '写文件仍需逐次审批'}，进程/Git/外部 Runtime 仍需逐次审批。`
                  : `已创建 ${latestPlan.createdTaskIds.length} 个任务。批准计划不会启动 Agent；请先设置授权范围、有效期与上限。`}
              </span>
            </div>
            {latestGrant?.canStart ? (
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={() => void startPlan(latestPlan.id, latestGrant.allowOverBudget, latestGrant.id)}
              >
                开始执行
              </Button>
            ) : (
              <Button type="primary" icon={<LockOutlined />} onClick={openPlanModal}>设置执行授权</Button>
            )}
            <Button onClick={() => navigate(`/projects/${projectId}/tasks`)}>查看任务</Button>
          </div>
        ) : null}

        {latestPlan?.execution?.status === 'failed' ? (
          <div className="v17-next-step-banner is-error">
            <div className="v17-next-step-icon"><StopOutlined /></div>
            <div className="v17-next-step-copy">
              <strong>计划执行失败</strong>
              <span>{latestPlan.execution.error ?? '执行器返回了失败状态，请查看运行审计。'}</span>
            </div>
            {latestGrant?.canStart ? (
              <Button type="primary" onClick={() => void startPlan(latestPlan.id, latestGrant.allowOverBudget, latestGrant.id)}>重新执行</Button>
            ) : (
              <Button type="primary" icon={<LockOutlined />} onClick={openPlanModal}>重新设置授权</Button>
            )}
            <Button onClick={() => navigate(`/projects/${projectId}/runs`)}>运行审计</Button>
          </div>
        ) : null}

        <section className="po-orch-canvas-card po-orch-canvas-full">
            <div className="po-orch-canvas-toolbar">
              <div className="po-orch-kind-filter">
                <button type="button" className={kindFilter === 'all' ? 'is-active' : ''} onClick={() => setKindFilter('all')}>全部 {counts.agents + counts.tasks + 1}</button>
                <button type="button" className={kindFilter === 'orchestrator' ? 'is-active' : ''} onClick={() => setKindFilter('orchestrator')}>总控 1</button>
                <button type="button" className={kindFilter === 'agent' ? 'is-active' : ''} onClick={() => setKindFilter('agent')}>Agent {counts.agents}</button>
                <button type="button" className={kindFilter === 'task' ? 'is-active' : ''} onClick={() => setKindFilter('task')}>Task {counts.tasks}</button>
              </div>
              <span>AGENT TOPOLOGY</span>
              <span className="po-orch-seq">SEQ {seqCursor}{seqGap ? ' · 已补齐' : ''}</span>
              <Input
                size="small"
                allowClear
                value={nodeFilter}
                onChange={(event) => setNodeFilter(event.target.value)}
                placeholder="筛选节点（f 适配 / s 保存 / Esc 清除）"
                className="po-orch-filter"
              />
              <span className="po-grow" />
              <Button size="small" icon={<SaveOutlined />} loading={savingLayout} onClick={() => void saveLayout()}>保存布局</Button>
              <Button size="small" icon={<CompressOutlined />} onClick={() => void flowRef.current?.fitView({ padding: 0.04 })}>适配</Button>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => void graphQuery.refetch()} />
            </div>
            <div className={`po-orch-canvas${compactGraph ? ' is-compact' : ''}`}>
              <ReactFlow
                nodes={visibleNodes}
                edges={visibleEdges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.02, maxZoom: 1.1 }}
                minZoom={0.3}
                maxZoom={1.5}
                onInit={(flow) => {
                  flowRef.current = flow
                  setCompactGraph(flow.getZoom() < COMPACT_GRAPH_ZOOM)
                }}
                onMove={(_event, viewport) => setCompactGraph(viewport.zoom < COMPACT_GRAPH_ZOOM)}
                onNodesChange={(changes: NodeChange<FlowNode>[]) => setFlowNodes((current) => applyNodeChanges(changes, current))}
                onNodeClick={(_event, node) => {
                  const graph = graphQuery.data?.nodes.find((item) => item.id === node.id) ?? null
                  setSelected(graph)
                  setInspectorTab('overview')
                  setDetailTab('node')
                }}
                onPaneClick={() => setSelected(null)}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={20} size={1} color={resolvedTheme === "dark" ? "#202a39" : "#d5dce8"} />
                <Controls showInteractive={false} />
                <MiniMap pannable zoomable nodeColor={(node) => {
                  const graph = (node.data as WorkbenchData).graph
                  if (graph.status === 'running' || graph.status === 'queued') return '#3b82f6'
                  if (graph.status === 'blocked' || graph.status === 'failed') return '#ef4444'
                  if (graph.status === 'completed') return '#22c55e'
                  return '#556173'
                }} />
              </ReactFlow>
              <div className="po-orch-legend">
                <span><i className="is-agent" /> Agent</span>
                <span><i className="is-task" /> Task</span>
                <span><i className="is-running" /> 运行中</span>
                <span><i className="is-completed" /> 完成</span>
                <span><i className="is-blocked" /> 阻塞</span>
                <span>每 Agent 最多显示 2 个任务</span>
              </div>
            </div>
          </section>




        {selected ? (
          <div className="po-orch-drawer-layer is-nonmodal">
            <aside className="po-orch-drawer-panel" role="complementary" aria-label="节点详情">
              <header className="po-orch-panel-head">
                <div className="po-orch-panel-title">
                  <span className={`po-orch-panel-icon is-${selected.kind}`}>
                    {selectedAgent ? <RobotOutlined /> : selectedTask ? <CheckCircleOutlined /> : <ApartmentOutlined />}
                  </span>
                  <div>
                    <span className="po-orch-panel-kicker">NODE INSPECTOR</span>
                    <strong>{drawerTitle}</strong>
                    <small>{drawerSubtitle}</small>
                  </div>
                </div>
                <div className="po-orch-panel-head-actions">
                  {drawerStatus ? <StatusPill tone={drawerTone}>{drawerStatus}</StatusPill> : null}
                  <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setSelected(null)} aria-label="关闭" />
                </div>
              </header>
              <Tabs
                className="po-orch-panel-tabs"
                activeKey={detailTab}
                onChange={setDetailTab}
                items={[
                  { key: 'node', label: '节点', children: <div className="po-orch-panel-body">{inspectorContent}</div> },
                  {
                    key: 'logs',
                    label: '运行日志',
                    children: (
                      <div className="po-orch-panel-body po-orch-drawer-log">
                        {(eventsQuery.data?.events ?? []).slice(0, 20).map((event) => (
                          <div className="po-orch-log-row" key={event.id}>
                            <span>{formatRelative(event.createdAt)}</span>
                            <span className="po-flow-dot is-completed" />
                            <strong>{event.summary}</strong>
                            <em>{event.eventType}</em>
                          </div>
                        ))}
                        {!eventsQuery.data?.events.length ? <div className="po-inspector-empty">暂无运行事件</div> : null}
                        <Button size="small" onClick={() => navigate(`/projects/${projectId}/runs`)}>打开运行审计</Button>
                      </div>
                    ),
                  },
                  {
                    key: 'dependencies',
                    label: '依赖流',
                    children: (
                      <div className="po-orch-panel-body po-orch-drawer-deps">
                        {dependencyChains.length ? dependencyChains.map((task) => {
                          const dependency = graphQuery.data?.edges.find((edge) => edge.kind === 'dependency' && edge.target === task.id)
                          const parent = dependency?.source.replace('task:', '')
                          return (
                            <div className="po-dep-chain" key={task.id}>
                              <span className="po-dep-chip">{taskTitles.get(parent ?? '') ?? '前置任务'}</span>
                              <span className="po-dep-arrow">→</span>
                              <span className="po-dep-chip is-current">{task.label}</span>
                              <span className={`po-flow-dot is-${task.status}`} />
                            </div>
                          )
                        }) : <span className="po-dep-empty">暂无任务依赖</span>}
                        <Button size="small" onClick={() => navigate(`/projects/${projectId}/tasks`)}>打开任务看板</Button>
                      </div>
                    ),
                  },
                ]}
              />
            </aside>
          </div>
        ) : null}

        <DialogShell
          open={planOpen}
          onOpenChange={(open) => { if (!open) setPlanOpen(false) }}
          ariaLabel={draft ? '计划审核' : '生成计划'}
          width={draft ? reviewModalWidth : planModalWidth}
          testId="plan-workbench-dialog"
        >
          <button type="button" className="pui-overlay-close po-plan-dialog-close" aria-label="关闭计划工作区" onClick={() => setPlanOpen(false)}><CloseOutlined /></button>
          <OverlayScrollArea className="po-plan-dialog-scroll">
          <div className="po-plan-editor">
            {!draft ? (
              <>
                <label className="po-plan-label">需求目标</label>
                <Input.TextArea
                  rows={2}
                  value={goal}
                  onChange={(event) => {
                    setGoal(event.target.value)
                    if (plannerError) setPlannerError(null)
                  }}
                  placeholder="例如：增加角色分级的用户权限管理，覆盖数据、接口、前端与测试"
                />
              </>
            ) : null}
            {!draft ? (
              <div className="po-plan-planner">
                <div className="po-plan-planner-head">
                  <span className="po-plan-planner-icon"><ThunderboltOutlined /></span>
                  <div className="po-plan-planner-copy">
                    <strong>AI 智能 Planner</strong>
                    <span>读取项目快照、相关文件摘要、Agent 能力与已有成果，生成可解释、可校验、可编辑的 DAG 草稿。</span>
                  </div>
                  <Tag color="blue">Phase 2B-1</Tag>
                </div>

                <div className="po-plan-mode-switch" role="radiogroup" aria-label="计划生成方式">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={planMode === 'ai'}
                    className={planMode === 'ai' ? 'is-active' : ''}
                    onClick={() => { setPlanMode('ai'); setPlannerError(null) }}
                    disabled={generating}
                  >
                    <ThunderboltOutlined />
                    <span><strong>AI 生成</strong><em>调用默认 AI 连接与模型</em></span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={planMode === 'local'}
                    className={planMode === 'local' ? 'is-active' : ''}
                    onClick={() => { setPlanMode('local'); setPlannerError(null) }}
                    disabled={generating}
                  >
                    <FileTextOutlined />
                    <span><strong>本地规则</strong><em>固定模板，不调用模型</em></span>
                  </button>
                </div>

                <div className="po-plan-hint">
                  <InfoCircleOutlined />
                  <span>
                    {planMode === 'ai'
                      ? '只生成草稿：不会批准、创建执行任务、启动 Agent 或写入项目文件。模型可能需要 10–60 秒。'
                      : '本地规则使用固定任务模板，来源会如实标记为 local-rules，不冒充模型生成。'}
                  </span>
                </div>

                {generating ? (
                  <div className="po-plan-progress" role="status" aria-live="polite" data-testid="plan-generate-progress">
                    <span className="po-plan-progress-dots" aria-hidden="true"><i /><i /><i /></span>
                    <div className="po-plan-progress-copy">
                      <strong>
                        {planElapsed < 8
                          ? '正在读取项目快照与文件上下文'
                          : planElapsed < 25
                            ? '模型正在生成任务 DAG'
                            : '模型正在整理依赖与验收标准'}
                      </strong>
                      <span>已等待 {planElapsed}s · 复杂计划通常需要 20–60 秒，请不要关闭窗口</span>
                    </div>
                    <span className="po-plan-progress-track" aria-hidden="true"><i /></span>
                  </div>
                ) : null}

                {plannerError ? (
                  <div className="po-plan-error" data-testid="plan-generate-error" role="alert">
                    <WarningOutlined />
                    <div className="po-plan-error-copy">
                      <strong>规划失败，未保存任何计划</strong>
                      <span>{plannerError}</span>
                    </div>
                    {planMode === 'ai' ? (
                      <Button size="small" onClick={() => void generate('local')} disabled={generating}>
                        改用本地规则
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                <div className="po-plan-actions">
                  <Button
                    type="primary"
                    icon={planMode === 'ai' ? <ThunderboltOutlined /> : <FileTextOutlined />}
                    loading={generating}
                    disabled={goal.trim().length < 3 || generating}
                    onClick={() => void generate(planMode)}
                    data-testid="plan-generate"
                  >
                    {generating ? (planMode === 'ai' ? 'AI 正在规划…' : '正在生成…') : planMode === 'ai' ? 'AI 生成草稿' : '生成草稿'}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <PlanReviewNext
                  draft={draft}
                  roleLabels={ROLE_LABELS}
                  agentOptions={planAgentOptions}
                  onUpdateTask={updateDraftTask}
                  onUpdateGoal={(goal) => setDraft((current) => (current ? { ...current, goal } : current))}
                  onAddTask={addDraftTask}
                  onRemoveTask={removeDraftTask}
                  onOpenCustomAgent={openCustomAgent}
                />
                {draft.status === 'approved' ? (
                  <PlanGrantPanel
                    plan={draft}
                    grant={currentGrant}
                    budget={budgetQuery.data ?? null}
                    busy={grantBusy}
                    onIssue={issueGrant}
                    onRevoke={revokeGrant}
                    onStart={(grantId) => startPlan(draft.id, currentGrant?.allowOverBudget ?? false, grantId)}
                    onResume={() => controlExecution('resume')}
                  />
                ) : null}
                {draft.status === 'approved' ? (
                  <ReplanPanel
                    plan={draft}
                    proposals={replanQuery.data?.proposals ?? []}
                    busy={replanBusy}
                    onPropose={proposeReplan}
                    onApply={applyReplan}
                    onReject={rejectReplan}
                  />
                ) : null}

                {draft.execution ? (
                  <div className="po-plan-execution">
                    <StatusPill
                      tone={
                        draft.execution.status === 'completed'
                          ? 'success'
                          : draft.execution.status === 'failed'
                            ? 'danger'
                            : draft.execution.status === 'running'
                              ? 'accent'
                              : 'warning'
                      }
                    >
                      {draft.execution.status}
                    </StatusPill>
                    <span>并发 {draft.execution.concurrency}</span>
                    <span>{draft.execution.runIds.length} Runs</span>
                    {draft.execution.error ? <em>{draft.execution.error}</em> : null}
                  </div>
                ) : null}
                {draft.status !== 'draft' ? <div className="po-plan-actions">
                  <Button onClick={() => setPlanOpen(false)}>关闭</Button>
                  <Button icon={<ReloadOutlined />} onClick={() => void revise()}>修订为新版本</Button>
                  {draft.execution?.status === 'running' ? (
                    <Button icon={<PauseCircleOutlined />} onClick={() => void controlExecution('pause')}>暂停</Button>
                  ) : null}
                  {draft.execution && ['running', 'paused'].includes(draft.execution.status) ? (
                    <Button danger icon={<StopOutlined />} onClick={() => void controlExecution('cancel')}>取消</Button>
                  ) : null}
                  {draft.execution?.status === 'completed' && draft.execution.branch ? (
                    <>
                      <Button icon={<FileTextOutlined />} onClick={() => void loadWorktree()}>查看 Diff</Button>
                      <Popconfirm
                        title="合并到主分支？"
                        description={`将 ${draft.execution.branch} 合并进主工作区，需先查看 Diff。`}
                        okText="合并"
                        cancelText="取消"
                        disabled={Boolean(draft.execution.mergedAt)}
                        onConfirm={() => void mergeWorktree()}
                      >
                        <Button type="primary" disabled={Boolean(draft.execution.mergedAt)}>
                          {draft.execution.mergedAt ? '已合并' : '合并到主分支'}
                        </Button>
                      </Popconfirm>
                      <Popconfirm
                        title="丢弃该计划的 Worktree？"
                        description="分支上的改动将不再合并，主工作区不受影响。"
                        onConfirm={() => void discardWorktree()}
                      >
                        <Button danger icon={<DeleteOutlined />}>丢弃</Button>
                      </Popconfirm>
                    </>
                  ) : null}
                </div> : null}
                {draft.execution?.branch ? (
                  <div className="po-plan-branch">
                    <span>{draft.execution.branch}</span>
                    <span>{draft.execution.workspaceRef}</span>
                    {draft.execution.mergedAt ? <Tag color="green">已合并</Tag> : <Tag color="blue">隔离分支</Tag>}
                  </div>
                ) : null}
              </>
            )}
          </div>
          </OverlayScrollArea>
          {draft?.status === 'draft' ? (
            <OverlayFooter>
              <div className="po-plan-footer-actions">
                {hasPlanBlockingIssues(draft) ? <span className="po-plan-footer-blocker">存在阻塞性问题：展开“需复核”查看并修复后再批准。</span> : null}
                <Button onClick={() => void reject()}>拒绝</Button>
                <Button type="primary" icon={<CheckCircleOutlined />} disabled={hasPlanBlockingIssues(draft)} onClick={() => void approve()} data-testid="plan-approve">批准并创建任务</Button>
              </div>
            </OverlayFooter>
          ) : null}
        </DialogShell>

        <SheetShell open={diffOpen} onOpenChange={(open) => { if (!open) setDiffOpen(false) }} ariaLabel="Worktree Diff" width={900} testId="worktree-diff-sheet">
          <OverlayHeader eyebrow="WORKTREE" title={worktreeInfo?.branch ? `Worktree · ${worktreeInfo.branch}` : 'Worktree Diff'} closeLabel="关闭 Worktree Diff" />
          <OverlayScrollArea className="po-diff-scroll">
            <div className="po-diff-meta">
              <code>{worktreeInfo?.workspaceRef ?? '—'}</code>
              <span>{worktreeInfo?.diffArtifactId ? 'Diff artifact 已生成' : 'Diff 实时读取'}</span>
            </div>
            <pre className="po-diff-view">{worktreeInfo?.diff || '暂无改动'}</pre>
          </OverlayScrollArea>
          <OverlayFooter>
            <Button onClick={() => setDiffOpen(false)}>关闭</Button>
          </OverlayFooter>
        </SheetShell>

        <AgentStudioModal
          open={agentStudioOpen}
          projectId={projectId}
          onClose={() => {
            setAgentStudioOpen(false)
            setCustomAgentTaskKey(null)
          }}
          onCreated={attachCreatedAgent}
        />
      </div>
  )
}
