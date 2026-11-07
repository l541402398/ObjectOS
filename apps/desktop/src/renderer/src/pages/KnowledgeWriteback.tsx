import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { OrganizationKnowledgeContentSchema, type KnowledgeWritebackReceipt, type OrganizationConnectionView } from '@projectos/contracts'
import { DialogShell, OverlayHeader, OverlayScrollArea, OverlayFooter } from '../next-ui/overlay/overlay-shell'
import { OrganizationError, OrganizationField, OrganizationLoading } from '../features/settings/organization/OrganizationPrimitives'
import { organizationScopeKey } from '../features/settings/organization/useOrganization'

const receiptLabel = { sending: '正在提交', needs_reconciliation: '结果待核对', submitted: '已提交候选', failed: '提交未完成' }
const candidateStatus = { pending: '待组织审核', returned: '已退回', published: '已发布知识' }
function StoredWriteback({ id, connection, onBack, onChanged, onResolved }: { id: string; connection: OrganizationConnectionView; onBack: () => void; onChanged: () => Promise<unknown>; onResolved: (receipt: KnowledgeWritebackReceipt) => void }) {
  const [confirmed, setConfirmed] = useState(false)
  const operation = useQuery({ queryKey: [...organizationScopeKey(connection, 'writeback'), id], queryFn: () => window.projectos.organization.knowledgeWriteback({ id }), retry: false, gcTime: 0, refetchOnWindowFocus: false })
  const review = useQuery({ queryKey: [...organizationScopeKey(connection, 'candidate-result'), id], queryFn: () => window.projectos.organization.knowledgeCandidate({ id }), enabled: operation.data?.receipt.status === 'submitted', retry: false, gcTime: 0, refetchOnWindowFocus: false })
  const action = useMutation({ mutationFn: (kind: 'reconcile' | 'retry') => kind === 'reconcile' ? window.projectos.organization.reconcileKnowledgeWriteback({ id }) : window.projectos.organization.retryKnowledgeWriteback({ id, confirmed: true }),
    onSuccess: onResolved,
    onSettled: async () => { setConfirmed(false); await Promise.all([operation.refetch(), onChanged()]) }, retry: false })
  const data = operation.data
  return <section aria-label="固定提交内容"><button className="org-link" type="button" onClick={onBack} disabled={action.isPending}>返回成果验收</button>
    <OrganizationError error={operation.error || action.error || review.error}/>{operation.isPending ? <OrganizationLoading/> : data ? <>
      <h3>{data.payload.content.title}</h3><p role="status">{receiptLabel[data.receipt.status]}</p>
      <pre className="org-knowledge-body">{data.payload.content.body}</pre>
      {data.receipt.status === 'submitted' ? <div className="org-inline-actions"><span role="status">{review.data && !review.isError ? candidateStatus[review.data.candidate.status] : '审核状态尚未确认'}</span><button type="button" className="org-button" disabled={review.isFetching} onClick={() => void review.refetch()}>刷新审核结果</button></div> : null}
      <details><summary>原提交标识与来源</summary><pre className="kw-evidence">{JSON.stringify({ id, projectId: data.payload.projectId, source: data.payload.source }, null, 2)}</pre></details>
      {['needs_reconciliation', 'failed'].includes(data.receipt.status) ? <>
        <button type="button" className="org-button" disabled={action.isPending} onClick={() => action.mutate('reconcile')}>核对服务器回执</button>
        <label className="kw-check"><input type="checkbox" checked={confirmed} disabled={action.isPending} onChange={event => setConfirmed(event.target.checked)}/>我已核对原内容，确认仅重新提交同一标识和内容</label>
        <button type="button" className="org-button" disabled={!confirmed || action.isPending} onClick={() => action.mutate('retry')}>确认重新提交原内容</button>
      </> : null}
    </> : null}
  </section>
}

function WritebackDialog({ requirementId, connection, available, initialProjectId, onClose }: {
  requirementId: string; connection?: OrganizationConnectionView; available: boolean; initialProjectId?: string; onClose: () => void
}) {
  const formId = useId(), [id] = useState(() => crypto.randomUUID()), [dirty, setDirty] = useState(false)
  const client = useQueryClient()
  const [note, setNote] = useState(''), [acceptedCheck, setAcceptedCheck] = useState(false), [shareCheck, setShareCheck] = useState(false)
  const [projectId, setProjectId] = useState(initialProjectId ?? ''), [selected, setSelected] = useState<string[]>([])
  const [title, setTitle] = useState(''), [body, setBody] = useState(''), [tags, setTags] = useState(''), [category, setCategory] = useState<'business' | 'technical'>('technical')
  const [stored, setStored] = useState<string | null>(null)
  const [replaceDraft, setReplaceDraft] = useState(false)
  const preview = useQuery({ queryKey: ['knowledge-delivery', requirementId], queryFn: () => window.projectos.requirements.knowledgeDelivery(requirementId), retry: false, refetchOnWindowFocus: false, gcTime: 0 })
  const projects = useQuery({ queryKey: connection ? organizationScopeKey(connection, 'projects') : ['local-knowledge-projects'], queryFn: () => window.projectos.organization.projects(), enabled: available, retry: false })
  const accept = useMutation({ mutationFn: () => window.projectos.requirements.acceptKnowledgeDelivery({ requirementId, fingerprint: preview.data!.fingerprint, note, confirmed: true }),
    onSuccess: value => { client.setQueryData(['knowledge-delivery', requirementId], value); setAcceptedCheck(false); setDirty(false) } })
  const draft = useMutation({ mutationFn: () => window.projectos.requirements.knowledgeDraft({ requirementId, artifactIds: selected }),
    onSuccess: content => { setTitle(content.title); setBody(content.body); setTags(content.tags.join('，')); setDirty(true); setShareCheck(false); setReplaceDraft(false) } })
  const submit = useMutation({ mutationFn: async () => {
    const content = OrganizationKnowledgeContentSchema.safeParse({ title, body, tags: tags.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean) })
    if (!content.success) throw new Error('请检查资料标题、正文与标签；内容不能包含凭据。')
    if (!shareCheck || !preview.data?.acceptance?.current) throw new Error('请先确认当前验收与本次分享范围')
    return window.projectos.organization.submitKnowledgeCandidate({ id, requirementId, projectId, acceptanceId: preview.data.acceptance.id,
      fingerprint: preview.data.fingerprint, artifactIds: selected, category, content: content.data, confirmed: true })
  }, retry: false, onSuccess: () => { setDirty(false); setShareCheck(false) }, onSettled: async () => { await preview.refetch() } })
  const data = preview.data, sent = data?.receipts.find(item => item.id === id), busy = accept.isPending || draft.isPending || submit.isPending
  const eligible = data?.acceptance?.current === true && data.blockers.length === 0
  const canSubmit = projects.data?.projects.some(item => item.id === projectId && ['owner', 'maintainer', 'contributor'].includes(item.role)) === true
  const sameScope = (item: KnowledgeWritebackReceipt) => available && item.serverUrl === connection?.serverUrl && item.organizationId === connection.activeOrganizationId && item.accountId === connection.session?.account.id
  const unresolved = data?.receipts.some(item => item.id !== id && sameScope(item) && ['sending', 'needs_reconciliation'].includes(item.status)) === true
  return <DialogShell open dirty={dirty} onOpenChange={open => { if (!open && !busy) onClose() }} ariaLabel="验收与知识回写" width={900} testId="knowledge-writeback-dialog">
    <OverlayHeader title="验收与知识回写"/>
    <OverlayScrollArea><div className="rq-organization-knowledge kw-dialog">
      {stored && connection ? <StoredWriteback id={stored} connection={connection} onBack={() => setStored(null)} onResolved={receipt => { if (receipt.id === id && receipt.status === 'submitted') setDirty(false) }} onChanged={() => preview.refetch()}/> : <>
        <OrganizationError error={preview.error || accept.error || draft.error || submit.error}/>
        {preview.isPending ? <OrganizationLoading/> : data ? <>
          <div className="org-section-heading"><h3>成果整体验收</h3><button type="button" className="org-button" disabled={busy || preview.isFetching} onClick={() => { setAcceptedCheck(false); setShareCheck(false); void preview.refetch() }}>刷新验收证据</button></div>
          <details><summary>本次验收范围</summary><p>核对需求分支成果，作为知识回写依据；项目合入与发布仍需独立授权。</p></details>
          {data.blockers.length ? <ul className="kw-blockers" aria-label="验收待办">{data.blockers.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : <p role="status">{eligible ? '当前成果已记录人工整体验收。' : '当前成果已具备审查、实际测试与合入证据。'}</p>}
          {!eligible && !data.blockers.length ? <section aria-label="记录整体验收">
            <OrganizationField label="整体验收结论">{field => <textarea id={field} value={note} maxLength={2000} minLength={8} rows={3} onChange={event => { setNote(event.target.value); setDirty(true) }}/>}</OrganizationField>
            <label className="kw-check"><input type="checkbox" checked={acceptedCheck} disabled={busy} onChange={event => { setAcceptedCheck(event.target.checked); setDirty(true) }}/>我已核对需求范围、当前成果及验收证据</label>
            <button type="button" className="org-button is-primary" disabled={!acceptedCheck || note.trim().length < 8 || busy} onClick={() => accept.mutate()}>记录整体验收通过</button>
          </section> : null}
          {eligible ? <form id={formId} onSubmit={event => { event.preventDefault(); if (!busy) submit.mutate() }} onChange={() => setDirty(true)}>
            <fieldset disabled={busy || Boolean(sent)}><legend><h3>知识候选</h3></legend>
              <ul className="rq-knowledge-sources">{data.artifacts.map(item => <li key={item.id}><label className="kw-check"><input type="checkbox" checked={selected.includes(item.id)} disabled={!selected.includes(item.id) && selected.length >= 8} onChange={event => { setSelected(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id)); setShareCheck(false) }}/>{item.title}</label><span className="rq-knowledge-source-meta">{item.bodyChars} 字</span></li>)}</ul>
              <button type="button" className="org-button" disabled={!selected.length || busy} onClick={() => body.trim() ? setReplaceDraft(true) : draft.mutate()}>从所选产物整理</button>
              {replaceDraft ? <div className="org-inline-confirm" role="group" aria-label="替换知识草稿"><p>用所选产物替换当前草稿？</p><button className="org-button" type="button" onClick={() => setReplaceDraft(false)}>保留当前草稿</button><button className="org-button" type="button" onClick={() => draft.mutate()}>替换草稿</button></div> : null}
              <div className="org-form-grid"><OrganizationField label="提交到共享项目">{field => <select id={field} required value={projectId} disabled={!available || Boolean(initialProjectId)} onChange={event => { setProjectId(event.target.value); setShareCheck(false) }}><option value="">选择项目</option>{projects.data?.projects.filter(item => ['owner', 'maintainer', 'contributor'].includes(item.role)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}</OrganizationField>
              <OrganizationField label="候选类型">{field => <select id={field} value={category} onChange={event => { setCategory(event.target.value as typeof category); setShareCheck(false) }}><option value="technical">技术资料</option><option value="business">业务资料</option></select>}</OrganizationField></div>
              <OrganizationField label="候选标题">{field => <input id={field} required maxLength={160} value={title} onChange={event => { setTitle(event.target.value); setShareCheck(false) }}/>}</OrganizationField>
              <OrganizationField label="候选正文">{field => <textarea id={field} required maxLength={20000} rows={12} value={body} onChange={event => { setBody(event.target.value); setShareCheck(false) }}/>}</OrganizationField>
              <OrganizationField label="候选标签">{field => <input id={field} maxLength={650} value={tags} onChange={event => { setTags(event.target.value); setShareCheck(false) }}/>}</OrganizationField>
              <label className="kw-check"><input type="checkbox" checked={shareCheck} onChange={event => setShareCheck(event.target.checked)}/>我已核对正文和证据，确认分享给所选项目成员</label>
            </fieldset>
            <OrganizationError error={projects.error}/>{!available ? <p role="status">连接组织后可提交候选。</p> : null}
            {available && projectId && !projects.isPending && !canSubmit ? <p role="status">当前账号没有此项目的知识提交权限。</p> : null}
            {unresolved ? <p role="status">请先核对已有提交结果，再创建新候选。</p> : null}
            {sent ? <p role="status">{receiptLabel[sent.status]}</p> : null}
          </form> : null}
          {data.receipts.length ? <section aria-label="知识提交记录"><h3>提交记录</h3><ul className="rq-knowledge-sources">{data.receipts.map(item => <li key={item.id}><div className="org-section-heading"><span>{receiptLabel[item.status]}</span>{sameScope(item) ? <button className="org-link" type="button" onClick={() => setStored(item.id)}>查看提交内容</button> : null}</div><p className="rq-knowledge-source-meta">{item.id}</p>{item.error ? <p role="status">{item.error}</p> : null}</li>)}</ul></section> : null}
        </> : null}
      </>}
    </div></OverlayScrollArea>
    <OverlayFooter>{!stored ? <button className="org-button is-primary" type="submit" form={formId} disabled={!eligible || !available || !canSubmit || !selected.length || !projectId || !shareCheck || unresolved || busy || Boolean(sent)}>{submit.isPending ? '正在提交…' : '提交知识候选'}</button> : null}</OverlayFooter>
  </DialogShell>
}

export function KnowledgeWriteback({ requirementId, connection, available, initialProjectId }: { requirementId: string; connection?: OrganizationConnectionView; available: boolean; initialProjectId?: string }) {
  const [open, setOpen] = useState(false)
  return <><button className="org-button" type="button" onClick={() => setOpen(true)}>成果验收与知识回写</button>
    {open ? <WritebackDialog requirementId={requirementId} connection={connection} available={available} initialProjectId={initialProjectId} onClose={() => setOpen(false)}/> : null}</>
}
