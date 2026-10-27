import { useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button, Select } from 'antd'
import { useLifecycle } from '../lib/queries'
import { DeploymentConsole } from '../components/DeploymentConsole'
import './delivery.css'

export default function DeploymentCenterPage() {
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
    <div className="po-page po-delivery-page dc-page">
      {selected ? (
        <DeploymentConsole
          projectId={projectId}
          versionId={selected.id}
          versionControl={
            <>
              <Select
                value={selected.id}
                options={versions.map((version) => ({ value: version.id, label: `v${version.version}` }))}
                onChange={(versionId) => navigate(`/projects/${projectId}/deployments?version=${versionId}`)}
                style={{ width: 140 }}
              />
              <Button size="small" onClick={() => navigate(`/projects/${projectId}/releases?version=${selected.id}`)}>发布中心</Button>
            </>
          }
        />
      ) : (
        <div className="delivery-empty">先创建版本，再进入部署中心。</div>
      )}
    </div>
  )
}
