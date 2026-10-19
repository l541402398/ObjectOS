import type { ReactNode } from 'react'

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondary,
  compact = false,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  secondary?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={`po-empty ${compact ? 'is-compact' : ''}`.trim()}>
      {icon ? <div className="po-empty-icon">{icon}</div> : null}
      <div className="po-empty-title">{title}</div>
      {description ? <div className="po-empty-description">{description}</div> : null}
      {action || secondary ? (
        <div className="po-empty-actions">
          {action}
          {secondary}
        </div>
      ) : null}
    </div>
  )
}

export function ErrorState({
  title = '无法加载数据',
  message,
  onRetry,
  retryLabel = '重试',
  compact = false,
}: {
  title?: string
  message?: string | null
  onRetry?: () => void
  retryLabel?: string
  compact?: boolean
}) {
  return (
    <div className={`po-error-state ${compact ? 'is-compact' : ''}`.trim()} role="alert">
      <div className="po-error-mark" aria-hidden="true">
        !
      </div>
      <div className="po-error-body">
        <div className="po-error-title">{title}</div>
        {message ? <div className="po-error-message">{message}</div> : null}
      </div>
      {onRetry ? (
        <button type="button" className="po-text-button" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  )
}

export function LoadingBlock({ rows = 3, label = '正在加载…' }: { rows?: number; label?: string }) {
  return (
    <div className="po-loading-block" role="status" aria-label={label}>
      <div className="po-loading-line is-short" />
      {Array.from({ length: rows }).map((_, index) => (
        <div className="po-loading-line" key={index} style={{ width: `${88 - index * 9}%` }} />
      ))}
    </div>
  )
}

export function InspectorPanel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`po-inspector-inner ${className}`.trim()}>
      <div className="po-inspector-header">
        <div>
          <div className="po-inspector-title">{title}</div>
          {subtitle ? <div className="po-inspector-subtitle">{subtitle}</div> : null}
        </div>
        {action ? <div className="po-inspector-action">{action}</div> : null}
      </div>
      <div className="po-inspector-scroll">{children}</div>
    </div>
  )
}

export function InlineDivider() {
  return <div className="po-inline-divider" aria-hidden="true" />
}
