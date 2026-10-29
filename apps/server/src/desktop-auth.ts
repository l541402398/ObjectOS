/**
 * Desktop login endpoints — loopback redirect + PKCE, authorization-code style.
 *
 * WHY THIS SHAPE (security reasoning)
 * -----------------------------------
 * The ProjectOS desktop app is a native process, not a web app, so it cannot hold the account
 * password and must never receive a long-lived token in a URL. The flow is deliberately modelled
 * on OAuth 2.1 "native app" guidance:
 *
 * 1. The desktop process binds an HTTP listener on **127.0.0.1 only** (never `0.0.0.0`) and opens
 *    the system browser with an authorization URL. The browser owns the account session cookie;
 *    the desktop process never sees the password.
 * 2. The authorization URL carries a `state` nonce and a PKCE S256 `code_challenge`. `state`
 *    defeats a cross-site callback injection (an attacker's page cannot make the app accept a code
 *    it did not request). PKCE binds the authorization code to the process that started the flow,
 *    so another local process that steals the callback URL (or a code) cannot redeem it without the
 *    verifier.
 * 3. Only a **one-time code** appears in the redirect URL. Access tokens, profile data and
 *    refresh material never appear in a URL, browser history, referrer header or logs.
 * 4. The code expires in 120s and is consumed exactly once — including on a failed PKCE check, so a
 *    wrong verifier cannot be brute-forced against a live code.
 * 5. The consent request (the "授权此设备" page) is a separate one-time opaque id with a 10 minute
 *    TTL, bound to the browser session's account, so a consent page captured by another account is
 *    rejected.
 * 6. The issued bearer token is 32 random bytes (base64url), stored only in the desktop process,
 *    valid for 8 hours, and it grants organization/project scope checks — never local file or shell
 *    access. Worker leases are a separate, signed contract (see organization contracts).
 *
 * This module is a PoC: tokens and codes live in process memory, so restarting the server logs
 * everybody out. PostgreSQL-backed sessions and real OAuth clients arrive in A1.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  DesktopAuthorizeQuerySchema,
  DesktopSessionSchema,
  DesktopTokenRequestSchema,
  type DesktopAuthorizeQuery,
  type DesktopSession,
  type OrgRole,
} from '@projectos/organization-contracts'

/** Minimum viable better-auth account view. */
export interface DesktopAccount {
  id: string
  name: string
  email: string
}

export interface AccountOrganization {
  id: string
  name: string
  slug: string
  role: OrgRole
}

export interface MembershipRecord {
  memberId: string
  role: OrgRole
}

/** Narrow view of better-auth that keeps the vendor API surface in one place (see app.ts). */
export interface AuthClient {
  getSession(input: { headers: Headers }): Promise<{ user: DesktopAccount } | null>
  signInEmail(input: {
    body: { email: string; password: string }
    asResponse: true
  }): Promise<Response>
}

/** better-auth-backed directory: membership and organization scope are read from the auth DB. */
export interface AuthDirectory {
  accountById(accountId: string): Promise<DesktopAccount | null>
  membershipFor(accountId: string, organizationId: string): Promise<MembershipRecord | null>
  organizationsFor(accountId: string): Promise<AccountOrganization[]>
}

export interface DesktopAuthDependencies {
  auth: AuthClient
  directory: AuthDirectory
}

/** What organization-scoped routes in app.ts need in order to enforce scope. */
export interface DesktopAuthHandle {
  /**
   * Resolve `Authorization: Bearer <opaque token>` to the account it was issued to, or null when
   * the token is absent, unknown or expired. Never throws for bad input.
   */
  authenticateBearer(authorization: string | undefined): Promise<DesktopAccount | null>
}

export const DESKTOP_TOKEN_TTL_MS = 8 * 60 * 60 * 1000
export const DESKTOP_CODE_TTL_MS = 120 * 1000
export const DESKTOP_CONSENT_TTL_MS = 10 * 60 * 1000

const CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'"
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8'

interface ConsentRequestRecord {
  requestId: string
  accountId: string
  redirectUri: string
  codeChallenge: string
  state: string
  organizationId?: string
  expiresAt: number
}

interface AuthorizationCodeRecord {
  accountId: string
  codeChallenge: string
  redirectUri: string
  state: string
  organizationId?: string
  expiresAt: number
}

interface BearerTokenRecord {
  accountId: string
  expiresAt: number
}

interface DesktopAuthState {
  consentRequests: Map<string, ConsentRequestRecord>
  authorizationCodes: Map<string, AuthorizationCodeRecord>
  bearerTokens: Map<string, BearerTokenRecord>
}

function createState(): DesktopAuthState {
  return {
    consentRequests: new Map(),
    authorizationCodes: new Map(),
    bearerTokens: new Map(),
  }
}

function opaqueId(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url')
}

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  if (leftBytes.length !== rightBytes.length) return false
  return timingSafeEqual(leftBytes, rightBytes)
}

/** Escape every interpolated value: the login/consent pages are server-rendered HTML. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function applyBrowserPageHeaders(reply: FastifyReply): void {
  reply.header('cache-control', 'no-store')
  reply.header('x-frame-options', 'DENY')
  reply.header('x-content-type-options', 'nosniff')
  reply.header('referrer-policy', 'no-referrer')
  reply.header('content-security-policy', CONTENT_SECURITY_POLICY)
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
): FastifyReply {
  return reply.code(statusCode).header('cache-control', 'no-store').send({ error: { code, message } })
}

function toHeaders(request: FastifyRequest): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else {
      headers.set(name, value)
    }
  }
  return headers
}

/** Fastify has no built-in urlencoded parser in this PoC, so the body arrives as a raw string. */
function parseFormBody(body: unknown): URLSearchParams | null {
  if (typeof body !== 'string' || body.length === 0) return null
  return new URLSearchParams(body)
}

function bearerFrom(authorization: string | undefined): string | null {
  if (!authorization) return null
  const match = /^Bearer ([A-Za-z0-9_-]{32,512})$/.exec(authorization)
  return match?.[1] ?? null
}

function authorizeQueryFrom(source: Record<string, string>): DesktopAuthorizeQuery | null {
  const parsed = DesktopAuthorizeQuerySchema.safeParse(source)
  return parsed.success ? parsed.data : null
}

function authorizeSearchParams(data: DesktopAuthorizeQuery): URLSearchParams {
  const params = new URLSearchParams({
    client_id: data.client_id,
    redirect_uri: data.redirect_uri,
    code_challenge: data.code_challenge,
    code_challenge_method: data.code_challenge_method,
    state: data.state,
  })
  if (data.organization_id) params.set('organization_id', data.organization_id)
  return params
}

function hiddenAuthorizeInputs(data: DesktopAuthorizeQuery): string {
  return [...authorizeSearchParams(data).entries()]
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join('\n        ')
}

const PAGE_STYLES = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px;
    background: #0d1117; color: #e6edf3;
    font: 15px/1.55 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  .card { width: 100%; max-width: 460px; padding: 32px; border-radius: 16px;
    background: #161b22; border: 1px solid #30363d; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  h2 { margin: 24px 0 8px; font-size: 15px; }
  p { margin: 8px 0; }
  .muted { color: #8b949e; }
  .small { font-size: 13px; }
  ul { margin: 8px 0; padding-left: 20px; }
  li { margin: 4px 0; }
  label { display: block; margin: 14px 0 0; font-size: 13px; color: #8b949e; }
  input[type="email"], input[type="password"] { width: 100%; margin-top: 6px; padding: 10px 12px;
    border-radius: 8px; border: 1px solid #30363d; background: #0d1117; color: inherit; font: inherit; }
  button { margin-top: 20px; padding: 11px 18px; border-radius: 8px; border: 1px solid #2f81f7;
    background: #2f81f7; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button.secondary { background: transparent; border-color: #30363d; color: #b3bcc6; }
  .error { margin-top: 16px; padding: 10px 12px; border-radius: 8px;
    background: #3d1a1a; border: 1px solid #8b2b2b; color: #ffb4b4; font-size: 13px; }
  .notice { margin-top: 20px; padding: 12px; border-radius: 8px; background: #10233a;
    border: 1px solid #1f4e79; font-size: 13px; color: #b6d7ff; }
`

function renderPage(documentTitle: string, card: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(documentTitle)}</title>
  <style>${PAGE_STYLES}</style>
</head>
<body>
  <main class="card">
${card}
  </main>
</body>
</html>`
}

function renderLoginPage(data: DesktopAuthorizeQuery, errorMessage?: string): string {
  const action = `/v1/desktop/authorize?${authorizeSearchParams(data).toString()}`
  return renderPage(
    'ProjectOS 账号登录',
    `    <h1>登录 ProjectOS</h1>
    <p class="muted">桌面设备正在请求访问你的组织工作区。登录在系统浏览器中完成，密码不会交给桌面进程。</p>
${errorMessage ? `    <p class="error">${escapeHtml(errorMessage)}</p>` : ''}
    <form method="post" action="${escapeHtml(action)}">
        ${hiddenAuthorizeInputs(data)}
        <label>邮箱
          <input type="email" name="email" autocomplete="username" required autofocus>
        </label>
        <label>密码
          <input type="password" name="password" autocomplete="current-password" required>
        </label>
        <button type="submit">登录并继续</button>
    </form>
    <p class="muted small">本次授权只用于 127.0.0.1 回环回调，访问令牌不会出现在浏览器地址栏。</p>`,
  )
}

function renderConsentPage(
  data: DesktopAuthorizeQuery,
  account: DesktopAccount,
  organizations: readonly AccountOrganization[],
  requestId: string,
): string {
  const organizationItems =
    organizations.length === 0
      ? '        <li class="muted">该账号还没有任何组织</li>'
      : organizations
          .map(
            (organization) =>
              `        <li>${escapeHtml(organization.name)} <span class="muted">（${escapeHtml(organization.slug)} · 角色 ${escapeHtml(organization.role)}）</span></li>`,
          )
          .join('\n')
  const scopedHint = data.organization_id
    ? `    <p class="muted small">本次请求限定的组织 ID：${escapeHtml(data.organization_id)}</p>`
    : ''
  return renderPage(
    'ProjectOS 设备授权',
    `    <h1>授权此设备</h1>
    <p class="muted">请确认你正在授权一台桌面设备访问下列账号与组织。</p>
    <p>账号：<strong>${escapeHtml(account.email)}</strong> <span class="muted">（${escapeHtml(account.name)}）</span></p>
${scopedHint}
    <h2>可访问的组织</h2>
    <ul>
${organizationItems}
    </ul>
    <div class="notice">
      授权后该设备可以读取上述组织中你有权限查看的项目与需求，并在项目权限允许时提交需求。
      <strong>不会授予</strong>本机文件读写、Shell 命令执行、Git 推送或任何 Worker 租约；这些需要单独的策略审批。
    </div>
    <form method="post" action="/v1/desktop/consent">
      <input type="hidden" name="request_id" value="${escapeHtml(requestId)}">
      <button type="submit" name="decision" value="allow">授权此设备</button>
      <button type="submit" name="decision" value="deny" class="secondary" formnovalidate>拒绝</button>
    </form>
    <p class="muted small">授权码 120 秒内有效且只能使用一次。</p>`,
  )
}

export function registerDesktopAuth(
  app: FastifyInstance,
  deps: DesktopAuthDependencies,
): DesktopAuthHandle {
  const state = createState()

  function purgeExpired(now: number): void {
    for (const [key, record] of state.consentRequests) {
      if (record.expiresAt <= now) state.consentRequests.delete(key)
    }
    for (const [key, record] of state.authorizationCodes) {
      if (record.expiresAt <= now) state.authorizationCodes.delete(key)
    }
    for (const [key, record] of state.bearerTokens) {
      if (record.expiresAt <= now) state.bearerTokens.delete(key)
    }
  }

  async function authorizePage(
    request: FastifyRequest,
    reply: FastifyReply,
    data: DesktopAuthorizeQuery,
  ): Promise<FastifyReply> {
    const session = await deps.auth.getSession({ headers: toHeaders(request) })

    if (!session) {
      return reply.type(HTML_CONTENT_TYPE).send(renderLoginPage(data))
    }

    if (data.organization_id) {
      const membership = await deps.directory.membershipFor(session.user.id, data.organization_id)
      if (!membership) {
        return sendError(
          reply,
          403,
          'RESOURCE_NOT_IN_SCOPE',
          'the requested organization is outside the signed-in account scope',
        )
      }
    }

    const organizations = await deps.directory.organizationsFor(session.user.id)
    const requestId = opaqueId(24)
    const account = await deps.directory.accountById(session.user.id)
    if (!account) {
      return sendError(reply, 401, 'UNAUTHENTICATED', 'the signed-in account no longer exists')
    }
    state.consentRequests.set(requestId, {
      requestId,
      accountId: session.user.id,
      redirectUri: data.redirect_uri,
      codeChallenge: data.code_challenge,
      state: data.state,
      ...(data.organization_id === undefined ? {} : { organizationId: data.organization_id }),
      expiresAt: Date.now() + DESKTOP_CONSENT_TTL_MS,
    })
    return reply.type(HTML_CONTENT_TYPE).send(renderConsentPage(data, account, organizations, requestId))
  }

  // ---- 1. Authorization page (and the login form target) --------------------------------------
  app.get('/v1/desktop/authorize', async (request, reply) => {
    applyBrowserPageHeaders(reply)
    const parsed = DesktopAuthorizeQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return sendError(reply, 400, 'invalid_request', 'invalid desktop authorize request')
    }
    purgeExpired(Date.now())
    return authorizePage(request, reply, parsed.data)
  })

  app.post('/v1/desktop/authorize', async (request, reply) => {
    applyBrowserPageHeaders(reply)
    const form = parseFormBody(request.body)
    if (!form) {
      return sendError(reply, 400, 'invalid_request', 'expected an application/x-www-form-urlencoded body')
    }
    const data = authorizeQueryFrom(Object.fromEntries(form))
    if (!data) {
      return sendError(reply, 400, 'invalid_request', 'invalid desktop authorize request')
    }

    const email = form.get('email') ?? ''
    const password = form.get('password') ?? ''
    if (!email || !password) {
      return reply.code(400).type(HTML_CONTENT_TYPE).send(renderLoginPage(data, '请输入邮箱和密码。'))
    }

    const signInResponse = await deps.auth.signInEmail({
      body: { email, password },
      asResponse: true,
    })
    if (!signInResponse.ok) {
      // Never echo the credential, never distinguish "unknown account" from "wrong password".
      return reply
        .code(401)
        .type(HTML_CONTENT_TYPE)
        .send(renderLoginPage(data, '邮箱或密码不正确，请重试。'))
    }

    const setCookies = signInResponse.headers.getSetCookie()
    if (setCookies.length > 0) reply.header('set-cookie', setCookies)
    return reply.redirect(`/v1/desktop/authorize?${authorizeSearchParams(data).toString()}`, 302)
  })

  // ---- 2. Explicit consent, then a one-time authorization code --------------------------------
  app.post('/v1/desktop/consent', async (request, reply) => {
    applyBrowserPageHeaders(reply)
    const form = parseFormBody(request.body)
    if (!form) {
      return sendError(reply, 400, 'invalid_request', 'expected an application/x-www-form-urlencoded body')
    }
    const requestId = form.get('request_id') ?? ''
    const decision = form.get('decision') ?? ''
    const record = state.consentRequests.get(requestId)
    // Single use: the record is removed before any other check so a replay cannot succeed.
    if (record) state.consentRequests.delete(requestId)
    const now = Date.now()
    if (!record || record.expiresAt <= now) {
      return sendError(reply, 400, 'invalid_request', 'consent request is unknown, expired or already used')
    }

    const session = await deps.auth.getSession({ headers: toHeaders(request) })
    if (!session) {
      return sendError(reply, 401, 'UNAUTHENTICATED', 'sign in before granting consent')
    }
    if (session.user.id !== record.accountId) {
      return sendError(reply, 403, 'RESOURCE_NOT_IN_SCOPE', 'this consent request belongs to another account')
    }

    if (decision !== 'allow') {
      const denied = new URL(record.redirectUri)
      denied.searchParams.set('error', 'access_denied')
      denied.searchParams.set('state', record.state)
      return reply.redirect(denied.toString(), 302)
    }

    purgeExpired(now)
    const code = opaqueId(32)
    state.authorizationCodes.set(code, {
      accountId: record.accountId,
      codeChallenge: record.codeChallenge,
      redirectUri: record.redirectUri,
      state: record.state,
      ...(record.organizationId === undefined ? {} : { organizationId: record.organizationId }),
      expiresAt: now + DESKTOP_CODE_TTL_MS,
    })

    const callback = new URL(record.redirectUri)
    callback.searchParams.set('code', code)
    callback.searchParams.set('state', record.state)
    // Only the one-time code and state travel through the browser; no token, no profile data.
    return reply.redirect(callback.toString(), 302)
  })

  // ---- 3. Code -> opaque bearer token (PKCE S256, single use) --------------------------------
  app.post('/v1/desktop/token', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const parsed = DesktopTokenRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return sendError(reply, 400, 'invalid_request', 'invalid desktop token request')
    }
    const body = parsed.data
    const record = state.authorizationCodes.get(body.code)
    // Consume first: even a wrong verifier burns the code (no oracle for brute force).
    if (record) state.authorizationCodes.delete(body.code)
    const now = Date.now()
    if (!record) {
      return sendError(reply, 400, 'invalid_grant', 'authorization code is unknown, expired or already used')
    }
    if (record.expiresAt <= now) {
      return sendError(reply, 400, 'invalid_grant', 'authorization code has expired')
    }
    if (!constantTimeEquals(sha256Base64Url(body.code_verifier), record.codeChallenge)) {
      return sendError(reply, 400, 'invalid_grant', 'PKCE verification failed')
    }

    const account = await deps.directory.accountById(record.accountId)
    if (!account) {
      return sendError(reply, 400, 'invalid_grant', 'the authorized account no longer exists')
    }
    const organizations = await deps.directory.organizationsFor(record.accountId)
    const token = opaqueId(32)
    const expiresAt = now + DESKTOP_TOKEN_TTL_MS
    state.bearerTokens.set(token, { accountId: record.accountId, expiresAt })

    const session: DesktopSession = {
      token,
      expiresAt,
      account: { id: account.id, name: account.name, email: account.email },
      organizations,
    }
    // Re-validate against the published contract so a shape drift fails loudly here, not in the app.
    return reply.send(DesktopSessionSchema.parse(session))
  })

  // ---- 4. Who am I? -------------------------------------------------------------------------
  app.get('/v1/me', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const account = await handle.authenticateBearer(request.headers.authorization)
    if (!account) {
      return sendError(reply, 401, 'UNAUTHENTICATED', 'a valid bearer token is required')
    }
    const organizations = await deps.directory.organizationsFor(account.id)
    return reply.send({ account, organizations })
  })

  const handle: DesktopAuthHandle = {
    async authenticateBearer(authorization: string | undefined): Promise<DesktopAccount | null> {
      const token = bearerFrom(authorization)
      if (!token) return null
      const record = state.bearerTokens.get(token)
      if (!record) return null
      if (record.expiresAt <= Date.now()) {
        state.bearerTokens.delete(token)
        return null
      }
      return deps.directory.accountById(record.accountId)
    },
  }

  return handle
}
