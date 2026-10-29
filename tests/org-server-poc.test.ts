/**
 * A0 organization auth PoC — real integration test.
 *
 * Everything here runs over a real TCP loopback port against a real Fastify instance and the real
 * better-auth handler: sign-up, organization creation, invitation acceptance, organization/project
 * scope enforcement, and the desktop loopback+PKCE login. No module internals are stubbed; the only
 * hand-rolled pieces are a cookie jar and a "browser" made of fetch calls.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer as createNetServer } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DesktopSessionSchema, type DesktopSession } from '@projectos/organization-contracts'
import { buildServer } from '../apps/server/src/app'
import { runDesktopLogin } from '../apps/desktop/src/main/auth/desktop-login-core'

const PASSWORD = 'Passw0rd!A0-PoC'
const SECRET = 'a0-organization-poc-test-secret-0123456789abcdef'
const AUTH_PATHS = {
  signUp: '/api/auth/sign-up/email',
  organizationCreate: '/api/auth/organization/create',
  organizationList: '/api/auth/organization/list',
  inviteMember: '/api/auth/organization/invite-member',
  acceptInvitation: '/api/auth/organization/accept-invitation',
} as const

type ServerInstance = Awaited<ReturnType<typeof buildServer>>

let server: ServerInstance
let baseUrl: string
let emailCounter = 0

function uniqueEmail(prefix: string): string {
  emailCounter += 1
  return `${prefix}-${emailCounter}-${randomBytes(4).toString('hex')}@example.com`
}

async function reservePort(): Promise<number> {
  const probe = createNetServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => resolve())
  })
  const address = probe.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  if (!port) throw new Error('failed to reserve a loopback TCP port')
  return port
}

interface HttpResult {
  status: number
  headers: Headers
  text: string
}

interface SendOptions {
  method?: string
  json?: unknown
  form?: Record<string, string>
  cookie?: string
  origin?: string
}

async function send(path: string, options: SendOptions = {}): Promise<HttpResult> {
  const headers = new Headers()
  let body: string | undefined
  if (options.form) {
    headers.set('content-type', 'application/x-www-form-urlencoded')
    body = new URLSearchParams(options.form).toString()
  } else if (options.json !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(options.json)
  }
  if (options.cookie) headers.set('cookie', options.cookie)
  if (options.origin) headers.set('origin', options.origin)
  const response = await fetch(new URL(path, baseUrl), {
    method: options.method ?? 'GET',
    headers,
    body,
    redirect: 'manual',
  })
  return { status: response.status, headers: response.headers, text: await response.text() }
}

function parseJson<T>(result: HttpResult): T {
  return JSON.parse(result.text) as T
}

/** Minimal browser cookie jar: stores only what a browser would send back. */
class CookieJar {
  private readonly cookies = new Map<string, string>()

  store(setCookieHeaders: string[]): void {
    for (const header of setCookieHeaders) {
      const pair = header.split(';', 1)[0] ?? ''
      const separator = pair.indexOf('=')
      if (separator <= 0) continue
      const name = pair.slice(0, separator).trim()
      const value = pair.slice(separator + 1).trim()
      const maxAge = /max-age=(-?\d+)/i.exec(header)
      if (maxAge && Number(maxAge[1]) <= 0) {
        this.cookies.delete(name)
        continue
      }
      this.cookies.set(name, value)
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
  }
}

interface Account {
  email: string
  name: string
  userId: string
  jar: CookieJar
}

async function signUp(name: string): Promise<Account> {
  const email = uniqueEmail(name.toLowerCase().replaceAll(' ', '-'))
  const jar = new CookieJar()
  const result = await send(AUTH_PATHS.signUp, {
    method: 'POST',
    json: { email, password: PASSWORD, name },
    origin: baseUrl,
  })
  expect(result.status, result.text).toBe(200)
  jar.store(result.headers.getSetCookie())
  const body = parseJson<{ user: { id: string; email: string; name: string } }>(result)
  return { email: body.user.email, name: body.user.name, userId: body.user.id, jar }
}

async function createOrganization(
  account: Account,
  name: string,
  slug: string,
): Promise<{ id: string }> {
  const result = await send(AUTH_PATHS.organizationCreate, {
    method: 'POST',
    json: { name, slug },
    cookie: account.jar.header(),
    origin: baseUrl,
  })
  expect(result.status, result.text).toBe(200)
  const body = parseJson<{ id: string; members?: Array<{ role: string }> }>(result)
  expect(body.members?.[0]?.role).toBe('owner')
  return body
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

interface DesktopFlowOptions {
  jar: CookieJar
  email?: string
  verifier?: string
  state?: string
  redirectPort?: number
  /** Skip the login form (jar already holds a session). */
  expectExistingSession?: boolean
}

interface DesktopFlowResult {
  authorizeUrl: string
  authorizeQuery: URLSearchParams
  loginHtml: string | null
  consentHtml: string
  consentRequestId: string
  callbackUrl: URL
  code: string
  state: string
  verifier: string
  session: DesktopSession
}

/**
 * Plays the system browser with fetch: GET authorize -> (login form POST) -> consent page ->
 * POST consent -> callback URL -> token exchange. Redirects are followed manually so the test can
 * inspect every hop.
 */
async function runBrowserFlow(options: DesktopFlowOptions): Promise<DesktopFlowResult> {
  const { verifier, challenge } = pkcePair()
  const resolvedVerifier = options.verifier ?? verifier
  const resolvedChallenge =
    options.verifier === undefined
      ? challenge
      : createHash('sha256').update(options.verifier).digest('base64url')
  const state = options.state ?? randomBytes(24).toString('base64url')
  const redirectUri = `http://127.0.0.1:${options.redirectPort ?? 49731}/callback`
  const authorizeQuery = new URLSearchParams({
    client_id: 'projectos-desktop',
    redirect_uri: redirectUri,
    code_challenge: resolvedChallenge,
    code_challenge_method: 'S256',
    state,
  })
  const authorizeUrl = `/v1/desktop/authorize?${authorizeQuery.toString()}`

  let page = await send(authorizeUrl, { cookie: options.jar.header() })
  expect(page.status, page.text).toBe(200)
  let loginHtml: string | null = null

  if (!options.expectExistingSession && /name="password"/.test(page.text)) {
    loginHtml = page.text
    expect(options.email, 'a login form requires an email in the flow options').toBeTruthy()
    const login = await send(authorizeUrl, {
      method: 'POST',
      form: {
        client_id: 'projectos-desktop',
        redirect_uri: redirectUri,
        code_challenge: resolvedChallenge,
        code_challenge_method: 'S256',
        state,
        email: options.email ?? '',
        password: PASSWORD,
      },
      cookie: options.jar.header(),
      origin: baseUrl,
    })
    expect(login.status, login.text).toBe(302)
    options.jar.store(login.headers.getSetCookie())
    const location = login.headers.get('location')
    expect(location).toBeTruthy()
    page = await send(new URL(location ?? '', baseUrl).pathname + new URL(location ?? '', baseUrl).search, {
      cookie: options.jar.header(),
    })
    expect(page.status, page.text).toBe(200)
  }

  const consentHtml = page.text
  expect(consentHtml).toContain('授权此设备')
  const requestId = /name="request_id" value="([A-Za-z0-9_-]+)"/.exec(consentHtml)?.[1]
  expect(requestId, 'consent page must carry a one-time request id').toBeTruthy()

  const consent = await send('/v1/desktop/consent', {
    method: 'POST',
    form: { request_id: requestId ?? '', decision: 'allow' },
    cookie: options.jar.header(),
    origin: baseUrl,
  })
  expect(consent.status, consent.text).toBe(302)
  const callbackLocation = consent.headers.get('location')
  expect(callbackLocation).toBeTruthy()
  const callbackUrl = new URL(callbackLocation ?? '', baseUrl)
  expect(callbackUrl.origin).toBe(`http://127.0.0.1:${options.redirectPort ?? 49731}`)
  expect(callbackUrl.pathname).toBe('/callback')
  expect(callbackUrl.searchParams.get('state')).toBe(state)
  const code = callbackUrl.searchParams.get('code')
  expect(code).toBeTruthy()

  const tokenResult = await send('/v1/desktop/token', {
    method: 'POST',
    json: {
      client_id: 'projectos-desktop',
      grant_type: 'authorization_code',
      code,
      code_verifier: resolvedVerifier,
    },
    origin: baseUrl,
  })
  expect(tokenResult.status, tokenResult.text).toBe(200)
  const session = DesktopSessionSchema.parse(parseJson<DesktopSession>(tokenResult))

  return {
    authorizeUrl,
    authorizeQuery,
    loginHtml,
    consentHtml,
    consentRequestId: requestId ?? '',
    callbackUrl,
    code: code ?? '',
    state,
    verifier: resolvedVerifier,
    session,
  }
}

interface CreatedProject {
  id: string
  organizationId: string
  key: string
  name: string
}

interface SeededOrganization {
  account: Account
  token: string
  organization: { id: string }
}

async function seededOwner(name: string, slug: string): Promise<SeededOrganization> {
  const account = await signUp(name)
  const organization = await createOrganization(account, `${name} Org`, slug)
  const flow = await runBrowserFlow({ jar: account.jar, expectExistingSession: true })
  return { account, token: flow.session.token, organization }
}

describe('organization control plane (A0 PoC, real HTTP)', () => {
  beforeAll(async () => {
    const port = await reservePort()
    baseUrl = `http://127.0.0.1:${port}`
    server = await buildServer({ baseURL: baseUrl, secret: SECRET })
    await server.listen({ port, host: '127.0.0.1' })
  })

  afterAll(async () => {
    await server.close()
  })

  it('signs up accounts and creates organizations through better-auth HTTP endpoints', async () => {
    const accountA = await signUp('User A')
    const orgA = await createOrganization(accountA, 'Org A', 'org-a')
    expect(orgA.id).toMatch(/[A-Za-z0-9_-]{10,}/)

    const accountB = await signUp('User B')
    const orgB = await createOrganization(accountB, 'Org B', 'org-b')
    expect(orgB.id).not.toBe(orgA.id)

    const listedForA = await send(AUTH_PATHS.organizationList, { cookie: accountA.jar.header() })
    expect(listedForA.status, listedForA.text).toBe(200)
    const organizations = parseJson<Array<{ id: string }>>(listedForA)
    expect(organizations.map((organization) => organization.id)).toContain(orgA.id)
    expect(organizations.map((organization) => organization.id)).not.toContain(orgB.id)

    // The auth endpoints are really mounted inside Fastify, not shadowed by a fallback.
    const session = await send('/api/auth/get-session', { cookie: accountA.jar.header() })
    expect(session.status, session.text).toBe(200)
    expect(parseJson<{ user: { email: string } }>(session).user.email).toBe(accountA.email)
  })

  it('rejects cross-organization project reads and writes on the server', async () => {
    const ownerA = await seededOwner('Cross A', 'cross-a')
    const ownerB = await seededOwner('Cross B', 'cross-b')

    const readOther = await send(`/v1/organizations/${ownerB.organization.id}/projects`, {
      cookie: '',
      origin: baseUrl,
      method: 'GET',
    })
    expect(readOther.status).toBe(401)

    const readOtherWithToken = await fetch(
      new URL(`/v1/organizations/${ownerB.organization.id}/projects`, baseUrl),
      { headers: { authorization: `Bearer ${ownerA.token}` } },
    )
    expect(readOtherWithToken.status).toBe(403)
    const readBody = (await readOtherWithToken.json()) as { error?: { code?: string } }
    expect(readBody.error?.code).toBe('ORG_FORBIDDEN')

    const writeOther = await fetch(
      new URL(`/v1/organizations/${ownerB.organization.id}/projects`, baseUrl),
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ownerA.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ key: 'HACK', name: 'Injected' }),
      },
    )
    expect(writeOther.status).toBe(403)
    expect(((await writeOther.json()) as { error?: { code?: string } }).error?.code).toBe(
      'ORG_FORBIDDEN',
    )

    // The same token still works inside its own organization: the denial is scope, not auth.
    const own = await fetch(new URL(`/v1/organizations/${ownerA.organization.id}/projects`, baseUrl), {
      headers: { authorization: `Bearer ${ownerA.token}` },
    })
    expect(own.status, await own.text()).toBe(200)

    // B is not a member of A's organization either.
    const bReadsA = await fetch(
      new URL(`/v1/organizations/${ownerA.organization.id}/projects`, baseUrl),
      { headers: { authorization: `Bearer ${ownerB.token}` } },
    )
    expect(bReadsA.status).toBe(403)
  })

  it('scopes project requirements to project membership, not organization membership', async () => {
    const ownerA = await seededOwner('Scope A', 'scope-a')
    const outsider = await seededOwner('Scope B', 'scope-b')

    const created = await fetch(
      new URL(`/v1/organizations/${ownerA.organization.id}/projects`, baseUrl),
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ownerA.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ key: 'OSP', name: 'Orbit Platform', description: 'A0 scope proof' }),
      },
    )
    expect(created.status, await created.clone().text()).toBe(201)
    const project = ((await created.json()) as { project: CreatedProject }).project
    expect(project.organizationId).toBe(ownerA.organization.id)
    expect(project.key).toBe('OSP')

    const requirement = await fetch(new URL(`/v1/projects/${project.id}/requirements`, baseUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerA.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'Ship tenant isolation' }),
    })
    expect(requirement.status, await requirement.clone().text()).toBe(201)

    const ownerReads = await fetch(new URL(`/v1/projects/${project.id}/requirements`, baseUrl), {
      headers: { authorization: `Bearer ${ownerA.token}` },
    })
    expect(ownerReads.status, await ownerReads.clone().text()).toBe(200)
    const requirements = (await ownerReads.json()) as {
      requirements: Array<{ title: string; projectId: string; organizationId: string }>
    }
    expect(requirements.requirements).toHaveLength(1)
    expect(requirements.requirements[0]?.title).toBe('Ship tenant isolation')
    expect(requirements.requirements[0]?.projectId).toBe(project.id)

    const outsiderRead = await fetch(new URL(`/v1/projects/${project.id}/requirements`, baseUrl), {
      headers: { authorization: `Bearer ${outsider.token}` },
    })
    expect(outsiderRead.status).toBe(403)
    expect(((await outsiderRead.json()) as { error?: { code?: string } }).error?.code).toBe(
      'PROJECT_FORBIDDEN',
    )

    const outsiderWrite = await fetch(new URL(`/v1/projects/${project.id}/requirements`, baseUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${outsider.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'Injected requirement' }),
    })
    expect(outsiderWrite.status).toBe(403)
  })

  it('grants read-only organization access after invitation acceptance', async () => {
    const ownerA = await seededOwner('Invite A', 'invite-a')
    const inviteeB = await signUp('Invite B')
    const flowB = await runBrowserFlow({ jar: inviteeB.jar, expectExistingSession: true })

    const projectResponse = await fetch(
      new URL(`/v1/organizations/${ownerA.organization.id}/projects`, baseUrl),
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ownerA.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ key: 'INV', name: 'Invitation Project' }),
      },
    )
    expect(projectResponse.status, await projectResponse.clone().text()).toBe(201)
    const project = ((await projectResponse.json()) as { project: CreatedProject }).project

    const beforeInvite = await fetch(
      new URL(`/v1/organizations/${ownerA.organization.id}/projects`, baseUrl),
      { headers: { authorization: `Bearer ${flowB.session.token}` } },
    )
    expect(beforeInvite.status).toBe(403)

    const invitation = await send(AUTH_PATHS.inviteMember, {
      method: 'POST',
      json: { email: inviteeB.email, role: 'member', organizationId: ownerA.organization.id },
      cookie: ownerA.account.jar.header(),
      origin: baseUrl,
    })
    expect(invitation.status, invitation.text).toBe(200)
    const invitationBody = parseJson<{ id: string; status: string }>(invitation)
    expect(invitationBody.status).toBe('pending')

    const accepted = await send(AUTH_PATHS.acceptInvitation, {
      method: 'POST',
      json: { invitationId: invitationBody.id },
      cookie: inviteeB.jar.header(),
      origin: baseUrl,
    })
    expect(accepted.status, accepted.text).toBe(200)
    const acceptedBody = parseJson<{ member: { role: string; organizationId: string } }>(accepted)
    expect(acceptedBody.member.organizationId).toBe(ownerA.organization.id)
    expect(acceptedBody.member.role).toBe('member')

    // /v1/me reflects the new membership for the already-issued token (server-side lookup).
    const me = await fetch(new URL('/v1/me', baseUrl), {
      headers: { authorization: `Bearer ${flowB.session.token}` },
    })
    expect(me.status, await me.clone().text()).toBe(200)
    const meBody = (await me.json()) as {
      account: { email: string }
      organizations: Array<{ id: string; role: string }>
    }
    expect(meBody.account.email).toBe(inviteeB.email)
    const membership = meBody.organizations.find(
      (organization) => organization.id === ownerA.organization.id,
    )
    expect(membership?.role).toBe('member')

    const memberReadsOrgProjects = await fetch(
      new URL(`/v1/organizations/${ownerA.organization.id}/projects`, baseUrl),
      { headers: { authorization: `Bearer ${flowB.session.token}` } },
    )
    expect(memberReadsOrgProjects.status, await memberReadsOrgProjects.clone().text()).toBe(200)
    const listed = (await memberReadsOrgProjects.json()) as { projects: CreatedProject[]; role: string }
    expect(listed.role).toBe('member')
    expect(listed.projects.map((candidate) => candidate.id)).toContain(project.id)

    // member role has org.view only: creating a project must stay forbidden.
    const memberWrites = await fetch(
      new URL(`/v1/organizations/${ownerA.organization.id}/projects`, baseUrl),
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${flowB.session.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ key: 'NOPE', name: 'Member Project' }),
      },
    )
    expect(memberWrites.status).toBe(403)
    expect(((await memberWrites.json()) as { error?: { code?: string } }).error?.code).toBe(
      'ORG_FORBIDDEN',
    )

    // Organization membership never becomes a project permission.
    const memberReadsProject = await fetch(
      new URL(`/v1/projects/${project.id}/requirements`, baseUrl),
      { headers: { authorization: `Bearer ${flowB.session.token}` } },
    )
    expect(memberReadsProject.status).toBe(403)
    expect(((await memberReadsProject.json()) as { error?: { code?: string } }).error?.code).toBe(
      'PROJECT_FORBIDDEN',
    )
  })

  it('renders a hard-locked login page and enforces authorize/consent validation', async () => {
    const account = await signUp('Browser User')
    await createOrganization(account, 'Browser Org', 'browser-org')
    const { challenge } = pkcePair()
    const state = randomBytes(24).toString('base64url')
    const redirectUri = 'http://127.0.0.1:49732/callback'
    const validQuery = new URLSearchParams({
      client_id: 'projectos-desktop',
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    })

    const invalid = await send(`/v1/desktop/authorize?client_id=projectos-desktop`)
    expect(invalid.status).toBe(400)
    expect(parseJson<{ error: { code: string } }>(invalid).error.code).toBe('invalid_request')

    const freshJar = new CookieJar()
    const loginPage = await send(`/v1/desktop/authorize?${validQuery.toString()}`, {
      cookie: freshJar.header(),
    })
    expect(loginPage.status, loginPage.text).toBe(200)
    expect(loginPage.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    )
    expect(loginPage.headers.get('x-frame-options')).toBe('DENY')
    expect(loginPage.headers.get('cache-control')).toBe('no-store')
    expect(loginPage.text).toContain('登录 ProjectOS')
    expect(loginPage.text).toContain('name="password"')
    expect(loginPage.text).not.toContain('<script')

    // Wrong password must not set a session cookie and must not echo the password.
    const badLogin = await send(`/v1/desktop/authorize?${validQuery.toString()}`, {
      method: 'POST',
      form: {
        client_id: 'projectos-desktop',
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        email: account.email,
        password: 'definitely-wrong-password',
      },
      cookie: freshJar.header(),
      origin: baseUrl,
    })
    expect(badLogin.status).toBe(401)
    expect(badLogin.headers.getSetCookie()).toHaveLength(0)
    expect(badLogin.text).not.toContain('definitely-wrong-password')

    const login = await send(`/v1/desktop/authorize?${validQuery.toString()}`, {
      method: 'POST',
      form: {
        client_id: 'projectos-desktop',
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        email: account.email,
        password: PASSWORD,
      },
      cookie: freshJar.header(),
      origin: baseUrl,
    })
    expect(login.status, login.text).toBe(302)
    freshJar.store(login.headers.getSetCookie())
    expect(freshJar.header()).toContain('better-auth.session_token')

    const authorizeLocation = login.headers.get('location')
    expect(authorizeLocation).toContain('/v1/desktop/authorize?')
    expect(authorizeLocation).toContain(`state=${state}`)

    const consentPage = await send(authorizeLocation ?? '', { cookie: freshJar.header() })
    expect(consentPage.status, consentPage.text).toBe(200)
    expect(consentPage.text).toContain('授权此设备')
    expect(consentPage.text).toContain(account.email)
    expect(consentPage.text).toContain('Browser Org')
    expect(consentPage.text).toContain('不会授予')
    expect(consentPage.text).not.toContain('<script')
    const requestId = /name="request_id" value="([A-Za-z0-9_-]+)"/.exec(consentPage.text)?.[1]
    expect(requestId).toBeTruthy()

    const consent = await send('/v1/desktop/consent', {
      method: 'POST',
      form: { request_id: requestId ?? '', decision: 'allow' },
      cookie: freshJar.header(),
      origin: baseUrl,
    })
    expect(consent.status, consent.text).toBe(302)

    // One-time consent id: replay is rejected.
    const replay = await send('/v1/desktop/consent', {
      method: 'POST',
      form: { request_id: requestId ?? '', decision: 'allow' },
      cookie: freshJar.header(),
      origin: baseUrl,
    })
    expect(replay.status).toBe(400)
    expect(parseJson<{ error: { code: string } }>(replay).error.code).toBe('invalid_request')

    // An organization outside the account's scope is refused before any consent page is shown.
    const foreignOwner = await seededOwner('Foreign', 'foreign-org')
    const outOfScope = await send(
      `/v1/desktop/authorize?${validQuery.toString()}&organization_id=${foreignOwner.organization.id}`,
      { cookie: account.jar.header() },
    )
    expect(outOfScope.status).toBe(403)
    expect(parseJson<{ error: { code: string } }>(outOfScope).error.code).toBe('RESOURCE_NOT_IN_SCOPE')
  })

  it('issues an 8h opaque token through authorize -> login -> consent -> callback -> token', async () => {
    const account = await signUp('Flow User')
    const organization = await createOrganization(account, 'Flow Org', 'flow-org')
    const freshJar = new CookieJar()
    const flow = await runBrowserFlow({ jar: freshJar, email: account.email })

    expect(flow.loginHtml).not.toBeNull()
    expect(flow.session.account.email).toBe(account.email)
    expect(flow.session.organizations).toEqual([
      { id: organization.id, name: 'Flow Org', slug: 'flow-org', role: 'owner' },
    ])
    expect(flow.session.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const ttl = flow.session.expiresAt - Date.now()
    expect(ttl).toBeGreaterThan(7.5 * 60 * 60 * 1000)
    expect(ttl).toBeLessThanOrEqual(8 * 60 * 60 * 1000)

    // Callback URL: exactly code+state, never the token, never the verifier.
    expect([...flow.callbackUrl.searchParams.keys()].sort()).toEqual(['code', 'state'])
    expect(flow.callbackUrl.toString()).not.toContain(flow.session.token)
    expect(flow.callbackUrl.toString()).not.toContain(flow.verifier)
    expect(flow.authorizeUrl).toContain(`code_challenge=${flow.authorizeQuery.get('code_challenge')}`)
    expect(flow.authorizeUrl).not.toContain(flow.verifier)

    const me = await fetch(new URL('/v1/me', baseUrl), {
      headers: { authorization: `Bearer ${flow.session.token}` },
    })
    expect(me.status, await me.clone().text()).toBe(200)
    const meBody = (await me.json()) as {
      account: { id: string; email: string }
      organizations: Array<{ id: string; role: string }>
    }
    expect(meBody.account.id).toBe(account.userId)
    expect(meBody.account.email).toBe(account.email)
    expect(meBody.organizations).toEqual([{ id: organization.id, name: 'Flow Org', slug: 'flow-org', role: 'owner' }])

    // The token response itself must not be cacheable by any intermediary.
    const tokenResponse = await send('/v1/desktop/token', { method: 'POST', json: {} })
    expect(tokenResponse.status).toBe(400)
    expect(tokenResponse.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects PKCE mismatch, code reuse and malformed token requests', async () => {
    const account = await signUp('PKCE User')
    await createOrganization(account, 'PKCE Org', 'pkce-org')
    const flow = await runBrowserFlow({ jar: account.jar, expectExistingSession: true })
    const wrongVerifier = randomBytes(32).toString('base64url')

    const mismatched = await send('/v1/desktop/token', {
      method: 'POST',
      json: {
        client_id: 'projectos-desktop',
        grant_type: 'authorization_code',
        code: flow.code,
        code_verifier: wrongVerifier,
      },
    })
    expect(mismatched.status).toBe(400)
    expect(parseJson<{ error: { code: string } }>(mismatched).error.code).toBe('invalid_grant')

    // The failed attempt consumed the code: even the correct verifier now fails.
    const replay = await send('/v1/desktop/token', {
      method: 'POST',
      json: {
        client_id: 'projectos-desktop',
        grant_type: 'authorization_code',
        code: flow.code,
        code_verifier: flow.verifier,
      },
    })
    expect(replay.status).toBe(400)
    expect(parseJson<{ error: { code: string } }>(replay).error.code).toBe('invalid_grant')

    const unknownCode = await send('/v1/desktop/token', {
      method: 'POST',
      json: {
        client_id: 'projectos-desktop',
        grant_type: 'authorization_code',
        code: randomBytes(32).toString('base64url'),
        code_verifier: randomBytes(32).toString('base64url'),
      },
    })
    expect(unknownCode.status).toBe(400)
    expect(parseJson<{ error: { code: string } }>(unknownCode).error.code).toBe('invalid_grant')

    const malformed = await send('/v1/desktop/token', {
      method: 'POST',
      json: { client_id: 'not-projectos', grant_type: 'password' },
    })
    expect(malformed.status).toBe(400)
    expect(parseJson<{ error: { code: string } }>(malformed).error.code).toBe('invalid_request')

    const noToken = await fetch(new URL('/v1/me', baseUrl))
    expect(noToken.status).toBe(401)
    const bogusToken = await fetch(new URL('/v1/me', baseUrl), {
      headers: { authorization: `Bearer ${randomBytes(32).toString('base64url')}` },
    })
    expect(bogusToken.status).toBe(401)
    expect(((await bogusToken.json()) as { error?: { code?: string } }).error?.code).toBe(
      'UNAUTHENTICATED',
    )
  })

  it('rejects a callback whose state does not match the one-shot loopback core', async () => {
    const account = await signUp('Loopback State')
    await createOrganization(account, 'Loopback Org', 'loopback-org')
    let issuedCallbackUrl: URL | null = null

    const login = runDesktopLogin({
      authBaseUrl: baseUrl,
      timeoutMs: 5_000,
      // The "browser" completes login + consent, then tampers with state before visiting the
      // loopback listener. The core must reject it instead of exchanging the code.
      openExternal: async (authorizeUrl) => {
        const authorize = new URL(authorizeUrl)
        const page = await send(`${authorize.pathname}${authorize.search}`, {
          cookie: account.jar.header(),
        })
        expect(page.status, page.text).toBe(200)
        const requestId = /name="request_id" value="([A-Za-z0-9_-]+)"/.exec(page.text)?.[1]
        expect(requestId).toBeTruthy()
        const consent = await send('/v1/desktop/consent', {
          method: 'POST',
          form: { request_id: requestId ?? '', decision: 'allow' },
          cookie: account.jar.header(),
          origin: baseUrl,
        })
        expect(consent.status, consent.text).toBe(302)
        const callbackUrl = new URL(consent.headers.get('location') ?? '', baseUrl)
        issuedCallbackUrl = callbackUrl
        const tampered = new URL(callbackUrl.toString())
        tampered.searchParams.set('state', randomBytes(24).toString('base64url'))
        await fetch(tampered)
      },
    })

    await expect(login).rejects.toMatchObject({ code: 'state_mismatch' })
    expect(issuedCallbackUrl).not.toBeNull()
    if (!issuedCallbackUrl) throw new Error('unreachable')
    const issued = issuedCallbackUrl as URL
    expect(issued.hostname).toBe('127.0.0.1')
    expect(issued.pathname).toBe('/callback')
    // The loopback listener is closed after the rejection, so the callback URL is dead.
    await expect(fetch(issued.toString())).rejects.toThrow()
  })
})
