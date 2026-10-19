import type { ReactNode } from 'react'
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
  title?: string
  items: SidebarNavItem[]
}

export interface SidebarNavigationProps {
  groups: SidebarNavGroup[]
  activeKey: string
  onSelect: (key: string) => void
  collapsed?: boolean
  footer?: ReactNode
}

export function SidebarNavigation({ groups, activeKey, onSelect, collapsed = false, footer }: SidebarNavigationProps) {
  return (
    <div className="po-sidenav">
      <div className="po-sidenav-scroll">
        {groups.map((group, index) => (
          <div className="po-sidenav-group" key={group.title ?? `group-${index}`}>
            {group.title ? <div className="po-sidenav-title">{group.title}</div> : null}
            {group.items.map((item) => {
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
            })}
          </div>
        ))}
      </div>
      {footer ? <div className="po-sidenav-footer">{footer}</div> : null}
    </div>
  )
}
