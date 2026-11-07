import { useContext, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiInput, KnowledgeCandidateDetail, OrganizationConnectionView, OrganizationKnowledgeDetail } from '@projectos/contracts'
import { SettingsDraftContext, useSettingsDraft } from '../settings-draft'
import { OrganizationEmpty, OrganizationError, OrganizationField, OrganizationLoading } from './OrganizationPrimitives'
import { organizationScopeKey } from './useOrganization'

const statusLabel = { pending: '待审核', returned: '已退回', published: '已发布' }
type Decision = ApiInput<'organization.reviewKnowledgeCandidate'>['decision']

function CandidateReview({ detail, connection, onSaved }: { detail: KnowledgeCandidateDetail; connection: OrganizationConnectionView; onSaved: (detail: KnowledgeCandidateDetail) => void }) {
  const { candidate, related } = detail
  const [note, setNote] = useState(''), [choice, setChoice] = useState('new'), [version, setVersion] = useState('')
  const [head, setHead] = useState<OrganizationKnowledgeDetail | null>(null), [acknowledged, setAcknowledged] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState(false), [dirty, setDirty] = useState(false), [uncertain, setUncertain] = useState(false), [retryConfirmed, setRetryConfirmed] = useState(false), [discard, setDiscard] = useState(false)
  const [intent, setIntent] = useState<Decision | null>(null)
  useSettingsDraft(dirty)
  const documents = useQuery({ queryKey: organizationScopeKey(connection, 'knowledge'), queryFn: () => window.projectos.organization.knowledgeList(), retry: false })
  const load = useMutation({ mutationFn: (documentId: string) => window.projectos.organization.knowledgeDetail({ documentId }), onSuccess: value => setHead(value) })
  const submit = useMutation({ mutationFn: (decision: Decision) => window.projectos.organization.reviewKnowledgeCandidate({ id: candidate.id, decision }), retry: false,
    onSuccess: value => { setDirty(false); setUncertain(false); onSaved(value) }, onError: () => { setUncertain(true); setRetryConfirmed(false) } })
  const refresh = useMutation({ mutationFn: () => window.projectos.organization.knowledgeCandidate({ id: candidate.id }), onSuccess: value => { if (value.candidate.status !== 'pending') setDirty(false); onSaved(value) } })
  const busy = submit.isPending || load.isPending || refresh.isPending
  const suggestedVersion = head?.versions[0]?.version.replace(/\d+$/, value => String(Number(value) + 1)) ?? '1.0.0'
  const validVersion = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(version || (choice === 'new' ? '1.0.0' : suggestedVersion))
  const decide = (action: 'return' | 'publish') => {
    const common = { decisionId: crypto.randomUUID(), expectedRevision: candidate.revision, note }
    const decision: Decision = action === 'return' ? { ...common, action } : { ...common, action,
      target: choice === 'new' ? { kind: 'new', version: version || '1.0.0' } : { kind: 'version', documentId: choice, expectedVersionId: head!.versions[0]!.id, version: version || suggestedVersion }, acknowledgedDuplicateIds: acknowledged }
    setIntent(decision); submit.mutate(decision)
  }
  return <section className="org-candidate-review" aria-label="审核知识候选">
    <OrganizationError error={documents.error || load.error || submit.error || refresh.error}/>
    {uncertain ? <div className="org-inline-confirm" role="group" aria-label="核对审核结果"><p>审核结果尚未确认，请先刷新候选核对。</p>
      <button className="org-button" type="button" disabled={busy} onClick={() => refresh.mutate()}>核对审核结果</button>
      <label className="kw-check"><input type="checkbox" checked={retryConfirmed} disabled={busy} onChange={event => setRetryConfirmed(event.target.checked)}/>我已核对，确认仅按原审核决定重试</label>
      <button className="org-button" type="button" disabled={!retryConfirmed || busy || !intent} onClick={() => submit.mutate(intent!)}>确认按原决定重试</button>
    </div> : null}
    <fieldset disabled={busy || uncertain} onChange={() => { setDirty(true); setConfirmed(false) }}>
      <legend><h3>发布位置</h3></legend>
      <OrganizationField label="发布为">{id => <select id={id} value={choice} onChange={event => { const value = event.target.value; setChoice(value); setVersion(''); setHead(null); if (value !== 'new') load.mutate(value) }}><option value="new">新知识文档（项目私有）</option>{documents.data?.documents.filter(item => item.canManage && item.projectId === candidate.projectId && item.category === candidate.category).map(item => <option key={item.id} value={item.id}>新版本：{item.title}</option>)}</select>}</OrganizationField>
      {choice !== 'new' ? <div className="org-inline-actions"><span className="rq-knowledge-source-meta">{head ? `当前版本 ${head.versions[0]!.version}` : '尚未载入目标版本'}</span><button className="org-button" type="button" onClick={() => { setHead(null); load.mutate(choice) }}>重新载入目标版本</button></div> : null}
      <OrganizationField label="发布版本号">{id => <input id={id} required pattern="(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)" maxLength={30} value={version || (choice === 'new' ? '1.0.0' : suggestedVersion)} onChange={event => setVersion(event.target.value)}/>}</OrganizationField>
      {related.length ? <section aria-label="相关知识"><h3>相关知识</h3><ul className="rq-knowledge-sources">{related.map(item => <li key={item.versionId}><strong>{item.title} · {item.version}</strong><p className="rq-knowledge-source-meta">{item.exactContent ? '相同正文' : item.relatedAcceptance ? '同次验收来源' : '相似标题'}</p>{item.exactContent && (choice === 'new' || item.documentId !== choice) ? <label className="kw-check"><input type="checkbox" checked={acknowledged.includes(item.documentId)} onChange={event => setAcknowledged(previous => event.target.checked ? [...previous, item.documentId] : previous.filter(id => id !== item.documentId))}/>已核对此重复内容，仍保留本次发布</label> : null}</li>)}</ul></section> : null}
      <OrganizationField label="知识审核意见">{id => <textarea id={id} rows={4} required minLength={8} maxLength={2000} value={note} onChange={event => setNote(event.target.value)}/>}</OrganizationField>
    </fieldset>
    <label className="kw-check"><input type="checkbox" checked={confirmed} disabled={busy || uncertain} onChange={event => { setConfirmed(event.target.checked); setDirty(true) }}/>我已核对候选正文、来源证据和发布位置</label>
    <div className="org-inline-actions"><button className="org-button" type="button" disabled={busy || uncertain || note.trim().length < 8} onClick={() => decide('return')}>退回候选</button>
      <button className="org-button is-primary" type="button" disabled={!confirmed || !validVersion || busy || uncertain || note.trim().length < 8 || (choice !== 'new' && !head) || related.some(item => item.exactContent && item.documentId !== choice && !acknowledged.includes(item.documentId))} onClick={() => decide('publish')}>审核并发布知识</button>
      <button className="org-link" type="button" disabled={busy || uncertain || !dirty} onClick={() => setDiscard(true)}>取消本次编辑</button></div>
    {discard ? <div className="org-inline-confirm" role="group" aria-label="放弃审核草稿"><p>放弃尚未提交的审核意见？</p><button className="org-button" type="button" onClick={() => setDiscard(false)}>继续编辑</button><button className="org-button" type="button" onClick={() => { setNote(''); setConfirmed(false); setChoice('new'); setHead(null); setVersion(''); setAcknowledged([]); setIntent(null); setDirty(false); setDiscard(false) }}>放弃意见</button></div> : null}
  </section>
}

export function KnowledgeCandidates({ connection, onBack }: { connection: OrganizationConnectionView; onBack: () => void }) {
  const [selected, setSelected] = useState<string | null>(null), { dirty } = useContext(SettingsDraftContext)
  const client = useQueryClient(), key = organizationScopeKey(connection, 'knowledge-candidates')
  const list = useQuery({ queryKey: key, queryFn: () => window.projectos.organization.knowledgeCandidates(), retry: false })
  const detail = useQuery({ queryKey: [...key, selected], queryFn: () => window.projectos.organization.knowledgeCandidate({ id: selected! }), enabled: Boolean(selected), retry: false, gcTime: 0, refetchOnWindowFocus: false })
  const saved = (value: KnowledgeCandidateDetail) => { client.setQueryData([...key, value.candidate.id], value); void client.invalidateQueries({ queryKey: key, exact: true }); void client.invalidateQueries({ queryKey: organizationScopeKey(connection, 'knowledge') }) }
  const candidate = detail.data?.candidate
  return <section className="org-knowledge-candidates" aria-label="知识审核" data-testid="knowledge-candidates">
    <button className="org-link" type="button" disabled={dirty} onClick={() => selected ? setSelected(null) : onBack()}>{selected ? '返回候选列表' : '返回知识列表'}</button>
    <OrganizationError error={list.error || detail.error}/>
    {selected ? detail.isPending ? <OrganizationLoading/> : candidate && detail.data ? <>
      <div className="org-section-heading"><h3>{candidate.content.title}</h3><span className="org-asset-status" data-testid="candidate-status">{statusLabel[candidate.status]}</span></div>
      <p className="rq-knowledge-source-meta">{candidate.category === 'technical' ? '技术资料' : '业务资料'} · {candidate.authorName} · 项目私有</p>
      <pre className="org-knowledge-body">{candidate.content.body}</pre>
      <details className="kw-evidence-details"><summary>来源需求与验收证据</summary><p>{candidate.source.requirementTitle} · 本机所有者验收</p><p>{candidate.source.acceptanceNote}</p><pre className="kw-evidence">{JSON.stringify(candidate.source, null, 2)}</pre></details>
      {candidate.reviewNote ? <section><h3>审核意见</h3><p>{candidate.reviewNote}</p></section> : null}
      {candidate.publication ? <p role="status">已发布为 {candidate.publication.version} · {candidate.publication.checksum}</p> : null}
      {candidate.status === 'pending' && candidate.canReview ? <CandidateReview key={`${candidate.id}:${candidate.revision}`} detail={detail.data} connection={connection} onSaved={saved}/> : null}
    </> : null : <>
      <div className="org-section-heading"><h3>知识审核</h3><button className="org-button" type="button" disabled={list.isFetching} onClick={() => void list.refetch()}>刷新候选</button></div>
      {list.isPending ? <OrganizationLoading/> : list.data?.candidates.length ? <div className="org-table-wrap"><table className="org-table"><caption className="org-sr-only">知识候选及审核结果</caption><thead><tr><th scope="col">候选与来源</th><th scope="col">提交者</th><th scope="col">状态</th></tr></thead><tbody>{list.data.candidates.map(item => <tr key={item.id}><td><button className="org-asset-name" type="button" onClick={() => setSelected(item.id)}>{item.title}</button><span className="org-item-sub">{item.requirementTitle}</span></td><td>{item.authorName}</td><td>{statusLabel[item.status]}</td></tr>)}</tbody></table></div> : <OrganizationEmpty title="暂无可访问的知识候选"/>}
    </>}
  </section>
}
