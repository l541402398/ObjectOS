import { Spin } from 'antd'
import { errorMessage } from '../lib/errors'

export function BootScreen() {
  return (
    <div className="po-boot">
      <div className="po-boot-glow" />
      <div className="po-logo po-logo-lg" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="po-boot-title">ProjectOS</div>
      <div className="po-boot-subtitle">AI Native 项目全生命周期工作台</div>
      <div className="po-boot-status">
        <Spin size="small" />
        <span>正在启动本地 Runtime 与 SQLite…</span>
      </div>
      <div className="po-boot-foot">本地优先 · 无网络端口 · 所有状态可恢复</div>
    </div>
  )
}

export function BootError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="po-boot">
      <div className="po-logo po-logo-lg" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="po-boot-title">无法启动 ProjectOS</div>
      <div className="po-boot-error">{errorMessage(error)}</div>
      <button type="button" className="po-primary-button" onClick={onRetry}>
        重试启动
      </button>
      <div className="po-boot-foot">
        请确认已运行 <code>pnpm build:runtime</code>，或查看日志目录中的 desktop.log。
      </div>
    </div>
  )
}
