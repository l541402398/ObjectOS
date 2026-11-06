import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Checkbox, Input } from 'antd'
import { ErrorState, LoadingBlock, StatusPill } from '@projectos/ui'
import { qk } from '../lib/queries'
import { errorMessage } from '../lib/errors'
import { formatDateTime } from '../lib/format'

/** Approve the existing persisted request in place; never create a standing grant. */
export function RequirementApproval({ projectId, approvalId, approveLabel = '允许本次', onDecided }: {
  projectId: string; approvalId: string; approveLabel?: string
  onDecided: (decision: 'approved' | 'rejected') => Promise<void>
}) {
  const [confirmed, setConfirmed] = useState(false)
  const [note, setNote] = useState('')
  const queryClient = useQueryClient()
  const approvals = useQuery({ queryKey: qk.approvals(projectId), queryFn: () => window.projectos.approvals.list({ projectId, runId: null }), refetchInterval: 2500 })
  const approval = approvals.data?.approvals.find(item => item.id === approvalId)
  const decision = useMutation({
    mutationFn: async (value: 'approved' | 'rejected') => {
      if (!approval || approval.status !== 'pending' || (value === 'approved' && !confirmed)) throw new Error('请核对本次操作范围')
      await window.projectos.approvals.decide({ approvalId, decision: value, note: note.trim() })
      setConfirmed(false)
      await Promise.all([queryClient.invalidateQueries({ queryKey: qk.approvals(projectId) }), onDecided(value)])
    },
  })
  if (approvals.isLoading) return <LoadingBlock label="正在读取本次授权范围" rows={3} />
  if (approvals.isError) return <ErrorState title="无法读取审批" message={errorMessage(approvals.error)} onRetry={() => void approvals.refetch()} />
  if (!approval) return <Alert type="error" showIcon message="找不到本次审批，请刷新任务后重试" />
  const expired = approval.expiresAt !== null && approval.expiresAt <= approvals.dataUpdatedAt
  const pending = approval.status === 'pending' && !expired
  const request = approval.request as { args?: Record<string, unknown> }
  const args = request.args ?? {}
  const scopeNames: Record<string, string> = { taskRoot: '任务目录', sourceRoot: '执行目录', targetRoot: '合入目录', integrationRoot: '需求目录', sourceBranch: '来源分支', targetBranch: '目标分支', path: '文件', content: '写入内容' }
  return <section className="rq-approval-card" aria-label="本次操作授权">
    <div className="rq-review-heading"><h3>{approval.title}</h3><StatusPill tone={pending ? 'warning' : approval.status === 'approved' ? 'success' : 'neutral'}>{pending ? '待授权' : expired && approval.status === 'pending' ? '已过期' : ({ approved: '已批准', rejected: '已拒绝', expired: '已过期', cancelled: '已取消', pending: '待授权' })[approval.status]}</StatusPill></div>
    <p className="rq-approval-detail">{approval.detail}</p>
    <dl className="rq-approval-scope">{Object.entries(scopeNames).filter(([key]) => typeof args[key] === 'string').map(([key, label]) => <div key={key}><dt>{label}</dt><dd><code>{String(args[key])}</code></dd></div>)}</dl>
    <details className="rq-approval-parameters"><summary>执行详情与授权范围{approval.expiresAt ? ` · 有效至 ${formatDateTime(approval.expiresAt)}` : ''}</summary><pre tabIndex={0}>{JSON.stringify(approval.request, null, 2)}</pre></details>
    {decision.isError && <Alert type="error" showIcon message={errorMessage(decision.error)} />}
    {pending && <>
      <Checkbox checked={confirmed} disabled={decision.isPending} onChange={event => setConfirmed(event.target.checked)}>我已核对本次操作范围</Checkbox>
      <details className="rq-approval-note"><summary>补充审批意见</summary><Input.TextArea aria-label="审批意见" value={note} maxLength={2000} rows={2} disabled={decision.isPending} onChange={event => setNote(event.target.value)} /></details>
      <div className="rq-inline-actions"><Button danger disabled={decision.isPending} onClick={() => decision.mutate('rejected')}>拒绝本次</Button><Button type="primary" disabled={!confirmed} loading={decision.isPending && decision.variables === 'approved'} onClick={() => decision.mutate('approved')}>{approveLabel}</Button></div>
    </>}
  </section>
}
