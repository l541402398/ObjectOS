import { useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button, Select } from 'antd'
import { PageHeader } from '@projectos/ui'
import { useLifecycle } from '../lib/queries'
import { ReleasePanel } from '../components/ReleasePanel'
import './delivery.css'

export default function ReleaseCenterPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const lifecycle = useLifecycle(projectId)
  const versions = lifecycle.data?.versions ?? []
  const selected = useMemo(() => {
    const requested = search.get('version')
    return versions.find((version) => version.id === requested) ??
      versions.find((version) => version.id === lifecycle.data?.focus?.subjectId) ??
      versions.find((version) => version.isDefault) ??
      versions[0] ??
      null
  }, [lifecycle.data, search, versions])

  return (
    <div className="po-page po-delivery-page">
      <PageHeader
        eyebrow="DELIVERY"
        title="发布中心"
        description="从真实研发成果形成候选、变更审批与不可变 Release 记录。"
        actions={
          <div className="delivery-head-actions">
            <Select
              value={selected?.id}
              placeholder="选择版本"
              options={versions.map((version) => ({ value: version.id, label: `v${version.version}` }))}
              onChange={(versionId) => navigate(`/projects/${projectId}/releases?version=${versionId}`)}
              style={{ width: 160 }}
            />
            <Button onClick={() => selected && navigate(`/projects/${projectId}/deployments?version=${selected.id}`)}>
              部署中心
            </Button>
          </div>
        }
        meta={<span>{selected ? `当前版本 v${selected.version}` : '没有可选版本'}</span>}
      />
      {selected ? (
        <ReleasePanel projectId={projectId} versionId={selected.id} versionLabel={selected.version} mode="release" />
      ) : (
        <div className="delivery-empty">先创建版本，再进入发布中心。</div>
      )}
    </div>
  )
}
