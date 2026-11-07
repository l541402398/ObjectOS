import { useId, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { ApiOutput, OrganizationConnectionView, RequirementKnowledgeView } from '@projectos/contracts'
import { DialogShell, OverlayFooter, OverlayHeader, OverlayScrollArea, useOverlayDismiss } from '../next-ui/overlay/overlay-shell'
import { OrganizationEmpty, OrganizationError, OrganizationField, OrganizationLoading } from '../features/settings/organization/OrganizationPrimitives'
import { organizationConnectionKey, organizationScopeKey } from '../features/settings/organization/useOrganization'
import '../features/settings/organization/organization.css'
import '../features/settings/organization/knowledge.css'
import { KnowledgeWriteback } from './KnowledgeWriteback'
import { RequirementAssignment } from './RequirementAssignment'

type Source = ApiOutput<'organization.searchKnowledge'>['results'][number]
type Selected = Pick<Source, 'documentId' | 'versionId' | 'checksum' | 'title' | 'version' | 'category'> & { reason: string }
function CancelReferenceEdit({ disabled }: { disabled: boolean }) {
  const dismiss = useOverlayDismiss()
  return <button className="org-button" type="button" disabled={disabled} onClick={dismiss}>取消</button>
}

function ReferenceEditor({ requirementId, current, connection, onSaved, onClose, assignedProjectId }: {
  requirementId: string; current: RequirementKnowledgeView; connection: OrganizationConnectionView; onSaved: () => Promise<unknown>; onClose: () => void; assignedProjectId?: string
}) {
  const formId = useId()
  const [projectId, setProjectId] = useState(assignedProjectId ?? current.binding?.projectId ?? '')
  const [query, setQuery] = useState(''), [search, setSearch] = useState<{ projectId: string; query: string } | null>(null)
  const [selected, setSelected] = useState<Selected[]>(current.binding?.pins ?? [])
  const [dirty, setDirty] = useState(false)
  const projects = useQuery({ queryKey: organizationScopeKey(connection, 'projects'), queryFn: () => window.projectos.organization.projects(), retry: false })
  const results = useQuery({ queryKey: [...organizationScopeKey(connection, 'knowledge-search'), search],
    queryFn: () => window.projectos.organization.searchKnowledge({ projectId: search!.projectId, query: search!.query }), enabled: Boolean(search), retry: false, gcTime: 0 })
  const save = useMutation({ mutationFn: () => window.projectos.organization.setRequirementKnowledge({ requirementId, expectedRevision: current.revision, projectId,
    pins: selected.map(({ documentId, versionId, checksum, reason }) => ({ documentId, versionId, checksum, reason })) }),
  onSuccess: async () => { setDirty(false); await onSaved(); onClose() }, gcTime: 0 })
  const toggle = (source: Source, checked: boolean) => {
    setSelected(prior => checked ? [...prior.filter(pin => pin.documentId !== source.documentId), { ...source, reason: '' }] : prior.filter(pin => pin.versionId !== source.versionId))
    setDirty(true)
  }
  return <DialogShell open dirty={dirty} onOpenChange={open => { if (!open && !save.isPending) onClose() }} ariaLabel="选择组织资料" width={850}>
    <OverlayHeader title="选择组织资料"/>
    <OverlayScrollArea><form className="rq-organization-knowledge" id={formId} onSubmit={event => { event.preventDefault(); if (!save.isPending) save.mutate() }}>
      <OrganizationError error={projects.error || results.error || save.error}/>
      {projects.isPending ? <OrganizationLoading/> : <>
        <OrganizationField label="共享项目">{id => <select id={id} required value={projectId} disabled={save.isPending || Boolean(assignedProjectId)} onChange={event => { setProjectId(event.target.value); setSelected([]); setSearch(null); setDirty(true) }}><option value="">选择本次需求使用的共享项目</option>{projects.data?.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}</OrganizationField>
        <div className="rq-knowledge-search"><OrganizationField label="检索组织资料">{id => <input id={id} type="search" value={query} maxLength={200} onChange={event => setQuery(event.target.value)}/>}</OrganizationField><button type="button" className="org-button" disabled={!projectId || results.isFetching || save.isPending} onClick={() => setSearch({ projectId, query })}>查找资料</button></div>
        {results.isFetching ? <OrganizationLoading/> : search ? results.data?.results.length ? <ul className="rq-knowledge-sources">{results.data.results.map(source => {
          const checked = selected.some(pin => pin.versionId === source.versionId)
          return <li key={source.versionId}><label className="rq-knowledge-source-heading"><input type="checkbox" checked={checked} disabled={save.isPending || (!checked && selected.length >= 8)} onChange={event => toggle(source, event.target.checked)}/><strong>{source.title}</strong></label><p className="rq-knowledge-source-meta">{source.category === 'business' ? '业务资料' : '技术资料'} · {source.version}</p><p>{source.excerpt}</p></li>
        })}</ul> : <OrganizationEmpty title="没有匹配的已发布资料"/> : null}
        <h3>已选资料 {selected.length}/8</h3><ul className="rq-knowledge-sources">{selected.map(source => <li key={source.versionId}><div className="org-section-heading"><strong>{source.title} · {source.version}</strong><button type="button" className="org-link" disabled={save.isPending} onClick={() => { setSelected(prior => prior.filter(pin => pin.versionId !== source.versionId)); setDirty(true) }}>移除资料</button></div><OrganizationField label={`引用理由：${source.title}`}>{id => <textarea id={id} rows={2} required maxLength={300} value={source.reason} disabled={save.isPending} onChange={event => { setSelected(prior => prior.map(pin => pin.versionId === source.versionId ? { ...pin, reason: event.target.value } : pin)); setDirty(true) }}/>}</OrganizationField></li>)}</ul>
      </>}
    </form></OverlayScrollArea>
    <OverlayFooter><CancelReferenceEdit disabled={save.isPending}/><button className="org-button is-primary" type="submit" form={formId} disabled={!projectId || save.isPending || projects.isPending}>{save.isPending ? '正在保存…' : '保存引用'}</button></OverlayFooter>
  </DialogShell>
}

export function RequirementOrganizationKnowledge({ requirementId }: { requirementId: string }) {
  const [editing, setEditing] = useState(false)
  const connection = useQuery({ queryKey: organizationConnectionKey, queryFn: () => window.projectos.organization.status({ refresh: true }), staleTime: 30_000, retry: false })
  const knowledge = useQuery({ queryKey: ['requirement-organization-knowledge', requirementId], queryFn: () => window.projectos.requirements.knowledge(requirementId), refetchInterval: 5000, retry: false })
  const assignment = useQuery({ queryKey: ['requirement-assignment', requirementId], queryFn: () => window.projectos.requirements.assignment(requirementId), retry: false })
  const data = knowledge.data, linked = data?.binding
  const origin = assignment.data?.binding ?? linked
  const matching = !origin || (origin.serverUrl === connection.data?.serverUrl && origin.organizationId === connection.data.activeOrganizationId && origin.accountId === connection.data.session?.account.id)
  const available = assignment.isSuccess && connection.data?.status === 'connected' && Boolean(connection.data.activeOrganizationId) && matching
  return <section className="rq-organization-knowledge" aria-label="需求组织资料">
    {assignment.data?.binding ? <RequirementAssignment requirementId={requirementId} binding={assignment.data.binding} connection={connection.data}/> : null}
    <div className="org-section-heading"><h3>组织资料</h3><button className="org-button is-primary" type="button" disabled={!available || !data || data.locked} onClick={() => setEditing(true)}>选择组织资料</button></div>
    <OrganizationError error={knowledge.error || connection.error || assignment.error}/>
    {knowledge.isPending ? <OrganizationLoading/> : linked ? <><p className="rq-knowledge-source-meta">{data.locked ? '本次引用已固定，后续版本不会替换。' : '生成计划或开始流程时固定引用。'}</p><ul className="rq-knowledge-sources">{linked.pins.map(pin => <li key={pin.versionId}><strong>{pin.title} · {pin.version}</strong><p>{pin.reason}</p><p className="rq-knowledge-source-meta">{pin.checksum}</p></li>)}</ul>{!available ? <p role="status">请连接引用所属组织后再开始分析。</p> : null}</> : <p role="status">{data?.locked ? '本次需求已使用本地上下文开始分析，资料范围已固定。' : available ? '尚未选择组织资料；当前使用本地项目上下文。' : '个人模式使用本地项目上下文。连接组织后可选择组织资料。'}</p>}
    <KnowledgeWriteback requirementId={requirementId} connection={connection.data} available={available} initialProjectId={assignment.data?.binding?.projectId ?? linked?.projectId}/>
    {editing && available && data && connection.data ? <ReferenceEditor requirementId={requirementId} current={data} connection={connection.data} assignedProjectId={assignment.data?.binding?.projectId} onSaved={() => knowledge.refetch()} onClose={() => setEditing(false)}/> : null}
  </section>
}
