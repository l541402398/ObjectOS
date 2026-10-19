import type { Session, WebContents } from 'electron'

export function applyContentSecurityPolicy(targetSession: Session, isDev: boolean): void {
  const csp = isDev
    ? [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*",
        "worker-src 'self' blob:",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; ')
    : [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; ')

  targetSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
        'X-Content-Type-Options': ['nosniff'],
        'Referrer-Policy': ['no-referrer'],
        'Permissions-Policy': ['camera=(), microphone=(), geolocation=(), usb=()'],
      },
    })
  })

  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  targetSession.setPermissionCheckHandler(() => false)
}

export function hardenWebContents(webContents: WebContents, isDev: boolean, devUrl?: string): void {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
  webContents.on('will-navigate', (event, url) => {
    const allowed =
      (isDev && devUrl && url.startsWith(devUrl)) ||
      (!isDev && url.startsWith('file://'))
    if (!allowed) event.preventDefault()
  })
}
