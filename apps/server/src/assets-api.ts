import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  canOrg,
  canProject,
  OrgRoleSchema,
  ProjectRoleSchema,
  canonicalAssetDefinition,
  SharedAssetCreateSchema,
  SharedAssetVersionInputSchema,
  SharedAssetDraftSchema,
  SharedAssetTransitionSchema,
  SharedAssetBindingInputSchema,
  SharedAssetUnbindInputSchema,
  SharedAssetDefinitionSchema,
  SharedAssetDetailSchema,
  SharedAssetListSchema,
  type OrgRole,
  type SharedAsset,
  type SharedAssetDefinition,
  type SharedAssetDetail,
} from '@projectos/organization-contracts'
import { audit, inTransaction } from './postgres-store.js'

export class AssetScopeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
const conflict = () => new AssetScopeError(409, 'CONFLICT', '内容已变化，请刷新后重新确认。')
interface AssetRow {
  id: string
  organization_id: string
  name: string
  kind: SharedAsset['kind']
  visibility: SharedAsset['visibility']
  project_id: string | null
  created_at: string
}
const checksum = (definition: SharedAssetDefinition) =>
  `sha256:${createHash('sha256').update(canonicalAssetDefinition(definition)).digest('hex')}`

export class OrganizationAssets {
  constructor(private readonly pool: Pool) {}

  /** The same lock ordering as member/role writes: org, membership, resource. */
  private async scope<T>(
    orgId: string,
    accountId: string,
    action: (client: PoolClient, role: OrgRole) => Promise<T>,
  ): Promise<T> {
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT id FROM organization WHERE id=$1 FOR UPDATE', [orgId])
      const membership = await client.query(
        'SELECT role FROM member WHERE "organizationId"=$1 AND "userId"=$2 FOR SHARE',
        [orgId, accountId],
      )
      const role = OrgRoleSchema.safeParse(membership.rows[0]?.role)
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
  ): Promise<boolean> {
    const result = await client.query(
      `SELECT pm.role FROM organization_project_members pm JOIN organization_projects p
      ON p.organization_id=pm.organization_id AND p.id=pm.project_id
      WHERE pm.organization_id=$1 AND pm.project_id=$2 AND pm.account_id=$3 AND p.status='active' FOR SHARE OF pm,p`,
      [orgId, projectId, accountId],
    )
    const role = ProjectRoleSchema.safeParse(result.rows[0]?.role)
    return role.success && canProject(role.data, manage ? 'project.manage_assets' : 'project.view')
  }
  private async asset(
    client: PoolClient,
    orgId: string,
    accountId: string,
    assetId: string,
  ): Promise<AssetRow> {
    const row = (
      await client.query<AssetRow>('SELECT * FROM organization_assets WHERE organization_id=$1 AND id=$2', [
        orgId,
        assetId,
      ])
    ).rows[0]
    if (!row || (row.project_id && !(await this.project(client, orgId, accountId, row.project_id))))
      throw new AssetScopeError(404, 'RESOURCE_NOT_IN_SCOPE', '资产不存在，或你没有访问权限。')
    return row
  }
  private async canManage(
    client: PoolClient,
    role: OrgRole,
    accountId: string,
    row: AssetRow,
  ): Promise<boolean> {
    return (
      canOrg(role, 'org.publish_asset') &&
      (!row.project_id || (await this.project(client, row.organization_id, accountId, row.project_id, true)))
    )
  }
  private async manage(client: PoolClient, role: OrgRole, accountId: string, row: AssetRow): Promise<void> {
    if (!(await this.canManage(client, role, accountId, row)))
      throw new AssetScopeError(403, 'ORG_FORBIDDEN', '请联系组织管理员和项目负责人授予资产管理权限。')
  }
  private async validateDefinition(
    client: PoolClient,
    row: AssetRow,
    definition: SharedAssetDefinition,
  ): Promise<void> {
    if (definition.kind !== row.kind)
      throw new AssetScopeError(400, 'BAD_REQUEST', '新版本必须保持同一种资产类型。')
    if (definition.kind !== 'agent') return
    for (const versionId of new Set(definition.skillVersionIds)) {
      const skill = (
        await client.query(
          `SELECT a.visibility,a.project_id FROM organization_asset_versions v
        JOIN organization_assets a ON a.id=v.asset_id AND a.organization_id=v.organization_id
        WHERE v.organization_id=$1 AND v.id=$2 AND v.status='published' AND a.kind='skill'`,
          [row.organization_id, versionId],
        )
      ).rows[0]
      if (!skill || (skill.visibility === 'project' && skill.project_id !== row.project_id))
        throw new AssetScopeError(
          403,
          'RESOURCE_NOT_IN_SCOPE',
          '引用的技能版本不可用，或不属于当前可见范围。',
        )
    }
  }
  private async detailIn(
    client: PoolClient,
    role: OrgRole,
    accountId: string,
    row: AssetRow,
  ): Promise<SharedAssetDetail> {
    const versions = await client.query(
      `SELECT id,asset_id AS "assetId",version,definition,checksum,status,revision,
      created_at::float8 AS "createdAt",published_at::float8 AS "publishedAt" FROM organization_asset_versions
      WHERE organization_id=$1 AND asset_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100`,
      [row.organization_id, row.id],
    )
    const bindings = await client.query(
      `SELECT b.asset_id AS "assetId",b.project_id AS "projectId",b.version_id AS "versionId",
      p.name AS "projectName",v.version,v.status,v.checksum,b.updated_at::float8 AS "updatedAt",pm.role
      FROM organization_asset_bindings b JOIN organization_projects p ON p.organization_id=b.organization_id AND p.id=b.project_id
      JOIN organization_asset_versions v ON v.organization_id=b.organization_id AND v.id=b.version_id
      JOIN organization_project_members pm ON pm.organization_id=b.organization_id AND pm.project_id=b.project_id AND pm.account_id=$3
      WHERE b.organization_id=$1 AND b.asset_id=$2 ORDER BY p.name,p.id LIMIT 200`,
      [row.organization_id, row.id, accountId],
    )
    return SharedAssetDetailSchema.parse({
      asset: {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        kind: row.kind,
        visibility: row.visibility,
        projectId: row.project_id,
        createdAt: Number(row.created_at),
        canManage: await this.canManage(client, role, accountId, row),
      },
      versions: versions.rows,
      bindings: bindings.rows.map(({ role: projectRole, ...item }) => ({
        ...item,
        canManage: canProject(ProjectRoleSchema.parse(projectRole), 'project.manage_assets'),
      })),
    })
  }
  async list(orgId: string, accountId: string) {
    return this.scope(orgId, accountId, async (client, role) => {
      const result = await client.query<
        AssetRow & {
          latestVersion: string
          latestStatus: string
          versionCount: number
          publishedVersionId: string | null
          publishedVersion: string | null
          projectManage: boolean
        }
      >(
        `SELECT a.*,v.version AS "latestVersion",v.status AS "latestStatus",pub.id AS "publishedVersionId",pub.version AS "publishedVersion",
        (a.project_id IS NULL OR EXISTS(SELECT 1 FROM organization_project_members pm WHERE pm.organization_id=$1 AND pm.project_id=a.project_id AND pm.account_id=$2 AND pm.role IN ('owner','maintainer'))) AS "projectManage",
        (SELECT count(*)::int FROM organization_asset_versions allv WHERE allv.asset_id=a.id) AS "versionCount"
        FROM organization_assets a JOIN LATERAL (SELECT version,status FROM organization_asset_versions WHERE asset_id=a.id ORDER BY created_at DESC,id DESC LIMIT 1) v ON true
        LEFT JOIN LATERAL (SELECT id,version FROM organization_asset_versions WHERE asset_id=a.id AND status='published' ORDER BY created_at DESC,id DESC LIMIT 1) pub ON true
        WHERE a.organization_id=$1 AND (a.visibility='organization' OR EXISTS(SELECT 1 FROM organization_project_members pm
          WHERE pm.organization_id=$1 AND pm.project_id=a.project_id AND pm.account_id=$2)) ORDER BY a.created_at DESC,a.id DESC LIMIT 200`,
        [orgId, accountId],
      )
      return SharedAssetListSchema.parse({
        assets: result.rows.map((row) => ({
          id: row.id,
          organizationId: orgId,
          name: row.name,
          kind: row.kind,
          visibility: row.visibility,
          projectId: row.project_id,
          createdAt: Number(row.created_at),
          canManage: canOrg(role, 'org.publish_asset') && row.projectManage,
          latestVersion: row.latestVersion,
          latestStatus: row.latestStatus,
          versionCount: row.versionCount,
          publishedVersionId: row.publishedVersionId,
          publishedVersion: row.publishedVersion,
        })),
      })
    })
  }
  async detail(orgId: string, accountId: string, assetId: string) {
    return this.scope(orgId, accountId, async (client, role) =>
      this.detailIn(client, role, accountId, await this.asset(client, orgId, accountId, assetId)),
    )
  }
  async create(orgId: string, accountId: string, input: unknown) {
    const value = SharedAssetCreateSchema.parse(input)
    return this.scope(orgId, accountId, async (client, role) => {
      const row: AssetRow = {
        id: randomUUID(),
        organization_id: orgId,
        name: value.name,
        kind: value.definition.kind,
        visibility: value.visibility,
        project_id: value.projectId,
        created_at: String(Date.now()),
      }
      await this.manage(client, role, accountId, row)
      await this.validateDefinition(client, row, value.definition)
      await client.query(
        'INSERT INTO organization_assets(id,organization_id,name,kind,visibility,project_id,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [row.id, orgId, row.name, row.kind, row.visibility, row.project_id, accountId, row.created_at],
      )
      await this.insertVersion(client, accountId, row, value)
      await audit(client, accountId, orgId, 'asset.created', row.id, {
        kind: row.kind,
        visibility: row.visibility,
      })
      return this.detailIn(client, role, accountId, row)
    })
  }
  private async insertVersion(
    client: PoolClient,
    accountId: string,
    row: AssetRow,
    input: { version: string; definition: SharedAssetDefinition },
  ) {
    const count = await client.query(
      'SELECT count(*)::int AS count FROM organization_asset_versions WHERE asset_id=$1',
      [row.id],
    )
    if (count.rows[0].count >= 100)
      throw new AssetScopeError(409, 'CONFLICT', '此资产已达到版本数量上限，请创建新的资产。')
    await client.query(
      `INSERT INTO organization_asset_versions(id,organization_id,asset_id,version,definition,checksum,status,created_by,created_at)
      VALUES($1,$2,$3,$4,$5,$6,'draft',$7,$8)`,
      [
        randomUUID(),
        row.organization_id,
        row.id,
        input.version,
        JSON.stringify(input.definition),
        checksum(input.definition),
        accountId,
        Date.now(),
      ],
    )
  }
  async newVersion(orgId: string, accountId: string, assetId: string, input: unknown) {
    const value = SharedAssetVersionInputSchema.parse(input)
    return this.scope(orgId, accountId, async (client, role) => {
      const row = await this.asset(client, orgId, accountId, assetId)
      await this.manage(client, role, accountId, row)
      await this.validateDefinition(client, row, value.definition)
      await this.insertVersion(client, accountId, row, value)
      await audit(client, accountId, orgId, 'asset.version_created', row.id, { version: value.version })
      return this.detailIn(client, role, accountId, row)
    })
  }
  async update(
    orgId: string,
    accountId: string,
    assetId: string,
    versionId: string,
    input: unknown,
    transition: boolean,
  ) {
    const value = transition ? SharedAssetTransitionSchema.parse(input) : SharedAssetDraftSchema.parse(input)
    return this.scope(orgId, accountId, async (client, role) => {
      const row = await this.asset(client, orgId, accountId, assetId)
      await this.manage(client, role, accountId, row)
      const version = (
        await client.query(
          'SELECT * FROM organization_asset_versions WHERE organization_id=$1 AND asset_id=$2 AND id=$3 FOR UPDATE',
          [orgId, assetId, versionId],
        )
      ).rows[0]
      if (!version || version.revision !== value.expectedRevision) throw conflict()
      let definition = SharedAssetDefinitionSchema.parse(version.definition),
        status = String(version.status)
      if ('definition' in value) {
        if (status !== 'draft')
          throw new AssetScopeError(409, 'IMMUTABLE_VERSION', '已发布内容不可修改，请创建新版本。')
        definition = value.definition
      } else {
        const target = { publish: 'published', deprecate: 'deprecated', revoke: 'revoked' }[value.action]
        if (!(
          (status === 'draft' && target === 'published') ||
          (status === 'published' && ['deprecated', 'revoked'].includes(target)) ||
          (status === 'deprecated' && target === 'revoked')
        ))
          throw conflict()
        status = target
      }
      // Revalidate referenced skill versions on publication and every draft write.
      if (status === 'draft' || status === 'published') await this.validateDefinition(client, row, definition)
      await client.query(
        `UPDATE organization_asset_versions SET definition=$1,checksum=$2,status=$3,revision=revision+1,
        published_at=CASE WHEN status='draft' AND $3='published' THEN $4 ELSE published_at END WHERE id=$5`,
        [JSON.stringify(definition), checksum(definition), status, Date.now(), versionId],
      )
      await audit(
        client,
        accountId,
        orgId,
        'action' in value ? `asset.${value.action}` : 'asset.draft_updated',
        versionId,
        { assetId, checksum: checksum(definition) },
      )
      return this.detailIn(client, role, accountId, row)
    })
  }
  async bind(orgId: string, accountId: string, input: unknown, unbind = false) {
    const value = unbind
      ? SharedAssetUnbindInputSchema.parse(input)
      : SharedAssetBindingInputSchema.parse(input)
    return this.scope(orgId, accountId, async (client, role) => {
      const row = await this.asset(client, orgId, accountId, value.assetId)
      if (
        !(await this.project(client, orgId, accountId, value.projectId, true)) ||
        (row.project_id && row.project_id !== value.projectId)
      )
        throw new AssetScopeError(
          403,
          'PROJECT_FORBIDDEN',
          '需要该项目的资产管理权限，且资产必须在项目范围内。',
        )
      const previous = (
        await client.query(
          'SELECT version_id FROM organization_asset_bindings WHERE organization_id=$1 AND project_id=$2 AND asset_id=$3 FOR UPDATE',
          [orgId, value.projectId, value.assetId],
        )
      ).rows[0]
      if ((previous?.version_id ?? null) !== value.expectedVersionId) throw conflict()
      if ('versionId' in value) {
        const version = (
          await client.query(
            'SELECT definition FROM organization_asset_versions WHERE organization_id=$1 AND asset_id=$2 AND id=$3 AND status=$4',
            [orgId, value.assetId, value.versionId, 'published'],
          )
        ).rows[0]
        if (!version)
          throw new AssetScopeError(409, 'VERSION_UNAVAILABLE', '只能绑定仍在发布中的版本，请刷新后选择。')
        await this.validateDefinition(client, row, SharedAssetDefinitionSchema.parse(version.definition))
        await client.query(
          `INSERT INTO organization_asset_bindings(organization_id,project_id,asset_id,version_id,updated_by,updated_at)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,project_id,asset_id) DO UPDATE
          SET version_id=excluded.version_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
          [orgId, value.projectId, value.assetId, value.versionId, accountId, Date.now()],
        )
      } else {
        await client.query(
          'DELETE FROM organization_asset_bindings WHERE organization_id=$1 AND project_id=$2 AND asset_id=$3',
          [orgId, value.projectId, value.assetId],
        )
      }
      await audit(client, accountId, orgId, unbind ? 'asset.unbound' : 'asset.bound', value.assetId, {
        projectId: value.projectId,
        previousVersionId: previous?.version_id ?? null,
        versionId: 'versionId' in value ? value.versionId : null,
      })
      return this.detailIn(client, role, accountId, row)
    })
  }
}

export function registerOrganizationAssets(
  app: FastifyInstance,
  pool: Pool,
  accountFor: (authorization: string | undefined, reply: FastifyReply) => Promise<{ id: string } | null>,
) {
  const assets = new OrganizationAssets(pool)
  const prefix = '/v1/organizations/:orgId/assets'
  const routes = [
    ['GET', prefix, (org: string, account: string) => assets.list(org, account)],
    [
      'GET',
      prefix + '/:assetId',
      (org: string, account: string, p: Record<string, string>) => assets.detail(org, account, p.assetId!),
    ],
    [
      'POST',
      prefix,
      (org: string, account: string, _p: Record<string, string>, body: unknown) =>
        assets.create(org, account, body),
    ],
    [
      'POST',
      prefix + '/:assetId/versions',
      (org: string, account: string, p: Record<string, string>, body: unknown) =>
        assets.newVersion(org, account, p.assetId!, body),
    ],
    [
      'PATCH',
      prefix + '/:assetId/versions/:versionId',
      (org: string, account: string, p: Record<string, string>, body: unknown) =>
        assets.update(org, account, p.assetId!, p.versionId!, body, false),
    ],
    [
      'POST',
      prefix + '/:assetId/versions/:versionId/transition',
      (org: string, account: string, p: Record<string, string>, body: unknown) =>
        assets.update(org, account, p.assetId!, p.versionId!, body, true),
    ],
    [
      'PUT',
      prefix + '/bindings',
      (org: string, account: string, _p: Record<string, string>, body: unknown) =>
        assets.bind(org, account, body),
    ],
    [
      'DELETE',
      prefix + '/bindings',
      (org: string, account: string, _p: Record<string, string>, body: unknown) =>
        assets.bind(org, account, body, true),
    ],
  ] as const
  for (const [method, url, action] of routes)
    app.route({
      method,
      url,
      handler: async (request, reply) => {
        const account = await accountFor(request.headers.authorization, reply)
        if (!account) return
        const params = request.params as Record<string, string>
        return action(params.orgId!, account.id, params, request.body)
      },
    })
}
