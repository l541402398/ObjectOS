import { useContext, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import type { ApiInput, AssignmentSelection, MemberAssignment, OrganizationConnectionView, SharedProjectView } from '@projectos/contracts'
import { SettingsDraftContext, useSettingsDraft } from '../settings-draft'
import { useUiStore } from '../../../stores/ui'
import { OrganizationEmpty, OrganizationError, OrganizationField, OrganizationLoading } from './OrganizationPrimitives'
import { organizationScopeKey } from './useOrganization'
import { AssignmentOperation, AssignmentOperationList, assignmentStatus } from './AssignmentOperations'
import './knowledge.css'
import './assignments.css'

type Props = { connection: OrganizationConnectionView }
type Decision = ApiInput<'organization.assignmentSubmit'> & { kind: 'decision' }
const priorities = { low: '低', normal: '普通', high: '高', urgent: '紧急' }

function DispatchForm({ connection, projects, onDone, onCancel }: Props & { projects: SharedProjectView[]; onDone: (id: string) => void; onCancel: () => void }) {
  const [id] = useState(() => crypto.randomUUID()), [projectId, setProjectId] = useState(''), [assigneeId, setAssigneeId] = useState('')
  const [title, setTitle] = useState(''), [body, setBody] = useState(''), [criteria, setCriteria] = useState(''), [priority, setPriority] = useState<keyof typeof priorities>('normal'), [due, setDue] = useState('')
  const [confirmed, setConfirmed] = useState(false), [dirty, setDirty] = useState(false), [discard, setDiscard] = useState(false)
  useSettingsDraft(dirty)
  const roster = useQuery({ queryKey: [...organizationScopeKey(connection, 'assignment-roster'), projectId], queryFn: () => window.projectos.organization.assignmentRoster({ projectId }), enabled: Boolean(projectId), retry: false })
  const submit = useMutation({ mutationFn: () => window.projectos.organization.assignmentSubmit({ kind: 'dispatch', confirmed: true, draft: { id, projectId, assigneeId, brief: { title, body, acceptanceCriteria: criteria.split('\n').map(line => line.trim()).filter(Boolean), priority, dueAt: due ? new Date(due).getTime() : null } } }), retry: false,
    onSuccess: value => { setDirty(false); onDone(value.id) }, onError: async () => { if (await window.projectos.organization.assignmentOperation({ id }).catch(() => null)) { setDirty(false); onDone(id) } } })
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
    {discard ? <div className="org-inline-confirm"><p>放弃未提交的分配内容？</p><button className="org-button" type="button" onClick={() => setDiscard(false)}>继续填写</button><button className="org-button" type="button" onClick={onCancel}>放弃填写</button></div> : null}
  </form>
}

function AssignmentDetail({ assignment: item, connection, onChanged, onOperation }: Props & { assignment: MemberAssignment; onChanged: () => void; onOperation: (id: string) => void }) {
  const [operationId] = useState(() => crypto.randomUUID())
  const [action, setAction] = useState(''), [note, setNote] = useState(''), [localProjectId, setLocalProjectId] = useState(''), [assigneeId, setAssigneeId] = useState('')
  const [confirmed, setConfirmed] = useState(false), [dirty, setDirty] = useState(false)
  const navigate = useNavigate(), closeSettings = useUiStore(state => state.closeSettings)
  useSettingsDraft(dirty)
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => window.projectos.projects.list(), enabled: item.canRespond && item.status === 'pending', retry: false })
  const local = useQuery({ queryKey: [...organizationScopeKey(connection, 'assignment-local'), item.id], queryFn: () => window.projectos.organization.assignmentLocal({ id: item.id }), retry: false })
  const roster = useQuery({ queryKey: [...organizationScopeKey(connection, 'assignment-roster'), item.projectId], queryFn: () => window.projectos.organization.assignmentRoster({ projectId: item.projectId }), enabled: item.canManage, retry: false })
  const submit = useMutation({ mutationFn: () => {
    let selection: AssignmentSelection
    if (action === 'accept') selection = { kind: 'accept', id: operationId, assignmentId: item.id, expectedRevision: item.revision, localProjectId, confirmed: true }
    else {
      const common = { commandId: operationId, expectedRevision: item.revision, note }
      const decision: Decision['decision'] = action === 'reassign' ? { ...common, action, newAssignmentId: crypto.randomUUID(), assigneeId } : action === 'accept_delivery' || action === 'request_changes' ? { ...common, action, expectedReportId: item.report!.id } : { ...common, action: action as 'decline' | 'cancel' | 'withdraw' }
      selection = { kind: 'decision', assignmentId: item.id, decision, confirmed: true }
    }
    return window.projectos.organization.assignmentSubmit(selection)
  }, retry: false, onSuccess: value => { setDirty(false); setAction(''); setConfirmed(false); onOperation(value.id); onChanged() },
    onError: async () => { if (await window.projectos.organization.assignmentOperation({ id: operationId }).catch(() => null)) { setDirty(false); onOperation(operationId); onChanged() } } })
  const choose = (value: string) => { setAction(value); setConfirmed(false); setDirty(true) }
  const active = ['pending', 'accepted', 'in_progress', 'ready_for_review'].includes(item.status)
  return <article aria-label="组织需求详情" className="assignment-detail">
    <div className="org-section-heading"><h3>{item.title}</h3><span data-testid="assignment-status">{assignmentStatus[item.status]}</span></div>
    <p className="org-item-sub">{item.projectName} · {priorities[item.priority]}优先级 · 负责人 {item.assignee.name} · 派发人 {item.dispatcher.name}</p>
    {item.dueAt ? <p className="org-item-sub">期望完成 {new Date(item.dueAt).toLocaleString()}</p> : null}
    <pre className="org-knowledge-body">{item.brief.body}</pre><h3>验收条件</h3><ul>{item.brief.acceptanceCriteria.map((value, index) => <li key={index}>{value}</li>)}</ul>
    <OrganizationError error={local.error || projects.error || roster.error || submit.error}/>
    {local.data?.requirementId && local.data.projectId ? <button type="button" className="org-button is-primary" disabled={dirty} onClick={() => { closeSettings(); navigate(`/projects/${encodeURIComponent(local.data!.projectId!)}/requirements?requirement=${encodeURIComponent(local.data!.requirementId!)}`) }}>打开本机需求</button> : null}
    {item.report ? <section aria-label="成员交付进度"><h3>{item.report.kind === 'delivery' ? '交付报告' : '最近进度'}</h3><p>{item.report.counts.done}/{item.report.counts.total} 项完成 · {item.report.counts.runningRuns} 个运行中</p><p>{item.report.note}</p>
      {item.report.source ? <details open><summary>成员桌面确认的交付证据</summary><ul>{item.report.source.artifacts.map(a => <li key={a.id}>{a.title}</li>)}</ul><p>{item.report.source.acceptanceNote}</p><pre className="kw-evidence">{item.report.source.commits.join('\n')}</pre></details> : null}
    </section> : null}
    {!action ? <div className="org-inline-actions">
      {item.canRespond && item.status === 'pending' ? <><button type="button" className="org-button is-primary" onClick={() => choose('accept')}>接收需求</button><button type="button" className="org-button" onClick={() => choose('decline')}>拒绝接收</button></> : null}
      {item.canRespond && item.status === 'ready_for_review' ? <button type="button" className="org-button" onClick={() => choose('withdraw')}>撤回交付报告</button> : null}
      {item.canManage && item.status === 'ready_for_review' ? <><button type="button" className="org-button is-primary" onClick={() => choose('accept_delivery')}>确认交付通过</button><button type="button" className="org-button" onClick={() => choose('request_changes')}>退回补充开发</button></> : null}
      {item.canManage && active ? <button type="button" className="org-button" onClick={() => choose('cancel')}>撤销分配</button> : null}
      {item.canManage && !['completed', 'reassigned'].includes(item.status) ? <button type="button" className="org-button" onClick={() => choose('reassign')}>改派负责人</button> : null}
    </div> : <form className="assignment-form" aria-label="确认分配操作" onSubmit={event => { event.preventDefault(); if (confirmed && !submit.isPending) submit.mutate() }}>
      <fieldset disabled={submit.isPending}>
        {action === 'accept' ? <><OrganizationField label="接收至本机项目">{field => <select id={field} required value={localProjectId} onChange={event => { setLocalProjectId(event.target.value); setConfirmed(false) }}><option value="">选择已有本机项目</option>{projects.data?.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}</OrganizationField><p className="org-item-sub">接收后创建本机需求；开始分析与开发需另行操作。</p></> : <>
          {action === 'reassign' ? <OrganizationField label="新的需求负责人">{field => <select id={field} required value={assigneeId} onChange={event => { setAssigneeId(event.target.value); setConfirmed(false) }}><option value="">选择新的负责人</option>{roster.data?.members.filter(m => m.id !== item.assignee.id).map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select>}</OrganizationField> : null}
          <OrganizationField label="分配操作说明">{field => <textarea id={field} required minLength={8} maxLength={2000} rows={3} value={note} onChange={event => { setNote(event.target.value); setConfirmed(false) }}/>}</OrganizationField>
          {action === 'cancel' || action === 'reassign' ? <p className="org-item-sub">原分配将关闭，成员不能继续开始新的开发操作；已有本机成果保留。</p> : null}
        </>}
        <label className="kw-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>我已核对当前需求与本次操作，确认提交</label>
      </fieldset><div className="org-inline-actions"><button type="button" className="org-button" disabled={submit.isPending} onClick={() => { setAction(''); setDirty(false); setConfirmed(false) }}>取消本次操作</button><button className="org-button is-primary" disabled={!confirmed || submit.isPending}>{submit.isPending ? '正在提交…' : '确认提交分配操作'}</button></div>
    </form>}
  </article>
}

export function OrganizationAssignments({ connection }: Props) {
  const client = useQueryClient(), scope = organizationScopeKey(connection, 'assignments'), { dirty } = useContext(SettingsDraftContext)
  const [selected, setSelected] = useState(''), [creating, setCreating] = useState(false), [operation, setOperation] = useState('')
  const list = useQuery({ queryKey: scope, queryFn: () => window.projectos.organization.assignments(), retry: false, refetchOnWindowFocus: false })
  const projects = useQuery({ queryKey: organizationScopeKey(connection, 'projects'), queryFn: () => window.projectos.organization.projects(), retry: false })
  const detail = useQuery({ queryKey: [...scope, selected], queryFn: () => window.projectos.organization.assignment({ id: selected }), enabled: Boolean(selected), retry: false, refetchOnWindowFocus: false })
  const refresh = () => { void client.invalidateQueries({ queryKey: scope }); void client.invalidateQueries({ queryKey: organizationScopeKey(connection, 'assignment-operations') }); void client.invalidateQueries({ queryKey: organizationScopeKey(connection, 'assignment-local') }) }
  return <section className="organization-assignments" aria-label="需求分配">
    {operation ? <AssignmentOperation id={operation} connection={connection} onBack={() => { setOperation(''); refresh() }} onResolved={refresh}/> : creating ? <DispatchForm connection={connection} projects={projects.data?.projects ?? []} onCancel={() => setCreating(false)} onDone={id => { setCreating(false); setOperation(id); refresh() }}/> : selected ? <>
      <button type="button" className="org-link" disabled={dirty} onClick={() => setSelected('')}>返回分配列表</button><OrganizationError error={detail.error}/>{detail.isFetching ? <OrganizationLoading/> : detail.data ? <AssignmentDetail key={`${selected}:${detail.data.assignment.revision}`} connection={connection} assignment={detail.data.assignment} onChanged={refresh} onOperation={setOperation}/> : null}
      <button type="button" className="org-link" disabled={dirty || detail.isFetching} onClick={() => void detail.refetch()}>刷新分配状态</button>
      {detail.data ? <details><summary>分配操作历史</summary><ul>{detail.data.history.map(h => <li key={h.commandId}>{h.actor.name} · {h.action} · {h.note}</li>)}</ul></details> : null}
    </> : <>
      <div className="org-section-heading"><h3>需求分配</h3><div className="org-inline-actions"><button type="button" className="org-button" disabled={list.isFetching} onClick={() => void list.refetch()}>刷新分配列表</button>{projects.data?.projects.some(p => ['owner', 'maintainer'].includes(p.role)) ? <button type="button" className="org-button is-primary" onClick={() => setCreating(true)}>派发需求</button> : null}</div></div>
      <OrganizationError error={list.error || projects.error}/>{list.isPending ? <OrganizationLoading/> : list.data?.assignments.length ? <div className="org-table-wrap"><table className="org-table"><caption className="org-sr-only">已分配及收到的组织需求</caption><thead><tr><th scope="col">需求</th><th scope="col">负责人</th><th scope="col">状态</th></tr></thead><tbody>{list.data.assignments.map(item => <tr key={item.id}><td><button type="button" className="org-asset-name" onClick={() => setSelected(item.id)}>{item.title}</button><span className="org-item-sub">{item.projectName} · {priorities[item.priority]}优先级</span></td><td>{item.assignee.name}</td><td>{assignmentStatus[item.status]}</td></tr>)}</tbody></table></div> : <OrganizationEmpty title="暂无组织需求分配"/>}
      {list.data?.truncated ? <p role="status">仅显示最近 100 项分配。</p> : null}
      <AssignmentOperationList connection={connection} onOpen={setOperation}/>
    </>}
  </section>
}
