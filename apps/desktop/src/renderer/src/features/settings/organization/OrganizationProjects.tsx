import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Folder, Plus, Users } from 'lucide-react'
import type { OrganizationConnectionView, SharedProjectView } from '@projectos/contracts'
import { CreateSharedProjectForm } from './OrganizationForms'
import { OrganizationEmpty, OrganizationError, OrganizationField, OrganizationLoading, projectRoleLabel } from './OrganizationPrimitives'
import { organizationScopeKey } from './useOrganization'

const PROJECT_ROLES = ['maintainer', 'contributor', 'reviewer', 'viewer'] as const

function ProjectMemberEditor({ project, connection, onClose }: { project: SharedProjectView; connection: OrganizationConnectionView; onClose: () => void }) {
  const members = useQuery({ queryKey: organizationScopeKey(connection, 'members'), queryFn: () => window.projectos.organization.members(), retry: false })
  const [accountId, setAccountId] = useState('')
  const [role, setRole] = useState<(typeof PROJECT_ROLES)[number]>('viewer')
  const save = useMutation({ mutationFn: () => window.projectos.organization.setProjectMember({ projectId: project.id, accountId, role }) })
  return <form className="org-inline-form" aria-label={`${project.name} 的成员权限`} onSubmit={(event) => { event.preventDefault(); save.mutate() }}>
    <div className="org-form-heading"><h4>{project.name} · 成员权限</h4><button type="button" className="org-link" onClick={onClose}>收起</button></div>
    <div className="org-form-grid">
      <OrganizationField label="组织成员">{(id) => <select id={id} required value={accountId} onChange={(event) => { setAccountId(event.target.value); save.reset() }}><option value="">选择成员</option>{(members.data?.members ?? []).filter((member) => member.accountId !== connection.session?.account.id).map((member) => <option value={member.accountId} key={member.id}>{member.name} · {member.email}</option>)}</select>}</OrganizationField>
      <OrganizationField label="项目角色">{(id) => <select id={id} value={role} onChange={(event) => { setRole(event.target.value as typeof role); save.reset() }}>{PROJECT_ROLES.map((item) => <option key={item} value={item}>{projectRoleLabel(item)}</option>)}</select>}</OrganizationField>
    </div>
    <OrganizationError error={members.error || save.error} />
    {save.isSuccess ? <p className="org-message" role="status">项目权限已保存。</p> : null}
    <div className="org-form-actions"><button className="org-button is-primary" type="submit" disabled={!accountId || save.isPending}>{save.isPending ? '正在保存…' : '保存项目权限'}</button></div>
  </form>
}

export function OrganizationProjects({ connection }: { connection: OrganizationConnectionView }) {
  const query = useQuery({ queryKey: organizationScopeKey(connection, 'projects'), queryFn: () => window.projectos.organization.projects(), enabled: Boolean(connection.activeOrganizationId), retry: false })
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const organization = connection.session?.organizations.find((item) => item.id === connection.activeOrganizationId)
  const canCreate = organization?.role === 'owner' || organization?.role === 'admin'
  const editing = query.data?.projects.find((project) => project.id === editingId)
  return <section aria-label="共享项目">
    <div className="org-section-heading"><div><h3>共享项目</h3><p>仅显示你拥有项目访问权限的记录。</p></div>{canCreate ? <button type="button" className="org-button" data-testid="org-new-project" onClick={() => { setCreating(!creating); setEditingId(null) }}><Plus size={15} aria-hidden />创建项目</button> : null}</div>
    {creating ? <CreateSharedProjectForm onSaved={async () => { await query.refetch() }} onCancel={() => setCreating(false)} /> : null}
    <OrganizationError error={query.error} />
    {query.isPending ? <OrganizationLoading /> : query.data?.projects.length ? <div className="org-table-wrap"><table className="org-table"><caption className="org-sr-only">当前组织共享项目</caption><thead><tr><th scope="col">项目</th><th scope="col">我的权限</th><th scope="col"><span className="org-sr-only">操作</span></th></tr></thead><tbody>{query.data.projects.map((project) => <tr key={project.id}>
      <td><div className="org-item-identity"><span className="org-row-icon"><Folder size={18} aria-hidden /></span><div><strong>{project.name}</strong><span className="org-item-sub"><code>{project.key}</code>{project.description ? ` · ${project.description}` : ''}</span></div></div></td>
      <td><span className="org-role">{projectRoleLabel(project.role)}</span></td>
      <td>{project.role === 'owner' ? <button type="button" className="org-link" onClick={() => { setEditingId(editingId === project.id ? null : project.id); setCreating(false) }} aria-expanded={editingId === project.id}><Users size={14} aria-hidden />成员权限</button> : null}</td>
    </tr>)}</tbody></table></div> : !query.isError ? <OrganizationEmpty title="还没有可访问的共享项目">{canCreate ? '创建项目，或接受其他项目负责人的授权。' : '请联系项目负责人授予访问权限。'}</OrganizationEmpty> : null}
    {editing ? <ProjectMemberEditor key={editing.id} project={editing} connection={connection} onClose={() => setEditingId(null)} /> : null}
    <p className="org-boundary-note">共享项目用于团队协作，不会自动关联本机目录或获得本机执行权限。</p>
  </section>
}
