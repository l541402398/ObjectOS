import { Modal } from 'antd'
import {
  ApiOutlined,
  AppstoreOutlined,
  InfoCircleOutlined,
  SettingOutlined,
  SlidersOutlined,
  HddOutlined,
  ToolOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { useEffect, useRef, type ReactNode } from 'react'
import { useUiStore, type SettingsSection } from '../../stores/ui'
import { AIConnectionsPanel } from './AIConnectionsPanel'
import { SettingsOverviewPanel } from './SettingsOverviewPanel'
import { ModelCatalogPanel } from './ModelCatalogPanel'
import { PreferencesSettingsPanel } from './PreferencesSettingsPanel'
import { RuntimeSettingsPanel } from './RuntimeSettingsPanel'
import { GeneralSettingsPanel } from './GeneralSettingsPanel'
import { AboutSettingsPanel } from './AboutSettingsPanel'
import { ToolsSettingsPanel } from './ToolsSettingsPanel'
import { DataSecuritySettingsPanel, OpenSpecSettingsPanel, PermissionsSettingsPanel } from './AdvancedSettingsPanels'
import { UsageSettingsPanel } from './UsageSettingsPanel'
import { SkillsSettingsPanel } from './SkillsSettingsPanel'
import './settings.css'

const SECTIONS: Array<{ key: SettingsSection; label: string; icon: ReactNode }> = [
  { key: 'overview', label: '设置概览', icon: <AppstoreOutlined /> },
  { key: 'ai-connections', label: 'AI 连接', icon: <ApiOutlined /> },
  { key: 'models', label: '模型目录', icon: <AppstoreOutlined /> },
  { key: 'runtime', label: '运行时', icon: <HddOutlined /> },
  { key: 'general', label: '通用与限制', icon: <SlidersOutlined /> },
  { key: 'tools', label: '工具与插件', icon: <ToolOutlined /> },
  { key: 'skills', label: 'Skills 管理', icon: <AppstoreOutlined /> },
  { key: 'permissions', label: '工具权限', icon: <SafetyCertificateOutlined /> },
  { key: 'data-security', label: '存储与安全', icon: <SafetyCertificateOutlined /> },
  { key: 'usage', label: '用量与价格', icon: <AppstoreOutlined /> },
  { key: 'openspec', label: 'OpenSpec', icon: <SettingOutlined /> },
  { key: 'preferences', label: '偏好设置', icon: <SettingOutlined /> },
  { key: 'about', label: '关于', icon: <InfoCircleOutlined /> },
]

function renderSection(section: SettingsSection): ReactNode {
  switch (section) {
    case 'overview':
      return <SettingsOverviewPanel />
    case 'ai-connections':
      return <AIConnectionsPanel />
    case 'models':
      return <ModelCatalogPanel />
    case 'tools':
      return <ToolsSettingsPanel />
    case 'skills':
      return <SkillsSettingsPanel />
    case 'permissions':
      return <PermissionsSettingsPanel />
    case 'data-security':
      return <DataSecuritySettingsPanel />
    case 'usage':
      return <UsageSettingsPanel />
    case 'openspec':
      return <OpenSpecSettingsPanel />
    case 'preferences':
      return <PreferencesSettingsPanel />
    case 'runtime':
      return <RuntimeSettingsPanel />
    case 'general':
      return <GeneralSettingsPanel />
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
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [section])

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
            <p>ProjectOS 1.7.0</p>
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
          <div className="po-settings-content" key={section} ref={contentRef}>{renderSection(section)}</div>
        </div>
      </div>
    </Modal>
  )
}






