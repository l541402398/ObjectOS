/** Adapted from Sim Studio (Apache-2.0), commit a52fc509b5b8a18df519ff0781f00c8d45711164.
 * Original: apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-controls/workflow-controls.tsx.
 * See LICENSE-Sim.txt. Modifications: local readonly graph, zoom/fit only, existing Tooltip/icons,
 * semantic tokens and live reduced-motion. No Sim services, tracking, account or execution code.
 */
import { memo, useCallback } from 'react'
import { Tooltip } from 'antd'
import { Maximize, Minus, Plus } from 'lucide-react'
import { useReactFlow, useViewport } from '@xyflow/react'
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference'
import './workbench-controls.css'

export const CanvasControls = memo(function CanvasControls() {
  const flow = useReactFlow()
  const { zoom } = useViewport()
  const reducedMotion = useReducedMotionPreference()
  const duration = reducedMotion ? 0 : 180
  const handleFitToView = useCallback(() => {
    void flow.fitView({ padding: .14, duration, minZoom: .1, maxZoom: 1 })
  }, [flow, duration])

  return (
    <div className="pui-canvas-controls" role="group" aria-label="画布视图">
      <Tooltip title="缩小" trigger={['hover', 'focus']}>
        <button type="button" aria-label="缩小画布" disabled={zoom <= .101} onClick={() => void flow.zoomOut({ duration })}><Minus size={15} /></button>
      </Tooltip>
      <Tooltip title="恢复 100%" trigger={['hover', 'focus']}>
        <button type="button" className="pui-canvas-zoom" aria-label={`缩放 ${Math.round(zoom * 100)}%，恢复 100%`} onClick={() => void flow.zoomTo(1, { duration })}>{Math.round(zoom * 100)}%</button>
      </Tooltip>
      <Tooltip title="放大" trigger={['hover', 'focus']}>
        <button type="button" aria-label="放大画布" disabled={zoom >= 1.399} onClick={() => void flow.zoomIn({ duration })}><Plus size={15} /></button>
      </Tooltip>
      <span className="pui-canvas-divider" aria-hidden="true" />
      <Tooltip title="适应画布" trigger={['hover', 'focus']}>
        <button type="button" className="react-flow__controls-fitview" aria-label="适应画布" onClick={handleFitToView}><Maximize size={14} /></button>
      </Tooltip>
    </div>
  )
})
