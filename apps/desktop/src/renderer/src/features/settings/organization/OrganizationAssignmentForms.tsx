import { useContext, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import type { ApiInput, AssignmentReceipt, AssignmentSelection, MemberAssignment, OrganizationConnectionView, SharedProjectView } from '@projectos/contracts'
import { SettingsDraftContext, useSettingsDraft } from '../settings-draft'
import { useUiStore } from '../../../stores/ui'
import { OrganizationError, OrganizationField } from './OrganizationPrimitives'
import { organizationScopeKey } from './useOrganization'
import { assignmentStatus } from './AssignmentOperations'
import './knowledge.css'
import './assignments.css'

type Props = { connection: OrganizationConnectionView }
type Decision = ApiInput<'organization.assignmentSubmit'> & { kind: 'decision' }
const priorities = { low: '低', normal: '普通', high: '高', urgent: '紧急' }

export function DispatchForm({ connection, projects, onDone, onCancel }: Props & { projects: SharedProjectView[]; onDone: (value: AssignmentReceipt) => void; onCancel: () => void }) {
  const [id] = useState(() => crypto.randomUUID()), [projectId, setProjectId] = useState(''), [assigneeId, setAssigneeId] = useState('')
  const [title, setTitle] = useState(''), [body, setBody] = useState(''), [criteria, setCriteria] = useState(''), [priority, setPriority] = useState<keyof typeof priorities>('normal'), [due, setDue] = useState('')
  const [confirmed, setConfirmed] = useState(false), [dirty, setDirty] = useState(false), [discard, setDiscard] = useState(false)
  useSettingsDraft(dirty)
  const { setDirty: publishDirty } = useContext(SettingsDraftContext)
  const roster = useQuery({ queryKey: [...organizationScopeKey(connection, 'assignment-roster'), projectId], queryFn: () => window.projectos.organization.assignmentRoster({ projectId }), enabled: Boolean(projectId), retry: false })
  const submit = useMutation({ mutationFn: () => window.projectos.organization.assignmentSubmit({ kind: 'dispatch', confirmed: true, draft: { id, projectId, assigneeId, brief: { title, body, acceptanceCriteria: criteria.split('\n').map(line => line.trim()).filter(Boolean), priority, dueAt: due ? new Date(due).getTime() : null } } }), retry: false,
    onSuccess: value => { setDirty(false); publishDirty(false); onDone(value) }, onError: async () => { const stored = await window.projectos.organization.assignmentOperation({ id }).catch(() => null); if (stored) { setDirty(false); publishDirty(false); onDone(stored.receipt) } } })
  return <form className="assignment-form" aria-label="派发组织需求" onChange={() => { setDirty(true); setConfirmed(false) }} onSubmit={event => { event.preventDefault(); if (confirmed && !submit.isPending) submit.mutate() }}>
    <h3>派发需求</h3><OrganizationError error={roster.error || submit.error}/><fieldset disabled={submit.isPending}>
      <div className="org-form-grid"><OrganizationField label="分配到共享项目">{field => <select id={field} required value={projectId} onChange={event => { setProjectId(event.target.value); setAssigneeId('') }}><option value="">选择共享项目</option>{projects.filter(p => ['owner', 'maintainer'].includes(p.role)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</OrganizationField>
        <OrganizationField label="需求负责人">{field => <select id={field} required value={assigneeId} disabled={!roster.data} onChange={event => setAssigneeId(event.target.value)}><option value="">选择项目成员</option>{roster.data?.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select>}</OrganizationField></div>
      <OrganizationField label="分配需求标题">{field => <input id={field} required maxLength={160} value={title} onChange={event => setTitle(event.target.value)}/>}</OrganizationField>
      <OrganizationField label="需求目标与范围">{field => <textarea id={field} rows={5} required maxLength={16000} value={body} onChange={event => setBody(event.target.value)}/>}</OrganizationField>
      <OrganizationField label="交付验收条件" hint="每行一项，最多 20 项">{field => <textarea id={field} rows={3} required maxLength={10000} value={criteria} onChange={event => setCriteria(event.target.value)}/>}</OrganizationField>
      <div className="org-form-grid"><OrganizationField label="需求优先级">{field => <select id={field} value={priority} onChange={event => setPriority(event.target.value as typeof priority)}>{Object.entries(priorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}</OrganizationField>
        <OrganizationField label="期望完成时间">{field => <input id={field} type="datetime-local" value={due} onChange={event => setDue(event.target.value)}/>}</OrganizationField></div>
    </fieldset>
    <label className="kw-check"><input type="checkbox" checked={confirmed} disabled={submit.isPending} onChange={event => { event.stopPropagation(); setConfirmed(event.target.checked); setDirty(true) }}/>我已核对范围、负责人和验收条件，确认派发</label>
    <div className="org-inline-actions"><button className="org-button" type="button" disabled={submit.isPending} onClick={() => dirty ? setDiscard(true) : onCancel()}>取消派发</button><button className="org-button is-primary" disabled={!confirmed || submit.isPending}>{submit.isPending ? '正在派发…' : '确认派发需求'}</button></div>
    {discard ? <div className="org-inline-confirm"><p>放弃未提交的分配内容？</p><button className="org-button" type="button" onClick={() => setDiscard(false)}>继续填写</button><button className="org-button" type="button" onClick={() => { setDirty(false); publishDirty(false); onCancel() }}>放弃填写</button></div> : null}
  </form>
}

export function AssignmentDetail({ assignment: item, connection, onChanged, onOperation }: Props & { assignment: MemberAssignment; onChanged: () => void; onOperation: (value: AssignmentReceipt) => void }) {
  const [operationId, setOperationId] = useState(() => crypto.randomUUID())
  const [reviewed, setReviewed] = useState({ revision: item.revision, reportId: item.report?.id ?? null })
  const [action, setAction] = useState(''), [note, setNote] = useState(''), [localProjectId, setLocalProjectId] = useState(''), [assigneeId, setAssigneeId] = useState('')
  const [confirmed, setConfirmed] = useState(false), [dirty, setDirty] = useState(false)
  const navigate = useNavigate(), closeSettings = useUiStore(state => state.closeSettings)
  useSettingsDraft(dirty)
  const { setDirty: publishDirty } = useContext(SettingsDraftContext)
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => window.projectos.projects.list(), enabled: item.canRespond && item.status === 'pending', retry: false })
  const local = useQuery({ queryKey: [...organizationScopeKey(connection, 'assignment-local'), item.id], queryFn: () => window.projectos.organization.assignmentLocal({ id: item.id }), retry: false })
  const roster = useQuery({ queryKey: [...organizationScopeKey(connection, 'assignment-roster'), item.projectId], queryFn: () => window.projectos.organization.assignmentRoster({ projectId: item.projectId }), enabled: item.canManage, retry: false })
  const submit = useMutation({ mutationFn: () => {
    let selection: AssignmentSelection
    if (action === 'accept') selection = { kind: 'accept', id: operationId, assignmentId: item.id, expectedRevision: reviewed.revision, localProjectId, confirmed: true }
    else {
      const common = { commandId: operationId, expectedRevision: reviewed.revision, note }
      const decision: Decision['decision'] = action === 'reassign' ? { ...common, action, newAssignmentId: crypto.randomUUID(), assigneeId } : action === 'accept_delivery' || action === 'request_changes' ? { ...common, action, expectedReportId: reviewed.reportId! } : { ...common, action: action as 'decline' | 'cancel' | 'withdraw' }
      selection = { kind: 'decision', assignmentId: item.id, decision, confirmed: true }
    }
    return window.projectos.organization.assignmentSubmit(selection)
  }, retry: false, onSuccess: value => { setDirty(false); publishDirty(false); setAction(''); setConfirmed(false); onOperation(value); onChanged() },
    onError: async () => { const stored = await window.projectos.organization.assignmentOperation({ id: operationId }).catch(() => null); if (stored) { setDirty(false); publishDirty(false); onOperation(stored.receipt); onChanged() } } })
  const choose = (value: string) => { setOperationId(crypto.randomUUID()); setReviewed({ revision: item.revision, reportId: item.report?.id ?? null }); setAction(value); setConfirmed(false); setDirty(true) }
  const active = ['pending', 'accepted', 'in_progress', 'ready_for_review'].includes(item.status)
  return <article aria-label="组织需求详情" className="assignment-detail">
    <div className="org-section-heading"><h3>{item.title}</h3><span data-testid="assignment-status">{assignmentStatus[item.status]}</span></div>
    <p className="org-item-sub">{item.projectName} · {priorities[item.priority]}优先级 · 负责人 {item.assignee.name} · 派发人 {item.dispatcher.name}</p>
    {item.dueAt ? <p className="org-item-sub">期望完成 {new Date(item.dueAt).toLocaleString()}</p> : null}
    <OrganizationError error={local.error || projects.error || roster.error || submit.error}/>
    {local.data?.requirementId && local.data.projectId ? <button type="button" className="org-button is-primary" disabled={dirty} onClick={() => { closeSettings(); navigate(`/projects/${encodeURIComponent(local.data!.projectId!)}/requirements?requirement=${encodeURIComponent(local.data!.requirementId!)}`) }}>打开本机需求</button> : null}
    {!action ? <div className="org-inline-actions">
      {item.canRespond && item.status === 'pending' ? <><button type="button" className="org-button is-primary" onClick={() => choose('accept')}>接收需求</button><button type="button" className="org-button" onClick={() => choose('decline')}>拒绝接收</button></> : null}
      {item.canRespond && item.status === 'ready_for_review' ? <button type="button" className="org-button" onClick={() => choose('withdraw')}>撤回交付报告</button> : null}
      {item.canManage && item.status === 'ready_for_review' ? <><button type="button" className="org-button is-primary" onClick={() => choose('accept_delivery')}>确认交付通过</button><button type="button" className="org-button" onClick={() => choose('request_changes')}>退回补充开发</button></> : null}
      {item.canManage && active ? <button type="button" className="org-button" onClick={() => choose('cancel')}>撤销分配</button> : null}
      {item.canManage && !['completed', 'reassigned'].includes(item.status) ? <button type="button" className="org-button" onClick={() => choose('reassign')}>改派负责人</button> : null}
    </div> : <form className="assignment-form" aria-label="确认分配操作" onSubmit={event => { event.preventDefault(); if (confirmed && !submit.isPending && reviewed.revision === item.revision) submit.mutate() }}>
      <p className="org-item-sub">{reviewed.revision !== item.revision ? '需求状态已更新，请取消本次操作，核对最新内容后重新选择。' : '提交前请核对下方需求目标与交付证据。'}</p><fieldset disabled={submit.isPending || reviewed.revision !== item.revision}>
        {action === 'accept' ? <><OrganizationField label="接收至本机项目">{field => <select id={field} required value={localProjectId} onChange={event => { setLocalProjectId(event.target.value); setConfirmed(false) }}><option value="">选择已有本机项目</option>{projects.data?.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}</OrganizationField><p className="org-item-sub">接收后创建本机需求；开始分析与开发需另行操作。</p></> : <>
          {action === 'reassign' ? <OrganizationField label="新的需求负责人">{field => <select id={field} required value={assigneeId} onChange={event => { setAssigneeId(event.target.value); setConfirmed(false) }}><option value="">选择新的负责人</option>{roster.data?.members.filter(m => m.id !== item.assignee.id).map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select>}</OrganizationField> : null}
          <OrganizationField label="分配操作说明">{field => <textarea id={field} required minLength={8} maxLength={2000} rows={3} value={note} onChange={event => { setNote(event.target.value); setConfirmed(false) }}/>}</OrganizationField>
          {action === 'cancel' || action === 'reassign' ? <p className="org-item-sub">原分配将关闭，成员不能继续开始新的开发操作；已有本机成果保留。</p> : null}
        </>}
        <label className="kw-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>我已核对当前需求与本次操作，确认提交</label>
      </fieldset><div className="org-inline-actions"><button type="button" className="org-button" disabled={submit.isPending} onClick={() => { setAction(''); setDirty(false); setConfirmed(false) }}>取消本次操作</button><button className="org-button is-primary" disabled={!confirmed || submit.isPending || reviewed.revision !== item.revision}>{submit.isPending ? '正在提交…' : '确认提交分配操作'}</button></div>
    </form>}
    <ol className="ow-handoff" aria-label="需求交付流程">{['成员接收', '本机开发', '组织复核'].map((step, index) => { const current = item.status === 'pending' ? 0 : ['accepted', 'in_progress'].includes(item.status) ? 1 : item.status === 'ready_for_review' ? 2 : item.status === 'completed' ? 3 : -1; return <li key={step} aria-current={index === current ? 'step' : undefined} data-complete={current > index}>{step}</li> })}</ol>
    <pre className="org-knowledge-body">{item.brief.body}</pre><h3>验收条件</h3><ul>{item.brief.acceptanceCriteria.map((value, index) => <li key={index}>{value}</li>)}</ul>
    {item.report ? <section aria-label="成员交付进度"><h3>{item.report.kind === 'delivery' ? '交付报告' : '最近进度'}</h3><p>{item.report.counts.done}/{item.report.counts.total} 项完成 · {item.report.counts.runningRuns} 个运行中</p><p>{item.report.note}</p>
      {item.report.source ? <details open><summary>成员桌面确认的交付证据</summary><ul>{item.report.source.artifacts.map(a => <li key={a.id}>{a.title}</li>)}</ul><p>{item.report.source.acceptanceNote}</p><pre className="kw-evidence">{item.report.source.commits.join('\n')}</pre></details> : null}
    </section> : null}
  </article>
}
