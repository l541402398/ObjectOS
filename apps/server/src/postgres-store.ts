import { createHash, randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import type { AuthDirectory, DesktopTokenStore } from './desktop-auth.js'
import { AUTH_SCHEMA_SQL } from './postgres-auth-schema.js'
import { OrgRoleSchema } from '@projectos/organization-contracts'

export function createOrganizationPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  })
}

const APPLICATION_SCHEMA_SQL = `
CREATE TABLE organization_schema_migrations (
  version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX member_organization_account_unique ON member("organizationId","userId");
CREATE TABLE organization_invitation_codes (
  invitation_id text PRIMARY KEY REFERENCES invitation(id) ON DELETE CASCADE,
  code_hash text NOT NULL CHECK (length(code_hash)=64)
);
CREATE TABLE desktop_sessions (
  token_hash text PRIMARY KEY, account_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires_at bigint NOT NULL, revoked_at bigint, created_at bigint NOT NULL
);
CREATE INDEX desktop_sessions_account_idx ON desktop_sessions(account_id);
CREATE TABLE organization_projects (
  id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  key text NOT NULL, name text NOT NULL, description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at bigint NOT NULL, updated_at bigint NOT NULL,
  UNIQUE(organization_id,key), UNIQUE(organization_id,id)
);
CREATE TABLE organization_project_members (
  id text PRIMARY KEY, organization_id text NOT NULL, project_id text NOT NULL,
  account_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','maintainer','contributor','reviewer','viewer')),
  created_at bigint NOT NULL,
  FOREIGN KEY(organization_id,project_id) REFERENCES organization_projects(organization_id,id) ON DELETE CASCADE,
  UNIQUE(project_id,account_id)
);
CREATE TABLE organization_audit_events (
  id text PRIMARY KEY, organization_id text REFERENCES organization(id) ON DELETE CASCADE,
  actor_id text NOT NULL REFERENCES "user"(id), operation text NOT NULL,
  subject_id text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at bigint NOT NULL
);
`

export async function inTransaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const value = await action(client)
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** Explicit, checksum-checked migrations. Never run from a Renderer or implicitly on a request. */
export async function migrateOrganizationDatabase(pool: Pool): Promise<void> {
  await inTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(541402398, 1)')
    const checksum = createHash('sha256')
      .update(AUTH_SCHEMA_SQL + APPLICATION_SCHEMA_SQL)
      .digest('hex')
    const exists = await client.query("SELECT to_regclass('public.organization_schema_migrations') AS name")
    if (exists.rows[0]?.name) {
      const previous = await client.query(
        'SELECT version, checksum FROM organization_schema_migrations ORDER BY version',
      )
      if (
        previous.rows.length !== 1 ||
        previous.rows[0].version !== 1 ||
        previous.rows[0].checksum !== checksum
      ) {
        throw new Error(
          'Organization migration checksum/version mismatch; restore a compatible build before continuing',
        )
      }
      return
    }
    await client.query(AUTH_SCHEMA_SQL)
    await client.query(APPLICATION_SCHEMA_SQL)
    await client.query('INSERT INTO organization_schema_migrations(version,checksum) VALUES(1,$1)', [
      checksum,
    ])
  })
}

export async function assertOrganizationSchema(pool: Pool): Promise<void> {
  const result = await pool.query(
    'SELECT version, checksum FROM organization_schema_migrations ORDER BY version',
  )
  const checksum = createHash('sha256')
    .update(AUTH_SCHEMA_SQL + APPLICATION_SCHEMA_SQL)
    .digest('hex')
  if (result.rows.length !== 1 || result.rows[0].version !== 1 || result.rows[0].checksum !== checksum) {
    throw new Error('Organization database requires the matching explicit migration')
  }
}

export function postgresDirectory(pool: Pool): AuthDirectory {
  return {
    async accountById(id) {
      const result = await pool.query('SELECT id,name,email FROM "user" WHERE id=$1', [id])
      return result.rows[0] ?? null
    },
    async membershipFor(accountId, organizationId) {
      const result = await pool.query(
        'SELECT id,role FROM member WHERE "userId"=$1 AND "organizationId"=$2',
        [accountId, organizationId],
      )
      const row = result.rows[0]
      const role = OrgRoleSchema.safeParse(row?.role)
      return row && role.success ? { memberId: row.id as string, role: role.data } : null
    },
    async organizationsFor(accountId) {
      const result = await pool.query(
        `SELECT o.id,o.name,o.slug,m.role FROM organization o
        JOIN member m ON m."organizationId"=o.id WHERE m."userId"=$1 ORDER BY o.name,o.id`,
        [accountId],
      )
      return result.rows.flatMap((row) => {
        const role = OrgRoleSchema.safeParse(row.role)
        return role.success
          ? [{ id: row.id as string, name: row.name as string, slug: row.slug as string, role: role.data }]
          : []
      })
    },
  }
}

export function postgresTokens(pool: Pool): DesktopTokenStore {
  return {
    async issue(hash, record) {
      await inTransaction(pool, async (client) => {
        await client.query(
          'INSERT INTO desktop_sessions(token_hash,account_id,expires_at,created_at) VALUES($1,$2,$3,$4)',
          [hash, record.accountId, record.expiresAt, Date.now()],
        )
        await audit(client, record.accountId, null, 'desktop.authorized', record.accountId)
      })
    },
    async find(hash) {
      const result = await pool.query(
        'SELECT account_id,expires_at FROM desktop_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>$2',
        [hash, Date.now()],
      )
      const row = result.rows[0]
      return row ? { accountId: row.account_id as string, expiresAt: Number(row.expires_at) } : null
    },
    async revoke(hash) {
      await inTransaction(pool, async (client) => {
        const result = await client.query(
          'UPDATE desktop_sessions SET revoked_at=$2 WHERE token_hash=$1 AND revoked_at IS NULL RETURNING account_id',
          [hash, Date.now()],
        )
        if (result.rows[0])
          await audit(client, result.rows[0].account_id, null, 'desktop.revoked', result.rows[0].account_id)
      })
    },
  }
}

export async function audit(
  client: PoolClient,
  accountId: string,
  organizationId: string | null,
  operation: string,
  subjectId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await client.query(
    `INSERT INTO organization_audit_events(id,organization_id,actor_id,operation,subject_id,details,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [randomUUID(), organizationId, accountId, operation, subjectId, JSON.stringify(details), Date.now()],
  )
}
