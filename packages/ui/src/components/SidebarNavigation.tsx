import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Tooltip } from 'antd'

export interface SidebarNavItem {
  key: string
  label: string
  icon?: ReactNode
  badge?: number | string | null
  title?: string
  disabled?: boolean
}

export interface SidebarNavGroup {
  key?: string
  title?: string
  items: SidebarNavItem[]
  collapsible?: boolean
  disabled?: boolean
  note?: string
}

export interface SidebarNavigationProps {
  groups: SidebarNavGroup[]
  activeKey: string
  onSelect: (key: string) => void
  collapsed?: boolean
  /** Group the current page *belongs to*, even when the page itself has no nav item. */
  activeGroupTitle?: string
  footer?: ReactNode
}

const STORAGE_KEY = 'projectos.sidebar.expandedGroups'

function readExpanded(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, boolean>)
      : {}
  } catch {
    return {}
  }
}

export function SidebarNavigation({ groups, activeKey, onSelect, collapsed = false, activeGroupTitle, footer }: SidebarNavigationProps) {
  const activeGroupKey = useMemo(
    () => groups.find((group) => group.items.some((item) => item.key === activeKey))?.key ?? '',
    [activeKey, groups],
  )
  /**
   * ADR-0052 — a page without a nav item must still show where it lives.
   *
   * 编排工作台、工作区、通知中心 are entered from a page link or the command palette, not the sidebar.
   * For those, `activeGroupKey` is empty, so a fresh profile expanded *nothing* and the sidebar looked
   * like an empty list of group headers. Fall back to the registry group of the current page.
   */
  const groupKeyForTitle = useMemo(
    () => (activeGroupTitle ? (groups.find((group) => group.title === activeGroupTitle)?.key ?? '') : ''),
    [groups, activeGroupTitle],
  )
  const effectiveGroupKey = activeGroupKey || groupKeyForTitle

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const restored = readExpanded()
    if (Object.keys(restored).length > 0) return restored
    return effectiveGroupKey ? { [effectiveGroupKey]: true } : {}
  })

  useEffect(() => {
    if (!effectiveGroupKey) return
    setExpanded((current) => (current[effectiveGroupKey] ? current : { ...current, [effectiveGroupKey]: true }))
  }, [effectiveGroupKey])

  const toggle = (groupKey: string): void => {
    setExpanded((current) => {
      const next = { ...current, [groupKey]: !current[groupKey] }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Persistence is best-effort; navigation still works.
      }
      return next
    })
  }

  const renderItem = (item: SidebarNavItem) => {
    const active = item.key === activeKey
    const button = (
      <button
        type="button"
        key={item.key}
        className={`po-nav-item ${active ? 'is-active' : ''}`.trim()}
        onClick={() => onSelect(item.key)}
        disabled={item.disabled}
        aria-current={active ? 'page' : undefined}
        title={item.title ?? item.label}
      >
        {item.icon ? <span className="po-nav-icon">{item.icon}</span> : null}
        <span className="po-nav-label">{item.label}</span>
        {item.badge !== null && item.badge !== undefined && item.badge !== 0 ? (
          <span className="po-nav-badge">{item.badge}</span>
        ) : null}
      </button>
    )
    return collapsed ? (
      <Tooltip key={item.key} title={item.label} placement="right">
        {button}
      </Tooltip>
    ) : (
      button
    )
  }

  return (
    <div className="po-sidenav">
      <div className="po-sidenav-scroll">
        {groups.map((group, index) => {
          const groupKey = group.key ?? group.title ?? `group-${index}`
          const isCollapsible = !collapsed && group.collapsible !== false && Boolean(group.title)
          const isOpen = collapsed || group.disabled ? false : expanded[groupKey] === true
          return (
            <div className={`po-sidenav-group ${group.disabled ? 'is-disabled' : ''}`.trim()} key={groupKey}>
              {!collapsed && group.title ? (
                <button
                  type="button"
                  className={`po-sidenav-title po-sidenav-group-trigger ${isOpen ? 'is-open' : ''}`.trim()}
                  onClick={() => isCollapsible && !group.disabled && toggle(groupKey)}
                  aria-expanded={isCollapsible ? isOpen : undefined}
                  disabled={group.disabled || !isCollapsible}
                >
                  <span>{group.title}</span>
                  {group.note ? <span className="po-sidenav-note">{group.note}</span> : null}
                  {isCollapsible ? <span className="po-sidenav-chevron" aria-hidden="true">›</span> : null}
                </button>
              ) : null}
              {collapsed || isOpen ? group.items.filter((item) => !item.disabled || collapsed).map(renderItem) : null}
            </div>
          )
        })}
      </div>
      {footer ? <div className="po-sidenav-footer">{footer}</div> : null}
    </div>
  )
}
