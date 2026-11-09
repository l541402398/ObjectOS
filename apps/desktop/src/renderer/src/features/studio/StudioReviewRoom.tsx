import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  CheckCircle2,
  CircleAlert,
  FilePlus2,
  FilePen,
  GitBranch,
  Lock,
  ShieldAlert,
  ShieldCheck,
  SquareTerminal,
  X,
} from 'lucide-react'
import type { ApprovalBatchResult, ApprovalView } from '@projectos/contracts'
import { useResolvedTheme } from '../../stores/ui'
import { errorMessage } from '../../lib/errors'
import { formatRelative } from '../../lib/format'
import { qk, useApprovals } from '../../lib/queries'
import { diffStats, lineDiff } from '../../lib/line-diff'
import { ReviewDiff } from '../review/ReviewDiff'
import { WorktreeAutoAllowControl } from '../review/WorktreeAutoAllowControl'
import { DeliveryLens, HistoryLens } from '../review/ReviewLenses'
import './studio.css'
import '../review/review.css'

type Decision = 'approved' | 'rejected'
type Lens = 'pending' | 'delivery' | 'history'
type Confirm = { mode: 'single'; decision: Decision } | { mode: 'kind' } | { mode: 'batch'; decision: Decision } | null
type Group = { key: string; label: string; batchable: boolean; reason: string; items: ApprovalView[] }

const FALLBACK_KIND = { key: 'other', label: '其他请求', batchable: false, reason: '该类请求必须逐次决定' }

function kindOf(approval: ApprovalView): NonNullable<ApprovalView['kind']> {
  return approval.kind ?? FALLBACK_KIND
}

function requestOf(approval: ApprovalView | null): { toolName: string; path: string | null; command: string | null } {
  const request = (approval?.request ?? {}) as { toolName?: unknown; args?: Record<string, unknown> }
  const args = request.args ?? {}
  return {
    toolName: typeof request.toolName === 'string' ? request.toolName : 'tool',
    path: typeof args.path === 'string' ? args.path : null,
    command: typeof args.command === 'string' ? args.command : null,
  }
}

function targetOf(approval: ApprovalView): string {
  const { path, command, toolName } = requestOf(approval)
  return path ?? command ?? toolName
}

function KindGlyph({ approval, size = 14 }: { approval: ApprovalView; size?: number }): ReactElement {
  const key = kindOf(approval).key
  if (key.startsWith('command')) return <SquareTerminal size={size} />
  if (key.startsWith('git')) return <GitBranch size={size} />
  if (!kindOf(approval).batchable) return <ShieldAlert size={size} />
  return <FilePen size={size} />
}

function remaining(expiresAt: number | null | undefined): string | null {
  if (!expiresAt) return null
  const minutes = Math.round((expiresAt - Date.now()) / 60_000)
  if (minutes <= 0) return '已到期'
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分后到期` : `${minutes} 分钟后到期`
}

export function StudioReviewRoom(): ReactElement {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const reduceMotion = useReducedMotion()
  const returnRequirement = searchParams.get('requirement')
  const returnPath = returnRequirement ? `/projects/${projectId}/requirements?requirement=${encodeURIComponent(returnRequirement)}` : `/projects/${projectId}/agents`
  const returnLabel = returnRequirement ? '返回需求工作台' : '返回协作图'
  const queryClient = useQueryClient()
  const theme = useResolvedTheme()
  const approvals = useApprovals(projectId)
  const list = useMemo(() => (approvals.data?.approvals ?? []).filter((approval) => approval.status === 'pending'), [approvals.data])
  const delivery = useQuery({
    queryKey: ['release-approvals', projectId],
    queryFn: () => window.projectos.release.approvals(projectId),
    enabled: Boolean(projectId),
  })
  const deliveryPending = (delivery.data?.approvals ?? []).filter((approval) => approval.status === 'pending').length
  const deepLinkId = searchParams.get('approval')
  const lens: Lens = useMemo(() => {
    const requested = searchParams.get('lens')
    if (requested === 'delivery' || requested === 'history' || requested === 'pending') return requested
    if (deepLinkId) {
      const deliveryMatch = delivery.data?.approvals.find((approval) => approval.id === deepLinkId)
      if (deliveryMatch) return deliveryMatch.status === 'pending' ? 'delivery' : 'history'
      const toolMatch = approvals.data?.approvals.find((approval) => approval.id === deepLinkId)
      if (toolMatch && toolMatch.status !== 'pending') return 'history'
    }
    return 'pending'
  }, [searchParams, deepLinkId, delivery.data, approvals.data])
  const setLens = (next: Lens): void => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current)
      params.set('lens', next)
      params.delete('approval')
      return params
    }, { replace: true })
  }
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>()
    for (const approval of list) {
      const kind = kindOf(approval)
      const group = map.get(kind.key) ?? { ...kind, items: [] }
      group.items.push(approval)
      map.set(kind.key, group)
    }
    return [...map.values()].sort((a, b) => Number(b.batchable) - Number(a.batchable))
  }, [list])
  const ordered = useMemo(() => groups.flatMap((group) => group.items), [groups])

  const [focusId, setFocusId] = useState<string | null>(() => searchParams.get('approval'))
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [note, setNote] = useState('')
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null)
  const [view, setView] = useState<'diff' | 'raw'>('diff')

  useEffect(() => {
    if (focusId && list.some((approval) => approval.id === focusId)) return
    setFocusId(ordered[0]?.id ?? null)
  }, [list, ordered, focusId])
  useEffect(() => {
    setChecked((current) => {
      const next = new Set([...current].filter((id) => list.some((approval) => approval.id === id)))
      return next.size === current.size ? current : next
    })
  }, [list])

  const focused = list.find((approval) => approval.id === focusId) ?? ordered[0] ?? null
  const focusedKind = focused ? kindOf(focused) : null
  const sameKind = useMemo(
    () => (focused ? list.filter((approval) => approval.runId === focused.runId && kindOf(approval).key === kindOf(focused).key) : []),
    [focused, list],
  )

  useEffect(() => {
    setConfirm((current) => (current?.mode === 'batch' ? current : null))
    setNote('')
    setVerified(false)
    setError(null)
    setView('diff')
  }, [focused?.id])

  const preview = useQuery({
    queryKey: ['approval-preview', focused?.id ?? ''],
    queryFn: () => window.projectos.approvals.preview(focused!.id),
    enabled: Boolean(focused),
    staleTime: 15_000,
  })
  const diff = useMemo(() => {
    const data = preview.data
    if (!data || data.after === null) return null
    return lineDiff(data.before ?? '', data.after)
  }, [preview.data])
  const stats = diff ? diffStats(diff) : null

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.approvals(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.collaborationOverview(projectId) }),
      queryClient.invalidateQueries({ queryKey: ['action-center', projectId] }),
    ])
  }

  const summarize = (result: ApprovalBatchResult): { text: string; tone: 'ok' | 'warn' } => {
    const parts = [
      result.approved ? `已批准 ${result.approved}` : '',
      result.rejected ? `已拒绝 ${result.rejected}` : '',
      result.skipped ? `跳过 ${result.skipped}` : '',
      result.failed ? `失败 ${result.failed}` : '',
    ].filter(Boolean)
    const remembered = result.rememberedKind ? ` · 本 Run 内「${result.rememberedKind.label}」自动放行` : ''
    const firstProblem = result.outcomes.find((entry) => entry.status === 'failed') ?? result.outcomes.find((entry) => entry.status === 'skipped')
    const problem = firstProblem ? `（${firstProblem.reason}）` : ''
    return { text: `${parts.join(' · ') || '没有可处理的请求'}${problem}${remembered}`, tone: result.failed || result.skipped ? 'warn' : 'ok' }
  }

  const run = async (task: () => Promise<{ text: string; tone: 'ok' | 'warn' } | null>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setOutcome(await task())
      setConfirm(null)
      setNote('')
      setVerified(false)
      await refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const decideSingle = (decision: Decision): Promise<void> => run(async () => {
    if (!focused) return null
    await window.projectos.approvals.decide({ approvalId: focused.id, decision, note: note.trim() })
    return { text: decision === 'approved' ? `已允许：${targetOf(focused)}` : `已拒绝：${targetOf(focused)}`, tone: 'ok' }
  })
  const decideKind = (): Promise<void> => run(async () => {
    if (!focused) return null
    const result = await window.projectos.approvals.decideBatch({ projectId, decision: 'approved', note: note.trim(), sameKindAs: focused.id, rememberForRun: true })
    return summarize(result)
  })
  const decideChecked = (decision: Decision): Promise<void> => run(async () => {
    const ids = [...checked]
    const result = await window.projectos.approvals.decideBatch({ projectId, decision, note: note.trim(), approvalIds: ids, rememberForRun: false })
    setChecked(new Set())
    return summarize(result)
  })

  useEffect(() => {
    if (!outcome) return
    const timer = window.setTimeout(() => setOutcome(null), outcome.tone === 'ok' ? 5200 : 12000)
    return () => window.clearTimeout(timer)
  }, [outcome])

  const toggle = useCallback((approval: ApprovalView): void => {
    if (!kindOf(approval).batchable) return
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(approval.id)) next.delete(approval.id)
      else next.add(approval.id)
      return next
    })
  }, [])
  const toggleGroup = (group: Group): void => {
    if (!group.batchable) return
    setChecked((current) => {
      const next = new Set(current)
      const all = group.items.every((item) => next.has(item.id))
      for (const item of group.items) {
        if (all) next.delete(item.id)
        else next.add(item.id)
      }
      return next
    })
  }

  useEffect(() => {
    if (lens !== 'pending') return
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const index = ordered.findIndex((approval) => approval.id === focused?.id)
      if (event.key === 'j' || event.key === 'ArrowDown') {
        const next = ordered[Math.min(ordered.length - 1, index + 1)]
        if (next) { setFocusId(next.id); event.preventDefault() }
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        const next = ordered[Math.max(0, index - 1)]
        if (next) { setFocusId(next.id); event.preventDefault() }
      } else if (event.key === 'x' && focused) {
        toggle(focused)
        event.preventDefault()
      } else if (event.key === 'Escape' && checked.size) {
        setChecked(new Set())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ordered, focused, toggle, checked.size, lens])

  const checkedItems = list.filter((approval) => checked.has(approval.id))
  const checkedByKind = Object.entries(
    checkedItems.reduce<Record<string, number>>((acc, approval) => {
      const label = kindOf(approval).label
      acc[label] = (acc[label] ?? 0) + 1
      return acc
    }, {}),
  )
  const workspace = preview.data?.workspace
  const request = requestOf(focused)
  const isCommand = Boolean(request.command)
  const newFile = preview.data ? preview.data.before === null && preview.data.after !== null : false
  const expiry = remaining(focused?.expiresAt)
  const motionProps = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 18, scale: 0.98 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 14, scale: 0.98 }, transition: { type: 'spring' as const, stiffness: 420, damping: 34 } }

  return (
    <div className={`studio-review studio-theme rv-room ${checked.size || outcome ? 'has-dock' : ''}`} data-theme={theme}>
      <header className="rv-masthead">
        <button type="button" className="studio-back" onClick={() => navigate(returnPath)}><ArrowLeft size={14} /> {returnLabel}</button>
        <div className="rv-title">
          <h1>审阅与决策</h1>
          {lens === 'pending' && list.length ? (
            <div className="rv-spectrum" aria-label={`${list.length} 项待处理`}>
              {groups.map((group) => (
                <span key={group.key} className={`rv-spectrum-seg ${group.batchable ? 'is-batch' : 'is-solo'}`} style={{ flexGrow: group.items.length }} title={`${group.label} ${group.items.length}`} />
              ))}
            </div>
          ) : null}
          {lens === 'pending' ? <span className="rv-count">{list.length ? `${list.length} 项待处理 · ${groups.length} 类` : '队列已清空'}</span> : null}
        </div>
        <div className="rv-lenses" role="tablist" aria-label="审阅视图">
          {([
            ['pending', '工具请求', list.length],
            ['delivery', '交付审批', deliveryPending],
            ['history', '记录', null],
          ] as Array<[Lens, string, number | null]>).map(([key, label, count]) => (
            <button key={key} type="button" role="tab" aria-selected={lens === key} onClick={() => setLens(key)}>
              {label}{count ? <b>{count}</b> : null}
            </button>
          ))}
        </div>
      </header>

      {lens === 'delivery' ? (
        delivery.isError ? (
          <div className="studio-empty"><CircleAlert size={20} /><h2>交付审批读取失败</h2><p>{errorMessage(delivery.error)}</p></div>
        ) : delivery.isLoading ? (
          <div className="studio-loading">正在读取交付审批…</div>
        ) : (
          <DeliveryLens projectId={projectId} approvals={delivery.data?.approvals ?? []} initialId={deepLinkId} />
        )
      ) : lens === 'history' ? (
        approvals.isLoading || delivery.isLoading ? (
          <div className="studio-loading">正在读取审批记录…</div>
        ) : (
          <HistoryLens tool={approvals.data?.approvals ?? []} delivery={delivery.data?.approvals ?? []} initialId={deepLinkId} />
        )
      ) : approvals.isError ? (
        <div className="studio-empty"><CircleAlert size={20} /><h2>审批读取失败</h2><p>{errorMessage(approvals.error)}</p></div>
      ) : approvals.isLoading ? (
        <div className="studio-loading">正在读取审批…</div>
      ) : list.length === 0 ? (
        <div className="rv-clear">
          <div className="rv-clear-orbit" aria-hidden><span /><span /><CheckCheck size={26} /></div>
          <h2>没有等待处理的审批</h2>
          {outcome ? <p className={`rv-clear-outcome is-${outcome.tone}`}>{outcome.text}</p> : null}
          <div className="rv-clear-links">
            {deliveryPending ? <button type="button" className="studio-cta" onClick={() => setLens('delivery')}>处理 {deliveryPending} 项交付审批 <ArrowRight size={13} /></button> : null}
            <button type="button" className={deliveryPending ? 'studio-ghost' : 'studio-cta'} onClick={() => navigate(returnPath)}>{returnRequirement ? '继续需求开发' : '回到协作图'} <ArrowRight size={13} /></button>
            <button type="button" className="studio-ghost" onClick={() => setLens('history')}>查看记录</button>
          </div>
          <div className="rv-clear-policy"><WorktreeAutoAllowControl projectId={projectId} compact /></div>
        </div>
      ) : (
        <div className="rv-layout">
          <nav className="rv-queue" aria-label="待处理请求">
            {groups.map((group) => {
              const all = group.batchable && group.items.every((item) => checked.has(item.id))
              const some = group.batchable && group.items.some((item) => checked.has(item.id))
              return (
                <section key={group.key} className={`rv-group ${group.batchable ? '' : 'is-solo'}`}>
                  <header>
                    {group.batchable ? (
                      <button
                        type="button"
                        className={`rv-check ${all ? 'is-on' : some ? 'is-mixed' : ''}`}
                        role="checkbox"
                        aria-checked={all ? true : some ? 'mixed' : false}
                        aria-label={`选择全部「${group.label}」`}
                        onClick={() => toggleGroup(group)}
                      >
                        {all ? <Check size={11} strokeWidth={3} /> : some ? <span className="rv-check-dash" /> : null}
                      </button>
                    ) : (
                      <span className="rv-lock" title={group.reason}><Lock size={11} /></span>
                    )}
                    <strong>{group.label}</strong>
                    <em>{group.items.length}</em>
                  </header>
                  <ul>
                    {group.items.map((approval) => {
                      const isFocus = approval.id === focused?.id
                      const isChecked = checked.has(approval.id)
                      return (
                        <li key={approval.id} className={`${isFocus ? 'is-focus' : ''} ${isChecked ? 'is-checked' : ''}`}>
                          {group.batchable ? (
                            <button
                              type="button"
                              className={`rv-check ${isChecked ? 'is-on' : ''}`}
                              role="checkbox"
                              aria-checked={isChecked}
                              aria-label={`选择 ${targetOf(approval)}`}
                              onClick={() => toggle(approval)}
                            >
                              {isChecked ? <Check size={11} strokeWidth={3} /> : null}
                            </button>
                          ) : (
                            <span className="rv-item-glyph" aria-hidden><KindGlyph approval={approval} size={12} /></span>
                          )}
                          <button type="button" className="rv-item" aria-current={isFocus ? 'true' : undefined} onClick={() => setFocusId(approval.id)}>
                            <span className="rv-item-target">{targetOf(approval)}</span>
                            <small>{approval.agentName} · {formatRelative(approval.requestedAt)}</small>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
            <footer className="rv-keys" aria-hidden>
              <span><kbd>J</kbd><kbd>K</kbd> 切换</span>
              <span><kbd>X</kbd> 选择</span>
              <span><kbd>Esc</kbd> 清除</span>
            </footer>
          </nav>

          {focused && focusedKind ? (
            <article className="rv-sheet" aria-label="请求详情">
              <header className="rv-sheet-head">
                <span className={`rv-kind ${focusedKind.batchable ? '' : 'is-solo'}`}><KindGlyph approval={focused} size={13} />{focusedKind.label}</span>
                {workspace ? (
                  <span className={`rv-ws ${workspace.isolated ? 'is-isolated' : 'is-main'}`} title={workspace.reason}>
                    {workspace.isolated ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
                    {workspace.label}
                  </span>
                ) : null}
                {expiry ? <span className="rv-expiry">{expiry}</span> : null}
              </header>
              <h2 className="rv-target">
                {isCommand ? <span className="rv-prompt">$</span> : newFile ? <FilePlus2 size={20} /> : <FilePen size={20} />}
                <span>{targetOf(focused)}</span>
              </h2>
              <p className="rv-byline">
                <strong>{focused.agentName}</strong>
                <span>{focused.taskTitle ?? '未关联任务'}</span>
                <button type="button" className="studio-link" onClick={() => navigate(`/projects/${projectId}/runs?run=${focused.runId}`)}>Run {focused.runId.slice(-6)} <ArrowRight size={11} /></button>
              </p>

              <div className="rv-evidence">
                <div className="rv-evidence-bar">
                  <div className="rv-tabs" role="tablist">
                    <button type="button" role="tab" aria-selected={view === 'diff'} onClick={() => setView('diff')}>{isCommand ? '命令' : newFile ? '新文件' : '改动'}</button>
                    <button type="button" role="tab" aria-selected={view === 'raw'} onClick={() => setView('raw')}>原始请求</button>
                  </div>
                  {stats && view === 'diff' ? (
                    <span className="rv-stats"><b className="is-add">+{stats.added}</b><b className="is-del">−{stats.removed}</b></span>
                  ) : null}
                </div>
                {view === 'raw' ? (
                  <pre className="rv-raw">{JSON.stringify(focused.request, null, 2).slice(0, 12000)}</pre>
                ) : preview.isLoading ? (
                  <div className="rv-evidence-wait">正在读取 Run 工作区…</div>
                ) : preview.isError ? (
                  <div className="rv-evidence-wait is-error">{errorMessage(preview.error)}</div>
                ) : isCommand ? (
                  <div className="rv-terminal">
                    <div className="rv-terminal-line"><span className="rv-prompt">$</span><code>{request.command}</code></div>
                    <dl className="rv-facts">
                      <div><dt>分类</dt><dd>{focusedKind.label}</dd></div>
                      <div><dt>工作区</dt><dd>{workspace?.label ?? '读取中'}</dd></div>
                      <div><dt>放行方式</dt><dd>{focusedKind.batchable ? '可在本 Run 内同类放行' : '必须逐次决定'}</dd></div>
                    </dl>
                  </div>
                ) : diff ? (
                  <ReviewDiff lines={diff} label={`${request.path ?? ''} 的改动`} />
                ) : (
                  <div className="rv-evidence-wait">该请求没有可预览的内容</div>
                )}
              </div>

              {!focusedKind.batchable ? (
                <p className="rv-why"><Lock size={12} />{focusedKind.reason}</p>
              ) : workspace && !workspace.isolated ? (
                <p className="rv-why"><ShieldAlert size={12} />{workspace.reason}</p>
              ) : null}
            </article>
          ) : null}

          {focused && focusedKind ? (
            <aside className="rv-rail" aria-label="审批决策">
              <AnimatePresence mode="wait" initial={false}>
                {confirm?.mode === 'single' || confirm?.mode === 'kind' ? (
                  <motion.div key="confirm" className="rv-confirm" {...(reduceMotion ? {} : { initial: { opacity: 0, x: 10 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -10 }, transition: { duration: 0.16 } })}>
                    <strong>
                      {confirm.mode === 'kind'
                        ? `批准本 Run 内 ${sameKind.length} 项「${focusedKind.label}」`
                        : confirm.decision === 'approved' ? '允许这一项' : '拒绝这一项'}
                    </strong>
                    {confirm.mode === 'kind' ? (
                      <ul className="rv-confirm-list">
                        {sameKind.slice(0, 5).map((approval) => <li key={approval.id}>{targetOf(approval)}</li>)}
                        {sameKind.length > 5 ? <li>另外 {sameKind.length - 5} 项</li> : null}
                        <li className="is-note">此后本 Run 同类请求自动放行（最长 8 小时）</li>
                      </ul>
                    ) : null}
                    <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="审计备注（可选）" rows={2} maxLength={2000} />
                    {confirm.mode === 'kind' || confirm.decision === 'approved' ? (
                      <label className="rv-verify">
                        <input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />
                        <span>已核对目标、内容与工作区</span>
                      </label>
                    ) : null}
                    {error ? <div className="studio-error" role="alert">{error}</div> : null}
                    <div className="rv-confirm-actions">
                      <button type="button" className="studio-ghost" disabled={busy} onClick={() => setConfirm(null)}>返回</button>
                      <button
                        type="button"
                        className={confirm.mode === 'single' && confirm.decision === 'rejected' ? 'studio-danger is-solid' : 'studio-cta'}
                        disabled={busy || ((confirm.mode === 'kind' || confirm.decision === 'approved') && !verified)}
                        onClick={() => void (confirm.mode === 'kind' ? decideKind() : decideSingle(confirm.decision))}
                      >
                        {busy ? '提交中…' : confirm.mode === 'kind' ? `批准 ${sameKind.length} 项` : confirm.decision === 'approved' ? '确认允许' : '确认拒绝'}
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="actions" className="rv-actions" {...(reduceMotion ? {} : { initial: { opacity: 0, x: -10 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 10 }, transition: { duration: 0.16 } })}>
                    <button type="button" className="rv-primary" onClick={() => setConfirm({ mode: 'single', decision: 'approved' })}>
                      <CheckCircle2 size={16} /><span>允许这一项</span>
                    </button>
                    {focusedKind.batchable && sameKind.length > 1 ? (
                      <button type="button" className="rv-kind-action" onClick={() => setConfirm({ mode: 'kind' })}>
                        <span className="rv-stack" aria-hidden>{sameKind.slice(0, 4).map((approval) => <i key={approval.id} />)}</span>
                        <span><strong>本 Run 同类全部放行</strong><small>{sameKind.length} 项「{focusedKind.label}」</small></span>
                      </button>
                    ) : null}
                    <button type="button" className="rv-reject" onClick={() => setConfirm({ mode: 'single', decision: 'rejected' })}>
                      <X size={14} />拒绝
                    </button>
                    {error ? <div className="studio-error" role="alert">{error}</div> : null}
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="rv-rail-policy">
                <WorktreeAutoAllowControl projectId={projectId} />
              </div>
            </aside>
          ) : null}
        </div>
      )}

      <AnimatePresence>
        {lens === 'pending' && checked.size > 0 && list.length > 0 ? (
          <motion.div key="dock" className="rv-dock" role="region" aria-label="批量审批" {...motionProps}>
            <span className="rv-dock-count"><b>{checked.size}</b>已选</span>
            <span className="rv-dock-kinds">{checkedByKind.map(([label, count]) => <span key={label}>{label} {count}</span>)}</span>
            {confirm?.mode === 'batch' ? (
              <>
                <input className="rv-dock-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="审计备注（可选）" maxLength={2000} aria-label="审计备注" />
                <button type="button" className="studio-ghost" disabled={busy} onClick={() => setConfirm(null)}>返回</button>
                <button type="button" className={confirm.decision === 'approved' ? 'studio-cta' : 'studio-danger is-solid'} disabled={busy} onClick={() => void decideChecked(confirm.decision)}>
                  {busy ? '提交中…' : confirm.decision === 'approved' ? `确认批准 ${checked.size} 项` : `确认拒绝 ${checked.size} 项`}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="rv-dock-clear" onClick={() => setChecked(new Set())} aria-label="清除选择"><X size={13} /></button>
                <button type="button" className="studio-danger" onClick={() => setConfirm({ mode: 'batch', decision: 'rejected' })}>拒绝所选</button>
                <button type="button" className="studio-cta" onClick={() => setConfirm({ mode: 'batch', decision: 'approved' })}><Check size={13} />批准所选</button>
              </>
            )}
            {error && confirm?.mode === 'batch' ? <span className="rv-dock-error" role="alert">{error}</span> : null}
          </motion.div>
        ) : lens === 'pending' && outcome && list.length > 0 ? (
          <motion.div key="outcome" className={`rv-dock is-outcome is-${outcome.tone}`} role="status" {...motionProps}>
            {outcome.tone === 'ok' ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}<span>{outcome.text}</span>
            <button type="button" className="rv-dock-clear" onClick={() => setOutcome(null)} aria-label="关闭"><X size={13} /></button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export default StudioReviewRoom
