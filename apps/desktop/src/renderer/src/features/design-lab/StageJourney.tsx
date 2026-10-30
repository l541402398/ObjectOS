import { useId, type ReactElement } from 'react'
import { motion } from 'motion/react'
import { Code2, FlaskConical, Layers3, ScanEye } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../next-ui/ui/tooltip'
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference'
import type { LabStage } from './data'

const ICONS = [Layers3, Code2, ScanEye, FlaskConical]
const ANCHORS = [
  { x: 92, y: 82 },
  { x: 360, y: 42 },
  { x: 642, y: 88 },
  { x: 908, y: 48 },
]

/** SVG and icon centres share the same 1000 × 140 coordinates at every size and zoom. */
export function LabStageJourney({
  stages,
  active,
  onSelect,
  taskCounts,
  theme = 'light',
}: {
  stages: LabStage[]
  active: string
  onSelect: (id: string) => void
  taskCounts: Record<string, number>
  theme?: 'light' | 'dark'
}): ReactElement {
  const reduce = useReducedMotionPreference(),
    rawId = useId()
  const gradientId = `pdl-route-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`
  const path = 'M 92 82 C 196 82 220 30 360 42 S 530 118 642 88 S 806 28 908 48'
  return (
    <TooltipProvider>
      <div className="pdl-journey">
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
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: reduce ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
        <div className="pdl-journey-stops">
          {stages.map((stage, index) => {
            const Icon = ICONS[index % ICONS.length]!,
              anchor = ANCHORS[index]!,
              selected = stage.id === active
            return (
              <Tooltip key={stage.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={`pdl-stop${selected ? ' is-active' : ''}${stage.risk ? ' is-risk' : ''}`}
                    onClick={() => onSelect(stage.id)}
                    aria-pressed={selected}
                    aria-label={`${stage.title}，${taskCounts[stage.id] ?? 0} 个任务`}
                    data-anchor-x={anchor.x}
                    data-anchor-y={anchor.y}
                    style={{ left: `${anchor.x / 10}%`, top: `${anchor.y / 1.4}%` }}
                  >
                    <motion.span
                      className="pdl-stop-orb"
                      whileHover={reduce ? undefined : { scale: 1.035 }}
                      transition={{ duration: reduce ? 0 : 0.16 }}
                    >
                      <Icon size={25} strokeWidth={1.55} aria-hidden />
                      {stage.risk ? <i className="pdl-stop-risk" aria-hidden /> : null}
                      {selected ? (
                        <motion.i
                          className="pdl-stop-halo"
                          layoutId="pdl-stage-halo"
                          transition={{ duration: reduce ? 0 : 0.18 }}
                          aria-hidden
                        />
                      ) : null}
                    </motion.span>
                  </button>
                </TooltipTrigger>
                <TooltipContent className="pdl-tooltip" data-theme={theme} side="bottom">
                  <strong>{stage.title}</strong>
                  <span>
                    {taskCounts[stage.id] ?? 0} 项工作 · {stage.role}
                  </span>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </div>
    </TooltipProvider>
  )
}
