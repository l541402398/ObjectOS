import { z } from 'zod'

export const GitSubjectSchema = z.object({ projectId: z.string().min(1), planId: z.string().nullable().default(null), taskId: z.string().nullable().default(null) })
  .refine(s => !(s.planId && s.taskId), '请选择计划或任务中的一个')
export const GitOperationKindSchema = z.enum(['fetch', 'pull', 'push', 'merge_plan', 'open_resolution', 'resolve_file', 'verify_project', 'verify_resolution', 'integrate_resolution'])
export const GitOperationSchema = z.object({
  id: z.string(), projectId: z.string(), kind: GitOperationKindSchema,
  status: z.enum(['waiting_approval', 'executing', 'completed', 'failed', 'rejected', 'needs_reconciliation']),
  approvalId: z.string(), runId: z.string(), parentId: z.string().nullable(),
  resultCommit: z.string().nullable(), error: z.string().nullable(), createdAt: z.number(),
})
export const GitResolutionSchema = z.object({
  id: z.string(), mode: z.enum(['manual', 'agent']), root: z.string(), branch: z.string(), fingerprint: z.string(),
  targetHead: z.string(), sourceHead: z.string(), agentRunId: z.string().nullable(),
  files: z.array(z.object({ path: z.string(), base: z.string().nullable(), ours: z.string().nullable(), theirs: z.string().nullable(), content: z.string().nullable(), conflict: z.boolean() })),
  reviewCurrent: z.boolean(), verificationCurrent: z.boolean(), verificationCommand: z.string().nullable(),
  diff: z.string(), diffTruncated: z.boolean(),
})
export const GitDeliveryStateSchema = z.object({
  subject: GitSubjectSchema, root: z.string(), branch: z.string(), head: z.string(), fingerprint: z.string(),
  diff: z.string(), diffTruncated: z.boolean(),
  remotes: z.array(z.object({ name: z.string(), branch: z.string(), trackingHead: z.string().nullable(), location: z.string() })),
  operations: z.array(GitOperationSchema), resolution: GitResolutionSchema.nullable(), contentReviewed: z.boolean(), contentVerified: z.boolean(),
})
export const GitCodeChangeSchema = z.object({path:z.string(),before:z.string().nullable(),after:z.string().nullable(),status:z.enum(['added','deleted','modified']),binary:z.boolean(),truncated:z.boolean(),conflict:z.boolean(),base:z.string().nullable(),ours:z.string().nullable(),theirs:z.string().nullable()})
export const GitCodeChangesSchema = z.object({fingerprint:z.string(),files:z.array(GitCodeChangeSchema),truncated:z.boolean()})
export const GitDeliveryApiSchemas = {
  'gitDelivery.changes': { input:z.object({subject:GitSubjectSchema,resolutionId:z.string().optional()}),output:GitCodeChangesSchema },
  'gitDelivery.state': { input: GitSubjectSchema, output: GitDeliveryStateSchema },
  'gitDelivery.request': { input: z.object({ subject: GitSubjectSchema, kind: GitOperationKindSchema,
    fingerprint: z.string(), remote: z.string().default('origin'), branch: z.string().optional(),
    mode: z.enum(['manual', 'agent']).default('manual'), resolutionId: z.string().optional(), resolutionFingerprint:z.string().optional(),
    path: z.string().optional(), content: z.string().max(200_000).optional(), command: z.string().max(2000).optional(),
    agentId: z.string().default('agt_engineer'),
  }), output: GitOperationSchema },
  'gitDelivery.review': { input: z.object({ subject: GitSubjectSchema, resolutionId: z.string(), fingerprint: z.string(), note: z.string().min(8).max(4000) }), output: z.object({ ok: z.literal(true) }) },
  'gitDelivery.reconcile': { input: z.object({ operationId: z.string(), note: z.string().min(8).max(4000) }), output: GitOperationSchema },
} as const
export type GitSubject = z.infer<typeof GitSubjectSchema>
export type GitOperation = z.infer<typeof GitOperationSchema>
export type GitResolution = z.infer<typeof GitResolutionSchema>
export type GitCodeChange = z.infer<typeof GitCodeChangeSchema>
