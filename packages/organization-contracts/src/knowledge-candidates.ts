import { z } from 'zod'
import { OrganizationKnowledgeCategorySchema, OrganizationKnowledgeContentSchema, OrganizationKnowledgePinSchema, OrganizationKnowledgeVersionInputSchema } from './knowledge.js'

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const commit = z.string().regex(/^[a-f0-9]{40,64}$/)
const time = z.number().int().nonnegative()
export const KnowledgeOutputReferenceSchema = z.object({
  id, taskId: id, runId: id, title: z.string().min(1).max(240), checksum: digest,
}).strict()
export const KnowledgeTaskEvidenceSchema = z.object({
  taskId: id, version: z.number().int().nonnegative(), sourceCommit: commit, integrationCommit: commit,
  reviewArtifactIds: z.array(id).min(1).max(20), verificationRunId: id,
  verificationToolCallIds: z.array(id).min(1).max(20), workflowRunIds: z.array(id).max(20),
}).strict()
export const KnowledgeCandidateSourceSchema = z.object({
  kind: z.literal('desktop-owner-attested'), requirementId: id, requirementTitle: z.string().min(1).max(240),
  requirementVersion: z.number().int().nonnegative(), acceptanceId: id, fingerprint: digest,
  acceptedAt: time, acceptanceNote: z.string().trim().min(8).max(2000),
  tasks: z.array(KnowledgeTaskEvidenceSchema).min(1).max(20),
  artifacts: z.array(KnowledgeOutputReferenceSchema).min(1).max(8),
  citations: z.array(OrganizationKnowledgePinSchema).max(8),
}).strict().superRefine((value, context) => {
  if (!OrganizationKnowledgeContentSchema.safeParse({ title: '来源证据', body: JSON.stringify(value), tags: [] }).success)
    context.addIssue({ code: 'custom', message: '来源证据超出限额或包含凭据' })
  if (new Set(value.artifacts.map(item => item.id)).size !== value.artifacts.length || new Set(value.tasks.map(item => item.taskId)).size !== value.tasks.length)
    context.addIssue({ code: 'custom', message: '来源证据不能重复' })
  if (value.artifacts.some(item => !value.tasks.some(task => task.taskId === item.taskId)))
    context.addIssue({ code: 'custom', message: '产物必须属于验收任务' })
})
export const KnowledgeCandidateSubmitSchema = z.object({
  id: z.uuid(), projectId: id, category: OrganizationKnowledgeCategorySchema,
  content: OrganizationKnowledgeContentSchema, source: KnowledgeCandidateSourceSchema,
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).length <= 60_000, '候选及证据超过 60KB，请精简正文')
export type KnowledgeCandidateSubmit = z.infer<typeof KnowledgeCandidateSubmitSchema>
const target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('new'), version: OrganizationKnowledgeVersionInputSchema.shape.version }).strict(),
  z.object({ kind: z.literal('version'), documentId: id, expectedVersionId: id, version: OrganizationKnowledgeVersionInputSchema.shape.version }).strict(),
])
const decision = { decisionId: z.uuid(), expectedRevision: z.number().int().positive(), note: z.string().trim().min(8).max(2000).refine(note =>
  OrganizationKnowledgeContentSchema.safeParse({ title: '审核意见', body: note, tags: [] }).success, '审核意见不能包含凭据') }
export const KnowledgeCandidateDecisionSchema = z.discriminatedUnion('action', [
  z.object({ ...decision, action: z.literal('return') }).strict(),
  z.object({ ...decision, action: z.literal('publish'), target, acknowledgedDuplicateIds: z.array(id).max(10).default([]) }).strict(),
])
export const KnowledgePublicationSchema = OrganizationKnowledgePinSchema.extend({ version: OrganizationKnowledgeVersionInputSchema.shape.version }).strict()
export const KnowledgeCandidateSchema = z.object({
  id: z.uuid(), organizationId: id, projectId: id, authorId: id, authorName: z.string().max(120),
  category: OrganizationKnowledgeCategorySchema, content: OrganizationKnowledgeContentSchema, source: KnowledgeCandidateSourceSchema,
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/), payloadHash: digest,
  status: z.enum(['pending', 'returned', 'published']), revision: z.number().int().positive(),
  createdAt: time, reviewedAt: time.nullable(), reviewerId: id.nullable(), reviewNote: z.string().max(2000).nullable(),
  decisionId: z.uuid().nullable(), publication: KnowledgePublicationSchema.nullable(), canReview: z.boolean(),
}).strict()
export type KnowledgeCandidate = z.infer<typeof KnowledgeCandidateSchema>
export const KnowledgeCandidateListSchema = z.object({ candidates: z.array(KnowledgeCandidateSchema.omit({ content: true, source: true }).extend({
  title: z.string().min(1).max(160), requirementTitle: z.string().min(1).max(240),
})).max(100) }).strict()
export const KnowledgeCandidateDetailSchema = z.object({ candidate: KnowledgeCandidateSchema,
  related: z.array(KnowledgePublicationSchema.extend({ title: z.string().max(160), exactContent: z.boolean(), relatedAcceptance: z.boolean() })).max(10),
}).strict()
export type KnowledgeCandidateDetail = z.infer<typeof KnowledgeCandidateDetailSchema>
