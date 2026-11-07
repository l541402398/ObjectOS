import { z } from 'zod'
import { KnowledgeCandidateSubmitSchema, KnowledgeCandidateDetailSchema, KnowledgeOutputReferenceSchema, OrganizationKnowledgeCategorySchema, OrganizationKnowledgeContentSchema } from '@projectos/organization-contracts'
import { OrganizationKnowledgeScopeSchema } from './organization-knowledge.js'

const id = z.string().min(1).max(128)
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
export const KnowledgeAcceptanceSchema = z.object({ id, fingerprint, acceptedAt: z.number().int().nonnegative(), note: z.string().min(8).max(2000), current: z.boolean() }).strict()
export const KnowledgeWritebackReceiptSchema = z.object({
  id: z.uuid(), requirementId: id, serverUrl: z.string(), organizationId: id, accountId: id, projectId: id,
  status: z.enum(['sending', 'needs_reconciliation', 'submitted', 'failed']), runId: id,
  candidateId: z.uuid().nullable(), error: z.string().nullable(), createdAt: z.number(),
}).strict()
export type KnowledgeWritebackReceipt = z.infer<typeof KnowledgeWritebackReceiptSchema>
export const KnowledgeDeliveryPreviewSchema = z.object({ requirementId: id, fingerprint, blockers: z.array(z.string()).max(100),
  acceptance: KnowledgeAcceptanceSchema.nullable(), artifacts: z.array(KnowledgeOutputReferenceSchema.extend({ bodyChars: z.number().int().nonnegative() })).max(100),
  receipts: z.array(KnowledgeWritebackReceiptSchema).max(50),
}).strict()
export type KnowledgeDeliveryPreview = z.infer<typeof KnowledgeDeliveryPreviewSchema>
export const KnowledgeWritebackSelectionSchema = z.object({
  id: z.uuid(), requirementId: id, projectId: id, acceptanceId: id, fingerprint,
  artifactIds: z.array(id).min(1).max(8), category: OrganizationKnowledgeCategorySchema,
  content: OrganizationKnowledgeContentSchema, confirmed: z.literal(true),
}).strict().refine(value => new Set(value.artifactIds).size === value.artifactIds.length, '资料不能重复')
export const KnowledgeWritebackOperationSchema = z.object({ receipt: KnowledgeWritebackReceiptSchema, payload: KnowledgeCandidateSubmitSchema }).strict()
export const KnowledgeWritebackInternalSchemas = {
  'runtime.knowledge.prepareWriteback': { input: z.object({ scope: OrganizationKnowledgeScopeSchema, selection: KnowledgeWritebackSelectionSchema }).strict(), output: KnowledgeWritebackOperationSchema },
  'runtime.knowledge.getWriteback': { input: z.object({ scope: OrganizationKnowledgeScopeSchema, id: z.uuid() }).strict(), output: KnowledgeWritebackOperationSchema },
  'runtime.knowledge.retryWriteback': { input: z.object({ scope: OrganizationKnowledgeScopeSchema, id: z.uuid(), confirmed: z.literal(true) }).strict(), output: KnowledgeWritebackOperationSchema },
  'runtime.knowledge.finishWriteback': { input: z.object({ scope: OrganizationKnowledgeScopeSchema, id: z.uuid(),
    outcome: z.discriminatedUnion('kind', [z.object({ kind: z.literal('submitted'), result: KnowledgeCandidateDetailSchema }).strict(), z.object({ kind: z.enum(['unknown', 'failed']) }).strict()]),
  }).strict(), output: KnowledgeWritebackReceiptSchema },
} as const
export const KnowledgeWritebackApiSchemas = {
  'requirement.knowledgeDelivery': { input: z.object({ requirementId: id }).strict(), output: KnowledgeDeliveryPreviewSchema },
  'requirement.acceptKnowledgeDelivery': { input: z.object({ requirementId: id, fingerprint, note: z.string().trim().min(8).max(2000).refine(note => OrganizationKnowledgeContentSchema.safeParse({ title: '验收意见', body: note, tags: [] }).success, '验收意见不能包含凭据'), confirmed: z.literal(true) }).strict(), output: KnowledgeDeliveryPreviewSchema },
  'requirement.knowledgeDraft': { input: z.object({ requirementId: id, artifactIds: z.array(id).min(1).max(8) }).strict(), output: OrganizationKnowledgeContentSchema },
} as const
