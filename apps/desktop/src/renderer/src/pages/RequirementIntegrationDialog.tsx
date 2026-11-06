import { RequirementApproval } from './RequirementApproval'
import { GitDeliveryDialog } from './GitDeliveryDialog'
import { CodeReviewDialog, CodeDiffPreview } from './CodeReviewDialog'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, Button, Input } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { ErrorState, LoadingBlock, StatusPill } from '@projectos/ui'
import { DialogShell, OverlayFooter, OverlayHeader, OverlayScrollArea } from '../next-ui/overlay/overlay-shell'
import { errorMessage } from '../lib/errors'

export function RequirementIntegrationDialog({ taskId, projectId, onClose, onRefresh, onNavigate }: {
  taskId: string; projectId: string; onClose: () => void; onRefresh: () => Promise<void>; onNavigate: (path: string) => void
}) {
  const [note, setNote] = useState('')
  const [conflictsOpen,setConflictsOpen]=useState(false),[codeOpen,setCodeOpen]=useState(false)
  const [noteFingerprint, setNoteFingerprint] = useState<string | null>(null)
  const api = window.projectos.requirements
  // A visible review stays on the version the person actually read. Refresh is explicit.
  const preview = useQuery({ queryKey: ['task-integration-preview', taskId], queryFn: () => api.integrationPreview(taskId), staleTime: 0, refetchOnWindowFocus: false, refetchInterval: query => query.state.data?.operations.some(op => op.status === 'executing') ? 2000 : false })
  const data = preview.data
  const operation = data?.operations.find(op => ['waiting_approval', 'executing', 'needs_reconciliation'].includes(op.status))
  const action = useMutation({
    mutationFn: async (kind: 'review' | 'verify' | 'integrate' | 'reconcile') => {
      if (!data) return
      if (kind === 'review') await api.reviewIntegration({ taskId, fingerprint: noteFingerprint ?? data.fingerprint, note })
      else if (kind === 'reconcile' && operation) await api.reconcileIntegration(operation.id)
      else if (kind === 'verify' || kind === 'integrate') await api.requestIntegration({ taskId, fingerprint: data.fingerprint, kind })
      if (kind === 'review') { setNote(''); setNoteFingerprint(null) }
      await Promise.all([preview.refetch(), onRefresh()])
    },
  })
  const locked = action.isPending || preview.isFetching || Boolean(operation)
  const refresh = async () => { action.reset(); await preview.refetch() }
  const go = (path: string) => { onClose(); onNavigate(path) }
  if(codeOpen)return <CodeReviewDialog subject={{projectId,taskId,planId:null}} onClose={()=>setCodeOpen(false)}/>
  if(conflictsOpen)return <GitDeliveryDialog subject={{projectId,taskId,planId:null}} onClose={()=>{setConflictsOpen(false);void preview.refetch()}} onRefresh={onRefresh}/>
  return <DialogShell open onOpenChange={open => { if (!open && !action.isPending) onClose() }} dirty={note.trim().length > 0} ariaLabel="成果审查" width={1000}>
    <OverlayHeader title="成果审查" meta={data?.title} actions={<Button icon={<ReloadOutlined aria-hidden />} aria-label="刷新成果" loading={preview.isFetching} disabled={action.isPending} onClick={() => void refresh()} />} />
    <OverlayScrollArea className="rq-integration-scroll">
      <Button onClick={()=>setConflictsOpen(true)} disabled={locked}>解决合入冲突</Button>
      {action.isError && <Alert type="error" showIcon message={errorMessage(action.error)} />}
      {preview.isLoading ? <LoadingBlock label="正在读取实际改动与验证记录" rows={6} /> : preview.isError ? <ErrorState title="无法读取任务成果" message={errorMessage(preview.error)} onRetry={() => void preview.refetch()} /> : data && <>
        <div className="rq-integration-route"><span>任务工作区</span><span aria-hidden>→</span><strong>需求集成分支</strong><span className="rq-secondary">{data.files.length} 个改动文件 · 指纹 {data.fingerprint.slice(0, 10)}</span>{data.integrated && <StatusPill tone="success">成果已合入</StatusPill>}</div>
        <div className="rq-governance-pills rq-integration-gates" aria-label="集成三重门禁">
          <div className={`rq-gov-pill ${data.verification.passed ? 'is-ok' : 'is-warn'}`}>
            <span className="rq-gov-dot" aria-hidden />
            <span className="rq-gov-label">① 独立验证</span>
            <strong>{data.verification.passed ? '已通过（指纹一致）' : '待运行验证'}</strong>
          </div>
          <div className={`rq-gov-pill ${data.review.approved ? 'is-ok' : 'is-warn'}`}>
            <span className="rq-gov-dot" aria-hidden />
            <span className="rq-gov-label">② 改动全覆盖审查</span>
            <strong>{data.review.approved ? `${data.files.length} 文件已审` : '待记录审查'}</strong>
          </div>
          <div className={`rq-gov-pill ${data.integrated ? 'is-ok' : data.blockers.length === 0 && data.verification.passed && data.review.approved ? 'is-ok' : 'is-neutral'}`}>
            <span className="rq-gov-dot" aria-hidden />
            <span className="rq-gov-label">③ 需求分支合入</span>
            <strong>{data.integrated ? '已完成合入' : data.blockers.length === 0 && data.verification.passed && data.review.approved ? '可申请合入' : '门禁待就绪'}</strong>
          </div>
        </div>
        {operation && <Alert type={operation.status === 'needs_reconciliation' ? 'error' : 'info'} showIcon message={operation.status === 'waiting_approval' ? `等待批准${operation.kind === 'verify' ? '代码验证' : '合入成果'}` : operation.status === 'executing' ? '操作正在执行，可在运行记录查看输出' : operation.error ?? '结果待人工核对'} action={operation.status === 'waiting_approval' ? undefined : operation.status === 'needs_reconciliation' ? <Button loading={action.isPending} onClick={() => action.mutate('reconcile')}>核对结果</Button> : <Button onClick={() => go(`runs?run=${operation.runId}`)}>查看运行</Button>} />}
        {operation?.status === 'waiting_approval' && <RequirementApproval key={operation.approvalId} projectId={projectId} approvalId={operation.approvalId} onDecided={async () => { await preview.refetch(); await onRefresh() }} />}
        <div className="rq-integration-grid">
          <section className="rq-change-review" aria-label="实际代码改动">
            <div className="rq-review-heading"><h3>代码改动</h3><details><summary>文件列表</summary><ul>{data.files.map(file => <li key={file.path}><span>{file.status}</span><code>{file.path}</code></li>)}</ul></details></div>
            <CodeDiffPreview diff={data.diff} onExpand={()=>setCodeOpen(true)}/>
            {data.diffTruncated && <Alert type="warning" showIcon message="改动较大，预览已截断；请在任务工作区检查完整内容后再记录审查。" />}
          </section>
          <aside className="rq-integration-checks" aria-label="验证与审查">
            <section>
              <div className="rq-review-heading"><h3>实际验证</h3><StatusPill tone={data.verification.passed ? 'success' : 'neutral'}>{data.verification.passed ? '已通过' : '待验证'}</StatusPill></div>
              <p>{data.verification.reason}</p>
              {data.verification.command && <details><summary>上次执行详情</summary><code>{data.verification.command}</code></details>}
              {data.verification.runId && <Button type="link" onClick={() => go(`runs?run=${data.verification.runId}`)}>查看验证输出</Button>}
              <Button block disabled={locked} loading={action.isPending && action.variables === 'verify'} onClick={() => action.mutate('verify')}>运行验证</Button>
            </section>
            <section>
              <div className="rq-review-heading"><h3>人工审查</h3><StatusPill tone={data.review.approved ? 'success' : 'neutral'}>{data.review.approved ? '已通过' : '待审查'}</StatusPill></div>
              {data.review.approved ? <p>当前改动已记录审查结论。</p> : <>
                {data.review.reasons.length > 0 && <p>{data.review.reasons.join('；')}</p>}
                <label htmlFor="rq-review-note">审查结论</label>
                <Input.TextArea id="rq-review-note" rows={4} value={note} onChange={event => { setNote(event.target.value); setNoteFingerprint(data.fingerprint) }} maxLength={4000} placeholder="记录检查范围、结论与验收依据" disabled={locked} />
                <Button block disabled={locked || note.trim().length < 5} loading={action.isPending && action.variables === 'review'} onClick={() => action.mutate('review')}>记录审查通过</Button>
              </>}
            </section>
            {data.blockers.length > 0 && <div className="rq-integration-blockers"><h3>合入前还需处理</h3><ul>{data.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul><Button type="link" onClick={() => go(`tasks?task=${taskId}`)}>打开任务详情</Button></div>}
          </aside>
        </div>
        <details className="rq-integration-details"><summary>分支与操作记录</summary><dl><dt>任务分支</dt><dd>{data.sourceBranch} · {data.sourceHead.slice(0, 12)}</dd><dt>需求分支</dt><dd>{data.targetBranch} · {data.targetHead.slice(0, 12)}</dd></dl>{data.operations.length > 0 && <ul>{data.operations.map(op => <li key={op.id}><button onClick={() => go(`runs?run=${op.runId}`)}>{op.kind === 'verify' ? '验证' : '合入'} · {({ completed: '完成', failed: '失败', rejected: '已拒绝', waiting_approval: '待审批', executing: '执行中', needs_reconciliation: '待核对' })[op.status]}</button>{op.error && <span>{op.error}</span>}</li>)}</ul>}</details>
      </>}
    </OverlayScrollArea>
    <OverlayFooter><span className="rq-secondary">合入后，后续任务才能取得此成果。需求仍需整体验收。</span><Button type="primary" disabled={!data || data.integrated || locked || data.blockers.length > 0 || !data.review.approved || !data.verification.passed} loading={action.isPending && action.variables === 'integrate'} onClick={() => action.mutate('integrate')}>{data?.integrated ? '已合入需求' : '申请合入需求'}</Button></OverlayFooter>
  </DialogShell>
}
