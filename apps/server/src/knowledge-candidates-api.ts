import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { canOrg, canProject, OrgRoleSchema, ProjectRoleSchema, canonicalKnowledgeContent,
  KnowledgeCandidateSubmitSchema, KnowledgeCandidateSchema, KnowledgeCandidateListSchema, KnowledgeCandidateDetailSchema,
  KnowledgeCandidateDecisionSchema, type KnowledgeCandidateSubmit, type OrgRole } from '@projectos/organization-contracts'
import { inTransaction, audit } from './postgres-store.js'
import { AssetScopeError } from './assets-api.js'
import { OrganizationKnowledge } from './knowledge-api.js'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const absent = () => new AssetScopeError(404, 'RESOURCE_NOT_IN_SCOPE', '候选不存在，或你没有访问权限。')
const conflict = (message = '候选或目标版本已改变，请刷新后核对。') => new AssetScopeError(409, 'CONFLICT', message)
type Row = Record<string, unknown> & { id: string; organization_id: string; project_id: string; author_id: string; payload_hash: string; status: string; revision: number; content: KnowledgeCandidateSubmit['content']; source: KnowledgeCandidateSubmit['source'] }

export class OrganizationKnowledgeCandidates {
  constructor(private readonly pool: Pool) {}
  private scope<T>(orgId: string, actor: string, action: (client: PoolClient, role: OrgRole) => Promise<T>) {
    return inTransaction(this.pool, async client => {
      await client.query('SELECT id FROM organization WHERE id=$1 FOR UPDATE', [orgId])
      const role = OrgRoleSchema.safeParse((await client.query('SELECT role FROM member WHERE "organizationId"=$1 AND "userId"=$2 FOR SHARE', [orgId, actor])).rows[0]?.role)
      if (!role.success) throw new AssetScopeError(403, 'ORG_FORBIDDEN', '你没有此组织的访问权限。')
      return action(client, role.data)
    })
  }
  private async project(client: PoolClient, orgId: string, actor: string, projectId: string) {
    const role = ProjectRoleSchema.safeParse((await client.query(`SELECT m.role FROM organization_project_members m JOIN organization_projects p
      ON p.id=m.project_id AND p.organization_id=m.organization_id WHERE m.organization_id=$1 AND m.project_id=$2 AND m.account_id=$3 AND p.status='active' FOR SHARE OF m,p`, [orgId, projectId, actor])).rows[0]?.role)
    if (!role.success) throw absent()
    return role.data
  }
  private async row(client: PoolClient, orgId: string, actor: string, role: OrgRole, id: string) {
    const row = (await client.query<Row>('SELECT c.*,u.name AS author_name FROM organization_knowledge_candidates c JOIN "user" u ON u.id=c.author_id WHERE c.organization_id=$1 AND c.id=$2 FOR UPDATE OF c', [orgId, id])).rows[0]
    if (!row) throw absent()
    const projectRole = await this.project(client, orgId, actor, row.project_id)
    const canReview = canOrg(role, 'org.publish_asset') && canProject(projectRole, 'project.manage_assets')
    if (actor !== row.author_id && !canReview) throw absent()
    return { row, canReview }
  }
  private view(row: Row, canReview: boolean) {
    return KnowledgeCandidateSchema.parse({ id: row.id, organizationId: row.organization_id, projectId: row.project_id,
      authorId: row.author_id, authorName: row.author_name, category: row.category, content: row.content, source: row.source,
      checksum: row.checksum, payloadHash: row.payload_hash, status: row.status, revision: row.revision, createdAt: Number(row.created_at),
      reviewerId: row.reviewer_id, reviewedAt: row.reviewed_at === null ? null : Number(row.reviewed_at), reviewNote: row.review_note,
      decisionId: row.decision_id, publication: row.publication, canReview })
  }
  private async related(client: PoolClient, row: Row) {
    return (await client.query(`SELECT d.id AS "documentId",v.id AS "versionId",v.version,v.checksum,v.title,
      (v.checksum=$3) AS "exactContent",EXISTS(SELECT 1 FROM organization_knowledge_candidates c WHERE c.organization_id=$1
        AND c.project_id=$2 AND c.acceptance_id=$5 AND c.status='published' AND c.publication->>'documentId'=d.id) AS "relatedAcceptance"
      FROM organization_knowledge_documents d JOIN LATERAL(SELECT * FROM organization_knowledge_versions v
        WHERE v.document_id=d.id AND v.status='published' ORDER BY v.published_at DESC,v.id DESC LIMIT 1) v ON true
      WHERE d.organization_id=$1 AND (d.project_id IS NULL OR d.project_id=$2) AND
      (v.checksum=$3 OR strpos(lower(v.title),lower($4))>0 OR strpos(lower($4),lower(v.title))>0 OR EXISTS(
        SELECT 1 FROM organization_knowledge_candidates c WHERE c.organization_id=$1 AND c.project_id=$2 AND c.acceptance_id=$5
        AND c.status='published' AND c.publication->>'documentId'=d.id))
      ORDER BY (v.checksum=$3) DESC,v.published_at DESC,v.id DESC LIMIT 11`,
    [row.organization_id, row.project_id, row.checksum, row.content.title, row.source.acceptanceId])).rows
  }
  private async detailIn(client: PoolClient, row: Row, canReview: boolean) {
    return KnowledgeCandidateDetailSchema.parse({ candidate: this.view(row, canReview), related: (await this.related(client, row)).slice(0, 10) })
  }
  async detail(org: string, actor: string, id: string) {
    return this.scope(org, actor, async (client, role) => { const { row, canReview } = await this.row(client, org, actor, role, id); return this.detailIn(client, row, canReview) })
  }
  async list(org: string, actor: string) {
    return this.scope(org, actor, async (client, role) => {
      const result = await client.query<Row & { can_review: boolean }>(`SELECT c.*,u.name AS author_name,($3::boolean AND m.role IN ('owner','maintainer')) AS can_review
        FROM organization_knowledge_candidates c JOIN "user" u ON u.id=c.author_id
        JOIN organization_projects p ON p.organization_id=c.organization_id AND p.id=c.project_id AND p.status='active'
        JOIN organization_project_members m ON m.organization_id=c.organization_id AND m.project_id=c.project_id AND m.account_id=$2
        WHERE c.organization_id=$1 AND (c.author_id=$2 OR ($3::boolean AND m.role IN ('owner','maintainer')))
        ORDER BY c.created_at DESC,c.id DESC LIMIT 100`, [org, actor, canOrg(role, 'org.publish_asset')])
      return KnowledgeCandidateListSchema.parse({ candidates: result.rows.map(row => {
        const { content, source, ...summary } = this.view(row, row.can_review)
        return { ...summary, title: content.title, requirementTitle: source.requirementTitle }
      }) })
    })
  }
  async submit(org: string, actor: string, raw: unknown) {
    const input = KnowledgeCandidateSubmitSchema.parse(raw), payloadHash = hash(input)
    return this.scope(org, actor, async (client, role) => {
      const projectRole = await this.project(client, org, actor, input.projectId)
      if (!canProject(projectRole, 'project.write_requirement')) throw new AssetScopeError(403, 'PROJECT_FORBIDDEN', '需要此项目的知识提交权限。')
      const existing = (await client.query('SELECT organization_id,author_id,payload_hash FROM organization_knowledge_candidates WHERE id=$1', [input.id])).rows[0]
      if (existing) {
        if (existing.organization_id !== org || existing.author_id !== actor) throw absent()
        if (existing.payload_hash !== payloadHash) throw conflict('提交标识已绑定其他内容，请先核对原提交。')
      } else {
        await client.query(`INSERT INTO organization_knowledge_candidates(id,organization_id,project_id,author_id,category,content,source,checksum,payload_hash,acceptance_id,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [input.id, org, input.projectId, actor, input.category,
          JSON.stringify(input.content), JSON.stringify(input.source), `sha256:${createHash('sha256').update(canonicalKnowledgeContent(input.content)).digest('hex')}`, payloadHash, input.source.acceptanceId, Date.now()])
        await audit(client, actor, org, 'knowledge.candidate_submitted', input.id, { projectId: input.projectId, payloadHash, acceptanceId: input.source.acceptanceId })
      }
      const { row, canReview } = await this.row(client, org, actor, role, input.id)
      return this.detailIn(client, row, canReview)
    })
  }
  async decide(org: string, actor: string, id: string, raw: unknown) {
    const input = KnowledgeCandidateDecisionSchema.parse(raw), decisionHash = hash(input)
    return this.scope(org, actor, async (client, role) => {
      const { row, canReview } = await this.row(client, org, actor, role, id)
      if (!canReview) throw new AssetScopeError(403, 'ORG_FORBIDDEN', '需要组织知识发布权限及此项目资产管理权限。')
      if (row.decision_id === input.decisionId) {
        if (row.decision_hash !== decisionHash || row.reviewer_id !== actor) throw conflict()
        return this.detailIn(client, row, canReview)
      }
      if (row.status !== 'pending' || row.revision !== input.expectedRevision) throw conflict()
      let publication = null
      if (input.action === 'publish') {
        const duplicates = (await this.related(client, row)).filter(item => item.exactContent && (input.target.kind === 'new' || item.documentId !== input.target.documentId))
        if (duplicates.length > 10 || duplicates.some(item => !input.acknowledgedDuplicateIds.includes(String(item.documentId)))) throw conflict('存在相同已发布内容，请刷新候选并核对重复资料。')
        publication = await new OrganizationKnowledge(this.pool).publishReviewed(client, org, actor, role,
          KnowledgeCandidateSubmitSchema.parse({ id, projectId: row.project_id, category: row.category, content: row.content, source: row.source }), input.target)
      }
      await client.query(`UPDATE organization_knowledge_candidates SET status=$2,revision=revision+1,reviewer_id=$3,reviewed_at=$4,
        review_note=$5,decision_id=$6,decision_hash=$7,publication=$8 WHERE id=$1`,
      [id, publication ? 'published' : 'returned', actor, Date.now(), input.note, input.decisionId, decisionHash, publication ? JSON.stringify(publication) : null])
      await audit(client, actor, org, `knowledge.candidate_${publication ? 'published' : 'returned'}`, id, { decisionId: input.decisionId, publication, revision: row.revision + 1 })
      const next = await this.row(client, org, actor, role, id)
      return this.detailIn(client, next.row, next.canReview)
    })
  }
}

export function registerKnowledgeCandidates(app: FastifyInstance, pool: Pool, accountFor: (auth: string | undefined, reply: FastifyReply) => Promise<{ id: string } | null>) {
  const service = new OrganizationKnowledgeCandidates(pool), prefix = '/v1/organizations/:orgId/knowledge-candidates'
  const params = z.object({ orgId: z.string().min(1).max(128), id: z.uuid().optional() })
  app.get(prefix, async (request, reply) => { const actor = await accountFor(request.headers.authorization, reply); if (actor) return service.list(params.parse(request.params).orgId, actor.id) })
  app.post(prefix, async (request, reply) => { const actor = await accountFor(request.headers.authorization, reply); if (actor) return service.submit(params.parse(request.params).orgId, actor.id, request.body) })
  app.get(prefix + '/:id', async (request, reply) => { const actor = await accountFor(request.headers.authorization, reply); if (actor) { const p = params.parse(request.params); return service.detail(p.orgId, actor.id, p.id!) } })
  app.post(prefix + '/:id/decision', async (request, reply) => { const actor = await accountFor(request.headers.authorization, reply); if (actor) { const p = params.parse(request.params); return service.decide(p.orgId, actor.id, p.id!, request.body) } })
}
