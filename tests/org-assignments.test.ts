import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AssignmentDetailSchema, AssignmentListSchema, AssignmentRosterSchema, AssignmentCommandReceiptSchema,
  AssignmentCreateSchema, AssignmentHumanDecisionSchema, type AssignmentCreate } from '@projectos/organization-contracts'
import { startOrganizationTestDatabase, reserveOrganizationTestPort } from './helpers/org-postgres.js'
import { migrateOrganizationDatabase, postgresTokens } from '../apps/server/src/postgres-store.js'
import { buildOrganizationServer } from '../apps/server/src/persistent-server.js'

describe('K4 member assignments — actual PostgreSQL / HTTP', () => {
  let database: Awaited<ReturnType<typeof startOrganizationTestDatabase>>, server: Awaited<ReturnType<typeof buildOrganizationServer>>, origin: string, previous: unknown
  const org = randomUUID(), other = randomUUID(), project = randomUUID()
  const accounts = { owner: randomUUID(), leader: randomUUID(), member: randomUUID(), peer: randomUUID(), viewer: randomUUID(), admin: randomUUID(), foreign: randomUUID() }
  const tokens = new Map<string, string>()
  const claim = () => ({ clientId: randomUUID(), claimRef: randomUUID() })
  const input = (title = '退款业务开发'): AssignmentCreate => ({ id: randomUUID(), projectId: project, assigneeId: accounts.member,
    brief: { title, body: '依据项目技术和业务资料，实现本次退款需求；未知业务规则先人工确认。', acceptanceCriteria: ['实际测试通过', '原渠道退款且不能重复退款'], priority: 'high', dueAt: Date.now() + 86400_000 } })
  async function start() { server = await buildOrganizationServer({ databaseUrl: database.databaseUrl, baseURL: origin, secret: 'member-assignment-tests-isolated-secret-0123456789', rateLimit: { max: 10000, authenticationMax: 100, windowMs: 60000 } }); await server.listen({ host: '127.0.0.1', port: Number(new URL(origin).port) }) }
  async function request(path = '', body?: unknown, actor: keyof typeof accounts = 'owner', organization = org) {
    const response = await fetch(`${origin}/v1/organizations/${organization}/assignments${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${tokens.get(actor)}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, data: await response.json() as Record<string, unknown> }
  }
  async function create(value = input()) { const result = await request('', value, 'leader'); expect(result.status, JSON.stringify(result.data)).toBe(200); return AssignmentDetailSchema.parse(result.data).assignment }
  async function accepted() {
    const assignment = await create(), binding = claim(), command = { commandId: randomUUID(), action: 'accept', expectedRevision: 1, claim: binding }
    const result = await request(`/${assignment.id}/commands`, command, 'member'); expect(result.status).toBe(200)
    return { assignment, binding, command, revision: AssignmentCommandReceiptSchema.parse(result.data).revision }
  }
  const counts = { total: 1, done: 1, active: 0, blocked: 0, runningRuns: 0 }
  const source = () => ({ kind: 'desktop-owner-attested', requirementVersion: 3, acceptanceId: randomUUID(), fingerprint: 'a'.repeat(64), acceptedAt: Date.now(), acceptanceNote: '已核对需求分支、实际测试和人工整体验收记录',
    artifacts: [{ id: 'artifact_local', taskId: 'task_local', runId: 'run_local', title: '退款交付说明', checksum: 'b'.repeat(64) }], commits: ['c'.repeat(40)] })
  beforeAll(async () => {
    database = await startOrganizationTestDatabase(); await migrateOrganizationDatabase(database.pool, 6)
    previous = (await database.pool.query('SELECT version,checksum FROM organization_schema_migrations ORDER BY version')).rows
    for (const [name, id] of Object.entries(accounts)) {
      await database.pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)', [id, name, `${name}@assignment-test.invalid`])
      const token = randomBytes(48).toString('base64url'); tokens.set(name, token)
      await postgresTokens(database.pool).issue(createHash('sha256').update(token).digest('base64url'), { accountId: id, expiresAt: Date.now() + 900_000 })
    }
    for (const id of [org, other]) await database.pool.query('INSERT INTO organization(id,name,slug,"createdAt") VALUES($1,$1,$1,now())', [id])
    for (const [name, id] of Object.entries(accounts)) await database.pool.query('INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())', [randomUUID(), name === 'foreign' ? other : org, id, name === 'owner' ? 'owner' : name === 'admin' ? 'admin' : 'member'])
    await database.pool.query('INSERT INTO organization_projects(id,organization_id,key,name,created_at,updated_at) VALUES($1,$2,$1,$1,1,1)', [project, org])
    for (const name of ['owner', 'leader', 'member', 'peer', 'viewer'] as const) await database.pool.query('INSERT INTO organization_project_members(id,organization_id,project_id,account_id,role,created_at) VALUES($1,$2,$3,$4,$5,1)', [randomUUID(), org, project, accounts[name], name === 'owner' ? 'owner' : name === 'leader' ? 'maintainer' : name === 'viewer' ? 'viewer' : 'contributor'])
    await migrateOrganizationDatabase(database.pool); origin = `http://127.0.0.1:${await reserveOrganizationTestPort()}`; await start()
  }, 90_000)
  afterAll(async () => { await server?.close(); await database?.stop() }, 30_000)
  it('preserves migrations 1–6 and appends migration 7', async () => {
    expect((await database.pool.query('SELECT version,checksum FROM organization_schema_migrations WHERE version<=6 ORDER BY version')).rows).toEqual(previous)
    expect((await database.pool.query('SELECT max(version) AS version FROM organization_schema_migrations')).rows[0].version).toBe(7)
  })
  it('rejects secrets/paths in structural fields and forbids Renderer-supplied execution proof', () => {
    const value = input()
    expect(AssignmentCreateSchema.safeParse({ ...value, rootPath: 'C:/private' }).success).toBe(false)
    expect(AssignmentCreateSchema.safeParse({ ...value, brief: { ...value.brief, body: 'sk-' + 'a'.repeat(30) } }).success).toBe(false)
    expect(AssignmentHumanDecisionSchema.safeParse({ action: 'accept', commandId: randomUUID(), expectedRevision: 1, claim: claim() }).success).toBe(false)
    expect(AssignmentHumanDecisionSchema.safeParse({ action: 'delivery', commandId: randomUUID(), expectedRevision: 1, source: source(), counts, claim: claim(), note: '伪造客户端交付来源必须被拒绝' }).success).toBe(false)
  })
  it('requires independent project dispatch permission and an eligible active recipient', async () => {
    expect((await request('', input(), 'member')).status).toBe(403)
    expect((await request('', input(), 'admin')).status).toBe(404)
    expect((await request('', { ...input(), assigneeId: accounts.viewer }, 'leader')).status).toBe(403)
    expect((await request('', { ...input(), assigneeId: accounts.foreign }, 'leader')).status).toBe(404)
    const roster = await request(`/roster/${project}`, undefined, 'leader')
    expect(AssignmentRosterSchema.parse(roster.data).members.map(m => m.id)).toEqual(expect.arrayContaining([accounts.member, accounts.peer]))
    expect(JSON.stringify(roster.data)).not.toContain(accounts.viewer)
    expect((await request(`/roster/${project}`, undefined, 'member')).status).toBe(403)
  })
  it('freezes briefs and deduplicates dispatch while isolating members and organizations', async () => {
    const value = input(), results = await Promise.all([request('', value, 'leader'), request('', value, 'leader')])
    expect(results.map(r => r.status)).toEqual([200, 200])
    expect((await request('', { ...value, brief: { ...value.brief, title: '变更旧标识内容' } }, 'leader')).status).toBe(409)
    expect((await request(`/${value.id}`, undefined, 'member')).status).toBe(200)
    expect((await request(`/${value.id}`, undefined, 'peer')).status).toBe(404)
    expect((await request(`/${value.id}`, undefined, 'foreign')).status).toBe(403)
    expect(AssignmentListSchema.parse((await request('', undefined, 'peer')).data).assignments).toEqual([])
    await expect(database.pool.query("UPDATE organization_assignments SET brief='{}' WHERE id=$1", [value.id])).rejects.toThrow(/immutable/)
    expect((await database.pool.query("SELECT id FROM organization_audit_events WHERE subject_id=$1 AND operation='assignment.dispatched'", [value.id])).rowCount).toBe(1)
  })
  it('serializes two desktops accepting one assignment and replays only the identical command', async () => {
    const a = await create(), command = { commandId: randomUUID(), action: 'accept', expectedRevision: 1, claim: claim() }
    const commands = [command, { ...command, commandId: randomUUID(), claim: claim() }]
    const values = await Promise.all(commands.map(command => request(`/${a.id}/commands`, command, 'member')))
    expect(values.map(v => v.status).sort()).toEqual([200, 409])
    const winner = AssignmentDetailSchema.parse((await request(`/${a.id}`, undefined, 'member')).data).assignment
    const winning = commands[values.findIndex(value => value.status === 200)]!
    expect((await request(`/${a.id}/commands`, winning, 'member')).status).toBe(200)
    expect((await request(`/${a.id}/commands`, { ...winning, claim: claim() }, 'member')).status).toBe(409)
    expect((await request(`/${a.id}/commands/${winning.commandId}`, undefined, 'member')).status).toBe(200)
    expect((await request(`/${a.id}/commands/${winning.commandId}`, undefined, 'owner')).status).toBe(404)
    expect((await request('/authority', { assignmentId: a.id, projectId: project, claim: winner.claim }, 'member')).status).toBe(400)
    const { acceptedAt: _time, ...binding } = winner.claim!
    expect((await request('/authority', { assignmentId: a.id, projectId: project, claim: binding }, 'member')).status).toBe(200)
    expect((await request('/authority', { assignmentId: a.id, projectId: project, claim: claim() }, 'member')).status).toBe(409)
  })
  it('retains declines and safely reassigns to a new pending identity', async () => {
    const a = await create()
    const decline = { commandId: randomUUID(), expectedRevision: 1, action: 'decline', note: '当前排期不适合接收，建议重新分配成员' }
    expect((await request(`/${a.id}/commands`, decline, 'member')).status).toBe(200)
    expect((await request(`/${a.id}/commands`, decline, 'member')).status).toBe(200)
    const nextId = randomUUID(), reassign = { commandId: randomUUID(), expectedRevision: 2, action: 'reassign', newAssignmentId: nextId, assigneeId: accounts.peer, note: '调整成员排期，保持原需求与验收范围' }
    expect((await request(`/${a.id}/commands`, reassign, 'leader')).status).toBe(200)
    expect((await request(`/${a.id}/commands`, reassign, 'leader')).status).toBe(200)
    expect(AssignmentDetailSchema.parse((await request(`/${a.id}`, undefined, 'member')).data).assignment.status).toBe('reassigned')
    const next = AssignmentDetailSchema.parse((await request(`/${nextId}`, undefined, 'peer')).data).assignment
    expect(next).toMatchObject({ brief: a.brief, replacesId: a.id, status: 'pending', revision: 1, claim: null })
    expect((await request(`/${nextId}`, undefined, 'member')).status).toBe(404)
  })
  it('rolls back failed reassignment and immediately revokes cancelled execution authority', async () => {
    const f = await accepted()
    const reassign = { commandId: randomUUID(), expectedRevision: f.revision, action: 'reassign', newAssignmentId: randomUUID(), assigneeId: accounts.foreign, note: '无权限目标不得留下半条重新分配记录' }
    expect((await request(`/${f.assignment.id}/commands`, reassign, 'leader')).status).toBe(404)
    expect((await database.pool.query('SELECT id FROM organization_assignments WHERE id=$1', [reassign.newAssignmentId])).rowCount).toBe(0)
    const cancel = { commandId: randomUUID(), expectedRevision: f.revision, action: 'cancel', note: '需求范围已经调整，暂停原分配的后续开发' }
    expect((await request(`/${f.assignment.id}/commands`, cancel, 'peer')).status).toBe(404)
    expect((await request(`/${f.assignment.id}/commands`, cancel, 'leader')).status).toBe(200)
    expect((await request('/authority', { assignmentId: f.assignment.id, projectId: project, claim: f.binding }, 'member')).status).toBe(409)
  })
  it('keeps task/run progress separate from independent delivery and manager acceptance', async () => {
    const f = await accepted(), progress = { commandId: randomUUID(), action: 'progress', expectedRevision: 2, claim: f.binding, counts, note: '任务运行完成，仍需本机整体和负责人分别验收' }
    expect(AssignmentCommandReceiptSchema.parse((await request(`/${f.assignment.id}/commands`, progress, 'member')).data).status).toBe('in_progress')
    expect((await request(`/${f.assignment.id}/commands`, { commandId: randomUUID(), action: 'accept_delivery', expectedRevision: 3, expectedReportId: progress.commandId, note: '不能把任务完成自动视作需求验收成功' }, 'leader')).status).toBe(409)
    const delivery = { commandId: randomUUID(), action: 'delivery', expectedRevision: 3, claim: f.binding, counts, source: source(), note: '已完成独立整体验收，提交不可变成果引用供负责人审核' }
    expect((await request(`/${f.assignment.id}/commands`, { ...delivery, source: undefined }, 'member')).status).toBe(400)
    expect(AssignmentCommandReceiptSchema.parse((await request(`/${f.assignment.id}/commands`, delivery, 'member')).data).status).toBe('ready_for_review')
    expect((await request('/authority', { assignmentId: f.assignment.id, projectId: project, claim: f.binding }, 'member')).status).toBe(409)
    const review = { commandId: randomUUID(), action: 'accept_delivery', expectedRevision: 4, expectedReportId: delivery.commandId, note: '负责人已核对本次交付引用及原需求验收标准' }
    expect((await request(`/${f.assignment.id}/commands`, { ...review, expectedReportId: randomUUID() }, 'leader')).status).toBe(409)
    expect((await request(`/${f.assignment.id}/commands`, review, 'member')).status).toBe(403)
    expect(AssignmentCommandReceiptSchema.parse((await request(`/${f.assignment.id}/commands`, review, 'leader')).data).status).toBe('completed')
    expect((await request(`/${f.assignment.id}/commands`, review, 'leader')).status).toBe(200)
    expect((await request(`/${f.assignment.id}/commands`, { commandId: randomUUID(), action: 'reassign', expectedRevision: 5, newAssignmentId: randomUUID(), assigneeId: accounts.peer, note: '已完成分配不能继续原地重新分配给其他成员' }, 'leader')).status).toBe(409)
    await expect(database.pool.query('DELETE FROM organization_assignment_reports WHERE id=$1', [delivery.commandId])).rejects.toThrow(/immutable/)
  })
  it('supports explicit delivery withdrawal and requests for changes without erasing reports', async () => {
    const f = await accepted()
    const deliver = async (revision: number) => {
      const command = { commandId: randomUUID(), action: 'delivery', expectedRevision: revision, claim: f.binding, counts, source: source(), note: '当前需求成果已整体验收，提交负责人进一步复核' }
      expect((await request(`/${f.assignment.id}/commands`, command, 'member')).status).toBe(200); return command
    }
    await deliver(2)
    expect((await request(`/${f.assignment.id}/commands`, { commandId: randomUUID(), action: 'withdraw', expectedRevision: 3, note: '发现需要补充的边界情况，明确撤回本次待验收' }, 'member')).status).toBe(200)
    const second = await deliver(4)
    expect((await request(`/${f.assignment.id}/commands`, { commandId: randomUUID(), action: 'request_changes', expectedRevision: 5, expectedReportId: second.commandId, note: '请补充失败重试的测试证据后，再次提交验收' }, 'leader')).status).toBe(200)
    expect((await database.pool.query('SELECT id FROM organization_assignment_reports WHERE assignment_id=$1', [f.assignment.id])).rowCount).toBe(2)
    expect((await request('/authority', { assignmentId: f.assignment.id, projectId: project, claim: f.binding }, 'member')).status).toBe(200)
  })
  it('rechecks permission after waiting for the organization lock and retains history after restart', async () => {
    const client = await database.pool.connect()
    await client.query('BEGIN'); await client.query('SELECT id FROM organization WHERE id=$1 FOR UPDATE', [org])
    const pending = request('', input('排队期间撤回派发权'), 'leader')
    await new Promise(done => setTimeout(done, 100))
    await client.query("UPDATE organization_project_members SET role='viewer' WHERE organization_id=$1 AND account_id=$2", [org, accounts.leader])
    await client.query('COMMIT'); client.release()
    expect((await pending).status).toBe(403)
    await database.pool.query("UPDATE organization_project_members SET role='maintainer' WHERE organization_id=$1 AND account_id=$2", [org, accounts.leader])
    await server.close(); await start()
    const result = await request('', undefined, 'leader')
    expect(result.status, JSON.stringify(result.data)).toBe(200)
    expect(AssignmentListSchema.parse(result.data).assignments.length).toBeGreaterThan(0)
  })
})
