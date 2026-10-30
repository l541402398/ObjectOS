import Fastify, { type FastifyReply } from 'fastify'
import { betterAuth } from 'better-auth'
import { organization } from 'better-auth/plugins'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { z } from 'zod'
import {
  canOrg,
  canProject,
  OrgRoleSchema,
  ProjectRoleSchema,
  type OrgRole,
  type OrgPermission,
} from '@projectos/organization-contracts'
import { mountBetterAuth } from './app.js'
import { registerDesktopAuth } from './desktop-auth.js'
import { AssetScopeError, registerOrganizationAssets } from './assets-api.js'
import { registerOrganizationWorkers } from './workers-api.js'
import {
  assertOrganizationSchema,
  audit,
  inTransaction,
  postgresDirectory,
  postgresTokens,
  ORGANIZATION_SCHEMA_VERSION,
} from './postgres-store.js'

export interface OrganizationServerOptions {
  databaseUrl: string
  secret: string
  baseURL: string
  /** Override only for isolated rate-limit tests. */
  rateLimit?: { max: number; authenticationMax: number; windowMs: number }
}

class ScopeError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function validateOrganizationServerOptions(options: OrganizationServerOptions): void {
  if (!options.databaseUrl || options.secret.length < 32)
    throw new Error('A database URL and a server secret of at least 32 characters are required')
  const url = new URL(options.baseURL)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Organization URL must be an origin without credentials')
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))
    throw new Error('Non-loopback organization servers require HTTPS')
}

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).header('cache-control', 'no-store').send({ error: { code, message } })
}

const OrganizationInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    slug: z
      .string()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict()
const ProjectInput = z
  .object({
    key: z
      .string()
      .min(2)
      .max(16)
      .regex(/^[A-Z][A-Z0-9-]*$/),
    name: z.string().trim().min(1).max(120),
    description: z.string().max(600).default(''),
  })
  .strict()
const InvitationInput = z
  .object({ email: z.email(), role: z.enum(['admin', 'member']).default('member') })
  .strict()
const MemberRoleInput = z.object({ role: z.enum(['admin', 'member']) }).strict()
const ProjectMemberInput = z
  .object({ accountId: z.string().min(1).max(200), role: ProjectRoleSchema.exclude(['owner']) })
  .strict()

function invitationHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
function invitationCodeMatches(value: string, hash: string): boolean {
  const actual = Buffer.from(invitationHash(value), 'hex'),
    expected = Buffer.from(hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** Durable organization control plane. It has no dependency on the local execution kernel. */
export async function buildOrganizationServer(options: OrganizationServerOptions) {
  validateOrganizationServerOptions(options)
  const pool = new Pool({
    connectionString: options.databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  })
  try {
    await assertOrganizationSchema(pool)
  } catch (error) {
    await pool.end()
    throw error
  }
  const baseURL = new URL(options.baseURL).origin
  const auth = betterAuth({
    baseURL,
    secret: options.secret,
    database: pool,
    emailAndPassword: { enabled: true },
    trustedOrigins: [baseURL],
    rateLimit: { enabled: true, window: 60, max: 100 },
    telemetry: { enabled: false },
    plugins: [organization()],
  })
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024, trustProxy: false })
  app.addHook('onClose', async () => {
    await pool.end()
  })
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ScopeError || error instanceof AssetScopeError) return fail(reply, error.status, error.code, error.message)
    if (error instanceof z.ZodError) return fail(reply, 400, 'BAD_REQUEST', '资产内容不符合要求，请检查字段、可见范围及密钥引用。')
    const databaseError = error as { code?: string }
    if (databaseError.code === '23505') return fail(reply, 409, 'CONFLICT', '该标识已存在，请使用其他名称。')
    if ((error as { statusCode?: number }).statusCode === 400)
      return fail(reply, 400, 'BAD_REQUEST', '请求内容不合法。')
    return fail(reply, 500, 'INTERNAL', '组织服务暂时无法完成操作，请稍后重试。')
  })
  const buckets = new Map<string, { startedAt: number; count: number; authentication: number }>()
  const limit = options.rateLimit ?? { max: 300, authenticationMax: 30, windowMs: 60_000 }
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store').header('x-content-type-options', 'nosniff')
    const raw = request.raw.url ?? '/'
    let url: URL
    try {
      url = new URL(raw, baseURL)
    } catch {
      return fail(reply, 400, 'BAD_REQUEST', '请求路径不合法。')
    }
    // Match the exact canonical URL passed to auth.handler below. No registered endpoint needs an
    // encoded path, alternate authority or backslash; reject these ambiguous aliases before routing.
    const rawPath = raw.split('?')[0] ?? ''
    if (url.origin !== baseURL || rawPath.includes('%') || rawPath.includes('\\') || rawPath.startsWith('//'))
      return fail(reply, 400, 'BAD_REQUEST', '请求路径不合法。')
    const path = url.pathname
    // Only browser identity endpoints are exposed from Better Auth. Membership/organization
    // mutations must use our transactional, audited and invitation-code-protected API.
    const browserAuthEndpoints = new Set([
      '/api/auth/sign-up/email',
      '/api/auth/sign-in/email',
      '/api/auth/get-session',
      '/api/auth/sign-out',
    ])
    if (path.startsWith('/api/auth/') && !browserAuthEndpoints.has(path))
      return fail(reply, 403, 'ORG_API_REQUIRED', '请通过组织工作区操作成员与项目。')
    const now = Date.now()
    if (buckets.size >= 10_000)
      for (const [key, bucket] of buckets) if (now - bucket.startedAt >= limit.windowMs) buckets.delete(key)
    let bucket = buckets.get(request.ip)
    if (!bucket || now - bucket.startedAt >= limit.windowMs) {
      if (!bucket && buckets.size >= 10_000)
        return fail(reply, 429, 'RATE_LIMITED', '请求过于频繁，请稍后重试。')
      bucket = { startedAt: now, count: 0, authentication: 0 }
      buckets.set(request.ip, bucket)
    }
    bucket.count++
    if (
      request.method === 'POST' &&
      (path === '/v1/desktop/authorize' || path === '/v1/desktop/token' || path.startsWith('/api/auth/sign-'))
    )
      bucket.authentication++
    if (bucket.count > limit.max || bucket.authentication > limit.authenticationMax) {
      reply.header('retry-after', Math.max(1, Math.ceil((bucket.startedAt + limit.windowMs - now) / 1000)))
      return fail(reply, 429, 'RATE_LIMITED', '请求过于频繁，请稍后重试。')
    }
  })
  mountBetterAuth(app, auth, baseURL)
  const directory = postgresDirectory(pool)
  const desktop = registerDesktopAuth(app, {
    directory,
    tokens: postgresTokens(pool),
    trustedOrigin: baseURL,
    auth: {
      async getSession({ headers }) {
        const session = await auth.api.getSession({ headers })
        return session
          ? { user: { id: session.user.id, name: session.user.name, email: session.user.email } }
          : null
      },
      async signInEmail({ body }) {
        return auth.api.signInEmail({ body, asResponse: true })
      },
      async signUpEmail({ body }) {
        return auth.api.signUpEmail({ body, asResponse: true })
      },
      async signOut({ headers }) {
        return auth.api.signOut({ headers, asResponse: true })
      },
    },
  })
  const accountFor = async (authorization: string | undefined, reply: FastifyReply) => {
    const account = await desktop.authenticateBearer(authorization)
    if (!account) fail(reply, 401, 'UNAUTHENTICATED', '登录已失效，请重新连接组织。')
    return account
  }
  const membershipFor = async (accountId: string, orgId: string, reply: FastifyReply, manage = false) => {
    const membership = await directory.membershipFor(accountId, orgId)
    if (!membership || (manage && !canOrg(membership.role, 'org.manage_members'))) {
      fail(reply, 403, 'ORG_FORBIDDEN', '你没有此组织的访问或管理权限。')
      return null
    }
    return membership
  }
  const lockedOrg = async (client: PoolClient, orgId: string) => {
    const row = await client.query('SELECT id FROM organization WHERE id=$1 FOR UPDATE', [orgId])
    if (!row.rowCount) throw new ScopeError('ORG_FORBIDDEN', 403, '你没有此组织的访问权限。')
  }
  const lockedMembership = async (
    client: PoolClient,
    accountId: string,
    orgId: string,
    permission?: OrgPermission,
  ): Promise<OrgRole> => {
    const result = await client.query(
      'SELECT role FROM member WHERE "userId"=$1 AND "organizationId"=$2 FOR SHARE',
      [accountId, orgId],
    )
    const role = OrgRoleSchema.safeParse(result.rows[0]?.role)
    if (!role.success || (permission && !canOrg(role.data, permission)))
      throw new ScopeError('ORG_FORBIDDEN', 403, '组织权限已改变，请刷新后重试。')
    return role.data
  }
  const orgWrite = async <T>(
    accountId: string,
    orgId: string,
    permission: OrgPermission,
    action: (client: PoolClient, role: OrgRole) => Promise<T>,
  ) =>
    inTransaction(pool, async (client) => {
      await lockedOrg(client, orgId)
      const role = await lockedMembership(client, accountId, orgId, permission)
      return action(client, role)
    })

  app.get('/health', async () => ({
    ok: true,
    service: 'projectos-organization-server',
    storage: 'postgresql',
    schemaVersion: ORGANIZATION_SCHEMA_VERSION,
  }))
  app.post('/v1/organizations', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (!account) return
    const parsed = OrganizationInput.safeParse(request.body)
    if (!parsed.success) return fail(reply, 400, 'BAD_REQUEST', '请输入组织名称和有效标识。')
    const id = randomUUID()
    await inTransaction(pool, async (client) => {
      await client.query('INSERT INTO organization(id,name,slug,"createdAt") VALUES($1,$2,$3,now())', [
        id,
        parsed.data.name,
        parsed.data.slug,
      ])
      await client.query(
        'INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',
        [randomUUID(), id, account.id, 'owner'],
      )
      await audit(client, account.id, id, 'organization.created', id)
    })
    return reply.code(201).send({ organization: { id, ...parsed.data, role: 'owner' } })
  })
  app.get('/v1/organizations/:orgId/projects', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (!account) return
    const { orgId } = request.params as { orgId: string }
    if (!(await membershipFor(account.id, orgId, reply))) return
    const result = await pool.query(
      `SELECT p.id,p.organization_id AS "organizationId",p.key,p.name,p.description,p.status,
      p.created_at::float8 AS "createdAt",p.updated_at::float8 AS "updatedAt",pm.role
      FROM organization_projects p JOIN organization_project_members pm ON pm.project_id=p.id AND pm.organization_id=p.organization_id
      WHERE p.organization_id=$1 AND pm.account_id=$2
      AND EXISTS(SELECT 1 FROM member m WHERE m."organizationId"=$1 AND m."userId"=$2)
      ORDER BY p.updated_at DESC,p.id LIMIT 200`,
      [orgId, account.id],
    )
    return { organizationId: orgId, projects: result.rows }
  })
  app.post('/v1/organizations/:orgId/projects', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (!account) return
    const { orgId } = request.params as { orgId: string }
    const membership = await membershipFor(account.id, orgId, reply)
    if (!membership) return
    if (!canOrg(membership.role, 'org.create_project'))
      return fail(reply, 403, 'ORG_FORBIDDEN', '需要组织管理员授予创建项目的权限。')
    const parsed = ProjectInput.safeParse(request.body)
    if (!parsed.success) return fail(reply, 400, 'BAD_REQUEST', '请输入有效的项目名称和标识。')
    const { key, name, description } = parsed.data
    const id = randomUUID(),
      timestamp = Date.now()
    await orgWrite(account.id, orgId, 'org.create_project', async (client) => {
      await client.query(
        'INSERT INTO organization_projects(id,organization_id,key,name,description,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)',
        [id, orgId, key, name, description, timestamp],
      )
      await client.query(
        'INSERT INTO organization_project_members(id,organization_id,project_id,account_id,role,created_at) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(), orgId, id, account.id, 'owner', timestamp],
      )
      await audit(client, account.id, orgId, 'project.created', id)
    })
    return reply.code(201).send({
      project: {
        id,
        organizationId: orgId,
        key,
        name,
        description,
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
        role: 'owner',
      },
    })
  })
  app.get('/v1/organizations/:orgId/members', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (!account) return
    const { orgId } = request.params as { orgId: string }
    if (!(await membershipFor(account.id, orgId, reply))) return
    const result = await pool.query(
      `SELECT m.id,m."userId" AS "accountId",u.name,u.email,m.role FROM member m
      JOIN "user" u ON u.id=m."userId" WHERE m."organizationId"=$1
      AND EXISTS(SELECT 1 FROM member actor WHERE actor."organizationId"=$1 AND actor."userId"=$2)
      ORDER BY m."createdAt",m.id LIMIT 200`,
      [orgId, account.id],
    )
    return { members: result.rows }
  })
  app.post('/v1/organizations/:orgId/invitations', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (!account) return
    const { orgId } = request.params as { orgId: string }
    const membership = await membershipFor(account.id, orgId, reply, true)
    if (!membership) return
    const parsed = InvitationInput.safeParse(request.body)
    if (!parsed.success) return fail(reply, 400, 'BAD_REQUEST', '请输入有效邮箱。')
    if (parsed.data.role === 'admin' && membership.role !== 'owner')
      return fail(reply, 403, 'ORG_FORBIDDEN', '只有组织所有者可以邀请管理员。')
    const invitation = {
      id: randomUUID(),
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      status: 'pending',
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    }
    // Email is a login identifier in this slice, not proof of ownership. The recipient must also
    // receive this independent random grant from the inviter through a trusted channel.
    const invitationCode = randomBytes(32).toString('base64url')
    await orgWrite(account.id, orgId, 'org.manage_members', async (client, role) => {
      if (invitation.role === 'admin' && role !== 'owner')
        throw new ScopeError('ORG_FORBIDDEN', 403, '只有组织所有者可以邀请管理员。')
      await client.query(
        'INSERT INTO invitation(id,"organizationId",email,role,status,"expiresAt","inviterId") VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          invitation.id,
          orgId,
          invitation.email,
          invitation.role,
          'pending',
          new Date(invitation.expiresAt),
          account.id,
        ],
      )
      await client.query('INSERT INTO organization_invitation_codes(invitation_id,code_hash) VALUES($1,$2)', [
        invitation.id,
        invitationHash(invitationCode),
      ])
      await audit(client, account.id, orgId, 'member.invited', invitation.id, { role: invitation.role })
    })
    return reply.code(201).send({ invitation, invitationCode })
  })
  app.get('/v1/invitations', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (!account) return
    const result = await pool.query(
      `SELECT i.id,i."organizationId" AS "organizationId",o.name AS "organizationName",i.role,
      extract(epoch from i."expiresAt")*1000 AS "expiresAt" FROM invitation i JOIN organization o ON o.id=i."organizationId"
      WHERE lower(i.email)=lower($1) AND i.status='pending' AND i."expiresAt">now() ORDER BY i.id LIMIT 100`,
      [account.email],
    )
    return { invitations: result.rows.map((row) => ({ ...row, expiresAt: Number(row.expiresAt) })) }
  })
  app.post('/v1/invitations/:invitationId/decide', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (!account) return
    const { invitationId } = request.params as { invitationId: string }
    const parsed = z
      .object({
        decision: z.enum(['accepted', 'rejected']),
        invitationCode: z
          .string()
          .regex(/^[A-Za-z0-9_-]{43}$/)
          .optional(),
      })
      .strict()
      .refine((value) => value.decision !== 'accepted' || Boolean(value.invitationCode))
      .safeParse(request.body)
    if (!parsed.success) return fail(reply, 400, 'BAD_REQUEST', '请选择接受或拒绝邀请。')
    const outcome = await inTransaction(pool, async (client) => {
      const scope = await client.query(
        'SELECT "organizationId" FROM invitation WHERE id=$1 AND lower(email)=lower($2)',
        [invitationId, account.email],
      )
      if (!scope.rows[0]) return false
      await lockedOrg(client, scope.rows[0].organizationId)
      const result = await client.query(
        `SELECT "organizationId",role,"inviterId" FROM invitation WHERE id=$1 AND lower(email)=lower($2)
        AND status='pending' AND "expiresAt">now() FOR UPDATE`,
        [invitationId, account.email],
      )
      const invitation = result.rows[0]
      if (!invitation) return false
      if (parsed.data.decision === 'accepted') {
        const grant = await client.query(
          'SELECT code_hash FROM organization_invitation_codes WHERE invitation_id=$1 FOR UPDATE',
          [invitationId],
        )
        if (!grant.rows[0] || !invitationCodeMatches(parsed.data.invitationCode!, grant.rows[0].code_hash))
          throw new ScopeError('INVITATION_CODE_INVALID', 403, '邀请代码不正确，请向邀请人确认。')
      }
      // A removed inviter cannot leave a usable grant behind.
      const inviter = await client.query(
        'SELECT role FROM member WHERE "organizationId"=$1 AND "userId"=$2',
        [invitation.organizationId, invitation.inviterId],
      )
      if (
        parsed.data.decision === 'accepted' &&
        !inviter.rows.some(
          (row) => row.role === 'owner' || (row.role === 'admin' && invitation.role === 'member'),
        )
      )
        return false
      if (!['admin', 'member'].includes(invitation.role)) return false
      if (parsed.data.decision === 'accepted')
        await client.query(
          `INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now()) ON CONFLICT DO NOTHING`,
          [randomUUID(), invitation.organizationId, account.id, invitation.role],
        )
      await client.query('UPDATE invitation SET status=$2 WHERE id=$1', [invitationId, parsed.data.decision])
      await client.query('DELETE FROM organization_invitation_codes WHERE invitation_id=$1', [invitationId])
      await audit(
        client,
        account.id,
        invitation.organizationId,
        `invitation.${parsed.data.decision}`,
        invitationId,
      )
      return true
    })
    if (!outcome) return fail(reply, 409, 'INVITATION_UNAVAILABLE', '邀请已失效、已处理或不属于当前账号。')
    return { ok: true }
  })
  app.patch('/v1/organizations/:orgId/members/:memberId', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (!account) return
    const { orgId, memberId } = request.params as { orgId: string; memberId: string }
    const actor = await membershipFor(account.id, orgId, reply, true)
    if (!actor) return
    if (actor.role !== 'owner') return fail(reply, 403, 'ORG_FORBIDDEN', '只有组织所有者可以调整角色。')
    const parsed = MemberRoleInput.safeParse(request.body)
    if (!parsed.success) return fail(reply, 400, 'BAD_REQUEST', '请选择有效的成员角色。')
    const changed = await orgWrite(account.id, orgId, 'org.manage_members', async (client, role) => {
      if (role !== 'owner') throw new ScopeError('ORG_FORBIDDEN', 403, '只有组织所有者可以调整角色。')
      const result = await client.query(
        'UPDATE member SET role=$3 WHERE id=$1 AND "organizationId"=$2 AND role<>$4 RETURNING id',
        [memberId, orgId, parsed.data.role, 'owner'],
      )
      if (!result.rowCount) return false
      await audit(client, account.id, orgId, 'member.role_changed', memberId, { role: parsed.data.role })
      return true
    })
    return changed ? { ok: true } : fail(reply, 409, 'CONFLICT', '成员不存在或为组织所有者。')
  })
  app.delete('/v1/organizations/:orgId/members/:memberId', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (!account) return
    const { orgId, memberId } = request.params as { orgId: string; memberId: string }
    const actor = await membershipFor(account.id, orgId, reply, true)
    if (!actor) return
    const removed = await orgWrite(account.id, orgId, 'org.manage_members', async (client, role) => {
      const result = await client.query(
        `DELETE FROM member WHERE id=$1 AND "organizationId"=$2 AND role<>'owner'
        AND ($3='owner' OR role='member') RETURNING "userId"`,
        [memberId, orgId, role],
      )
      if (!result.rows[0]) return false
      await client.query(
        'DELETE FROM organization_project_members WHERE organization_id=$1 AND account_id=$2',
        [orgId, result.rows[0].userId],
      )
      await audit(client, account.id, orgId, 'member.removed', memberId)
      return true
    })
    return removed ? { ok: true } : fail(reply, 409, 'CONFLICT', '成员不存在，或当前角色不能移除此成员。')
  })
  app.put('/v1/organizations/:orgId/projects/:projectId/members', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (!account) return
    const { orgId, projectId } = request.params as { orgId: string; projectId: string }
    if (!(await membershipFor(account.id, orgId, reply))) return
    const parsed = ProjectMemberInput.safeParse(request.body)
    if (!parsed.success) return fail(reply, 400, 'BAD_REQUEST', '请选择项目成员与角色。')
    const actor = await pool.query(
      'SELECT role FROM organization_project_members WHERE organization_id=$1 AND project_id=$2 AND account_id=$3',
      [orgId, projectId, account.id],
    )
    const role = ProjectRoleSchema.safeParse(actor.rows[0]?.role)
    if (!role.success || !canProject(role.data, 'project.manage_members'))
      return fail(reply, 403, 'PROJECT_FORBIDDEN', '你没有管理此项目成员的权限。')
    if (!(await directory.membershipFor(parsed.data.accountId, orgId)))
      return fail(reply, 403, 'RESOURCE_NOT_IN_SCOPE', '目标账号不是当前组织成员。')
    if (parsed.data.accountId === account.id)
      return fail(reply, 409, 'CONFLICT', '不能通过此操作修改自己的项目权限。')
    await orgWrite(account.id, orgId, 'org.view', async (client) => {
      const current = await client.query(
        'SELECT role FROM organization_project_members WHERE organization_id=$1 AND project_id=$2 AND account_id=$3 FOR UPDATE',
        [orgId, projectId, account.id],
      )
      const currentRole = ProjectRoleSchema.safeParse(current.rows[0]?.role)
      if (!currentRole.success || !canProject(currentRole.data, 'project.manage_members'))
        throw new ScopeError('PROJECT_FORBIDDEN', 403, '项目权限已改变，请刷新后重试。')
      await lockedMembership(client, parsed.data.accountId, orgId)
      const target = await client.query(
        'SELECT role FROM organization_project_members WHERE organization_id=$1 AND project_id=$2 AND account_id=$3',
        [orgId, projectId, parsed.data.accountId],
      )
      if (target.rows[0]?.role === 'owner')
        throw new ScopeError('CONFLICT', 409, '项目所有者需通过独立的所有权转移流程变更。')
      await client.query(
        `INSERT INTO organization_project_members(id,organization_id,project_id,account_id,role,created_at)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id,account_id) DO UPDATE SET role=excluded.role`,
        [randomUUID(), orgId, projectId, parsed.data.accountId, parsed.data.role, Date.now()],
      )
      await audit(client, account.id, orgId, 'project.member_changed', projectId, {
        accountId: parsed.data.accountId,
        role: parsed.data.role,
      })
    })
    return { ok: true }
  })
  registerOrganizationAssets(app, pool, accountFor)
  registerOrganizationWorkers(app, pool, accountFor)
  return app
}
