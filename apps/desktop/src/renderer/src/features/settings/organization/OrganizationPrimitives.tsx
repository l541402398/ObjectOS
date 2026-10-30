import { useId, type ReactNode } from 'react'
import { CircleAlert, Inbox } from 'lucide-react'
import { errorMessage } from '../../../lib/errors'

export function OrganizationError({ error }: { error: unknown }) {
  return error ? <p className="org-message is-error" role="alert"><CircleAlert size={16} aria-hidden /><span>{errorMessage(error)}</span></p> : null
}

export function OrganizationEmpty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="org-empty"><Inbox size={25} strokeWidth={1.5} aria-hidden /><strong>{title}</strong>{children ? <p>{children}</p> : null}</div>
}

export function OrganizationLoading() {
  return <div className="org-loading" role="status" aria-label="正在读取组织数据"><span /><span /><span /></div>
}

export function OrganizationField({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId()
  return <div className="org-field"><label htmlFor={id}>{label}</label>{children(id)}{hint ? <span className="org-field-hint">{hint}</span> : null}</div>
}

export const organizationRoleLabel = (role: string) => ({ owner: '所有者', admin: '管理员', member: '成员' }[role] ?? role)
export const projectRoleLabel = (role: string) => ({ owner: '项目所有者', maintainer: '维护者', contributor: '贡献者', reviewer: '审阅者', viewer: '只读成员' }[role] ?? role)
