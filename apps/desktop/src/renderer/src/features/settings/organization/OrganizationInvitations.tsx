import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Check, X } from 'lucide-react'
import type { OrganizationConnectionView } from '@projectos/contracts'
import { OrganizationEmpty, OrganizationError, OrganizationField, OrganizationLoading, organizationRoleLabel } from './OrganizationPrimitives'
import { organizationScopeKey } from './useOrganization'

export function OrganizationInvitations({ connection, onChanged }: { connection: OrganizationConnectionView; onChanged: () => Promise<void> }) {
  const invitations = useQuery({ queryKey: organizationScopeKey(connection, 'invitations'), queryFn: () => window.projectos.organization.invitations(), retry: false })
  const [codes, setCodes] = useState<Record<string, string>>({})
  const decide = useMutation({ mutationFn: async (input: Parameters<typeof window.projectos.organization.decideInvitation>[0]) => { await window.projectos.organization.decideInvitation(input); await onChanged() } })
  return <section aria-label="待接受邀请"><div className="org-section-heading"><div><h3>待接受邀请</h3><p>当前账号收到的有效组织邀请。</p></div></div><OrganizationError error={invitations.error || decide.error} />
    {invitations.isPending ? <OrganizationLoading /> : invitations.data?.invitations.length ? <ul className="org-invitation-list">{invitations.data.invitations.map((invitation) => <li key={invitation.id}><div className="org-invitation-content"><strong>{invitation.organizationName}</strong><span className="org-item-sub">{organizationRoleLabel(invitation.role)} · {new Date(invitation.expiresAt).toLocaleDateString('zh-CN')} 到期</span><OrganizationField label="邀请人提供的一次性代码">{(id) => <input id={id} data-testid="org-invitation-code" type="password" autoComplete="off" spellCheck={false} value={codes[invitation.id] ?? ''} onChange={(event) => setCodes((previous) => ({ ...previous, [invitation.id]: event.target.value }))} />}</OrganizationField></div><div className="org-inline-actions"><button className="org-button" type="button" disabled={decide.isPending} onClick={() => decide.mutate({ invitationId: invitation.id, decision: 'rejected' })}><X size={14} aria-hidden />拒绝</button><button className="org-button is-primary" type="button" disabled={decide.isPending || !codes[invitation.id]?.trim()} onClick={() => decide.mutate({ invitationId: invitation.id, decision: 'accepted', invitationCode: (codes[invitation.id] ?? '').trim() })}><Check size={14} aria-hidden />接受邀请</button></div></li>)}</ul> : !invitations.isError ? <OrganizationEmpty title="没有待接受的邀请" /> : null}
  </section>
}
