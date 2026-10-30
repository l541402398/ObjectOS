import { Sparkles } from 'lucide-react'
import { errorMessage } from '../lib/errors'
import bootContent from '../startup/boot-content.html?raw'

export function BootScreen() {
  // Authored static HTML, also inserted into index.html at build time. Never interpolates data.
  return (
    <main
      className="po-boot"
      aria-label="启动 ProjectOS"
      aria-busy="true"
      dangerouslySetInnerHTML={{ __html: bootContent }}
    />
  )
}

export function BootError({
  error,
  onRetry,
  title = '无法启动 ProjectOS',
  retryLabel = '重试启动',
}: {
  error: unknown
  onRetry: () => void
  title?: string
  retryLabel?: string
}) {
  return (
    <main className="po-boot" aria-label={title}>
      <div className="po-boot-frame" aria-hidden="true" />
      <div className="po-boot-card is-error">
        <div className="po-boot-mark" aria-hidden="true">
          <Sparkles size={36} strokeWidth={1.5} />
        </div>
        <h1 className="po-boot-title">{title}</h1>
        <div className="po-boot-error" role="alert">
          {errorMessage(error)}
        </div>
        <button type="button" onClick={onRetry}>
          {retryLabel}
        </button>
      </div>
    </main>
  )
}
