/**
 * Desktop loopback login core (dependency-injected, no Electron import).
 *
 * SECURITY REASONING — why this shape, in the order the attacks arrive:
 *
 * 1. **Loopback + system browser, not an embedded webview.** The account password is typed into the
 *    real browser, which owns the server session cookie. The desktop process only ever sees a
 *    one-time authorization code. Binding the callback listener to `127.0.0.1` (never `0.0.0.0`,
 *    never a LAN address) makes the callback reachable only by a local process — the browser
 *    running on this machine.
 * 2. **`state`.** The callback must carry the exact random `state` nonce created before
 *    `openExternal`. A malicious local page or another app that fires a callback URL at the
 *    listener cannot satisfy it, so the app never redeems a code it did not request.
 * 3. **PKCE S256.** The verifier never leaves the desktop process; only its SHA-256 challenge goes
 *    to the authorization URL. Another local process that steals the callback URL still cannot
 *    exchange the code, because it does not have the verifier.
 * 4. **Only a one-time code in the URL.** No access token, refresh token, password or profile data
 *    is ever written to a URL, browser history, referrer header or log. The callback URL is
 *    validated to be exactly `http://127.0.0.1:<port>/callback` before it is used.
 * 5. **One request, one host.** The listener rejects anything whose `Host` header is not exactly
 *    `127.0.0.1:<port>` (defeats DNS rebinding) and processes a single terminal callback; later
 *    requests are answered with 409 and ignored.
 * 6. **Timeout + cleanup.** The listener always closes (success, error, timeout) so it cannot become
 *    a permanent local endpoint, and a login that never completes fails cleanly instead of hanging
 *    forever.
 * 7. **Code TTL and single use are enforced server-side** (120s, consumed even on a failed PKCE
 *    check), so a leaked or replayed callback cannot be redeemed twice.
 *
 * The core is intentionally free of `electron` imports so it can run under plain Node in tests; the
 * Electron main process supplies `openExternal` (e.g. `shell.openExternal`).
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { DesktopSessionSchema, type DesktopSession } from '@projectos/organization-contracts'

const LOOPBACK_HOST = '127.0.0.1'
const CALLBACK_PATH = '/callback'
const CLIENT_ID = 'projectos-desktop'
const DEFAULT_TIMEOUT_MS = 180_000

export interface DesktopLoginOptions {
  /** Base URL of the organization server, e.g. http://127.0.0.1:4310 */
  authBaseUrl: string
  /** Opens the authorization URL in the user's system browser (Electron: shell.openExternal). */
  openExternal: (authorizeUrl: string) => void | Promise<void>
  /** Injectable fetch for tests; defaults to global fetch (Node 24). */
  fetchImpl?: typeof fetch
  /** Maximum time to wait for the browser callback. Default 180s. */
  timeoutMs?: number
}

export interface DesktopLoginResult {
  session: DesktopSession
  redirectUri: string
  authorizeUrl: string
}

type DesktopLoginErrorCode =
  | 'invalid_configuration'
  | 'timeout'
  | 'state_mismatch'
  | 'callback_invalid'
  | 'authorization_failed'
  | 'token_exchange_failed'
  | 'response_invalid'

interface CallbackResult {
  code: string
  state: string
}

interface PendingLogin {
  resolve: (result: CallbackResult) => void
  reject: (error: Error) => void
  expectedHost: string
  expectedState: string
  /** Set once a terminal callback (success or rejection) has been processed. */
  handled: boolean
}

export class DesktopLoginError extends Error {
  constructor(
    message: string,
    readonly code: DesktopLoginErrorCode,
  ) {
    super(message)
    this.name = 'DesktopLoginError'
  }
}

function base64Url(bytes: number): string {
  return randomBytes(bytes).toString('base64url')
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

function writeHtml(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
  })
  response.end(body)
}

/** Static strings only; no user-controlled value is interpolated into this page. */
function renderResultPage(title: string, message: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;padding:48px;background:#0d1117;color:#e6edf3">
<h1 style="font-size:20px">${title}</h1><p style="color:#8b949e">${message}</p></body></html>`
}

/**
 * Validate one HTTP request as a callback. Returns the code/state only for a legitimate callback;
 * writes a 4xx and returns null otherwise. A terminal failure additionally marks the flow handled so
 * no second callback can revive it.
 */
function readCallback(
  request: IncomingMessage,
  response: ServerResponse,
  pending: PendingLogin,
): CallbackResult | null {
  if (request.method !== 'GET') {
    writeHtml(response, 405, renderResultPage('登录失败', '只接受 GET 回调。'))
    return null
  }
  if (request.headers.host !== pending.expectedHost) {
    // Host header mismatch: DNS rebinding or a proxied request, not our loopback listener.
    writeHtml(response, 400, renderResultPage('登录失败', '回调 Host 校验失败。'))
    return null
  }
  const url = new URL(request.url ?? '/', `http://${pending.expectedHost}`)
  if (url.pathname !== CALLBACK_PATH) {
    writeHtml(response, 404, renderResultPage('登录失败', '未知的回调路径。'))
    return null
  }

  const error = url.searchParams.get('error')
  if (error) {
    pending.handled = true
    writeHtml(response, 400, renderResultPage('登录未完成', '授权被拒绝或失败。'))
    pending.reject(new DesktopLoginError(`authorization failed: ${error}`, 'authorization_failed'))
    return null
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) {
    pending.handled = true
    writeHtml(response, 400, renderResultPage('登录失败', '回调缺少 code 或 state。'))
    pending.reject(new DesktopLoginError('callback is missing code or state', 'callback_invalid'))
    return null
  }
  if (state !== pending.expectedState) {
    pending.handled = true
    writeHtml(response, 400, renderResultPage('登录失败', 'state 校验失败。'))
    pending.reject(
      new DesktopLoginError('state mismatch; the callback did not belong to this login', 'state_mismatch'),
    )
    return null
  }
  return { code, state }
}

function isLoopbackOrigin(value: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(value)
}

export async function runDesktopLogin(options: DesktopLoginOptions): Promise<DesktopLoginResult> {
  const authBaseUrl = options.authBaseUrl.replace(/\/+$/, '')
  if (!isLoopbackOrigin(authBaseUrl)) {
    throw new DesktopLoginError('authBaseUrl must be a loopback http(s) origin', 'invalid_configuration')
  }
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const verifier = base64Url(32)
  const challenge = pkceChallenge(verifier)
  const state = base64Url(24)

  let resolveCallback: (result: CallbackResult) => void = () => undefined
  let rejectCallback: (error: Error) => void = () => undefined
  const callbackReceived = new Promise<CallbackResult>((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })
  // If the flow times out first, a late rejection must not surface as an unhandled rejection.
  void callbackReceived.catch(() => undefined)

  const pending: PendingLogin = {
    resolve: resolveCallback,
    reject: rejectCallback,
    expectedHost: '',
    expectedState: state,
    handled: false,
  }

  const server = createServer((request, response) => {
    if (pending.handled) {
      writeHtml(response, 409, renderResultPage('重复回调', '本次登录的回调已经被处理。'))
      return
    }
    const result = readCallback(request, response, pending)
    if (result) {
      pending.handled = true
      writeHtml(
        response,
        200,
        renderResultPage('授权完成', '请返回 ProjectOS 桌面应用继续。可以关闭此窗口。'),
      )
      pending.resolve(result)
    }
  })

  let timeoutHandle: NodeJS.Timeout | null = null
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, LOOPBACK_HOST, () => resolve())
    })

    const address = server.address() as AddressInfo | null
    if (!address || typeof address === 'string') {
      throw new DesktopLoginError('failed to bind the loopback callback listener', 'callback_invalid')
    }
    const redirectUri = `http://${LOOPBACK_HOST}:${address.port}${CALLBACK_PATH}`
    pending.expectedHost = `${LOOPBACK_HOST}:${address.port}`

    const authorizeUrl = `${authBaseUrl}/v1/desktop/authorize?${new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    }).toString()}`

    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new DesktopLoginError(`desktop login timed out after ${timeoutMs}ms`, 'timeout'))
      }, timeoutMs)
    })

    await options.openExternal(authorizeUrl)
    const callback = await Promise.race([callbackReceived, timeout])

    const tokenResponse = await fetchImpl(`${authBaseUrl}/v1/desktop/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        grant_type: 'authorization_code',
        code: callback.code,
        code_verifier: verifier,
      }),
    })
    if (!tokenResponse.ok) {
      let detail = `HTTP ${tokenResponse.status}`
      try {
        const payload = (await tokenResponse.json()) as { error?: { code?: string } }
        if (payload.error?.code) detail = payload.error.code
      } catch {
        // Fall back to the status code; never log the response body, which may contain material.
      }
      throw new DesktopLoginError(`token exchange rejected: ${detail}`, 'token_exchange_failed')
    }
    const parsed = DesktopSessionSchema.safeParse(await tokenResponse.json())
    if (!parsed.success) {
      throw new DesktopLoginError('token response does not match DesktopSession', 'response_invalid')
    }
    return { session: parsed.data, redirectUri, authorizeUrl }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
