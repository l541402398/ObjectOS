import type { KeyboardEvent, ReactElement, ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import './kpi-rail.css'

/**
 * ADR-0091: integrated KPI rail for 项目态势. One continuous strip, hairline dividers, a large
 * typographic value, one honest mini-visual (arc / segments / meter) derived from real counts —
 * never a fabricated trend — and a one-line status. Each block is a link when it has a destination.
 */
export type KpiVisual =
  | { kind: 'arc'; value: number }
  | { kind: 'segments'; filled: number; total: number }
  | { kind: 'pulse'; active: boolean }

export interface KpiBlock {
  key: string
  label: string
  value: ReactNode
  suffix?: string
  status: ReactNode
  tone?: 'accent' | 'ok' | 'warn' | 'neutral'
  visual?: KpiVisual
  actionLabel?: string
  onOpen?: () => void
}

function Arc({ value }: { value: number }): ReactElement {
  const clamped = Math.max(0, Math.min(1, value))
  const r = 17
  const c = 2 * Math.PI * r
  return (
    <svg className="kpi-arc" viewBox="0 0 44 44" aria-hidden>
      <circle cx="22" cy="22" r={r} className="kpi-arc-track" />
      <circle cx="22" cy="22" r={r} className="kpi-arc-value" strokeDasharray={`${c * clamped} ${c}`} transform="rotate(-90 22 22)" />
    </svg>
  )
}

function Segments({ filled, total }: { filled: number; total: number }): ReactElement {
  const count = Math.max(1, Math.min(total, 12))
  return (
    <span className="kpi-segments" aria-hidden>
      {Array.from({ length: count }, (_, index) => <i key={index} className={index < filled ? 'is-on' : ''} />)}
    </span>
  )
}

export function KpiRail({ blocks, label }: { blocks: KpiBlock[]; label: string }): ReactElement {
  return (
    <section className="kpi-rail" aria-label={label}>
      {blocks.map((block) => {
        const interactive = Boolean(block.onOpen)
        const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
          if (!block.onOpen) return
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); block.onOpen() }
        }
        return (
          <div
            key={block.key}
            className={`kpi-block is-${block.tone ?? 'neutral'} ${interactive ? 'is-link' : ''}`}
            role={interactive ? 'link' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `${block.label}，${block.actionLabel ?? '查看'}` : undefined}
            onClick={block.onOpen}
            onKeyDown={onKey}
          >
            <div className="kpi-top">
              <span className="kpi-label">{block.label}</span>
              {interactive ? <span className="kpi-go">{block.actionLabel ?? '查看'}<ArrowUpRight size={12} /></span> : null}
            </div>
            <div className="kpi-main">
              <span className="kpi-value">{block.value}{block.suffix ? <small>{block.suffix}</small> : null}</span>
              {block.visual?.kind === 'arc' ? <Arc value={block.visual.value} /> : null}
              {block.visual?.kind === 'segments' ? <Segments filled={block.visual.filled} total={block.visual.total} /> : null}
              {block.visual?.kind === 'pulse' ? <span className={`kpi-pulse ${block.visual.active ? 'is-on' : ''}`} aria-hidden><i /></span> : null}
            </div>
            <p className="kpi-status">{block.status}</p>
          </div>
        )
      })}
    </section>
  )
}
