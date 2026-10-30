import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { OrganizationConnectionView } from '@projectos/contracts'
import { buildServer } from '../apps/server/src/app.js'
import {
  OrganizationConnection,
  organizationOrigin,
} from '../apps/desktop/src/main/auth/organization-connection.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function codec() {
  const key = randomBytes(32)
  return {
    available: true,
    failEncrypt: false,
    isEncryptionAvailable() {
      return this.available
    },
    encryptString(value: string) {
      if (this.failEncrypt) throw new Error('encryption failed')
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv)
      const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), bytes])
    },
    decryptString(value: Buffer) {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      decipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')
    },
  }
}

describe('Main organization connection — real HTTP login and safe session state', () => {
  let server: Awaited<ReturnType<typeof buildServer>>
  let origin: string, cookies: string, email: string
  let firstOrg: string, secondOrg: string
  const directories: string[] = []
  const cleanups: Array<() => Promise<unknown>> = []

  beforeAll(async () => {
    const probe = createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const port = (probe.address() as { port: number }).port
    await new Promise<void>((resolve) => probe.close(() => resolve()))
    origin = `http://127.0.0.1:${port}`
    server = await buildServer({ baseURL: origin, secret: 'org-connection-tests-secret-0123456789abcdef' })
    await server.listen({ port, host: '127.0.0.1' })
    email = `connection-${randomBytes(6).toString('hex')}@demo.invalid`
    const signUp = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email, password: 'Test-pass-123456!', name: 'Connection test' }),
    })
    expect(signUp.status, await signUp.clone().text()).toBe(200)
    cookies = signUp.headers
      .getSetCookie()
      .map((item) => item.split(';')[0])
      .join('; ')
    for (const [name, slug] of [
      ['Alpha', 'connection-alpha'],
      ['Beta', 'connection-beta'],
    ]) {
      const response = await fetch(`${origin}/api/auth/organization/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, cookie: cookies },
        body: JSON.stringify({ name, slug }),
      })
      expect(response.status, await response.clone().text()).toBe(200)
      const body = (await response.json()) as { id: string }
      if (name === 'Alpha') firstOrg = body.id
      else secondOrg = body.id
    }
  })
  afterAll(async () => {
    await server?.close()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    while (cleanups.length) await cleanups.pop()!().catch(() => undefined)
    while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true })
  })

  async function browser(authorizeUrl: string) {
    const consentPage = await fetch(authorizeUrl, { headers: { cookie: cookies }, redirect: 'manual' })
    expect(consentPage.status, await consentPage.clone().text()).toBe(200)
    const requestId = /name="request_id" value="([A-Za-z0-9_-]+)"/.exec(await consentPage.text())?.[1]
    expect(requestId).toBeTruthy()
    const consent = await fetch(`${origin}/v1/desktop/consent`, {
      method: 'POST',
      headers: { origin, cookie: cookies, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ request_id: requestId!, decision: 'allow' }),
      redirect: 'manual',
    })
    expect(consent.status, await consent.clone().text()).toBe(302)
    const callback = new URL(consent.headers.get('location')!, origin)
    expect([...callback.searchParams.keys()].sort()).toEqual(['code', 'state'])
    await fetch(callback)
  }

  function setup(options: { fetchImpl?: typeof fetch; openExternal?: (url: string) => Promise<void> } = {}) {
    const dataDir = mkdtempSync(join(tmpdir(), 'projectos-org-connection-'))
    directories.push(dataDir)
    const crypto = codec()
    let rawToken = ''
    const captureFetch: typeof fetch = async (input, init) => {
      const response = await (options.fetchImpl ?? fetch)(input, init)
      if (String(input).endsWith('/v1/desktop/token') && response.ok)
        rawToken = ((await response.clone().json()) as { token: string }).token
      return response
    }
    const connection = new OrganizationConnection(
      dataDir,
      crypto,
      options.openExternal ?? browser,
      captureFetch,
    )
    cleanups.push(() => connection.execute('organization.cancel', {}))
    return {
      dataDir,
      crypto,
      connection,
      captureFetch,
      token: () => rawToken,
      vaultPath: join(dataDir, 'organization-session.vault'),
    }
  }
  async function connect(connection: OrganizationConnection) {
    return (await connection.execute('organization.connect', {
      serverUrl: origin,
    })) as OrganizationConnectionView
  }

  it('keeps tokens encrypted and out of views, and restores the actual session after a Main restart', async () => {
    const fixture = setup()
    const view = await connect(fixture.connection)
    expect(view.status).toBe('connected')
    expect(view.session?.account.email).toBe(email)
    expect(view.activeOrganizationId).toBe(firstOrg)
    expect(fixture.token()).toHaveLength(43)
    expect(JSON.stringify(view)).not.toContain(fixture.token())
    expect(view.session).not.toHaveProperty('token')
    const bytes = readFileSync(fixture.vaultPath)
    expect(bytes.includes(Buffer.from(fixture.token()))).toBe(false)
    expect(bytes.includes(Buffer.from(email))).toBe(false)
    const restarted = new OrganizationConnection(
      fixture.dataDir,
      fixture.crypto,
      browser,
      fixture.captureFetch,
    )
    const restored = await restarted.status(true)
    expect(restored.status).toBe('connected')
    expect(restored.session?.account.email).toBe(email)
    expect(restored.session?.organizations.map((item) => item.id)).toEqual([firstOrg, secondOrg])
    await restarted.execute('organization.disconnect', {})
    expect(
      (await fetch(`${origin}/v1/me`, { headers: { authorization: `Bearer ${fixture.token()}` } })).status,
    ).toBe(401)
  })

  it('refuses login before opening the browser when secure storage is unavailable', async () => {
    const opened = vi.fn(browser),
      fixture = setup({ openExternal: opened })
    fixture.crypto.available = false
    await expect(connect(fixture.connection)).rejects.toMatchObject({ code: 'SECRET_STORAGE_UNAVAILABLE' })
    expect(opened).not.toHaveBeenCalled()
    expect(existsSync(fixture.vaultPath)).toBe(false)
    expect((await fixture.connection.status()).status).toBe('local')
  })

  it('does not create a connected state on encryption failure and revokes the newly issued token', async () => {
    const fixture = setup()
    fixture.crypto.failEncrypt = true
    await expect(connect(fixture.connection)).rejects.toMatchObject({ code: 'SECRET_STORAGE_UNAVAILABLE' })
    expect((await fixture.connection.status()).status).toBe('local')
    expect(existsSync(fixture.vaultPath)).toBe(false)
    expect(
      (await fetch(`${origin}/v1/me`, { headers: { authorization: `Bearer ${fixture.token()}` } })).status,
    ).toBe(401)
  })

  it('keeps the previous connection and encrypted snapshot when logout cannot be saved', async () => {
    const fixture = setup()
    await connect(fixture.connection)
    const before = readFileSync(fixture.vaultPath)
    fixture.crypto.failEncrypt = true
    await expect(fixture.connection.execute('organization.disconnect', {})).rejects.toMatchObject({
      code: 'SECRET_STORAGE_UNAVAILABLE',
    })
    expect(readFileSync(fixture.vaultPath)).toEqual(before)
    expect((await fixture.connection.status()).status).toBe('connected')
    fixture.crypto.failEncrypt = false
    await fixture.connection.execute('organization.disconnect', {})
  })

  it('persists an offline revocation and retries it after restart without restoring the old login', async () => {
    let offline = true
    const wrapped: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/v1/desktop/revoke') && offline) throw new Error('offline')
      return fetch(input, init)
    }
    const fixture = setup({ fetchImpl: wrapped })
    await connect(fixture.connection)
    const loggedOut = (await fixture.connection.execute(
      'organization.disconnect',
      {},
    )) as OrganizationConnectionView
    expect(loggedOut.status).toBe('local')
    expect(loggedOut.revocationPending).toBe(true)
    expect(readFileSync(fixture.vaultPath).includes(Buffer.from(fixture.token()))).toBe(false)
    const restarted = new OrganizationConnection(
      fixture.dataDir,
      fixture.crypto,
      browser,
      fixture.captureFetch,
    )
    expect((await restarted.status()).status).toBe('local')
    offline = false
    expect((await restarted.status(true)).revocationPending).toBe(false)
    expect(
      (await fetch(`${origin}/v1/me`, { headers: { authorization: `Bearer ${fixture.token()}` } })).status,
    ).toBe(401)
  })

  it('cancels a stalled browser launch, closes its loopback listener and permits another login', async () => {
    const opened = deferred<string>()
    let stall = true
    const fixture = setup({
      openExternal: async (url) => {
        if (stall) {
          opened.resolve(url)
          await new Promise<void>(() => undefined)
        } else await browser(url)
      },
    })
    const pending = connect(fixture.connection)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    const url = await opened.promise
    await fixture.connection.execute('organization.cancel', {})
    await rejected
    await expect(fetch(new URL(url).searchParams.get('redirect_uri')!)).rejects.toThrow()
    expect((await fixture.connection.status()).status).toBe('local')
    stall = false
    expect((await connect(fixture.connection)).status).toBe('connected')
    await fixture.connection.execute('organization.disconnect', {})
  })

  it('discards an in-flight project response when the active organization changes', async () => {
    const started = deferred<void>(),
      release = deferred<void>()
    const fixture = setup({
      fetchImpl: async (input, init) => {
        const response = await fetch(input, init)
        if (String(input).endsWith('/projects')) {
          started.resolve()
          await release.promise
        }
        return response
      },
    })
    await connect(fixture.connection)
    const pending = fixture.connection.execute('organization.projects', {})
    const rejected = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    await started.promise
    const selected = (await fixture.connection.execute('organization.select', {
      organizationId: secondOrg,
    })) as OrganizationConnectionView
    expect(selected.activeOrganizationId).toBe(secondOrg)
    release.resolve()
    await rejected
    await fixture.connection.execute('organization.disconnect', {})
  })

  it('does not let a stale network failure mark a replacement login offline', async () => {
    const started = deferred<void>(),
      release = deferred<void>()
    const fixture = setup({
      fetchImpl: async (input, init) => {
        if (String(input).endsWith('/projects')) {
          started.resolve()
          await release.promise
          throw new Error('old connection failed')
        }
        return fetch(input, init)
      },
    })
    await connect(fixture.connection)
    const pending = fixture.connection.execute('organization.projects', {})
    const rejected = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    await started.promise
    await fixture.connection.execute('organization.disconnect', {})
    await connect(fixture.connection)
    release.resolve()
    await rejected
    expect((await fixture.connection.status()).status).toBe('connected')
    await fixture.connection.execute('organization.disconnect', {})
  })

  it('rechecks context after reading a response body so an old refresh cannot overwrite a new login', async () => {
    const started = deferred<void>()
    let finishBody: ((bytes: Uint8Array) => void) | undefined,
      hold = true
    const fixture = setup({
      fetchImpl: async (input, init) => {
        const response = await fetch(input, init)
        if (String(input).endsWith('/v1/me') && hold) {
          const me = (await response.json()) as { account: unknown; organizations: Array<{ id: string }> }
          me.organizations = me.organizations.filter((item) => item.id === secondOrg)
          const stream = new ReadableStream<Uint8Array>(
            {
              start(controller) {
                finishBody = (bytes) => {
                  controller.enqueue(bytes)
                  controller.close()
                }
              },
              pull() {
                started.resolve()
              },
            },
            { highWaterMark: 0 },
          )
          return new Response(stream, { headers: { 'content-type': 'application/json' } })
        }
        return response
      },
    })
    await connect(fixture.connection)
    const refreshed = fixture.connection.status(true)
    await started.promise
    await fixture.connection.execute('organization.disconnect', {})
    hold = false
    await connect(fixture.connection)
    finishBody!(
      new TextEncoder().encode(
        JSON.stringify({
          account: { id: 'stale-account', name: 'Stale account', email: 'stale@demo.invalid' },
          organizations: [{ id: secondOrg, name: 'Beta', slug: 'connection-beta', role: 'owner' }],
        }),
      ),
    )
    expect((await refreshed).activeOrganizationId).toBe(firstOrg)
    expect((await fixture.connection.status()).session?.account.email).toBe(email)
    await fixture.connection.execute('organization.disconnect', {})
  })

  it('rejects unauthorized organization selection without altering the current selection', async () => {
    const fixture = setup()
    await connect(fixture.connection)
    await expect(
      fixture.connection.execute('organization.select', { organizationId: 'other-tenant' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await fixture.connection.status()).activeOrganizationId).toBe(firstOrg)
    await fixture.connection.execute('organization.disconnect', {})
  })

  it('does not forward service error messages or reflected credentials across IPC', async () => {
    let secret = ''
    const fixture = setup({
      fetchImpl: async (input, init) => {
        if (String(input).endsWith('/projects'))
          return Response.json(
            { error: { message: `Authorization Bearer ${secret}; private database path` } },
            { status: 403 },
          )
        return fetch(input, init)
      },
    })
    await connect(fixture.connection)
    secret = fixture.token()
    const error = await fixture.connection.execute('organization.projects', {}).catch((value) => value)
    expect(error).toMatchObject({ code: 'FORBIDDEN' })
    expect(JSON.stringify(error)).not.toContain(secret)
    expect(String(error)).not.toContain('database path')
    await fixture.connection.execute('organization.disconnect', {})
  })

  it('persists an invalidated session after server revocation and refuses further requests', async () => {
    const fixture = setup()
    await connect(fixture.connection)
    await fetch(`${origin}/v1/desktop/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${fixture.token()}` },
    })
    expect((await fixture.connection.status(true)).status).toBe('expired')
    const restarted = new OrganizationConnection(
      fixture.dataDir,
      fixture.crypto,
      browser,
      fixture.captureFetch,
    )
    expect((await restarted.status()).status).toBe('expired')
    await expect(restarted.execute('organization.projects', {})).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await restarted.execute('organization.disconnect', {})
  })

  it('forwards a one-time invitation code only for that decision and never saves it in the session vault', async () => {
    const bodies: unknown[] = []
    const fixture = setup({
      fetchImpl: async (input, init) => {
        if (String(input).endsWith('/decide')) {
          bodies.push(JSON.parse(String(init?.body)))
          return Response.json({ ok: true })
        }
        return fetch(input, init)
      },
    })
    await connect(fixture.connection)
    const before = readFileSync(fixture.vaultPath)
    const invitationCode = randomBytes(24).toString('base64url')
    await fixture.connection.execute('organization.decideInvitation', {
      invitationId: 'invitation-test',
      decision: 'accepted',
      invitationCode,
    })
    await fixture.connection.execute('organization.decideInvitation', {
      invitationId: 'invitation-other',
      decision: 'rejected',
    })
    expect(bodies).toEqual([{ decision: 'accepted', invitationCode }, { decision: 'rejected' }])
    expect(readFileSync(fixture.vaultPath)).toEqual(before)
    expect(fixture.crypto.decryptString(readFileSync(fixture.vaultPath))).not.toContain(invitationCode)
    await fixture.connection.execute('organization.disconnect', {})
  })

  it('rejects oversized asset Content-Length and cancels its body before reading', async () => {
    const cancel = vi.fn()
    const fixture = setup({ fetchImpl: async (input, init) => String(input).endsWith('/assets')
      ? new Response(new ReadableStream({ cancel }), { headers: { 'content-length': String(8 * 1024 * 1024 + 1) } })
      : fetch(input, init) })
    await connect(fixture.connection)
    await expect(fixture.connection.execute('organization.assets', {})).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(cancel).toHaveBeenCalledOnce()
    expect((await fixture.connection.status()).status).toBe('connected')
  })

  it('enforces the asset streaming limit even without a Content-Length header', async () => {
    const cancel = vi.fn(), chunk = new Uint8Array(256 * 1024).fill(120)
    const fixture = setup({ fetchImpl: async (input, init) => String(input).endsWith('/assets')
      ? new Response(new ReadableStream({ start(controller) { for (let index = 0; index < 36; index++) controller.enqueue(chunk); controller.close() }, cancel }))
      : fetch(input, init) })
    await connect(fixture.connection)
    await expect(fixture.connection.execute('organization.assets', {})).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('offers retry for a service 503 without reflecting the response or expiring the account', async () => {
    const fixture = setup({ fetchImpl: async (input, init) => String(input).endsWith('/assets')
      ? Response.json({ error: { message: 'unsafe-server-detail' } }, { status: 503 })
      : fetch(input, init) })
    await connect(fixture.connection)
    await expect(fixture.connection.execute('organization.assets', {})).rejects.toMatchObject({ code: 'RUNTIME_UNAVAILABLE', retryable: true, message: '组织服务暂时无法完成请求，请稍后重试。' })
    expect((await fixture.connection.status()).status).toBe('connected')
  })

  it('does not forward an untrusted asset catalog exceeding the renderer row bound', async () => {
    const asset = { id: 'asset-test', organizationId: firstOrg, name: 'Bounded asset', kind: 'skill', visibility: 'organization', projectId: null, createdAt: Date.now(), canManage: false, latestVersion: '1.0.0', latestStatus: 'published', versionCount: 1, publishedVersionId: 'version-test', publishedVersion: '1.0.0' }
    const fixture = setup({ fetchImpl: async (input, init) => String(input).endsWith('/assets')
      ? Response.json({ assets: Array.from({ length: 201 }, () => asset) }) : fetch(input, init) })
    await connect(fixture.connection)
    await expect(fixture.connection.execute('organization.assets', {})).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('reports elapsed sessions as expired without a network request', async () => {
    const fixture = setup()
    const view = await connect(fixture.connection)
    const network = vi.spyOn(globalThis, 'fetch')
    vi.spyOn(Date, 'now').mockReturnValue(view.session!.expiresAt + 1)
    expect((await fixture.connection.status()).status).toBe('expired')
    await expect(fixture.connection.execute('organization.projects', {})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(network).not.toHaveBeenCalled()
  })
})

describe('organization connection origins', () => {
  it.each([
    'http://auth.example.com',
    'https://user:password@auth.example.com',
    'https://auth.example.com/path',
    'https://auth.example.com/?token=secret',
    'https://auth.example.com/#fragment',
    'file:///C:/private',
  ])('rejects unsafe origin %s', (url) => {
    expect(() => organizationOrigin(url)).toThrow()
  })
  it('permits HTTPS organization servers and HTTP loopback only', () => {
    expect(organizationOrigin('https://auth.example.com/')).toBe('https://auth.example.com')
    expect(organizationOrigin('http://127.0.0.1:4310')).toBe('http://127.0.0.1:4310')
  })
})
