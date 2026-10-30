import fontLicense from '../../assets/fonts/OFL-NotoSansSC.txt?raw'

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
    </div>
  )
}
