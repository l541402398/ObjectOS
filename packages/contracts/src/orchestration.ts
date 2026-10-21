import { z } from 'zod'
import { IdSchema, TimestampSchema } from './common.js'

export const ProjectFrameworkSchema = z.object({
  name: z.string(),
  evidence: z.array(z.string()).default([]),
})
export type ProjectFramework = z.infer<typeof ProjectFrameworkSchema>

export const ProjectModuleSchema = z.object({
  id: z.string(),
  path: z.string(),
  kind: z.string(),
})
export type ProjectModule = z.infer<typeof ProjectModuleSchema>

export const ProjectSnapshotSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  gitHead: z.string().nullable(),
  scannedAt: TimestampSchema,
  languages: z.array(z.string()),
  frameworks: z.array(ProjectFrameworkSchema),
  packageManager: z.string().nullable(),
  modules: z.array(ProjectModuleSchema),
  keyDependencies: z.array(z.string()),
  warnings: z.array(z.string()),
  indexVersion: z.number().int().positive(),
})
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>

export const PlanRoleSchema = z.enum(['architect', 'developer', 'reviewer', 'tester', 'custom'])
export type PlanRole = z.infer<typeof PlanRoleSchema>

export const PlannedTaskSchema = z.object({
  key: z.string().min(1).max(80),
  title: z.string().min(1).max(240),
  description: z.string().max(8000).default(''),
  role: PlanRoleSchema,
  /** Explicit AgentAssignment; omitted means the role default is used. */
  agentId: IdSchema.nullable().optional(),
  /** Why this Agent was chosen; shown in the plan editor and kept in plan JSON. */
  assignmentReasons: z.array(z.string().max(500)).default([]),
  /** True when no usable Agent could be resolved; approval is blocked until fixed. */
  assignmentBlocked: z.boolean().default(false),
  dependsOn: z.array(z.string().min(1).max(80)).default([]),
  acceptanceCriteria: z.array(z.string().max(2000)).default([]),
  expectedArtifacts: z.array(z.string().max(500)).default([]),
  requiresApproval: z.boolean().default(true),
})
export type PlannedTask = z.infer<typeof PlannedTaskSchema>

export const PlanStatusSchema = z.enum(['draft', 'approved', 'rejected'])
export const PlanGeneratorSchema = z.enum(['local-rules', 'provider'])

export const PlanExecutionStatusSchema = z.enum(['running', 'paused', 'completed', 'failed', 'cancelled'])
export type PlanExecutionStatus = z.infer<typeof PlanExecutionStatusSchema>

export const PlanExecutionSchema = z.object({
  status: PlanExecutionStatusSchema,
  concurrency: z.number().int().min(1).max(8).default(2),
  startedAt: TimestampSchema,
  updatedAt: TimestampSchema,
  error: z.string().max(4000).nullable().default(null),
  runIds: z.array(IdSchema).default([]),
  workspaceRef: z.string().max(2048).nullable().default(null),
  branch: z.string().max(240).nullable().default(null),
  diffArtifactId: IdSchema.nullable().default(null),
  mergedAt: TimestampSchema.nullable().default(null),
  maxRetries: z.number().int().min(0).max(5).default(2),
  retries: z.record(z.string(), z.number().int().nonnegative()).default({}),
  nextAttemptAt: z.record(z.string(), TimestampSchema).default({}),
  retryForRun: z.record(z.string(), IdSchema).default({}),
  requireWorktree: z.boolean().default(false),
})
export type PlanExecution = z.infer<typeof PlanExecutionSchema>

export const PlanDraftSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  revision: z.number().int().positive(),
  status: PlanStatusSchema,
  goal: z.string().min(1).max(8000),
  tasks: z.array(PlannedTaskSchema),
  assumptions: z.array(z.string()),
  risks: z.array(z.string()),
  generatedBy: PlanGeneratorSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  approvedAt: TimestampSchema.nullable(),
  createdTaskIds: z.array(IdSchema).default([]),
  execution: PlanExecutionSchema.nullable().default(null),
})
export type PlanDraft = z.infer<typeof PlanDraftSchema>

export const GraphNodeKindSchema = z.enum(['orchestrator', 'agent', 'task', 'milestone', 'approval'])
export const GraphEdgeKindSchema = z.enum(['delegation', 'dependency', 'handoff', 'artifact-flow'])
export const GraphNodeStatusSchema = z.enum([
  'idle',
  'queued',
  'running',
  'waiting',
  'blocked',
  'failed',
  'completed',
  'paused',
])
export type GraphNodeStatus = z.infer<typeof GraphNodeStatusSchema>

export const GraphLayoutPositionsSchema = z.record(
  z.string(),
  z.object({ x: z.number(), y: z.number() }),
)

export const GraphNodeSchema = z.object({
  id: z.string(),
  kind: GraphNodeKindSchema,
  label: z.string(),
  status: GraphNodeStatusSchema,
  projectId: IdSchema,
  taskId: IdSchema.nullable().optional(),
  agentId: IdSchema.nullable().optional(),
  runId: IdSchema.nullable().optional(),
  subtitle: z.string().optional(),
  progress: z.object({ completed: z.number().nonnegative(), total: z.number().positive() }).optional(),
  updatedAt: TimestampSchema,
})
export type GraphNode = z.infer<typeof GraphNodeSchema>

export const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  kind: GraphEdgeKindSchema,
  label: z.string().optional(),
})
export type GraphEdge = z.infer<typeof GraphEdgeSchema>

export const GraphSnapshotSchema = z.object({
  projectId: IdSchema,
  revision: z.number().int().nonnegative(),
  lastEventSeq: z.number().int().nonnegative(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  positions: GraphLayoutPositionsSchema.default({}),
  generatedAt: TimestampSchema,
})
export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>

export const GraphLayoutSchema = z.object({
  projectId: IdSchema,
  viewId: z.string().default('default'),
  positions: GraphLayoutPositionsSchema,
  updatedAt: TimestampSchema,
})
export type GraphLayout = z.infer<typeof GraphLayoutSchema>

export const PlanUpdateInputSchema = z.object({
  planId: IdSchema,
  goal: z.string().min(1).max(8000).optional(),
  tasks: z.array(PlannedTaskSchema).optional(),
  assumptions: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
})
export type PlanUpdateInput = z.infer<typeof PlanUpdateInputSchema>

export const WorktreeInfoSchema = z.object({
  planId: IdSchema,
  available: z.boolean(),
  branch: z.string().nullable(),
  workspaceRef: z.string().nullable(),
  status: PlanExecutionStatusSchema.nullable(),
  diff: z.string(),
  diffArtifactId: IdSchema.nullable(),
  mergedAt: TimestampSchema.nullable(),
})
export type WorktreeInfo = z.infer<typeof WorktreeInfoSchema>

export const ProjectMetricsSchema = z.object({
  projectId: IdSchema,
  tasksTotal: z.number().int().nonnegative(),
  tasksDone: z.number().int().nonnegative(),
  completionRate: z.number().min(0).max(1),
  blockedTasks: z.number().int().nonnegative(),
  activeRuns: z.number().int().nonnegative(),
  averageCycleTimeMs: z.number().nonnegative(),
  throughput7d: z.number().int().nonnegative(),
  agents: z.array(z.object({
    agentId: IdSchema,
    name: z.string(),
    runs: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
  })),
  criticalPath: z.array(z.object({ key: z.string(), title: z.string() })),
  planRevision: z.number().int().positive().nullable(),
})
export type ProjectMetrics = z.infer<typeof ProjectMetricsSchema>

export const ProjectBudgetSchema = z.object({
  projectId: IdSchema,
  softLimit: z.number().nonnegative(),
  currency: z.string().min(1).max(12),
  updatedAt: TimestampSchema,
})
export type ProjectBudget = z.infer<typeof ProjectBudgetSchema>

export const ProjectBudgetStatusSchema = z.object({
  budget: ProjectBudgetSchema.nullable(),
  spent: z.number().nonnegative(),
  remaining: z.number().nonnegative().nullable(),
  exceeded: z.boolean(),
})
export type ProjectBudgetStatus = z.infer<typeof ProjectBudgetStatusSchema>
