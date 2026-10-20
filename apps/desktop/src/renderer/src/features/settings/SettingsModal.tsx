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
  SafetyCertificateOutlined,
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
import { AppearanceSettingsPanel, DataSecuritySettingsPanel, OpenSpecSettingsPanel, PermissionsSettingsPanel } from './AdvancedSettingsPanels'
import { UsageSettingsPanel } from './UsageSettingsPanel'
import { IntegrationsSettingsPanel } from './IntegrationsSettingsPanel'
import './settings.css'

const SECTIONS: Array<{ key: SettingsSection; label: string; icon: ReactNode }> = [
  { key: 'ai-connections', label: 'AI 连接', icon: <ApiOutlined /> },
  { key: 'models', label: '模型目录', icon: <AppstoreOutlined /> },
  { key: 'routing', label: 'Agent 路由', icon: <BranchesOutlined /> },
  { key: 'runtime', label: '运行时', icon: <HddOutlined /> },
  { key: 'tools', label: '工具与插件', icon: <ToolOutlined /> },
  { key: 'permissions', label: '工具权限', icon: <SafetyCertificateOutlined /> },
  { key: 'external-agents', label: '外部 Agent', icon: <RobotOutlined /> },
  { key: 'integrations', label: '第三方连接', icon: <ApiOutlined /> },
  { key: 'team', label: '团队与权限', icon: <TeamOutlined /> },
  { key: 'data-security', label: '存储与安全', icon: <SafetyCertificateOutlined /> },
  { key: 'appearance', label: '外观与快捷键', icon: <DesktopOutlined /> },
  { key: 'system', label: '系统与外观', icon: <DesktopOutlined /> },
  { key: 'usage', label: '用量与价格', icon: <AppstoreOutlined /> },
  { key: 'openspec', label: 'OpenSpec', icon: <SettingOutlined /> },
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
    case 'permissions':
      return <PermissionsSettingsPanel />
    case 'data-security':
      return <DataSecuritySettingsPanel />
    case 'appearance':
      return <AppearanceSettingsPanel />
    case 'usage':
      return <UsageSettingsPanel />
    case 'openspec':
      return <OpenSpecSettingsPanel />
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
    case 'integrations':
      return <IntegrationsSettingsPanel />
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
            <p>ProjectOS 1.6.0</p>
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


