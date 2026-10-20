import { useNavigate } from 'react-router-dom'
import { Button } from 'antd'
import { BellOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { EmptyState, PageHeader, StatusPill } from '@projectos/ui'
import { useBootstrap } from '../lib/queries'
import { formatRelative } from '../lib/format'

export default function NotificationsPage() {
  const navigate = useNavigate()
  const bootstrap = useBootstrap()
  const approvals = bootstrap.data?.pendingApprovals ?? []
  const activity = bootstrap.data?.recentActivity ?? []

  return (
    <div className="po-page v16-notifications-page">
      <PageHeader title="通知中心" description="待审批与最近活动" />
      <div className="v16-settings-grid">
        <section className="v16-glass-card">
          <div className="v16-card-title"><strong>待处理</strong><span>{approvals.length}</span></div>
          {approvals.length === 0 ? (
            <EmptyState icon={<SafetyCertificateOutlined />} title="没有待处理通知" description="审批请求会出现在这里。" />
          ) : (
            <div className="v16-team-list">
              {approvals.map((approval) => (
                <button type="button" className="v16-team-row" key={approval.id} onClick={() => approval.projectId && navigate(`/projects/${approval.projectId}/approvals`)}>
                  <div><strong>{approval.title}</strong><span>{approval.agentName} · {formatRelative(approval.requestedAt)}</span></div>
                  <StatusPill tone="warning">待审批</StatusPill>
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="v16-glass-card">
          <div className="v16-card-title"><strong>最近活动</strong><span>{activity.length}</span></div>
          {activity.length === 0 ? (
            <EmptyState icon={<BellOutlined />} title="暂无活动" />
          ) : (
            <div className="v16-activity-compact">
              {activity.slice(0, 20).map((item) => (
                <div className="v16-activity-line" key={item.id}>
                  <span className={`po-activity-mark is-${item.tone}`} />
                  <div><strong>{item.summary}</strong><span>{item.actorName ? `${item.actorName} · ` : ''}{formatRelative(item.createdAt)}</span></div>
                </div>
              ))}
            </div>
          )}
          <Button onClick={() => navigate('/')}>返回项目中心</Button>
        </section>
      </div>
    </div>
  )
}
