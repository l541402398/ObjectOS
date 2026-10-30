import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'motion/react'
import { Building2, Cloud, LogOut, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { ConnectOrganizationForm, CreateOrganizationForm } from './organization/OrganizationForms'
import { OrganizationProjects } from './organization/OrganizationProjects'
import { OrganizationMembers } from './organization/OrganizationMembers'
import { OrganizationInvitations } from './organization/OrganizationInvitations'
import { OrganizationError, OrganizationLoading, organizationRoleLabel } from './organization/OrganizationPrimitives'
import { useOrganization } from './organization/useOrganization'
import './organization/organization.css'

const STATUS = { local: '本地模式', connected: '组织已连接', offline: '服务离线', expired: '登录已失效' } as const
const VIEWS = [{ key: 'projects', label: '共享项目' }, { key: 'members', label: '组织成员' }, { key: 'invitations', label: '待接受邀请' }] as const
type View = (typeof VIEWS)[number]['key']

export function OrganizationPanel() {
  const { connection, change, refresh } = useOrganization()
  const [creating, setCreating] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [view, setView] = useState<View>('projects')
  const reduce = useReducedMotion()
  const reload = useMutation({ mutationFn: refresh })
  const data = connection.data
  const organization = data?.session?.organizations.find((item) => item.id === data.activeOrganizationId)
  const pending = change.isPending || reload.isPending
  const createOrganization = (input: { name: string; slug: string }) => change.mutate(() => window.projectos.organization.create(input), { onSuccess: () => { setCreating(false); setView('projects') } })
  const disconnect = () => change.mutate(() => window.projectos.organization.disconnect(), { onSuccess: () => { setConfirmDisconnect(false); setCreating(false) } })

  return <div className="org-panel" data-testid="organization-panel">
    <header className="org-panel-heading"><div><h2>账号与组织</h2></div><span className={`org-connection-status is-${data?.status ?? 'local'}`}><span className="org-status-dot" />{data ? STATUS[data.status] : '正在读取'}</span></header>
    {connection.isPending ? <OrganizationLoading /> : connection.isError ? <><OrganizationError error={connection.error} /><button className="org-button" type="button" onClick={() => void connection.refetch()}>重新读取</button></> : data ? <>
      {data.status === 'local' ? <ConnectOrganizationForm pending={change.isPending} error={change.error} onConnect={(serverUrl) => change.mutate(() => window.projectos.organization.connect({ serverUrl }))} /> : <>
        <section className="org-account" aria-label="当前组织账号"><span className="org-account-avatar" aria-hidden>{data.session?.account.name.slice(0, 1) || 'P'}</span><div className="org-account-identity"><strong>{data.session?.account.name}</strong><span>{data.session?.account.email}</span><code>{data.serverUrl}</code></div><div className="org-account-actions"><button type="button" className="org-button" onClick={() => reload.mutate()} disabled={pending} data-testid="org-refresh"><RefreshCw size={15} aria-hidden />{reload.isPending ? '正在刷新…' : '刷新连接'}</button><button type="button" className="org-link" onClick={() => setConfirmDisconnect(!confirmDisconnect)} data-testid="org-disconnect"><LogOut size={15} aria-hidden />退出账号</button></div></section>
        {confirmDisconnect ? <div className="org-inline-confirm" role="group" aria-label="确认退出组织账号"><p>退出此设备的组织账号。本机项目与执行记录保留。</p><div className="org-inline-actions"><button type="button" className="org-button" onClick={() => setConfirmDisconnect(false)}>取消</button><button type="button" className="org-button is-danger" onClick={disconnect} disabled={pending} data-testid="org-disconnect-confirm">确认退出</button></div></div> : null}
        <OrganizationError error={change.error || reload.error} />
        {data.status === 'offline' ? <div className="org-message is-warning" role="status"><Cloud size={17} aria-hidden /><span>组织服务暂时无法连接。请恢复网络后刷新连接。</span></div> : null}
        {data.status === 'expired' ? <div className="org-message is-warning" role="status"><ShieldCheck size={17} aria-hidden /><span>登录已失效。退出当前账号后重新连接。</span></div> : null}
        {data.status === 'connected' ? <>
          <div className="org-context-bar"><div className="org-context-select"><Building2 size={18} aria-hidden /><label htmlFor="org-select" className="org-sr-only">当前组织</label><select id="org-select" data-testid="org-select" value={data.activeOrganizationId ?? ''} disabled={pending} onChange={(event) => { const organizationId = event.target.value; setCreating(false); setView('projects'); change.mutate(() => window.projectos.organization.select({ organizationId })) }}><option value="" disabled>选择组织</option>{data.session?.organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{organization ? <span className="org-role">{organizationRoleLabel(organization.role)}</span> : null}</div><button type="button" className="org-button" data-testid="org-new-organization" disabled={pending} onClick={() => setCreating(!creating)}><Plus size={15} aria-hidden />创建组织</button></div>
          {creating ? <CreateOrganizationForm onCreate={createOrganization} onCancel={() => setCreating(false)} pending={pending} error={change.error} /> : null}
          <nav className="org-view-nav" aria-label="组织工作区视图">{VIEWS.filter((item) => data.activeOrganizationId || item.key === 'invitations').map((item) => <button type="button" key={item.key} aria-current={(view === item.key || (!data.activeOrganizationId && item.key === 'invitations')) ? 'page' : undefined} onClick={() => setView(item.key)} disabled={pending}>{item.label}</button>)}</nav>
          {pending ? <OrganizationLoading /> : <motion.div key={`${data.activeOrganizationId}:${view}`} initial={reduce ? false : { y: 5 }} animate={{ y: 0 }} transition={{ duration: .18, ease: [.22, 1, .36, 1] }}>
            {!data.activeOrganizationId || view === 'invitations' ? <OrganizationInvitations connection={data} onChanged={refresh} /> : view === 'members' ? <OrganizationMembers key={data.activeOrganizationId} connection={data} /> : <OrganizationProjects key={data.activeOrganizationId} connection={data} />}
          </motion.div>}
        </> : null}
      </>}
      {data.revocationPending ? <div className="org-message is-warning" role="status"><span>本机已退出；服务端会话撤销将在联网后重试。</span><button type="button" className="org-link" disabled={reload.isPending} onClick={() => reload.mutate()}>重试撤销</button></div> : null}
      {data.status === 'local' ? <OrganizationError error={reload.error} /> : null}
    </> : null}
  </div>
}
