import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Input, Select } from 'antd'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Brain,
  CheckCircle2,
  CircleDot,
  CirclePause,
  FileDiff,
  Hammer,
  History,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldAlert,
  Square,
  XCircle,
} from 'lucide-react'
import type { RunStep, RunSummary } from '@projectos/contracts'
import { useApprovals, useProjectEvents, useRunDetail, useRuns } from '../lib/queries'
import { formatDateTime, formatDuration, formatTime } from '../lib/format'
import { eventTypeLabel, runStatusLabel } from '../lib/labels'
import { errorMessage } from '../lib/errors'
import { listKeyStep } from '../lib/list-keys'
import { useResolvedTheme } from '../stores/ui'
import { DialogShell, OverlayFooter, OverlayHeader, OverlayScrollArea } from '../next-ui/overlay/overlay-shell'
import '../features/studio/studio.css'
import '../features/review/review.css'
import './runs-audit.css'

const ACTIVE = new Set(['created', 'queued', 'running', 'waiting_tool', 'waiting_approval', 'verifying', 'suspended'])
type Lens = 'runs' | 'events'
type Filter = 'all' | 'active' | 'waiting' | 'failed' | 'done'

const FILTERS: Array<{ key: Filter; label: string; match: (run: RunSummary) => boolean }> = [
  { key: 'all', label: '全部', match: () => true },
  { key: 'active', label: '进行中', match: (run) => ACTIVE.has(run.status) && run.status !== 'waiting_approval' },
  { key: 'waiting', label: '等待授权', match: (run) => run.status === 'waiting_approval' || run.pendingApprovals > 0 },
  { key: 'failed', label: '异常', match: (run) => ['failed', 'needs_reconciliation', 'cancelled'].includes(run.status) || run.status.startsWith('budget') },
  { key: 'done', label: '已完成', match: (run) => run.status === 'completed' },
]

function tone(status: string): 'live' | 'wait' | 'ok' | 'bad' | 'mute' {
  if (status === 'waiting_approval' || status === 'needs_reconciliation' || status === 'suspended') return 'wait'
  if (ACTIVE.has(status)) return 'live'
  if (status === 'completed') return 'ok'
  if (status === 'cancelled') return 'mute'
  return 'bad'
}

function dayLabel(timestamp: number): string {
  const day = new Date(timestamp)
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diff = Math.round((start(new Date()) - start(day)) / 86_400_000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  return `${day.getMonth() + 1} 月 ${day.getDate()} 日`
}

function groupByDay<T>(items: T[], at: (item: T) => number): Array<[string, T[]]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = dayLabel(at(item))
    map.set(key, [...(map.get(key) ?? []), item])
  }
  return [...map.entries()]
}

/* ------------------------------------------------------------------ step timeline */

function stepIcon(step: RunStep): ReactElement {
  if (step.kind === 'tool_request') return <Hammer size={13} />
  if (step.kind === 'tool_result') return step.payload.ok === false ? <XCircle size={13} /> : <CheckCircle2 size={13} />
  if (step.kind === 'approval') return <ShieldAlert size={13} />
  if (step.kind === 'text') return <MessageSquareText size={13} />
  if (step.kind === 'context') return <Brain size={13} />
  if (step.kind === 'error') return <AlertTriangle size={13} />
  return <CircleDot size={13} />
}

function stepTone(step: RunStep): string {
  if (step.kind === 'error' || (step.kind === 'tool_result' && step.payload.ok === false)) return 'bad'
  if (step.kind === 'approval' && step.status === 'waiting') return 'wait'
  if (step.kind === 'tool_result') return 'ok'
  return 'plain'
}

function stepTitle(step: RunStep): string {
  const raw = step.title || step.kind
  const match = /^状态[:：]\s*([a-z_]+)$/.exec(raw)
  return match ? `状态：${runStatusLabel(match[1]!)}` : raw
}

function StepLine({ step }: { step: RunStep }): ReactElement {
  const [open, setOpen] = useState(false)
  const content = typeof step.payload.content === 'string' ? step.payload.content : null
  const error = typeof step.payload.error === 'string' ? step.payload.error : null
  const body = content ?? error
  const long = Boolean(body && body.length > 220)
  return (
    <li className={`ra-step is-${stepTone(step)}`}>
      <span className="ra-step-node" aria-hidden>{stepIcon(step)}</span>
      <div className="ra-step-main">
        <div className="ra-step-head">
          <strong>{stepTitle(step)}</strong>
          <time>{formatTime(step.createdAt)}</time>
        </div>
        {body ? (
          <p className={`ra-step-body ${long && !open ? 'is-clamped' : ''}`}>{body}</p>
        ) : null}
        {long ? <button type="button" className="ra-step-more" onClick={() => setOpen((value) => !value)}>{open ? '收起' : '展开全文'}</button> : null}
      </div>
    </li>
  )
}

/* ------------------------------------------------------------------ page */

export default function RunsPage(): ReactElement {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const theme = useResolvedTheme()
  const { message } = AntApp.useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(searchParams.get('run'))
  const lens: Lens = searchParams.get('lens') === 'events' ? 'events' : 'runs'
  const setLens = (next: Lens): void => {
    const params = new URLSearchParams(searchParams)
    if (next === 'events') params.set('lens', 'events')
    else params.delete('lens')
    setSearchParams(params, { replace: true })
  }
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [reconcileOpen, setReconcileOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const [reconcileDecision, setReconcileDecision] = useState<'completed' | 'retry' | 'failed'>('completed')
  const [reconcileNote, setReconcileNote] = useState('')
  const runs = useRuns(projectId, 100)
  const runDetail = useRunDetail(selectedRunId)
  const approvals = useApprovals(projectId)
  const events = useProjectEvents(projectId, 100)
  const listRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const runFromQuery = searchParams.get('run')
    if (runFromQuery) {
      setSelectedRunId(runFromQuery)
      const next = new URLSearchParams(searchParams)
      next.delete('run')
      next.delete('lens')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const allRuns = useMemo(
    () => [...(runs.data?.runs ?? [])].sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt)),
    [runs.data],
  )
  const runList = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const match = FILTERS.find((entry) => entry.key === filter)!.match
    return allRuns.filter((run) => match(run) && (!needle || `${run.agentName} ${run.taskTitle ?? ''} ${run.sessionTitle} ${runStatusLabel(run.status)}`.toLowerCase().includes(needle)))
  }, [allRuns, filter, query])
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((entry) => [entry.key, allRuns.filter(entry.match).length])), [allRuns])

  useEffect(() => {
    if (!selectedRunId && runList.length > 0) setSelectedRunId(runList[0]!.id)
  }, [runList, selectedRunId])

  useEffect(() => {
    if (lens !== 'runs') return
    const onKey = (event: KeyboardEvent): void => {
      const step = listKeyStep(event, listRef.current)
      if (!step) return
      const index = runList.findIndex((run) => run.id === selectedRunId)
      const next = runList[Math.min(runList.length - 1, Math.max(0, index + step))]
      if (next) { setSelectedRunId(next.id); event.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lens, runList, selectedRunId])

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['runs', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['run'] }),
      queryClient.invalidateQueries({ queryKey: ['approvals', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['events', projectId] }),
    ])
  }

  const cancel = useMutation({
    mutationFn: (runId: string) => window.projectos.runs.cancel(runId),
    onSuccess: async () => { await refresh(); message.success('已请求取消运行') },
    onError: (error) => message.error(errorMessage(error)),
  })
  const reconcile = useMutation({
    mutationFn: (input: { runId: string; decision: 'completed' | 'retry' | 'failed'; note: string }) => window.projectos.runs.reconcile(input),
    onSuccess: async (result) => {
      await refresh()
      setReconcileOpen(false)
      message.success(result.status === 'completed' ? '已核对为完成，请在计划编排中继续' : result.status === 'failed' ? '已记录核对结果；可重试或保持阻塞' : '已记录核对结果')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const pendingApprovals = (approvals.data?.approvals ?? []).filter((approval) => approval.status === 'pending')
  // A deep-linked Run may be older than the loaded page; its detail read still carries the summary.
  const selectedRun = allRuns.find((run) => run.id === selectedRunId) ?? (runDetail.data?.run.id === selectedRunId ? runDetail.data.run : null)
  const detail = runDetail.data
  const longest = Math.max(1, ...allRuns.map((run) => (run.finishedAt ?? now) - (run.startedAt ?? run.createdAt)))
  const live = allRuns.filter((run) => ACTIVE.has(run.status)).length
  const reviewRoute = (approvalId?: string): string => {
    const params = new URLSearchParams()
    if (approvalId) params.set('approval', approvalId)
    params.set('return', 'runs')
    if (selectedRunId) params.set('run', selectedRunId)
    return `/projects/${projectId}/approvals?${params.toString()}`
  }
  const selectedRunApproval = selectedRun ? pendingApprovals.find((approval) => approval.runId === selectedRun.id) ?? null : null

  return (
    <div className="studio-theme ra-page" data-theme={theme}>
      <header className="ra-head">
        <div className="ra-head-title">
          <h1>运行审计</h1>
          <p>
            <span><b>{allRuns.length}</b> 次运行</span>
            <span className={live ? 'is-live' : ''}><b>{live}</b> 进行中</span>
            <span><b>{(events.data?.events.length ?? 0)}</b> 条事件</span>
          </p>
        </div>
        <div className="rv-lenses" role="tablist" aria-label="审计视图">
          <button type="button" role="tab" aria-selected={lens === 'runs'} onClick={() => setLens('runs')}><Activity size={13} />运行</button>
          <button type="button" role="tab" aria-selected={lens === 'events'} onClick={() => setLens('events')}><History size={13} />事件流</button>
        </div>
        <button type="button" className="studio-ghost ra-refresh" onClick={() => void refresh()} aria-label="刷新" title="刷新"><RefreshCw size={14} className={runs.isRefetching ? 'is-spinning' : ''} /></button>
      </header>

      {pendingApprovals.length > 0 ? (
        <button type="button" className="ra-await" onClick={() => navigate(reviewRoute(pendingApprovals.length === 1 ? pendingApprovals[0]!.id : undefined))}>
          <span className="ra-await-pulse" aria-hidden><CirclePause size={15} /></span>
          <span><strong>{pendingApprovals.length} 个工具请求</strong>让运行暂停，等待你的审阅</span>
          <span className="ra-await-go">去审阅室 <ArrowRight size={13} /></span>
        </button>
      ) : null}

      {lens === 'events' ? (
        <section className="ra-events" aria-label="项目事件流">
          {events.isLoading ? <div className="studio-loading">正在读取事件…</div>
            : events.isError ? <div className="ra-state is-error"><AlertTriangle size={18} /><span>{errorMessage(events.error)}</span><Button size="small" onClick={() => void events.refetch()}>重试</Button></div>
            : (events.data?.events.length ?? 0) === 0 ? <div className="ra-state"><History size={22} /><strong>还没有项目事件</strong></div>
            : groupByDay(events.data!.events, (event) => event.createdAt).map(([day, list]) => (
              <div key={day} className="ra-day">
                <h3>{day}</h3>
                <ol className="ra-event-list">
                  {list.map((event) => (
                    <li key={event.id}>
                      <time>{formatTime(event.createdAt)}</time>
                      <span className="ra-event-node" aria-hidden />
                      <div>
                        <span className="ra-event-type" title={event.eventType}>{eventTypeLabel(event.eventType)}</span>
                        <p>{event.summary}</p>
                      </div>
                      <span className="ra-event-seq">#{event.seq}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
        </section>
      ) : (
        <div className="ra-split">
          <nav className="ra-list" aria-label="运行列表" ref={listRef}>
            <div className="rv-search">
              <Search size={13} aria-hidden />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Agent、任务或会话" aria-label="搜索运行" />
            </div>
            <div className="rv-filters" role="group" aria-label="按状态筛选">
              {FILTERS.map((entry) => (
                <button key={entry.key} type="button" aria-pressed={filter === entry.key} onClick={() => setFilter(entry.key)}>
                  {entry.label}{counts[entry.key] ? <span className="ra-count">{counts[entry.key]}</span> : null}
                </button>
              ))}
            </div>
            {runs.isLoading ? <div className="studio-loading">正在读取运行…</div>
              : runs.isError ? <div className="ra-state is-error"><AlertTriangle size={18} /><span>{errorMessage(runs.error)}</span><Button size="small" onClick={() => void runs.refetch()}>重试</Button></div>
              : allRuns.length === 0 ? (
                <div className="ra-state"><Bot size={22} /><strong>还没有运行记录</strong><span>启动计划或让 Agent 开始一项任务后，每次运行都会出现在这里。</span><Button size="small" onClick={() => navigate(`/projects/${projectId}/agents`)}>前往 Agent 协作</Button></div>
              ) : runList.length === 0 ? <p className="rv-queue-empty">没有符合条件的运行</p>
              : groupByDay(runList, (run) => run.startedAt ?? run.createdAt).map(([day, list]) => (
                <section key={day} className="ra-day">
                  <h3>{day}</h3>
                  <ul>
                    {list.map((run) => {
                      const span = (run.finishedAt ?? now) - (run.startedAt ?? run.createdAt)
                      return (
                        <li key={run.id}>
                          <button type="button" className={`ra-run ${run.id === selectedRunId ? 'is-focus' : ''}`} aria-current={run.id === selectedRunId ? 'true' : undefined} onClick={() => setSelectedRunId(run.id)}>
                            <span className={`ra-orb is-${tone(run.status)}`} aria-hidden />
                            <span className="ra-run-main">
                              <strong>{run.taskTitle ?? run.sessionTitle}</strong>
                              <small>{run.agentName} · {runStatusLabel(run.status)}{run.attempt > 1 ? ` · 第 ${run.attempt} 次` : ''}</small>
                              <span className="ra-run-bar" aria-hidden><i className={`is-${tone(run.status)}`} style={{ width: `${Math.max(4, Math.round((span / longest) * 100))}%` }} /></span>
                            </span>
                            <span className="ra-run-side">
                              <time>{formatTime(run.startedAt ?? run.createdAt)}</time>
                              <small>{formatDuration(run.startedAt, run.finishedAt)}</small>
                              {run.pendingApprovals > 0 ? <em>{run.pendingApprovals} 待审</em> : null}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
          </nav>

          <article className="ra-detail" aria-label="运行详情" data-testid="run-detail">
            {!selectedRun ? (
              allRuns.length ? <div className="ra-state"><Activity size={22} /><strong>选择一次运行查看经过</strong></div> : null
            ) : (
              <>
                <header className="ra-detail-head">
                  <span className={`ra-status is-${tone(selectedRun.status)}`}><span className={`ra-orb is-${tone(selectedRun.status)}`} aria-hidden />{runStatusLabel(selectedRun.status)}</span>
                  <span className="studio-mono ra-id">{selectedRun.id}</span>
                </header>
                <h2>{selectedRun.taskTitle ?? selectedRun.sessionTitle}</h2>
                <p className="rv-byline">
                  <strong>{selectedRun.agentName}</strong>
                  <span>{formatDateTime(selectedRun.startedAt ?? selectedRun.createdAt)}</span>
                  <span>{formatDuration(selectedRun.startedAt, selectedRun.finishedAt)}</span>
                </p>

                <dl className="ra-facts">
                  <div><dt>会话</dt><dd>{selectedRun.sessionTitle}</dd></div>
                  <div><dt>尝试</dt><dd>第 {selectedRun.attempt} 次</dd></div>
                  <div><dt>Token</dt><dd className="is-num">{selectedRun.inputTokens.toLocaleString()} / {selectedRun.outputTokens.toLocaleString()}</dd></div>
                  {detail?.snapshot ? (
                    <>
                      <div><dt>Agent 快照</dt><dd>{detail.snapshot.agentName} · v{detail.snapshot.agentConfigVersion}</dd></div>
                      <div><dt>Runtime</dt><dd>{detail.snapshot.runtimeProfileName ?? '内置 Provider'}</dd></div>
                      <div><dt>权限</dt><dd>{[detail.snapshot.permissions.files ? '文件' : '', detail.snapshot.permissions.shell ? 'Shell' : '', detail.snapshot.permissions.network ? '网络' : ''].filter(Boolean).join(' · ') || '无'}</dd></div>
                    </>
                  ) : null}
                </dl>

                {selectedRun.error ? <div className="ra-error"><AlertTriangle size={14} /><span>{selectedRun.error}</span></div> : null}

                <div className="ra-actions">
                  <button type="button" className="studio-ghost" onClick={() => navigate(`/projects/${projectId}/agents?session=${encodeURIComponent(selectedRun.sessionId)}`)}><MessageSquareText size={13} />打开会话</button>
                  {selectedRun.pendingApprovals > 0 ? <button type="button" className="studio-cta" onClick={() => navigate(reviewRoute(selectedRunApproval?.id))}><ShieldAlert size={13} />审阅 {selectedRun.pendingApprovals} 个请求</button> : null}
                  {selectedRun.status === 'needs_reconciliation' ? <button type="button" className="studio-cta" onClick={() => { setReconcileDecision('completed'); setReconcileNote(''); setReconcileOpen(true) }}>人工核对</button> : null}
                  {ACTIVE.has(selectedRun.status) ? <button type="button" className="studio-danger" disabled={cancel.isPending} onClick={() => cancel.mutate(selectedRun.id)}><Square size={12} />取消运行</button> : null}
                </div>

                {(detail?.fileChanges.length ?? 0) > 0 ? (
                  <section className="ra-section">
                    <h3><FileDiff size={14} />改动的文件 <em>{detail!.fileChanges.length}</em></h3>
                    <ul className="ra-files">
                      {detail!.fileChanges.map((change) => (
                        <li key={change.path}><span className={`ra-change is-${change.changeType}`}>{change.changeType === 'added' ? '新增' : change.changeType === 'deleted' ? '删除' : '修改'}</span><code>{change.path}</code></li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <section className="ra-section">
                  <h3><Activity size={14} />经过 {detail ? <em>{detail.steps.length}</em> : null}</h3>
                  {runDetail.isLoading ? <div className="studio-loading is-inline">正在读取步骤…</div>
                    : runDetail.isError ? <div className="ra-state is-error"><AlertTriangle size={18} /><span>{errorMessage(runDetail.error)}</span></div>
                    : (detail?.steps.length ?? 0) === 0 ? <p className="rv-queue-empty">这次运行还没有记录步骤</p>
                    : <ol className="ra-steps">{detail!.steps.map((step) => <StepLine key={step.id} step={step} />)}</ol>}
                </section>
              </>
            )}
          </article>
        </div>
      )}

      <DialogShell open={reconcileOpen && Boolean(selectedRun)} onOpenChange={(open) => { if (!open) setReconcileOpen(false) }} ariaLabel="人工核对运行" width={520}>
        <OverlayHeader eyebrow="RECONCILIATION" title="人工核对运行" closeLabel="关闭人工核对" />
        <OverlayScrollArea className="po-reconcile-scroll">
          <p className="po-muted">该运行在 Runtime 中断后状态未知。核对不会自动重复执行可能已写盘或产生外部副作用的操作；原始 Run、ToolCall 和 RunStep 会保留。</p>
          <Select
            style={{ width: '100%', marginBottom: 12 }}
            aria-label="核对决定"
            value={reconcileDecision}
            options={[
              { value: 'completed', label: '确认已完成（任务进入审查，计划需手动继续）' },
              { value: 'retry', label: '确认可重试（任务回到就绪，计划需手动继续）' },
              { value: 'failed', label: '确认失败（保持阻塞）' },
            ]}
            onChange={(value: 'completed' | 'retry' | 'failed') => setReconcileDecision(value)}
          />
          <Input.TextArea rows={4} value={reconcileNote} onChange={(event) => setReconcileNote(event.target.value)} placeholder="说明你核对到的实际状态、已验证的文件/命令，以及为什么可以继续。" />
        </OverlayScrollArea>
        <OverlayFooter>
          <Button onClick={() => setReconcileOpen(false)}>取消</Button>
          <Button type="primary" loading={reconcile.isPending} onClick={() => { if (selectedRun) reconcile.mutate({ runId: selectedRun.id, decision: reconcileDecision, note: reconcileNote }) }}>记录核对</Button>
        </OverlayFooter>
      </DialogShell>
    </div>
  )
}
