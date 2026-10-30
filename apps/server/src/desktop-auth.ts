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
  signInEmail(input: { body: { email: string; password: string }; asResponse: true }): Promise<Response>
  signUpEmail?(input: {
    body: { name: string; email: string; password: string }
    asResponse: true
  }): Promise<Response>
  signOut?(input: { headers: Headers; asResponse: true }): Promise<Response>
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
  tokens?: DesktopTokenStore
  trustedOrigin?: string
}

export interface DesktopTokenStore {
  issue(tokenHash: string, record: { accountId: string; expiresAt: number }): Promise<void>
  find(tokenHash: string): Promise<{ accountId: string; expiresAt: number } | null>
  revoke(tokenHash: string): Promise<void>
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
  // Chromium derives the Origin of a navigation form POST from the document's referrer policy.
  // no-referrer can produce an opaque "null" Origin even for this same-origin form. Preserve only
  // same-origin referrers so strict CSRF checks work without leaking callback data cross-origin.
  reply.header('referrer-policy', 'same-origin')
  reply.header('content-security-policy', CONTENT_SECURITY_POLICY)
}

/** Chromium checks a form's complete redirect chain. Permit only this validated native callback
 * origin in addition to self; never a wildcard, another host, or an arbitrary query-string value. */
function applyCallbackFormPolicy(reply: FastifyReply, redirectUri: string): boolean {
  if (!DesktopAuthorizeQuerySchema.shape.redirect_uri.safeParse(redirectUri).success) return false
  try {
    const callback = new URL(redirectUri)
    if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1') return false
    reply.header('content-security-policy', `${CONTENT_SECURITY_POLICY} ${callback.origin}`)
    return true
  } catch {
    return false
  }
}

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string): FastifyReply {
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
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('\n        ')
}

const PAGE_STYLES = `
  :root { color-scheme:light dark; --bg:#e8eef9; --surface:#fbfdff; --ink:#22304d; --muted:#52617b; --line:#d8e1ef; --accent:#4f64d9; --field:#fff; --danger:#9f3346; }
  @media(prefers-color-scheme:dark) { :root { --bg:#091223; --surface:#111b30; --ink:#eff4ff; --muted:#b5c2d9; --line:#34445f; --accent:#9badff; --field:#162238; --danger:#ffa6b5; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px;
    background:radial-gradient(ellipse at 15% 0%,#8c8ee526,transparent 55%),radial-gradient(ellipse at 90% 90%,#43b8ce18,transparent 55%),var(--bg); color:var(--ink);
    font:14px/1.55 "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  .card { width:100%; max-width:520px; padding:36px; border-radius:24px; background:var(--surface);
    border:1px solid var(--line); box-shadow:0 20px 70px #15274318,inset 0 1px #ffffff55; }
  .brand { display:flex; align-items:center; gap:10px; margin-bottom:28px; font-weight:650; letter-spacing:.02em; }
  .brand svg { color:var(--accent); }
  h1 { margin:0 0 12px; font-size:26px; line-height:1.24; letter-spacing:-.02em; }
  h2 { margin: 24px 0 8px; font-size: 15px; }
  p { margin: 8px 0; }
  .muted { color:var(--muted); }
  .small { font-size: 13px; }
  ul { margin: 8px 0; padding-left: 20px; }
  li { margin: 4px 0; }
  label { display:block; margin-top:18px; font-size:13px; color:var(--muted); }
  input:not([type="hidden"]) { width:100%; margin-top:7px; padding:11px 13px; min-height:44px; border-radius:9px;
    border:1px solid var(--line); background:var(--field); color:inherit; font:inherit; }
  button { margin-top:24px; padding:11px 18px; min-height:44px; border-radius:9px; border:1px solid var(--accent);
    background:var(--accent); color:var(--surface); font:inherit; font-weight:650; cursor:pointer; }
  button:hover { box-shadow:0 3px 14px #5061dc26; }
  button.secondary { background:transparent; border-color:var(--line); color:var(--ink); margin-left:8px; }
  a { color:var(--accent); text-underline-offset:3px; }
  :is(a,button,input):focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
  .error { margin-top:16px; padding:12px; border:1px solid var(--danger); border-radius:9px; color:var(--danger); }
  .notice { margin-top:20px; padding:16px; border-radius:12px; border:1px solid var(--line); color:var(--muted); }
  @media(max-width:560px) { body { padding:16px; } .card { padding:24px; border-radius:18px; } }
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
    <div class="brand"><svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><rect x="2" y="2" width="24" height="24" rx="8" stroke="currentColor" stroke-width="1.5"/><path d="M8 9h12M8 14h12M8 19h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>ProjectOS</div>
${card}
  </main>
</body>
</html>`
}

function renderLoginPage(data: DesktopAuthorizeQuery, errorMessage?: string, register = false): string {
  const action = `/v1/desktop/authorize?${authorizeSearchParams(data).toString()}`
  return renderPage(
    register ? '创建 ProjectOS 账号' : 'ProjectOS 账号登录',
    `    <h1>${register ? '创建组织账号' : '登录 ProjectOS'}</h1>
    <p class="muted">桌面设备正在请求访问你的组织工作区。登录在系统浏览器中完成，密码不会交给桌面进程。</p>
${errorMessage ? `    <p class="error" role="alert">${escapeHtml(errorMessage)}</p>` : ''}
    <form method="post" action="${escapeHtml(action)}">
        ${hiddenAuthorizeInputs(data)}
        ${register ? '<input type="hidden" name="mode" value="register"><label>姓名<input type="text" name="name" autocomplete="name" maxlength="120" required autofocus></label>' : ''}
        <label>邮箱
          <input type="email" name="email" autocomplete="username" maxlength="254" required ${register ? '' : 'autofocus'}>
        </label>
        <label>密码
          <input type="password" name="password" autocomplete="${register ? 'new-password' : 'current-password'}" ${register ? 'minlength="8"' : ''} maxlength="128" required>
        </label>
        <button type="submit">${register ? '创建账号并继续' : '登录并继续'}</button>
    </form>
    <p class="small muted">${register ? `已有账号？<a href="${escapeHtml(action)}">登录</a>` : `还没有账号？<a href="${escapeHtml(action + '&mode=register')}">创建账号</a>`}</p>
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
    ? `    <p class="muted small">发起登录的组织：${escapeHtml(data.organization_id)}。设备仍可切换到你有权访问的其他组织。</p>`
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
      授权后该设备可以访问你的账号、组织及有权限的项目，各项操作仍按当前成员角色校验。
      <strong>不会授予</strong>本机文件读写、Shell 命令执行、Git 推送或任何 Worker 租约；这些需要单独的策略审批。
    </div>
    <form method="post" action="/v1/desktop/consent">
      <input type="hidden" name="request_id" value="${escapeHtml(requestId)}">
      <button type="submit" name="decision" value="allow">授权此设备</button>
      <button type="submit" name="decision" value="deny" class="secondary" formnovalidate>拒绝</button>
      <button type="submit" formaction="/v1/desktop/change-account" class="secondary" formnovalidate>使用其他账号</button>
    </form>
    <p class="muted small">授权码 120 秒内有效且只能使用一次。</p>`,
  )
}

export function registerDesktopAuth(app: FastifyInstance, deps: DesktopAuthDependencies): DesktopAuthHandle {
  const state = createState()
  const tokens: DesktopTokenStore = deps.tokens ?? {
    async issue(hash, record) {
      state.bearerTokens.set(hash, record)
    },
    async find(hash) {
      return state.bearerTokens.get(hash) ?? null
    },
    async revoke(hash) {
      state.bearerTokens.delete(hash)
    },
  }
  function formOriginAllowed(request: FastifyRequest): boolean {
    if (request.headers['sec-fetch-site'] === 'cross-site') return false
    return !request.headers.origin || !deps.trustedOrigin || request.headers.origin === deps.trustedOrigin
  }

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
    if (!applyCallbackFormPolicy(reply, data.redirect_uri))
      return sendError(reply, 400, 'invalid_request', 'invalid native callback origin')
    const session = await deps.auth.getSession({ headers: toHeaders(request) })

    if (!session) {
      const register = (request.query as Record<string, unknown>)?.mode === 'register'
      return reply.type(HTML_CONTENT_TYPE).send(renderLoginPage(data, undefined, register))
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
    if (state.consentRequests.size >= 10_000)
      return sendError(reply, 503, 'AUTH_BUSY', 'too many pending authorization requests')
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
  app.post('/v1/desktop/change-account', async (request, reply) => {
    applyBrowserPageHeaders(reply)
    if (!formOriginAllowed(request))
      return sendError(reply, 403, 'INVALID_ORIGIN', 'browser form origin is not trusted')
    const form = parseFormBody(request.body)
    const requestId = form?.get('request_id') ?? ''
    const record = state.consentRequests.get(requestId)
    if (record) state.consentRequests.delete(requestId)
    const session = await deps.auth.getSession({ headers: toHeaders(request) })
    if (!record || record.expiresAt <= Date.now() || !session || record.accountId !== session.user.id)
      return sendError(
        reply,
        400,
        'invalid_request',
        'consent request is unknown, expired or belongs to another account',
      )
    if (!deps.auth.signOut)
      return sendError(reply, 501, 'NOT_IMPLEMENTED', 'browser account switching is unavailable')
    const response = await deps.auth.signOut({ headers: toHeaders(request), asResponse: true })
    if (!response.ok) return sendError(reply, 400, 'invalid_request', 'browser sign-out failed')
    const cookies = response.headers.getSetCookie()
    if (cookies.length) reply.header('set-cookie', cookies)
    const query: DesktopAuthorizeQuery = {
      client_id: 'projectos-desktop',
      redirect_uri: record.redirectUri,
      code_challenge: record.codeChallenge,
      code_challenge_method: 'S256',
      state: record.state,
      ...(record.organizationId ? { organization_id: record.organizationId } : {}),
    }
    return reply.redirect(`/v1/desktop/authorize?${authorizeSearchParams(query)}`, 302)
  })

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
    if (!formOriginAllowed(request))
      return sendError(reply, 403, 'INVALID_ORIGIN', 'browser form origin is not trusted')
    const form = parseFormBody(request.body)
    if (!form) {
      return sendError(reply, 400, 'invalid_request', 'expected an application/x-www-form-urlencoded body')
    }
    const data = authorizeQueryFrom(Object.fromEntries(form))
    if (!data) {
      return sendError(reply, 400, 'invalid_request', 'invalid desktop authorize request')
    }
    if (!applyCallbackFormPolicy(reply, data.redirect_uri))
      return sendError(reply, 400, 'invalid_request', 'invalid native callback origin')

    const email = form.get('email') ?? ''
    const password = form.get('password') ?? ''
    const register = form.get('mode') === 'register'
    if (!email || !password) {
      return reply
        .code(400)
        .type(HTML_CONTENT_TYPE)
        .send(renderLoginPage(data, '请输入邮箱和密码。', register))
    }

    const name = (form.get('name') ?? '').trim()
    if (
      email.length > 254 ||
      password.length > 128 ||
      (register && (!name || name.length > 120 || password.length < 8 || !deps.auth.signUpEmail))
    )
      return reply
        .code(400)
        .type(HTML_CONTENT_TYPE)
        .send(renderLoginPage(data, '请检查姓名、邮箱和密码；密码至少 8 位。', register))
    const signInResponse = register
      ? await deps.auth.signUpEmail!({ body: { name, email, password }, asResponse: true })
      : await deps.auth.signInEmail({ body: { email, password }, asResponse: true })
    if (!signInResponse.ok) {
      // Never echo the credential, never distinguish "unknown account" from "wrong password".
      return reply
        .code(401)
        .type(HTML_CONTENT_TYPE)
        .send(
          renderLoginPage(
            data,
            register ? '无法创建账号，请检查信息或使用已有账号登录。' : '邮箱或密码不正确，请重试。',
            register,
          ),
        )
    }

    const setCookies = signInResponse.headers.getSetCookie()
    if (setCookies.length > 0) reply.header('set-cookie', setCookies)
    return reply.redirect(`/v1/desktop/authorize?${authorizeSearchParams(data).toString()}`, 302)
  })

  // ---- 2. Explicit consent, then a one-time authorization code --------------------------------
  app.post('/v1/desktop/consent', async (request, reply) => {
    applyBrowserPageHeaders(reply)
    if (!formOriginAllowed(request))
      return sendError(reply, 403, 'INVALID_ORIGIN', 'browser form origin is not trusted')
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
    if (!applyCallbackFormPolicy(reply, record.redirectUri))
      return sendError(reply, 400, 'invalid_request', 'invalid native callback origin')

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
    await tokens.issue(sha256Base64Url(token), { accountId: record.accountId, expiresAt })

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
      const hash = sha256Base64Url(token)
      const record = await tokens.find(hash)
      if (!record) return null
      if (record.expiresAt <= Date.now()) {
        await tokens.revoke(hash)
        return null
      }
      return deps.directory.accountById(record.accountId)
    },
  }

  app.post('/v1/desktop/revoke', async (request, reply) => {
    const account = await handle.authenticateBearer(request.headers.authorization)
    if (!account) return sendError(reply, 401, 'UNAUTHENTICATED', 'a valid bearer token is required')
    await tokens.revoke(sha256Base64Url(bearerFrom(request.headers.authorization)!))
    return reply.header('cache-control', 'no-store').send({ ok: true })
  })

  return handle
}
