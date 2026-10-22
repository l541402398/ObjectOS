import { useId, type ReactElement } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Code2, FlaskConical, Layers3, ScanEye } from 'lucide-react'
import type { LabStage } from './data'

const ICONS = [Layers3, Code2, ScanEye, FlaskConical]

export function LabStageJourney({
  stages,
  active,
  onSelect,
  taskCounts,
}: {
  stages: LabStage[]
  active: string
  onSelect: (id: string) => void
  taskCounts: Record<string, number>
}): ReactElement {
  const reduce = useReducedMotion()
  const rawId = useId()
  const gradientId = `pdl-route-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`
  const path = 'M 92 82 C 196 82 220 30 360 42 S 530 118 642 88 S 806 28 908 48'

  return (
    <div className="pdl-journey">
      <svg className="pdl-journey-svg" viewBox="0 0 1000 132" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1">
            <stop stopColor="var(--pdl-accent)" />
            <stop offset=".52" stopColor="var(--pdl-violet)" />
            <stop offset="1" stopColor="var(--pdl-cyan)" />
          </linearGradient>
        </defs>
        <path className="pdl-journey-shadow" d={path} />
        <motion.path
          className="pdl-journey-track"
          d={path}
          stroke={`url(#${gradientId})`}
          initial={reduce ? false : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: reduce ? 0 : 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="pdl-journey-stops">
        {stages.map((stage, index) => {
          const Icon = ICONS[index % ICONS.length]!
          const selected = stage.id === active
          return (
            <motion.button
              key={stage.id}
              type="button"
              className={`pdl-stop${selected ? ' is-active' : ''}${stage.risk ? ' is-risk' : ''}`}
              onClick={() => onSelect(stage.id)}
              aria-pressed={selected}
              aria-label={`${stage.title}，${taskCounts[stage.id] ?? 0} 个任务`}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + index * 0.06, duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="pdl-stop-count">0{index + 1}</span>
              <motion.span
                className="pdl-stop-orb"
                whileHover={reduce ? undefined : { y: -4, scale: 1.035 }}
                transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              >
                <Icon size={25} strokeWidth={1.55} />
                {stage.risk ? <i className="pdl-stop-risk" /> : null}
                {selected ? <motion.i className="pdl-stop-halo" layoutId="pdl-stage-halo" /> : null}
              </motion.span>
              <span className="pdl-stop-copy">
                <strong>{stage.title}</strong>
                <span>{stage.subtitle}</span>
              </span>
              <span className="pdl-stop-meta">{taskCounts[stage.id] ?? 0} 项工作 · {stage.role}</span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

