import type { ReactNode } from 'react'
import { Tooltip } from 'antd'
import {
  AgentAvatar3DSvg,
  resolveAgentPersona3D,
  resolveAgentWorkActivity,
  type AgentWorkActivity,
} from './AgentAvatar3D.js'

export * from './AgentAvatar3D.js'

export interface PageHeaderProps {
  /** @deprecated Product navigation already identifies the category; omit decorative duplicate labels. */
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  compact?: boolean
}

export function PageHeader({ title, description, actions, meta, compact = false }: PageHeaderProps) {
  return (
    <header className={`po-page-header ${compact ? 'is-compact' : ''}`.trim()}>
      <div className="po-page-heading">
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
  accent,
  size = 38,
  status,
  title,
  personaId,
  role,
  activity,
  taskTitle,
  taskDescription,
  taskLabels,
}: {
  name: string
  accent?: string
  size?: number
  status?: 'working' | 'idle' | 'offline'
  title?: string
  personaId?: string
  role?: string
  activity?: AgentWorkActivity
  taskTitle?: string
  taskDescription?: string
  taskLabels?: readonly string[]
}) {
  const initial = [...name.trim()][0] ?? 'A'
  const persona = resolveAgentPersona3D(role ? `${name} ${role}` : name, personaId)
  const workActivity = resolveAgentWorkActivity({
    status,
    activity,
    role,
    name,
    taskTitle,
    taskDescription,
    taskLabels,
    persona,
  })
  const avatar = (
    <span
      className={`po-avatar po-avatar-3d ${status ? `is-${status}` : 'is-idle'} is-activity-${workActivity}`.trim()}
      style={{
        width: size,
        height: size,
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '28%',
        padding: 0,
        overflow: 'visible',
        background: 'transparent',
        borderColor: accent ?? persona.ring,
      }}
      aria-label={name}
      data-persona-id={persona.id}
      data-gender={persona.gender}
      data-work-activity={workActivity}
    >
      <AgentAvatar3DSvg
        persona={persona}
        size={size}
        status={status}
        workActivity={workActivity}
      />
      <span
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {initial}
      </span>
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
