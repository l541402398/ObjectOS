import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowRight,
  Bot,
  CircleAlert,
  Clock,
  RefreshCw,
  ShieldAlert,
  Workflow,
} from 'lucide-react'
import type {
  CollaborationOverviewAgent,
  HandoffView,
  RunStatus,
} from '@projectos/contracts'
import { useResolvedTheme } from '../../stores/ui'
import { errorMessage } from '../../lib/errors'
import { formatDateTime, formatRelative } from '../../lib/format'
import { runStatusLabel, taskStatusLabel } from '../../lib/labels'
import { qk, useCollaborationOverview } from '../../lib/queries'
import { OverlayFooter, OverlayHeader, OverlayScrollArea, InspectorShell } from '../../next-ui/overlay/overlay-shell'
import { CollaborationGraph, type GraphSelection } from './CollaborationGraph'
import { projectCollaborationFocus } from './focus-projection'
import { AgentContextActions } from './AgentContextActions'
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
  onContextRequestHandled,
}: {
  projectId: string
  onManageAgents: () => void
  requestedAgentId?: string | null
  requestedSessionId?: string | null
  onContextRequestHandled: () => void
}): ReactElement {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const theme = useResolvedTheme()
  const overview = useCollaborationOverview(projectId)
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
  useEffect(()=>{
    if(!requestedAgentId||!data?.agents.some((agent)=>agent.id===requestedAgentId))return
    setSelection({kind:'agent',id:requestedAgentId})
    setRequestedContext({agentId:requestedAgentId,sessionId:requestedSessionId??null})
    onContextRequestHandled()
  },[requestedAgentId,requestedSessionId,data?.agents,onContextRequestHandled])
  const metrics = data?.metrics ?? null
  const focus = useMemo(
    () => projectCollaborationFocus({ agents, tasks, artifacts, approvals, handoffs, plan }),
    [agents, approvals, artifacts, handoffs, plan, tasks],
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
  const selectedArtifact = selection?.kind === 'artifact' ? artifacts.find((item) => item.id === selection.id) ?? null : null
  const selectedApproval = selection?.kind === 'approval' ? approvals.find((item) => item.id === selection.id) ?? null : null
  const selectedHandoff = selection?.kind === 'handoff' ? handoffs.find((item) => item.id === selection.id) ?? null : null
  const approvalForSelection = selectedApproval
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
    void navigate(`/projects/${projectId}/approvals`)
  }
  const openOrchestration = (): void => {
    void navigate('/projects/' + projectId + '/orchestration?return=agents')
  }

  const changeFilter = (next: Filter): void => {
    setFilter(next)
    if (!selection) return
    if (next === 'agents' && selection.kind !== 'agent') setSelection(null)
    if (next === 'tasks' && selection.kind !== 'task') setSelection(null)
    if (next === 'outputs' && selection.kind !== 'artifact' && selection.kind !== 'approval') setSelection(null)
  }

  const counts = {
    all: agents.length + tasks.length + artifacts.length + pendingApprovals.length,
    agents: agents.length,
    tasks: tasks.length,
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
      return (
        <>
          <div className="aco-inspector-hero">
            <span className="aco-avatar is-large" style={{ color: selectedAgent.accent || undefined, borderColor: selectedAgent.accent ? `${selectedAgent.accent}55` : undefined }}>
              {selectedAgent.name.slice(0, 1)}
            </span>
            <div>
              <strong>{selectedAgent.role}</strong>
              <span>{selectedAgent.taskTitle ?? '暂无进行中的任务'}</span>
            </div>
            <span className={`aco-pill is-${status.tone}`}><i />{status.label}</span>
          </div>
          <dl className="aco-detail-list">
            <div><dt>当前任务</dt><dd>{selectedAgent.taskTitle ?? '暂无进行中的任务'}</dd></div>
            <div><dt>任务状态</dt><dd>{selectedAgent.taskStatus ? taskStatusLabel(selectedAgent.taskStatus) : '—'}</dd></div>
            <div><dt>活动 Run</dt><dd className="aco-mono">{selectedAgent.activeRunId ?? '—'}</dd></div>
            <div><dt>Run 状态</dt><dd>{selectedAgent.runStatus ? runStatusLabel(selectedAgent.runStatus) : '—'}</dd></div>
            <div><dt>待审批</dt><dd>{selectedAgent.pendingApprovals} 项</dd></div>
            <div><dt>会话 / 已完成 Run</dt><dd>{selectedAgent.sessionCount} / {selectedAgent.completedRuns}</dd></div>
            <div><dt>最近活动</dt><dd>{selectedAgent.lastActivityAt ? formatDateTime(selectedAgent.lastActivityAt) : '未运行'}</dd></div>
          </dl>
          {selectedAgent.pendingApprovals > 0 ? (
            <div className="aco-callout is-warn"><ShieldAlert size={13} /> 该 Agent 正在等待人工审批；Run 已暂停，不会继续写入。</div>
          ) : null}
          <AgentContextActions key={selectedAgent.id} projectId={projectId} agent={selectedAgent}
            preferredSessionId={requestedContext?.agentId===selectedAgent.id?requestedContext.sessionId:null}
            onClose={()=>setSelection(null)} />
        </>
      )
    }
    if (selectedTask) {
      const run = runs.find((item) => item.taskId === selectedTask.id) ?? null
      return (
        <>
          <dl className="aco-detail-list">
            <div><dt>任务状态</dt><dd>{taskStatusLabel(selectedTask.status)}</dd></div>
            <div><dt>负责人</dt><dd>{selectedTask.assigneeName ?? '未分配'}</dd></div>
            <div><dt>前置依赖</dt><dd>{selectedTask.dependencyIds.length} 项</dd></div>
            <div><dt>当前受阻</dt><dd>{selectedTask.blockedBy.length ? selectedTask.blockedBy.map((id) => taskById.get(id)?.title ?? id).join('、') : '无'}</dd></div>
            <div><dt>最近 Run</dt><dd className="aco-mono">{run?.id ?? '—'}</dd></div>
            <div><dt>Run 状态</dt><dd>{run ? runStatusLabel(run.status) : '未启动'}</dd></div>
            <div><dt>产物 / 审批</dt><dd>{selectedTask.artifactCount} / {run?.pendingApprovals ?? 0}</dd></div>
          </dl>
          {selectedTask.acceptanceCriteria.length > 0 ? (
            <div className="aco-detail-section">
              <span>验收标准</span>
              <ul>{selectedTask.acceptanceCriteria.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null}
        </>
      )
    }
    if (selectedArtifact) {
      return (
        <>
          <dl className="aco-detail-list">
            <div><dt>类型</dt><dd>{ARTIFACT_LABELS[selectedArtifact.kind] ?? selectedArtifact.kind}</dd></div>
            <div><dt>关联任务</dt><dd>{selectedArtifact.taskId ? taskById.get(selectedArtifact.taskId)?.title ?? selectedArtifact.taskId : '未关联'}</dd></div>
            <div><dt>Run</dt><dd className="aco-mono">{selectedArtifact.runId ?? '—'}</dd></div>
            <div><dt>内容 hash</dt><dd className="aco-mono">{selectedArtifact.contentHash ?? '—'}</dd></div>
            <div><dt>Git commit</dt><dd className="aco-mono">{selectedArtifact.gitCommit ?? '—'}</dd></div>
            <div><dt>创建时间</dt><dd>{formatDateTime(selectedArtifact.createdAt)}</dd></div>
            <div><dt>核验</dt><dd>{selectedArtifact.verifiedAt ? formatDateTime(selectedArtifact.verifiedAt) : '未核验'}</dd></div>
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
    <div className="aco-root pw-theme aco-deck" data-theme={theme}>
      <header className="aco-head">
        <div className="aco-head-copy">
          <div className="aco-title-line">
            <h1>Agent 协作</h1>
            <span className="aco-live-badge"><i />本地实时</span>
          </div>
          <p className="aco-subtitle" title={plan?.goal ?? undefined}>
            {plan ? plan.goal : '当前项目尚未生成执行计划'}
          </p>
        </div>
        <div className="aco-head-actions">
          <button
            type="button"
            className="aco-icon-btn"
            aria-label="刷新协作数据"
            onClick={() => void overview.refetch()}
            disabled={overview.isFetching}
          >
            <RefreshCw size={14} className={overview.isFetching ? 'is-spinning' : undefined} />
          </button>
        </div>
      </header>

      <div className="aco-toolbar">
        <div className="aco-filters" role="group" aria-label="筛选图中的真实对象">
          {([
            ['all', '全部', counts.all],
            ['agents', 'Agent', counts.agents],
            ['tasks', '任务', counts.tasks],
            ['outputs', '成果与审批', counts.outputs],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? 'is-active' : ''}
              aria-pressed={filter === value}
              onClick={() => changeFilter(value)}
            >
              {label}<em>{count}</em>
            </button>
          ))}
        </div>
        <div className="aco-metrics" role="status" aria-live="polite">
          <span><i className="is-accent" />{metrics.workingAgents} 工作中</span>
          <span><i className={metrics.pendingApprovals ? 'is-warn' : 'is-neutral'} />{metrics.pendingApprovals} 待审批</span>
          <span><i className={metrics.blockedTasks ? 'is-warn' : 'is-neutral'} />{metrics.blockedTasks} 依赖等待</span>
          <span><i className="is-ok" />{metrics.artifacts} 产物</span>
          <span><i className="is-neutral" />{metrics.pendingHandoffs} 交接</span>
        </div>
        <span className="aco-toolbar-spacer" />
        <button type="button" className="aco-link" onClick={openOrchestration}><Workflow size={12} /> 计划 DAG</button>
        <button type="button" className="aco-link" onClick={onManageAgents}><Bot size={12} /> Agent 管理</button>
      </div>

      <div className="aco-canvas-wrap">
        <CollaborationGraph
          agents={focus.primaryAgents}
          standbyAgents={focus.standbyAgents}
          tasks={focus.primaryTasks}
          runs={runs}
          artifacts={focus.primaryArtifacts}
          approvals={focus.primaryApprovals}
          handoffs={focus.primaryHandoffs}
          planTaskIds={plan?.taskIds ?? []}
          selected={selection}
          onSelect={setSelection}
          initialViewport={savedViewport}
          onViewportChange={setSavedViewport}
          showAgents={filter === 'all' || filter === 'agents'}
          showTasks={filter === 'all' || filter === 'tasks'}
          showOutputs={filter === 'all' || filter === 'outputs'}
        />
      </div>

      <footer className={`aco-activity is-${activityStatus.tone}`} aria-label="实时活动">
        <span className="aco-activity-label">
          <i className={`aco-live-dot${pageActive ? ' is-on' : ''}`} />
          最新活动
        </span>
        <div className="aco-activity-main">
          {latestActivity ? (
            <>
              <strong>{latestActivity.actorName ?? '系统'}</strong>
              <span>{latestActivity.summary}</span>
              <time className="aco-mono">{formatRelative(latestActivity.createdAt)}</time>
            </>
          ) : (
            <span>还没有运行事件。启动计划后，这里只显示真实的 Run / Approval / Handoff 事件。</span>
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
    </div>
  )
}
