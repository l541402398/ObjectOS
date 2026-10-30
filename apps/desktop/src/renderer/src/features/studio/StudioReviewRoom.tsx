import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileDiff,
  ShieldAlert,
  Terminal,
} from 'lucide-react'
import { useResolvedTheme } from '../../stores/ui'
import { errorMessage } from '../../lib/errors'
import { formatDateTime, formatRelative } from '../../lib/format'
import { qk, useApprovals } from '../../lib/queries'
import './studio.css'

type Decision = 'approved' | 'rejected'

export function StudioReviewRoom(): ReactElement {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const theme = useResolvedTheme()
  const approvals = useApprovals(projectId)
  const list = useMemo(() => (approvals.data?.approvals ?? []).filter((approval) => approval.status === 'pending'), [approvals.data])
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('approval'))
  const [decision, setDecision] = useState<Decision | null>(null)
  const [note, setNote] = useState('')
  const [riskAccepted, setRiskAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    if (selectedId && list.some((approval) => approval.id === selectedId)) return
    setSelectedId(list[0]?.id ?? null)
  }, [list, selectedId])

  const selected = list.find((approval) => approval.id === selectedId) ?? list[0] ?? null

  useEffect(() => {
    setDecision(null)
    setNote('')
    setRiskAccepted(false)
    setError(null)
    setResult(null)
  }, [selected?.id])

  const decide = async (value: Decision): Promise<void> => {
    if (!selected || busy) return
    if (value === 'approved' && !riskAccepted) {
      setError('请先确认本次授权的实际范围。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await window.projectos.approvals.decide({ approvalId: selected.id, decision: value, note: note.trim() })
      await queryClient.invalidateQueries({ queryKey: qk.approvals(projectId) })
      await queryClient.invalidateQueries({ queryKey: qk.collaborationOverview(projectId) })
      setResult(value === 'approved' ? '已允许本次执行。服务端已记录审批事实。' : '已拒绝本次执行。Run 不会继续此工具。')
      setDecision(null)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const request = selected?.request as { args?: Record<string, unknown>; toolName?: string; risk?: string; reason?: string } | undefined
  const args = request?.args ?? {}
  const filePath = typeof args.path === 'string' ? args.path : null
  const fileContent = typeof args.content === 'string' ? args.content : null
  const command = typeof args.command === 'string' ? args.command : null

  return (
    <div className="studio-review studio-theme" data-theme={theme}>
      <header className="studio-review-masthead">
        <button type="button" className="studio-back" onClick={() => navigate(`/projects/${projectId}/agents`)}><ArrowLeft size={14} /> 返回协作图</button>
        <div>
          <span className="studio-eyebrow">REVIEW ROOM / APPROVALS</span>
          <h1>审阅与决策</h1>
        </div>
        <div className="studio-review-masthead-meta">
          <span>{list.length} 项待处理</span>
          <button type="button" className="studio-ghost" onClick={() => navigate(`/projects/${projectId}/approvals/center`)}>专业审批中心</button>
        </div>
      </header>

      {approvals.isError ? (
        <div className="studio-empty"><CircleAlert size={20} /><h2>审批读取失败</h2><p>{errorMessage(approvals.error)}</p></div>
      ) : list.length === 0 ? (
        <div className="studio-empty">
          <CheckCircle2 size={24} />
          <h2>没有等待处理的审批</h2>
          <p>当真实 Run 请求工具、写入或命令授权时，会出现在这里。</p>
          <button type="button" className="studio-cta" onClick={() => navigate(`/projects/${projectId}/agents`)}>回到协作图</button>
        </div>
      ) : (
        <div className="studio-review-layout">
          <aside className="studio-review-index" aria-label="待处理请求">
            <span className="studio-kicker">QUEUE</span>
            <div className="studio-review-queue">
              {list.map((approval) => (
                <button
                  key={approval.id}
                  type="button"
                  className={approval.id === selected?.id ? 'is-active' : ''}
                  onClick={() => setSelectedId(approval.id)}
                >
                  <span className="studio-review-queue-icon"><ShieldAlert size={14} /></span>
                  <span><strong>{approval.title}</strong><small>{approval.agentName} · {formatRelative(approval.requestedAt)}</small></span>
                </button>
              ))}
            </div>
            <div className="studio-review-index-note">
              <Clock3 size={13} /> 队列与状态来自持久化审批事实，不缓存“已批准”假象。
            </div>
          </aside>

          <article className="studio-review-document">
            {selected ? (
              <>
                <div className="studio-document-head">
                  <span className={`studio-pill ${selected.status === 'pending' ? 'is-warn' : 'is-ok'}`}>{selected.status === 'pending' ? '等待决定' : '已处理'}</span>
                  <span className="studio-mono">{selected.id}</span>
                </div>
                <h2>{selected.title}</h2>
                <p className="studio-document-lede">{selected.detail || '该请求没有附加说明。请先核对实际参数与影响范围。'}</p>

                <dl className="studio-document-meta">
                  <div><dt>请求方</dt><dd>{selected.agentName}</dd></div>
                  <div><dt>任务</dt><dd>{selected.taskTitle ?? '未关联任务'}</dd></div>
                  <div><dt>Run</dt><dd className="studio-mono">{selected.runId}</dd></div>
                  <div><dt>请求时间</dt><dd>{formatDateTime(selected.requestedAt)}</dd></div>
                  <div><dt>过期时间</dt><dd>{selected.expiresAt ? formatDateTime(selected.expiresAt) : '未设置'}</dd></div>
                </dl>

                <section className="studio-evidence">
                  <header><FileDiff size={15} /><span>实际请求参数</span><em>{request?.toolName ?? 'tool'}</em></header>
                  <pre>{JSON.stringify(selected.request, null, 2).slice(0, 12000)}</pre>
                </section>

                {filePath ? (
                  <section className="studio-evidence">
                    <header><Terminal size={15} /><span>写入目标</span><em>{filePath}</em></header>
                    {fileContent ? <pre>{fileContent.slice(0, 12000)}</pre> : <p className="studio-muted">该请求没有内联文件内容，仅涉及路径操作。</p>}
                  </section>
                ) : null}

                {command ? (
                  <section className="studio-evidence">
                    <header><Terminal size={15} /><span>命令</span><em>process</em></header>
                    <pre>{command}</pre>
                  </section>
                ) : null}

                <footer className="studio-document-foot">
                  <span>审批 ID {selected.id}</span>
                  <button type="button" className="studio-link" onClick={() => navigate(`/projects/${projectId}/runs?run=${selected.runId}`)}>运行审计 <ArrowRight size={12} /></button>
                </footer>
              </>
            ) : null}
          </article>

          <aside className="studio-decision" aria-label="审批决策">
            <span className="studio-kicker">DECISION</span>
            <h3>对本次请求作出决定</h3>
            <p>只对当前 Approval ID 生效。服务端会再次校验权限、过期时间和状态。</p>
            {result ? <div className="studio-result"><CheckCircle2 size={15} />{result}</div> : null}
            {decision ? (
              <div className="studio-decision-form">
                <strong>{decision === 'approved' ? '确认允许本次？' : '确认拒绝本次？'}</strong>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="给审计留一条备注（可选）" rows={3} maxLength={2000} />
                {decision === 'approved' ? (
                  <label className="studio-check">
                    <input type="checkbox" checked={riskAccepted} onChange={(event) => setRiskAccepted(event.target.checked)} />
                    我已核对工具、参数、路径与影响范围
                  </label>
                ) : null}
                {error ? <div className="studio-error" role="alert">{error}</div> : null}
                <button type="button" className="studio-cta is-block" disabled={busy || (decision === 'approved' && !riskAccepted)} onClick={() => void decide(decision)}>
                  {busy ? '提交中…' : decision === 'approved' ? '确认允许本次' : '确认拒绝'}
                </button>
                <button type="button" className="studio-ghost is-block" disabled={busy} onClick={() => setDecision(null)}>取消</button>
              </div>
            ) : (
              <div className="studio-decision-actions">
                <button type="button" className="studio-cta is-block" onClick={() => setDecision('approved')} disabled={!selected || selected.status !== 'pending'}>允许本次</button>
                <button type="button" className="studio-danger is-block" onClick={() => setDecision('rejected')} disabled={!selected || selected.status !== 'pending'}>拒绝</button>
              </div>
            )}
            {error && !decision ? <div className="studio-error" role="alert">{error}</div> : null}
            <div className="studio-decision-foot">
              <ShieldAlert size={13} />
              <span>决定写入真实审计；没有前端乐观状态。</span>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

export default StudioReviewRoom
