import { Button, Segmented, Switch } from 'antd'
import { LaptopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'
import { useUiStore, type ThemeMode } from '../../stores/ui'

export function GeneralSettingsPanel() {
  const themeMode = useUiStore((state) => state.themeMode)
  const setThemeMode = useUiStore((state) => state.setThemeMode)
  const reduceTransparency = useUiStore((state) => state.reduceTransparency)
  const setReduceTransparency = useUiStore((state) => state.setReduceTransparency)
  const reduceMotion = useUiStore((state) => state.reduceMotion)
  const setReduceMotion = useUiStore((state) => state.setReduceMotion)
  const setSidebarCollapsed = useUiStore((state) => state.setSidebarCollapsed)

  return (
    <div className="po-settings-panel">
      <div className="po-settings-panel-head">
        <div>
          <h2>通用</h2>
          <p>外观与窗口</p>
        </div>
      </div>

      <div className="po-setting-row">
        <div>
          <strong>主题</strong>
        </div>
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
      <div className="po-setting-row">
        <div>
          <strong>减少透明度</strong>
        </div>
        <Switch checked={reduceTransparency} onChange={setReduceTransparency} />
      </div>
      <div className="po-setting-row">
        <div>
          <strong>减少动效</strong>
        </div>
        <Switch checked={reduceMotion} onChange={setReduceMotion} />
      </div>
      <div className="po-setting-row">
        <div>
          <strong>侧边栏</strong>
        </div>
        <Button onClick={() => setSidebarCollapsed(false)}>展开侧边栏</Button>
      </div>
    </div>
  )
}
