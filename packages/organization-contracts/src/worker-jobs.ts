import { z } from 'zod'
import { SharedAssetVersionSchema } from './assets.js'
import { LocalWorkerScopeSchema, WorkerInternalScopeSchema } from './local-worker.js'

const id = z.string().min(1).max(128)
export const WorkerJobSubmitSchema = z.object({ id: z.uuid(), grantId: z.uuid(), agentVersionId: id, prompt: z.string().trim().min(1).max(20_000) }).strict()
export const WorkerJobSchema = z.object({
  id: z.uuid(), organizationId: id, projectId: id, workerId: id, grantId: z.uuid(), requesterId: id,
  prompt: z.string().max(20_000), agent: SharedAssetVersionSchema, skills: z.array(SharedAssetVersionSchema).max(32),
  scope: LocalWorkerScopeSchema, scopeDigest: z.string(), fencing: z.number().int().nonnegative(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'needs_reconciliation']),
  toolCalls: z.number().int().nonnegative(), runId: id.nullable(), createdAt: z.number(), updatedAt: z.number(),
})
export const WorkerJobsSchema = z.object({ jobs: z.array(WorkerJobSchema).max(200) })
export const WorkerJobLeaseSchema = z.object({ job: WorkerJobSchema, token: z.string().regex(/^[A-Za-z0-9_-]{64}$/) })
export const WorkerJobProofSchema = z.object({ fencing: z.number().int().positive(), token: z.string().regex(/^[A-Za-z0-9_-]{64}$/) }).strict()
export const WorkerJobCheckSchema = WorkerJobProofSchema.extend({ tool: z.enum(['list_directory', 'read_file', 'write_file']).optional(), consume: z.boolean().default(false), runId:id.optional() }).strict()
export const WorkerJobFinishSchema = WorkerJobProofSchema.extend({ status: z.enum(['completed', 'failed', 'cancelled', 'needs_reconciliation']), runId: id }).strict()
export type WorkerJob = z.infer<typeof WorkerJobSchema>
/** Main-only delivery; never exported as a Renderer API. Credentials are ephemeral. */
export const WorkerJobInternalSchemas = {
  'runtime.worker.acceptJob': {
    input: WorkerInternalScopeSchema.extend({ lease: WorkerJobLeaseSchema, secret: z.string().regex(/^[A-Za-z0-9_-]{64}$/) }).strict(),
    output: z.object({ runId: id }),
  },
} as const
