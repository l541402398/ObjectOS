import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { AssignmentReceipt, OrganizationConnectionView } from '@projectos/contracts'
import { OrganizationError, OrganizationField, OrganizationLoading } from './OrganizationPrimitives'
import { organizationScopeKey } from './useOrganization'
import { useSettingsDraft } from '../settings-draft'

export const assignmentStatus = { pending: '待接收', accepted: '已接收', in_progress: '开发中', ready_for_review: '待交付复核', completed: '交付已确认', declined: '已拒绝', cancelled: '已撤销', reassigned: '已改派' }
export const assignmentReceiptStatus = { sending: '正在提交', needs_reconciliation: '结果待核对', confirmed: '服务器已确认', closed: '本机已关闭待办' }
const operationLabel = { dispatch: '派发需求', decision: '分配决定', accept: '接收需求', progress: '更新进度', delivery: '提交交付' }

export function AssignmentOperation({ id, connection, onBack, onResolved, onDirtyChange }: { id: string; connection: OrganizationConnectionView; onBack: () => void; onResolved: (value: AssignmentReceipt) => void; onDirtyChange?: (dirty: boolean) => void }) {
  const [confirmed, setConfirmed] = useState(false), [closing, setClosing] = useState(false), [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  useSettingsDraft(dirty)
  const changed = () => { setDirty(true); onDirtyChange?.(true) }
  const operation = useQuery({ queryKey: [...organizationScopeKey(connection, 'assignment-operation'), id], queryFn: () => window.projectos.organization.assignmentOperation({ id }), retry: false, gcTime: 0, refetchOnWindowFocus: false })
  const action = useMutation({ mutationFn: (kind: 'reconcile' | 'retry' | 'close') => kind === 'reconcile' ? window.projectos.organization.assignmentReconcile({ id }) : kind === 'retry' ? window.projectos.organization.assignmentRetry({ id, confirmed: true }) : window.projectos.organization.assignmentClose({ id, note, confirmed: true }),
    onSuccess: value => { setDirty(false); onDirtyChange?.(false); setNote(''); setConfirmed(false); setClosing(false); onResolved(value) }, onSettled: () => operation.refetch(), retry: false })
  const receipt = operation.data?.receipt
  return <section className="assignment-operation" aria-label="分配操作回执">
    <button type="button" className="org-link" disabled={action.isPending || dirty} onClick={onBack}>返回需求分配</button>
    {dirty ? <button type="button" className="org-link" onClick={() => { setNote(''); setConfirmed(false); setClosing(false); setDirty(false); onDirtyChange?.(false) }}>清除未提交的回执操作</button> : null}
    <OrganizationError error={operation.error || action.error}/>{operation.isPending ? <OrganizationLoading/> : receipt ? <>
      <h3>{operationLabel[receipt.kind]}</h3><p role="status">{assignmentReceiptStatus[receipt.status]}</p>{receipt.error ? <p role="status">{receipt.error}</p> : null}
      <details><summary>原提交内容与标识</summary><pre className="kw-evidence">{JSON.stringify(operation.data, null, 2)}</pre></details>
      {receipt.status !== 'confirmed' ? <>
        <button className="org-button" type="button" disabled={action.isPending} onClick={() => action.mutate('reconcile')}>核对服务器回执</button>
        <label className="kw-check"><input type="checkbox" checked={confirmed} disabled={action.isPending} onChange={event => { setConfirmed(event.target.checked); changed() }}/>我已核对原内容，确认按同一标识重试</label>
        <button className="org-button" type="button" disabled={!confirmed || action.isPending} onClick={() => action.mutate('retry')}>确认重试原操作</button>
        {receipt.status !== 'closed' ? <details><summary>关闭本机待办</summary><p>仅关闭本机待办，服务器上的需求和原操作结果仍需核对。</p>
          <OrganizationField label="关闭待办原因">{field => <textarea id={field} rows={2} minLength={8} maxLength={2000} value={note} onChange={event => { setNote(event.target.value); changed() }}/>}</OrganizationField>
          <label className="kw-check"><input type="checkbox" checked={closing} onChange={event => { setClosing(event.target.checked); changed() }}/>我已核对，确认关闭本机待办</label>
          <button className="org-button" type="button" disabled={!closing || note.trim().length < 8 || action.isPending} onClick={() => action.mutate('close')}>确认关闭待办</button>
        </details> : null}
      </> : null}
    </> : null}
  </section>
}

export function AssignmentOperationList({ connection, onOpen }: { connection: OrganizationConnectionView; onOpen: (id: string) => void }) {
  const list = useQuery({ queryKey: organizationScopeKey(connection, 'assignment-operations'), queryFn: () => window.projectos.organization.assignmentOperations(), retry: false, refetchOnWindowFocus: false })
  return <section aria-label="分配操作记录"><div className="org-section-heading"><h3>本机操作记录</h3><button type="button" className="org-link" disabled={list.isFetching} onClick={() => void list.refetch()}>刷新操作记录</button></div><OrganizationError error={list.error}/>
    {list.data?.operations.length ? <ul className="rq-knowledge-sources">{list.data.operations.map(item => <li key={item.id}><div className="org-section-heading"><span>{operationLabel[item.kind]} · {assignmentReceiptStatus[item.status]}</span><button type="button" className="org-link" onClick={() => onOpen(item.id)}>查看操作回执</button></div><span className="org-item-sub">{new Date(item.createdAt).toLocaleString()}</span></li>)}</ul> : <p role="status">暂无本机操作记录</p>}
  </section>
}
