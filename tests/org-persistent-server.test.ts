import { createHash, randomBytes } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildOrganizationServer,
  validateOrganizationServerOptions,
} from '../apps/server/src/persistent-server.js'
import { migrateOrganizationDatabase } from '../apps/server/src/postgres-store.js'
import { runDesktopLogin } from '../apps/desktop/src/main/auth/desktop-login-core.js'
import type { DesktopSession } from '@projectos/organization-contracts'
import { reserveOrganizationTestPort, startOrganizationTestDatabase } from './helpers/org-postgres.js'

const SECRET = 'isolated-org-a1-integration-secret-0123456789abcdef'
const PASSWORD = 'Isolated-A1-Password-2026!'
type Server = Awaited<ReturnType<typeof buildOrganizationServer>>
type Database = Awaited<ReturnType<typeof startOrganizationTestDatabase>>
interface Identity {
  id: string
  email: string
  cookie: string
  session: DesktopSession
}
let database: Database, server: Server, baseURL: string, owner: Identity, other: Identity, guest: Identity
let orgA: string, orgB: string, projectA: string

async function json(path: string, identity?: Identity, method = 'GET', body?: unknown) {
  const response = await fetch(baseURL + path, {
    method,
    headers: {
      ...(identity
        ? { authorization: `Bearer ${identity.session.token}` }
        : { 'content-type': 'application/json' }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      origin: baseURL,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, body: (await response.json()) as any }
}

async function loginWithCookie(cookie: string): Promise<DesktopSession> {
  const loggedIn = await runDesktopLogin({
    authBaseUrl: baseURL,
    timeoutMs: 10_000,
    openExternal: async (url) => {
      const page = await fetch(url, { headers: { cookie }, redirect: 'manual' })
      expect(page.status).toBe(200)
      const callbackOrigin = new URL(new URL(url).searchParams.get('redirect_uri')!).origin
      expect(page.headers.get('content-security-policy')).toBe(
        `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${callbackOrigin}`,
      )
      const body = await page.text()
      const requestId = /name="request_id" value="([^"]+)"/.exec(body)?.[1]
      expect(requestId).toBeTruthy()
      const consent = await fetch(baseURL + '/v1/desktop/consent', {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie, origin: baseURL, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ request_id: requestId!, decision: 'allow' }),
      })
      expect(consent.status).toBe(302)
      expect(consent.headers.get('content-security-policy')).toBe(page.headers.get('content-security-policy'))
      const callback = new URL(consent.headers.get('location')!)
      expect(callback.searchParams.has('token')).toBe(false)
      expect((await fetch(callback)).status).toBe(200)
    },
  })
  return loggedIn.session
}

async function account(label: string): Promise<Identity> {
  const email = `${label}-${randomBytes(4).toString('hex')}@demo.invalid`
  const response = await fetch(baseURL + '/api/auth/sign-up/email', {
    method: 'POST',
    headers: { origin: baseURL, 'content-type': 'application/json' },
    body: JSON.stringify({ name: label, email, password: PASSWORD }),
  })
  expect(response.status).toBe(200)
  const payload = (await response.json()) as { user: { id: string } }
  const cookie = response.headers
    .getSetCookie()
    .map((item) => item.split(';')[0])
    .join('; ')
  return { id: payload.user.id, email, cookie, session: await loginWithCookie(cookie) }
}

describe('A1 real PostgreSQL organization control plane', () => {
  beforeAll(async () => {
    database = await startOrganizationTestDatabase()
    await migrateOrganizationDatabase(database.pool)
    const port = await reserveOrganizationTestPort()
    baseURL = `http://127.0.0.1:${port}`
    server = await buildOrganizationServer({ databaseUrl: database.databaseUrl, secret: SECRET, baseURL })
    await server.listen({ port, host: '127.0.0.1' })
    owner = await account('owner')
    other = await account('other')
    guest = await account('guest')
    const first = await json('/v1/organizations', owner, 'POST', {
      name: 'Organization A',
      slug: 'integration-org-a',
    })
    expect(first.status).toBe(201)
    orgA = first.body.organization.id
    const second = await json('/v1/organizations', other, 'POST', {
      name: 'Organization B',
      slug: 'integration-org-b',
    })
    expect(second.status).toBe(201)
    orgB = second.body.organization.id
    const created = await json(`/v1/organizations/${orgA}/projects`, owner, 'POST', {
      key: 'ALPHA',
      name: 'Alpha',
    })
    expect(created.status).toBe(201)
    projectA = created.body.project.id
  }, 90_000)
  afterAll(async () => {
    await server?.close()
    await database?.stop()
  }, 30_000)

  it('requires configured database/secret and HTTPS outside loopback', () => {
    expect(() => validateOrganizationServerOptions({ databaseUrl: '', secret: SECRET, baseURL })).toThrow()
    expect(() =>
      validateOrganizationServerOptions({ databaseUrl: database.databaseUrl, secret: 'short', baseURL }),
    ).toThrow()
    expect(() =>
      validateOrganizationServerOptions({
        databaseUrl: database.databaseUrl,
        secret: SECRET,
        baseURL: 'http://organization.example',
      }),
    ).toThrow('HTTPS')
  })

  it('stores opaque desktop token hashes, audit facts and no machine root paths', async () => {
    const sessions = await database.pool.query('SELECT token_hash FROM desktop_sessions')
    expect(sessions.rows).toHaveLength(3)
    expect(
      sessions.rows.every((row) => row.token_hash !== owner.session.token && row.token_hash.length === 43),
    ).toBe(true)
    const audit = await database.pool.query('SELECT operation,details FROM organization_audit_events')
    expect(audit.rows.some((row) => row.operation === 'project.created')).toBe(true)
    expect(JSON.stringify(audit.rows)).not.toContain(owner.session.token)
    const list = await json(`/v1/organizations/${orgA}/projects`, owner)
    expect(list.body.projects).toHaveLength(1)
    expect(list.body.projects[0]).not.toHaveProperty('rootPath')
  })

  it('keeps organizations, projects and desktop sessions across a real server restart', async () => {
    await server.close()
    server = await buildOrganizationServer({ databaseUrl: database.databaseUrl, secret: SECRET, baseURL })
    await server.listen({ port: Number(new URL(baseURL).port), host: '127.0.0.1' })
    const me = await json('/v1/me', owner)
    expect(me.status).toBe(200)
    expect(me.body.organizations[0].id).toBe(orgA)
    const projects = await json(`/v1/organizations/${orgA}/projects`, owner)
    expect(projects.body.projects[0].id).toBe(projectA)
    expect((await json(`/v1/organizations/${orgB}/projects`, owner)).status).toBe(403)
    expect((await json(`/v1/organizations/${orgA}/members`, other)).status).toBe(403)
    expect(
      (await json(`/v1/organizations/${orgA}/projects`, other, 'POST', { key: 'ESCAPE', name: 'forbidden' }))
        .status,
    ).toBe(403)
  })

  it('registers a new account through the real browser form and completes consent plus PKCE', async () => {
    const email = `browser-${randomBytes(5).toString('hex')}@demo.invalid`
    const loggedIn = await runDesktopLogin({
      authBaseUrl: baseURL,
      timeoutMs: 10_000,
      openExternal: async (url) => {
        const page = await fetch(url + '&mode=register')
        expect(page.status).toBe(200)
        expect(page.headers.get('referrer-policy')).toBe('same-origin')
        const callbackOrigin = new URL(new URL(url).searchParams.get('redirect_uri')!).origin
        expect(page.headers.get('content-security-policy')).toBe(
          `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${callbackOrigin}`,
        )
        expect(await page.text()).toContain('创建组织账号')
        const fields = new URLSearchParams(new URL(url).search)
        fields.set('mode', 'register')
        fields.set('name', 'Browser User')
        fields.set('email', email)
        fields.set('password', PASSWORD)
        const created = await fetch(baseURL + '/v1/desktop/authorize', {
          method: 'POST',
          redirect: 'manual',
          headers: { origin: baseURL, 'content-type': 'application/x-www-form-urlencoded' },
          body: fields,
        })
        expect(created.status).toBe(302)
        const cookie = created.headers
          .getSetCookie()
          .map((item) => item.split(';')[0])
          .join('; ')
        const consentPage = await fetch(baseURL + created.headers.get('location'), { headers: { cookie } })
        const requestId = /name="request_id" value="([^"]+)"/.exec(await consentPage.text())?.[1]
        expect(requestId).toBeTruthy()
        const consent = await fetch(baseURL + '/v1/desktop/consent', {
          method: 'POST',
          redirect: 'manual',
          headers: { origin: baseURL, cookie, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ request_id: requestId!, decision: 'allow' }),
        })
        expect(consent.status).toBe(302)
        expect((await fetch(consent.headers.get('location')!)).status).toBe(200)
      },
    })
    expect(loggedIn.session.account.email).toBe(email)
    expect(loggedIn.session.organizations).toEqual([])
  })

  it('uses single-use, email-bound invitations and keeps project membership separate', async () => {
    const invite = await json(`/v1/organizations/${orgA}/invitations`, owner, 'POST', {
      email: guest.email,
      role: 'member',
    })
    expect(invite.status).toBe(201)
    const path = `/v1/invitations/${invite.body.invitation.id}/decide`
    const invitationCode = invite.body.invitationCode as string
    expect(invitationCode).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect((await json(path, other, 'POST', { decision: 'accepted', invitationCode })).status).toBe(409)
    expect((await json(path, guest, 'POST', { decision: 'accepted' })).status).toBe(400)
    expect(
      (await json(path, guest, 'POST', { decision: 'accepted', invitationCode: 'x'.repeat(43) })).status,
    ).toBe(403)
    const listing = await json('/v1/invitations', guest)
    expect(JSON.stringify(listing.body)).not.toContain(invitationCode)
    const stored = await database.pool.query(
      'SELECT code_hash FROM organization_invitation_codes WHERE invitation_id=$1',
      [invite.body.invitation.id],
    )
    expect(stored.rows[0].code_hash).not.toBe(invitationCode)
    expect((await json(path, guest, 'POST', { decision: 'accepted', invitationCode })).status).toBe(200)
    expect((await json(path, guest, 'POST', { decision: 'accepted', invitationCode })).status).toBe(409)
    const projects = await json(`/v1/organizations/${orgA}/projects`, guest)
    expect(projects.status).toBe(200)
    expect(projects.body.projects).toEqual([])
    expect(
      (await json(`/v1/organizations/${orgA}/projects`, guest, 'POST', { key: 'NOPE', name: 'not allowed' }))
        .status,
    ).toBe(403)
    expect(
      (
        await json(`/v1/organizations/${orgA}/projects/${projectA}/members`, owner, 'PUT', {
          accountId: guest.id,
          role: 'viewer',
        })
      ).status,
    ).toBe(200)
    expect((await json(`/v1/organizations/${orgA}/projects`, guest)).body.projects[0].role).toBe('viewer')
    expect(
      (
        await json(`/v1/organizations/${orgA}/projects/${projectA}/members`, owner, 'PUT', {
          accountId: guest.id,
          role: 'owner',
        })
      ).status,
    ).toBe(400)
    expect((await json(`/v1/organizations/${orgA}/projects`, guest)).body.projects[0].role).toBe('viewer')
    expect(
      (
        await json(`/v1/organizations/${orgA}/projects/${projectA}/members`, guest, 'PUT', {
          accountId: other.id,
          role: 'contributor',
        })
      ).status,
    ).toBe(403)
  })

  it('can switch the browser account without silently revoking an existing desktop session', async () => {
    const query = new URLSearchParams({
      client_id: 'projectos-desktop',
      redirect_uri: 'http://127.0.0.1:54321/callback',
      code_challenge: createHash('sha256').update(randomBytes(32).toString('base64url')).digest('base64url'),
      code_challenge_method: 'S256',
      state: randomBytes(24).toString('base64url'),
    })
    const page = await fetch(baseURL + '/v1/desktop/authorize?' + query, {
      headers: { cookie: owner.cookie },
    })
    const body = await page.text()
    expect(body).toContain('使用其他账号')
    const requestId = /name="request_id" value="([^"]+)"/.exec(body)?.[1]
    const switched = await fetch(baseURL + '/v1/desktop/change-account', {
      method: 'POST',
      redirect: 'manual',
      headers: { origin: baseURL, cookie: owner.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ request_id: requestId! }),
    })
    expect(switched.status).toBe(302)
    expect(switched.headers.getSetCookie().length).toBeGreaterThan(0)
    const next = await fetch(baseURL + switched.headers.get('location'), {
      headers: { cookie: owner.cookie },
    })
    expect(await next.text()).toContain('登录并继续')
    expect((await json('/v1/me', owner)).status).toBe(200)
  })

  it('rejects expired invitations and revoked inviters', async () => {
    const declined = await json(`/v1/organizations/${orgA}/invitations`, owner, 'POST', {
      email: other.email,
      role: 'member',
    })
    expect(
      (
        await json(`/v1/invitations/${declined.body.invitation.id}/decide`, other, 'POST', {
          decision: 'rejected',
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await json(`/v1/invitations/${declined.body.invitation.id}/decide`, other, 'POST', {
          decision: 'accepted',
          invitationCode: declined.body.invitationCode,
        })
      ).status,
    ).toBe(409)
    const invitation = await json(`/v1/organizations/${orgA}/invitations`, owner, 'POST', {
      email: other.email,
      role: 'member',
    })
    await database.pool.query('UPDATE invitation SET "expiresAt"=now()-interval \'1 minute\' WHERE id=$1', [
      invitation.body.invitation.id,
    ])
    expect(
      (
        await json(`/v1/invitations/${invitation.body.invitation.id}/decide`, other, 'POST', {
          decision: 'accepted',
          invitationCode: invitation.body.invitationCode,
        })
      ).status,
    ).toBe(409)
    const member = await database.pool.query(
      'SELECT id FROM member WHERE "userId"=$1 AND "organizationId"=$2',
      [guest.id, orgA],
    )
    expect(
      (
        await json(`/v1/organizations/${orgA}/members/${member.rows[0].id}`, owner, 'PATCH', {
          role: 'admin',
        })
      ).status,
    ).toBe(200)
    const fromGuest = await json(`/v1/organizations/${orgA}/invitations`, guest, 'POST', {
      email: other.email,
      role: 'member',
    })
    expect(fromGuest.status).toBe(201)
    expect(
      (await json(`/v1/organizations/${orgA}/members/${member.rows[0].id}`, owner, 'DELETE')).status,
    ).toBe(200)
    expect(
      (
        await json(`/v1/invitations/${fromGuest.body.invitation.id}/decide`, other, 'POST', {
          decision: 'accepted',
          invitationCode: fromGuest.body.invitationCode,
        })
      ).status,
    ).toBe(409)
    expect((await json(`/v1/organizations/${orgA}/projects`, guest)).status).toBe(403)
    expect(
      (
        await database.pool.query('SELECT id FROM organization_project_members WHERE account_id=$1', [
          guest.id,
        ])
      ).rowCount,
    ).toBe(0)
  })

  it('rechecks membership inside the write transaction after waiting for a lock', async () => {
    const invitation = await json(`/v1/organizations/${orgA}/invitations`, owner, 'POST', {
      email: guest.email,
      role: 'admin',
    })
    expect(
      (
        await json(`/v1/invitations/${invitation.body.invitation.id}/decide`, guest, 'POST', {
          decision: 'accepted',
          invitationCode: invitation.body.invitationCode,
        })
      ).status,
    ).toBe(200)
    const blocker = await database.pool.connect()
    await blocker.query('BEGIN')
    await blocker.query('SELECT id FROM organization WHERE id=$1 FOR UPDATE', [orgA])
    try {
      const pending = json(`/v1/organizations/${orgA}/invitations`, guest, 'POST', {
        email: 'blocked-write@demo.invalid',
        role: 'member',
      })
      let blocked = false
      for (let attempt = 0; attempt < 200; attempt++) {
        const waiting = await database.pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query=$1",
          ['SELECT id FROM organization WHERE id=$1 FOR UPDATE'],
        )
        if (waiting.rowCount) {
          blocked = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(blocked).toBe(true)
      await database.pool.query('DELETE FROM member WHERE "organizationId"=$1 AND "userId"=$2', [
        orgA,
        guest.id,
      ])
      await blocker.query('COMMIT')
      expect((await pending).status).toBe(403)
      expect(
        (
          await database.pool.query('SELECT id FROM invitation WHERE email=$1', [
            'blocked-write@demo.invalid',
          ])
        ).rowCount,
      ).toBe(0)
    } finally {
      await blocker.query('ROLLBACK')
      blocker.release()
    }
  })

  it('revokes desktop sessions persistently and does not expose the vendor membership mutation API', async () => {
    expect((await json('/v1/desktop/revoke', guest, 'POST')).status).toBe(200)
    expect((await json('/v1/me', guest)).status).toBe(401)
    const raw = await fetch(baseURL + '/api/auth/organization/update-member-role', {
      method: 'POST',
      headers: { cookie: owner.cookie, origin: baseURL, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'owner', memberId: 'arbitrary' }),
    })
    expect(raw.status).toBe(403)
    await server.close()
    server = await buildOrganizationServer({ databaseUrl: database.databaseUrl, secret: SECRET, baseURL })
    await server.listen({ port: Number(new URL(baseURL).port), host: '127.0.0.1' })
    expect((await json('/v1/me', guest)).status).toBe(401)
  })

  it('rejects raw vendor API traversal and encoded path aliases before URL normalization can bypass policy', async () => {
    const before = await database.pool.query('SELECT count(*)::int AS count FROM organization')
    for (const path of [
      '/api/auth/./organization/create',
      '/api/auth/x/../organization/create',
      '/api/auth/%2e/organization/create',
      '/api/auth/x/%2e%2e/organization/create',
      '/%61pi/auth/organization/create',
      '//api/auth/organization/create',
      '/api/auth/organization%2fcreate',
      '/api/auth/organization/create',
    ]) {
      const body = JSON.stringify({ name: 'Forbidden Organization', slug: 'forbidden-traversal' })
      const status = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(
          {
            hostname: '127.0.0.1',
            port: Number(new URL(baseURL).port),
            method: 'POST',
            path,
            headers: {
              cookie: other.cookie,
              origin: baseURL,
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(body),
            },
          },
          (response) => {
            response.resume()
            response.on('end', () => resolve(response.statusCode ?? 0))
          },
        )
        request.on('error', reject)
        request.end(body)
      })
      expect([400, 403]).toContain(status)
    }
    const after = await database.pool.query('SELECT count(*)::int AS count FROM organization')
    expect(after.rows[0].count).toBe(before.rows[0].count)
  })

  it('applies checksummed migrations idempotently and rejects tampering', async () => {
    await migrateOrganizationDatabase(database.pool)
    const row = await database.pool.query(
      'SELECT checksum FROM organization_schema_migrations WHERE version=1',
    )
    await database.pool.query('UPDATE organization_schema_migrations SET checksum=$1 WHERE version=1', [
      'tampered',
    ])
    try {
      await expect(migrateOrganizationDatabase(database.pool)).rejects.toThrow('checksum')
    } finally {
      await database.pool.query('UPDATE organization_schema_migrations SET checksum=$1 WHERE version=1', [
        row.rows[0].checksum,
      ])
    }
  })

  it('rate-limits the custom HTTP surface and rejects cross-origin browser forms', async () => {
    const bad = await fetch(baseURL + '/v1/desktop/authorize', {
      method: 'POST',
      headers: { origin: 'https://attacker.invalid', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=x&password=x',
    })
    expect(bad.status).toBe(403)
    const opaqueOrigin = await fetch(baseURL + '/v1/desktop/authorize', {
      method: 'POST',
      headers: { origin: 'null', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=x&password=x',
    })
    expect(opaqueOrigin.status).toBe(403)
    const port = await reserveOrganizationTestPort(),
      origin = `http://127.0.0.1:${port}`
    const limited = await buildOrganizationServer({
      databaseUrl: database.databaseUrl,
      secret: SECRET,
      baseURL: origin,
      rateLimit: { max: 2, authenticationMax: 1, windowMs: 60_000 },
    })
    await limited.listen({ port, host: '127.0.0.1' })
    try {
      expect((await fetch(origin + '/health')).status).toBe(200)
      expect((await fetch(origin + '/health')).status).toBe(200)
      const blocked = await fetch(origin + '/health')
      expect(blocked.status).toBe(429)
      expect(blocked.headers.get('retry-after')).toBeTruthy()
    } finally {
      await limited.close()
    }
  })

  it('never broadens form-action for an unvalidated callback origin or port', async () => {
    const query = new URLSearchParams({
      client_id: 'projectos-desktop',
      code_challenge: 'x'.repeat(43),
      code_challenge_method: 'S256',
      state: 'x'.repeat(24),
    })
    for (const redirect of [
      'http://127.0.0.1:99999/callback',
      'https://attacker.invalid/callback',
      'http://localhost:54321/callback',
      'http://127.0.0.1:54321/callback?next=https://attacker.invalid',
    ]) {
      query.set('redirect_uri', redirect)
      const page = await fetch(baseURL + '/v1/desktop/authorize?' + query)
      expect(page.status).toBe(400)
      expect(page.headers.get('content-security-policy')).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      )
    }
  })
})
