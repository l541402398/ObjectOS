import { useCallback, useEffect, useRef, useState } from 'react'
import { useBlocker, useSearchParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Building2, BookOpen, ClipboardList, FileCheck2, FolderKanban, Users, Mail, Boxes, Monitor, RefreshCw, ChevronDown } from 'lucide-react'
import { SettingsDraftContext } from '../features/settings/settings-draft'
import { useOrganization } from '../features/settings/organization/useOrganization'
import { OrganizationAssignments } from '../features/settings/organization/OrganizationAssignments'
import { OrganizationKnowledge } from '../features/settings/organization/OrganizationKnowledge'
import { KnowledgeCandidates } from '../features/settings/organization/KnowledgeCandidates'
import { OrganizationAssets } from '../features/settings/organization/OrganizationAssets'
import { OrganizationMembers } from '../features/settings/organization/OrganizationMembers'
import { OrganizationProjects } from '../features/settings/organization/OrganizationProjects'
import { OrganizationWorkers } from '../features/settings/organization/OrganizationWorkers'
import { OrganizationInvitations } from '../features/settings/organization/OrganizationInvitations'
import { ConnectOrganizationForm, CreateOrganizationForm } from '../features/settings/organization/OrganizationForms'
import { OrganizationError, OrganizationLoading, organizationRoleLabel } from '../features/settings/organization/OrganizationPrimitives'
import { DialogShell, OverlayHeader, OverlayScrollArea, OverlayFooter, PopoverShell } from '../next-ui/overlay/overlay-shell'
import '../features/settings/organization/organization.css'
import '../features/settings/organization/knowledge.css'
import './organization-workspace.css'

const sections = [
  { key: 'assignments', label: '需求协作', icon: ClipboardList, group: '协作' },
  { key: 'knowledge', label: '组织知识', icon: BookOpen, group: '协作' },
  { key: 'review', label: '知识审核', icon: FileCheck2, group: '协作' },
  { key: 'projects', label: '共享项目', icon: FolderKanban, group: '管理' },
  { key: 'members', label: '成员与权限', icon: Users, group: '管理' },
  { key: 'invitations', label: '待接受邀请', icon: Mail, group: '管理' },
  { key: 'assets', label: '配置资产', icon: Boxes, group: '管理' },
  { key: 'workers', label: '执行端', icon: Monitor, group: '管理' },
] as const
const statusLabel = { local: '个人模式', connected: '组织已连接', offline: '服务离线', expired: '登录已失效' }

export default function OrganizationWorkspace() {
  const { connection, change, refresh } = useOrganization(), [search, setSearch] = useSearchParams()
  const [dirty, updateDirty] = useState(false), [creating, setCreating] = useState(false), [disconnecting, setDisconnecting] = useState(false)
  const dirtyRef = useRef(false)
  const setDirty = useCallback((value: boolean) => { dirtyRef.current = value; updateDirty(value) }, [])
  const [accountOpen, setAccountOpen] = useState(false)
  const blocker = useBlocker(useCallback(() => dirtyRef.current, []))
  const reload = useMutation({ mutationFn: refresh }), data = connection.data
  const requested = search.get('view') ?? 'assignments'
  const view = sections.some(section => section.key === requested) ? requested : 'assignments'
  const organization = data?.session?.organizations.find(item => item.id === data.activeOrganizationId)
  const busy = change.isPending || reload.isPending
  const go = (key: string) => { if (!dirty) setSearch({ view: key }) }
  useEffect(() => {
    if (!dirty) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])
  return <SettingsDraftContext.Provider value={{ dirty, setDirty }}>
    <section className="po-page org-panel ow-page" data-testid="organization-workspace" aria-label="组织工作台">
      <header className="ow-header"><div className="ow-identity"><Building2 size={24} strokeWidth={1.65} aria-hidden/><h1>组织工作台</h1><span className={`org-connection-status is-${data?.status ?? 'local'}`}>{data ? statusLabel[data.status] : '正在读取'}</span></div>
        {data?.session ? <div className="org-inline-actions"><span className="ow-account-name">{data.session.account.name}</span><button className="org-button" type="button" disabled={dirty || busy} onClick={() => reload.mutate()} data-testid="org-refresh"><RefreshCw size={15} aria-hidden/>{reload.isPending ? '正在刷新…' : '刷新连接'}</button>
          <PopoverShell open={accountOpen} onOpenChange={setAccountOpen} ariaLabel="组织账号" align="end" trigger={<button className="org-button" type="button">账号<ChevronDown size={14} aria-hidden/></button>}><div className="ow-account-content"><strong>{data.session.account.name}</strong><span>{data.session.account.email}</span><code>{data.serverUrl}</code><button type="button" className="org-link" disabled={dirty || busy} onClick={() => { setAccountOpen(false); setDisconnecting(true) }} data-testid="org-disconnect">退出账号</button></div></PopoverShell></div> : null}
      </header>
      <OrganizationError error={connection.error || change.error || reload.error}/>
      {connection.isPending ? <OrganizationLoading/> : !data ? <button className="org-button" onClick={() => void connection.refetch()}>重新读取</button> : data.status === 'local' ? <ConnectOrganizationForm pending={change.isPending || data.loginPending === true} serverUrl={data.loginServerUrl} error={change.error} onConnect={serverUrl => change.mutate(() => window.projectos.organization.connect({ serverUrl }))}/> : <>
        {data.status === 'expired' ? <p className="org-message is-warning" role="status">登录已失效，请退出当前账号后重新连接。本机项目和记录保留。</p> : null}
        {data.status === 'offline' ? <p className="org-message is-warning" role="status">组织服务暂时无法连接。恢复网络后刷新连接；待核对操作仍保留。</p> : null}
        <div className="ow-context"><div className="org-context-select"><label htmlFor="ow-org-select" className="org-sr-only">当前组织</label><select id="ow-org-select" data-testid="org-select" value={data.activeOrganizationId ?? ''} disabled={dirty || busy || data.status !== 'connected'} onChange={event => { const id = event.target.value; setCreating(false); setSearch({ view: 'assignments' }); change.mutate(() => window.projectos.organization.select({ organizationId: id })) }}><option value="" disabled>选择组织</option>{data.session?.organizations.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select>{organization ? <span className="org-role">{organizationRoleLabel(organization.role)}</span> : null}</div>
          <button className="org-button" type="button" disabled={dirty || busy || data.status !== 'connected'} data-testid="org-new-organization" onClick={() => setCreating(!creating)}>创建组织</button>
        </div>
        {creating ? <div onChange={() => setDirty(true)}><CreateOrganizationForm pending={busy} error={change.error} onCancel={() => { setDirty(false); setCreating(false) }} onCreate={input => change.mutate(() => window.projectos.organization.create(input), { onSuccess: () => { setDirty(false); setCreating(false); setSearch({ view: 'projects' }) } })}/></div> : null}
        <div className="ow-layout"><nav className="ow-nav" aria-label="组织功能">{sections.map((section, index) => <div key={section.key}>
          {(index === 0 || sections[index - 1]?.group !== section.group) ? <span className="ow-nav-group">{section.group}</span> : null}
          <button type="button" aria-current={(data.activeOrganizationId ? view : 'invitations') === section.key ? 'page' : undefined} disabled={dirty || busy || (!data.activeOrganizationId && section.key !== 'invitations')} onClick={() => go(section.key)}><section.icon size={18} strokeWidth={1.65} aria-hidden/>{section.label}</button>
        </div>)}</nav>
          <div className="ow-content" data-testid="organization-panel">
            {creating ? null : busy ? <OrganizationLoading/> : !data.activeOrganizationId || view === 'invitations' ? <OrganizationInvitations connection={data} onChanged={refresh}/> : view === 'assignments' ? <OrganizationAssignments key={`${data.session?.account.id}:${data.activeOrganizationId}`} connection={data}/> : view === 'knowledge' ? <OrganizationKnowledge connection={data}/> : view === 'review' ? <KnowledgeCandidates connection={data} onBack={() => go('knowledge')}/> : view === 'projects' ? <OrganizationProjects connection={data}/> : view === 'members' ? <OrganizationMembers connection={data}/> : view === 'assets' ? <OrganizationAssets connection={data}/> : <OrganizationWorkers connection={data}/>}
          </div>
        </div>
      </>}
      {data?.revocationPending ? <p className="org-message is-warning" role="status">本机已退出；服务端会话撤销将在联网后重试。<button className="org-link" disabled={busy} onClick={() => reload.mutate()}>重试撤销</button></p> : null}
    </section>
    <DialogShell open={blocker.state === 'blocked'} onOpenChange={open => { if (!open) blocker.reset?.() }} ariaLabel="离开未保存的组织编辑" width={460}>
      <OverlayHeader title="放弃未保存的修改？"/><OverlayScrollArea><p>离开后，尚未提交的编辑内容会丢失。已保存的操作记录保留。</p></OverlayScrollArea><OverlayFooter><button className="org-button" type="button" onClick={() => blocker.reset?.()}>继续编辑</button><button className="org-button is-danger" type="button" onClick={() => { setDirty(false); blocker.proceed?.() }}>放弃修改并离开</button></OverlayFooter>
    </DialogShell>
    <DialogShell open={disconnecting} onOpenChange={setDisconnecting} ariaLabel="确认退出组织账号" width={460}>
      <OverlayHeader title="退出组织账号？"/><OverlayScrollArea><p>本机项目与执行记录保留，新的组织开发操作需要重新连接。</p></OverlayScrollArea><OverlayFooter><button className="org-button" type="button" onClick={() => setDisconnecting(false)}>取消</button><button className="org-button is-danger" type="button" disabled={busy || dirty} data-testid="org-disconnect-confirm" onClick={() => change.mutate(() => window.projectos.organization.disconnect(), { onSuccess: () => { setDisconnecting(false); setSearch({}) } })}>确认退出</button></OverlayFooter>
    </DialogShell>
  </SettingsDraftContext.Provider>
}
