import { z } from 'zod'
import { OrganizationKnowledgePinSchema, OrganizationKnowledgeResolvedSchema, OrganizationKnowledgeResolveSchema } from '@projectos/organization-contracts'

const id = z.string().min(1).max(128)
export const OrganizationKnowledgeScopeSchema = z.object({
  serverUrl: z.url().max(500), organizationId: id, accountId: id,
}).strict()
export const RequirementKnowledgePinSchema = OrganizationKnowledgePinSchema.extend({ reason: z.string().trim().min(1).max(300) }).strict()
export const RequirementKnowledgeSelectionSchema = z.object({
  requirementId: id, expectedRevision: z.number().int().nonnegative(), projectId: id,
  pins: z.array(RequirementKnowledgePinSchema).max(8),
}).strict().refine(value => new Set(value.pins.map(pin => pin.documentId)).size === value.pins.length, '资料不能重复')
export const RequirementKnowledgeBindingSchema = OrganizationKnowledgeScopeSchema.extend({
  projectId: id,
  pins: z.array(RequirementKnowledgePinSchema.extend({ title: z.string().max(160), version: z.string().max(30), category: z.enum(['technical', 'business']) }).strict()).min(1).max(8),
}).strict()
export const RequirementKnowledgeViewSchema = z.object({
  revision: z.number().int().nonnegative(), locked: z.boolean(), binding: RequirementKnowledgeBindingSchema.nullable(),
}).strict()
export type RequirementKnowledgeBinding = z.infer<typeof RequirementKnowledgeBindingSchema>
export type RequirementKnowledgeView = z.infer<typeof RequirementKnowledgeViewSchema>
export const RequirementKnowledgeInternalSchemas = {
  'runtime.knowledge.set': {
    input: z.object({ requirementId: id, expectedRevision: z.number().int().nonnegative(), scope: OrganizationKnowledgeScopeSchema,
      binding: RequirementKnowledgeBindingSchema.nullable() }).strict(), output: RequirementKnowledgeViewSchema,
  },
} as const
export const KnowledgeHostInputSchema = OrganizationKnowledgeScopeSchema.extend({ request: OrganizationKnowledgeResolveSchema }).strict()
export type KnowledgeHostInput = z.infer<typeof KnowledgeHostInputSchema>
export type KnowledgeHostOutput = z.infer<typeof OrganizationKnowledgeResolvedSchema>
export const KnowledgeRequestFrameSchema = z.object({ kind: z.literal('knowledge_request'), id: z.string().min(1).max(128), input: KnowledgeHostInputSchema }).strict()
export const KnowledgeResponseFrameSchema = z.object({
  kind: z.literal('knowledge_response'), id: z.string().min(1).max(128), ok: z.boolean(), result: OrganizationKnowledgeResolvedSchema.optional(),
}).strict()
export const RequirementKnowledgeApiSchemas = {
  'requirement.knowledge': { input: z.object({ requirementId: id }).strict(), output: RequirementKnowledgeViewSchema },
} as const
