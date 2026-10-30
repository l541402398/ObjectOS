import { createHash } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import {
  OrgRoleSchema,
  ProjectRoleSchema,
  WorkerEnrollmentSchema,
  WorkerStateInputSchema,
  WorkerGrantInputSchema,
  WorkerServerListSchema,
} from '@projectos/organization-contracts'
import { AssetScopeError } from './assets-api.js'
import { audit, inTransaction } from './postgres-store.js'

const denied = () => new AssetScopeError(403, 'WORKER_FORBIDDEN', '当前账号、设备或项目不具备此权限。')
const conflict = () => new AssetScopeError(409, 'WORKER_CONFLICT', '设备或授权已改变，请刷新后重试。')
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const sessionDigest = (value: string) => createHash('sha256').update(value).digest('base64url')
const uuid = z.uuid()

export class OrganizationWorkers {
  constructor(private readonly pool: Pool) {}

  private scope<T>(
    orgId: string,
    accountId: string,
    session: string,
    action: (client: PoolClient, role: string) => Promise<T>,
  ) {
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT id FROM organization WHERE id=$1 FOR UPDATE', [orgId])
      const member = await client.query(
        'SELECT role FROM member WHERE "organizationId"=$1 AND "userId"=$2 FOR SHARE',
        [orgId, accountId],
      )
      const activeSession = await client.query(
        'SELECT token_hash FROM desktop_sessions WHERE token_hash=$1 AND account_id=$2 AND revoked_at IS NULL AND expires_at>$3 FOR SHARE',
        [session, accountId, Date.now()],
      )
      const role = OrgRoleSchema.safeParse(member.rows[0]?.role)
      if (!role.success || !activeSession.rowCount) throw denied()
      return action(client, role.data)
    })
  }

  private async device(client: PoolClient, orgId: string, workerId: string, secret: string, owner?: string) {
    const row = (
      await client.query(
        `SELECT w.* FROM organization_workers w
      JOIN desktop_sessions s ON s.token_hash=w.desktop_session_hash
      JOIN member m ON m."organizationId"=w.organization_id AND m."userId"=w.owner_id
      WHERE w.organization_id=$1 AND w.id=$2 AND w.secret_hash=$3 AND w.state='active'
      AND s.revoked_at IS NULL AND s.expires_at>$4 FOR UPDATE OF w FOR SHARE OF s,m`,
        [orgId, workerId, digest(secret), Date.now()],
      )
    ).rows[0]
    if (!row || (owner && row.owner_id !== owner)) throw denied()
    return row
  }

  async enroll(orgId: string, accountId: string, session: string, raw: unknown) {
    const input = WorkerEnrollmentSchema.parse(raw)
    return this.scope(orgId, accountId, session, async (client) => {
      const existing = (
        await client.query('SELECT * FROM organization_workers WHERE id=$1 FOR UPDATE', [
          input.registrationId,
        ])
      ).rows[0]
      if (existing) {
        if (
          existing.organization_id !== orgId ||
          existing.owner_id !== accountId ||
          existing.instance_id !== input.instanceId ||
          existing.secret_hash !== digest(input.secret) ||
          existing.state === 'revoked'
        )
          throw denied()
        // Same id/proof is a retry, never a second device. A new login can renew only its own proof.
        await client.query(
          `UPDATE organization_workers SET desktop_session_hash=$2,name=$3,
          revision=revision+CASE WHEN desktop_session_hash<>$2 OR name<>$3 THEN 1 ELSE 0 END WHERE id=$1`,
          [input.registrationId, session, input.name],
        )
        if (existing.desktop_session_hash !== session || existing.name !== input.name)
          await audit(client, accountId, orgId, 'worker.renewed', input.registrationId, {})
      } else {
        const count = await client.query(
          'SELECT count(*)::int AS count FROM organization_workers WHERE organization_id=$1',
          [orgId],
        )
        if (count.rows[0].count >= 200) throw conflict()
        await client.query(
          `INSERT INTO organization_workers(id,organization_id,owner_id,desktop_session_hash,instance_id,secret_hash,name,platform,protocol,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            input.registrationId,
            orgId,
            accountId,
            session,
            input.instanceId,
            digest(input.secret),
            input.name,
            input.platform,
            input.protocol,
            Date.now(),
          ],
        )
        await audit(client, accountId, orgId, 'worker.enrolled', input.registrationId, {
          protocol: input.protocol,
          platform: input.platform,
        })
      }
      return { ok: true }
    })
  }

  async list(orgId: string, accountId: string, session: string) {
    return this.scope(orgId, accountId, session, async (client, role) => {
      const now = Date.now()
      const workers = (
        await client.query(
          `SELECT w.id,w.organization_id AS "organizationId",w.owner_id AS "ownerId",u.name AS "ownerName",w.name,w.platform,w.protocol,w.state,w.revision,
        w.last_seen_at::float8 AS "lastSeenAt",w.created_at::float8 AS "createdAt",s.revoked_at,s.expires_at::float8 AS session_expiry,m.id AS membership
        FROM organization_workers w JOIN "user" u ON u.id=w.owner_id JOIN desktop_sessions s ON s.token_hash=w.desktop_session_hash
        LEFT JOIN member m ON m."organizationId"=w.organization_id AND m."userId"=w.owner_id
        WHERE w.organization_id=$1 ORDER BY w.created_at,w.id LIMIT 200`,
          [orgId],
        )
      ).rows.map(({ revoked_at, session_expiry, membership, ...w }) => ({
        ...w,
        status:
          w.state === 'revoked'
            ? 'revoked'
            : revoked_at || session_expiry <= now || !membership
              ? 'session_expired'
              : w.state === 'paused'
                ? 'paused'
                : w.lastSeenAt && now - w.lastSeenAt <= 20_000
                  ? 'online'
                  : 'offline',
        canManage: w.ownerId === accountId || role === 'owner' || role === 'admin',
        executionReady: false,
      }))
      // A local consent is visible only to its owner and the project's actual members.
      const grants = (
        await client.query(
          `SELECT g.id,g.worker_id AS "workerId",g.project_id AS "projectId",p.name AS "projectName",g.workspace_ref AS "workspaceRef",g.scope,g.scope_digest AS "scopeDigest",g.expires_at::float8 AS "expiresAt",g.created_at::float8 AS "createdAt",g.revoked_at,
        p.status AS project_status,pm.role AS project_role FROM organization_worker_grants g
        JOIN organization_workers w ON w.organization_id=g.organization_id AND w.id=g.worker_id
        JOIN organization_projects p ON p.organization_id=g.organization_id AND p.id=g.project_id
        JOIN organization_project_members pm ON pm.organization_id=g.organization_id AND pm.project_id=g.project_id AND pm.account_id=$2
        WHERE g.organization_id=$1 AND w.owner_id=$2 ORDER BY g.created_at DESC,g.id LIMIT 200`,
          [orgId, accountId],
        )
      ).rows.map(({ revoked_at, project_status, project_role, ...g }) => ({
        ...g,
        status: revoked_at
          ? 'revoked'
          : g.expiresAt <= now
            ? 'expired'
            : project_status !== 'active' ||
                !['owner', 'maintainer', 'contributor'].includes(project_role) ||
                workers.find((w) => w.id === g.workerId)?.status !== 'online'
              ? 'unavailable'
              : 'active',
      }))
      return WorkerServerListSchema.parse({ workers, grants })
    })
  }

  async change(orgId: string, accountId: string, session: string, raw: unknown, proof?: string) {
    const input = WorkerStateInputSchema.parse(raw)
    return this.scope(orgId, accountId, session, async (client, role) => {
      const w = (
        await client.query(
          'SELECT * FROM organization_workers WHERE organization_id=$1 AND id=$2 FOR UPDATE',
          [orgId, input.workerId],
        )
      ).rows[0]
      if (!w || (w.owner_id !== accountId && !['owner', 'admin'].includes(role))) throw denied()
      if (w.state === 'revoked' || w.revision !== input.expectedRevision) throw conflict()
      // Resuming cannot be done by an administrator remotely, or with only an account token.
      if (
        input.state === 'active' &&
        (w.owner_id !== accountId ||
          !proof ||
          digest(proof) !== w.secret_hash ||
          w.desktop_session_hash !== session)
      )
        throw denied()
      await client.query(
        'UPDATE organization_workers SET state=$2,revision=revision+1,last_seen_at=NULL WHERE id=$1',
        [input.workerId, input.state],
      )
      if (input.state !== 'active')
        await client.query(
          'UPDATE organization_worker_grants SET revoked_at=COALESCE(revoked_at,$2) WHERE worker_id=$1',
          [input.workerId, Date.now()],
        )
      await audit(client, accountId, orgId, `worker.${input.state}`, input.workerId, {})
      return { ok: true }
    })
  }

  async heartbeat(orgId: string, workerId: string, secret: string) {
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT id FROM organization WHERE id=$1 FOR UPDATE', [orgId])
      await this.device(client, orgId, workerId, secret)
      await client.query('UPDATE organization_workers SET last_seen_at=$2 WHERE id=$1', [
        workerId,
        Date.now(),
      ])
      return { ok: true, executionReady: false }
    })
  }

  async grant(orgId: string, workerId: string, secret: string, raw: unknown) {
    const input = WorkerGrantInputSchema.parse(raw)
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT id FROM organization WHERE id=$1 FOR UPDATE', [orgId])
      const w = await this.device(client, orgId, workerId, secret)
      const project = (
        await client.query(
          `SELECT pm.role FROM organization_project_members pm JOIN organization_projects p ON p.organization_id=pm.organization_id AND p.id=pm.project_id
        WHERE pm.organization_id=$1 AND pm.project_id=$2 AND pm.account_id=$3 AND p.status='active' FOR SHARE OF p,pm`,
          [orgId, input.projectId, w.owner_id],
        )
      ).rows[0]
      const role = ProjectRoleSchema.safeParse(project?.role)
      if (!role.success || !['owner', 'maintainer', 'contributor'].includes(role.data)) throw denied()
      if (input.expiresAt <= Date.now() || input.expiresAt > Date.now() + 24 * 60 * 60_000) throw conflict()
      const existing = (
        await client.query('SELECT * FROM organization_worker_grants WHERE id=$1 FOR UPDATE', [input.id])
      ).rows[0]
      if (existing) {
        if (
          existing.worker_id !== workerId ||
          existing.organization_id !== orgId ||
          existing.project_id !== input.projectId ||
          existing.workspace_ref !== input.workspaceRef ||
          existing.scope_digest !== input.scopeDigest ||
          Number(existing.expires_at) !== input.expiresAt ||
          JSON.stringify(existing.scope.directories) !== JSON.stringify(input.scope.directories) ||
          JSON.stringify(existing.scope.tools) !== JSON.stringify(input.scope.tools) ||
          existing.scope.maxToolCalls !== input.scope.maxToolCalls ||
          existing.revoked_at
        )
          throw conflict()
      } else {
        if (
          (
            await client.query(
              'SELECT count(*)::int AS n FROM organization_worker_grants WHERE worker_id=$1',
              [workerId],
            )
          ).rows[0].n >= 200
        )
          throw conflict()
        await client.query(
          `INSERT INTO organization_worker_grants(id,organization_id,worker_id,project_id,workspace_ref,scope,scope_digest,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            input.id,
            orgId,
            workerId,
            input.projectId,
            input.workspaceRef,
            JSON.stringify(input.scope),
            input.scopeDigest,
            input.expiresAt,
            Date.now(),
          ],
        )
        await audit(client, w.owner_id, orgId, 'worker.granted', input.id, {
          workerId,
          projectId: input.projectId,
          expiresAt: input.expiresAt,
          scopeDigest: input.scopeDigest,
        })
      }
      return { ok: true }
    })
  }

  async revokeGrant(orgId: string, accountId: string, session: string, grantId: string) {
    uuid.parse(grantId)
    return this.scope(orgId, accountId, session, async (client, role) => {
      const grant = (
        await client.query(
          `SELECT g.id,w.owner_id FROM organization_worker_grants g JOIN organization_workers w ON w.id=g.worker_id
        WHERE g.organization_id=$1 AND g.id=$2 FOR UPDATE OF g`,
          [orgId, grantId],
        )
      ).rows[0]
      if (!grant || (grant.owner_id !== accountId && !['owner', 'admin'].includes(role))) throw denied()
      await client.query(
        'UPDATE organization_worker_grants SET revoked_at=COALESCE(revoked_at,$2) WHERE id=$1',
        [grantId, Date.now()],
      )
      await audit(client, accountId, orgId, 'worker.grant_revoked', grantId, {})
      return { ok: true }
    })
  }
}

export function registerOrganizationWorkers(
  app: FastifyInstance,
  pool: Pool,
  accountFor: (authorization: string | undefined, reply: FastifyReply) => Promise<{ id: string } | null>,
) {
  const service = new OrganizationWorkers(pool)
  const prefix = '/v1/organizations/:orgId/workers'
  app.get(prefix, async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (!account) return
    return service.list(
      (request.params as { orgId: string }).orgId,
      account.id,
      sessionDigest(request.headers.authorization!.slice(7)),
    )
  })
  app.post(prefix, async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (!account) return
    return service.enroll(
      (request.params as { orgId: string }).orgId,
      account.id,
      sessionDigest(request.headers.authorization!.slice(7)),
      request.body,
    )
  })
  app.post(prefix + '/state', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (!account) return
    const proof = request.headers['x-worker-proof']
    return service.change(
      (request.params as { orgId: string }).orgId,
      account.id,
      sessionDigest(request.headers.authorization!.slice(7)),
      request.body,
      typeof proof === 'string' ? proof : undefined,
    )
  })
  for (const action of ['heartbeat', 'grants'] as const)
    app.post(prefix + '/:workerId/' + action, async (request) => {
      const params = z.object({ orgId: z.string().min(1).max(128), workerId: uuid }).parse(request.params)
      const token = z
        .string()
        .regex(/^Bearer [A-Za-z0-9_-]{64}$/)
        .safeParse(request.headers.authorization)
      if (!token.success) throw denied()
      return action === 'heartbeat'
        ? service.heartbeat(params.orgId, params.workerId, token.data.slice(7))
        : service.grant(params.orgId, params.workerId, token.data.slice(7), request.body)
    })
  app.delete(prefix + '/grants/:grantId', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (!account) return
    const params = request.params as { orgId: string; grantId: string }
    return service.revokeGrant(
      params.orgId,
      account.id,
      sessionDigest(request.headers.authorization!.slice(7)),
      params.grantId,
    )
  })
}
