import { AgentAvatar } from '@projectos/ui'
import { AgentWorkflowMaterials, RequirementMaterials } from '../../pages/RequirementMaterials'
import '../../pages/requirement-flow.css'
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowRight,
  Bot,
  Check,
  CircleAlert,
  Clock,
  Layers,
  RefreshCw,
  ShieldAlert,
  Workflow,
} from 'lucide-react'
import {
  REQUIREMENT_STAGES,
  type CollaborationOverviewAgent,
  type HandoffView,
  type RunStatus,
} from '@projectos/contracts'
import { useResolvedTheme } from '../../stores/ui'
import { errorMessage } from '../../lib/errors'
import { formatDateTime, formatRelative } from '../../lib/format'
import { runStatusLabel, taskStatusLabel } from '../../lib/labels'
import { qk, useCollaborationOverview, useProjectRequirementFlows } from '../../lib/queries'
import { OverlayFooter, OverlayHeader, OverlayScrollArea, InspectorShell } from '../../next-ui/overlay/overlay-shell'
import { CollaborationGraph, type GraphSelection } from './CollaborationGraph'
import { projectCollaborationFocus } from './focus-projection'
import { AgentContextActions } from './AgentContextActions'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../next-ui/vendor/tabs'
import '@projectos/design-tokens/precision.css'
import './collaboration-overview.css'

const ACTIVE_RUN_STATUSES: RunStatus[] = [
  'created',
  'queued',
  'running',
  'waiting_tool',
  'waiting_approval',
  'verifying',
  'suspended',
]

type Filter = 'all' | 'agents' | 'tasks' | 'outputs'

interface SavedGraphState {
  selection: GraphSelection | null
  filter: Filter
  viewport: { x: number; y: number; zoom: number } | null
}

function readSavedGraphState(projectId: string): SavedGraphState | null {
  try {
    const raw = sessionStorage.getItem('aco:graph:' + projectId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SavedGraphState>
    return {
      selection: parsed.selection ?? null,
      filter: parsed.filter ?? 'all',
      viewport: parsed.viewport ?? null,
    }
  } catch {
    return null
  }
}

const ARTIFACT_LABELS: Record<string, string> = {
  document: '文档',
  code: '代码',
  'test-report': '测试报告',
  diff: '变更 Diff',
  design: '设计',
  'release-note': '发布说明',
  other: '其他',
}

function agentStatus(agent: CollaborationOverviewAgent): { label: string; tone: 'accent' | 'warn' | 'neutral' } {
  if (agent.pendingApprovals > 0 || agent.runStatus === 'waiting_approval') return { label: '等待审批', tone: 'warn' }
  if (agent.status === 'working') return { label: '工作中', tone: 'accent' }
  if (agent.status === 'offline') return { label: '离线', tone: 'neutral' }
  return { label: '空闲', tone: 'neutral' }
}

function handoffStatusLabel(status: HandoffView['status']): string {
  if (status === 'requested') return '待接受'
  if (status === 'accepted') return '已接受'
  if (status === 'rejected') return '已拒绝'
  if (status === 'expired') return '已过期'
  return '已取消'
}

export function CollaborationOverview({
  projectId,
  onManageAgents,
  requestedAgentId,
  requestedSessionId,
  requestedTaskId,
  onContextRequestHandled,
}: {
  projectId: string
  onManageAgents: () => void
  requestedAgentId?: string | null
  requestedSessionId?: string | null
  requestedTaskId?: string | null
  onContextRequestHandled: () => void
}): ReactElement {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const theme = useResolvedTheme()
  const overview = useCollaborationOverview(projectId)
  const reqFlowsQuery = useProjectRequirementFlows(projectId)
  const savedGraphState = useMemo(() => readSavedGraphState(projectId), [projectId])
  const [selection, setSelection] = useState<GraphSelection | null>(savedGraphState?.selection ?? null)
  const [filter, setFilter] = useState<Filter>(savedGraphState?.filter ?? 'all')
  const [savedViewport, setSavedViewport] = useState<{ x: number; y: number; zoom: number } | null>(savedGraphState?.viewport ?? null)
  const [pageActive, setPageActive] = useState(true)
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null)
  const [decisionNote, setDecisionNote] = useState('')
  const [riskAccepted, setRiskAccepted] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const [requestedContext,setRequestedContext] = useState<{agentId:string;sessionId:string|null}|null>(null)
  const [decisionError, setDecisionError] = useState<string | null>(null)

  useEffect(() => {
    try {
      sessionStorage.setItem('aco:graph:' + projectId, JSON.stringify({ selection, filter, viewport: savedViewport }))
    } catch {
      // Session storage is a convenience only; graph state is never the source of truth.
    }
  }, [filter, projectId, savedViewport, selection])

  useEffect(() => {
    const unsubscribe = window.projectos.runtime.onEvent(({ event }) => {
      if (event.type === 'runtime.log' || event.type === 'run.delta') return
      void queryClient.invalidateQueries({ queryKey: qk.collaborationOverview(projectId) })
      void queryClient.invalidateQueries({ queryKey: qk.projectRequirementFlows(projectId) })
      void queryClient.invalidateQueries({ queryKey: ['requirement-flow'] })
      void queryClient.invalidateQueries({ queryKey: ['requirement-work'] })
      void queryClient.invalidateQueries({ queryKey: ['flow-assignment-preview'] })
    })
    return unsubscribe
  }, [projectId, queryClient])

  useEffect(() => {
    const update = (): void => setPageActive(document.visibilityState === 'visible' && document.hasFocus())
    update()
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    return () => {
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
    }
  }, [])

  const data = overview.data
  const agents = useMemo(() => data?.agents ?? [], [data])
  const tasks = useMemo(() => data?.tasks ?? [], [data])
  const runs = useMemo(() => data?.runs ?? [], [data])
  const artifacts = useMemo(() => data?.artifacts ?? [], [data])
  const approvals = useMemo(() => data?.approvals ?? [], [data])
  const handoffs = useMemo(() => data?.handoffs ?? [], [data])
  const pendingApprovals = useMemo(() => approvals.filter((approval) => approval.status === 'pending'), [approvals])
  const plan = data?.plan ?? null

  const requirementFlows = useMemo(() => reqFlowsQuery.data ?? [], [reqFlowsQuery.data])
  const taskFlows = useMemo(() => requirementFlows.flatMap((entry) => entry.view.tasks), [requirementFlows])
  const materials = useMemo(() => requirementFlows.flatMap((entry) => entry.view.materials), [requirementFlows])
  const requirementTitles = useMemo(
    () => Object.fromEntries(requirementFlows.map((entry) => [entry.requirement.id, entry.requirement.title])),
    [requirementFlows],
  )
  const allSteps = useMemo(() => taskFlows.flatMap((flow) => flow.steps), [taskFlows])
  const stepById = useMemo(() => new Map(allSteps.map((step) => [step.id, step])), [allSteps])
  const materialByArtifactId = useMemo(() => new Map(materials.map((m) => [m.artifactId, m])), [materials])

  useEffect(()=>{
    if(requestedTaskId&&data?.tasks.some((task)=>task.id===requestedTaskId)){
      setSelection({kind:'task',id:requestedTaskId})
      onContextRequestHandled()
      return
    }
    if(!requestedAgentId||!data?.agents.some((agent)=>agent.id===requestedAgentId))return
    setSelection({kind:'agent',id:requestedAgentId})
    setRequestedContext({agentId:requestedAgentId,sessionId:requestedSessionId??null})
    onContextRequestHandled()
  },[requestedAgentId,requestedSessionId,requestedTaskId,data?.agents,data?.tasks,onContextRequestHandled])
  const metrics = data?.metrics ?? null
  const focus = useMemo(
    () => projectCollaborationFocus({ agents, tasks, artifacts, approvals, handoffs, plan, runs, taskFlows }),
    [agents, approvals, artifacts, handoffs, plan, runs, taskFlows, tasks],
  )
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])

  const latestRun = useMemo(
    () => [...runs].sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt))[0] ?? null,
    [runs],
  )
  const latestActivity = data?.activity[0] ?? null
  const activityStatus = ((): { label: string; tone: 'accent' | 'warn' | 'danger' | 'neutral' } => {
    if (pendingApprovals.length > 0) return { label: '等待审批', tone: 'warn' }
    if (latestRun && ACTIVE_RUN_STATUSES.includes(latestRun.status)) return { label: '运行中', tone: 'accent' }
    if (latestRun && (latestRun.status === 'failed' || latestRun.status === 'timed_out' || latestRun.status === 'needs_reconciliation')) {
      return { label: '执行阻断', tone: 'danger' }
    }
    if (tasks.some((task) => task.status === 'blocked')) return { label: '执行阻断', tone: 'danger' }
    return { label: '无须操作', tone: 'neutral' }
  })()

  const selectedAgent = selection?.kind === 'agent' ? agentById.get(selection.id) ?? null : null
  const selectedTask = selection?.kind === 'task' ? taskById.get(selection.id) ?? null : null
  const selectedStage = selection?.kind === 'stage' ? stepById.get(selection.id) ?? null : null
  const selectedArtifact = selection?.kind === 'artifact' ? artifacts.find((item) => item.id === selection.id) ?? null : null
  const selectedApproval = selection?.kind === 'approval' ? approvals.find((item) => item.id === selection.id) ?? null : null
  const selectedHandoff = selection?.kind === 'handoff' ? handoffs.find((item) => item.id === selection.id) ?? null : null
  const approvalForSelection = selectedApproval
    ?? (selectedStage ? pendingApprovals.find((approval) => approval.runId === selectedStage.runId || approval.taskId === selectedStage.taskId) ?? null : null)
    ?? (selectedTask ? pendingApprovals.find((approval) => approval.taskId === selectedTask.id) ?? null : null)
    ?? (selectedAgent ? pendingApprovals.find((approval) => approval.runId === selectedAgent.activeRunId || approval.agentName === selectedAgent.name) ?? null : null)

  useEffect(() => {
    setDecision(null)
    setDecisionNote('')
    setRiskAccepted(false)
    setDecisionError(null)
  }, [selection?.id])

  const decideApproval = async (value: 'approved' | 'rejected'): Promise<void> => {
    if (!approvalForSelection || deciding) return
    if (value === 'approved' && !riskAccepted) {
      setDecisionError('请先确认本次授权的实际范围。')
      return
    }
    setDeciding(true)
    setDecisionError(null)
    try {
      await window.projectos.approvals.decide({
        approvalId: approvalForSelection.id,
        decision: value,
        note: decisionNote.trim(),
      })
      await queryClient.invalidateQueries({ queryKey: qk.collaborationOverview(projectId) })
      await queryClient.invalidateQueries({ queryKey: qk.approvals(projectId) })
      setDecision(null)
      setSelection((current) => current?.kind === 'approval' && current.id === approvalForSelection.id ? null : current)
    } catch (error) {
      setDecisionError(errorMessage(error))
    } finally {
      setDeciding(false)
    }
  }

  const openRun = (runId: string): void => {
    void navigate(`/projects/${projectId}/runs?run=${runId}`)
  }
  const openTaskRoute = (): void => {
    void navigate(`/projects/${projectId}/tasks`)
  }
  const openApprovals = (): void => {
    void navigate(`/projects/${projectId}/approvals?return=agents`)
  }
  const openOrchestration = (): void => {
    void navigate('/projects/' + projectId + '/orchestration?return=agents')
  }

  const changeFilter = (next: Filter): void => {
    setFilter(next)
    if (!selection) return
    if (next === 'agents' && selection.kind !== 'agent') setSelection(null)
    if (next === 'tasks' && selection.kind !== 'task' && selection.kind !== 'stage') setSelection(null)
    if (next === 'outputs' && selection.kind !== 'artifact' && selection.kind !== 'approval') setSelection(null)
  }

  const counts = {
    all: agents.length + tasks.length + allSteps.length + artifacts.length + pendingApprovals.length,
    agents: agents.length,
    tasks: tasks.length + (allSteps.length > 0 ? allSteps.length : 0),
    outputs: artifacts.length + pendingApprovals.length,
  }

  if (overview.isLoading) {
    return (
      <div className="aco-root pw-theme aco-deck" data-theme={theme}>
        <div className="aco-loading">
          <div className="aco-loading-head" />
          <div className="aco-loading-canvas" />
        </div>
      </div>
    )
  }

  if (overview.isError || !data || !metrics) {
    return (
      <div className="aco-root pw-theme aco-deck" data-theme={theme}>
        <div className="aco-state">
          <CircleAlert size={20} />
          <strong>Agent 协作数据读取失败</strong>
          <p>{overview.isError ? errorMessage(overview.error) : '暂时没有收到投影数据。'}</p>
          <button type="button" className="aco-btn is-primary" onClick={() => void overview.refetch()}>
            <RefreshCw size={13} /> 重试
          </button>
        </div>
      </div>
    )
  }

  const inspectorTitle = selectedAgent
    ? selectedAgent.name
    : selectedTask
      ? selectedTask.title
      : selectedStage
        ? selectedStage.title
        : selectedArtifact
          ? selectedArtifact.title
          : selectedApproval
            ? selectedApproval.title
            : selectedHandoff
              ? `${selectedHandoff.fromAgentName} → ${selectedHandoff.toAgentName}`
              : ''
  const inspectorEyebrow = selectedAgent
    ? 'AGENT'
    : selectedTask
      ? 'TASK'
      : selectedStage
        ? `STAGE · ${REQUIREMENT_STAGES[selectedStage.stage]?.label ?? selectedStage.stage}`
        : selectedArtifact
          ? `ARTIFACT · ${ARTIFACT_LABELS[selectedArtifact.kind] ?? selectedArtifact.kind}`
          : selectedApproval
            ? 'APPROVAL'
            : selectedHandoff
              ? 'HANDOFF'
              : ''

  const inspectorBody: ReactNode = (() => {
    if (selectedAgent) {
      const status = agentStatus(selectedAgent)
      const agentSteps = allSteps.filter((step) => step.agentId === selectedAgent.id)
      return (
        <>
          <div className="aco-inspector-hero">
            <AgentAvatar name={selectedAgent.name} role={selectedAgent.role} size={56} status={selectedAgent.status === "working" ? "working" : "idle"} taskTitle={selectedAgent.taskTitle ?? undefined} />
            <div>
              <strong>{selectedAgent.role}</strong>
              <span>{selectedAgent.taskTitle ?? '暂无进行中的任务'}</span>
            </div>
            <span className={`aco-pill is-${status.tone}`}><i />{status.label}</span>
          </div>
          <dl className="aco-detail-list">
            <div><dt>当前任务</dt><dd>{selectedAgent.taskTitle ?? '暂无进行中的任务'}</dd></div>
            <div><dt>任务状态</dt><dd>{selectedAgent.taskStatus ? taskStatusLabel(selectedAgent.taskStatus) : '—'}</dd></div>
            {agentSteps.length > 0 ? (
              <div>
                <dt>需求负责阶段</dt>
                <dd>{agentSteps.map((s) => `${s.title}（${s.status === 'completed' ? '已完成' : s.status === 'running' || s.status === 'starting' ? '执行中' : s.status === 'waiting_approval' ? '待审批' : '待流转'}）`).join('、')}</dd>
              </div>
            ) : null}
            <div><dt>活动 Run</dt><dd className="aco-mono">{selectedAgent.activeRunId ?? '—'}</dd></div>
            <div><dt>Run 状态</dt><dd>{selectedAgent.runStatus ? runStatusLabel(selectedAgent.runStatus) : '—'}</dd></div>
            <div><dt>待审批</dt><dd>{selectedAgent.pendingApprovals} 项</dd></div>
            <div><dt>会话 / 已完成 Run</dt><dd>{selectedAgent.sessionCount} / {selectedAgent.completedRuns}</dd></div>
            <div><dt>最近活动</dt><dd>{selectedAgent.lastActivityAt ? formatDateTime(selectedAgent.lastActivityAt) : '未运行'}</dd></div>
          </dl>
          {selectedAgent.pendingApprovals > 0 ? (
            <div className="aco-callout is-warn"><ShieldAlert size={13} /> 该 Agent 正在等待人工审批；Run 已暂停，不会继续写入。</div>
          ) : null}
          <AgentWorkflowMaterials key={selectedAgent.id} projectId={projectId} agentId={selectedAgent.id} />
          <AgentContextActions key={selectedAgent.id} projectId={projectId} agent={selectedAgent}
            preferredSessionId={requestedContext?.agentId===selectedAgent.id?requestedContext.sessionId:null}
            onClose={()=>setSelection(null)} />
        </>
      )
    }
    if (selectedTask) {
      const run = runs.find((item) => item.taskId === selectedTask.id) ?? null
      const taskFlow = taskFlows.find((item) => item.taskId === selectedTask.id) ?? null
      const reqTitle = selectedTask.requirementId ? requirementTitles[selectedTask.requirementId] ?? null : null
      return (
        <>
          <div className="aco-inspector-hero">
            {selectedTask.assigneeName ? (
              <AgentAvatar name={selectedTask.assigneeName} size={52} status={selectedTask.status === "running" ? "working" : "idle"} taskTitle={selectedTask.title} taskDescription={selectedTask.description} taskLabels={selectedTask.labels} />
            ) : (
              <span className="aco-avatar is-large">?</span>
            )}
            <div>
              <strong>{selectedTask.assigneeName ? `负责人 · ${selectedTask.assigneeName}` : "暂未指派 Agent"}</strong>
              <span>{run ? `最近运行 · ${runStatusLabel(run.status)}` : "尚未启动执行 Run"}</span>
            </div>
            <span className={`aco-pill is-${selectedTask.status === "blocked" ? "warn" : selectedTask.status === "running" ? "accent" : "neutral"}`}><i />{taskStatusLabel(selectedTask.status)}</span>
          </div>
          <dl className="aco-detail-list">
            {reqTitle ? <div><dt>所属需求</dt><dd>{reqTitle}</dd></div> : null}
            <div><dt>任务状态</dt><dd>{taskStatusLabel(selectedTask.status)}</dd></div>
            <div><dt>负责人</dt><dd>{selectedTask.assigneeName ?? '未分配'}</dd></div>
            <div><dt>前置依赖</dt><dd>{selectedTask.dependencyIds.length} 项</dd></div>
            <div><dt>当前受阻</dt><dd>{selectedTask.blockedBy.length ? selectedTask.blockedBy.map((id) => taskById.get(id)?.title ?? id).join('、') : '无'}</dd></div>
            <div><dt>最近 Run</dt><dd className="aco-mono">{run?.id ?? '—'}</dd></div>
            <div><dt>Run 状态</dt><dd>{run ? runStatusLabel(run.status) : '未启动'}</dd></div>
            <div><dt>产物 / 审批</dt><dd>{selectedTask.artifactCount} / {run?.pendingApprovals ?? 0}</dd></div>
          </dl>
          {taskFlow && taskFlow.steps.length > 0 ? (
            <div className="aco-detail-section">
              <span>需求流程各阶段执行情况 ({taskFlow.steps.filter((s) => s.status === 'completed').length}/{taskFlow.steps.length})</span>
              <ul>
                {taskFlow.steps.map((step, idx) => (
                  <li key={step.id}>
                    <strong>{idx + 1}. {step.title}</strong> · {step.agentName ?? '待分配'} · {step.status === 'completed' ? '✓ 已完成' : step.status === 'running' || step.status === 'starting' ? '● 执行中' : step.status === 'waiting_approval' ? '⏳ 等待审批' : '○ 待流转'}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {selectedTask.acceptanceCriteria.length > 0 ? (
            <div className="aco-detail-section">
              <span>验收标准</span>
              <ul>{selectedTask.acceptanceCriteria.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null}
        </>
      )
    }
    if (selectedStage) {
      const parentTask = taskById.get(selectedStage.taskId) ?? null
      const parentFlow = taskFlows.find((f) => f.taskId === selectedStage.taskId) ?? null
      const reqId = parentFlow?.requirementId ?? parentTask?.requirementId ?? ''
      const reqTitle = reqId ? requirementTitles[reqId] ?? '当前需求' : '当前需求'
      const stageAgent = selectedStage.agentId ? agentById.get(selectedStage.agentId) ?? null : null
      const stageMaterials = materials.filter(
        (m) => m.stepId === selectedStage.id || selectedStage.artifactIds.includes(m.artifactId),
      )
      const isWorking = selectedStage.status === 'running' || selectedStage.status === 'starting'
      const stageTone = selectedStage.status === 'completed' ? 'ok' : isWorking ? 'accent' : selectedStage.status === 'waiting_approval' ? 'warn' : 'neutral'
      const stageLabel = selectedStage.status === 'completed' ? '已完成' : isWorking ? '执行中' : selectedStage.status === 'waiting_approval' ? '等待审批' : '待流转'
      return (
        <>
          <div className="aco-inspector-hero">
            {selectedStage.agentName ? (
              <AgentAvatar
                name={selectedStage.agentName}
                role={stageAgent?.role}
                size={52}
                status={isWorking ? 'working' : 'idle'}
                taskTitle={selectedStage.title}
              />
            ) : (
              <span className="aco-avatar is-large">?</span>
            )}
            <div>
              <strong>{selectedStage.agentName ? `${selectedStage.agentName} · ${stageAgent?.role ?? '负责 Agent'}` : '暂未指派 Agent'}</strong>
              <span>{parentTask?.title ?? selectedStage.taskId}</span>
            </div>
            <span className={`aco-pill is-${stageTone}`}><i />{stageLabel}</span>
          </div>
          <dl className="aco-detail-list">
            <div><dt>所属需求</dt><dd>{reqTitle}</dd></div>
            <div><dt>关联任务</dt><dd>{parentTask?.title ?? selectedStage.taskId}</dd></div>
            <div><dt>流程阶段</dt><dd>{selectedStage.title}（{REQUIREMENT_STAGES[selectedStage.stage]?.label ?? selectedStage.stage}）</dd></div>
            <div>
              <dt>负责 Agent</dt>
              <dd>
                {['pending', 'ready'].includes(selectedStage.status) ? (
                  <select
                    aria-label={`${selectedStage.title}负责 Agent`}
                    value={selectedStage.agentId ?? ''}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: '1px solid rgba(148,163,184,0.35)',
                      background: 'rgba(255,255,255,0.85)',
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: '#0f172a',
                    }}
                    onChange={(e) => {
                      const nextAgentId = e.target.value
                      if (!nextAgentId) return
                      void window.projectos.workflows
                        .assign({ stepId: selectedStage.id, expectedVersion: selectedStage.version, agentId: nextAgentId })
                        .then(() =>
                          Promise.all([
                            queryClient.invalidateQueries({ queryKey: qk.collaborationOverview(projectId) }),
                            queryClient.invalidateQueries({ queryKey: qk.projectRequirementFlows(projectId) }),
                            queryClient.invalidateQueries({ queryKey: ['requirement-flow'] }),
                            queryClient.invalidateQueries({ queryKey: ['requirement-work'] }),
                            queryClient.invalidateQueries({ queryKey: ['flow-assignment-preview'] }),
                            queryClient.invalidateQueries({ queryKey: qk.board(projectId) }),
                          ]),
                        )
                    }}
                  >
                    {!selectedStage.agentId && <option value="">选择负责 Agent</option>}
                    {agents.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.role}
                      </option>
                    ))}
                  </select>
                ) : (
                  selectedStage.agentName ?? '待分配'
                )}
              </dd>
            </div>
            <div><dt>执行 Run</dt><dd className="aco-mono">{selectedStage.runId ?? '尚未启动'}</dd></div>
            <div><dt>阶段产出</dt><dd>{Math.max(selectedStage.artifactIds.length, stageMaterials.length)} 份文档/结论</dd></div>
          </dl>
          <RequirementMaterials
            projectId={projectId}
            requirementId={reqId || undefined}
            requirementTitle={reqTitle}
            materials={stageMaterials}
            tasks={parentTask ? [{ id: parentTask.id, title: parentTask.title }] : []}
            taskFlows={parentFlow ? [parentFlow] : []}
            stageNode={{ id: selectedStage.nodeId, title: selectedStage.title, stage: selectedStage.stage }}
            initialTaskId={selectedStage.taskId}
          />
        </>
      )
    }
    if (selectedArtifact) {
      const mat = materialByArtifactId.get(selectedArtifact.id) ?? null
      const producingRun = selectedArtifact.runId ? runs.find((r) => r.id === selectedArtifact.runId) ?? null : null
      return (
        <>
          <dl className="aco-detail-list">
            <div><dt>类型</dt><dd>{ARTIFACT_LABELS[selectedArtifact.kind] ?? selectedArtifact.kind}</dd></div>
            {mat?.requirementTitle ? <div><dt>所属需求</dt><dd>{mat.requirementTitle}</dd></div> : null}
            {mat?.stepTitle ? <div><dt>产出阶段</dt><dd>{mat.stepTitle}</dd></div> : null}
            {(mat?.agentName || producingRun?.agentName) ? <div><dt>产出 Agent</dt><dd>{mat?.agentName ?? producingRun?.agentName}</dd></div> : null}
            <div><dt>关联任务</dt><dd>{selectedArtifact.taskId ? taskById.get(selectedArtifact.taskId)?.title ?? selectedArtifact.taskId : '未关联'}</dd></div>
            <div><dt>Run</dt><dd className="aco-mono">{selectedArtifact.runId ?? '—'}</dd></div>
            <div><dt>内容 hash</dt><dd className="aco-mono">{selectedArtifact.contentHash ?? '—'}</dd></div>
            <div><dt>Git commit</dt><dd className="aco-mono">{selectedArtifact.gitCommit ?? '—'}</dd></div>
            <div><dt>创建时间</dt><dd>{formatDateTime(selectedArtifact.createdAt)}</dd></div>
            <div><dt>核验 / 审核</dt><dd>{mat?.reviewVerdict === 'approved' ? '审核已通过' : selectedArtifact.verifiedAt ? formatDateTime(selectedArtifact.verifiedAt) : '未核验'}</dd></div>
          </dl>
          {selectedArtifact.uri ? (
            <div className="aco-detail-section">
              <span>URI</span>
              <code className="aco-detail-code">{selectedArtifact.uri}</code>
            </div>
          ) : null}
          <div className="aco-detail-section">
            <span>内容快照</span>
            <pre className="aco-detail-pre">{selectedArtifact.body?.slice(0, 5000) ?? '该产物只记录引用与元数据，没有内联内容。'}</pre>
          </div>
        </>
      )
    }
    if (selectedApproval) {
      return (
        <>
          <dl className="aco-detail-list">
            <div><dt>状态</dt><dd>{selectedApproval.status === 'pending' ? '等待处理' : selectedApproval.status}</dd></div>
            <div><dt>请求方</dt><dd>{selectedApproval.agentName}</dd></div>
            <div><dt>任务</dt><dd>{selectedApproval.taskTitle ?? '—'}</dd></div>
            <div><dt>Run</dt><dd className="aco-mono">{selectedApproval.runId}</dd></div>
            <div><dt>请求时间</dt><dd>{formatDateTime(selectedApproval.requestedAt)}</dd></div>
            {selectedApproval.expiresAt ? <div><dt>过期时间</dt><dd>{formatDateTime(selectedApproval.expiresAt)}</dd></div> : null}
          </dl>
          <div className="aco-detail-section">
            <span>审批说明</span>
            <p>{selectedApproval.detail || '没有附加说明。'}</p>
          </div>
          <div className="aco-detail-section">
            <span>请求参数（持久化）</span>
            <pre className="aco-detail-pre" data-testid="approval-request">{JSON.stringify(selectedApproval.request, null, 2).slice(0, 4000)}</pre>
          </div>
        </>
      )
    }
    if (selectedHandoff) {
      return (
        <>
          <dl className="aco-detail-list">
            <div><dt>状态</dt><dd>{handoffStatusLabel(selectedHandoff.status)}</dd></div>
            <div><dt>From</dt><dd>{selectedHandoff.fromAgentName}</dd></div>
            <div><dt>To</dt><dd>{selectedHandoff.toAgentName}</dd></div>
            <div><dt>任务</dt><dd>{selectedHandoff.taskTitle}</dd></div>
            <div><dt>请求时间</dt><dd>{formatDateTime(selectedHandoff.requestedAt)}</dd></div>
            {selectedHandoff.expiresAt ? <div><dt>过期时间</dt><dd>{formatDateTime(selectedHandoff.expiresAt)}</dd></div> : null}
          </dl>
          <div className="aco-detail-section">
            <span>交接摘要</span>
            <p>{selectedHandoff.summary}</p>
          </div>
          {selectedHandoff.completed.length > 0 ? (
            <div className="aco-detail-section"><span>已完成</span><ul>{selectedHandoff.completed.map((item) => <li key={item}>{item}</li>)}</ul></div>
          ) : null}
          {selectedHandoff.remaining.length > 0 ? (
            <div className="aco-detail-section"><span>待处理</span><ul>{selectedHandoff.remaining.map((item) => <li key={item}>{item}</li>)}</ul></div>
          ) : null}
        </>
      )
    }
    return null
  })()

  const approvalPanel = approvalForSelection ? (
    <div className="aco-approval-block" data-testid="node-approval">
      <div className="aco-approval-head">
        <span className="aco-pill is-warn"><i />待审批</span>
        <strong>{approvalForSelection.title}</strong>
      </div>
      <dl className="aco-detail-list">
        <div><dt>请求方</dt><dd>{approvalForSelection.agentName}</dd></div>
        <div><dt>任务</dt><dd>{approvalForSelection.taskTitle ?? '—'}</dd></div>
        <div><dt>Run</dt><dd className="aco-mono">{approvalForSelection.runId}</dd></div>
        <div><dt>请求时间</dt><dd>{formatDateTime(approvalForSelection.requestedAt)}</dd></div>
        <div><dt>过期时间</dt><dd>{approvalForSelection.expiresAt ? formatDateTime(approvalForSelection.expiresAt) : '未设置'}</dd></div>
      </dl>
      {approvalForSelection.detail ? <p className="aco-approval-detail">{approvalForSelection.detail}</p> : null}
      <div className="aco-detail-section">
        <span>实际请求参数（持久化）</span>
        <pre className="aco-detail-pre" data-testid="approval-request">{JSON.stringify(approvalForSelection.request, null, 2).slice(0, 6000)}</pre>
      </div>
    </div>
  ) : null

  const decisionPanel = decision ? (
    <div className="aco-decision aco-decision-docked" data-testid="approval-confirm">
      <strong>{decision === 'approved' ? '确认允许本次执行？' : '确认拒绝本次执行？'}</strong>
      <p>{decision === 'approved' ? '服务端仍会校验权限、过期时间和审批状态；批准只对本次请求生效。' : '拒绝会写入审批事实；Run 不会继续执行此工具。'}</p>
      <textarea
        value={decisionNote}
        onChange={(event) => setDecisionNote(event.target.value)}
        placeholder="处理备注（会写入审计）"
        maxLength={2000}
        rows={2}
      />
      {decision === 'approved' ? (
        <label className="aco-risk-check">
          <input type="checkbox" checked={riskAccepted} onChange={(event) => setRiskAccepted(event.target.checked)} />
          我已核对工具、参数、路径与影响范围，并确认只允许本次
        </label>
      ) : null}
      {decisionError ? <p className="aco-decision-error" role="alert">{decisionError}</p> : null}
      <div className="aco-decision-actions">
        <button type="button" className="aco-btn is-primary" disabled={deciding || (decision === 'approved' && !riskAccepted)} onClick={() => void decideApproval(decision)}>
          {deciding ? '提交中…' : decision === 'approved' ? '确认允许本次' : '确认拒绝'}
        </button>
        <button type="button" className="aco-btn" disabled={deciding} onClick={() => { setDecision(null); setDecisionError(null) }}>取消</button>
      </div>
    </div>
  ) : null

  return (
    <Tabs value={filter} onValueChange={(value) => changeFilter(value as Filter)} className="aco-root pw-theme aco-deck aco-workbench" data-theme={theme}>
      <header className="aco-head">
        <h1 className="aco-workbench-title">Agent 协作</h1>
        <TabsList aria-label="筛选图中的真实对象" className="aco-object-tabs">
          {([
            ['all', '全部', counts.all],
            ['agents', 'Agent', counts.agents],
            ['tasks', '任务', counts.tasks],
            ['outputs', '成果与审批', counts.outputs],
          ] as const).map(([value, label, count]) => (
            <TabsTrigger key={value} value={value}>
              {label}<span className="aco-tab-count">{count}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="aco-head-actions">
          <button type="button" className="aco-btn" onClick={openOrchestration} title={plan?.goal ?? '打开计划'}><Workflow size={14} />计划与授权</button>
          <button type="button" className="aco-btn" onClick={onManageAgents}><Bot size={14} />Agent 管理</button>
          <button type="button" className="aco-icon-btn" aria-label="刷新协作数据" onClick={() => void overview.refetch()} disabled={overview.isFetching}>
            <RefreshCw size={14} className={overview.isFetching ? 'is-spinning' : undefined} />
          </button>
        </div>
      </header>

      {requirementFlows.length > 0 ? (
        <section className="aco-req-flow-bar" aria-label="需求整体流转总览" data-testid="collaboration-requirement-flow-bar">
          {requirementFlows.map(({ requirement, view }) => {
            const firstFlow = view.tasks[0]
            const steps = firstFlow?.steps ?? []
            const completedCount = steps.filter((s) => s.status === 'completed').length
            const uniqueAgents = new Set(steps.map((s) => s.agentId).filter(Boolean)).size
            return (
              <div key={requirement.id} className="aco-req-flow-item">
                <div className="aco-req-flow-meta">
                  <span className="aco-req-flow-kicker"><Layers size={11} /> 需求整体流转</span>
                  <strong className="aco-req-flow-title" title={requirement.title}>{requirement.title}</strong>
                  <span className="aco-req-flow-counts">
                    {view.tasks.length} 任务 · {completedCount}/{steps.length} 阶段完成 · {uniqueAgents} 位 Agent · {view.materials.length} 份产出
                  </span>
                </div>
                {steps.length > 0 ? (
                  <div className="aco-req-stage-chain" role="list">
                    {steps.map((step, idx) => {
                      const isDone = step.status === 'completed'
                      const isRunning = step.status === 'running' || step.status === 'starting'
                      const isWaiting = step.status === 'waiting_approval'
                      const stepMats = view.materials.filter((m) => m.stepId === step.id || step.artifactIds.includes(m.artifactId))
                      const isSelected = selection?.kind === 'stage' && selection.id === step.id
                      return (
                        <button
                          key={step.id}
                          type="button"
                          role="listitem"
                          className={`aco-req-stage-pill is-${step.status}${isSelected ? ' is-selected' : ''}`}
                          onClick={() => setSelection({ kind: 'stage', id: step.id })}
                          title={`点击查看阶段详情：${step.title} · 负责 Agent: ${step.agentName ?? '未分配'} · 产出: ${stepMats.map((m) => m.title).join('、') || '暂无'}`}
                        >
                          <span className="aco-req-stage-idx">
                            {isDone ? <Check size={10} /> : idx + 1}
                          </span>
                          <span className="aco-req-stage-name">{step.title}</span>
                          {step.agentName ? (
                            <span className="aco-req-stage-agent">· {step.agentName}</span>
                          ) : null}
                          {stepMats.length > 0 ? (
                            <span className="aco-req-stage-out">{stepMats.length}产出</span>
                          ) : isRunning ? (
                            <span className="aco-req-stage-out is-live">执行中</span>
                          ) : isWaiting ? (
                            <span className="aco-req-stage-out is-warn">待审批</span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
        </section>
      ) : null}

      <TabsContent value={filter} className="aco-canvas-wrap">
        <CollaborationGraph
          agents={focus.primaryAgents}
          standbyAgents={focus.standbyAgents}
          tasks={focus.primaryTasks}
          runs={runs}
          artifacts={focus.primaryArtifacts}
          approvals={focus.primaryApprovals}
          handoffs={focus.primaryHandoffs}
          planTaskIds={plan?.taskIds ?? []}
          taskFlows={taskFlows}
          materials={materials}
          requirementTitles={requirementTitles}
          selected={selection}
          onSelect={setSelection}
          initialViewport={savedViewport}
          onViewportChange={setSavedViewport}
          showAgents={filter === 'all' || filter === 'agents'}
          showTasks={filter === 'all' || filter === 'tasks'}
          showOutputs={filter === 'all' || filter === 'outputs'}
        />
      </TabsContent>

      <footer className={`aco-activity is-${activityStatus.tone}`} aria-label="实时活动">
        <span className="aco-activity-label" title={`${metrics.workingAgents} 工作中 · ${metrics.pendingApprovals} 待审批 · ${metrics.blockedTasks} 依赖等待 · ${metrics.artifacts} 产物 · ${metrics.pendingHandoffs} 交接`}>
          <i className={`aco-live-dot${pageActive ? ' is-on' : ''}`} />
          {metrics.workingAgents > 0 ? `${metrics.workingAgents} 工作中` : '实时活动'}
        </span>
        <div className="aco-activity-main">
          {latestActivity ? (
            <>
              <strong>{latestActivity.actorName ?? '系统'}</strong>
              <span>{latestActivity.summary}</span>
              <time className="aco-mono">{formatRelative(latestActivity.createdAt)}</time>
            </>
          ) : (
            <span>暂无运行活动</span>
          )}
        </div>
        <span className={`aco-pill is-${activityStatus.tone}`}>{activityStatus.label}</span>
        <button
          type="button"
          className="aco-btn"
          onClick={() => {
            if (pendingApprovals.length > 0) {
              openApprovals()
              return
            }
            if (latestRun) openRun(latestRun.id)
            else void navigate(`/projects/${projectId}/runs`)
          }}
        >
          {pendingApprovals.length > 0 ? '处理审批' : latestRun ? '打开运行' : '运行中心'} <ArrowRight size={12} />
        </button>
        <span className="aco-activity-time"><Clock size={11} /> {formatRelative(data.generatedAt)}</span>
      </footer>

      <InspectorShell
        open={Boolean(selection)}
        onOpenChange={(open) => { if (!open) setSelection(null) }}
        ariaLabel="协作对象详情"
        width={480}
        skin="projectos"
        testId="collaboration-inspector"
      >
        <OverlayHeader
          eyebrow={inspectorEyebrow}
          title={inspectorTitle}
          meta={selectedTask ? <span>{taskStatusLabel(selectedTask.status)} · {selectedTask.assigneeName ?? '未分配'}</span> : selectedAgent ? <span>{selectedAgent.role}</span> : null}
          onClose={() => setSelection(null)}
        />
        <OverlayScrollArea>{inspectorBody}{selectedApproval ? null : approvalPanel}</OverlayScrollArea>
        {decisionPanel}
        <OverlayFooter meta={approvalForSelection?.status === 'pending' ? '需要人工决定 · 服务端校验' : '真实持久化对象'}>
          {approvalForSelection?.status === 'pending' && !decision ? (
            <>
              <button type="button" className="aco-btn is-primary" onClick={() => setDecision('approved')}>允许本次</button>
              <button type="button" className="aco-btn" onClick={() => setDecision('rejected')}>拒绝</button>
              <button type="button" className="aco-btn" onClick={() => { openApprovals(); setSelection(null) }}>审批中心</button>
            </>
          ) : null}
          {selectedAgent ? (
            <>
              {selectedAgent.activeRunId ? (
                <button type="button" className="aco-btn" onClick={() => openRun(selectedAgent.activeRunId!)}>运行审计</button>
              ) : null}
            </>
          ) : null}
          {selectedTask ? (
            <>
              <button type="button" className="aco-btn is-primary" onClick={() => { openTaskRoute(); setSelection(null) }}>任务看板 <ArrowRight size={12} /></button>
              {runs.find((item) => item.taskId === selectedTask.id) ? (
                <button type="button" className="aco-btn" onClick={() => openRun(runs.find((item) => item.taskId === selectedTask.id)!.id)}>运行审计</button>
              ) : null}
            </>
          ) : null}
          {selectedArtifact ? (
            <>
              {selectedArtifact.runId ? <button type="button" className="aco-btn is-primary" onClick={() => openRun(selectedArtifact.runId!)}>运行审计 <ArrowRight size={12} /></button> : null}
              {selectedArtifact.taskId ? <button type="button" className="aco-btn" onClick={() => { openTaskRoute(); setSelection(null) }}>任务看板</button> : null}
            </>
          ) : null}
          {selectedApproval ? (
            <button type="button" className="aco-btn" onClick={() => openRun(selectedApproval.runId)}>运行审计</button>
          ) : null}
          {selectedHandoff ? (
            <>
              {selectedHandoff.sourceRunId ? <button type="button" className="aco-btn is-primary" onClick={() => openRun(selectedHandoff.sourceRunId!)}>来源运行 <ArrowRight size={12} /></button> : null}
              {selectedHandoff.targetRunId ? <button type="button" className="aco-btn" onClick={() => openRun(selectedHandoff.targetRunId!)}>目标运行</button> : null}
              <button type="button" className="aco-btn" onClick={() => { openTaskRoute(); setSelection(null) }}>任务看板</button>
            </>
          ) : null}
          <button type="button" className="aco-btn" onClick={() => setSelection(null)}>关闭</button>
        </OverlayFooter>
      </InspectorShell>

      <AnimatePresence>
        {overview.isFetching ? (
          <motion.span
            className="aco-refreshing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="status"
            aria-live="polite"
          >
            正在读取持久化状态…
          </motion.span>
        ) : null}
      </AnimatePresence>
    </Tabs>
  )
}
