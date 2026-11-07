import { z } from 'zod'

const id = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !value.includes('\0'), '标识不能包含空字符')
const timestamp = z.number().int().nonnegative()
export const OrganizationKnowledgeCategorySchema = z.enum(['technical', 'business'])
export const OrganizationKnowledgeStatusSchema = z.enum(['draft', 'published', 'deprecated', 'revoked'])
const version = z.string().regex(/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/)
export const OrganizationKnowledgeContentSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(20_000),
    tags: z.array(z.string().trim().min(1).max(40)).max(16),
  })
  .strict()
  .superRefine((content, context) => {
    const text = JSON.stringify(content)
    if (
      /\\u0000|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{12,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}|[a-z]+:\/\/[^\s/]+:[^\s/]+@/i.test(
        text,
      )
    )
      context.addIssue({ code: 'custom', message: '知识内容不能包含空字符、密钥或带凭据的地址' })
    if (new Set(content.tags).size !== content.tags.length)
      context.addIssue({ code: 'custom', message: '知识标签不能重复' })
  })
export type OrganizationKnowledgeContent = z.infer<typeof OrganizationKnowledgeContentSchema>
export function canonicalKnowledgeContent(content: OrganizationKnowledgeContent): string {
  return JSON.stringify({ body: content.body, tags: content.tags, title: content.title })
}
export const OrganizationKnowledgeVersionInputSchema = z
  .object({
    version,
    content: OrganizationKnowledgeContentSchema,
  })
  .strict()
export const OrganizationKnowledgeCreateSchema = OrganizationKnowledgeVersionInputSchema.extend({
  category: OrganizationKnowledgeCategorySchema,
  visibility: z.enum(['organization', 'project']),
  projectId: id.nullable(),
})
  .strict()
  .refine(
    (value) => (value.visibility === 'project') === (value.projectId !== null),
    '请选择有效的知识可见范围',
  )
export const OrganizationKnowledgeDraftSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    content: OrganizationKnowledgeContentSchema,
  })
  .strict()
export const OrganizationKnowledgeTransitionSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    action: z.enum(['publish', 'deprecate', 'revoke']),
  })
  .strict()
export const OrganizationKnowledgeDocumentSchema = z
  .object({
    id,
    organizationId: id,
    category: OrganizationKnowledgeCategorySchema,
    visibility: z.enum(['organization', 'project']),
    projectId: id.nullable(),
    createdAt: timestamp,
    canManage: z.boolean(),
  })
  .strict()
export const OrganizationKnowledgeVersionSchema = z
  .object({
    id,
    documentId: id,
    version,
    content: OrganizationKnowledgeContentSchema,
    checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    status: OrganizationKnowledgeStatusSchema,
    revision: z.number().int().positive(),
    createdAt: timestamp,
    publishedAt: timestamp.nullable(),
  })
  .strict()
export const OrganizationKnowledgeDetailSchema = z
  .object({
    document: OrganizationKnowledgeDocumentSchema,
    versions: z.array(OrganizationKnowledgeVersionSchema).min(1).max(100),
  })
  .strict()
export const OrganizationKnowledgeListInputSchema = z.object({ projectId: id.optional() }).strict()
export const OrganizationKnowledgeListSchema = z
  .object({
    documents: z
      .array(
        OrganizationKnowledgeDocumentSchema.extend({
          title: z.string().min(1).max(160),
          versionId: id,
          version,
          status: OrganizationKnowledgeStatusSchema,
        }).strict(),
      )
      .max(100),
  })
  .strict()
export const OrganizationKnowledgeSearchSchema = z
  .object({
    projectId: id,
    query: z
      .string()
      .trim()
      .max(200)
      .refine((value) => !value.includes('\0'), '检索内容不能包含空字符'),
    category: OrganizationKnowledgeCategorySchema.optional(),
    limit: z.number().int().min(1).max(30).default(10),
  })
  .strict()
export const OrganizationKnowledgeSearchResultSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            documentId: id,
            organizationId: id,
            projectId: id.nullable(),
            category: OrganizationKnowledgeCategorySchema,
            versionId: id,
            version,
            checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            title: z.string().max(160),
            excerpt: z.string().max(1200),
            tags: z.array(z.string().max(40)).max(16),
            publishedAt: timestamp,
          })
          .strict(),
      )
      .max(30),
  })
  .strict()
export type OrganizationKnowledgeDetail = z.infer<typeof OrganizationKnowledgeDetailSchema>

export const OrganizationKnowledgePinSchema = z.object({
  documentId: id, versionId: id, checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict()
export const OrganizationKnowledgeResolveSchema = z.object({
  projectId: id, pins: z.array(OrganizationKnowledgePinSchema).min(1).max(8), includeContent: z.boolean().default(true),
}).strict().refine(value => new Set(value.pins.map(pin => pin.documentId)).size === value.pins.length, '每份资料只能选择一个版本')
export const OrganizationKnowledgeResolvedSchema = z.object({
  sources: z.array(OrganizationKnowledgePinSchema.extend({
    version, title: z.string().min(1).max(160), category: OrganizationKnowledgeCategorySchema,
    body: z.string().max(20_000).optional(),
  }).strict()).min(1).max(8),
}).strict().refine(value => value.sources.reduce((chars, source) => chars + (source.body?.length ?? 0) + source.title.length, 0) <= 24_000, '组织参考资料超过上下文上限')
