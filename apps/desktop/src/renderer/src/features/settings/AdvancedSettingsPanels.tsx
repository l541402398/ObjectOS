import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Segmented, Switch, Tag } from 'antd'
import { FolderOpenOutlined, LaptopOutlined, LockOutlined, MoonOutlined, SafetyCertificateOutlined, SunOutlined } from '@ant-design/icons'
import { useAgentDefinitions, useAIConnections, useBootstrap } from '../../lib/queries'
import { useUiStore, type ThemeMode } from '../../stores/ui'
import { errorMessage } from '../../lib/errors'

export function PermissionsSettingsPanel() {
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const agents = useAgentDefinitions()
  const update = useMutation({
    mutationFn: (agent: NonNullable<typeof agents.data>['agents'][number]) => window.projectos.agentDefinitions.upsert({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      description: agent.description,
      category: agent.category,
      avatar: agent.avatar,
      visibility: agent.visibility,
      persona: agent.persona,
      skillIds: agent.skills.map((skill) => skill.skillId),
      runtimeProfileIds: agent.runtimeProfileIds,
      primaryRuntimeProfileId: agent.primaryRuntimeProfileId,
      modelRef: agent.modelRef,
      permissions: agent.permissions,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agent-definitions'] })
      message.success('权限已更新')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const list = agents.data?.agents ?? []

  return (
    <div className="po-settings-panel">
      <div className="po-settings-panel-head"><div><h2>工具与权限</h2><p>按 Agent 授权的文件、Shell 与网络能力</p></div></div>
      {list.length === 0 ? <div className="v16-empty-inline">尚未创建 Agent。</div> : (
        <div className="v16-permission-agent-list">
          {list.map((agent) => (
            <div className="v16-permission-agent" key={agent.id}>
              <div className="v16-permission-agent-head"><span className="v16-team-avatar">{agent.avatar || agent.name.slice(0, 1)}</span><div><strong>{agent.name}</strong><span>{agent.role} · v{agent.currentVersion}</span></div><Tag>{agent.status}</Tag></div>
              <div className="v16-permission-switches">
                <label><span>文件写入</span><Switch size="small" checked={agent.permissions.files} onChange={(value) => update.mutate({ ...agent, permissions: { ...agent.permissions, files: value } })} /></label>
                <label><span>Shell</span><Switch size="small" checked={agent.permissions.shell} onChange={(value) => update.mutate({ ...agent, permissions: { ...agent.permissions, shell: value } })} /></label>
                <label><span>网络</span><Switch size="small" checked={agent.permissions.network} onChange={(value) => update.mutate({ ...agent, permissions: { ...agent.permissions, network: value } })} /></label>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="v16-inline-note"><SafetyCertificateOutlined /> 权限在 Runtime 执行前后都由后端校验，危险调用仍需审批。</div>
    </div>
  )
}

export function DataSecuritySettingsPanel() {
  const preferences = useQuery({ queryKey: ['app-preferences'], queryFn: () => window.projectos.app.preferences() })
  const connections = useAIConnections()
  const bootstrap = useBootstrap()
  const stored = connections.data?.connections.filter((connection) => connection.hasSecret).length ?? 0
  return (
    <div className="po-settings-panel">
      <div className="po-settings-panel-head"><div><h2>存储与安全</h2><p>本地数据目录、凭据与审批状态</p></div></div>
      <div className="po-setting-row"><div><strong>数据目录</strong><span className="po-mono">{preferences.data?.dataDir ?? '加载中'}</span></div><Button icon={<FolderOpenOutlined />} disabled={!preferences.data?.dataDir} onClick={() => preferences.data?.dataDir && void window.projectos.app.revealPath(preferences.data.dataDir)}>打开</Button></div>
      <div className="po-setting-row"><div><strong>业务数据库</strong><span className="po-mono">{preferences.data?.dataDir ? `${preferences.data.dataDir}\\projectos.db` : '—'}</span></div></div>
      <div className="po-setting-row"><div><strong>AI 凭据</strong><span>{stored} 个连接已保存 Key；仅保存在 Main 进程安全存储，不写入 SQLite/日志。</span></div><LockOutlined /></div>
      <div className="po-setting-row"><div><strong>待审批</strong><span>{bootstrap.data?.pendingApprovals.length ?? 0} 个高风险操作等待人工确认。</span></div></div>
      <div className="po-setting-row"><div><strong>网络</strong><span>应用未设置独立代理；模型与 Runtime 请求使用系统代理和环境变量。</span></div></div>
      <div className="po-setting-row"><div><strong>平台</strong><span>{preferences.data?.platform ?? '—'} · ProjectOS {preferences.data?.appVersion ?? '1.7.0'}</span></div></div>
    </div>
  )
}

export function AppearanceSettingsPanel() {
  const themeMode = useUiStore((state) => state.themeMode)
  const setThemeMode = useUiStore((state) => state.setThemeMode)
  const reduceMotion = useUiStore((state) => state.reduceMotion)
  const setReduceMotion = useUiStore((state) => state.setReduceMotion)
  const reduceTransparency = useUiStore((state) => state.reduceTransparency)
  const setReduceTransparency = useUiStore((state) => state.setReduceTransparency)
  return (
    <div className="po-settings-panel">
      <div className="po-settings-panel-head"><div><h2>外观与快捷键</h2><p>主题、动效与键盘操作</p></div></div>
      <div className="po-setting-row"><div><strong>主题</strong></div><Segmented value={themeMode} onChange={(value) => setThemeMode(value as ThemeMode)} options={[{ value: 'light', label: '浅色', icon: <SunOutlined /> }, { value: 'dark', label: '深色', icon: <MoonOutlined /> }, { value: 'system', label: '系统', icon: <LaptopOutlined /> }]} /></div>
      <div className="po-setting-row"><div><strong>减少动效</strong></div><Switch checked={reduceMotion} onChange={setReduceMotion} /></div>
      <div className="po-setting-row"><div><strong>减少透明度</strong></div><Switch checked={reduceTransparency} onChange={setReduceTransparency} /></div>
      <div className="v16-shortcut-grid">
        <div><kbd>Ctrl</kbd><kbd>K</kbd><span>命令面板</span></div>
        <div><kbd>Esc</kbd><span>关闭弹层</span></div>
        <div><kbd>Tab</kbd><span>焦点移动</span></div>
        <div><kbd>Enter</kbd><span>确认操作</span></div>
        <div><kbd>G</kbd><span>项目中心</span></div>
        <div><kbd>N</kbd><span>新建任务</span></div>
      </div>
    </div>
  )
}

export function OpenSpecSettingsPanel() {
  return (
    <div className="po-settings-panel">
      <div className="po-settings-panel-head"><div><h2>OpenSpec</h2><p>可选的规范驱动工作流</p></div><Tag>未启用</Tag></div>
      <div className="v16-empty-inline">
        当前版本未集成 OpenSpec CLI。它不会被标记为 Runtime，也不会影响普通任务、编排与 Agent 执行。
      </div>
      <div className="po-setting-row"><div><strong>状态</strong><span>本机未检测到 OpenSpec 集成。安装与启用入口将在后续版本提供。</span></div></div>
    </div>
  )
}
