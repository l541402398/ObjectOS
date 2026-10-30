import type { ReactNode } from 'react'
import { Tooltip } from 'antd'

export interface PageHeaderProps {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  compact?: boolean
}

export function PageHeader({ eyebrow, title, description, actions, meta, compact = false }: PageHeaderProps) {
  return (
    <header className={`po-page-header ${compact ? 'is-compact' : ''}`.trim()}>
      <div className="po-page-heading">
        {eyebrow ? <div className="po-eyebrow">{eyebrow}</div> : null}
        <h1 className="po-page-title">{title}</h1>
        {description ? <p className="po-page-description">{description}</p> : null}
        {meta ? <div className="po-page-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="po-page-actions">{actions}</div> : null}
    </header>
  )
}

export interface SectionCardProps {
  title?: ReactNode
  subtitle?: ReactNode
  extra?: ReactNode
  children: ReactNode
  className?: string
  padded?: boolean
  flush?: boolean
  id?: string
}

export function SectionCard({
  title,
  subtitle,
  extra,
  children,
  className = '',
  padded = true,
  flush = false,
  id,
}: SectionCardProps) {
  return (
    <section id={id} className={`po-card ${flush ? 'is-flush' : ''} ${className}`.trim()}>
      {title || extra ? (
        <div className="po-card-header">
          <div className="po-card-heading">
            <div className="po-card-title">{title}</div>
            {subtitle ? <div className="po-card-subtitle">{subtitle}</div> : null}
          </div>
          {extra ? <div className="po-card-extra">{extra}</div> : null}
        </div>
      ) : null}
      <div className={`po-card-body ${padded ? '' : 'is-unpadded'}`.trim()}>{children}</div>
    </section>
  )
}

export interface MetricCardProps {
  label: ReactNode
  value: ReactNode
  suffix?: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'
  progress?: number
  onClick?: () => void
}

export function MetricCard({ label, value, suffix, hint, icon, tone = 'neutral', progress, onClick }: MetricCardProps) {
  return (
    <div
      className={`po-metric po-metric-${tone} ${onClick ? 'is-clickable' : ''}`.trim()}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      <div className="po-metric-top">
        <span className="po-metric-label">{label}</span>
        {icon ? <span className="po-metric-icon">{icon}</span> : null}
      </div>
      <div className="po-metric-value">
        {value}
        {suffix ? <span className="po-metric-suffix">{suffix}</span> : null}
      </div>
      {typeof progress === 'number' ? (
        <div className="po-metric-progress" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }} />
        </div>
      ) : null}
      {hint ? <div className="po-metric-hint">{hint}</div> : null}
    </div>
  )
}

export interface KeyValueItem {
  label: ReactNode
  value: ReactNode
  mono?: boolean
}

export function KeyValueList({ items, compact = false }: { items: KeyValueItem[]; compact?: boolean }) {
  return (
    <dl className={`po-kv ${compact ? 'is-compact' : ''}`.trim()}>
      {items.map((item, index) => (
        <div className="po-kv-row" key={index}>
          <dt>{item.label}</dt>
          <dd className={item.mono ? 'is-mono' : ''} title={typeof item.value === 'string' ? item.value : undefined}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function AgentAvatar({
  name,
  accent = '#4C8DFF',
  size = 30,
  status,
  title,
}: {
  name: string
  accent?: string
  size?: number
  status?: 'working' | 'idle' | 'offline'
  title?: string
}) {
  const initial = [...name.trim()][0] ?? 'A'
  const avatar = (
    <span
      className={`po-avatar ${status ? `is-${status}` : ''}`.trim()}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(12, Math.round(size * 0.38)),
        background: 'var(--ui-accent-soft)',
        color: 'var(--ui-accent-strong)',
        borderColor: accent,
      }}
      aria-label={name}
    >
      {initial}
      {status ? <i className="po-avatar-status" /> : null}
    </span>
  )
  return title ? <Tooltip title={title}>{avatar}</Tooltip> : avatar
}

export function ProgressBar({
  value,
  tone = 'accent',
  label,
  showValue = false,
  height = 6,
}: {
  value: number
  tone?: 'accent' | 'success' | 'warning' | 'danger'
  label?: ReactNode
  showValue?: boolean
  height?: number
}) {
  const percent = Math.max(0, Math.min(100, value * 100))
  return (
    <div className="po-progress">
      {label || showValue ? (
        <div className="po-progress-meta">
          <span>{label}</span>
          {showValue ? <span>{Math.round(percent)}%</span> : null}
        </div>
      ) : null}
      <div className={`po-progress-track po-progress-${tone}`} style={{ height }}>
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
