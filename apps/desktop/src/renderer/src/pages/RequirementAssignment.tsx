import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { AssignmentBinding, OrganizationConnectionView } from '@projectos/contracts'
import { DialogShell, OverlayHeader, OverlayScrollArea } from '../next-ui/overlay/overlay-shell'
import { AssignmentOperation, assignmentStatus } from '../features/settings/organization/AssignmentOperations'
import { OrganizationError, OrganizationField, OrganizationLoading } from '../features/settings/organization/OrganizationPrimitives'
import { organizationScopeKey } from '../features/settings/organization/useOrganization'
import '../features/settings/organization/assignments.css'

function AssignmentReport({ requirementId, mode, assignmentId, connection, onClose }: { requirementId: string; mode: 'progress' | 'delivery'; assignmentId: string; connection: OrganizationConnectionView; onClose: () => void }) {
  const [id] = useState(() => crypto.randomUUID()), [note, setNote] = useState(''), [selected, setSelected] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState(false), [dirty, setDirty] = useState(false), [stored, setStored] = useState('')
  const preview = useQuery({ queryKey: ['assignment-progress', requirementId, mode], queryFn: () => window.projectos.requirements.assignmentProgress({ requirementId, mode }), retry: false, gcTime: 0, refetchOnWindowFocus: false })
  const detail = useQuery({ queryKey: [...organizationScopeKey(connection, 'assignments'), assignmentId], queryFn: () => window.projectos.organization.assignment({ id: assignmentId }), retry: false, gcTime: 0, refetchOnWindowFocus: false })
  const submit = useMutation({ mutationFn: () => window.projectos.organization.assignmentSubmit({ kind: mode, id, requirementId, expectedRevision: detail.data!.assignment.revision, fingerprint: preview.data!.fingerprint, artifactIds: selected, note, confirmed: true }), retry: false,
    onSuccess: value => { setDirty(false); setConfirmed(false); setStored(value.id) },
    onError: async () => { if (await window.projectos.organization.assignmentOperation({ id }).catch(() => null)) { setDirty(false); setStored(id) } } })
  const data = preview.data, ready = data && !data.blockers.length && (mode === 'progress' || data.acceptance?.current)
  return <DialogShell open dirty={dirty} onOpenChange={open => { if (!open && !submit.isPending) onClose() }} ariaLabel={mode === 'progress' ? '更新组织进度' : '提交组织交付'} width={850}>
    <OverlayHeader title={mode === 'progress' ? '更新组织进度' : '提交组织交付'}/><OverlayScrollArea><div className="rq-organization-knowledge assignment-dialog">
      {stored ? <AssignmentOperation id={stored} connection={connection} onBack={onClose} onDirtyChange={setDirty} onResolved={() => setDirty(false)}/> : <>
        <OrganizationError error={preview.error || detail.error || submit.error}/>{preview.isPending || detail.isPending ? <OrganizationLoading/> : data ? <>
          <p>{data.counts.done}/{data.counts.total} 项完成 · {data.counts.active} 项待完成 · {data.counts.blocked} 项阻塞 · {data.counts.runningRuns} 个运行中</p>
          {data.blockers.length ? <ul className="kw-blockers">{data.blockers.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : null}
          {mode === 'delivery' && !data.acceptance?.current ? <p role="status">请先在“成果验收与知识回写”中记录当前成果的整体验收。</p> : null}
          <form className="assignment-form" onSubmit={event => { event.preventDefault(); if (ready && confirmed && !submit.isPending) submit.mutate() }}>
            <fieldset disabled={submit.isPending}>
              {mode === 'delivery' ? <><h3>分享交付证据</h3><ul className="rq-knowledge-sources">{data.artifacts.map(artifact => <li key={artifact.id}><label className="kw-check"><input type="checkbox" checked={selected.includes(artifact.id)} disabled={!selected.includes(artifact.id) && selected.length >= 8} onChange={event => { setSelected(prior => event.target.checked ? [...prior, artifact.id] : prior.filter(id => id !== artifact.id)); setDirty(true); setConfirmed(false) }}/>{artifact.title}</label></li>)}</ul><p className="org-item-sub">分享所选产物的标题、校验信息和合入提交标识，由组织复核交付。</p></> : null}
              <OrganizationField label={mode === 'progress' ? '本次进度说明' : '交付说明'}>{field => <textarea id={field} required minLength={8} maxLength={2000} rows={4} value={note} onChange={event => { setNote(event.target.value); setDirty(true); setConfirmed(false) }}/>}</OrganizationField>
              <label className="kw-check"><input type="checkbox" checked={confirmed} onChange={event => { setConfirmed(event.target.checked); setDirty(true) }}/>我已核对当前进度与分享范围，确认提交给组织</label>
            </fieldset><button className="org-button is-primary" disabled={!ready || !confirmed || !detail.data || submit.isPending || (mode === 'delivery' && !selected.length)}>{submit.isPending ? '正在提交…' : mode === 'progress' ? '确认更新进度' : '确认提交交付'}</button>
          </form>
        </> : null}
      </>}
    </div></OverlayScrollArea>
  </DialogShell>
}

export function RequirementAssignment({ requirementId, binding, connection }: { requirementId: string; binding: AssignmentBinding; connection?: OrganizationConnectionView }) {
  const [report, setReport] = useState<'progress' | 'delivery' | null>(null)
  const matching = binding.serverUrl === connection?.serverUrl && binding.organizationId === connection?.activeOrganizationId && binding.accountId === connection?.session?.account.id
  const detail = useQuery({ queryKey: connection ? [...organizationScopeKey(connection, 'assignments'), binding.assignmentId] : ['assignment-offline', requirementId], queryFn: () => window.projectos.organization.assignment({ id: binding.assignmentId }), enabled: matching, retry: false, refetchOnWindowFocus: false })
  const active = matching && !detail.isError && connection?.status === 'connected' && ['accepted', 'in_progress'].includes(detail.data?.assignment.status ?? '')
  return <section className="assignment-detail" aria-label="组织分配来源"><div className="org-section-heading"><h3>组织分配</h3><button type="button" className="org-button" disabled={!matching || detail.isFetching} onClick={() => void detail.refetch()}>刷新分配状态</button></div>
    <OrganizationError error={detail.error}/><p role="status">{detail.data ? assignmentStatus[detail.data.assignment.status] : matching ? '分配状态尚未确认' : '请连接接收需求时的组织账号，确认当前分配权限。'}</p>
    <div className="org-inline-actions"><button type="button" className="org-button" disabled={!active} onClick={() => setReport('progress')}>更新组织进度</button><button type="button" className="org-button is-primary" disabled={!active} onClick={() => setReport('delivery')}>提交组织交付</button></div>
    {report && connection ? <AssignmentReport requirementId={requirementId} mode={report} assignmentId={binding.assignmentId} connection={connection} onClose={() => { setReport(null); void detail.refetch() }}/> : null}
  </section>
}
