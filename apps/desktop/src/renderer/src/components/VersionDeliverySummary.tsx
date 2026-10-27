import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button } from 'antd'
import { SectionCard } from '@projectos/ui'
import { formatRelative } from '../lib/format'
import '../pages/delivery.css'

export function VersionDeliverySummary({ projectId, versionId, versionLabel }: { projectId: string; versionId: string; versionLabel: string }) {
  const navigate = useNavigate()
  const overview = useQuery({
    queryKey: ['release-overview', projectId, versionId],
    queryFn: () => window.projectos.release.overview(projectId, versionId),
  })
  const data = overview.data
  const latestRelease = data?.releases[0] ?? null
  const confirmed = (data?.environmentVersions ?? []).filter((fact) => fact.releaseId)
  const pending = (data?.approvals ?? []).filter((approval) => approval.status === 'pending').length

  return (
    <SectionCard
      title="发布与部署摘要"
      subtitle={`v${versionLabel}`}
      extra={
        <div className="delivery-summary-actions">
          <Button size="small" onClick={() => navigate(`/projects/${projectId}/releases?version=${versionId}`)}>进入发布中心</Button>
          <Button size="small" onClick={() => navigate(`/projects/${projectId}/deployments?version=${versionId}`)}>查看部署历史</Button>
        </div>
      }
    >
      <div className="delivery-summary">
        <div className="delivery-summary-item">
          <span>最新 Release</span>
          <strong>{latestRelease ? `v${latestRelease.version}` : '尚未发布'}</strong>
          <small>{latestRelease ? `${latestRelease.distributionStatus === 'externally_confirmed' ? '外部确认' : '未外部分发'} · ${formatRelative(latestRelease.createdAt)}` : '需要候选、门禁与审批'}</small>
        </div>
        <div className="delivery-summary-item">
          <span>已确认环境</span>
          <strong>{confirmed.length}</strong>
          <small>{confirmed.length ? confirmed.map((fact) => data?.environments.find((environment) => environment.id === fact.environmentId)?.name ?? fact.environmentId).join(' · ') : '没有导入/适配器确认'}</small>
        </div>
        <div className="delivery-summary-item">
          <span>待处理审批</span>
          <strong>{pending}</strong>
          <small>{pending ? '在发布中心处理' : '没有阻塞'}</small>
        </div>
        <div className="delivery-summary-item">
          <span>候选 / Release</span>
          <strong>{data?.candidates.length ?? 0} / {data?.releases.length ?? 0}</strong>
          <small>{data?.capabilities.canExecuteDeployment ? '部署适配器可用' : '未配置部署适配器'}</small>
        </div>
      </div>
    </SectionCard>
  )
}
