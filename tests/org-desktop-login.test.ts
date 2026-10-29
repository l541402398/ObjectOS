/**
 * A0 desktop login test: `runDesktopLogin` against the real server, with a fake `openExternal` that
 * plays the system browser through real HTTP requests. The loopback listener itself is real
 * (127.0.0.1:0), so host validation, state, PKCE, one-shot handling and cleanup are all exercised.
 */
import { randomBytes } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DesktopSessionSchema } from '@projectos/organization-contracts'
import { buildServer } from '../apps/server/src/app'
import {
  DesktopLoginError,
  runDesktopLogin,
  type DesktopLoginResult,
} from '../apps/desktop/src/main/auth/desktop-login-core'

const PASSWORD = 'Passw0rd!Desktop-A0'
const SECRET = 'a0-desktop-login-test-secret-0123456789abcdef'

type ServerInstance = Awaited<ReturnType<typeof buildServer>>

let server: ServerInstance
let baseUrl: string
let emailCounter = 0

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

class CookieJar {
  private readonly cookies = new Map<string, string>()

  store(setCookieHeaders: string[]): void {
    for (const header of setCookieHeaders) {
      const pair = header.split(';', 1)[0] ?? ''
      const separator = pair.indexOf('=')
      if (separator <= 0) continue
      this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim())
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
  }
}

interface BrowserIdentity {
  jar: CookieJar
  email: string
}

async function createAccount(label: string): Promise<BrowserIdentity> {
  emailCounter += 1
  const email = `${label}-${emailCounter}-${randomBytes(4).toString('hex')}@example.com`
  const jar = new CookieJar()
  const response = await fetch(new URL('/api/auth/sign-up/email', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password: PASSWORD, name: label }),
  })
  expect(response.status, await response.clone().text()).toBe(200)
  jar.store(response.headers.getSetCookie())
  return { jar, email }
}

async function createOrganization(identity: BrowserIdentity, name: string, slug: string): Promise<string> {
  const response = await fetch(new URL('/api/auth/organization/create', baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: identity.jar.header(),
      origin: baseUrl,
    },
    body: JSON.stringify({ name, slug }),
  })
  expect(response.status, await response.clone().text()).toBe(200)
  const body = (await response.json()) as { id: string }
  return body.id
}

interface BrowserOptions {
  identity: BrowserIdentity
  /** Runs after the consent redirect produced a callback URL; may rewrite the URL to fetch. */
  onCallback?: (callbackUrl: URL) => Promise<URL> | URL
}

function cookieHeader(identity: BrowserIdentity): string {
  return identity.jar.header()
}

/** Plays the whole browser side of the flow with fetch. Returns the callback it visited. */
function createFakeBrowser(options: BrowserOptions): {
  openExternal: (authorizeUrl: string) => Promise<void>
  callbackUrl: () => URL | null
} {
  let visited: URL | null = null
  const openExternal = async (authorizeUrl: string): Promise<void> => {
    const withCookies = { cookie: cookieHeader(options.identity) }
    const authorizeResponse = await fetch(authorizeUrl, { headers: withCookies, redirect: 'manual' })
    expect(authorizeResponse.status, await authorizeResponse.clone().text()).toBe(200)
    let html = await authorizeResponse.text()
    let consentPageUrl = authorizeUrl

    if (html.includes('name="password"')) {
      const authorize = new URL(authorizeUrl)
      const form = new URLSearchParams()
      for (const key of [
        'client_id',
        'redirect_uri',
        'code_challenge',
        'code_challenge_method',
        'state',
        'organization_id',
      ]) {
        const value = authorize.searchParams.get(key)
        if (value !== null) form.set(key, value)
      }
      form.set('email', options.identity.email)
      form.set('password', PASSWORD)
      const loginResponse = await fetch(authorizeUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: cookieHeader(options.identity),
          origin: baseUrl,
        },
        body: form.toString(),
        redirect: 'manual',
      })
      expect(loginResponse.status, await loginResponse.clone().text()).toBe(302)
      options.identity.jar.store(loginResponse.headers.getSetCookie())
      const location = loginResponse.headers.get('location')
      expect(location).toBeTruthy()
      consentPageUrl = new URL(location ?? '', baseUrl).toString()
      const consentPage = await fetch(consentPageUrl, {
        headers: { cookie: cookieHeader(options.identity) },
        redirect: 'manual',
      })
      expect(consentPage.status, await consentPage.clone().text()).toBe(200)
      html = await consentPage.text()
    }

    expect(html).toContain('授权此设备')
    const requestId = /name="request_id" value="([A-Za-z0-9_-]+)"/.exec(html)?.[1]
    expect(requestId).toBeTruthy()
    const consentResponse = await fetch(new URL('/v1/desktop/consent', baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader(options.identity),
        origin: baseUrl,
      },
      body: new URLSearchParams({ request_id: requestId ?? '', decision: 'allow' }).toString(),
      redirect: 'manual',
    })
    expect(consentResponse.status, await consentResponse.clone().text()).toBe(302)
    const location = consentResponse.headers.get('location')
    expect(location).toBeTruthy()
    let callbackUrl = new URL(location ?? '', baseUrl)
    if (options.onCallback) callbackUrl = await options.onCallback(callbackUrl)
    visited = callbackUrl
    // The browser now hits the loopback listener the desktop core opened.
    await fetch(callbackUrl)
  }
  return { openExternal, callbackUrl: () => visited }
}

/** Raw HTTP request, so the test can spoof the Host header (fetch forbids it). */
async function rawCallbackRequest(callbackUrl: URL, host: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: callbackUrl.hostname,
        port: Number(callbackUrl.port),
        path: `${callbackUrl.pathname}${callbackUrl.search}`,
        method: 'GET',
        headers: { host },
      },
      (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode ?? 0))
      },
    )
    request.on('error', reject)
    request.end()
  })
}

function expectDesktopLoginError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(DesktopLoginError)
  expect((error as DesktopLoginError).code).toBe(code)
}

describe('desktop loopback login (A0 PoC)', () => {
  beforeAll(async () => {
    const port = await reservePort()
    baseUrl = `http://127.0.0.1:${port}`
    server = await buildServer({ baseURL: baseUrl, secret: SECRET })
    await server.listen({ port, host: '127.0.0.1' })
  })

  afterAll(async () => {
    await server.close()
  })

  it('completes the loopback+PKCE flow without leaking a token into a URL', async () => {
    const identity = await createAccount('desktop-owner')
    const organizationId = await createOrganization(identity, 'Desktop Org', 'desktop-org')
    const browser = createFakeBrowser({ identity })

    let result: DesktopLoginResult | null = null
    result = await runDesktopLogin({ authBaseUrl: baseUrl, openExternal: browser.openExternal })
    expect(result).not.toBeNull()
    if (!result) throw new Error('unreachable')

    const session = DesktopSessionSchema.parse(result.session)
    expect(session.account.email).toBe(identity.email)
    expect(session.organizations).toEqual([
      { id: organizationId, name: 'Desktop Org', slug: 'desktop-org', role: 'owner' },
    ])

    // The redirect URI is the loopback listener the core bound, and it carries only code+state.
    const redirect = new URL(result.redirectUri)
    expect(redirect.hostname).toBe('127.0.0.1')
    expect(redirect.pathname).toBe('/callback')
    const callback = browser.callbackUrl()
    expect(callback).not.toBeNull()
    if (!callback) throw new Error('unreachable')
    expect([...callback.searchParams.keys()].sort()).toEqual(['code', 'state'])
    expect(callback.toString()).not.toContain(session.token)
    expect(callback.toString()).not.toContain('code_verifier')

    // The authorize URL carries the PKCE challenge and state, never the verifier or a token.
    const authorize = new URL(result.authorizeUrl)
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authorize.searchParams.get('state')).toBe(callback.searchParams.get('state'))
    expect(authorize.searchParams.get('redirect_uri')).toBe(result.redirectUri)
    expect(authorize.toString()).not.toContain(session.token)
    expect(authorize.toString()).not.toContain('code_verifier')

    const me = await fetch(new URL('/v1/me', baseUrl), {
      headers: { authorization: `Bearer ${session.token}` },
    })
    expect(me.status, await me.clone().text()).toBe(200)
    const meBody = (await me.json()) as { account: { email: string } }
    expect(meBody.account.email).toBe(identity.email)

    // Cleanup: the one-shot listener is closed once the login finishes.
    await expect(fetch(result.redirectUri)).rejects.toThrow()
  })

  it('fails cleanly on timeout and closes the listener', async () => {
    const identity = await createAccount('desktop-timeout')
    await createOrganization(identity, 'Timeout Org', 'timeout-org')
    let observedRedirectUri = ''

    const browser = createFakeBrowser({
      identity,
      onCallback: () => {
        // Deliberately never visit the callback: the login must time out instead of hanging.
        throw new Error('stop-before-callback')
      },
    })

    let capturedError: unknown = null
    const startedAt = Date.now()
    try {
      await runDesktopLogin({
        authBaseUrl: baseUrl,
        timeoutMs: 400,
        openExternal: async (authorizeUrl) => {
          observedRedirectUri = new URL(authorizeUrl).searchParams.get('redirect_uri') ?? ''
          // Drive the browser to the consent redirect but swallow the thrown stop signal, so the
          // loopback listener is genuinely waiting when the timeout fires.
          try {
            await browser.openExternal(authorizeUrl)
          } catch {
            // expected: the fake browser refuses to hand the code to the callback
          }
        },
      })
    } catch (error) {
      capturedError = error
    }
    const elapsed = Date.now() - startedAt

    expectDesktopLoginError(capturedError, 'timeout')
    expect(elapsed).toBeLessThan(5_000)
    expect(observedRedirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    // Listener closed even on the timeout path.
    await expect(fetch(observedRedirectUri)).rejects.toThrow()
  })

  it('rejects a callback whose state does not match and never exchanges the code', async () => {
    const identity = await createAccount('desktop-state')
    await createOrganization(identity, 'State Org', 'state-org')
    const tokenEndpointCalls: string[] = []
    const countingFetch: typeof fetch = async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      tokenEndpointCalls.push(url)
      return await fetch(input, init)
    }

    const browser = createFakeBrowser({
      identity,
      onCallback: (callbackUrl) => {
        const tampered = new URL(callbackUrl.toString())
        tampered.searchParams.set('state', randomBytes(24).toString('base64url'))
        return tampered
      },
    })

    let capturedError: unknown = null
    try {
      await runDesktopLogin({
        authBaseUrl: baseUrl,
        openExternal: browser.openExternal,
        fetchImpl: countingFetch,
      })
    } catch (error) {
      capturedError = error
    }

    expectDesktopLoginError(capturedError, 'state_mismatch')
    expect(tokenEndpointCalls.filter((url) => url.includes('/v1/desktop/token'))).toHaveLength(0)
  })

  it('rejects a spoofed Host header without consuming the one-shot callback', async () => {
    const identity = await createAccount('desktop-host')
    await createOrganization(identity, 'Host Org', 'host-org')
    let spoofStatus = 0
    const browser = createFakeBrowser({
      identity,
      onCallback: async (callbackUrl) => {
        spoofStatus = await rawCallbackRequest(callbackUrl, 'evil.example')
        return callbackUrl
      },
    })

    const result = await runDesktopLogin({ authBaseUrl: baseUrl, openExternal: browser.openExternal })
    expect(spoofStatus).toBe(400)
    expect(result.session.account.email).toBe(identity.email)
  })

  it('rejects invalid bearer tokens on /v1/me', async () => {
    const response = await fetch(new URL('/v1/me', baseUrl), {
      headers: { authorization: `Bearer ${randomBytes(32).toString('base64url')}` },
    })
    expect(response.status).toBe(401)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED')

    const missing = await fetch(new URL('/v1/me', baseUrl))
    expect(missing.status).toBe(401)

    // A token of the right shape but wrong length is still rejected, not thrown on.
    const wrongShape = await fetch(new URL('/v1/me', baseUrl), {
      headers: { authorization: 'Bearer short' },
    })
    expect(wrongShape.status).toBe(401)
  })

  it('rejects non-loopback auth base URLs', async () => {
    await expect(
      runDesktopLogin({
        authBaseUrl: 'https://auth.example.com',
        openExternal: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'invalid_configuration' })
  })
})
