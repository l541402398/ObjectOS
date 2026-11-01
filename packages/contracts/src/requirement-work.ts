import { z } from 'zod'
import { IdSchema, TimestampSchema } from './common.js'
import { RequirementSchema, TaskCardSchema } from './entities.js'

export const TaskWorkspaceSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  requirementId: IdSchema,
  taskId: IdSchema.nullable(),
  kind: z.enum(['integration', 'development']),
  rootPath: z.string().min(1),
  branch: z.string().min(1),
  baseCommit: z.string().min(7).max(64),
  requirementVersion: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
})
export type TaskWorkspace = z.infer<typeof TaskWorkspaceSchema>

export const WorkspacePreparationSchema = z.object({
  id: IdSchema,
  taskId: IdSchema,
  requirementId: IdSchema,
  approvalId: IdSchema,
  runId: IdSchema,
  status: z.enum(['waiting_approval', 'executing', 'completed', 'rejected', 'failed', 'needs_reconciliation']),
  error: z.string().nullable(),
  createdAt: TimestampSchema,
})
export type WorkspacePreparation = z.infer<typeof WorkspacePreparationSchema>

export const TaskIntegrationOperationSchema = z.object({
  id: IdSchema, taskId: IdSchema, requirementId: IdSchema,
  kind: z.enum(['verify', 'integrate']),
  approvalId: IdSchema, runId: IdSchema,
  status: WorkspacePreparationSchema.shape.status,
  error: z.string().nullable(), resultCommit: z.string().nullable(),
  createdAt: TimestampSchema,
})
export type TaskIntegrationOperation = z.infer<typeof TaskIntegrationOperationSchema>

export const TaskIntegrationPreviewSchema = z.object({
  taskId: IdSchema, taskVersion: z.number(), requirementId: IdSchema, title: z.string(),
  fingerprint: z.string(), sourceHead: z.string(), targetHead: z.string(),
  sourceBranch: z.string(), targetBranch: z.string(),
  files: z.array(z.object({ path: z.string(), status: z.string() })),
  diff: z.string(), diffTruncated: z.boolean(), integrated: z.boolean(),
  review: z.object({ approved: z.boolean(), reasons: z.array(z.string()) }),
  verification: z.object({ passed: z.boolean(), reason: z.string(), command: z.string().nullable(), runId: IdSchema.nullable() }),
  blockers: z.array(z.string()), operations: z.array(TaskIntegrationOperationSchema),
})
export type TaskIntegrationPreview = z.infer<typeof TaskIntegrationPreviewSchema>

export const RequirementWorkViewSchema = z.object({
  requirement: RequirementSchema,
  tasks: z.array(TaskCardSchema),
  workspaces: z.array(TaskWorkspaceSchema),
  preparations: z.array(WorkspacePreparationSchema),
  integrations: z.array(TaskIntegrationOperationSchema),
})
export type RequirementWorkView = z.infer<typeof RequirementWorkViewSchema>

export const RequirementWorkApiSchemas = {
  'task.integration.preview': {
    input: z.object({ taskId: IdSchema }), output: TaskIntegrationPreviewSchema,
  },
  'task.integration.review': {
    input: z.object({ taskId: IdSchema, fingerprint: z.string().length(64), note: z.string().trim().min(5).max(4000) }),
    output: TaskIntegrationPreviewSchema,
  },
  'task.integration.request': {
    input: z.object({ taskId: IdSchema, fingerprint: z.string().length(64), kind: z.enum(['verify', 'integrate']), command: z.string().trim().min(1).max(2000).optional() }),
    output: TaskIntegrationOperationSchema,
  },
  'task.integration.reconcile': {
    input: z.object({ operationId: IdSchema }), output: TaskIntegrationOperationSchema,
  },
  'requirement.work': {
    input: z.object({ requirementId: IdSchema }), output: RequirementWorkViewSchema,
  },
  'requirement.update': {
    input: z.object({ requirementId: IdSchema, expectedVersion: z.number().int().nonnegative(),
      title: z.string().trim().min(1).max(240), body: z.string().max(40_000),
      technicalDesign: z.string().max(80_000), acceptanceCriteria: z.array(z.string().trim().min(1).max(2000)).max(50),
    }), output: RequirementSchema,
  },
  'task.workspace.request': {
    input: z.object({ taskId: IdSchema, expectedVersion: z.number().int().nonnegative() }), output: WorkspacePreparationSchema,
  },
  'task.workspace.reconcile': {
    input: z.object({ preparationId: IdSchema }), output: WorkspacePreparationSchema,
  },
} as const
