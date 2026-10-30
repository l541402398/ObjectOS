import { z } from 'zod'

const id = z.string().min(1).max(128)
const ref = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/)
const tools = z.array(ref).max(32)
const credentialRefs = z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/)).max(16)
export const SharedAssetKindSchema = z.enum(['agent', 'skill', 'mcp', 'tool'])
export const SharedAssetStatusSchema = z.enum(['draft', 'published', 'deprecated', 'revoked'])
export const SharedAssetDefinitionSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('agent'),
        role: z.string().trim().min(1).max(80),
        instructions: z.string().trim().min(1).max(20_000),
        runtime: z.enum(['native', 'cli', 'acp']),
        skillVersionIds: z.array(id).max(32),
        toolIds: tools,
      })
      .strict(),
    z
      .object({
        kind: z.literal('skill'),
        instructions: z.string().trim().min(1).max(20_000),
        toolIds: tools,
      })
      .strict(),
    z
      .object({
        kind: z.literal('mcp'),
        transport: z.enum(['stdio', 'https']),
        target: z.string().min(1).max(500),
        credentialRefs,
      })
      .strict()
      .refine((value) => {
        if (value.transport === 'stdio') return ref.safeParse(value.target).success
        try {
          const url = new URL(value.target)
          return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
        } catch {
          return false
        }
      }, '请填写命令名称或不含凭据的 HTTPS 地址'),
    z
      .object({
        kind: z.literal('tool'),
        toolId: ref,
        approval: z.literal('required'),
        description: z.string().trim().min(1).max(2000),
      })
      .strict(),
  ])
  .refine(
    (value) =>
      !/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{12,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}|[a-z]+:\/\/[^\s/]+:[^\s/]+@/i.test(
        JSON.stringify(value),
      ),
    '共享定义不能包含密钥或带凭据的地址',
  )
export type SharedAssetDefinition = z.infer<typeof SharedAssetDefinitionSchema>

export const SharedAssetVersionInputSchema = z
  .object({
    version: z.string().regex(/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/),
    definition: SharedAssetDefinitionSchema,
  })
  .strict()
export const SharedAssetCreateSchema = SharedAssetVersionInputSchema.extend({
  name: z.string().trim().min(1).max(100),
  visibility: z.enum(['organization', 'project']),
  projectId: id.nullable(),
})
  .strict()
  .refine((value) => (value.visibility === 'project') === (value.projectId !== null), '请选择项目可见范围')
export const SharedAssetDraftSchema = z
  .object({ expectedRevision: z.number().int().positive(), definition: SharedAssetDefinitionSchema })
  .strict()
export const SharedAssetTransitionSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    action: z.enum(['publish', 'deprecate', 'revoke']),
  })
  .strict()
export const SharedAssetBindingInputSchema = z
  .object({
    projectId: id,
    assetId: id,
    versionId: id,
    expectedVersionId: id.nullable(),
  })
  .strict()
export const SharedAssetUnbindInputSchema = z
  .object({ projectId: id, assetId: id, expectedVersionId: id })
  .strict()

export const SharedAssetSchema = z.object({
  id,
  organizationId: id,
  name: z.string().min(1).max(100),
  kind: SharedAssetKindSchema,
  visibility: z.enum(['organization', 'project']),
  projectId: id.nullable(),
  createdAt: z.number(),
  canManage: z.boolean(),
})
export const SharedAssetVersionSchema = z.object({
  id,
  assetId: id,
  version: SharedAssetVersionInputSchema.shape.version,
  definition: SharedAssetDefinitionSchema,
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  status: SharedAssetStatusSchema,
  revision: z.number().int().positive(),
  createdAt: z.number(),
  publishedAt: z.number().nullable(),
})
export const SharedAssetBindingSchema = z.object({
  assetId: id,
  versionId: id,
  projectId: id,
  projectName: z.string().min(1).max(120),
  version: SharedAssetVersionInputSchema.shape.version,
  status: SharedAssetStatusSchema,
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  updatedAt: z.number(),
  canManage: z.boolean(),
})
export const SharedAssetDetailSchema = z.object({
  asset: SharedAssetSchema,
  versions: z.array(SharedAssetVersionSchema).min(1).max(100),
  bindings: z.array(SharedAssetBindingSchema).max(200),
})
export const SharedAssetListSchema = z.object({
  assets: z.array(
    SharedAssetSchema.extend({
      latestVersion: SharedAssetVersionInputSchema.shape.version,
      latestStatus: SharedAssetStatusSchema,
      versionCount: z.number().int().min(1).max(100),
      publishedVersionId: id.nullable(),
      publishedVersion: SharedAssetVersionInputSchema.shape.version.nullable(),
    }),
  ).max(200),
})
export type SharedAsset = z.infer<typeof SharedAssetSchema>
export type SharedAssetVersion = z.infer<typeof SharedAssetVersionSchema>
export type SharedAssetDetail = z.infer<typeof SharedAssetDetailSchema>

/** Stable field order for hashes and human-readable comparisons, independent of JSONB ordering. */
export function canonicalAssetDefinition(value: SharedAssetDefinition): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : item && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b, 'en'))
              .map(([key, child]) => [key, sort(child)]),
          )
        : item
  return JSON.stringify(sort(value))
}
