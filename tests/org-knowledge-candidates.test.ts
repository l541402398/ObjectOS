import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { KnowledgeCandidateSubmitSchema, KnowledgeCandidateDetailSchema, type KnowledgeCandidateSubmit } from '@projectos/organization-contracts'
import { startOrganizationTestDatabase, reserveOrganizationTestPort } from './helpers/org-postgres.js'
import { buildOrganizationServer } from '../apps/server/src/persistent-server.js'
import { migrateOrganizationDatabase, postgresTokens } from '../apps/server/src/postgres-store.js'

const source = () => ({ kind: 'desktop-owner-attested' as const, requirementId: 'req_local', requirementTitle: '退款需求', requirementVersion: 0,
  acceptanceId: randomUUID(), fingerprint: 'a'.repeat(64), acceptedAt: 1, acceptanceNote: '本机所有者已核对当前代码与验收证据',
  tasks: [{ taskId: 'task_local', version: 1, sourceCommit: 'a'.repeat(40), integrationCommit: 'b'.repeat(40), reviewArtifactIds: ['review_local'], verificationRunId: 'run_test', verificationToolCallIds: ['call_test'], workflowRunIds: ['run_artifact'] }],
  artifacts: [{ id: 'artifact_local', taskId: 'task_local', runId: 'run_artifact', title: '业务结果', checksum: 'c'.repeat(64) }], citations: [] })

describe('reviewed organization knowledge candidates — real PostgreSQL and HTTP', () => {
  let database: Awaited<ReturnType<typeof startOrganizationTestDatabase>>, server: Awaited<ReturnType<typeof buildOrganizationServer>>, origin: string
  const org = randomUUID(), other = randomUUID(), project = randomUUID()
  const accounts = { owner: randomUUID(), member: randomUUID(), viewer: randomUUID(), admin: randomUUID(), foreign: randomUUID() }
  const tokens = new Map<string, string>()
  let before: unknown
  async function start() {
    server = await buildOrganizationServer({ databaseUrl: database.databaseUrl, baseURL: origin, secret: 'candidate-tests-isolated-signing-secret-0123456789', rateLimit: { max: 5000, authenticationMax: 100, windowMs: 60_000 } })
    await server.listen({ host: '127.0.0.1', port: Number(new URL(origin).port) })
  }
  async function request(path = '', body?: unknown, actor: keyof typeof accounts = 'owner', organization = org) {
    const response = await fetch(`${origin}/v1/organizations/${organization}/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${tokens.get(actor)!}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, data: await response.json() as Record<string, unknown> }
  }
  const payload = (title = '退款事务规则'): KnowledgeCandidateSubmit => ({ id: randomUUID(), projectId: project, category: 'technical', content: { title, body: title + '：幂等事务与实际测试已验证。', tags: ['退款'] }, source: source() })
  async function submit(input = payload()) {
    const result = await request('knowledge-candidates', input, 'member')
    expect(result.status, JSON.stringify(result.data)).toBe(200)
    return { input, detail: KnowledgeCandidateDetailSchema.parse(result.data) }
  }
  const decision = () => ({ decisionId: randomUUID(), expectedRevision: 1, note: '已核对候选正文与桌面验收证据来源', action: 'publish', target: { kind: 'new', version: '1.0.0' }, acknowledgedDuplicateIds: [] })
  beforeAll(async () => {
    database = await startOrganizationTestDatabase(); await migrateOrganizationDatabase(database.pool, 5)
    before = (await database.pool.query('SELECT version,checksum FROM organization_schema_migrations ORDER BY version')).rows
    for (const [name, id] of Object.entries(accounts)) {
      await database.pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)', [id, name, `${name}@candidate-test.invalid`])
      const token = randomBytes(48).toString('base64url'); tokens.set(name, token)
      await postgresTokens(database.pool).issue(createHash('sha256').update(token).digest('base64url'), { accountId: id, expiresAt: Date.now() + 900_000 })
    }
    for (const id of [org, other]) await database.pool.query('INSERT INTO organization(id,name,slug,"createdAt") VALUES($1,$1,$1,now())', [id])
    for (const [name, id] of Object.entries(accounts)) await database.pool.query('INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())', [randomUUID(), name === 'foreign' ? other : org, id, ['owner', 'foreign'].includes(name) ? 'owner' : name === 'admin' ? 'admin' : 'member'])
    await database.pool.query('INSERT INTO organization_projects(id,organization_id,key,name,created_at,updated_at) VALUES($1,$2,$1,$1,1,1)', [project, org])
    for (const name of ['owner', 'member', 'viewer'] as const) await database.pool.query('INSERT INTO organization_project_members(id,organization_id,project_id,account_id,role,created_at) VALUES($1,$2,$3,$4,$5,1)', [randomUUID(), org, project, accounts[name], name === 'owner' ? 'owner' : name === 'member' ? 'contributor' : 'viewer'])
    await migrateOrganizationDatabase(database.pool)
    origin = `http://127.0.0.1:${await reserveOrganizationTestPort()}`; await start()
  }, 90_000)
  afterAll(async () => { await server?.close(); await database?.stop() }, 30_000)

  it('appends migration 6 without modifying prior checksums', async () => {
    expect((await database.pool.query('SELECT version,checksum FROM organization_schema_migrations WHERE version<=5 ORDER BY version')).rows).toEqual(before)
    expect((await database.pool.query('SELECT max(version) AS version FROM organization_schema_migrations')).rows[0]?.version).toBe(6)
  })
  it('rejects paths, forged execution fields, secret content and missing human acceptance metadata', () => {
    const value = payload()
    for (const input of [ { ...value, source: { ...value.source, rootPath: 'C:/secret' } }, { ...value, source: { ...value.source, acceptedAt: undefined } },
      { ...value, source: { ...value.source, artifacts: [{ ...value.source.artifacts[0], taskId: 'another' }] } },
      { ...value, content: { ...value.content, body: 'sk-' + 'a'.repeat(30) } }, { ...value, command: 'run' } ]) expect(KnowledgeCandidateSubmitSchema.safeParse(input).success).toBe(false)
  })
  it('allows contributor submission but isolates candidate bodies and keeps pending text out of knowledge retrieval', async () => {
    const { input } = await submit(payload('尚待审核的业务规则'))
    expect((await request(`knowledge-candidates/${input.id}`, undefined, 'member')).status).toBe(200)
    expect((await request(`knowledge-candidates/${input.id}`, undefined, 'viewer')).status).toBe(404)
    expect((await request(`knowledge-candidates/${input.id}`, undefined, 'admin')).status).toBe(404)
    expect((await request(`knowledge-candidates/${input.id}`, undefined, 'foreign')).status).toBe(403)
    expect((await request('knowledge-candidates', payload(), 'viewer')).status).toBe(403)
    const found = await request('knowledge/search', { projectId: project, query: input.content.title }, 'member')
    expect(found.data.results).toEqual([])
  })
  it('deduplicates simultaneous identical submissions and rejects changed-payload id reuse', async () => {
    const input = payload('幂等提交规则')
    const values = await Promise.all([request('knowledge-candidates', input, 'member'), request('knowledge-candidates', input, 'member')])
    expect(values.map(item => item.status)).toEqual([200, 200])
    expect((await database.pool.query("SELECT id FROM organization_audit_events WHERE subject_id=$1 AND operation='knowledge.candidate_submitted'", [input.id])).rowCount).toBe(1)
    expect((await request('knowledge-candidates', { ...input, content: { ...input.content, body: '另一份内容' } }, 'member')).status).toBe(409)
    expect((await request('knowledge-candidates', { ...input, id: randomUUID() }, 'member')).status).toBe(409)
  })
  it('retains returned content and reasons and accepts only an exact idempotent decision replay', async () => {
    const { input } = await submit(payload('退回的版本'))
    const action = { decisionId: randomUUID(), expectedRevision: 1, action: 'return', note: '缺少可复用的业务约束，请补充后重新提交' }
    expect((await request(`knowledge-candidates/${input.id}/decision`, action, 'member')).status).toBe(403)
    const first = await request(`knowledge-candidates/${input.id}/decision`, action)
    expect(first.status).toBe(200)
    expect(KnowledgeCandidateDetailSchema.parse(first.data).candidate).toMatchObject({ status: 'returned', revision: 2, reviewNote: action.note, content: input.content })
    expect((await request(`knowledge-candidates/${input.id}/decision`, action)).status).toBe(200)
    expect((await request(`knowledge-candidates/${input.id}/decision`, { ...action, note: '不同审核意见但试图重用标识' })).status).toBe(409)
    expect((await request(`knowledge-candidates/${input.id}/decision`, { ...action, decisionId: randomUUID() })).status).toBe(409)
  })
  it('atomically publishes a reviewed project version that a later requirement can search and resolve', async () => {
    const { input } = await submit(payload('知识飞轮复用规则')), action = decision()
    const result = await request(`knowledge-candidates/${input.id}/decision`, action)
    expect(result.status, JSON.stringify(result.data)).toBe(200)
    const published = KnowledgeCandidateDetailSchema.parse(result.data).candidate.publication!
    expect((await request(`knowledge-candidates/${input.id}/decision`, action)).status).toBe(200)
    expect((await database.pool.query('SELECT id FROM organization_knowledge_versions WHERE document_id=$1', [published.documentId])).rowCount).toBe(1)
    const search = await request('knowledge/search', { projectId: project, query: input.content.title }, 'member')
    expect(search.data.results).toEqual(expect.arrayContaining([expect.objectContaining({ versionId: published.versionId })]))
    const { version: _version, ...pin } = published
    const resolved = await request('knowledge/resolve', { projectId: project, pins: [pin], includeContent: true }, 'member')
    expect(resolved.status).toBe(200); expect(JSON.stringify(resolved.data)).toContain(input.content.body)
    await expect(database.pool.query("UPDATE organization_knowledge_candidates SET content='{}' WHERE id=$1", [input.id])).rejects.toThrow(/immutable/)
    const pending = await submit(payload('禁止伪造发布引用'))
    await expect(database.pool.query(`UPDATE organization_knowledge_candidates SET status='published',revision=2,
      reviewer_id=$2,reviewed_at=1,review_note='伪造发布引用应被数据库拒绝',decision_id=$3,decision_hash=$4,publication=$5 WHERE id=$1`,
    [pending.input.id, accounts.owner, randomUUID(), 'a'.repeat(64), JSON.stringify(published)])).rejects.toThrow(/exact reviewed/)
  })
  it('requires explicit duplicate acknowledgment and keeps a failed publication pending without half-created versions', async () => {
    const first = await submit(payload('重复内容确认规则'))
    const published = KnowledgeCandidateDetailSchema.parse((await request(`knowledge-candidates/${first.input.id}/decision`, decision())).data).candidate.publication!
    const second = await submit({ ...first.input, id: randomUUID(), source: source() })
    expect(second.detail.related).toEqual(expect.arrayContaining([expect.objectContaining({ documentId: published.documentId, exactContent: true })]))
    expect((await request(`knowledge-candidates/${second.input.id}/decision`, decision())).status).toBe(409)
    expect(KnowledgeCandidateDetailSchema.parse((await request(`knowledge-candidates/${second.input.id}`)).data).candidate.status).toBe('pending')
    const approved = await request(`knowledge-candidates/${second.input.id}/decision`, { ...decision(), acknowledgedDuplicateIds: [published.documentId] })
    expect(approved.status).toBe(200)
  })
  it('conflicts on a stale document head and serializes competing version publications', async () => {
    const initial = await submit(payload('版本冲突规则'))
    const pub = KnowledgeCandidateDetailSchema.parse((await request(`knowledge-candidates/${initial.input.id}/decision`, decision())).data).candidate.publication!
    const a = await submit(payload('后续版本甲')), b = await submit(payload('后续版本乙'))
    const target = { kind: 'version', documentId: pub.documentId, expectedVersionId: pub.versionId }
    const results = await Promise.all([
      request(`knowledge-candidates/${a.input.id}/decision`, { ...decision(), target: { ...target, version: '1.1.0' } }),
      request(`knowledge-candidates/${b.input.id}/decision`, { ...decision(), target: { ...target, version: '1.2.0' } }),
    ])
    expect(results.map(item => item.status).sort()).toEqual([200, 409])
    expect((await database.pool.query('SELECT id FROM organization_knowledge_versions WHERE document_id=$1', [pub.documentId])).rowCount).toBe(2)
  })
  it('rechecks project permission after waiting for the organization lock and survives server restart', async () => {
    const client = await database.pool.connect()
    await client.query('BEGIN'); await client.query('SELECT id FROM organization WHERE id=$1 FOR UPDATE', [org])
    const pending = request('knowledge-candidates', payload('撤权后禁止提交'), 'member')
    await new Promise(done => setTimeout(done, 100))
    await client.query("UPDATE organization_project_members SET role='viewer' WHERE organization_id=$1 AND account_id=$2", [org, accounts.member])
    await client.query('COMMIT'); client.release()
    expect((await pending).status).toBe(403)
    await server.close(); await start()
    expect((await request('knowledge-candidates')).status).toBe(200)
    await database.pool.query("UPDATE organization_project_members SET role='contributor' WHERE organization_id=$1 AND account_id=$2", [org, accounts.member])
  })
})
