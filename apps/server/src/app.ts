/**
 * ProjectOS organization control-plane server — A0 PoC.
 *
 * Proves on the real stack (Fastify 5 + better-auth 1.7 memory adapter) that:
 *  - better-auth can be mounted under `/api/auth/*` inside Fastify by converting the Fastify
 *    request into a Web `Request` and copying status/headers (including multiple `set-cookie`)
 *    and body back;
 *  - organization membership comes from better-auth's organization plugin data, not from a URL;
 *  - every organization/project route enforces scope server-side, with an opaque desktop bearer
 *    token (never a browser session cookie) as the only credential;
 *  - the desktop loopback + PKCE login can obtain that token without a token ever entering a URL.
 *
 * NOT production: the memory adapter stores everything in this process, rate limiting is disabled,
 * and there is no PostgreSQL. See apps/server/README.md for the A1 migration plan.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { betterAuth } from 'better-auth'
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory'
import { organization } from 'better-auth/plugins'
import { z } from 'zod'
import {
  assertProjectAccess,
  canOrg,
  type OrgRole,
} from '@projectos/organization-contracts'
import {
  registerDesktopAuth,
  type AccountOrganization,
  type AuthDirectory,
  type AuthClient,
  type DesktopAccount,
  type DesktopAuthHandle,
  type MembershipRecord,
} from './desktop-auth.js'
import {
  createProject,
  createRequirement,
  createStore,
  findProject,
  listProjectsForOrganization,
  listRequirementsForProject,
  type Store,
} from './store.js'

export const DEFAULT_BASE_URL = 'http://127.0.0.1:4310'

/**
 * Development-only fallback secret. `index.ts` forwards `BETTER_AUTH_SECRET`; tests call
 * `buildServer({ secret })` explicitly. A short/absent secret must never reach a deployed server,
 * which is why the A0 README lists it as a blocker for A1.
 */
const DEV_FALLBACK_SECRET = 'projectos-a0-poc-development-only-secret-do-not-deploy'

export interface BuildServerOptions {
  secret?: string
  baseURL?: string
}

/** Row shapes the memory adapter stores for the better-auth models we read. */
interface UserRow {
  id: string
  name: string
  email: string
}

interface OrganizationRow {
  id: string
  name: string
  slug: string
}

interface MemberRow {
  id: string
  organizationId: string
  userId: string
  role: string
}

const ORG_ROLE_PRECEDENCE: readonly OrgRole[] = ['owner', 'admin', 'member']

/** Fail closed: a custom/unknown role grants no organization permission in this PoC. */
function normalizeOrgRole(role: string): OrgRole | null {
  const roles = role
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  for (const candidate of ORG_ROLE_PRECEDENCE) {
    if (roles.includes(candidate)) return candidate
  }
  return null
}

/**
 * Read-only directory over better-auth's own memory DB object.
 *
 * This is the documented `membershipFor` source of truth: the organization role is read from the
 * member rows the organization plugin wrote, never inferred from a path parameter. When the Drizzle
 * + PostgreSQL adapter lands in A1, only this factory changes (adapter queries instead of arrays);
 * the route contracts above it do not.
 */
function createAuthDirectory(db: MemoryDB): AuthDirectory {
  const userRows = (): UserRow[] => (db.user ?? []) as UserRow[]
  const organizationRows = (): OrganizationRow[] => (db.organization ?? []) as OrganizationRow[]
  const memberRows = (): MemberRow[] => (db.member ?? []) as MemberRow[]

  return {
    async accountById(accountId: string): Promise<DesktopAccount | null> {
      const row = userRows().find((user) => user.id === accountId)
      if (!row) return null
      return { id: row.id, name: row.name, email: row.email }
    },

    /** Internal helper: the caller's role in one organization, or null when not a member. */
    async membershipFor(accountId: string, organizationId: string): Promise<MembershipRecord | null> {
      const row = memberRows().find(
        (member) => member.userId === accountId && member.organizationId === organizationId,
      )
      if (!row) return null
      const role = normalizeOrgRole(row.role)
      if (!role) return null
      return { memberId: row.id, role }
    },

    async organizationsFor(accountId: string): Promise<AccountOrganization[]> {
      const organizations: AccountOrganization[] = []
      for (const member of memberRows()) {
        if (member.userId !== accountId) continue
        const role = normalizeOrgRole(member.role)
        if (!role) continue
        const row = organizationRows().find((candidate) => candidate.id === member.organizationId)
        if (!row) continue
        organizations.push({ id: row.id, name: row.name, slug: row.slug, role })
      }
      return organizations.sort((left, right) => left.name.localeCompare(right.name))
    },
  }
}

const CreateProjectBodySchema = z
  .object({
    key: z
      .string()
      .min(2)
      .max(16)
      .regex(/^[A-Z][A-Z0-9-]*$/, 'project key 例如 OSP、WS-SDK'),
    name: z.string().min(1).max(120),
    description: z.string().max(600).optional(),
  })
  .strict()

const CreateRequirementBodySchema = z
  .object({
    title: z.string().min(1).max(200),
  })
  .strict()

function scopedError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
): FastifyReply {
  return reply.code(statusCode).header('cache-control', 'no-store').send({ error: { code, message } })
}

function bearerChallenge(reply: FastifyReply): FastifyReply {
  reply.header('www-authenticate', 'Bearer realm="projectos"')
  return scopedError(reply, 401, 'UNAUTHENTICATED', 'a valid bearer token is required')
}

interface ScopedRouteDependencies {
  store: Store
  desktopAuth: DesktopAuthHandle
  directory: AuthDirectory
}

/**
 * Organization-scoped routes. The server — not the renderer — decides scope: the path parameter is
 * only a lookup key, and the account's better-auth organization membership is checked first.
 */
function registerOrganizationRoutes(
  app: FastifyInstance,
  deps: ScopedRouteDependencies,
): void {
  app.get('/v1/organizations/:orgId/projects', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const account = await deps.desktopAuth.authenticateBearer(request.headers.authorization)
    if (!account) return bearerChallenge(reply)
    const { orgId } = request.params as { orgId: string }

    const membership = await deps.directory.membershipFor(account.id, orgId)
    if (!membership) {
      return scopedError(reply, 403, 'ORG_FORBIDDEN', 'account is not an active member of this organization')
    }
    return reply.send({
      organizationId: orgId,
      role: membership.role,
      projects: listProjectsForOrganization(deps.store, orgId),
    })
  })

  app.post('/v1/organizations/:orgId/projects', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const account = await deps.desktopAuth.authenticateBearer(request.headers.authorization)
    if (!account) return bearerChallenge(reply)
    const { orgId } = request.params as { orgId: string }

    const membership = await deps.directory.membershipFor(account.id, orgId)
    if (!membership) {
      return scopedError(reply, 403, 'ORG_FORBIDDEN', 'account is not an active member of this organization')
    }
    if (!canOrg(membership.role, 'org.create_project')) {
      return scopedError(reply, 403, 'ORG_FORBIDDEN', 'organization role lacks org.create_project')
    }

    const body = CreateProjectBodySchema.safeParse(request.body)
    if (!body.success) {
      return scopedError(reply, 400, 'invalid_request', 'invalid project payload')
    }
    const project = createProject(deps.store, {
      organizationId: orgId,
      key: body.data.key,
      name: body.data.name,
      ...(body.data.description === undefined ? {} : { description: body.data.description }),
      createdByAccountId: account.id,
    })
    return reply.code(201).send({ project })
  })

  app.get('/v1/projects/:projectId/requirements', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const account = await deps.desktopAuth.authenticateBearer(request.headers.authorization)
    if (!account) return bearerChallenge(reply)
    const { projectId } = request.params as { projectId: string }

    const project = findProject(deps.store, projectId)
    if (!project) return scopedError(reply, 404, 'NOT_FOUND', 'project not found')

    const access = assertProjectAccess(
      deps.store.projectMemberships,
      project.id,
      account.id,
      'project.view',
    )
    if (!access.ok) {
      return scopedError(reply, 403, 'PROJECT_FORBIDDEN', 'account has no project.view permission')
    }
    return reply.send({
      projectId: project.id,
      organizationId: project.organizationId,
      requirements: listRequirementsForProject(deps.store, project.organizationId, project.id),
    })
  })

  // Write route kept minimal: it exists so the PoC can prove a project permission is enforced on
  // write as well, and so tests can seed requirements through the public API instead of internals.
  app.post('/v1/projects/:projectId/requirements', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const account = await deps.desktopAuth.authenticateBearer(request.headers.authorization)
    if (!account) return bearerChallenge(reply)
    const { projectId } = request.params as { projectId: string }

    const project = findProject(deps.store, projectId)
    if (!project) return scopedError(reply, 404, 'NOT_FOUND', 'project not found')

    const access = assertProjectAccess(
      deps.store.projectMemberships,
      project.id,
      account.id,
      'project.write_requirement',
    )
    if (!access.ok) {
      return scopedError(reply, 403, 'PROJECT_FORBIDDEN', 'account has no project.write_requirement permission')
    }
    const body = CreateRequirementBodySchema.safeParse(request.body)
    if (!body.success) {
      return scopedError(reply, 400, 'invalid_request', 'invalid requirement payload')
    }
    const requirement = createRequirement(deps.store, {
      organizationId: project.organizationId,
      projectId: project.id,
      title: body.data.title,
    })
    return reply.code(201).send({ requirement })
  })
}

/** Mounts better-auth's Web-standard handler under Fastify at `/api/auth/*`. */
export function mountBetterAuth(app: FastifyInstance, auth: { handler: (request: Request) => Promise<Response> }, baseURL: string): void {
  const rawJsonBodies = new WeakMap<FastifyRequest, string>()

  // Capture the raw JSON text: better-auth expects to parse the body itself (it also signs it for
  // some endpoints), so we cannot forward a re-serialized object.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    if (typeof body === 'string') rawJsonBodies.set(request, body)
    if (typeof body !== 'string' || body.length === 0) {
      done(null, undefined)
      return
    }
    try {
      done(null, JSON.parse(body) as unknown)
    } catch (error) {
      done(error as Error, undefined)
    }
  })

  // Fastify has no built-in form parser; the desktop login/consent forms are urlencoded.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, typeof body === 'string' ? body : '')
    },
  )

  app.all('/api/auth/*', async (request, reply) => {
    const headers = new Headers()
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined) continue
      if (name === 'host' || name === 'content-length' || name === 'connection') continue
      if (Array.isArray(value)) {
        for (const item of value) headers.append(name, item)
      } else {
        headers.set(name, value)
      }
    }

    const method = request.method.toUpperCase()
    const rawBody = rawJsonBodies.get(request)
    const webRequest = new Request(new URL(request.raw.url ?? '/', baseURL), {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : rawBody,
    })

    const webResponse = await auth.handler(webRequest)

    for (const [name, value] of webResponse.headers) {
      if (name === 'set-cookie') continue
      if (name === 'content-length' || name === 'content-encoding' || name === 'transfer-encoding') continue
      reply.header(name, value)
    }
    const setCookies = webResponse.headers.getSetCookie()
    if (setCookies.length > 0) reply.header('set-cookie', setCookies)

    const responseBody = await webResponse.text()
    reply.code(webResponse.status)
    return responseBody.length === 0 ? reply.send() : reply.send(responseBody)
  })
}

/** Builds an isolated server instance: memory DB, store, token table and routes are all per call. */
export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const baseURL = options.baseURL ?? DEFAULT_BASE_URL

  // A fresh object per buildServer call: tests must never share accounts or organizations.
  const db: MemoryDB = {
    user: [],
    session: [],
    account: [],
    verification: [],
    organization: [],
    member: [],
    invitation: [],
  }

  const auth = betterAuth({
    baseURL,
    secret: options.secret ?? DEV_FALLBACK_SECRET,
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    trustedOrigins: [baseURL],
    // Disabled for the PoC: a shared in-memory limiter would make tests order-dependent, and there
    // is no trusted proxy configuration yet. A1 must enable it with a persistent store.
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    plugins: [organization()],
  })

  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 })
  mountBetterAuth(app, auth, baseURL)

  const directory = createAuthDirectory(db)
  const store = createStore()

  const authClient: AuthClient = {
    async getSession({ headers }) {
      const session = await auth.api.getSession({ headers })
      if (!session) return null
      return {
        user: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
        },
      }
    },
    async signInEmail({ body }) {
      return auth.api.signInEmail({ body, asResponse: true })
    },
    async signUpEmail({ body }) {
      return auth.api.signUpEmail({ body, asResponse: true })
    },
    async signOut({ headers }) {
      return auth.api.signOut({ headers, asResponse:true })
    },
  }

  const desktopAuth = registerDesktopAuth(app, { auth: authClient, directory, trustedOrigin:baseURL })
  registerOrganizationRoutes(app, { store, directory, desktopAuth })

  app.get('/health', async () => ({ ok: true, service: 'projectos-organization-server', baseURL }))

  return app
}
