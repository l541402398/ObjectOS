import { useId, type ReactElement } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Code2, FlaskConical, Layers3, ScanEye } from 'lucide-react'
import type { LabStage } from './data'

const ICONS = [Layers3, Code2, ScanEye, FlaskConical]
const ANCHORS = [
  { x: 120, y: 58 },
  { x: 360, y: 40 },
  { x: 640, y: 76 },
  { x: 880, y: 46 },
]

function pathFor(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index]!
    const mid = (previous.x + point.x) / 2
    return `${path} C ${mid} ${previous.y}, ${mid} ${point.y}, ${point.x} ${point.y}`
  }, `M ${points[0]!.x} ${points[0]!.y}`)
}

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
  const points = ANCHORS.slice(0, Math.max(1, Math.min(ANCHORS.length, stages.length)))
  const path = pathFor(points)

  return (
    <Tooltip.Provider delayDuration={220}>
      <div className="pdl-journey" data-testid="design-lab-stage-journey">
        <svg className="pdl-journey-svg" viewBox="0 0 1000 140" preserveAspectRatio="none" aria-hidden="true">
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
            const anchor = points[Math.min(index, points.length - 1)]!
            return (
              <Tooltip.Root key={stage.id}>
                <Tooltip.Trigger asChild>
                  <motion.button
                    type="button"
                    className={`pdl-stop${selected ? ' is-active' : ''}${stage.risk ? ' is-risk' : ''}`}
                    onClick={() => onSelect(stage.id)}
                    aria-pressed={selected}
                    aria-label={`${stage.title}，${taskCounts[stage.id] ?? 0} 个任务`}
                    data-anchor-x={anchor.x}
                    data-anchor-y={anchor.y}
                    style={{ left: `${anchor.x / 10}%`, top: `${anchor.y / 1.4}%` }}
                    initial={reduce ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.06 + index * 0.05, duration: 0.3 }}
                  >
                    <motion.span className="pdl-stop-orb" whileHover={reduce ? undefined : { scale: 1.045 }} transition={{ type: 'spring', stiffness: 380, damping: 28 }}>
                      <Icon size={25} strokeWidth={1.55} />
                      {stage.risk ? <i className="pdl-stop-risk" /> : null}
                      {selected ? <motion.i className="pdl-stop-halo" layoutId="pdl-stage-halo" /> : null}
                    </motion.span>
                  </motion.button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content className="pdl-tooltip" sideOffset={9} collisionPadding={10}>
                    <strong>{stage.title}</strong>
                    <span>{stage.subtitle}</span>
                    <em>{taskCounts[stage.id] ?? 0} 项工作 · {stage.role}</em>
                    <Tooltip.Arrow className="pdl-tooltip-arrow" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            )
          })}
        </div>
      </div>
    </Tooltip.Provider>
  )
}

