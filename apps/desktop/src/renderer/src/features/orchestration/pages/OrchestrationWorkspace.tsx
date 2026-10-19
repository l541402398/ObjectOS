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
  MessageOutlined,
  NodeIndexOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  SettingOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import {
  Background,
  Controls,
  Handle,
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
import type { ApprovalView, GraphNode, PlanDraft, PlannedTask, RunStep, WorktreeInfo } from '@projectos/contracts'
import { ErrorState, LoadingBlock, StatusPill } from '@projectos/ui'
import {
  qk,
  useApprovals,
  useBootstrap,
  useGraph,
  usePlans,
  useProjectEvents,
  useProjectSnapshot,
  useRunDetail,
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
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      className: `po-flow-edge is-${edge.kind}`,
      style: { stroke: 'rgba(112, 140, 180, 0.42)', strokeWidth: 1.2 },
    }))
  return { nodes, edges, agents, tasks }
}

export default function OrchestrationWorkspace() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message, modal } = AntApp.useApp()
  const bootstrap = useBootstrap()
  const project = bootstrap.data?.projects.find((item) => item.id === projectId) ?? null
  const snapshotQuery = useProjectSnapshot(projectId)
  const plansQuery = usePlans(projectId)
  const graphQuery = useGraph(projectId)
  const approvalsQuery = useApprovals(projectId)
  const eventsQuery = useProjectEvents(projectId, 20)
  const workspaceQuery = useWorkspace(projectId)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [planOpen, setPlanOpen] = useState(false)
  const [goal, setGoal] = useState('')
  const [draft, setDraft] = useState<PlanDraft | null>(null)
  const [savingLayout, setSavingLayout] = useState(false)
  const [worktreeInfo, setWorktreeInfo] = useState<WorktreeInfo | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [seqCursor, setSeqCursor] = useState(0)
  const [seqGap, setSeqGap] = useState(false)
  const [nodeFilter, setNodeFilter] = useState('')
  const seqCursorRef = useRef(0)
  const saveLayoutRef = useRef<() => void>(() => undefined)
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>([])
  const [inspectorTab, setInspectorTab] = useState('overview')
  const flowRef = useRef<ReactFlowInstance<FlowNode> | null>(null)
  const autoScan = useRef(false)
  const resolvedTheme = useResolvedTheme()
  const initialSelection = useRef(false)

  const snapshot = snapshotQuery.data?.snapshot ?? null
  const latestPlan = plansQuery.data?.plans[0] ?? null
  const layout = useMemo(
    () => (graphQuery.data ? buildLayout(graphQuery.data, selected?.id ?? null) : { nodes: [], edges: [], agents: [], tasks: [] }),
    [graphQuery.data, selected?.id],
  )
  const selectedRun = useRunDetail(selected?.runId ?? null)

  useEffect(() => {
    setFlowNodes(layout.nodes)
  }, [layout.nodes])

  useEffect(() => {
    if (initialSelection.current || !graphQuery.data) return
    const firstAgent = graphQuery.data.nodes.find((node) => node.kind === 'agent') ?? null
    if (firstAgent) {
      initialSelection.current = true
      setSelected(firstAgent)
    }
  }, [graphQuery.data])

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
    if (!keyword) return flowNodes
    return flowNodes.filter((node) => {
      const graph = (node.data as WorkbenchData).graph
      return graph.label.toLowerCase().includes(keyword) || (graph.subtitle ?? '').toLowerCase().includes(keyword)
    })
  }, [flowNodes, nodeFilter])
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

  const generate = async (): Promise<void> => {
    if (goal.trim().length < 3) {
      message.warning('请输入目标')
      return
    }
    try {
      const plan = await window.projectos.plans.generate(projectId, goal.trim())
      setDraft(plan)
      message.success('已生成计划草稿')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const updateDraftTask = (index: number, patch: Partial<PlannedTask>): void => {
    setDraft((current) => {
      if (!current) return current
      const tasks = current.tasks.map((task, taskIndex) => (taskIndex === index ? { ...task, ...patch } : task))
      return { ...current, tasks }
    })
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
      setPlanOpen(false)
      await invalidate()
      message.success(`计划已批准，创建 ${result.taskIds.length} 个任务`)
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

  const controlExecution = async (action: 'start' | 'pause' | 'resume' | 'cancel', forceBudget = false): Promise<void> => {
    if (!draft) return
    try {
      const result =
        action === 'start'
          ? await window.projectos.orchestration.start(draft.id, 2, 2, forceBudget)
          : action === 'pause'
            ? await window.projectos.orchestration.pause(draft.id)
            : action === 'resume'
              ? await window.projectos.orchestration.resume(draft.id)
              : await window.projectos.orchestration.cancel(draft.id)
      setDraft(result)
      await invalidate()
      message.success(
        action === 'start' ? '计划开始执行' : action === 'pause' ? '已暂停' : action === 'resume' ? '已继续' : '已取消',
      )
    } catch (error) {
      const text = errorMessage(error)
      if (action === 'start' && !forceBudget && text.includes('软预算')) {
        modal.confirm({
          title: '已超过软预算',
          content: text,
          okText: '继续执行',
          cancelText: '取消',
          onOk: () => controlExecution('start', true),
        })
        return
      }
      message.error(text)
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
              <span>Agent</span><span>{selectedTask.agentId ?? '未分配'}</span>
              <span>运行</span><code>{selectedTask.runId ?? '—'}</code>
            </div>
            <div className="po-inspector-actions">
              <Button size="small" onClick={() => navigate(`/projects/${projectId}/tasks`)}>打开任务</Button>
              {selectedTask.runId ? <Button size="small" onClick={() => navigate(`/projects/${projectId}/runs?run=${selectedTask.runId}`)}>运行记录</Button> : null}
            </div>
          </div>
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
          <Button size="small" icon={<PlusOutlined />} onClick={() => { setDraft(latestPlan?.status === 'draft' ? latestPlan : null); setGoal(latestPlan?.status === 'draft' ? latestPlan.goal : ''); setPlanOpen(true) }}>
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
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setDraft(latestPlan?.status === 'draft' ? latestPlan : null); setGoal(latestPlan?.status === 'draft' ? latestPlan.goal : ''); setPlanOpen(true) }}>
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

        <div className="po-orch-grid">
          <section className="po-orch-canvas-card">
            <div className="po-orch-canvas-toolbar">
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
            <div className="po-orch-canvas">
              <ReactFlow
                nodes={visibleNodes}
                edges={visibleEdges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.02, maxZoom: 1.1 }}
                minZoom={0.3}
                maxZoom={1.5}
                onInit={(flow) => { flowRef.current = flow }}
                onNodesChange={(changes: NodeChange<FlowNode>[]) => setFlowNodes((current) => applyNodeChanges(changes, current))}
                onNodeClick={(_event, node) => {
                  const graph = graphQuery.data?.nodes.find((item) => item.id === node.id) ?? null
                  setSelected(graph)
                  setInspectorTab('overview')
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

          <aside className="po-orch-inspector">
            <div className="po-orch-inspector-head">
              <strong>Inspector</strong>
              {selected ? <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setSelected(null)} /> : null}
            </div>
            {inspectorContent}
          </aside>
        </div>

        <section className="po-dep-flow">
          <div className="po-dep-head">
            <span><ThunderboltOutlined /> 依赖流</span>
            <span>{dependencyChains.length} 条依赖</span>
            <span className="po-grow" />
            <Button size="small" type="text" onClick={() => navigate(`/projects/${projectId}/tasks`)}>任务看板</Button>
          </div>
          <div className="po-dep-body">
            {dependencyChains.length ? dependencyChains.slice(0, 6).map((task) => {
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
          </div>
        </section>

        <Modal
          title={draft?.status === 'approved' ? `计划 r${draft.revision}` : '生成计划'}
          open={planOpen}
          onCancel={() => setPlanOpen(false)}
          footer={null}
          width={780}
          destroyOnHidden
          className="po-plan-modal"
        >
          <div className="po-plan-editor">
            <label className="po-plan-label">目标</label>
            <Input.TextArea
              rows={2}
              value={draft?.goal ?? goal}
              onChange={(event) => {
                if (draft) setDraft({ ...draft, goal: event.target.value })
                else setGoal(event.target.value)
              }}
              placeholder="例如：增加 RBAC 权限管理"
              disabled={draft?.status !== 'draft' && Boolean(draft)}
            />
            {!draft ? (
              <Button type="primary" onClick={() => void generate()} disabled={goal.trim().length < 3}>生成草稿</Button>
            ) : (
              <>
                <div className="po-plan-meta">
                  <span>r{draft.revision}</span>
                  <span>{draft.generatedBy === 'local-rules' ? '本地规则草案' : '模型生成'}</span>
                  <span>{draft.tasks.length} 任务</span>
                </div>
                <div className="po-plan-task-list">
                  {draft.tasks.map((task, index) => (
                    <div className="po-plan-task" key={task.key}>
                      <div className="po-plan-task-head">
                        <Input value={task.title} disabled={draft.status !== 'draft'} onChange={(event) => updateDraftTask(index, { title: event.target.value })} />
                        <Select value={task.role} disabled={draft.status !== 'draft'} options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))} onChange={(role) => updateDraftTask(index, { role: role as PlannedTask['role'] })} />
                      </div>
                      <div className="po-plan-task-deps">
                        {draft.status === 'draft' ? (
                          <Select
                            mode="multiple"
                            size="small"
                            value={task.dependsOn}
                            placeholder="前置任务"
                            style={{ minWidth: 190 }}
                            options={draft.tasks
                              .filter((item) => item.key !== task.key)
                              .map((item) => ({ value: item.key, label: item.title }))}
                            onChange={(dependsOn) => updateDraftTask(index, { dependsOn })}
                          />
                        ) : (
                          task.dependsOn.length ? task.dependsOn.map((dep) => <Tag key={dep}>{dep}</Tag>) : <span>无前置</span>
                        )}
                        <span>{task.acceptanceCriteria.length} 条验收</span>
                      </div>
                    </div>
                  ))}
                </div>
                {draft.assumptions.length || draft.risks.length ? (
                  <div className="po-plan-notes">
                    {draft.assumptions.map((item) => <span key={item}>假设：{item}</span>)}
                    {draft.risks.map((item) => <span key={item}>风险：{item}</span>)}
                  </div>
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
                <div className="po-plan-actions">
                  {draft.status === 'draft' ? <Button onClick={() => void reject()}>拒绝</Button> : <Button onClick={() => setPlanOpen(false)}>关闭</Button>}
                  {draft.status === 'draft' ? <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => void approve()}>批准并创建任务</Button> : null}
                  {draft.status !== 'draft' ? <Button icon={<ReloadOutlined />} onClick={() => void revise()}>修订为新版本</Button> : null}
                  {draft.status === 'approved' && !draft.execution ? (
                    <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => void controlExecution('start')}>开始执行</Button>
                  ) : null}
                  {draft.execution?.status === 'running' ? (
                    <Button icon={<PauseCircleOutlined />} onClick={() => void controlExecution('pause')}>暂停</Button>
                  ) : null}
                  {draft.execution?.status === 'paused' ? (
                    <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => void controlExecution('resume')}>继续</Button>
                  ) : null}
                  {draft.execution && ['running', 'paused'].includes(draft.execution.status) ? (
                    <Button danger icon={<StopOutlined />} onClick={() => void controlExecution('cancel')}>取消</Button>
                  ) : null}
                  {draft.execution?.status === 'completed' && draft.execution.branch ? (
                    <>
                      <Button icon={<FileTextOutlined />} onClick={() => void loadWorktree()}>查看 Diff</Button>
                      <Button
                        type="primary"
                        disabled={Boolean(draft.execution.mergedAt)}
                        onClick={() => void mergeWorktree()}
                      >
                        {draft.execution.mergedAt ? '已合并' : '合并到主分支'}
                      </Button>
                      <Popconfirm
                        title="丢弃该计划的 Worktree？"
                        description="分支上的改动将不再合并，主工作区不受影响。"
                        onConfirm={() => void discardWorktree()}
                      >
                        <Button danger icon={<DeleteOutlined />}>丢弃</Button>
                      </Popconfirm>
                    </>
                  ) : null}
                </div>
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
        </Modal>

        <Modal
          title={worktreeInfo?.branch ? `Worktree · ${worktreeInfo.branch}` : 'Worktree Diff'}
          open={diffOpen}
          onCancel={() => setDiffOpen(false)}
          footer={<Button onClick={() => setDiffOpen(false)}>关闭</Button>}
          width={900}
          className="po-plan-modal"
        >
          <div className="po-diff-meta">
            <code>{worktreeInfo?.workspaceRef ?? '—'}</code>
            <span>{worktreeInfo?.diffArtifactId ? 'Diff artifact 已生成' : 'Diff 实时读取'}</span>
          </div>
          <pre className="po-diff-view">{worktreeInfo?.diff || '暂无改动'}</pre>
        </Modal>
      </div>
  )
}





