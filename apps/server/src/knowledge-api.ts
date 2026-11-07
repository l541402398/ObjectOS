import { createHash, randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import {
  canOrg,
  canProject,
  OrgRoleSchema,
  ProjectRoleSchema,
  canonicalKnowledgeContent,
  OrganizationKnowledgeCreateSchema,
  OrganizationKnowledgeVersionInputSchema,
  OrganizationKnowledgeDraftSchema,
  OrganizationKnowledgeTransitionSchema,
  OrganizationKnowledgeDetailSchema,
  OrganizationKnowledgeVersionSchema,
  OrganizationKnowledgeListInputSchema,
  OrganizationKnowledgeListSchema,
  OrganizationKnowledgeSearchSchema,
  OrganizationKnowledgeSearchResultSchema,
  OrganizationKnowledgeResolveSchema,
  OrganizationKnowledgeResolvedSchema,
  type OrgRole,
  type OrganizationKnowledgeContent,
  KnowledgePublicationSchema,
  type KnowledgeCandidateSubmit,
  KnowledgeCandidateDecisionSchema,
} from '@projectos/organization-contracts'
import { AssetScopeError } from './assets-api.js'
import { audit, inTransaction } from './postgres-store.js'

type DocumentRow = {
  id: string
  organization_id: string
  category: 'technical' | 'business'
  visibility: 'organization' | 'project'
  project_id: string | null
  created_at: string
}
type VersionRow = {
  id: string
  document_id: string
  version: string
  title: string
  body: string
  tags: string[]
  checksum: string
  status: 'draft' | 'published' | 'deprecated' | 'revoked'
  revision: number
  created_at: string
  published_at: string | null
}
const checksum = (content: OrganizationKnowledgeContent) =>
  `sha256:${createHash('sha256').update(canonicalKnowledgeContent(content)).digest('hex')}`
const absent = () => new AssetScopeError(404, 'RESOURCE_NOT_IN_SCOPE', '知识不存在，或你没有访问权限。')
const conflict = () => new AssetScopeError(409, 'CONFLICT', '知识版本已改变，请刷新后重新确认。')

/** Organization knowledge never grants execution rights or mutates local knowledge entries. */
export class OrganizationKnowledge {
  constructor(private readonly pool: Pool) {}

  async resolve(orgId: string, accountId: string, raw: unknown) {
    const input = OrganizationKnowledgeResolveSchema.parse(raw)
    return this.scope(orgId, accountId, async client => {
      if (!await this.project(client, orgId, accountId, input.projectId)) throw absent()
      const sources = []
      let chars = 0
      for (const pin of input.pins) {
        const document = await this.document(client, orgId, accountId, pin.documentId)
        if (document.project_id && document.project_id !== input.projectId) throw absent()
        const row = (await client.query<VersionRow>(`SELECT * FROM organization_knowledge_versions
          WHERE organization_id=$1 AND document_id=$2 AND id=$3 AND status='published' FOR SHARE`,
        [orgId, pin.documentId, pin.versionId])).rows[0]
        if (!row || row.checksum !== pin.checksum) throw conflict()
        const version = this.version(row)
        chars += version.content.body.length + version.content.title.length
        if (input.includeContent && chars > 24_000) throw new AssetScopeError(400, 'BAD_REQUEST', '所选资料超过上下文上限，请减少引用。')
        sources.push({ ...pin, title: row.title, category: document.category, version: row.version,
          ...(input.includeContent ? { body: row.body } : {}) })
      }
      return OrganizationKnowledgeResolvedSchema.parse({ sources })
    })
  }

  private scope<T>(
    orgId: string,
    accountId: string,
    action: (client: PoolClient, role: OrgRole) => Promise<T>,
  ) {
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT id FROM organization WHERE id=$1 FOR UPDATE', [orgId])
      const member = await client.query(
        'SELECT role FROM member WHERE "organizationId"=$1 AND "userId"=$2 FOR SHARE',
        [orgId, accountId],
      )
      const role = OrgRoleSchema.safeParse(member.rows[0]?.role)
      if (!role.success) throw new AssetScopeError(403, 'ORG_FORBIDDEN', '你没有此组织的访问权限。')
      return action(client, role.data)
    })
  }

  private async project(
    client: PoolClient,
    orgId: string,
    accountId: string,
    projectId: string,
    manage = false,
  ) {
    const result = await client.query(
      `SELECT pm.role FROM organization_project_members pm JOIN organization_projects p
      ON p.organization_id=pm.organization_id AND p.id=pm.project_id
      WHERE pm.organization_id=$1 AND pm.project_id=$2 AND pm.account_id=$3 AND p.status='active' FOR SHARE OF pm,p`,
      [orgId, projectId, accountId],
    )
    const role = ProjectRoleSchema.safeParse(result.rows[0]?.role)
    return role.success && canProject(role.data, manage ? 'project.manage_assets' : 'project.view')
  }

  private async document(client: PoolClient, orgId: string, accountId: string, id: string) {
    const row = (
      await client.query<DocumentRow>(
        'SELECT * FROM organization_knowledge_documents WHERE organization_id=$1 AND id=$2',
        [orgId, id],
      )
    ).rows[0]
    if (!row || (row.project_id && !(await this.project(client, orgId, accountId, row.project_id))))
      throw absent()
    return row
  }

  private async canManage(client: PoolClient, role: OrgRole, accountId: string, row: DocumentRow) {
    return (
      canOrg(role, 'org.publish_asset') &&
      (!row.project_id || (await this.project(client, row.organization_id, accountId, row.project_id, true)))
    )
  }

  private async manage(client: PoolClient, role: OrgRole, accountId: string, row: DocumentRow) {
    if (!(await this.canManage(client, role, accountId, row)))
      throw new AssetScopeError(403, 'ORG_FORBIDDEN', '需要组织知识管理权限及相应项目资产权限。')
  }

  private view(row: DocumentRow, canManage: boolean) {
    return {
      id: row.id,
      organizationId: row.organization_id,
      category: row.category,
      visibility: row.visibility,
      projectId: row.project_id,
      createdAt: Number(row.created_at),
      canManage,
    }
  }

  private version(row: VersionRow) {
    const content = { title: row.title, body: row.body, tags: row.tags }
    if (checksum(content) !== row.checksum) throw conflict()
    return OrganizationKnowledgeVersionSchema.parse({
      id: row.id,
      documentId: row.document_id,
      version: row.version,
      content,
      checksum: row.checksum,
      status: row.status,
      revision: row.revision,
      createdAt: Number(row.created_at),
      publishedAt: row.published_at === null ? null : Number(row.published_at),
    })
  }

  private async detailIn(client: PoolClient, role: OrgRole, accountId: string, row: DocumentRow) {
    const manage = await this.canManage(client, role, accountId, row)
    const versions = await client.query<VersionRow>(
      `SELECT * FROM organization_knowledge_versions
      WHERE organization_id=$1 AND document_id=$2 AND ($3::boolean OR status IN ('published','deprecated'))
      ORDER BY created_at DESC,id DESC LIMIT 100`,
      [row.organization_id, row.id, manage],
    )
    if (!versions.rowCount) throw absent()
    return OrganizationKnowledgeDetailSchema.parse({
      document: this.view(row, manage),
      versions: versions.rows.map((version) => this.version(version)),
    })
  }

  async detail(orgId: string, accountId: string, documentId: string) {
    return this.scope(orgId, accountId, async (client, role) =>
      this.detailIn(client, role, accountId, await this.document(client, orgId, accountId, documentId)),
    )
  }

  async list(orgId: string, accountId: string, raw: unknown) {
    const input = OrganizationKnowledgeListInputSchema.parse(raw)
    return this.scope(orgId, accountId, async (client, role) => {
      if (input.projectId && !(await this.project(client, orgId, accountId, input.projectId))) throw absent()
      // Summaries never load every historical body into Main or the renderer.
      const result = await client.query<
        DocumentRow & {
          can_manage: boolean
          title: string
          version_id: string
          version: string
          status: string
        }
      >(
        `
        WITH visible AS (SELECT d.*,($4::boolean AND (d.project_id IS NULL OR EXISTS(
          SELECT 1 FROM organization_project_members pm WHERE pm.organization_id=$1 AND pm.project_id=d.project_id
          AND pm.account_id=$2 AND pm.role IN ('owner','maintainer')))) AS can_manage
          FROM organization_knowledge_documents d WHERE d.organization_id=$1
          AND ($3::text IS NULL OR d.project_id IS NULL OR d.project_id=$3)
          AND (d.project_id IS NULL OR EXISTS(SELECT 1 FROM organization_project_members pm JOIN organization_projects p
            ON p.id=pm.project_id AND p.organization_id=pm.organization_id WHERE pm.organization_id=$1
            AND pm.project_id=d.project_id AND pm.account_id=$2 AND p.status='active')))
        SELECT d.*,v.id AS version_id,v.title,v.version,v.status FROM visible d
        JOIN LATERAL (SELECT id,title,version,status FROM organization_knowledge_versions v
          WHERE v.organization_id=$1 AND v.document_id=d.id AND (d.can_manage OR v.status IN ('published','deprecated'))
          ORDER BY v.created_at DESC,v.id DESC LIMIT 1) v ON true
        ORDER BY d.created_at DESC,d.id DESC LIMIT 100`,
        [orgId, accountId, input.projectId ?? null, canOrg(role, 'org.publish_asset')],
      )
      return OrganizationKnowledgeListSchema.parse({
        documents: result.rows.map((row) => ({
          ...this.view(row, row.can_manage),
          title: row.title,
          versionId: row.version_id,
          version: row.version,
          status: row.status,
        })),
      })
    })
  }

  private async insertVersion(
    client: PoolClient,
    accountId: string,
    row: DocumentRow,
    input: z.infer<typeof OrganizationKnowledgeVersionInputSchema>,
  ) {
    const count = await client.query(
      'SELECT count(*)::int AS count FROM organization_knowledge_versions WHERE document_id=$1',
      [row.id],
    )
    if (count.rows[0].count >= 100) throw new AssetScopeError(409, 'CONFLICT', '知识已达到版本数量上限。')
    const versionId = randomUUID()
    await client.query(
      `INSERT INTO organization_knowledge_versions
      (id,organization_id,document_id,version,title,body,tags,checksum,created_by,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        versionId,
        row.organization_id,
        row.id,
        input.version,
        input.content.title,
        input.content.body,
        JSON.stringify(input.content.tags),
        checksum(input.content),
        accountId,
        Date.now(),
      ],
    )
    return versionId
  }

  /** Only called inside the candidate decision's organization-locked transaction. */
  async publishReviewed(client: PoolClient, orgId: string, accountId: string, role: OrgRole,
    candidate: KnowledgeCandidateSubmit, target: Extract<z.infer<typeof KnowledgeCandidateDecisionSchema>, { action: 'publish' }>['target']) {
    let row: DocumentRow
    if (target.kind === 'version') {
      row = await this.document(client, orgId, accountId, target.documentId)
      if (row.project_id !== candidate.projectId || row.category !== candidate.category || row.visibility !== 'project') throw conflict()
      await this.manage(client, role, accountId, row)
      const head = (await client.query('SELECT id FROM organization_knowledge_versions WHERE document_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE', [row.id])).rows[0]
      if (head?.id !== target.expectedVersionId) throw conflict()
    } else {
      row = { id: randomUUID(), organization_id: orgId, project_id: candidate.projectId, category: candidate.category, visibility: 'project', created_at: String(Date.now()) }
      await this.manage(client, role, accountId, row)
      await client.query('INSERT INTO organization_knowledge_documents(id,organization_id,category,visibility,project_id,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [row.id, orgId, row.category, row.visibility, row.project_id, accountId, row.created_at])
    }
    const versionId = await this.insertVersion(client, accountId, row, { version: target.version, content: candidate.content })
    await client.query("UPDATE organization_knowledge_versions SET status='published',revision=revision+1,published_at=$2 WHERE id=$1", [versionId, Date.now()])
    const publication = KnowledgePublicationSchema.parse({ documentId: row.id, versionId, version: target.version, checksum: checksum(candidate.content) })
    await audit(client, accountId, orgId, 'knowledge.reviewed_publication', candidate.id, publication)
    return publication
  }

  async create(orgId: string, accountId: string, raw: unknown) {
    const input = OrganizationKnowledgeCreateSchema.parse(raw)
    return this.scope(orgId, accountId, async (client, role) => {
      const row: DocumentRow = {
        id: randomUUID(),
        organization_id: orgId,
        category: input.category,
        visibility: input.visibility,
        project_id: input.projectId,
        created_at: String(Date.now()),
      }
      await this.manage(client, role, accountId, row)
      await client.query(
        `INSERT INTO organization_knowledge_documents(id,organization_id,category,visibility,project_id,created_by,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, orgId, row.category, row.visibility, row.project_id, accountId, row.created_at],
      )
      await this.insertVersion(client, accountId, row, input)
      await audit(client, accountId, orgId, 'knowledge.created', row.id, {
        category: row.category,
        visibility: row.visibility,
        checksum: checksum(input.content),
        version: input.version,
      })
      return this.detailIn(client, role, accountId, row)
    })
  }

  async newVersion(orgId: string, accountId: string, documentId: string, raw: unknown) {
    const input = OrganizationKnowledgeVersionInputSchema.parse(raw)
    return this.scope(orgId, accountId, async (client, role) => {
      const row = await this.document(client, orgId, accountId, documentId)
      await this.manage(client, role, accountId, row)
      await this.insertVersion(client, accountId, row, input)
      await audit(client, accountId, orgId, 'knowledge.version_created', row.id, {
        version: input.version,
        checksum: checksum(input.content),
      })
      return this.detailIn(client, role, accountId, row)
    })
  }

  async update(orgId: string, accountId: string, documentId: string, versionId: string, raw: unknown) {
    const input = OrganizationKnowledgeDraftSchema.parse(raw)
    return this.scope(orgId, accountId, async (client, role) => {
      const row = await this.document(client, orgId, accountId, documentId)
      await this.manage(client, role, accountId, row)
      const result = await client.query(
        `UPDATE organization_knowledge_versions SET title=$5,body=$6,tags=$7,checksum=$8,revision=revision+1
        WHERE organization_id=$1 AND document_id=$2 AND id=$3 AND revision=$4 AND status='draft' RETURNING id`,
        [
          orgId,
          documentId,
          versionId,
          input.expectedRevision,
          input.content.title,
          input.content.body,
          JSON.stringify(input.content.tags),
          checksum(input.content),
        ],
      )
      if (!result.rowCount) throw conflict()
      await audit(client, accountId, orgId, 'knowledge.draft_updated', versionId, {
        checksum: checksum(input.content),
        revision: input.expectedRevision + 1,
      })
      return this.detailIn(client, role, accountId, row)
    })
  }

  async transition(orgId: string, accountId: string, documentId: string, versionId: string, raw: unknown) {
    const input = OrganizationKnowledgeTransitionSchema.parse(raw)
    return this.scope(orgId, accountId, async (client, role) => {
      const row = await this.document(client, orgId, accountId, documentId)
      await this.manage(client, role, accountId, row)
      const version = (
        await client.query<VersionRow>(
          'SELECT * FROM organization_knowledge_versions WHERE organization_id=$1 AND document_id=$2 AND id=$3 FOR UPDATE',
          [orgId, documentId, versionId],
        )
      ).rows[0]
      if (!version || version.revision !== input.expectedRevision) throw conflict()
      this.version(version)
      const allowed =
        input.action === 'publish'
          ? version.status === 'draft'
          : input.action === 'deprecate'
            ? version.status === 'published'
            : ['published', 'deprecated'].includes(version.status)
      if (!allowed) throw conflict()
      const status = { publish: 'published', deprecate: 'deprecated', revoke: 'revoked' }[input.action]
      await client.query(
        `UPDATE organization_knowledge_versions SET status=$4,revision=revision+1,
        published_at=CASE WHEN $4='published' THEN $5 ELSE published_at END WHERE organization_id=$1 AND document_id=$2 AND id=$3`,
        [orgId, documentId, versionId, status, Date.now()],
      )
      await audit(client, accountId, orgId, `knowledge.${status}`, versionId, {
        documentId,
        version: version.version,
        checksum: version.checksum,
        revision: version.revision + 1,
      })
      return this.detailIn(client, role, accountId, row)
    })
  }

  async search(orgId: string, accountId: string, raw: unknown) {
    const input = OrganizationKnowledgeSearchSchema.parse(raw)
    return this.scope(orgId, accountId, async (client) => {
      if (!(await this.project(client, orgId, accountId, input.projectId))) throw absent()
      const result = await client.query<
        VersionRow & { category: DocumentRow['category']; project_id: string | null }
      >(
        `SELECT v.*,d.category,d.project_id FROM organization_knowledge_documents d
        JOIN LATERAL (SELECT * FROM organization_knowledge_versions v WHERE v.document_id=d.id AND v.organization_id=d.organization_id
          AND v.status='published' ORDER BY v.published_at DESC,v.id DESC LIMIT 1) v ON true
        WHERE d.organization_id=$1 AND (d.project_id IS NULL OR d.project_id=$2) AND ($3::text IS NULL OR d.category=$3)
        AND ($4='' OR strpos(lower(concat_ws(' ',v.title,v.body,v.tags::text)),lower($4))>0)
        ORDER BY (strpos(lower(v.title),lower($4))>0) DESC,v.published_at DESC,v.id DESC LIMIT $5`,
        [orgId, input.projectId, input.category ?? null, input.query, input.limit],
      )
      return OrganizationKnowledgeSearchResultSchema.parse({
        results: result.rows.map((row) => {
          const version = this.version(row)
          const match = input.query ? row.body.toLowerCase().indexOf(input.query.toLowerCase()) : 0
          const start = Math.max(0, match - 160)
          return {
            documentId: row.document_id,
            organizationId: orgId,
            projectId: row.project_id,
            category: row.category,
            versionId: row.id,
            version: row.version,
            checksum: version.checksum,
            title: row.title,
            excerpt: row.body.slice(start, start + 1200),
            tags: row.tags,
            publishedAt: Number(row.published_at),
          }
        }),
      })
    })
  }
}

export function registerOrganizationKnowledge(
  app: FastifyInstance,
  pool: Pool,
  accountFor: (auth: string | undefined, reply: FastifyReply) => Promise<{ id: string } | null>,
) {
  const service = new OrganizationKnowledge(pool),
    prefix = '/v1/organizations/:orgId/knowledge'
  const params = z.object({
    orgId: z.string().min(1).max(128),
    documentId: z.string().min(1).max(128).optional(),
    versionId: z.string().min(1).max(128).optional(),
  })
  app.get(prefix, async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (account) return service.list(params.parse(request.params).orgId, account.id, request.query)
  })
  app.post(prefix, async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (account) return service.create(params.parse(request.params).orgId, account.id, request.body)
  })
  app.post(prefix + '/search', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (account) return service.search(params.parse(request.params).orgId, account.id, request.body)
  })
  app.post(prefix + '/resolve', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply)
    if (account) return service.resolve(params.parse(request.params).orgId, account.id, request.body)
  })
  app.get(prefix + '/:documentId', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply),
      p = params.parse(request.params)
    if (account) return service.detail(p.orgId, account.id, p.documentId!)
  })
  app.post(prefix + '/:documentId/versions', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply),
      p = params.parse(request.params)
    if (account) return service.newVersion(p.orgId, account.id, p.documentId!, request.body)
  })
  app.patch(prefix + '/:documentId/versions/:versionId', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply),
      p = params.parse(request.params)
    if (account) return service.update(p.orgId, account.id, p.documentId!, p.versionId!, request.body)
  })
  app.post(prefix + '/:documentId/versions/:versionId/transition', async (request, reply) => {
    const account = await accountFor(request.headers.authorization, reply),
      p = params.parse(request.params)
    if (account) return service.transition(p.orgId, account.id, p.documentId!, p.versionId!, request.body)
  })
}
