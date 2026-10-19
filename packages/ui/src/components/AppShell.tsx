import type { ReactNode } from 'react'

export interface AppShellProps {
  header: ReactNode
  sidebar: ReactNode
  footer: ReactNode
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
        <main className="po-main" id="po-main">
          {children}
        </main>
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
