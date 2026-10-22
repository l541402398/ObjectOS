import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import type { ReactElement } from 'react'

export type PremiumEdgeData = {
  highlighted: boolean
  focused: boolean
}

/**
 * Solid, rounded dependency edge. The highlighted state is computed from the
 * selected task's real upstream/downstream path in TaskGraph. There is no
 * continuous graph-wide animation; the active path reveals once.
 */
export function PremiumDependencyEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps): ReactElement {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
    offset: 22,
  })
  const highlighted = Boolean(data?.highlighted)
  const focused = Boolean(data?.focused)
  const gradientId = `pdl-edge-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  return (
    <g className={`pdl-edge${highlighted ? ' is-active' : ''}`}>
      {highlighted ? (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop stopColor="#738df0" />
            <stop offset=".55" stopColor="#8e9cf5" />
            <stop offset="1" stopColor="#58c3d2" />
          </linearGradient>
        </defs>
      ) : null}
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={14}
        style={{
          fill: 'none',
          stroke: highlighted ? `url(#${gradientId})` : 'var(--pdl-edge-neutral)',
          strokeWidth: focused ? 2.2 : highlighted ? 1.9 : 1.45,
          strokeOpacity: highlighted ? 1 : .9,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          strokeDasharray: 'none',
          filter: highlighted ? 'drop-shadow(0 0 3px rgba(105, 145, 255, .28))' : 'none',
          transition: 'stroke 180ms ease, stroke-width 180ms ease, stroke-opacity 180ms ease',
        }}
      />
    </g>
  )
}


