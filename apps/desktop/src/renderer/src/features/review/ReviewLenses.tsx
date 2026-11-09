import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Activity, ArrowRight, CheckCircle2, Clock3, Quote, Terminal, UserRound, CircleAlert, CircleSlash, Fingerprint, PackageCheck, Rocket, Search, X } from 'lucide-react'
import type { ApprovalRequest, ApprovalView } from '@projectos/contracts'
import { errorMessage } from '../../lib/errors'
import { formatDateTime, formatDuration, formatRelative, formatTime } from '../../lib/format'
import { diffStats, lineDiff } from '../../lib/line-diff'
import { ReviewDiff } from './ReviewDiff'

/* ------------------------------------------------------------------ shared */

const TOOL_STATUS: Record<string, string> = { pending: '待处理', approved: '已批准', rejected: '已拒绝', expired: '已过期', cancelled: '已取消' }
const DELIVERY_STATUS: Record<string, string> = { pending: '待处理', approved: '已批准', rejected: '已拒绝', changes_requested: '要求修改', expired: '已过期', superseded: '已被取代' }

function tone(status: string): 'ok' | 'bad' | 'mute' | 'warn' {
  if (status === 'approved') return 'ok'
  if (status === 'rejected' || status === 'changes_requested') return 'bad'
  if (status === 'pending') return 'warn'
  return 'mute'
}

function subjectLabel(approval: ApprovalRequest): string {
  return approval.subjectType === 'change_request' ? '发布变更' : '部署'
}

function useListKeys(ids: string[], focus: string | null, setFocus: (id: string) => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const index = ids.indexOf(focus ?? '')
      const step = event.key === 'j' || event.key === 'ArrowDown' ? 1 : event.key === 'k' || event.key === 'ArrowUp' ? -1 : 0
      if (!step) return
      const next = ids[Math.min(ids.length - 1, Math.max(0, index + step))]
      if (next) { setFocus(next); event.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ids, focus, setFocus, enabled])
}

function dayLabel(timestamp: number): string {
  const day = new Date(timestamp)
  const today = new Date()
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diff = Math.round((start(today) - start(day)) / 86_400_000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  return `${day.getMonth() + 1} 月 ${day.getDate()} 日`
}

/* ------------------------------------------------------------------ delivery */

export function DeliveryLens({ projectId, approvals, initialId }: { projectId: string; approvals: ApprovalRequest[]; initialId: string | null }): ReactElement {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const reduceMotion = useReducedMotion()
  const pending = useMemo(() => approvals.filter((approval) => approval.status === 'pending'), [approvals])
  const [focusId, setFocusId] = useState<string | null>(initialId)
  const [confirm, setConfirm] = useState<'approved' | 'rejected' | null>(null)
  const [note, setNote] = useState('')
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const focused = pending.find((approval) => approval.id === focusId) ?? pending[0] ?? null
  useListKeys(pending.map((approval) => approval.id), focused?.id ?? null, setFocusId)
  useEffect(() => { setConfirm(null); setNote(''); setVerified(false); setError(null) }, [focused?.id])

  const decide = async (decision: 'approved' | 'rejected'): Promise<void> => {
    if (!focused || busy) return
    setBusy(true)
    setError(null)
    try {
      const text = note.trim() || (decision === 'approved' ? '审阅室批准' : '审阅室拒绝')
      await window.projectos.release.decideApproval({ approvalId: focused.id, decision, note: text, rationale: text })
      setOutcome(`${decision === 'approved' ? '已批准' : '已拒绝'}：${focused.subjectTitle ?? subjectLabel(focused)}`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['release-approvals', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['release-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['action-center', projectId] }),
      ])
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  if (!focused) {
    return (
      <div className="rv-clear">
        <div className="rv-clear-orbit is-calm" aria-hidden><PackageCheck size={26} /></div>
        <h2>没有待处理的交付审批</h2>
        <p className="rv-clear-hint">发布变更和部署在进入目标环境前需要你确认。当发布中心提交审核或部署需要放行时，会出现在这里。</p>
        {outcome ? <p className="rv-clear-outcome">{outcome}</p> : null}
        <div className="rv-clear-links">
          <button type="button" className="studio-ghost" onClick={() => navigate(`/projects/${projectId}/releases`)}><Rocket size={13} />发布中心</button>
          <button type="button" className="studio-ghost" onClick={() => navigate(`/projects/${projectId}/deployments`)}>部署中心 <ArrowRight size={13} /></button>
        </div>
      </div>
    )
  }

  return (
    <div className="rv-layout">
      <nav className="rv-queue" aria-label="交付审批">
        <section className="rv-group">
          <header><span className="rv-lock"><PackageCheck size={11} /></span><strong>交付审批</strong><em>{pending.length}</em></header>
          <ul>
            {pending.map((approval) => (
              <li key={approval.id} className={approval.id === focused.id ? 'is-focus' : ''}>
                <span className="rv-item-glyph" aria-hidden>{approval.subjectType === 'deployment' ? <Rocket size={12} /> : <PackageCheck size={12} />}</span>
                <button type="button" className="rv-item" aria-current={approval.id === focused.id ? 'true' : undefined} onClick={() => setFocusId(approval.id)}>
                  <span className="rv-item-target is-text">{approval.subjectTitle ?? subjectLabel(approval)}</span>
                  <small>{subjectLabel(approval)} · r{approval.subjectRevision} · {formatRelative(approval.requestedAt)}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </nav>

      <article className="rv-sheet" aria-label="交付审批详情">
        <header className="rv-sheet-head">
          <span className="rv-kind is-solo">{focused.subjectType === 'deployment' ? <Rocket size={13} /> : <PackageCheck size={13} />}{subjectLabel(focused)}</span>
          <span className="rv-ws is-isolated"><Fingerprint size={13} />内容已锁定</span>
          {focused.expiresAt ? <span className="rv-expiry">{formatDateTime(focused.expiresAt)} 到期</span> : null}
        </header>
        <h2 className="rv-target is-text">{focused.subjectTitle ?? subjectLabel(focused)}</h2>
        <p className="rv-byline"><strong>{focused.requestedBy}</strong><span>{formatDateTime(focused.requestedAt)}</span></p>
        <dl className="rv-ledger">
          <div><dt>对象</dt><dd>{subjectLabel(focused)}</dd></div>
          <div><dt>Revision</dt><dd className="is-mono">r{focused.subjectRevision}</dd></div>
          <div className="is-wide"><dt>内容指纹</dt><dd className="is-mono">{focused.contentFingerprint}</dd></div>
        </dl>
        <p className="rv-why is-info"><Fingerprint size={12} />批准只对这一 revision 与指纹生效；内容一旦变化，结论自动失效。</p>
      </article>

      <aside className="rv-rail" aria-label="交付决策">
        <AnimatePresence mode="wait" initial={false}>
          {confirm ? (
            <motion.div key="confirm" className="rv-confirm" {...(reduceMotion ? {} : { initial: { opacity: 0, x: 10 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -10 }, transition: { duration: 0.16 } })}>
              <strong>{confirm === 'approved' ? '批准这次交付' : '拒绝这次交付'}</strong>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="决策理由（写入审计）" rows={3} maxLength={4000} />
              {confirm === 'approved' ? (
                <label className="rv-verify"><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} /><span>已核对 revision 与内容指纹</span></label>
              ) : null}
              {error ? <div className="studio-error" role="alert">{error}</div> : null}
              <div className="rv-confirm-actions">
                <button type="button" className="studio-ghost" disabled={busy} onClick={() => setConfirm(null)}>返回</button>
                <button type="button" className={confirm === 'approved' ? 'studio-cta' : 'studio-danger is-solid'} disabled={busy || (confirm === 'approved' && !verified)} onClick={() => void decide(confirm)}>
                  {busy ? '提交中…' : confirm === 'approved' ? '确认批准' : '确认拒绝'}
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="actions" className="rv-actions" {...(reduceMotion ? {} : { initial: { opacity: 0, x: -10 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 10 }, transition: { duration: 0.16 } })}>
              <button type="button" className="rv-primary" onClick={() => setConfirm('approved')}><CheckCircle2 size={16} /><span>批准交付</span></button>
              <button type="button" className="rv-reject" onClick={() => setConfirm('rejected')}><X size={14} />拒绝</button>
              {outcome ? <p className="rv-rail-outcome">{outcome}</p> : null}
            </motion.div>
          )}
        </AnimatePresence>
        <p className="rv-rail-note">交付审批必须逐项决定</p>
      </aside>
    </div>
  )
}

/* ------------------------------------------------------------------ history */

type HistoryEntry =
  | { source: 'tool'; id: string; title: string; target: string; status: string; at: number; requestedAt: number; who: string; tool: ApprovalView }
  | { source: 'delivery'; id: string; title: string; target: string; status: string; at: number; requestedAt: number; who: string; delivery: ApprovalRequest }

const FILTERS: Array<{ key: 'all' | 'approved' | 'rejected' | 'other'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'approved', label: '批准' },
  { key: 'rejected', label: '拒绝' },
  { key: 'other', label: '过期' },
]

function toolTarget(approval: ApprovalView): string {
  const args = ((approval.request ?? {}) as { args?: Record<string, unknown> }).args ?? {}
  if (typeof args.path === 'string') return args.path
  if (typeof args.command === 'string') return args.command
  return approval.title
}

export function HistoryLens({ tool, delivery, initialId }: { tool: ApprovalView[]; delivery: ApprovalRequest[]; initialId: string | null }): ReactElement {
  const navigate = useNavigate()
  const { projectId = '' } = useParams<{ projectId: string }>()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all')
  const [source, setSource] = useState<'all' | 'tool' | 'delivery'>('all')
  const [view, setView] = useState<'diff' | 'raw'>('diff')
  const entries = useMemo<HistoryEntry[]>(() => {
    const fromTool: HistoryEntry[] = tool.filter((approval) => approval.status !== 'pending').map((approval) => ({
      source: 'tool', id: approval.id, title: approval.kind?.label ?? approval.title, target: toolTarget(approval), status: approval.status,
      at: approval.decidedAt ?? approval.requestedAt, requestedAt: approval.requestedAt, who: approval.agentName, tool: approval,
    }))
    const fromDelivery: HistoryEntry[] = delivery.filter((approval) => approval.status !== 'pending').map((approval) => ({
      source: 'delivery', id: approval.id, title: subjectLabel(approval), target: approval.subjectTitle ?? `${subjectLabel(approval)} r${approval.subjectRevision}`,
      status: approval.status, at: approval.decidedAt ?? approval.requestedAt, requestedAt: approval.requestedAt, who: approval.requestedBy, delivery: approval,
    }))
    return [...fromTool, ...fromDelivery].sort((a, b) => b.at - a.at)
  }, [tool, delivery])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (source !== 'all' && entry.source !== source) return false
      if (filter === 'approved' && entry.status !== 'approved') return false
      if (filter === 'rejected' && entry.status !== 'rejected' && entry.status !== 'changes_requested') return false
      if (filter === 'other' && ['approved', 'rejected', 'changes_requested'].includes(entry.status)) return false
      return !needle || `${entry.target} ${entry.title} ${entry.who}`.toLowerCase().includes(needle)
    })
  }, [entries, filter, query, source])
  const days = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>()
    for (const entry of visible) {
      const key = dayLabel(entry.at)
      map.set(key, [...(map.get(key) ?? []), entry])
    }
    return [...map.entries()]
  }, [visible])
  const [focusId, setFocusId] = useState<string | null>(initialId)
  const focused = visible.find((entry) => entry.id === focusId) ?? visible[0] ?? null
  useListKeys(visible.map((entry) => entry.id), focused?.id ?? null, setFocusId)
  const focusedTool = focused?.source === 'tool' ? focused.tool : null
  const preview = useQuery({
    queryKey: ['approval-preview', focusedTool?.id ?? ''],
    queryFn: () => window.projectos.approvals.preview(focusedTool!.id),
    enabled: Boolean(focusedTool),
    staleTime: 60_000,
    retry: false,
  })
  const diff = useMemo(() => {
    const data = preview.data
    if (!data || data.after === null) return null
    return lineDiff(data.before ?? '', data.after)
  }, [preview.data])
  const stats = diff ? diffStats(diff) : null
  const counts = useMemo(() => ({
    all: entries.length,
    approved: entries.filter((entry) => entry.status === 'approved').length,
    rejected: entries.filter((entry) => entry.status === 'rejected' || entry.status === 'changes_requested').length,
    other: entries.filter((entry) => !['approved', 'rejected', 'changes_requested'].includes(entry.status)).length,
  }), [entries])
  const decidedWaits = entries.filter((entry) => entry.at > entry.requestedAt && (entry.status === 'approved' || entry.status === 'rejected' || entry.status === 'changes_requested')).map((entry) => entry.at - entry.requestedAt)
  const medianWait = decidedWaits.length ? [...decidedWaits].sort((a, b) => a - b)[Math.floor(decidedWaits.length / 2)]! : null

  if (entries.length === 0) {
    return (
      <div className="rv-clear">
        <div className="rv-clear-orbit is-calm" aria-hidden><CircleSlash size={26} /></div>
        <h2>还没有审批记录</h2>
        <p className="rv-clear-hint">批准或拒绝过的工具请求、交付审批都会按时间沉淀在这里，附带决定理由和耗时，方便事后追溯。</p>
        <div className="rv-clear-links">
          <button type="button" className="studio-ghost" onClick={() => navigate(`/projects/${projectId}/runs`)}><Activity size={13} />查看运行审计</button>
        </div>
      </div>
    )
  }

  const noteOf = (entry: HistoryEntry): string | null => {
    const raw = entry.source === 'tool' ? entry.tool.decision : entry.delivery.decisionNote
    return raw && raw.trim() && raw !== '审批已过期' ? raw.trim() : null
  }
  const statusText = (entry: HistoryEntry): string => (entry.source === 'tool' ? TOOL_STATUS : DELIVERY_STATUS)[entry.status] ?? entry.status
  const request = focused?.source === 'tool' ? focused.tool.request : null

  return (
    <div className="rv-layout is-history">
      <nav className="rv-queue" aria-label="审批记录">
        <div className="rv-hist-summary" aria-label="审批概况">
          <div><b>{entries.length}</b><small>次决定</small></div>
          <div><b className="is-ok">{counts.all ? Math.round((counts.approved / counts.all) * 100) : 0}%</b><small>批准</small></div>
          <div><b>{medianWait ? formatDuration(1, 1 + medianWait) : '—'}</b><small>决定用时中位</small></div>
        </div>
        <div className="rv-search">
          <Search size={13} aria-hidden />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索路径、命令或 Agent" aria-label="搜索审批记录" />
        </div>
        <div className="rv-filters" role="group" aria-label="按结论筛选">
          {FILTERS.map((entry) => (
            <button key={entry.key} type="button" aria-pressed={filter === entry.key} onClick={() => setFilter(entry.key)}>{entry.label}{counts[entry.key] ? <span className="rv-filter-count">{counts[entry.key]}</span> : null}</button>
          ))}
        </div>
        <div className="rv-source" role="group" aria-label="按来源筛选">
          {([['all', '全部来源'], ['tool', '工具请求'], ['delivery', '交付审批']] as const).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={source === key} onClick={() => setSource(key)}>{label}</button>
          ))}
        </div>
        {days.length === 0 ? <p className="rv-queue-empty">没有匹配的记录</p> : null}
        {days.map(([day, list]) => (
          <section key={day} className="rv-group is-day">
            <header><strong>{day}</strong><em>{list.length}</em></header>
            <ul>
              {list.map((entry) => (
                <li key={entry.id} className={entry.id === focused?.id ? 'is-focus' : ''}>
                  <span className={`rv-status-dot is-${tone(entry.status)}`} aria-label={statusText(entry)} />
                  <button type="button" className="rv-item rv-hist-item" aria-current={entry.id === focused?.id ? 'true' : undefined} onClick={() => { setFocusId(entry.id); setView('diff') }}>
                    <span className="rv-hist-line">
                      <span className={`rv-item-target ${entry.source === 'delivery' ? 'is-text' : ''}`}>{entry.target}</span>
                      <time>{formatTime(entry.at)}</time>
                    </span>
                    <small><span className={`rv-hist-verdict is-${tone(entry.status)}`}>{statusText(entry)}</span> · {entry.title} · {entry.who}{entry.at > entry.requestedAt ? ` · ${formatDuration(entry.requestedAt, entry.at)}` : ''}</small>
                    {noteOf(entry) ? <span className="rv-hist-note">{noteOf(entry)}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>

      {focused ? (
        <article className="rv-sheet" aria-label="审批记录详情">
          <header className="rv-sheet-head">
            <span className={`rv-verdict is-${tone(focused.status)}`}>
              {tone(focused.status) === 'ok' ? <CheckCircle2 size={13} /> : tone(focused.status) === 'bad' ? <X size={13} /> : <CircleAlert size={13} />}
              {statusText(focused)}
            </span>
            <span className="rv-kind">{focused.title}</span>
            <span className="rv-expiry">{formatDateTime(focused.at)}</span>
          </header>
          <h2 className={`rv-target ${focused.source === 'delivery' ? 'is-text' : ''}`}>{focused.target}</h2>
          <p className="rv-byline">
            <span className="rv-by"><UserRound size={12} />{focused.source === 'tool' ? focused.who : focused.delivery.requestedBy} 发起</span>
            <span className="rv-by"><CheckCircle2 size={12} />{focused.source === 'delivery' ? focused.delivery.decidedBy ?? '你' : focused.status === 'expired' ? '系统' : '你'} 决定</span>
            {focused.at > focused.requestedAt ? <span className="rv-by"><Clock3 size={12} />用时 {formatDuration(focused.requestedAt, focused.at)}</span> : null}
            {focused.source === 'tool' && focused.tool.taskTitle ? <span>{focused.tool.taskTitle}</span> : null}
          </p>
          {noteOf(focused) ? (
            <blockquote className={`rv-reason is-${tone(focused.status)}`}><Quote size={13} aria-hidden /><p>{noteOf(focused)}</p></blockquote>
          ) : null}
          <ol className="rv-trail" aria-label="决策经过">
            <li><span className="rv-trail-dot" /><div><strong>{focused.source === 'tool' ? `${focused.who} 发起请求` : `${focused.who} 提交审批`}</strong><small>{formatDateTime(focused.requestedAt)}</small></div></li>
            <li className={`is-${tone(focused.status)}`}><span className="rv-trail-dot" /><div>
              <strong>{statusText(focused)}</strong>
              <small>{focused.at !== focused.requestedAt ? `${formatDateTime(focused.at)} · 用时 ${formatDuration(focused.requestedAt, focused.at)}` : formatDateTime(focused.at)}</small>
            </div></li>
          </ol>
          {focused.source === 'delivery' ? (
            <dl className="rv-ledger">
              <div><dt>对象</dt><dd>{subjectLabel(focused.delivery)}</dd></div>
              <div><dt>Revision</dt><dd className="is-mono">r{focused.delivery.subjectRevision}</dd></div>
              <div className="is-wide"><dt>内容指纹</dt><dd className="is-mono">{focused.delivery.contentFingerprint}</dd></div>
            </dl>
          ) : (
            <div className="rv-evidence">
              <div className="rv-evidence-bar">
                <div className="rv-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={view === 'diff'} onClick={() => setView('diff')}>{preview.data?.command ? '命令' : '改动'}</button>
                  <button type="button" role="tab" aria-selected={view === 'raw'} onClick={() => setView('raw')}>原始请求</button>
                </div>
                {stats && view === 'diff' ? <span className="rv-stats"><b className="is-add">+{stats.added}</b><b className="is-del">−{stats.removed}</b></span> : null}
              </div>
              {view === 'raw' ? (
                <pre className="rv-raw">{JSON.stringify(request, null, 2).slice(0, 12000)}</pre>
              ) : preview.isLoading ? (
                <div className="rv-evidence-wait">正在读取请求内容…</div>
              ) : preview.data?.command ? (
                <div className="rv-terminal"><div className="rv-terminal-line"><span className="rv-prompt"><Terminal size={13} /></span><code>{preview.data.command}</code></div></div>
              ) : diff && stats && (stats.added > 0 || stats.removed > 0) ? (
                <ReviewDiff lines={diff} label={`${focused.target} 的改动`} />
              ) : diff ? (
                <div className="rv-evidence-wait">工作区内容已与请求一致（改动已写入）</div>
              ) : (
                <div className="rv-evidence-wait">{preview.isError ? '运行工作区已不可读，可查看原始请求' : '该请求没有可预览的内容'}</div>
              )}
            </div>
          )}
        </article>
      ) : null}
    </div>
  )
}
