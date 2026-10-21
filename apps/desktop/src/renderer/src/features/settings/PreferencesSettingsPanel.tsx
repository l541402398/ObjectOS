import { Button, Segmented, Switch } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { FolderOpenOutlined, LaptopOutlined, MoonOutlined, SafetyCertificateOutlined, SunOutlined } from '@ant-design/icons'
import { useUiStore, type ThemeMode } from '../../stores/ui'

export function PreferencesSettingsPanel() {
  const themeMode = useUiStore((state) => state.themeMode)
  const setThemeMode = useUiStore((state) => state.setThemeMode)
  const reduceTransparency = useUiStore((state) => state.reduceTransparency)
  const setReduceTransparency = useUiStore((state) => state.setReduceTransparency)
  const reduceMotion = useUiStore((state) => state.reduceMotion)
  const setReduceMotion = useUiStore((state) => state.setReduceMotion)
  const setSidebarCollapsed = useUiStore((state) => state.setSidebarCollapsed)
  const preferences = useQuery({ queryKey: ['app-preferences'], queryFn: () => window.projectos.app.preferences() })

  return (
    <div className="po-settings-panel">
      <div className="po-settings-panel-head">
        <div><h2>偏好设置</h2><p>外观、系统、快捷键与基础偏好</p></div>
      </div>

      <div className="po-settings-section-title">外观</div>
      <div className="v17-preferences-group">
        <div className="po-setting-row">
          <div><strong>主题</strong><span>浅色、深色或跟随系统</span></div>
          <Segmented
            value={themeMode}
            onChange={(value) => setThemeMode(value as ThemeMode)}
            options={[
              { value: 'light', label: '浅色', icon: <SunOutlined /> },
              { value: 'dark', label: '深色', icon: <MoonOutlined /> },
              { value: 'system', label: '系统', icon: <LaptopOutlined /> },
            ]}
          />
        </div>
        <div className="po-setting-row"><div><strong>减少透明度</strong><span>关闭玻璃模糊，提升低性能设备可读性</span></div><Switch checked={reduceTransparency} onChange={setReduceTransparency} /></div>
        <div className="po-setting-row"><div><strong>减少动效</strong><span>减少面板滑入、渐变与过渡动画</span></div><Switch checked={reduceMotion} onChange={setReduceMotion} /></div>
        <div className="po-setting-row"><div><strong>侧边栏</strong><span>恢复展开的全局导航</span></div><Button onClick={() => setSidebarCollapsed(false)}>展开侧边栏</Button></div>
      </div>

      <div className="po-settings-section-title">系统</div>
      <div className="v17-preferences-group">
        <div className="po-setting-row">
          <div><strong>数据目录</strong><span className="po-mono">{preferences.data?.dataDir ?? '加载中'}</span></div>
          <Button
            icon={<FolderOpenOutlined />}
            disabled={!preferences.data?.dataDir}
            onClick={() => preferences.data?.dataDir && void window.projectos.app.revealPath(preferences.data.dataDir)}
          >
            打开
          </Button>
        </div>
        <div className="po-setting-row"><div><strong>应用版本</strong><span>ProjectOS {preferences.data?.appVersion ?? '1.7.0'}</span></div></div>
        <div className="po-setting-row"><div><strong>平台</strong><span>{preferences.data?.platform ?? '—'}</span></div></div>
      </div>

      <div className="po-settings-section-title">快捷键</div>
      <div className="v16-shortcut-grid">
        <div><kbd>Ctrl</kbd><kbd>K</kbd><span>命令面板</span></div>
        <div><kbd>Esc</kbd><span>关闭弹层</span></div>
        <div><kbd>Tab</kbd><span>焦点移动</span></div>
        <div><kbd>Enter</kbd><span>确认操作</span></div>
        <div><kbd>G</kbd><span>项目中心</span></div>
        <div><kbd>N</kbd><span>新建任务</span></div>
      </div>

      <div className="po-settings-section-title">安全</div>
      <div className="v17-preferences-group">
        <div className="po-setting-row"><div><strong>API Key 存储</strong><span>仅保存在本机 Main 进程安全存储，不写入项目文件或日志。</span></div><SafetyCertificateOutlined className="po-muted" /></div>
      </div>
    </div>
  )
}
