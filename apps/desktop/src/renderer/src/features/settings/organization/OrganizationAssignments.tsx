import { useContext, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Plus, RefreshCw, ChevronLeft } from 'lucide-react'
import type { AssignmentReceipt, OrganizationConnectionView } from '@projectos/contracts'
import { SettingsDraftContext } from '../settings-draft'
import { OrganizationEmpty, OrganizationError, OrganizationField, OrganizationLoading } from './OrganizationPrimitives'
import { organizationScopeKey } from './useOrganization'
import { AssignmentDetail, DispatchForm } from './OrganizationAssignmentForms'
import { AssignmentOperation, AssignmentOperationList, assignmentStatus, assignmentReceiptStatus } from './AssignmentOperations'
import './knowledge.css'
import './assignments.css'

const filters = [
  { key: 'all', label: '全部', statuses: [] as string[] },
  { key: 'pending', label: '待接收', statuses: ['pending'] },
  { key: 'working', label: '开发中', statuses: ['accepted', 'in_progress'] },
  { key: 'review', label: '待复核', statuses: ['ready_for_review'] },
  { key: 'completed', label: '已完成', statuses: ['completed'] },
  { key: 'closed', label: '已关闭', statuses: ['cancelled', 'declined', 'reassigned'] },
]
const priorities = { low: '低', normal: '普通', high: '高', urgent: '紧急' }
export function OrganizationAssignments({ connection }: { connection: OrganizationConnectionView }) {
  const client = useQueryClient(), scope = organizationScopeKey(connection, 'assignments'), { dirty, setDirty } = useContext(SettingsDraftContext)
  const [search, setSearch] = useSearchParams(), selected = search.get('assignment') ?? ''
  const [creating, setCreating] = useState(false), [operation, setOperation] = useState(''), [notice, setNotice] = useState<AssignmentReceipt | null>(null)
  const detailPane = useRef<HTMLDivElement>(null), searchInput = useRef<HTMLInputElement>(null)
  useEffect(() => { if ((selected || creating || operation) && window.matchMedia('(max-width: 1100px)').matches) detailPane.current?.focus() }, [selected, creating, operation])
  const [query, setQuery] = useState(''), [status, setStatus] = useState('all'), [person, setPerson] = useState('all'), [projectId, setProjectId] = useState('')
  const list = useQuery({ queryKey: scope, queryFn: () => window.projectos.organization.assignments(), retry: false, refetchOnWindowFocus: false })
  const projects = useQuery({ queryKey: organizationScopeKey(connection, 'projects'), queryFn: () => window.projectos.organization.projects(), retry: false })
  const detail = useQuery({ queryKey: [...scope, selected], queryFn: () => window.projectos.organization.assignment({ id: selected }), enabled: Boolean(selected), retry: false, refetchOnWindowFocus: false })
  const choose = (id: string) => { const next = new URLSearchParams(search); next.set('view', 'assignments'); if (id) next.set('assignment', id); else next.delete('assignment'); setSearch(next); setCreating(false); setOperation('') }
  const refresh = () => { void client.invalidateQueries({ queryKey: scope }); void client.invalidateQueries({ queryKey: organizationScopeKey(connection, 'assignment-operations') }); void client.invalidateQueries({ queryKey: organizationScopeKey(connection, 'assignment-local') }) }
  const resolved = (receipt: AssignmentReceipt) => { setDirty(false); refresh(); setNotice(receipt); setCreating(false); if (receipt.status === 'confirmed') { setOperation(''); choose(receipt.assignmentId) } else setOperation(receipt.id) }
  const operations = useQuery({ queryKey: organizationScopeKey(connection, 'assignment-operations'), queryFn: () => window.projectos.organization.assignmentOperations(), retry: false, refetchOnWindowFocus: false })
  const outstanding = operations.data?.operations.filter(item => ['sending', 'needs_reconciliation'].includes(item.status)) ?? []
  const account = connection.session?.account.id
  const matching = list.data?.assignments.filter(item => (person === 'all' || (person === 'mine' ? item.assignee.id === account : item.dispatcher.id === account)) && (!projectId || item.projectId === projectId) && (!query.trim() || (item.title + item.assignee.name + item.projectName).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))) ?? []
  const rows = matching.filter(item => status === 'all' || filters.find(filter => filter.key === status)?.statuses.includes(item.status))
  return <section className="organization-assignments ow-assignment-workspace" aria-label="需求分配">
    <div className="org-section-heading"><h2>需求协作</h2><div className="org-inline-actions"><button type="button" className="org-button" aria-label="刷新分配列表" disabled={dirty || list.isFetching} onClick={refresh}><RefreshCw size={16} aria-hidden/>刷新</button>{projects.data?.projects.some(p => ['owner', 'maintainer'].includes(p.role)) ? <button type="button" className="org-button is-primary" disabled={dirty} onClick={() => { setCreating(true); setOperation(''); setNotice(null) }}><Plus size={16} aria-hidden/>派发需求</button> : null}</div></div>
    {notice ? <div className="ow-receipt-notice" role="status"><span>{notice.kind === 'dispatch' ? '派发需求' : notice.kind === 'accept' ? '接收需求' : '分配操作'} · {assignmentReceiptStatus[notice.status]}</span><button type="button" className="org-link" disabled={dirty} onClick={() => setOperation(notice.id)}>查看本次回执</button></div> : null}
    {outstanding.length ? <div className="org-message is-warning" role="status"><span>{outstanding.length} 项操作的结果仍需核对</span><button type="button" className="org-link" disabled={dirty} onClick={() => { setOperation(outstanding[0]!.id); setCreating(false) }}>核对最近操作</button></div> : null}
    <OrganizationError error={list.error || projects.error || operations.error}/>
    <div className="ow-assignment-layout" data-detail={Boolean(selected || creating || operation)}>
      <div className="ow-list-pane">
        <div className="ow-list-filters"><OrganizationField label="查找需求或负责人">{id => <div className="ow-search"><Search size={16} aria-hidden/><input ref={searchInput} id={id} type="search" value={query} disabled={dirty} onChange={event => setQuery(event.target.value)}/></div>}</OrganizationField>
          <div className="org-form-grid"><OrganizationField label="协作范围">{id => <select id={id} value={person} disabled={dirty} onChange={event => setPerson(event.target.value)}><option value="all">全部可见需求</option><option value="mine">分配给我</option><option value="sent">我派发的</option></select>}</OrganizationField>
          <OrganizationField label="筛选共享项目">{id => <select id={id} value={projectId} disabled={dirty} onChange={event => setProjectId(event.target.value)}><option value="">全部项目</option>{projects.data?.projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select>}</OrganizationField></div></div>
        <div className="ow-status-filters" role="group" aria-label="筛选需求状态">{filters.map(filter => <button className="org-button" type="button" key={filter.key} aria-pressed={status === filter.key} disabled={dirty} onClick={() => setStatus(filter.key)}>{filter.label}<span>{matching.filter(item => filter.key === 'all' || filter.statuses.includes(item.status)).length}</span></button>)}</div>
        {list.isPending ? <OrganizationLoading/> : rows.length ? <ul className="ow-assignment-list" aria-label="组织需求">{rows.map(item => <li key={item.id}><button type="button" disabled={dirty} aria-pressed={selected === item.id && !creating} onClick={() => { setNotice(null); choose(item.id) }}><div className="ow-list-row-head"><strong>{item.title}</strong><span className="ow-assignment-state">{assignmentStatus[item.status]}</span></div><span className="ow-row-meta">{item.projectName} · {item.assignee.name}</span><span className="ow-row-meta">{priorities[item.priority]}优先级{item.dueAt ? ' · ' + new Date(item.dueAt).toLocaleDateString() + ' 截止' : ''}</span></button></li>)}</ul> : <OrganizationEmpty title={query || status !== 'all' || person !== 'all' || projectId ? '没有符合筛选的需求' : '暂无组织需求分配'}/>}
        {list.data?.truncated ? <p className="org-item-sub">当前仅显示最近 100 项可见需求，筛选数量以已读取记录为准。</p> : null}
        <details className="ow-operation-history"><summary>本机操作记录与待核对结果</summary><fieldset disabled={dirty}><AssignmentOperationList connection={connection} onOpen={id => { if (!dirty) { setOperation(id); setCreating(false) } }}/></fieldset></details>
      </div>
      <div ref={detailPane} className="ow-detail-pane" tabIndex={-1}>
        {!dirty && (selected || creating || operation) ? <button type="button" className="org-link ow-back-list" onClick={() => { choose(''); setCreating(false); setOperation(''); requestAnimationFrame(() => searchInput.current?.focus()) }}><ChevronLeft size={16} aria-hidden/>返回分配列表</button> : null}
        {operation ? <AssignmentOperation id={operation} connection={connection} onBack={() => { setOperation(''); refresh() }} onResolved={receipt => { setDirty(false); setNotice(receipt); refresh() }}/> : creating ? <DispatchForm connection={connection} projects={projects.data?.projects ?? []} onCancel={() => setCreating(false)} onDone={resolved}/> : selected ? <><OrganizationError error={detail.error}/>{detail.isPending ? <OrganizationLoading/> : detail.data ? <>
          <AssignmentDetail key={selected} connection={connection} assignment={detail.data.assignment} onChanged={refresh} onOperation={resolved}/>
          <details className="ow-audit"><summary>分配操作历史与说明</summary><ul>{detail.data.history.map(h => <li key={h.commandId}><strong>{h.actor.name}</strong> · {h.action}<p>{h.note}</p></li>)}</ul></details>
        </> : null}</> : <OrganizationEmpty title="选择需求查看目标、进度和下一步操作"/>}
      </div>
    </div>
  </section>
}
