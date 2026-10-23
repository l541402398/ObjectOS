import { useId, type ReactElement } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Code2, FlaskConical, Layers3, ScanEye, UserRound } from 'lucide-react'
import type { PlanRole } from '@projectos/contracts'
import type { Stage } from './plan-review-logic'

const ICONS = [Layers3, Code2, ScanEye, FlaskConical]

const ROLE_DESCRIPTIONS: Record<PlanRole, string> = {
  architect: '确认边界与风险',
  developer: '实现依赖与核心改动',
  reviewer: '复核实现与风险',
  tester: '回归与验收',
  custom: '执行计划任务',
}

function iconFor(role: PlanRole | undefined) {
  if (role === 'architect') return Layers3
  if (role === 'developer') return Code2
  if (role === 'reviewer') return ScanEye
  if (role === 'tester') return FlaskConical
  return UserRound
}

function routePoints(count: number): Array<{ x: number; y: number }> {
  if (count <= 1) return [{ x: 500, y: 66 }]
  return Array.from({ length: count }, (_, index) => ({
    x: ((index + 0.5) * 1000) / count,
    y: index % 2 === 0 ? 52 : 34,
  }))
}

function pathFor(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index]!
    const control = Math.max(36, (point.x - previous.x) * 0.46)
    return `${path} C ${previous.x + control} ${previous.y}, ${point.x - control} ${point.y}, ${point.x} ${point.y}`
  }, `M ${points[0]!.x} ${points[0]!.y}`)
}

export function StageJourney({
  stages,
  activeStage,
  onSelect,
  roleLabels,
}: {
  stages: Stage[]
  activeStage: string
  onSelect: (stage: Stage) => void
  roleLabels: Record<PlanRole, string>
}): ReactElement {
  const reduce = useReducedMotion()
  const gradientId = `pui-route-${useId().replace(/:/g, '')}`
  const points = routePoints(stages.length)
  const path = pathFor(points)

  return (
    <div className="pui-route" data-testid="plan-stage-route">
      <svg className="pui-route-svg" viewBox="0 0 1000 130" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1">
            <stop stopColor="var(--pui-accent)" />
            <stop offset=".5" stopColor="var(--pui-violet)" />
            <stop offset="1" stopColor="var(--pui-cyan)" />
          </linearGradient>
        </defs>
        <path className="pui-route-shadow" d={path} />
        <motion.path
          className="pui-route-track"
          d={path}
          stroke={`url(#${gradientId})`}
          initial={reduce ? false : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: reduce ? 0 : 0.75, ease: 'easeOut' }}
        />
      </svg>
      <div className="pui-route-stops" style={{ gridTemplateColumns: `repeat(${Math.max(1, stages.length)}, minmax(0, 1fr))` }}>
        {stages.map((stage, index) => {
          const Icon = ICONS[index % ICONS.length] ?? iconFor(stage.roles[0])
          const selected = activeStage === stage.id
          const tooltip = `${stage.title} · ${ROLE_DESCRIPTIONS[stage.roles[0] ?? 'custom']} · ${stage.entries.length} 个任务 · ${roleLabels[stage.roles[0] ?? 'custom']}`
          return (
            <button
              key={stage.id}
              type="button"
              className={`pui-stop po-stage-card${selected ? ' is-active' : ''}${stage.hasRisk ? ' is-risk' : ''}`}
              onClick={() => onSelect(stage)}
              aria-pressed={selected}
              aria-label={tooltip}
              title={tooltip}
              style={{ transform: `translateY(${index % 2 === 0 ? 7 : -11}px)` }}
            >
              <motion.span
                className="pui-stop-orb"
                whileHover={reduce ? undefined : { y: -4, scale: 1.035 }}
                transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              >
                <Icon size={25} strokeWidth={1.55} />
                {stage.hasRisk ? <i className="pui-stop-risk" /> : null}
              </motion.span>
              <span className="pui-stop-tooltip" role="tooltip" aria-hidden="true">{tooltip}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

