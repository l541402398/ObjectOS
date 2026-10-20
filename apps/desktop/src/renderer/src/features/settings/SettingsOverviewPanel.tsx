import { AppstoreOutlined, ApiOutlined, BgColorsOutlined, HddOutlined, SafetyOutlined, TeamOutlined, ThunderboltOutlined, ToolOutlined } from '@ant-design/icons'
import { useAIConnections, useBootstrap, useRuntimeProfiles, useSkills } from '../../lib/queries'
import { useUiStore, type SettingsSection } from '../../stores/ui'

const GROUPS: Array<{ title: string; items: Array<{ key: SettingsSection; label: string; description: string; icon: React.ReactNode }> }> = [
  {
    title: 'AI 与模型',
    items: [
      { key: 'ai-connections', label: 'AI 连接', description: '模型服务、密钥与连接测试', icon: <ApiOutlined /> },
      { key: 'models', label: '模型目录', description: '可用模型、能力与默认模型', icon: <AppstoreOutlined /> },
      { key: 'usage', label: '用量与价格', description: 'Token 用量与模型费用', icon: <ThunderboltOutlined /> },
    ],
  },
  {
    title: 'Agent 与执行',
    items: [
      { key: 'runtime', label: '运行时', description: 'Harness 检测、安装与测试', icon: <HddOutlined /> },
      { key: 'tools', label: '工具与插件', description: 'Runtime 能力与 Skills', icon: <ToolOutlined /> },
      { key: 'skills', label: 'Skills 管理', description: '导入与维护流程知识', icon: <AppstoreOutlined /> },
    ],
  },
  {
    title: '工作区与安全',
    items: [
      { key: 'permissions', label: '工具权限', description: '文件、Shell 与网络权限', icon: <SafetyOutlined /> },
      { key: 'team', label: '团队与权限', description: '成员与角色边界', icon: <TeamOutlined /> },
      { key: 'data-security', label: '存储与安全', description: '数据目录、密钥与审批', icon: <SafetyOutlined /> },
    ],
  },
  {
    title: '外观与系统',
    items: [
      { key: 'appearance', label: '外观与快捷键', description: '主题、动效与键盘操作', icon: <BgColorsOutlined /> },
      { key: 'system', label: '系统与外观', description: '透明度、动效与界面密度', icon: <BgColorsOutlined /> },
      { key: 'general', label: '通用', description: '语言、启动与基础偏好', icon: <AppstoreOutlined /> },
    ],
  },
]

export function SettingsOverviewPanel() {
  const setSection = useUiStore((state) => state.setSettingsSection)
  const connections = useAIConnections()
  const runtime = useRuntimeProfiles()
  const skills = useSkills()
  const bootstrap = useBootstrap()
  const availableRuntimes = runtime.data?.profiles.filter((profile) => profile.status === 'available').length ?? 0
  const connected = connections.data?.connections.filter((connection) => connection.hasSecret).length ?? 0

  return (
    <div className="po-settings-panel v17-settings-overview">
      <div className="po-settings-panel-head">
        <div><h2>设置</h2><p>ProjectOS 工作区、执行引擎与外观</p></div>
        <span className="v16-eyebrow">LIQUID GLASS</span>
      </div>

      <div className="v17-settings-stats">
        <div><strong>{bootstrap.data?.projects.length ?? 0}</strong><span>项目</span></div>
        <div><strong>{connected}</strong><span>AI 连接</span></div>
        <div><strong>{availableRuntimes}</strong><span>可用 Runtime</span></div>
        <div><strong>{skills.data?.skills.length ?? 0}</strong><span>Skills</span></div>
      </div>

      {GROUPS.map((group) => (
        <section className="v17-settings-group" key={group.title}>
          <div className="v16-card-title"><strong>{group.title}</strong></div>
          <div className="v17-settings-grid">
            {group.items.map((item) => (
              <button type="button" className="v17-settings-card glass-content" key={item.key} onClick={() => setSection(item.key)}>
                <span className="v17-settings-card-icon">{item.icon}</span>
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
