import type { ReactNode } from 'react'

export interface AppShellProps {
  header: ReactNode
  sidebar: ReactNode
  footer: ReactNode
  /** Persistent row under the titlebar (global goal journey, ADR-0053). */
  subheader?: ReactNode
  children: ReactNode
  inspector?: ReactNode
  inspectorOpen?: boolean
  collapsed?: boolean
  className?: string
}

export function AppShell({
  header,
  sidebar,
  footer,
  subheader,
  children,
  inspector,
  inspectorOpen = true,
  collapsed = false,
  className = '',
}: AppShellProps) {
  return (
    <div className={`po-shell ${collapsed ? 'is-collapsed' : ''} ${className}`.trim()}>
      <a className="po-skip-link" href="#po-main">
        跳到主内容
      </a>
      <header className="po-titlebar">{header}</header>
      <div className="po-shell-body">
        <aside className="po-sidebar glass-panel" aria-label="主导航">
          {sidebar}
        </aside>
        <div className="po-workspace-frame">
          {subheader ? <div className="po-subheader">{subheader}</div> : null}
          <main className="po-main" id="po-main">{children}</main>
        </div>
        {inspector && inspectorOpen ? (
          <aside className="po-inspector glass-panel" aria-label="上下文检查器">
            {inspector}
          </aside>
        ) : null}
      </div>
      <footer className="po-statusbar">{footer}</footer>
    </div>
  )
}
