import type { ReactNode } from 'react'

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

export interface StatusPillProps {
  tone?: Tone
  children: ReactNode
  dot?: boolean
  icon?: ReactNode
  className?: string
  title?: string
}

export function StatusPill({ tone = 'neutral', children, dot = true, icon, className = '', title }: StatusPillProps) {
  return (
    <span className={`po-pill po-pill-${tone} ${className}`.trim()} title={title}>
      {icon ?? (dot ? <span className="po-pill-dot" aria-hidden="true" /> : null)}
      <span>{children}</span>
    </span>
  )
}

const STATUS_TONES: Record<string, Tone> = {
  active: 'success',
  archived: 'neutral',
  paused: 'warning',
  completed: 'success',
  backlog: 'neutral',
  ready: 'info',
  running: 'accent',
  review: 'warning',
  done: 'success',
  blocked: 'danger',
  cancelled: 'neutral',
  created: 'neutral',
  queued: 'info',
  waiting_tool: 'warning',
  waiting_approval: 'warning',
  verifying: 'accent',
  failed: 'danger',
  suspended: 'warning',
  needs_reconciliation: 'danger',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  expired: 'neutral',
  requested: 'warning',
  accepted: 'success',
  draft: 'neutral',
  implemented: 'success',
  proposed: 'warning',
  superseded: 'neutral',
  planned: 'neutral',
  activeStage: 'accent',
  stored: 'neutral',
  delivered: 'info',
  unknown: 'warning',
  offline: 'neutral',
  idle: 'neutral',
  working: 'accent',
  loading: 'warning',
  success: 'success',
  error: 'danger',
  abort: 'neutral',
  skipped: 'neutral',
}

export function toneForStatus(status: string): Tone {
  return STATUS_TONES[status] ?? 'neutral'
}
