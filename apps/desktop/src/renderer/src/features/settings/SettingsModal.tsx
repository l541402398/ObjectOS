import { Modal } from 'antd'
import {
  ApiOutlined,
  AppstoreOutlined,
  BranchesOutlined,
  InfoCircleOutlined,
  RobotOutlined,
  SettingOutlined,
  HddOutlined,
  ToolOutlined,
  TeamOutlined,
  DesktopOutlined,
} from '@ant-design/icons'
import type { ReactNode } from 'react'
import { useUiStore, type SettingsSection } from '../../stores/ui'
import { AIConnectionsPanel } from './AIConnectionsPanel'
import { ModelCatalogPanel } from './ModelCatalogPanel'
import { GeneralSettingsPanel } from './GeneralSettingsPanel'
import { RuntimeSettingsPanel } from './RuntimeSettingsPanel'
import { ExternalAgentsPanel } from './ExternalAgentsPanel'
import { RoutingPanel } from './RoutingPanel'
import { AboutSettingsPanel } from './AboutSettingsPanel'
import { SystemSettingsPanel } from './SystemSettingsPanel'
import { TeamSettingsPanel } from './TeamSettingsPanel'
import { ToolsSettingsPanel } from './ToolsSettingsPanel'
import './settings.css'

const SECTIONS: Array<{ key: SettingsSection; label: string; icon: ReactNode }> = [
  { key: 'ai-connections', label: 'AI 连接', icon: <ApiOutlined /> },
  { key: 'models', label: '模型目录', icon: <AppstoreOutlined /> },
  { key: 'routing', label: 'Agent 路由', icon: <BranchesOutlined /> },
  { key: 'runtime', label: '运行时', icon: <HddOutlined /> },
  { key: 'tools', label: '工具与插件', icon: <ToolOutlined /> },
  { key: 'external-agents', label: '外部 Agent', icon: <RobotOutlined /> },
  { key: 'team', label: '团队与权限', icon: <TeamOutlined /> },
  { key: 'system', label: '系统与外观', icon: <DesktopOutlined /> },
  { key: 'general', label: '通用', icon: <SettingOutlined /> },
  { key: 'about', label: '关于', icon: <InfoCircleOutlined /> },
]

function renderSection(section: SettingsSection): ReactNode {
  switch (section) {
    case 'ai-connections':
      return <AIConnectionsPanel />
    case 'models':
      return <ModelCatalogPanel />
    case 'routing':
      return <RoutingPanel />
    case 'tools':
      return <ToolsSettingsPanel />
    case 'team':
      return <TeamSettingsPanel />
    case 'system':
      return <SystemSettingsPanel />
    case 'general':
      return <GeneralSettingsPanel />
    case 'runtime':
      return <RuntimeSettingsPanel />
    case 'external-agents':
      return <ExternalAgentsPanel />
    case 'about':
      return <AboutSettingsPanel />
    default:
      return <AIConnectionsPanel />
  }
}

export function SettingsModal() {
  const open = useUiStore((state) => state.settingsOpen)
  const section = useUiStore((state) => state.settingsSection)
  const setSection = useUiStore((state) => state.setSettingsSection)
  const close = useUiStore((state) => state.closeSettings)

  return (
    <Modal
      open={open}
      onCancel={close}
      footer={null}
      title={null}
      width="min(1180px, 94vw)"
      centered
      destroyOnHidden
      className="po-settings-modal"
      styles={{ body: { padding: 0 } }}
    >
      <div className="po-settings-dialog">
        <div className="po-settings-top">
          <div>
            <h1>设置</h1>
            <p>ProjectOS 0.1.0</p>
          </div>
        </div>
        <div className="po-settings-body">
          <nav className="po-settings-nav" aria-label="设置分类">
            {SECTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`po-settings-nav-item ${section === item.key ? 'is-active' : ''}`.trim()}
                onClick={() => setSection(item.key)}
              >
                <span>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
          <div className="po-settings-content">{renderSection(section)}</div>
        </div>
      </div>
    </Modal>
  )
}


