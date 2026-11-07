import { useNavigate } from 'react-router-dom'
import { Building2, ArrowUpRight } from 'lucide-react'
import { useUiStore } from '../../stores/ui'
import { useOrganization } from './organization/useOrganization'
import { OrganizationError, OrganizationLoading } from './organization/OrganizationPrimitives'
import './organization/organization.css'

/** Account identity in Settings; daily organization work lives in the primary workspace. */
export function OrganizationPanel() {
  const { connection } = useOrganization(), navigate = useNavigate(), close = useUiStore(state => state.closeSettings)
  const data = connection.data
  return <section className="org-panel" aria-label="组织账号设置">
    <div className="org-panel-heading"><h2>组织账号</h2><Building2 size={22} aria-hidden/></div>
    <OrganizationError error={connection.error}/>{connection.isPending ? <OrganizationLoading/> : <>
      <div className="org-account"><div className="org-account-identity"><strong>{data?.session?.account.name ?? '尚未连接组织账号'}</strong>{data?.session ? <><span>{data.session.account.email}</span><code>{data.serverUrl}</code></> : null}</div></div>
      <div className="org-inline-actions ow-account-link"><button className="org-button is-primary" type="button" onClick={() => { close(); navigate('/organization') }}>进入组织工作台<ArrowUpRight size={16} aria-hidden/></button></div>
    </>}
  </section>
}
