import { z } from 'zod'
import { AssignmentCreateSchema, AssignmentCommandSchema, AssignmentHumanDecisionSchema, AssignmentClaimSchema,
  AssignmentDetailSchema, AssignmentCommandReceiptSchema, AssignmentListSchema, AssignmentRosterSchema,
  AssignmentCountsSchema, AssignmentAuthorityInputSchema, AssignmentAuthoritySchema, KnowledgeOutputReferenceSchema, OrganizationKnowledgeContentSchema } from '@projectos/organization-contracts'
import { OrganizationKnowledgeScopeSchema } from './organization-knowledge.js'

export type { MemberAssignment, AssignmentCommand, AssignmentCreate } from '@projectos/organization-contracts'
export { AssignmentBriefSchema, AssignmentHumanDecisionSchema } from '@projectos/organization-contracts'
const id = z.string().min(1).max(128), fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
const confirmed = z.literal(true), note = z.string().trim().min(8).max(2000).refine(body => OrganizationKnowledgeContentSchema.safeParse({ title: '分配操作', body, tags: [] }).success, '操作说明不能包含凭据')
export const AssignmentBindingSchema = OrganizationKnowledgeScopeSchema.extend({ assignmentId: z.uuid(), projectId: id, requirementId: id,
  claim: AssignmentClaimSchema, briefChecksum: fingerprint, acceptedAt: z.number().int().nonnegative(),
}).strict()
export type AssignmentBinding = z.infer<typeof AssignmentBindingSchema>
export const AssignmentProgressPreviewSchema = z.object({ requirementId: id, mode: z.enum(['progress', 'delivery']), counts: AssignmentCountsSchema, fingerprint,
  blockers: z.array(z.string().max(1000)).max(100), acceptance: z.object({ id, fingerprint, acceptedAt: z.number().int().nonnegative(), note: z.string().max(2000), current: z.boolean() }).nullable(),
  artifacts: z.array(KnowledgeOutputReferenceSchema.extend({ bodyChars: z.number().int().nonnegative() })).max(100),
}).strict()
export const AssignmentSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dispatch'), draft: AssignmentCreateSchema, confirmed }).strict(),
  z.object({ kind: z.literal('decision'), assignmentId: z.uuid(), decision: AssignmentHumanDecisionSchema, confirmed }).strict(),
  z.object({ kind: z.literal('accept'), id: z.uuid(), assignmentId: z.uuid(), expectedRevision: z.number().int().positive(), localProjectId: id, confirmed }).strict(),
  z.object({ kind: z.enum(['progress', 'delivery']), id: z.uuid(), requirementId: id, expectedRevision: z.number().int().positive(), fingerprint,
    artifactIds: z.array(id).max(8).default([]), note, confirmed }).strict(),
])
export type AssignmentSelection = z.infer<typeof AssignmentSelectionSchema>
export const AssignmentReceiptSchema = OrganizationKnowledgeScopeSchema.extend({ id: z.uuid(), assignmentId: z.uuid(), kind: z.enum(['dispatch', 'decision', 'accept', 'progress', 'delivery']),
  status: z.enum(['sending', 'needs_reconciliation', 'confirmed', 'closed']), localRequirementId: id.nullable(), error: z.string().max(2000).nullable(), createdAt: z.number().int().nonnegative(),
}).strict()
export type AssignmentReceipt = z.infer<typeof AssignmentReceiptSchema>
export const AssignmentPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), data: AssignmentCreateSchema }).strict(),
  z.object({ type: z.literal('command'), assignmentId: z.uuid(), data: AssignmentCommandSchema }).strict(),
])
export const AssignmentOperationSchema = z.object({ receipt: AssignmentReceiptSchema, payload: AssignmentPayloadSchema }).strict()
export const AssignmentHostInputSchema = OrganizationKnowledgeScopeSchema.extend({ request: AssignmentAuthorityInputSchema }).strict()
export type AssignmentHostInput = z.infer<typeof AssignmentHostInputSchema>
export type AssignmentHostOutput = z.infer<typeof AssignmentAuthoritySchema>
export const AssignmentRequestFrameSchema = z.object({ kind: z.literal('assignment_request'), id, input: AssignmentHostInputSchema }).strict()
export const AssignmentResponseFrameSchema = z.object({ kind: z.literal('assignment_response'), id, ok: z.boolean(), result: AssignmentAuthoritySchema.optional() }).strict()
export const AssignmentInternalSchemas = {
  'runtime.assignment.prepare': { input: z.object({ scope: OrganizationKnowledgeScopeSchema, selection: AssignmentSelectionSchema, detail: AssignmentDetailSchema.optional() }).strict(), output: AssignmentOperationSchema },
  'runtime.assignment.get': { input: z.object({ scope: OrganizationKnowledgeScopeSchema, id: z.uuid() }).strict(), output: AssignmentOperationSchema },
  'runtime.assignment.list': { input: z.object({ scope: OrganizationKnowledgeScopeSchema }).strict(), output: z.object({ operations: z.array(AssignmentReceiptSchema).max(100) }).strict() },
  'runtime.assignment.local': { input: z.object({ scope: OrganizationKnowledgeScopeSchema, assignmentId: z.uuid() }).strict(), output: z.object({ requirementId: id.nullable(), projectId: id.nullable() }).strict() },
  'runtime.assignment.retry': { input: z.object({ scope: OrganizationKnowledgeScopeSchema, id: z.uuid(), confirmed }).strict(), output: AssignmentOperationSchema },
  'runtime.assignment.close': { input: z.object({ scope: OrganizationKnowledgeScopeSchema, id: z.uuid(), note, confirmed }).strict(), output: AssignmentReceiptSchema },
  'runtime.assignment.finish': { input: z.object({ scope: OrganizationKnowledgeScopeSchema, id: z.uuid(), outcome: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('unknown') }).strict(),
    z.object({ kind: z.literal('confirmed'), detail: AssignmentDetailSchema.optional(), command: AssignmentCommandReceiptSchema.optional() }).strict(),
  ]) }).strict(), output: AssignmentReceiptSchema },
} as const
export const AssignmentOrganizationApiSchemas = {
  'organization.assignments': { input: z.object({}).strict(), output: AssignmentListSchema },
  'organization.assignment': { input: z.object({ id: z.uuid() }).strict(), output: AssignmentDetailSchema },
  'organization.assignmentLocal': { input: z.object({ id: z.uuid() }).strict(), output: AssignmentInternalSchemas['runtime.assignment.local'].output },
  'organization.assignmentRoster': { input: z.object({ projectId: id }).strict(), output: AssignmentRosterSchema },
  'organization.assignmentSubmit': { input: AssignmentSelectionSchema, output: AssignmentReceiptSchema },
  'organization.assignmentOperation': { input: z.object({ id: z.uuid() }).strict(), output: AssignmentOperationSchema },
  'organization.assignmentOperations': { input: z.object({}).strict(), output: AssignmentInternalSchemas['runtime.assignment.list'].output },
  'organization.assignmentReconcile': { input: z.object({ id: z.uuid() }).strict(), output: AssignmentReceiptSchema },
  'organization.assignmentRetry': { input: z.object({ id: z.uuid(), confirmed }).strict(), output: AssignmentReceiptSchema },
  'organization.assignmentClose': { input: z.object({ id: z.uuid(), note, confirmed }).strict(), output: AssignmentReceiptSchema },
} as const
export const AssignmentRequirementApiSchemas = {
  'requirement.assignment': { input: z.object({ requirementId: id }).strict(), output: z.object({ binding: AssignmentBindingSchema.nullable() }).strict() },
  'requirement.assignmentProgress': { input: z.object({ requirementId: id, mode: z.enum(['progress', 'delivery']) }).strict(), output: AssignmentProgressPreviewSchema },
} as const
