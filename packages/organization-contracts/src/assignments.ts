import { z } from 'zod'
import { OrganizationKnowledgeContentSchema } from './knowledge.js'
import { KnowledgeOutputReferenceSchema } from './knowledge-candidates.js'

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const time = z.number().int().nonnegative()
const safeText = (min: number, max: number) => z.string().trim().min(min).max(max).refine(body =>
  OrganizationKnowledgeContentSchema.safeParse({ title: '工作分配', body, tags: [] }).success, '内容不能包含凭据')
export const AssignmentBriefSchema = z.object({ title: safeText(1, 160), body: safeText(1, 16000),
  acceptanceCriteria: z.array(safeText(1, 500)).min(1).max(20), priority: z.enum(['low', 'normal', 'high', 'urgent']), dueAt: time.nullable(),
}).strict().refine(value => JSON.stringify(value).length <= 20000, '需求范围超过限额，请拆分')
const boundedPayload = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length <= 60000
export const AssignmentCreateSchema = z.object({ id: z.uuid(), projectId: id, assigneeId: id, brief: AssignmentBriefSchema }).strict().refine(boundedPayload, '提交内容超过传输限额，请拆分')
export type AssignmentCreate = z.infer<typeof AssignmentCreateSchema>
export const AssignmentClaimSchema = z.object({ clientId: z.uuid(), claimRef: z.uuid() }).strict()
export const AssignmentStatusSchema = z.enum(['pending', 'accepted', 'in_progress', 'ready_for_review', 'completed', 'declined', 'cancelled', 'reassigned'])
export const AssignmentCountsSchema = z.object({ total: z.number().int().min(0).max(10000), done: z.number().int().min(0).max(10000),
  active: z.number().int().min(0).max(10000), blocked: z.number().int().min(0).max(10000), runningRuns: z.number().int().min(0).max(10000),
}).strict().refine(v => v.done + v.active + v.blocked <= v.total, '任务计数不一致')
export const AssignmentDeliverySourceSchema = z.object({ kind: z.literal('desktop-owner-attested'), requirementVersion: z.number().int().nonnegative(),
  acceptanceId: id, fingerprint: digest, acceptedAt: time, acceptanceNote: safeText(8, 2000),
  artifacts: z.array(KnowledgeOutputReferenceSchema).min(1).max(8), commits: z.array(z.string().regex(/^[a-f0-9]{40,64}$/)).min(1).max(20),
}).strict().refine(v => new Set(v.artifacts.map(a => a.id)).size === v.artifacts.length, '成果引用不能重复')
  .refine(v => OrganizationKnowledgeContentSchema.safeParse({ title: '交付来源', body: JSON.stringify(v), tags: [] }).success, '来源证据超出限额或包含凭据')
const common = { commandId: z.uuid(), expectedRevision: z.number().int().positive() }
const note = safeText(8, 2000)
const humanDecisions = [
  z.object({ ...common, action: z.literal('decline'), note }).strict(),
  z.object({ ...common, action: z.literal('cancel'), note }).strict(),
  z.object({ ...common, action: z.literal('reassign'), newAssignmentId: z.uuid(), assigneeId: id, note }).strict(),
  z.object({ ...common, action: z.literal('withdraw'), note }).strict(),
  z.object({ ...common, action: z.literal('accept_delivery'), expectedReportId: z.uuid(), note }).strict(),
  z.object({ ...common, action: z.literal('request_changes'), expectedReportId: z.uuid(), note }).strict(),
] as const
export const AssignmentHumanDecisionSchema = z.discriminatedUnion('action', humanDecisions)
export const AssignmentCommandSchema = z.discriminatedUnion('action', [
  ...humanDecisions,
  z.object({ ...common, action: z.literal('accept'), claim: AssignmentClaimSchema }).strict(),
  z.object({ ...common, action: z.literal('progress'), claim: AssignmentClaimSchema, counts: AssignmentCountsSchema, note }).strict(),
  z.object({ ...common, action: z.literal('delivery'), claim: AssignmentClaimSchema, counts: AssignmentCountsSchema, source: AssignmentDeliverySourceSchema, note }).strict(),
]).refine(boundedPayload, '提交内容超过传输限额，请拆分')
export type AssignmentCommand = z.infer<typeof AssignmentCommandSchema>
export const AssignmentCommandReceiptSchema = z.object({ commandId: z.uuid(), assignmentId: z.uuid(), organizationId: id, actorId: id,
  payloadHash: digest, revision: z.number().int().positive(), status: AssignmentStatusSchema, newAssignmentId: z.uuid().nullable(), createdAt: time,
}).strict()
const person = z.object({ id, name: z.string().max(120) }).strict()
export const AssignmentSummarySchema = z.object({ id: z.uuid(), organizationId: id, projectId: id, projectName: z.string().max(120),
  title: z.string().min(1).max(160), priority: AssignmentBriefSchema.shape.priority, dueAt: time.nullable(), assignee: person, dispatcher: person,
  status: AssignmentStatusSchema, revision: z.number().int().positive(), createdAt: time, updatedAt: time, canManage: z.boolean(), canRespond: z.boolean(),
}).strict()
export const AssignmentReportSchema = z.object({ id: z.uuid(), kind: z.enum(['progress', 'delivery']), authorId: id, counts: AssignmentCountsSchema,
  note, source: AssignmentDeliverySourceSchema.nullable(), createdAt: time,
}).strict()
export const AssignmentSchema = AssignmentSummarySchema.extend({ brief: AssignmentBriefSchema, briefChecksum: digest, creationHash: digest,
  claim: AssignmentClaimSchema.extend({ acceptedAt: time }).nullable(), replacesId: z.uuid().nullable(), report: AssignmentReportSchema.nullable(),
}).strict()
export type MemberAssignment = z.infer<typeof AssignmentSchema>
export const AssignmentDetailSchema = z.object({ assignment: AssignmentSchema,
  history: z.array(z.object({ commandId: z.uuid(), action: z.string().max(40), actor: person, note: z.string().max(2000).nullable(), revision: z.number().int().positive(), createdAt: time }).strict()).max(100),
}).strict()
export const AssignmentListSchema = z.object({ assignments: z.array(AssignmentSummarySchema).max(100), truncated: z.boolean() }).strict()
export const AssignmentRosterSchema = z.object({ projectId: id, members: z.array(person.extend({ role: z.enum(['owner', 'maintainer', 'contributor']) })).max(200) }).strict()
export const AssignmentAuthorityInputSchema = z.object({ assignmentId: z.uuid(), projectId: id, claim: AssignmentClaimSchema, purpose: z.enum(['execution', 'knowledge']).default('execution') }).strict()
export const AssignmentAuthoritySchema = z.object({ assignmentId: z.uuid(), projectId: id, assigneeId: id, claim: AssignmentClaimSchema,
  briefChecksum: digest, revision: z.number().int().positive(), status: z.enum(['accepted', 'in_progress', 'ready_for_review', 'completed']), purpose: z.enum(['execution', 'knowledge']),
}).strict()
