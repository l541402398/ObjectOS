import type { ReactElement } from 'react'
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

export type PremiumEdgeData = {
  emphasis?: 'normal' | 'related' | 'muted'
}

/**
 * Solid, rounded dependency edge for the plan DAG.
 * Selection/focus is a single restrained treatment; there is no continuous
 * dash animation. Topology still comes from the real dependsOn edges.
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
}: EdgeProps): React.ReactElement {
  const emphasis = (data as PremiumEdgeData | undefined)?.emphasis ?? 'normal'
  const related = emphasis === 'related'
  const muted = emphasis === 'muted'
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 18,
    offset: 26,
  })

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={{
        fill: 'none',
        stroke: muted ? 'rgba(150, 164, 184, .28)' : related ? '#6d8df5' : '#95abc9',
        strokeWidth: related ? 2.5 : 1.65,
        strokeOpacity: muted ? 0.55 : related ? 1 : 0.78,
        strokeDasharray: 'none',
        filter: related ? 'drop-shadow(0 0 3px rgba(105, 145, 255, .36))' : 'none',
        transition: 'stroke 160ms ease, stroke-width 160ms ease, stroke-opacity 160ms ease',
      }}
    />
  )
}

