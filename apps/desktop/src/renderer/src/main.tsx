import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { XProvider } from '@ant-design/x'
import { RouterProvider } from 'react-router-dom'
import { createAntdTheme } from '@projectos/ui'
import 'antd/dist/reset.css'
import './styles/fonts.css'
import '@projectos/design-tokens/tokens.css'
import '@projectos/ui/styles.css'
import '@projectos/ai-ui/styles.css'
import './styles/global.css'
import './styles/app.css'
import './styles/v16.css'
import './styles/v17.css'
import './styles/next-ui.css'
import './next-ui/overlay/overlay.css'
import './styles/next-ui-app.css'
import '@projectos/design-tokens/unified.css'
import './styles/system-premium.css'
import { queryClient } from './lib/query-client'
import { router } from './router'
import { ProductDialogs } from './next-ui/overlay/ProductDialogs'
import { OverlayRoot } from './next-ui/overlay/overlay-context'
import { useResolvedTheme, useUiEffects } from './stores/ui'

interface ErrorBoundaryState {
  error: Error | null
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('ProjectOS render error', error, info)
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="po-boot">
          <div className="po-boot-title">界面渲染出错</div>
          <div className="po-boot-error">{this.state.error.message}</div>
          <button type="button" className="po-primary-button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function Root() {
  useUiEffects()
  const theme = useResolvedTheme()
  const themeConfig = React.useMemo(() => createAntdTheme(theme), [theme])
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={themeConfig} locale={zhCN}>
        <XProvider>
          <AntApp message={{ maxCount: 3, duration: 2.6 }} notification={{ maxCount: 4 }}>
            <OverlayRoot><ProductDialogs><RouterProvider router={router} /></ProductDialogs></OverlayRoot>
          </AntApp>
        </XProvider>
      </ConfigProvider>
    </QueryClientProvider>
  )
}

try {
  const persisted = JSON.parse(localStorage.getItem('projectos.ui') ?? '{}') as {
    state?: { themeMode?: 'light' | 'dark' | 'system' }
  }
  const mode = persisted.state?.themeMode ?? 'system'
  const dark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
} catch {
  document.documentElement.dataset.theme = 'light'
}

async function startRenderer(): Promise<void> {
  // The one local variable face is ready before any surface mounts. This avoids
  // rendering boxes first and swapping their Chinese text/font metrics afterwards.
  try {
    await Promise.all([400, 500, 600].map((weight) => document.fonts.load(`${weight} 14px "ProjectOS Sans"`, '项目设置 Aa012')))
    document.documentElement.dataset.typeface = 'ready'
  } catch {
    document.documentElement.dataset.typeface = 'fallback'
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <Root />
      </AppErrorBoundary>
    </React.StrictMode>,
  )
}
void startRenderer()
