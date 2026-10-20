import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { App as AntApp, Button } from 'antd'
import { CheckOutlined, CloseOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { EmptyState, PageHeader, StatusPill } from '@projectos/ui'
import { useApprovals } from '../lib/queries'
import { errorMessage } from '../lib/errors'
import { formatRelative } from '../lib/format'

export default function ApprovalsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const approvals = useApprovals(projectId ?? null)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
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

  return (
    <div className="po-page v16-approvals-page">
      <PageHeader title="审批中心" description="工具调用与高风险操作的集中审批" />
      <div className="v16-filter-tabs">
        <button type="button" className={filter === 'pending' ? 'is-active' : ''} onClick={() => setFilter('pending')}>待审批</button>
        <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>全部</button>
      </div>
      {list.length === 0 ? (
        <div className="v16-glass-card"><EmptyState icon={<SafetyCertificateOutlined />} title="没有待审批操作" description="工具调用需要人工确认时会出现在这里。" /></div>
      ) : (
        <div className="v16-approval-grid">
          {list.map((approval) => (
            <article className="v16-approval-card" key={approval.id}>
              <header>
                <span className="v16-approval-card-icon"><SafetyCertificateOutlined /></span>
                <div><strong>{approval.title}</strong><span>{approval.agentName} · {formatRelative(approval.requestedAt)}</span></div>
                <StatusPill tone={approval.status === 'pending' ? 'warning' : approval.status === 'approved' ? 'success' : 'danger'}>{approval.status}</StatusPill>
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
      )}
    </div>
  )
}
