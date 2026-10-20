import { Button, Tag } from 'antd'
import { ApiOutlined, CodeOutlined, RobotOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useAIConnections, useExternalAgents, useRuntimeProfiles } from '../../lib/queries'
import { useUiStore } from '../../stores/ui'

export function IntegrationsSettingsPanel() {
  const openSettings = useUiStore((state) => state.openSettings)
  const connections = useAIConnections()
  const external = useExternalAgents()
  const runtimes = useRuntimeProfiles()
  const connected = connections.data?.connections.filter((connection) => connection.hasSecret).length ?? 0
  const availableRuntimes = runtimes.data?.profiles.filter((profile) => profile.status === 'available').length ?? 0
  const installedExternal = external.data?.installations.filter((agent) => agent.installed).length ?? 0

  return (
    <div className="po-settings-panel">
      <div className="po-settings-panel-head"><div><h2>第三方连接</h2><p>真实已接入的模型、Runtime 与外部 Agent</p></div></div>
      <div className="v16-resource-cards">
        <section className="v16-glass-card">
          <div className="v16-resource-icon is-blue"><ApiOutlined /></div>
          <strong>AI Provider</strong><span>{connected} 个连接已保存 Key</span>
          <Button size="small" onClick={() => openSettings('ai-connections')}>管理连接</Button>
        </section>
        <section className="v16-glass-card">
          <div className="v16-resource-icon is-teal"><ThunderboltOutlined /></div>
          <strong>Runtime / Harness</strong><span>{availableRuntimes} 个可用</span>
          <Button size="small" onClick={() => openSettings('runtime')}>管理 Runtime</Button>
        </section>
        <section className="v16-glass-card">
          <div className="v16-resource-icon is-violet"><RobotOutlined /></div>
          <strong>外部 Agent</strong><span>{installedExternal} 个已安装</span>
          <Button size="small" onClick={() => openSettings('external-agents')}>查看外部 Agent</Button>
        </section>
        <section className="v16-glass-card">
          <div className="v16-resource-icon is-amber"><CodeOutlined /></div>
          <strong>代码托管</strong><span>尚未配置 GitHub / GitLab 集成</span>
          <Tag>未连接</Tag>
        </section>
      </div>
      <div className="v16-inline-note">只展示真实检测或用户配置的连接；“未连接”不会被标成已连接。</div>
    </div>
  )
}

