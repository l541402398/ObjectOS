import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Mail, UserRound } from 'lucide-react'
import type { OrganizationConnectionView, OrganizationMemberView } from '@projectos/contracts'
import { OrganizationEmpty, OrganizationError, OrganizationField, OrganizationLoading, organizationRoleLabel } from './OrganizationPrimitives'
import { organizationScopeKey } from './useOrganization'

function InviteMemberForm({ owner, onSaved }: { owner: boolean; onSaved: () => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [showCode, setShowCode] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const invite = useMutation({ gcTime: 0, mutationFn: async () => { const result = await window.projectos.organization.invite({ email: email.trim(), role }); await onSaved(); setShowCode(false); setCopied(false); return result } })
  const copyCode = async () => {
    if (!invite.data?.invitationCode) return
    try { await navigator.clipboard.writeText(invite.data.invitationCode); setCopied(true); setCopyError(null) }
    catch { setCopyError('复制失败，请显示代码后手动复制。') }
  }
  return <form className="org-inline-form" aria-label="邀请组织成员" onSubmit={(event) => { event.preventDefault(); invite.mutate() }}>
    <div className="org-form-heading"><h4>邀请成员</h4></div>
    <div className="org-form-grid">
      <OrganizationField label="成员邮箱">{(id) => <input id={id} data-testid="org-invite-email" required type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); invite.reset() }} placeholder="name@example.com" />}</OrganizationField>
      <OrganizationField label="组织角色">{(id) => <select id={id} value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="member">成员</option>{owner ? <option value="admin">管理员</option> : null}</select>}</OrganizationField>
    </div>
    <OrganizationError error={invite.error} />
    {invite.isSuccess ? <div className="org-invite-code"><p className="org-message" role="status">邀请已创建。请将一次性代码通过可信渠道发给受邀人；关闭此表单后不再显示。</p><OrganizationField label="一次性邀请代码">{(id) => <input id={id} data-testid="org-generated-invitation-code" type={showCode ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={invite.data.invitationCode} readOnly />}</OrganizationField><div className="org-inline-actions"><button type="button" className="org-link" onClick={() => setShowCode(!showCode)}>{showCode ? '隐藏代码' : '显示代码'}</button><button type="button" className="org-button" onClick={() => void copyCode()}>{copied ? '已复制' : '复制代码'}</button></div>{copyError ? <p className="org-message is-error" role="alert">{copyError}</p> : null}</div> : null}
    <div className="org-form-actions"><button className="org-button is-primary" type="submit" disabled={invite.isPending} data-testid="org-invite-submit"><Mail size={15} aria-hidden />{invite.isPending ? '正在创建…' : '创建邀请'}</button></div>
  </form>
}

function MemberEditor({ member, owner, onSaved, onCancel }: { member: OrganizationMemberView; owner: boolean; onSaved: () => Promise<void>; onCancel: () => void }) {
  const [role, setRole] = useState<'admin' | 'member'>(member.role === 'admin' ? 'admin' : 'member')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const action = useMutation({ mutationFn: async (operation: 'save' | 'remove') => {
    if (operation === 'remove') await window.projectos.organization.removeMember({ memberId: member.id })
    else await window.projectos.organization.changeMember({ memberId: member.id, role })
    await onSaved(); onCancel()
  } })
  return <section className="org-inline-form" aria-label={`${member.name} 的组织权限`}>
    <div className="org-form-heading"><h4>{member.name} · 组织权限</h4><button className="org-link" type="button" onClick={onCancel}>收起</button></div>
    {owner ? <form className="org-compact-form" onSubmit={(event) => { event.preventDefault(); action.mutate('save') }}><OrganizationField label="组织角色">{(id) => <select id={id} value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="member">成员</option><option value="admin">管理员</option></select>}</OrganizationField><button className="org-button" type="submit" disabled={action.isPending || role === member.role}>保存角色</button></form> : null}
    <OrganizationError error={action.error} />
    <div className="org-member-danger">{confirmRemove ? <><p>移除后，该成员将失去此组织及项目的访问权限。</p><button className="org-button is-danger" type="button" disabled={action.isPending} onClick={() => action.mutate('remove')}>确认移除 {member.name}</button><button className="org-link" type="button" onClick={() => setConfirmRemove(false)}>取消</button></> : <button className="org-link is-danger" type="button" onClick={() => setConfirmRemove(true)}>移除成员</button>}</div>
  </section>
}

export function OrganizationMembers({ connection }: { connection: OrganizationConnectionView }) {
  const query = useQuery({ queryKey: organizationScopeKey(connection, 'members'), queryFn: () => window.projectos.organization.members(), retry: false })
  const organization = connection.session?.organizations.find((item) => item.id === connection.activeOrganizationId)
  const owner = organization?.role === 'owner'
  const manager = owner || organization?.role === 'admin'
  const [inviting, setInviting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = query.data?.members.find((member) => member.id === editingId)
  const saved = async () => { await query.refetch() }
  return <section aria-label="组织成员">
    <div className="org-section-heading"><div><h3>组织成员</h3><p>组织角色与项目权限分别管理。</p></div>{manager ? <button type="button" className="org-button" data-testid="org-new-invite" onClick={() => { setInviting(!inviting); setEditingId(null) }}><Mail size={15} aria-hidden />邀请成员</button> : null}</div>
    {inviting ? <InviteMemberForm owner={owner} onSaved={saved} /> : null}
    <OrganizationError error={query.error} />
    {query.isPending ? <OrganizationLoading /> : query.data?.members.length ? <div className="org-table-wrap"><table className="org-table"><caption className="org-sr-only">当前组织成员</caption><thead><tr><th scope="col">成员</th><th scope="col">组织角色</th><th scope="col"><span className="org-sr-only">操作</span></th></tr></thead><tbody>{query.data.members.map((member) => <tr key={member.id}><td><div className="org-item-identity"><span className="org-row-icon"><UserRound size={17} aria-hidden /></span><div><strong>{member.name}{member.accountId === connection.session?.account.id ? <span className="org-you">你</span> : null}</strong><span className="org-item-sub">{member.email}</span></div></div></td><td><span className="org-role">{organizationRoleLabel(member.role)}</span></td><td>{manager && member.role !== 'owner' && member.accountId !== connection.session?.account.id && (owner || member.role === 'member') ? <button type="button" className="org-link" onClick={() => { setEditingId(editingId === member.id ? null : member.id); setInviting(false) }} aria-expanded={editingId === member.id}>管理</button> : null}</td></tr>)}</tbody></table></div> : !query.isError ? <OrganizationEmpty title="暂无可见成员" /> : null}
    {editing ? <MemberEditor key={editing.id} member={editing} owner={owner} onSaved={saved} onCancel={() => setEditingId(null)} /> : null}
  </section>
}
