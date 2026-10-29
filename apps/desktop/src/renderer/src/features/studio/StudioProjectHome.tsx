import { useMemo, type ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  GitBranch,
  Layers3,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import { useResolvedTheme } from '../../stores/ui'
import { formatRelative, formatDateTime } from '../../lib/format'
import { runStatusLabel, taskStatusLabel } from '../../lib/labels'
import { useAgents, useApprovals, useBootstrap, usePlans, useRuns, useTaskBoard } from '../../lib/queries'
import './studio.css'

export function StudioProjectHome(): ReactElement {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const theme = useResolvedTheme()
  const bootstrap = useBootstrap()
  const plans = usePlans(projectId)
  const board = useTaskBoard(projectId)
  const runs = useRuns(projectId, 40)
  const approvals = useApprovals(projectId)
  const agents = useAgents(projectId)

  const project = bootstrap.data?.projects.find((item) => item.id === projectId) ?? null
  const plan = plans.data?.plans[0] ?? null
  const tasks = useMemo(() => (board.data?.tasks ?? []).filter((task) => task.status !== 'cancelled'), [board.data])
  const pending = useMemo(() => (approvals.data?.approvals ?? []).filter((approval) => approval.status === 'pending'), [approvals.data])
  const activeTasks = tasks.filter((task) => task.status === 'running' || task.status === 'review')
  const doneTasks = tasks.filter((task) => task.status === 'done')
  const running = (runs.data?.runs ?? []).filter((run) => ['running', 'waiting_approval', 'waiting_tool', 'verifying'].includes(run.status))
  const workingAgents = (agents.data?.agents ?? []).filter((agent) => agent.status === 'working')
  const latestRuns = [...(runs.data?.runs ?? [])].sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt)).slice(0, 6)

  if (bootstrap.isLoading || plans.isLoading || board.isLoading) {
    return <div className={`studio-home studio-theme`} data-theme={theme}><div className="studio-loading">正在读取项目事实…</div></div>
  }

  if (!project) {
    return (
      <div className="studio-home studio-theme" data-theme={theme}>
        <div className="studio-empty">
          <CircleAlert size={20} />
          <h1>项目不可用</h1>
          <p>当前项目可能已被删除，或尚未完成加载。</p>
        </div>
      </div>
    )
  }

  const progress = tasks.length > 0 ? Math.round((doneTasks.length / tasks.length) * 100) : 0

  return (
    <div className="studio-home studio-theme" data-theme={theme}>
      <header className="studio-masthead">
        <div className="studio-masthead-id">
          <span className="studio-eyebrow">PROJECT / {project.currentStage}</span>
          <h1 className="po-page-title">{project.name}</h1>
          <span className="studio-muted">{project.description || '本地优先项目工作区'}</span>
        </div>
        <div className="studio-masthead-actions">
          <button type="button" className="studio-ghost" onClick={() => navigate(`/projects/${projectId}/tasks`)}>任务看板</button>
          <button type="button" className="studio-ghost" onClick={() => navigate(`/projects/${projectId}/orchestration`)}>计划 DAG</button>
          <button type="button" className="studio-cta" onClick={() => navigate(`/projects/${projectId}/agents`)}>进入协作图 <ArrowUpRight size={14} /></button>
        </div>
      </header>

      <section className="studio-hero">
        <div className="studio-hero-copy">
          <span className="studio-kicker"><Sparkles size={13} /> CURRENT MISSION</span>
          <h2>{plan?.goal ?? '还没有执行计划'}</h2>
          <div className="studio-hero-meta">
            <span>{plan ? `计划 r${plan.revision} · ${plan.status === 'approved' ? '已批准' : plan.status}` : '等待生成计划'}</span>
            <span>{project.currentStage} 阶段</span>
            <span>{workingAgents.length} 位 Agent 正在工作</span>
          </div>
          <div className="studio-hero-actions">
            {plan ? (
              <button type="button" className="studio-cta" onClick={() => navigate(`/projects/${projectId}/orchestration?plan=${plan.id}`)}>
                查看执行计划 <ArrowRight size={14} />
              </button>
            ) : (
              <button type="button" className="studio-cta" onClick={() => navigate(`/projects/${projectId}/orchestration`)}>生成计划 <ArrowRight size={14} /></button>
            )}
            <button type="button" className="studio-ghost" onClick={() => navigate(`/projects/${projectId}/runs`)}>运行审计</button>
          </div>
        </div>
        <div className="studio-progress">
          <div className="studio-progress-ring" style={{ '--studio-progress': `${progress}%` } as React.CSSProperties}>
            <strong>{progress}%</strong>
            <span>完成</span>
          </div>
          <dl>
            <div><dt>任务</dt><dd>{doneTasks.length} / {tasks.length}</dd></div>
            <div><dt>执行中</dt><dd>{activeTasks.length}</dd></div>
            <div><dt>待审批</dt><dd className={pending.length ? 'is-warn' : ''}>{pending.length}</dd></div>
            <div><dt>活动 Run</dt><dd>{running.length}</dd></div>
          </dl>
        </div>
      </section>

      <div className="studio-home-grid">
        <section className="studio-focus">
          <header><span className="studio-kicker">IN FLIGHT</span><strong>正在发生</strong><em>{activeTasks.length}</em></header>
          {activeTasks.length === 0 ? (
            <div className="studio-inline-empty">
              <Layers3 size={16} />
              <span>{plan ? '当前计划没有执行中的任务。' : '计划尚未生成，先建立执行目标。'}</span>
            </div>
          ) : (
            <div className="studio-focus-list">
              {activeTasks.slice(0, 5).map((task) => {
                const run = (runs.data?.runs ?? []).find((item) => item.taskId === task.id)
                return (
                  <button key={task.id} type="button" className="studio-focus-row" onClick={() => navigate(`/projects/${projectId}/tasks`)}>
                    <span className={`studio-status-dot is-${task.status}`} />
                    <span className="studio-focus-main">
                      <strong>{task.title}</strong>
                      <small>{task.assigneeName ?? '未分配'} · {run ? runStatusLabel(run.status) : taskStatusLabel(task.status)}</small>
                    </span>
                    <span className="studio-focus-time">{run ? formatRelative(run.startedAt ?? run.createdAt) : '等待运行'}</span>
                    <ArrowUpRight size={14} />
                  </button>
                )
              })}
            </div>
          )}
          <footer className="studio-section-foot">
            <span>只显示真实 Task/Run 行</span>
            <button type="button" className="studio-link" onClick={() => navigate(`/projects/${projectId}/agents`)}>在协作图中查看 <ArrowRight size={12} /></button>
          </footer>
        </section>

        <aside className="studio-ledger">
          <header><span className="studio-kicker">NEEDS A HUMAN</span><strong>待处理</strong><em>{pending.length}</em></header>
          {pending.length === 0 ? (
            <div className="studio-inline-empty"><CheckCircle2 size={16} /><span>没有等待你的审批。</span></div>
          ) : (
            <div className="studio-approval-list">
              {pending.slice(0, 4).map((approval) => (
                <button key={approval.id} type="button" className="studio-approval-row" onClick={() => navigate(`/projects/${projectId}/approvals`)}>
                  <span className="studio-approval-icon"><ShieldAlert size={14} /></span>
                  <span><strong>{approval.title}</strong><small>{approval.agentName} · {formatRelative(approval.requestedAt)}</small></span>
                  <ArrowRight size={13} />
                </button>
              ))}
            </div>
          )}
          <div className="studio-ledger-note">
            <Clock3 size={13} />
            <span>审批与 Run 状态来自本地持久化，不是前端模拟。</span>
          </div>
        </aside>
      </div>

      <section className="studio-timeline">
        <header><span className="studio-kicker">RECENT EXECUTION</span><strong>最近运行</strong><button type="button" className="studio-link" onClick={() => navigate(`/projects/${projectId}/runs`)}>全部记录 <ArrowRight size={12} /></button></header>
        {latestRuns.length === 0 ? (
          <div className="studio-inline-empty"><GitBranch size={16} /><span>还没有运行记录。</span></div>
        ) : (
          <div className="studio-run-strip">
            {latestRuns.map((run) => (
              <button key={run.id} type="button" className="studio-run" onClick={() => navigate(`/projects/${projectId}/runs?run=${run.id}`)}>
                <span className={`studio-status-dot is-${run.status}`} />
                <span><strong>{run.agentName ?? 'Agent'}</strong><small>{runStatusLabel(run.status)} · {formatDateTime(run.startedAt ?? run.createdAt)}</small></span>
                <em>{run.status === 'waiting_approval' ? '等待审批' : '查看'}</em>
              </button>
            ))}
          </div>
        )}
      </section>

      <footer className="studio-colophon">
        <span>{project.rootPath}</span>
        <span>本地工作区 · 真实持久化</span>
      </footer>
    </div>
  )
}

export default StudioProjectHome
