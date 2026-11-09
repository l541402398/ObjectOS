import type { ReactElement } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Activity, LayoutGrid, Network, Workflow } from 'lucide-react'
import { siblingViews } from '../page-registry'
import './view-tabs.css'

const ICONS: Record<string, typeof Activity> = { tasks: LayoutGrid, agents: Workflow, orchestration: Network, runs: Activity }

/**
 * ADR-0090 — secondary views of one sidebar entry. 执行 = 任务看板 / Agent 协作 / 计划编排 / 运行审计.
 * Each view keeps its own route (deep links, back/forward) but they read as one place.
 */
export function ViewTabs({ activeKey, onSelect, badges = {} }: { activeKey: string; onSelect: (key: string) => void; badges?: Record<string, number> }): ReactElement | null {
  const reduceMotion = useReducedMotion()
  const views = siblingViews(activeKey)
  if (views.length === 0) return null
  return (
    <nav className="po-viewtabs" aria-label="执行视图">
      {views.map((view) => {
        const Icon = ICONS[view.key] ?? LayoutGrid
        const active = view.key === activeKey
        return (
          <button key={view.key} type="button" className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined} onClick={() => onSelect(view.key)}>
            {active ? <motion.span layoutId="po-viewtab-pill" className="po-viewtabs-pill" transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40 }} /> : null}
            <Icon size={14} strokeWidth={1.8} aria-hidden />
            <span>{view.label}</span>
            {badges[view.key] ? <b>{badges[view.key]}</b> : null}
          </button>
        )
      })}
    </nav>
  )
}
