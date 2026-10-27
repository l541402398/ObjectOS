import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { App as AntApp, Button } from 'antd'
import { CheckOutlined, CloseOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EmptyState, PageHeader, StatusPill } from '@projectos/ui'
import { useApprovals } from '../lib/queries'
import { errorMessage } from '../lib/errors'
import { formatRelative } from '../lib/format'

function approvalStatusLabel(status: string): string {
  return status === 'pending' ? '待审批' : status === 'approved' ? '已批准' : status === 'rejected' ? '已拒绝' : status
}

export default function ApprovalsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const approvals = useApprovals(projectId ?? null)
  const deliveryApprovals = useQuery({
    queryKey: ['release-approvals', projectId],
    queryFn: () => window.projectos.release.approvals(projectId!),
    enabled: Boolean(projectId),
  })
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [scope, setScope] = useState<'all' | 'tool' | 'delivery'>('all')
  const list = useMemo(() => {
    const items = approvals.data?.approvals ?? []
    return filter === 'pending' ? items.filter((item) => item.status === 'pending') : items
  }, [approvals.data, filter])

  const decide = useMutation({
    mutationFn: ({ approvalId, decision }: { approvalId: string; decision: 'approved' | 'rejected' }) =>
      window.projectos.approvals.decide({ approvalId, decision, note: '' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['approvals'] })
      await queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      message.success('审批已提交')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const decideDelivery = useMutation({
    mutationFn: ({ approvalId, decision }: { approvalId: string; decision: 'approved' | 'rejected' }) =>
      window.projectos.release.decideApproval({ approvalId, decision, note: '审批中心处理', rationale: '审批中心处理' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['release-approvals'] })
      await queryClient.invalidateQueries({ queryKey: ['release-overview'] })
      message.success('交付审批已提交')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  return (
    <div className="po-page v16-approvals-page">
      <PageHeader title="审批中心" description="工具调用与高风险操作的集中审批" />
      <div className="v16-filter-tabs">
        <button type="button" className={filter === 'pending' ? 'is-active' : ''} onClick={() => setFilter('pending')}>待审批</button>
        <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>全部</button>
        <span className="v16-filter-sep" />
        <button type="button" className={scope === 'all' ? 'is-active' : ''} onClick={() => setScope('all')}>全部类型</button>
        <button type="button" className={scope === 'tool' ? 'is-active' : ''} onClick={() => setScope('tool')}>工具权限</button>
        <button type="button" className={scope === 'delivery' ? 'is-active' : ''} onClick={() => setScope('delivery')}>交付审批</button>
      </div>
      {scope !== 'delivery' ? (list.length === 0 ? (
        <div className="v16-glass-card"><EmptyState icon={<SafetyCertificateOutlined />} title="没有待审批操作" description="工具调用需要人工确认时会出现在这里。" /></div>
      ) : (
        <div className="v16-approval-grid">
          {list.map((approval) => (
            <article className="v16-approval-card" key={approval.id}>
              <header>
                <span className="v16-approval-card-icon"><SafetyCertificateOutlined /></span>
                <div><strong>{approval.title}</strong><span>{approval.agentName} · {formatRelative(approval.requestedAt)}</span></div>
                <StatusPill tone={approval.status === 'pending' ? 'warning' : approval.status === 'approved' ? 'success' : 'danger'}>{approvalStatusLabel(approval.status)}</StatusPill>
              </header>
              {approval.taskTitle ? <div className="v16-approval-task">任务：{approval.taskTitle}</div> : null}
              {approval.detail ? <pre className="v16-approval-detail">{approval.detail}</pre> : null}
              {approval.status === 'pending' ? (
                <footer>
                  <Button icon={<CloseOutlined />} danger onClick={() => decide.mutate({ approvalId: approval.id, decision: 'rejected' })}>拒绝</Button>
                  <Button type="primary" icon={<CheckOutlined />} loading={decide.isPending} onClick={() => decide.mutate({ approvalId: approval.id, decision: 'approved' })}>批准</Button>
                </footer>
              ) : null}
            </article>
          ))}
        </div>
      )) : null}

      {scope !== 'tool' ? (
      <div className="v16-delivery-approvals">
        <div className="v16-delivery-approvals-head">
          <strong>交付审批</strong>
          <span>变更与部署，绑定内容指纹与版本</span>
        </div>
        {(deliveryApprovals.data?.approvals ?? []).filter((approval) => filter === 'all' || approval.status === 'pending').length === 0 ? (
          <div className="v16-glass-card"><EmptyState compact title="没有交付审批" description="发布变更或部署进入审批后会出现在这里。" /></div>
        ) : (
          <div className="v16-approval-grid">
            {(deliveryApprovals.data?.approvals ?? [])
              .filter((approval) => filter === 'all' || approval.status === 'pending')
              .map((approval) => (
                <article className="v16-approval-card" key={approval.id}>
                  <header>
                    <span className="v16-approval-card-icon"><SafetyCertificateOutlined /></span>
                    <div>
                      <strong>{approval.subjectTitle ?? (approval.subjectType === 'change_request' ? '发布变更审批' : '部署审批')}</strong>
                      <span>r{approval.subjectRevision} · {formatRelative(approval.requestedAt)}</span>
                    </div>
                    <StatusPill tone={approval.status === 'pending' ? 'warning' : approval.status === 'approved' ? 'success' : 'danger'}>
                      {approvalStatusLabel(approval.status)}
                    </StatusPill>
                  </header>
                  <div className="v16-approval-fingerprint">内容指纹 {approval.contentFingerprint.slice(0, 20)}…</div>
                  {approval.status === 'pending' ? (
                    <footer>
                      <Button danger icon={<CloseOutlined />} onClick={() => decideDelivery.mutate({ approvalId: approval.id, decision: 'rejected' })}>拒绝</Button>
                      <Button type="primary" icon={<CheckOutlined />} loading={decideDelivery.isPending} onClick={() => decideDelivery.mutate({ approvalId: approval.id, decision: 'approved' })}>批准</Button>
                    </footer>
                  ) : null}
                </article>
              ))}
          </div>
        )}
      </div>
      ) : null}
    </div>
  )
}
