import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { AssignmentCreateSchema, AssignmentCommandSchema, AssignmentDetailSchema, AssignmentListSchema, AssignmentRosterSchema,
  AssignmentCommandReceiptSchema, AssignmentAuthorityInputSchema, AssignmentAuthoritySchema, ProjectRoleSchema, OrgRoleSchema,
  canProject, type AssignmentCreate, type AssignmentCommand } from '@projectos/organization-contracts'
import { inTransaction, audit } from './postgres-store.js'
import { AssetScopeError } from './assets-api.js'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const absent = () => new AssetScopeError(404, 'RESOURCE_NOT_IN_SCOPE', '分配不存在，或你没有访问权限。')
const denied = (message = '你没有此操作的项目权限。') => new AssetScopeError(403, 'PROJECT_FORBIDDEN', message)
const conflict = (message = '分配或审核版本已改变，请刷新后核对。') => new AssetScopeError(409, 'CONFLICT', message)
type Row = Record<string, unknown> & { id: string; organization_id: string; project_id: string; dispatcher_id: string; assignee_id: string;
  brief: AssignmentCreate['brief']; status: string; revision: number; claim: { clientId: string; claimRef: string; acceptedAt: number } | null; latest_report_id: string | null }
const FIELDS = 'a.*,p.name AS project_name,u.name AS assignee_name,d.name AS dispatcher_name'
const FROM = `FROM organization_assignments a
  JOIN organization_projects p ON p.organization_id=a.organization_id AND p.id=a.project_id
  JOIN "user" u ON u.id=a.assignee_id JOIN "user" d ON d.id=a.dispatcher_id`
const SELECT = `SELECT ${FIELDS} ${FROM}`

export class OrganizationAssignments {
  constructor(private readonly pool: Pool) {}
  private scope<T>(org: string, actor: string, action: (client: PoolClient) => Promise<T>) {
    return inTransaction(this.pool, async client => {
      await client.query('SELECT id FROM organization WHERE id=$1 FOR UPDATE', [org])
      if (!OrgRoleSchema.safeParse((await client.query('SELECT role FROM member WHERE "organizationId"=$1 AND "userId"=$2 FOR SHARE', [org, actor])).rows[0]?.role).success)
        throw new AssetScopeError(403, 'ORG_FORBIDDEN', '你没有此组织的访问权限。')
      return action(client)
    })
  }
  private async project(client: PoolClient, org: string, project: string, actor: string) {
    const role = ProjectRoleSchema.safeParse((await client.query(`SELECT m.role FROM organization_project_members m JOIN organization_projects p
      ON p.organization_id=m.organization_id AND p.id=m.project_id JOIN member om ON om."organizationId"=m.organization_id AND om."userId"=m.account_id
      WHERE m.organization_id=$1 AND m.project_id=$2 AND m.account_id=$3 AND p.status='active' FOR SHARE OF m,p,om`, [org, project, actor])).rows[0]?.role)
    if (!role.success) throw absent()
    return role.data
  }
  private async recipient(client: PoolClient, org: string, project: string, actor: string) {
    if (!canProject(await this.project(client, org, project, actor), 'project.write_requirement')) throw denied('接收人需要当前项目的需求开发权限。')
  }
  private async row(client: PoolClient, org: string, actor: string, id: string) {
    const row = (await client.query<Row>(SELECT + ' WHERE a.organization_id=$1 AND a.id=$2 FOR UPDATE OF a', [org, id])).rows[0]
    if (!row) throw absent()
    const role = await this.project(client, org, row.project_id, actor), canManage = canProject(role, 'project.assign_work')
    if (!canManage && row.assignee_id !== actor) throw absent()
    return { row, canManage, canRespond: row.assignee_id === actor && canProject(role, 'project.write_requirement') }
  }
  private async view(client: PoolClient, row: Row, canManage: boolean, canRespond: boolean) {
    const report = row.latest_report_id ? (await client.query('SELECT * FROM organization_assignment_reports WHERE assignment_id=$1 AND id=$2', [row.id, row.latest_report_id])).rows[0] : null
    const history = (await client.query(`SELECT c.id AS "commandId",c.action,json_build_object('id',u.id,'name',u.name) AS actor,c.note,
      (c.receipt->>'revision')::integer AS revision,c.created_at AS "createdAt" FROM organization_assignment_commands c JOIN "user" u ON u.id=c.actor_id
      WHERE c.assignment_id=$1 ORDER BY c.created_at DESC,c.id DESC LIMIT 100`, [row.id])).rows.map(item => ({ ...item, createdAt: Number(item.createdAt) }))
    return AssignmentDetailSchema.parse({ assignment: { id: row.id, organizationId: row.organization_id, projectId: row.project_id, projectName: row.project_name,
      title: row.brief.title, priority: row.brief.priority, dueAt: row.brief.dueAt, brief: row.brief, briefChecksum: row.brief_checksum, creationHash: row.creation_hash,
      assignee: { id: row.assignee_id, name: row.assignee_name }, dispatcher: { id: row.dispatcher_id, name: row.dispatcher_name },
      status: row.status, revision: row.revision, claim: row.claim, replacesId: row.replaces_id, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), canManage, canRespond,
      report: report ? { id: report.id, authorId: report.author_id, kind: report.kind, ...report.payload, createdAt: Number(report.created_at) } : null }, history })
  }
  async detail(org: string, actor: string, id: string) {
    return this.scope(org, actor, async client => { const item = await this.row(client, org, actor, id); return this.view(client, item.row, item.canManage, item.canRespond) })
  }
  async list(org: string, actor: string) {
    return this.scope(org, actor, async client => {
      const rows = (await client.query<Row & { role: string }>(`SELECT ${FIELDS},m.role ${FROM} JOIN organization_project_members m ON m.organization_id=a.organization_id AND m.project_id=a.project_id AND m.account_id=$2
        WHERE a.organization_id=$1 AND p.status='active' AND (a.assignee_id=$2 OR m.role IN ('owner','maintainer')) ORDER BY a.created_at DESC,a.id DESC LIMIT 101`, [org, actor])).rows
      return AssignmentListSchema.parse({ truncated: rows.length > 100, assignments: rows.slice(0, 100).map(row => ({ id: row.id, organizationId: org, projectId: row.project_id,
        projectName: row.project_name, title: row.brief.title, priority: row.brief.priority, dueAt: row.brief.dueAt, assignee: { id: row.assignee_id, name: row.assignee_name },
        dispatcher: { id: row.dispatcher_id, name: row.dispatcher_name }, status: row.status, revision: row.revision, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
        canManage: canProject(ProjectRoleSchema.parse(row.role), 'project.assign_work'), canRespond: actor === row.assignee_id && canProject(ProjectRoleSchema.parse(row.role), 'project.write_requirement') })) })
    })
  }
  async roster(org: string, actor: string, project: string) {
    return this.scope(org, actor, async client => {
      if (!canProject(await this.project(client, org, project, actor), 'project.assign_work')) throw denied()
      return AssignmentRosterSchema.parse({ projectId: project, members: (await client.query(`SELECT u.id,u.name,m.role FROM organization_project_members m
        JOIN "user" u ON u.id=m.account_id JOIN member om ON om."organizationId"=m.organization_id AND om."userId"=m.account_id
        WHERE m.organization_id=$1 AND m.project_id=$2 AND m.role IN ('owner','maintainer','contributor') ORDER BY u.name,u.id LIMIT 200`, [org, project])).rows })
    })
  }
  private async insert(client: PoolClient, org: string, actor: string, input: AssignmentCreate, replacesId: string | null = null) {
    await this.recipient(client, org, input.projectId, input.assigneeId)
    await client.query(`INSERT INTO organization_assignments(id,organization_id,project_id,dispatcher_id,assignee_id,brief,brief_checksum,creation_hash,replaces_id,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`, [input.id, org, input.projectId, actor, input.assigneeId, JSON.stringify(input.brief), hash(input.brief), hash(input), replacesId, Date.now()])
    await audit(client, actor, org, 'assignment.dispatched', input.id, { projectId: input.projectId, assigneeId: input.assigneeId, briefChecksum: hash(input.brief), replacesId })
  }
  async create(org: string, actor: string, raw: unknown) {
    const input = AssignmentCreateSchema.parse(raw)
    return this.scope(org, actor, async client => {
      if (!canProject(await this.project(client, org, input.projectId, actor), 'project.assign_work')) throw denied()
      const old = (await client.query('SELECT organization_id,dispatcher_id,creation_hash FROM organization_assignments WHERE id=$1', [input.id])).rows[0]
      if (old) { if (old.organization_id !== org || old.dispatcher_id !== actor) throw absent(); if (old.creation_hash !== hash(input)) throw conflict('派发标识已经绑定其他需求内容。') }
      else await this.insert(client, org, actor, input)
      const item = await this.row(client, org, actor, input.id)
      return this.view(client, item.row, item.canManage, item.canRespond)
    })
  }
  async receipt(org: string, actor: string, assignmentId: string, commandId: string) {
    return this.scope(org, actor, async client => {
      await this.row(client, org, actor, assignmentId)
      const item = (await client.query('SELECT receipt FROM organization_assignment_commands WHERE id=$1 AND assignment_id=$2 AND actor_id=$3', [commandId, assignmentId, actor])).rows[0]
      if (!item) throw absent()
      return AssignmentCommandReceiptSchema.parse(item.receipt)
    })
  }
  async command(org: string, actor: string, id: string, raw: unknown) {
    const input = AssignmentCommandSchema.parse(raw), payloadHash = hash(input)
    return this.scope(org, actor, async client => {
      const { row, canManage, canRespond } = await this.row(client, org, actor, id)
      const manager = ['cancel', 'reassign', 'accept_delivery', 'request_changes'].includes(input.action)
      if (manager ? !canManage : !canRespond) throw denied()
      const old = (await client.query('SELECT * FROM organization_assignment_commands WHERE id=$1', [input.commandId])).rows[0]
      if (old) {
        if (old.organization_id !== org || old.assignment_id !== id || old.actor_id !== actor) throw absent()
        if (old.payload_hash !== payloadHash) throw conflict('操作标识已经绑定其他内容。')
        return AssignmentCommandReceiptSchema.parse(old.receipt)
      }
      if (row.revision !== input.expectedRevision) throw conflict()
      let status = row.status, claim = row.claim, reportId = row.latest_report_id, newAssignmentId: string | null = null
      const working = () => { if (!['accepted', 'in_progress'].includes(row.status)) throw conflict('当前分配不能继续开发，请先核对状态。') }
      const ownClaim = (input: Extract<AssignmentCommand, { claim: unknown }>) => {
        if (!row.claim || input.claim.clientId !== row.claim.clientId || input.claim.claimRef !== row.claim.claimRef) throw conflict('分配已由另一桌面接收，请使用原接收桌面。')
      }
      switch (input.action) {
        case 'accept': if (row.status !== 'pending') throw conflict('分配已经被接收或关闭。'); claim = { ...input.claim, acceptedAt: Date.now() }; status = 'accepted'; break
        case 'decline': if (row.status !== 'pending') throw conflict(); status = 'declined'; break
        case 'cancel': if (!['pending', 'accepted', 'in_progress', 'ready_for_review'].includes(row.status)) throw conflict(); status = 'cancelled'; break
        case 'reassign': {
          if (['completed', 'reassigned'].includes(row.status) || input.assigneeId === row.assignee_id) throw conflict()
          newAssignmentId = input.newAssignmentId
          await this.insert(client, org, actor, { id: newAssignmentId, projectId: row.project_id, assigneeId: input.assigneeId, brief: row.brief }, id)
          status = 'reassigned'; break
        }
        case 'progress': case 'delivery': {
          working(); ownClaim(input)
          if (input.action === 'delivery' && (input.counts.total < 1 || input.counts.done !== input.counts.total || input.counts.runningRuns)) throw conflict('需求任务必须完成，且需要独立的本机整体验收。')
          reportId = input.commandId
          await client.query(`INSERT INTO organization_assignment_reports(id,organization_id,assignment_id,author_id,kind,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [reportId, org, id, actor, input.action, JSON.stringify({ counts: input.counts, note: input.note, source: input.action === 'delivery' ? input.source : null }), Date.now()])
          status = input.action === 'delivery' ? 'ready_for_review' : 'in_progress'; break
        }
        case 'withdraw': if (row.status !== 'ready_for_review') throw conflict(); status = 'accepted'; break
        case 'accept_delivery': case 'request_changes':
          if (row.status !== 'ready_for_review' || row.latest_report_id !== input.expectedReportId) throw conflict()
          status = input.action === 'accept_delivery' ? 'completed' : 'accepted'; break
      }
      await client.query('UPDATE organization_assignments SET status=$2,revision=revision+1,claim=$3,latest_report_id=$4,updated_at=$5 WHERE id=$1',
        [id, status, claim ? JSON.stringify(claim) : null, reportId, Date.now()])
      const receipt = AssignmentCommandReceiptSchema.parse({ commandId: input.commandId, assignmentId: id, organizationId: org, actorId: actor, payloadHash,
        revision: row.revision + 1, status, newAssignmentId, createdAt: Date.now() })
      await client.query(`INSERT INTO organization_assignment_commands(id,organization_id,assignment_id,actor_id,payload_hash,action,note,receipt,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [input.commandId, org, id, actor, payloadHash, input.action, 'note' in input ? input.note : null, JSON.stringify(receipt), receipt.createdAt])
      await audit(client, actor, org, `assignment.${input.action}`, id, { commandId: input.commandId, revision: receipt.revision, reportId, newAssignmentId })
      return receipt
    })
  }
  async authority(org: string, actor: string, raw: unknown) {
    const input = AssignmentAuthorityInputSchema.parse(raw)
    return this.scope(org, actor, async client => {
      const { row, canRespond } = await this.row(client, org, actor, input.assignmentId)
      if (!canRespond || row.project_id !== input.projectId) throw denied()
      const allowed = input.purpose === 'knowledge' ? ['accepted', 'in_progress', 'ready_for_review', 'completed'] : ['accepted', 'in_progress']
      if (!allowed.includes(row.status) || !row.claim || row.claim.clientId !== input.claim.clientId || row.claim.claimRef !== input.claim.claimRef) throw conflict('分配已关闭、待验收，或不属于此接收桌面。')
      return AssignmentAuthoritySchema.parse({ assignmentId: row.id, projectId: row.project_id, assigneeId: actor, claim: input.claim, briefChecksum: row.brief_checksum, revision: row.revision, status: row.status, purpose: input.purpose })
    })
  }
}

export function registerOrganizationAssignments(app: FastifyInstance, pool: Pool, accountFor: (auth: string | undefined, reply: FastifyReply) => Promise<{ id: string } | null>) {
  const service = new OrganizationAssignments(pool), prefix = '/v1/organizations/:orgId/assignments'
  const params = z.object({ orgId: z.string().min(1).max(128), id: z.uuid().optional(), commandId: z.uuid().optional() })
  app.get(prefix, async (request, reply) => { const actor = await accountFor(request.headers.authorization, reply); if (actor) return service.list(params.parse(request.params).orgId, actor.id) })
  app.post(prefix, async (request, reply) => { const actor = await accountFor(request.headers.authorization, reply); if (actor) return service.create(params.parse(request.params).orgId, actor.id, request.body) })
  app.get(prefix + '/roster/:projectId', async (request, reply) => { const actor = await accountFor(request.headers.authorization, reply); if (actor) { const p = z.object({ orgId: z.string().min(1).max(128), projectId: z.string().min(1).max(128) }).parse(request.params); return service.roster(p.orgId, actor.id, p.projectId) } })
  app.get(prefix + '/:id', async (request, reply) => { const actor = await accountFor(request.headers.authorization, reply); if (actor) { const p = params.parse(request.params); return service.detail(p.orgId, actor.id, p.id!) } })
  app.post(prefix + '/:id/commands', async (request, reply) => { const actor = await accountFor(request.headers.authorization, reply); if (actor) { const p = params.parse(request.params); return service.command(p.orgId, actor.id, p.id!, request.body) } })
  app.get(prefix + '/:id/commands/:commandId', async (request, reply) => { const actor = await accountFor(request.headers.authorization, reply); if (actor) { const p = params.parse(request.params); return service.receipt(p.orgId, actor.id, p.id!, p.commandId!) } })
  app.post(prefix + '/authority', async (request, reply) => { const actor = await accountFor(request.headers.authorization, reply); if (actor) return service.authority(params.parse(request.params).orgId, actor.id, request.body) })
}
