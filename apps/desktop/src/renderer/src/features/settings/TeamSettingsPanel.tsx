import { Tag } from 'antd'
import { SafetyCertificateOutlined } from '@ant-design/icons'
import { useAgentDefinitions } from '../../lib/queries'

export function TeamSettingsPanel() {
  const agents = useAgentDefinitions()
  const list = agents.data?.agents ?? []

  return (
    <div className="po-settings-panel">
      <div className="po-settings-panel-head">
        <div><h2>团队与权限</h2><p>当前为本地单用户工作区</p></div>
      </div>

      <div className="v16-team-card">
        <span className="v16-team-avatar">L</span>
        <div><strong>本地所有者</strong><span>这台设备上的唯一成员</span></div>
        <Tag color="green">Owner</Tag>
      </div>

      <div className="po-settings-section-title">Agent 权限摘要</div>
      {list.length === 0 ? (
        <div className="v16-empty-inline">尚未创建自定义 Agent。</div>
      ) : (
        <div className="v16-team-list">
          {list.map((agent) => (
            <div key={agent.id} className="v16-team-row">
              <span className="v16-team-avatar">{agent.avatar || agent.name.slice(0, 1)}</span>
              <div><strong>{agent.name}</strong><span>{agent.role} · v{agent.currentVersion}</span></div>
              <div className="v16-team-perms">
                {agent.permissions.files ? <Tag>文件</Tag> : null}
                {agent.permissions.shell ? <Tag>Shell</Tag> : null}
                {agent.permissions.network ? <Tag>网络</Tag> : null}
                {!agent.permissions.files && !agent.permissions.shell && !agent.permissions.network ? <Tag>默认受控</Tag> : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="v16-inline-note"><SafetyCertificateOutlined /> 角色与权限在 Runtime 执行前由后端校验，前端隐藏不构成授权。</div>
    </div>
  )
}
