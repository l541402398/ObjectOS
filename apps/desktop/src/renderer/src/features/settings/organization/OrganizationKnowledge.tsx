import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Plus, RefreshCw } from 'lucide-react'
import { OrganizationKnowledgeContentSchema, type OrganizationConnectionView, type OrganizationKnowledgeDetail, type SharedProjectView } from '@projectos/contracts'
import { OrganizationEmpty, OrganizationError, OrganizationField, OrganizationLoading } from './OrganizationPrimitives'
import { organizationScopeKey } from './useOrganization'
import { useSettingsDraft } from '../settings-draft'
import './assets.css'
import './knowledge.css'

const categoryLabel = { technical: '技术资料', business: '业务资料' }
const statusLabel = { draft: '草稿', published: '已发布', deprecated: '已废弃', revoked: '已撤销' }
type Version = OrganizationKnowledgeDetail['versions'][number]
type Editor = { kind: 'create' } | { kind: 'edit' | 'version'; detail: OrganizationKnowledgeDetail; initial: Version }

function KnowledgeEditor({ editor, projects, onSaved, onCancel }: {
  editor: Editor; projects: SharedProjectView[]; onSaved: (detail: OrganizationKnowledgeDetail) => void; onCancel: () => void
}) {
  const initial = editor.kind === 'create' ? null : editor.initial
  const [title, setTitle] = useState(initial?.content.title ?? '')
  const [body, setBody] = useState(initial?.content.body ?? '')
  const [tags, setTags] = useState(initial?.content.tags.join('，') ?? '')
  const [category, setCategory] = useState<'technical' | 'business'>(editor.kind === 'create' ? 'technical' : editor.detail.document.category)
  const [projectId, setProjectId] = useState(editor.kind === 'create' ? '' : editor.detail.document.projectId ?? '')
  const [version, setVersion] = useState(editor.kind === 'version' ? editor.initial.version.replace(/\d+$/, n => String(Number(n) + 1)) : initial?.version ?? '1.0.0')
  const [dirty, setDirty] = useState(false), [discard, setDiscard] = useState(false)
  useSettingsDraft(dirty)
  const save = useMutation({ mutationFn: async () => {
    const parsed = OrganizationKnowledgeContentSchema.safeParse({ title, body, tags: tags.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean) })
    if (!parsed.success) throw new Error('请检查标题、正文和标签；资料不能包含密钥。')
    const content = parsed.data
    if (editor.kind === 'edit') return window.projectos.organization.updateKnowledgeDraft({ documentId: editor.detail.document.id, versionId: editor.initial.id, expectedRevision: editor.initial.revision, content })
    if (editor.kind === 'version') return window.projectos.organization.createKnowledgeVersion({ documentId: editor.detail.document.id, version, content })
    return window.projectos.organization.createKnowledge({ category, visibility: projectId ? 'project' : 'organization', projectId: projectId || null, version, content })
  }, onSuccess: detail => { setDirty(false); onSaved(detail) }, gcTime: 0 })
  return <form className="org-knowledge-editor" aria-label="知识资料编辑" onChange={() => { setDirty(true); save.reset() }} onSubmit={event => { event.preventDefault(); if (!save.isPending) save.mutate() }}>
    <div className="org-section-heading"><h3>{editor.kind === 'create' ? '新增知识' : editor.kind === 'edit' ? '编辑草稿' : '新建知识版本'}</h3></div>
    <OrganizationError error={save.error}/>
    <fieldset disabled={save.isPending}>
      <div className="org-form-grid">
        <OrganizationField label="资料类型">{id => <select id={id} value={category} disabled={editor.kind !== 'create'} onChange={event => setCategory(event.target.value as typeof category)}><option value="technical">技术资料</option><option value="business">业务资料</option></select>}</OrganizationField>
        <OrganizationField label="可见范围">{id => <select id={id} value={projectId} disabled={editor.kind !== 'create'} onChange={event => setProjectId(event.target.value)}><option value="">组织成员</option>{projects.filter(project => ['owner', 'maintainer'].includes(project.role)).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}</OrganizationField>
        <OrganizationField label="资料标题">{id => <input id={id} value={title} onChange={event => setTitle(event.target.value)} maxLength={160} required/>}</OrganizationField>
        <OrganizationField label="版本号">{id => <input id={id} value={version} disabled={editor.kind === 'edit'} onChange={event => setVersion(event.target.value)} pattern="(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)" required/>}</OrganizationField>
      </div>
      <OrganizationField label="标签">{id => <input id={id} value={tags} onChange={event => setTags(event.target.value)} maxLength={650} placeholder="用逗号分隔"/>}</OrganizationField>
      <OrganizationField label="资料正文">{id => <textarea id={id} rows={13} value={body} onChange={event => setBody(event.target.value)} maxLength={20000} required/>}</OrganizationField>
    </fieldset>
    <div className="org-inline-actions"><button type="button" className="org-button" disabled={save.isPending} onClick={() => dirty ? setDiscard(true) : onCancel()}>取消编辑</button><button className="org-button is-primary" disabled={save.isPending}>{save.isPending ? '正在保存…' : '保存草稿'}</button></div>
    {discard ? <div className="org-inline-confirm" role="group" aria-label="放弃知识编辑"><p>放弃未保存的更改？</p><div className="org-inline-actions"><button type="button" className="org-button" onClick={() => setDiscard(false)}>继续编辑</button><button type="button" className="org-button is-danger" onClick={onCancel}>放弃更改</button></div></div> : null}
  </form>
}

function KnowledgeDetail({ detail, onBack, onEdit, onSaved }: {
  detail: OrganizationKnowledgeDetail; onBack: () => void; onEdit: (editor: Editor) => void; onSaved: (detail: OrganizationKnowledgeDetail) => void
}) {
  const [selected, setSelected] = useState(detail.versions[0]!.id)
  const [confirmation, setConfirmation] = useState<'publish' | 'deprecate' | 'revoke' | null>(null)
  const version = detail.versions.find(version => version.id === selected) ?? detail.versions[0]!
  const action = useMutation({ mutationFn: async (operation: 'publish' | 'deprecate' | 'revoke') => window.projectos.organization.transitionKnowledge({ documentId: detail.document.id, versionId: version.id, expectedRevision: version.revision, action: operation }), onSuccess: result => { setConfirmation(null); onSaved(result) }, gcTime: 0 })
  return <article className="org-knowledge-detail" aria-label="知识资料详情">
    <button className="org-link" type="button" onClick={onBack}>返回知识列表</button>
    <div className="org-section-heading"><div><h3>{version.content.title}</h3><p>{categoryLabel[detail.document.category]} · {detail.document.visibility === 'project' ? '项目私有' : '组织成员'}</p></div><span className={`org-asset-status is-${version.status}`} data-testid="knowledge-status">{statusLabel[version.status]}</span></div>
    <OrganizationField label="查看版本">{id => <select id={id} value={version.id} disabled={action.isPending} onChange={event => { setSelected(event.target.value); setConfirmation(null) }}>{detail.versions.map(version => <option key={version.id} value={version.id}>{version.version} · {statusLabel[version.status]}</option>)}</select>}</OrganizationField>
    <div className="org-knowledge-meta"><span>{version.content.tags.join(' · ')}</span><code>{version.checksum}</code></div>
    <pre className="org-knowledge-body">{version.content.body}</pre>
    <OrganizationError error={action.error}/>
    {detail.document.canManage ? <div className="org-inline-actions">
      {version.status === 'draft' ? <><button type="button" className="org-button" onClick={() => onEdit({ kind: 'edit', detail, initial: version })}>编辑草稿</button><button type="button" className="org-button is-primary" onClick={() => setConfirmation('publish')}>发布知识</button></> : <button type="button" className="org-button" onClick={() => onEdit({ kind: 'version', detail, initial: version })}>新建知识版本</button>}
      {version.status === 'published' ? <button type="button" className="org-button" onClick={() => setConfirmation('deprecate')}>废弃版本</button> : null}
      {['published', 'deprecated'].includes(version.status) ? <button type="button" className="org-link is-danger" onClick={() => setConfirmation('revoke')}>撤销版本</button> : null}
    </div> : null}
    {confirmation ? <div className="org-inline-confirm" role="group" aria-label="确认知识版本操作"><p>{confirmation === 'publish' ? '发布后正文不可修改；后续修改须创建新版本。' : confirmation === 'revoke' ? '撤销后不能恢复，此版本将停止用于新的需求分析与执行。' : '废弃后不再用于新的需求分析与执行，历史记录保留。'}</p><div className="org-inline-actions"><button type="button" className="org-button" disabled={action.isPending} onClick={() => setConfirmation(null)}>取消操作</button><button type="button" className={`org-button ${confirmation === 'revoke' ? 'is-danger' : 'is-primary'}`} disabled={action.isPending} onClick={() => action.mutate(confirmation)}>确认{confirmation === 'publish' ? '发布' : confirmation === 'revoke' ? '撤销' : '废弃'}</button></div></div> : null}
  </article>
}

export function OrganizationKnowledge({ connection }: { connection: OrganizationConnectionView }) {
  const client = useQueryClient(), scope = organizationScopeKey(connection, 'knowledge')
  const [selected, setSelected] = useState(''), [editor, setEditor] = useState<Editor | null>(null), [query, setQuery] = useState(''), [category, setCategory] = useState('')
  const list = useQuery({ queryKey: scope, queryFn: () => window.projectos.organization.knowledgeList(), retry: false })
  const projects = useQuery({ queryKey: organizationScopeKey(connection, 'projects'), queryFn: () => window.projectos.organization.projects(), retry: false })
  const detail = useQuery({ queryKey: [...scope, selected], queryFn: () => window.projectos.organization.knowledgeDetail({ documentId: selected }), enabled: Boolean(selected), retry: false, gcTime: 0 })
  const role = connection.session?.organizations.find(org => org.id === connection.activeOrganizationId)?.role
  const saved = (value: OrganizationKnowledgeDetail) => { client.setQueryData([...scope, value.document.id], value); setSelected(value.document.id); setEditor(null); void client.invalidateQueries({ queryKey: scope, exact: true }) }
  const rows = list.data?.documents.filter(document => (!category || document.category === category) && document.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? []
  return <section className="org-knowledge" aria-label="组织知识" data-testid="organization-knowledge">
    {editor ? projects.isPending ? <OrganizationLoading/> : projects.error ? <><OrganizationError error={projects.error}/><button className="org-button" onClick={() => void projects.refetch()}>重新读取项目</button></> : <KnowledgeEditor editor={editor} projects={projects.data?.projects ?? []} onSaved={saved} onCancel={() => setEditor(null)}/> : selected ? <><OrganizationError error={detail.error}/>{detail.isPending ? <OrganizationLoading/> : detail.data ? <KnowledgeDetail key={selected} detail={detail.data} onSaved={saved} onBack={() => setSelected('')} onEdit={setEditor}/> : <button className="org-button" onClick={() => setSelected('')}>返回知识列表</button>}</> : <>
      <div className="org-section-heading"><h3>组织知识</h3><div className="org-inline-actions"><button type="button" className="org-button" aria-label="刷新知识列表" disabled={list.isFetching} onClick={() => void list.refetch()}><RefreshCw size={16} aria-hidden/></button>{role === 'owner' || role === 'admin' ? <button type="button" className="org-button is-primary" onClick={() => setEditor({ kind: 'create' })}><Plus size={16} aria-hidden/>新增知识</button> : null}</div></div>
      <div className="org-form-grid"><OrganizationField label="搜索知识标题">{id => <input id={id} type="search" value={query} onChange={event => setQuery(event.target.value)}/>}</OrganizationField><OrganizationField label="筛选资料类型">{id => <select id={id} value={category} onChange={event => setCategory(event.target.value)}><option value="">全部资料</option><option value="technical">技术资料</option><option value="business">业务资料</option></select>}</OrganizationField></div>
      <OrganizationError error={list.error}/>{list.isPending ? <OrganizationLoading/> : rows.length ? <div className="org-table-wrap"><table className="org-table"><caption className="org-sr-only">可访问的组织技术与业务知识</caption><thead><tr><th scope="col">资料</th><th scope="col">版本</th><th scope="col">状态</th></tr></thead><tbody>{rows.map(document => <tr key={document.id}><td><div className="org-item-identity"><BookOpen size={19} aria-hidden/><div><button type="button" className="org-asset-name" onClick={() => setSelected(document.id)}>{document.title}</button><span className="org-item-sub">{categoryLabel[document.category]} · {document.projectId ? '项目私有' : '组织成员'}</span></div></div></td><td>{document.version}</td><td><span className={`org-asset-status is-${document.status}`}>{statusLabel[document.status]}</span></td></tr>)}</tbody></table></div> : <OrganizationEmpty title={query || category ? '没有匹配的资料' : '暂无可访问的组织知识'}/>} 
    </>}
  </section>
}
