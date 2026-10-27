import { useParams } from 'react-router-dom'
import { ResourceCenter } from './ResourceCenter'

export default function DeliveryResourcesPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  if (!projectId) return <div className="rc-shell">未选择项目</div>
  return <ResourceCenter projectId={projectId} />
}
