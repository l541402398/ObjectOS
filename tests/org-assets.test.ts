import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  canonicalAssetDefinition,
  SharedAssetDefinitionSchema,
  type SharedAssetDefinition,
  type SharedAssetDetail,
} from '@projectos/organization-contracts'
import { buildOrganizationServer } from '../apps/server/src/persistent-server.js'
import {
  migrateOrganizationDatabase,
  assertOrganizationSchema,
  postgresTokens,
} from '../apps/server/src/postgres-store.js'
import { reserveOrganizationTestPort, startOrganizationTestDatabase } from './helpers/org-postgres.js'

const skill: SharedAssetDefinition = {
  kind: 'skill',
  instructions: '核对验收项并记录证据。',
  toolIds: ['read_file'],
}
describe('A2.1 immutable organization assets — real PostgreSQL and HTTP', () => {
  let database: Awaited<ReturnType<typeof startOrganizationTestDatabase>>,
    server: Awaited<ReturnType<typeof buildOrganizationServer>>,
    origin: string
  let owner: string, viewer: string, foreign: string, admin: string, v1Checksum: string
  const org = randomUUID(),
    otherOrg = randomUUID(),
    project = randomUUID(),
    secondProject = randomUUID()
  const ids = { owner: randomUUID(), viewer: randomUUID(), foreign: randomUUID(), admin: randomUUID() }
  async function request(
    path: string,
    body?: unknown,
    token = owner,
    method = body === undefined ? 'GET' : 'POST',
  ) {
    const response = await fetch(origin + `/v1/organizations/${org}/assets` + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: (await response.json()) as any }
  }
  async function create(overrides: Record<string, unknown> = {}) {
    const response = await request('', {
      name: '验收检查',
      visibility: 'organization',
      projectId: null,
      version: '1.0.0',
      definition: skill,
      ...overrides,
    })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    return response.body as SharedAssetDetail
  }
  async function publish(detail: SharedAssetDetail) {
    const version = detail.versions[0]!
    const result = await request(`/${detail.asset.id}/versions/${version.id}/transition`, {
      expectedRevision: version.revision,
      action: 'publish',
    })
    expect(result.status, JSON.stringify(result.body)).toBe(200)
    return result.body as SharedAssetDetail
  }
  const binding = (
    detail: SharedAssetDetail,
    expectedVersionId: string | null = null,
    projectId = project,
  ) => ({ projectId, assetId: detail.asset.id, versionId: detail.versions[0]!.id, expectedVersionId })

  beforeAll(async () => {
    database = await startOrganizationTestDatabase()
    await migrateOrganizationDatabase(database.pool, 1)
    v1Checksum = (
      await database.pool.query('SELECT checksum FROM organization_schema_migrations WHERE version=1')
    ).rows[0].checksum
    for (const [label, id] of Object.entries(ids))
      await database.pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)', [
        id,
        label,
        `${label}@asset-test.invalid`,
      ])
    for (const [id, name] of [
      [org, 'Assets A'],
      [otherOrg, 'Assets B'],
    ])
      await database.pool.query('INSERT INTO organization(id,name,slug,"createdAt") VALUES($1,$2,$1,now())', [
        id,
        name,
      ])
    for (const [id, orgId, role] of [
      [ids.owner, org, 'owner'],
      [ids.viewer, org, 'member'],
      [ids.admin, org, 'admin'],
      [ids.foreign, otherOrg, 'owner'],
    ])
      await database.pool.query(
        'INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',
        [randomUUID(), orgId, id, role],
      )
    for (const id of [project, secondProject]) {
      await database.pool.query(
        'INSERT INTO organization_projects(id,organization_id,key,name,created_at,updated_at) VALUES($1,$2,$1,$1,1,1)',
        [id, org],
      )
      await database.pool.query(
        'INSERT INTO organization_project_members(id,organization_id,project_id,account_id,role,created_at) VALUES($1,$2,$3,$4,$5,1)',
        [randomUUID(), org, id, ids.owner, 'owner'],
      )
    }
    await migrateOrganizationDatabase(database.pool)
    const tokens = postgresTokens(database.pool),
      issued: Record<string, string> = {}
    for (const [label, id] of Object.entries(ids)) {
      const token = randomBytes(48).toString('base64url')
      await tokens.issue(createHash('sha256').update(token).digest('base64url'), {
        accountId: id,
        expiresAt: Date.now() + 600_000,
      })
      issued[label] = token
    }
    owner = issued.owner!
    viewer = issued.viewer!
    foreign = issued.foreign!
    admin = issued.admin!
    const port = await reserveOrganizationTestPort()
    origin = `http://127.0.0.1:${port}`
    server = await buildOrganizationServer({
      databaseUrl: database.databaseUrl,
      baseURL: origin,
      secret: 'isolated-assets-integration-secret-0123456789abcdef',
      rateLimit: { max: 2000, authenticationMax: 100, windowMs: 60_000 },
    })
    await server.listen({ host: '127.0.0.1', port })
  }, 90_000)
  afterAll(async () => {
    await server?.close()
    await database?.stop()
  }, 30_000)

  it('upgrades the unchanged v1 checksum, identities and projects; rejects changed/unknown migrations', async () => {
    expect(
      (
        await database.pool.query('SELECT version FROM organization_schema_migrations ORDER BY version')
      ).rows.map((row) => row.version),
    ).toEqual([1, 2])
    expect(
      (await database.pool.query('SELECT checksum FROM organization_schema_migrations WHERE version=1'))
        .rows[0].checksum,
    ).toBe(v1Checksum)
    expect(
      (await database.pool.query('SELECT id FROM organization_projects WHERE id=$1', [project])).rowCount,
    ).toBe(1)
    await assertOrganizationSchema(database.pool)
    const checksum = (
      await database.pool.query('SELECT checksum FROM organization_schema_migrations WHERE version=2')
    ).rows[0].checksum
    try {
      await database.pool.query(
        "UPDATE organization_schema_migrations SET checksum='tampered' WHERE version=2",
      )
      await expect(migrateOrganizationDatabase(database.pool)).rejects.toThrow('checksum')
    } finally {
      await database.pool.query('UPDATE organization_schema_migrations SET checksum=$1 WHERE version=2', [
        checksum,
      ])
    }
    try {
      await database.pool.query(
        "INSERT INTO organization_schema_migrations(version,checksum) VALUES(3,'unknown')",
      )
      await expect(assertOrganizationSchema(database.pool)).rejects.toThrow()
      await expect(migrateOrganizationDatabase(database.pool)).rejects.toThrow()
    } finally {
      await database.pool.query('DELETE FROM organization_schema_migrations WHERE version=3')
    }
    await expect(migrateOrganizationDatabase(database.pool, 1)).rejects.toThrow()
  })
  it('uses revision compare-and-set for simultaneous edits and retains one audit fact', async () => {
    const asset = await create(),
      version = asset.versions[0]!
    const body = {
      expectedRevision: version.revision,
      definition: { ...skill, instructions: '新的验收证据规则。' },
    }
    const results = await Promise.all([
      request(`/${asset.asset.id}/versions/${version.id}`, body, owner, 'PATCH'),
      request(`/${asset.asset.id}/versions/${version.id}`, body, owner, 'PATCH'),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
    const audits = await database.pool.query(
      "SELECT id FROM organization_audit_events WHERE subject_id=$1 AND operation='asset.draft_updated'",
      [version.id],
    )
    expect(audits.rowCount).toBe(1)
  })
  it('freezes publication content/hash both through HTTP and database writes', async () => {
    const created = await create(),
      published = await publish(created),
      version = published.versions[0]!
    expect(version.checksum).toBe(
      'sha256:' + createHash('sha256').update(canonicalAssetDefinition(skill)).digest('hex'),
    )
    expect(
      (
        await request(
          `/${created.asset.id}/versions/${version.id}`,
          { expectedRevision: version.revision, definition: { ...skill, instructions: 'rewrite' } },
          owner,
          'PATCH',
        )
      ).status,
    ).toBe(409)
    await expect(
      database.pool.query(
        "UPDATE organization_asset_versions SET definition='{}',revision=revision+1 WHERE id=$1",
        [version.id],
      ),
    ).rejects.toThrow('immutable')
    await expect(
      database.pool.query('DELETE FROM organization_asset_versions WHERE id=$1', [version.id]),
    ).rejects.toThrow('forbidden')
    expect((await request(`/${created.asset.id}`)).body.versions[0].checksum).toBe(version.checksum)
  })
  it('pins an exact published version; publishing a new one never changes the existing binding', async () => {
    const draft = await create()
    expect((await request('/bindings', binding(draft), owner, 'PUT')).status).toBe(409)
    const first = await publish(draft)
    expect((await request('/bindings', binding(first), owner, 'PUT')).status).toBe(200)
    const next = (
      await request(`/${first.asset.id}/versions`, {
        version: '1.1.0',
        definition: { ...skill, instructions: '加入设计检查。' },
      })
    ).body as SharedAssetDetail
    const second = await publish(next)
    expect(second.bindings[0]?.versionId).toBe(first.versions[0]!.id)
    expect(second.versions.find((item) => item.id === first.versions[0]!.id)?.definition).toEqual(skill)
  })
  it('rejects stale competing binding changes and stale unbind requests', async () => {
    const first = await publish(await create())
    await request('/bindings', binding(first), owner, 'PUT')
    const second = await publish(
      (await request(`/${first.asset.id}/versions`, { version: '2.0.0', definition: skill })).body,
    )
    const body = binding(second, first.versions[0]!.id)
    const results = await Promise.all([
      request('/bindings', body, owner, 'PUT'),
      request('/bindings', body, owner, 'PUT'),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
    expect(
      (
        await request(
          '/bindings',
          { projectId: project, assetId: first.asset.id, expectedVersionId: first.versions[0]!.id },
          owner,
          'DELETE',
        )
      ).status,
    ).toBe(409)
    expect(
      (
        await request(
          '/bindings',
          { projectId: project, assetId: first.asset.id, expectedVersionId: second.versions[0]!.id },
          owner,
          'DELETE',
        )
      ).status,
    ).toBe(200)
  })
  it('isolates tenants and project-private assets even from organization administrators', async () => {
    const privateAsset = await create({ visibility: 'project', projectId: project, name: 'Private alpha' })
    expect((await request(`/${privateAsset.asset.id}`, undefined, foreign)).status).toBe(403)
    expect((await request(`/${privateAsset.asset.id}`, undefined, admin)).status).toBe(404)
    expect(
      (await request('', undefined, admin)).body.assets.some(
        (item: any) => item.id === privateAsset.asset.id,
      ),
    ).toBe(false)
    expect(
      (
        await request(
          '',
          {
            name: 'Cannot create',
            visibility: 'project',
            projectId: project,
            version: '1.0.0',
            definition: skill,
          },
          admin,
        )
      ).status,
    ).toBe(403)
    expect(
      (await request('/bindings', binding(await publish(privateAsset), null, secondProject), owner, 'PUT'))
        .status,
    ).toBe(403)
  })
  it('requires project management permission independently of organization role', async () => {
    const asset = await publish(await create())
    expect((await request('/bindings', binding(asset), admin, 'PUT')).status).toBe(403)
    expect(
      (await request(`/${asset.asset.id}/versions`, { version: '1.2.0', definition: skill }, viewer)).status,
    ).toBe(403)
    await database.pool.query(
      'INSERT INTO organization_project_members(id,organization_id,project_id,account_id,role,created_at) VALUES($1,$2,$3,$4,$5,1)',
      [randomUUID(), org, project, ids.viewer, 'maintainer'],
    )
    expect((await request('/bindings', binding(asset), viewer, 'PUT')).status).toBe(200)
    expect((await request(`/${asset.asset.id}`, undefined, viewer)).body.asset.canManage).toBe(false)
  })
  it('rejects cross-scope/unpublished skill references and changing asset kind', async () => {
    const privateSkill = await publish(await create({ visibility: 'project', projectId: project }))
    const definition = {
      kind: 'agent',
      role: '审阅者',
      instructions: '检查事实。',
      runtime: 'native',
      toolIds: [],
      skillVersionIds: [privateSkill.versions[0]!.id],
    }
    expect(
      (
        await request('', {
          name: 'Leaky reference',
          visibility: 'organization',
          projectId: null,
          version: '1.0.0',
          definition,
        })
      ).status,
    ).toBe(403)
    const asset = await create()
    expect(
      (
        await request(`/${asset.asset.id}/versions`, {
          version: '2.0.0',
          definition: { kind: 'tool', toolId: 'read_file', description: 'read', approval: 'required' },
        })
      ).status,
    ).toBe(400)
  })
  it('deprecates/revokes without silently replacing or deleting existing pins', async () => {
    const published = await publish(await create()),
      version = published.versions[0]!
    await request('/bindings', binding(published), owner, 'PUT')
    const deprecated = await request(`/${published.asset.id}/versions/${version.id}/transition`, {
      expectedRevision: version.revision,
      action: 'deprecate',
    })
    expect(deprecated.status).toBe(200)
    expect((await request('/bindings', binding(published, null, secondProject), owner, 'PUT')).status).toBe(
      409,
    )
    const revoked = await request(`/${published.asset.id}/versions/${version.id}/transition`, {
      expectedRevision: deprecated.body.versions[0].revision,
      action: 'revoke',
    })
    expect(revoked.body.bindings[0]).toMatchObject({
      versionId: version.id,
      status: 'revoked',
      checksum: version.checksum,
    })
    expect(
      (
        await request(`/${published.asset.id}/versions/${version.id}/transition`, {
          expectedRevision: revoked.body.versions[0].revision,
          action: 'publish',
        })
      ).status,
    ).toBe(409)
  })
  it('rejects unknown secret fields, known credential formats and credential-bearing URLs before storage', async () => {
    const invalid = [
      { ...skill, apiKey: 'not-allowed' },
      { ...skill, instructions: 'Bearer ' + randomBytes(32).toString('hex') },
      { kind: 'mcp', transport: 'https', target: 'https://user:password@example.test', credentialRefs: [] },
      {
        kind: 'mcp',
        transport: 'stdio',
        target: 'mcp-example',
        credentialRefs: [],
        env: { API_KEY: 'secret' },
      },
    ]
    const before = (await database.pool.query('SELECT count(*) FROM organization_assets')).rows[0].count
    for (const definition of invalid)
      expect(
        (
          await request('', {
            name: 'Rejected',
            visibility: 'organization',
            projectId: null,
            version: '1.0.0',
            definition,
          })
        ).status,
      ).toBe(400)
    expect((await database.pool.query('SELECT count(*) FROM organization_assets')).rows[0].count).toBe(before)
    expect(
      SharedAssetDefinitionSchema.safeParse({
        kind: 'mcp',
        transport: 'https',
        target: 'https://mcp.example.test/api',
        credentialRefs: ['SERVICE_API_KEY'],
      }).success,
    ).toBe(true)
  })
  it('rechecks removed membership after waiting for the organization lock', async () => {
    const client = await database.pool.connect()
    let pending: ReturnType<typeof request> | undefined
    try {
      await client.query('BEGIN')
      await client.query('SELECT id FROM organization WHERE id=$1 FOR UPDATE', [org])
      pending = request(
        '',
        {
          name: 'Revoked actor attempt',
          visibility: 'organization',
          projectId: null,
          version: '1.0.0',
          definition: skill,
        },
        admin,
      )
      // Wait for the actual blocked transaction, rather than assuming network/DB timing.
      let blocked = false
      for (let attempt = 0; attempt < 100; attempt++) {
        const locks = await database.pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM organization WHERE id=%'",
        )
        if (locks.rowCount) {
          blocked = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(blocked).toBe(true)
      await client.query('DELETE FROM member WHERE "organizationId"=$1 AND "userId"=$2', [org, ids.admin])
      await client.query('COMMIT')
      expect((await pending).status).toBe(403)
      expect(
        (await database.pool.query("SELECT id FROM organization_assets WHERE name='Revoked actor attempt'"))
          .rowCount,
      ).toBe(0)
    } finally {
      await client.query('ROLLBACK')
      client.release()
      await pending
    }
  })
})
