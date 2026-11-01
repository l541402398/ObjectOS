import fontLicense from '../../assets/fonts/OFL-NotoSansSC.txt?raw'
import simLicense from '../../next-ui/vendor/LICENSE-Sim.txt?raw'
import simNotice from '../../next-ui/vendor/NOTICE-Sim.txt?raw'
import shadcnLicense from '../../next-ui/vendor/LICENSE-shadcn.txt?raw'

export function AboutSettingsPanel() {
  return (
    <div className="po-settings-panel">
      <div className="po-settings-panel-head">
        <div>
          <h2>关于</h2>
          <p>ProjectOS 1.7.0</p>
        </div>
      </div>

      <div className="po-about">
        <div className="po-logo po-logo-md" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div>
          <strong>ProjectOS</strong>
          <span>本地优先的 AI 项目工作台</span>
        </div>
      </div>

      <div className="po-about-stack">
        <span>TypeScript</span>
        <span>Node.js</span>
        <span>React</span>
        <span>Ant Design</span>
        <span>Ant Design X</span>
        <span>Electron</span>
        <span>SQLite</span>
      </div>

      <div className="po-about-links">
        <span>MIT License</span>
        <span>ProjectOS contributors</span>
      </div>
      <details className="po-font-license">
        <summary>字体许可 · Noto Sans SC</summary>
        <pre>{fontLicense}</pre>
      </details>
      <details className="po-font-license">
        <summary>界面组件许可 · Sim Studio / shadcn/ui</summary>
        <p>画布工具栏基于 Sim Studio，标签页组件基于 shadcn/ui；均已适配 ProjectOS。</p>
        <pre>{simNotice}{'\n\n'}{simLicense}{'\n\n'}{shadcnLicense}</pre>
      </details>
    </div>
  )
}
