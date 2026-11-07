import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  OrganizationKnowledgeCreateSchema,
  OrganizationKnowledgeSearchSchema,
  OrganizationKnowledgeDetailSchema,
  canonicalKnowledgeContent,
  type OrganizationKnowledgeDetail,
} from '@projectos/organization-contracts'
import { buildOrganizationServer } from '../apps/server/src/persistent-server.js'
import {
  assertOrganizationSchema,
  migrateOrganizationDatabase,
  postgresTokens,
} from '../apps/server/src/postgres-store.js'
import { reserveOrganizationTestPort, startOrganizationTestDatabase } from './helpers/org-postgres.js'

const technical = {
  title: '服务端技术规范',
  body: '订单服务使用事务处理，并保留审批与审计证据。',
  tags: ['订单', '事务'],
}

describe('organization knowledge contracts', () => {
  it('rejects credentials, extra execution fields, malformed scope and unbounded content', () => {
    const valid = {
      category: 'technical',
      visibility: 'organization',
      projectId: null,
      version: '1.0.0',
      content: technical,
    }
    expect(OrganizationKnowledgeCreateSchema.safeParse(valid).success).toBe(true)
    for (const input of [
      { ...valid, visibility: 'project' },
      { ...valid, projectId: 'private' },
      { ...valid, command: 'execute' },
      { ...valid, version: '01.0.0' },
      ...[
        '',
        'x'.repeat(20_001),
        '\0',
        'sk-' + 'a'.repeat(24),
        'https://user:password@example.test/path',
      ].map((body) => ({ ...valid, content: { ...technical, body } })),
      { ...valid, content: { ...technical, tags: ['重复', '重复'] } },
    ])
      expect(OrganizationKnowledgeCreateSchema.safeParse(input).success).toBe(false)
    expect(OrganizationKnowledgeSearchSchema.safeParse({ projectId: 'p', query: '\0' }).success).toBe(false)
    expect(
      OrganizationKnowledgeSearchSchema.safeParse({ projectId: 'p', query: '', limit: 31 }).success,
    ).toBe(false)
    expect(canonicalKnowledgeContent(technical)).toBe(
      canonicalKnowledgeContent({ tags: technical.tags, body: technical.body, title: technical.title }),
    )
  })
})

describe('versioned organization knowledge — real PostgreSQL and HTTP', () => {
  let database: Awaited<ReturnType<typeof startOrganizationTestDatabase>>
  let server: Awaited<ReturnType<typeof buildOrganizationServer>>, origin: string
  let checksums: Array<{ version: number; checksum: string }>
  const org = randomUUID(),
    otherOrg = randomUUID(),
    project = randomUUID(),
    privateProject = randomUUID()
  const accounts = { owner: randomUUID(), admin: randomUUID(), member: randomUUID(), foreign: randomUUID() }
  const tokens = new Map<string, string>()
  async function start() {
    server = await buildOrganizationServer({
      databaseUrl: database.databaseUrl,
      baseURL: origin,
      secret: 'knowledge-real-http-integration-secret-0123456789abcdef',
      rateLimit: { max: 3000, authenticationMax: 100, windowMs: 60_000 },
    })
    await server.listen({ host: '127.0.0.1', port: Number(new URL(origin).port) })
  }
  async function request(
    path = '',
    body?: unknown,
    actor: keyof typeof accounts = 'owner',
    method = body === undefined ? 'GET' : 'POST',
    organization = org,
  ) {
    const response = await fetch(`${origin}/v1/organizations/${organization}/knowledge${path}`, {
      method,
      headers: {
        authorization: `Bearer ${tokens.get(actor)!}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: (await response.json()) as Record<string, unknown> }
  }
  async function create(overrides: Record<string, unknown> = {}) {
    const response = await request('', {
      category: 'technical',
      visibility: 'organization',
      projectId: null,
      version: '1.0.0',
      content: technical,
      ...overrides,
    })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    return OrganizationKnowledgeDetailSchema.parse(response.body)
  }
  async function transition(
    detail: OrganizationKnowledgeDetail,
    action: 'publish' | 'deprecate' | 'revoke' = 'publish',
    versionId = detail.versions[0]!.id,
  ) {
    const version = detail.versions.find((v) => v.id === versionId)!
    const response = await request(`/${detail.document.id}/versions/${version.id}/transition`, {
      expectedRevision: version.revision,
      action,
    })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    return OrganizationKnowledgeDetailSchema.parse(response.body)
  }
  async function search(query = '', actor: keyof typeof accounts = 'member', selectedProject = project) {
    const result = await request('/search', { projectId: selectedProject, query }, actor)
    return { ...result, results: (result.body.results ?? []) as Array<Record<string, unknown>> }
  }

  beforeAll(async () => {
    database = await startOrganizationTestDatabase()
    await migrateOrganizationDatabase(database.pool, 4)
    checksums = (
      await database.pool.query(
        'SELECT version,checksum FROM organization_schema_migrations ORDER BY version',
      )
    ).rows
    for (const [label, id] of Object.entries(accounts)) {
      await database.pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)', [
        id,
        label,
        `${label}@knowledge-test.invalid`,
      ])
      const token = randomBytes(48).toString('base64url')
      tokens.set(label, token)
      await postgresTokens(database.pool).issue(createHash('sha256').update(token).digest('base64url'), {
        accountId: id,
        expiresAt: Date.now() + 600_000,
      })
    }
    for (const id of [org, otherOrg])
      await database.pool.query('INSERT INTO organization(id,name,slug,"createdAt") VALUES($1,$1,$1,now())', [
        id,
      ])
    for (const [label, id] of Object.entries(accounts))
      await database.pool.query(
        'INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',
        [
          randomUUID(),
          label === 'foreign' ? otherOrg : org,
          id,
          label === 'owner' || label === 'foreign' ? 'owner' : label === 'admin' ? 'admin' : 'member',
        ],
      )
    for (const id of [project, privateProject]) {
      await database.pool.query(
        'INSERT INTO organization_projects(id,organization_id,key,name,created_at,updated_at) VALUES($1,$2,$1,$1,1,1)',
        [id, org],
      )
      await database.pool.query(
        'INSERT INTO organization_project_members(id,organization_id,project_id,account_id,role,created_at) VALUES($1,$2,$3,$4,$5,1)',
        [randomUUID(), org, id, accounts.owner, 'owner'],
      )
    }
    await database.pool.query(
      'INSERT INTO organization_project_members(id,organization_id,project_id,account_id,role,created_at) VALUES($1,$2,$3,$4,$5,1)',
      [randomUUID(), org, project, accounts.member, 'contributor'],
    )
    await migrateOrganizationDatabase(database.pool)
    origin = `http://127.0.0.1:${await reserveOrganizationTestPort()}`
    await start()
  }, 90_000)
  afterAll(async () => {
    await server?.close()
    await database?.stop()
  }, 30_000)

  it('preserves all four previous migration checksums, accounts and projects', async () => {
    expect(
      (
        await database.pool.query(
          'SELECT version,checksum FROM organization_schema_migrations WHERE version<=4 ORDER BY version',
        )
      ).rows,
    ).toEqual(checksums)
    expect(
      (
        await database.pool.query('SELECT version FROM organization_schema_migrations ORDER BY version')
      ).rows.map((row) => row.version),
    ).toEqual([1, 2, 3, 4, 5, 6])
    expect(
      (await database.pool.query('SELECT id FROM organization_projects WHERE id=$1', [project])).rowCount,
    ).toBe(1)
    await migrateOrganizationDatabase(database.pool)
    await assertOrganizationSchema(database.pool)
  })

  it('hides draft bodies and titles from ordinary members until explicit publication', async () => {
    const draft = await create({ content: { ...technical, title: '未发布机密草稿', body: '草稿限定正文' } })
    expect((await request(`/${draft.document.id}`, undefined, 'member')).status).toBe(404)
    expect(JSON.stringify((await request('', undefined, 'member')).body)).not.toContain('未发布机密草稿')
    expect((await search('草稿限定正文')).results).toHaveLength(0)
    const published = await transition(draft)
    const result = await search('草稿限定正文')
    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toMatchObject({
      documentId: draft.document.id,
      versionId: published.versions[0]!.id,
      checksum: published.versions[0]!.checksum,
    })
    const audits = (
      await database.pool.query(
        "SELECT details FROM organization_audit_events WHERE subject_id=$1 AND operation='knowledge.published'",
        [published.versions[0]!.id],
      )
    ).rows
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits)).not.toContain('草稿限定正文')
  })

  it('serializes competing draft edits and rejects stale publish or published edits', async () => {
    const draft = await create(),
      v = draft.versions[0]!,
      path = `/${draft.document.id}/versions/${v.id}`
    const results = await Promise.all(
      ['方案甲', '方案乙'].map((body) =>
        request(path, { expectedRevision: 1, content: { ...technical, body } }, 'owner', 'PATCH'),
      ),
    )
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect((await request(path + '/transition', { expectedRevision: 1, action: 'publish' })).status).toBe(409)
    const current = OrganizationKnowledgeDetailSchema.parse((await request(`/${draft.document.id}`)).body)
    await transition(current)
    expect((await request(path, { expectedRevision: 3, content: technical }, 'owner', 'PATCH')).status).toBe(
      409,
    )
    expect(
      (
        await database.pool.query(
          "SELECT id FROM organization_audit_events WHERE subject_id=$1 AND operation='knowledge.draft_updated'",
          [v.id],
        )
      ).rowCount,
    ).toBe(1)
  })

  it('protects content, identity, status and history with actual database triggers', async () => {
    const doc = await transition(await create()),
      v = doc.versions[0]!
    for (const query of [
      "UPDATE organization_knowledge_versions SET body='tampered',revision=revision+1 WHERE id=$1",
      "UPDATE organization_knowledge_versions SET version='9.0.0',revision=revision+1 WHERE id=$1",
      "UPDATE organization_knowledge_versions SET status='draft',published_at=NULL,revision=revision+1 WHERE id=$1",
      'DELETE FROM organization_knowledge_versions WHERE id=$1',
    ])
      await expect(database.pool.query(query, [v.id])).rejects.toThrow()
    await expect(
      database.pool.query(
        "UPDATE organization_knowledge_documents SET visibility='project',project_id=$2 WHERE id=$1",
        [doc.document.id, project],
      ),
    ).rejects.toThrow()
    const draft = await create()
    await expect(
      database.pool.query(
        "UPDATE organization_knowledge_versions SET body='changed while publishing',status='published',published_at=1,revision=revision+1 WHERE id=$1",
        [draft.versions[0]!.id],
      ),
    ).rejects.toThrow()
  })

  it('keeps exact version/checksum history while newer drafts and publications coexist', async () => {
    const original = await transition(await create({ content: { ...technical, body: '版本连续性甲' } })),
      first = original.versions[0]!
    const response = await request(`/${original.document.id}/versions`, {
      version: '2.0.0',
      content: { ...technical, body: '版本连续性乙' },
    })
    expect(response.status).toBe(200)
    expect((await search('版本连续性甲')).results[0]?.versionId).toBe(first.id)
    expect((await search('版本连续性乙')).results).toHaveLength(0)
    const next = OrganizationKnowledgeDetailSchema.parse(response.body),
      second = next.versions.find((v) => v.version === '2.0.0')!
    await transition(next, 'publish', second.id)
    expect((await search('版本连续性乙')).results[0]?.versionId).toBe(second.id)
    expect((await search('版本连续性甲')).results).toHaveLength(0)
    const history = OrganizationKnowledgeDetailSchema.parse(
      (await request(`/${original.document.id}`, undefined, 'member')).body,
    )
    expect(history.versions.find((v) => v.id === first.id)?.checksum).toBe(first.checksum)
    expect(
      (await request(`/${original.document.id}/versions`, { version: '2.0.0', content: technical })).status,
    ).toBe(409)
  })

  it('enforces tenant and private-project access independently of organization administration', async () => {
    const doc = await transition(
      await create({
        visibility: 'project',
        projectId: privateProject,
        content: { ...technical, body: '私有项目隔离正文' },
      }),
    )
    expect((await request(`/${doc.document.id}`, undefined, 'foreign')).status).toBe(403)
    expect((await request(`/${doc.document.id}`, undefined, 'admin')).status).toBe(404)
    expect((await request(`/${doc.document.id}`, undefined, 'member')).status).toBe(404)
    expect((await search('私有项目隔离正文')).results).toHaveLength(0)
    expect((await search('', 'admin')).status).toBe(404)
    expect(
      (await search('', 'owner', privateProject)).results.some((r) => r.documentId === doc.document.id),
    ).toBe(true)
    expect(
      (
        await request(
          '',
          {
            category: 'technical',
            visibility: 'project',
            projectId: privateProject,
            version: '1.0.0',
            content: technical,
          },
          'admin',
        )
      ).status,
    ).toBe(403)
    expect(
      (await request('/search', { projectId: project, query: '' }, 'foreign', 'POST', otherOrg)).status,
    ).toBe(404)
  })

  it('does not grant publication to members who can maintain the project', async () => {
    await database.pool.query(
      "UPDATE organization_project_members SET role='maintainer' WHERE project_id=$1 AND account_id=$2",
      [project, accounts.member],
    )
    try {
      const doc = await create({ visibility: 'project', projectId: project })
      expect(
        (
          await request(
            `/${doc.document.id}/versions/${doc.versions[0]!.id}/transition`,
            { expectedRevision: 1, action: 'publish' },
            'member',
          )
        ).status,
      ).toBe(403)
      expect(
        (
          await request(
            '',
            {
              category: 'business',
              visibility: 'organization',
              projectId: null,
              version: '1.0.0',
              content: technical,
            },
            'member',
          )
        ).status,
      ).toBe(403)
    } finally {
      await database.pool.query(
        "UPDATE organization_project_members SET role='contributor' WHERE project_id=$1 AND account_id=$2",
        [project, accounts.member],
      )
    }
  })

  it('retrieves Chinese, categories and literal SQL wildcard characters with bounded excerpts', async () => {
    const doc = await transition(
      await create({
        category: 'business',
        content: {
          title: '退款业务口径',
          body: '甲'.repeat(1500) + '退款率为100%_literal，按支付渠道确认。',
          tags: ['售后规则'],
        },
      }),
    )
    const found = await search('100%_literal')
    expect(found.results.map((r) => r.documentId)).toEqual([doc.document.id])
    expect(String(found.results[0]?.excerpt)).toContain('100%_literal')
    expect(String(found.results[0]?.excerpt).length).toBeLessThanOrEqual(1200)
    expect((await search('售后规则')).results.some((r) => r.documentId === doc.document.id)).toBe(true)
    const filtered = await request(
      '/search',
      { projectId: project, query: '退款', category: 'technical', limit: 1 },
      'member',
    )
    expect(filtered.body.results).toEqual([])
    expect((await request('/search', { projectId: project, query: '', limit: 31 }, 'member')).status).toBe(
      400,
    )
  })

  it('excludes deprecated/revoked knowledge from search and never exposes revoked text to readers', async () => {
    let doc = await transition(await create({ content: { ...technical, body: '撤销限定正文' } }))
    doc = await transition(doc, 'deprecate')
    expect((await search('撤销限定正文')).results).toHaveLength(0)
    expect((await request(`/${doc.document.id}`, undefined, 'member')).status).toBe(200)
    doc = await transition(doc, 'revoke')
    expect((await request(`/${doc.document.id}`, undefined, 'member')).status).toBe(404)
    expect(JSON.stringify((await request('', undefined, 'member')).body)).not.toContain('撤销限定正文')
    expect(
      (
        await request(`/${doc.document.id}/versions/${doc.versions[0]!.id}/transition`, {
          expectedRevision: doc.versions[0]!.revision,
          action: 'publish',
        })
      ).status,
    ).toBe(409)
  })

  it('rechecks membership after a real blocked transaction before writing', async () => {
    const client = await database.pool.connect()
    let pending: ReturnType<typeof request> | undefined
    try {
      await client.query('BEGIN')
      await client.query('SELECT id FROM organization WHERE id=$1 FOR UPDATE', [org])
      pending = request(
        '',
        {
          category: 'business',
          visibility: 'organization',
          projectId: null,
          version: '1.0.0',
          content: { ...technical, title: '撤权写入尝试' },
        },
        'admin',
      )
      let blocked = false
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          (
            await database.pool.query(
              "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM organization WHERE id=%'",
            )
          ).rowCount
        ) {
          blocked = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(blocked).toBe(true)
      await client.query('DELETE FROM member WHERE "organizationId"=$1 AND "userId"=$2', [
        org,
        accounts.admin,
      ])
      await client.query('COMMIT')
      expect((await pending).status).toBe(403)
      expect(
        (
          await database.pool.query(
            "SELECT id FROM organization_knowledge_versions WHERE title='撤权写入尝试'",
          )
        ).rowCount,
      ).toBe(0)
    } finally {
      await client.query('ROLLBACK')
      client.release()
      await pending
    }
  })

  it('keeps published knowledge and desktop authentication across a server restart', async () => {
    const doc = await transition(await create({ content: { ...technical, body: '重启后保留正文' } }))
    await server.close()
    await start()
    const recovered = await request(`/${doc.document.id}`, undefined, 'member')
    expect(recovered.status).toBe(200)
    expect(OrganizationKnowledgeDetailSchema.parse(recovered.body).versions[0]!.checksum).toBe(
      doc.versions[0]!.checksum,
    )
    expect((await search('重启后保留正文')).results).toHaveLength(1)
  })

  it('resolves the exact chosen publication, never substitutes a version, and rechecks its current authority', async () => {
    const detail = await transition(await create({ content: { ...technical, body: '精确引用的旧版资料' } })), version = detail.versions[0]!
    const pin = { documentId: detail.document.id, versionId: version.id, checksum: version.checksum }
    const input = { projectId: project, pins: [pin], includeContent: true }
    const newer = await request(`/${detail.document.id}/versions`, { version: '2.0.0', content: { ...technical, body: '后续新版资料' } })
    const next = OrganizationKnowledgeDetailSchema.parse(newer.body)
    await transition(next, 'publish', next.versions.find(v => v.version === '2.0.0')!.id)
    const resolved = await request('/resolve', input, 'member')
    expect(resolved.status).toBe(200)
    expect(JSON.stringify(resolved.body)).toContain('精确引用的旧版资料')
    expect(JSON.stringify(resolved.body)).not.toContain('后续新版资料')
    expect(JSON.stringify((await request('/resolve', { ...input, includeContent: false }, 'member')).body)).not.toContain('精确引用的旧版资料')
    expect((await request('/resolve', { ...input, pins: [{ ...pin, checksum: 'sha256:' + '0'.repeat(64) }] }, 'member')).status).toBe(409)
    expect((await request('/resolve', { ...input, projectId: privateProject }, 'member')).status).toBe(404)
    await transition(OrganizationKnowledgeDetailSchema.parse((await request(`/${detail.document.id}`)).body), 'revoke', version.id)
    expect((await request('/resolve', input, 'member')).status).toBe(409)
  })

  it('rejects oversize selected context without truncating or granting draft/private knowledge', async () => {
    const first = await transition(await create({ content: { ...technical, body: '甲'.repeat(13000) } }))
    const second = await transition(await create({ content: { ...technical, body: '乙'.repeat(13000) } }))
    const pin = (detail: OrganizationKnowledgeDetail) => ({ documentId: detail.document.id, versionId: detail.versions[0]!.id, checksum: detail.versions[0]!.checksum })
    expect((await request('/resolve', { projectId: project, pins: [pin(first), pin(second)], includeContent: true }, 'member')).status).toBe(400)
    const draft = await create()
    expect((await request('/resolve', { projectId: project, pins: [pin(draft)], includeContent: true }, 'member')).status).toBe(409)
    const privateDoc = await transition(await create({ visibility: 'project', projectId: privateProject }))
    expect((await request('/resolve', { projectId: project, pins: [pin(privateDoc)], includeContent: true }, 'owner')).status).toBe(404)
  })
})
