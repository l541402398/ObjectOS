import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  FolderKanban,
  MoreHorizontal,
  Plus,
  CheckCircle2,
  CircleAlert,
  Clock3,
  GitBranch,
  Layers3,
  Settings2,
  ShieldAlert,
} from 'lucide-react'
import { useResolvedTheme } from '../../stores/ui'
import { formatRelative, formatDateTime } from '../../lib/format'
import { runStatusLabel, taskStatusLabel } from '../../lib/labels'
import { useAgents, useApprovals, useBootstrap, usePlans, useRuns, useTaskBoard } from '../../lib/queries'
import './studio.css'
import { ProjectModeControl } from '../../components/ProjectModeControl'
import { NextStepPanel } from '../../components/NextStepPanel'
import { PopoverShell } from '../../next-ui/overlay/overlay-shell'
import { ErrorState } from '@projectos/ui'
import { errorMessage } from '../../lib/errors'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../next-ui/vendor/tabs'
import { RequirementCreateModal } from '../../pages/RequirementWorkPage'

export function StudioProjectHome(): ReactElement {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const [createRequirementOpen, setCreateRequirementOpen] = useState(() => search.get('intent') === 'requirement')
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const theme = useResolvedTheme()

  useEffect(() => {
    if (search.get('intent') === 'requirement') {
      setCreateRequirementOpen(true)
      setSearch((current) => {
        const next = new URLSearchParams(current)
        next.delete('intent')
        return next
      }, { replace: true })
    }
  }, [search, setSearch])
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
  const workingAgents = (agents.data?.agents ?? []).filter((agent) => agent.status === 'working')
  const latestRuns = [...(runs.data?.runs ?? [])].sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt)).slice(0, 6)

  if (bootstrap.isLoading || plans.isLoading || board.isLoading || runs.isLoading || approvals.isLoading || agents.isLoading) {
    return <div className={`studio-home studio-theme`} data-theme={theme}><div className="studio-loading">正在读取项目事实…</div></div>
  }

  const failure = [bootstrap, plans, board, runs, approvals, agents].find((query) => query.isError)
  if (failure) return <div className="po-page"><ErrorState title="项目状态读取失败" message={errorMessage(failure.error)} onRetry={() => { void Promise.all([bootstrap, plans, board, runs, approvals, agents].map((query) => query.refetch())) }} /></div>

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

  return (
    <div className="studio-home studio-theme studio-workbench" data-theme={theme}>
      <header className="studio-masthead">
        <div className="studio-masthead-id">
          <h1 className="po-page-title">{project.name}</h1>
          <span className="studio-muted">{project.description || '本地优先项目工作区'}</span>
        </div>
        <div className="studio-masthead-actions">
          <ProjectModeControl projectId={projectId} />
          <button type="button" className="studio-cta" onClick={() => setCreateRequirementOpen(true)}><Plus size={14} />提出需求</button>
          <PopoverShell
            ariaLabel="更多项目操作"
            open={moreMenuOpen}
            onOpenChange={setMoreMenuOpen}
            trigger={<button type="button" className="studio-ghost" aria-label="更多项目操作"><MoreHorizontal size={18} /></button>}
            className="pdl-plan-menu po-glass-action-menu"
            align="end"
          >
            <button type="button" onClick={() => { setMoreMenuOpen(false); navigate(`/projects/${projectId}/requirements`) }}>
              <BookOpen size={15} />
              <span>需求工作台</span>
            </button>
            <button type="button" onClick={() => { setMoreMenuOpen(false); navigate(`/projects/${projectId}/overview`) }}>
              <FolderKanban size={15} />
              <span>项目姿态</span>
            </button>
            <button type="button" onClick={() => { setMoreMenuOpen(false); navigate(`/projects/${projectId}/health`) }}>
              <Activity size={15} />
              <span>项目健康</span>
            </button>
            <button type="button" onClick={() => { setMoreMenuOpen(false); navigate(`/projects/${projectId}/project-settings`) }}>
              <Settings2 size={15} />
              <span>项目设置</span>
            </button>
          </PopoverShell>
        </div>
      </header>

      <section className="studio-project-summary" aria-label="项目概况">
        <div className="studio-summary-progress">
          <span>任务完成 <strong>{doneTasks.length} / {tasks.length}</strong></span>
          <progress value={doneTasks.length} max={tasks.length || 1} aria-label="任务完成进度" />
        </div>
        {workingAgents.length > 0 ? <span className="studio-summary-status">{workingAgents.length} 位 Agent 工作中</span> : null}
        {plan ? <span className="studio-summary-plan">计划 r{plan.revision} · {plan.status === 'approved' ? '已批准' : plan.status === 'draft' ? '待审核' : plan.status === 'rejected' ? '已拒绝' : plan.status}</span> : null}
        <div className="studio-summary-actions">
          <button type="button" className="studio-link" onClick={() => navigate(plan ? `/projects/${projectId}/orchestration?plan=${plan.id}` : `/projects/${projectId}/orchestration`)}>
            {plan ? '查看计划' : '生成计划'} <ArrowRight size={13} />
          </button>
          <button type="button" className="studio-link" onClick={() => navigate(`/projects/${projectId}/agents`)}>进入协作图 <ArrowRight size={13} /></button>
        </div>
      </section>

      <NextStepPanel projectId={projectId} navigate={navigate} onCreateRequirement={() => setCreateRequirementOpen(true)} />

      <Tabs defaultValue="active" className="studio-records">
        <TabsList aria-label="项目记录">
          <TabsTrigger value="active">进行中 <span>{activeTasks.length}</span></TabsTrigger>
          <TabsTrigger value="approvals">待审批 <span>{pending.length}</span></TabsTrigger>
          <TabsTrigger value="runs">最近运行</TabsTrigger>
        </TabsList>
        <TabsContent value="active">
        <section className="studio-focus">
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
            <span>当前进行中的任务</span>
            <button type="button" className="studio-link" onClick={() => navigate(`/projects/${projectId}/agents`)}>在协作图中查看 <ArrowRight size={12} /></button>
          </footer>
        </section>
        </TabsContent>
        <TabsContent value="approvals">
        <aside className="studio-ledger">
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
            <span>处理后，关联任务会按现有授权继续。</span>
          </div>
          <footer className="studio-section-foot"><button type="button" className="studio-link" onClick={() => navigate(`/projects/${projectId}/approvals`)}>全部审批 <ArrowRight size={12} /></button></footer>
        </aside>
        </TabsContent>
        <TabsContent value="runs">
      <section className="studio-timeline">
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
        <footer className="studio-section-foot"><button type="button" className="studio-link" onClick={() => navigate(`/projects/${projectId}/runs`)}>全部记录 <ArrowRight size={12} /></button></footer>
      </section>
        </TabsContent>
      </Tabs>

      {createRequirementOpen ? (
        <RequirementCreateModal
          projectId={projectId}
          onClose={() => setCreateRequirementOpen(false)}
          onCreated={(id) => navigate(`/projects/${projectId}/requirements?requirement=${id}`)}
        />
      ) : null}
    </div>
  )
}

export default StudioProjectHome
