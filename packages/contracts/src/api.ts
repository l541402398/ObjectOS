import { z } from 'zod'
import {
  ApprovalStatusSchema,
  ArtifactKindSchema,
  CrossSessionTypeSchema,
  DecisionStatusSchema,
  HandoffStatusSchema,
  MilestoneStatusSchema,
  PrioritySchema,
  ProjectStatusSchema,
  RequirementStatusSchema,
  StageKeySchema,
  TaskStatusSchema,
} from './enums.js'
import { IdSchema, PageInputSchema, TimestampSchema } from './common.js'
import {
  AIConnectionCreateInputSchema,
  AIConnectionIdInputSchema,
  AIConnectionListSchema,
  AIConnectionProbeSchema,
  AIConnectionTestResultSchema,
  AIConnectionUpdateInputSchema,
  AIConnectionViewSchema,
  AIModelCreateInputSchema,
  AIModelDeleteInputSchema,
  AIModelListSchema,
  AIModelPriceListSchema,
  AIModelPriceUpsertSchema,
  AIModelSetDefaultInputSchema,
  AgentBackendBindingDeleteSchema,
  AgentBackendBindingListSchema,
  AgentBackendBindingUpsertSchema,
  AIUsageSummarySchema,
  ExternalAgentListSchema,
  ExternalAgentRunInputSchema,
  ExternalAgentRunResultSchema,
} from './ai.js'
import {
  GraphLayoutPositionsSchema,
  GraphSnapshotSchema,
  PlanDraftSchema,
  ProjectBudgetStatusSchema,
  ProjectMetricsSchema,
  WorktreeInfoSchema,
  PlanUpdateInputSchema,
  ProjectSnapshotSchema,
} from './orchestration.js'
import { AgentDefinitionSchema, AgentDefinitionUpsertSchema, RuntimeProfileSchema, RuntimeProfileUpsertSchema, RuntimeDetectionSchema, RuntimeRegistryEntrySchema, SkillSchema } from './v15.js'
import { OperationsSnapshotSchema, RepairProposalSchema, AutonomyModeSchema, AutomationTriggerSchema, AutomationGrantSchema, RiskDecisionSchema, OperationsInsightsSchema } from './operations.js'
import {
  ActivityItemSchema,
  AgentViewSchema,
  ApprovalViewSchema,
  ArtifactSchema,
  CollaborationSnapshotSchema,
  CommandResultSchema,
  DecisionSchema,
  FileContentSchema,
  HandoffViewSchema,
  InboxItemViewSchema,
  KnowledgeEntrySchema,
  MessageViewSchema,
  MilestoneSchema,
  ProjectEventViewSchema,
  ProjectOverviewSchema,
  ProjectSchema,
  ProjectStatsSchema,
  ProjectSummarySchema,
  ProviderInfoSchema,
  RequirementSchema,
  RunDetailSchema,
  RunSummarySchema,
  SessionDetailSchema,
  SessionSummarySchema,
  TaskBoardSchema,
  TaskCardSchema,
  TaskDetailSchema,
  WorkspaceSnapshotSchema,
} from './entities.js'

export const CreateProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(8000).default(''),
  rootPath: z.string().trim().min(1).max(2048),
  createDirectory: z.boolean().default(true),
  initGit: z.boolean().default(false),
})
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>

export const UpdateProjectInputSchema = z.object({
  projectId: IdSchema,
  expectedVersion: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(8000).optional(),
  status: ProjectStatusSchema.optional(),
})
export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>

export const CreateTaskInputSchema = z.object({
  projectId: IdSchema,
  title: z.string().trim().min(1).max(240),
  description: z.string().max(40_000).default(''),
  priority: PrioritySchema.default(3),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(2000)).max(50).default([]),
  expectedArtifacts: z.array(z.string().max(500)).max(50).optional(),
  labels: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  assigneeAgentId: IdSchema.nullable().default(null),
  milestoneId: IdSchema.nullable().default(null),
  dependsOn: z.array(IdSchema).max(50).default([]),
  dueAt: TimestampSchema.nullable().default(null),
})
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>

export const UpdateTaskInputSchema = z.object({
  taskId: IdSchema,
  expectedVersion: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().max(40_000).optional(),
  priority: PrioritySchema.optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(2000)).max(50).optional(),
  expectedArtifacts: z.array(z.string().max(500)).max(50).optional(),
  labels: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  assigneeAgentId: IdSchema.nullable().optional(),
  milestoneId: IdSchema.nullable().optional(),
  dueAt: TimestampSchema.nullable().optional(),
})
export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>

export const MoveTaskInputSchema = z.object({
  taskId: IdSchema,
  to: TaskStatusSchema,
  expectedVersion: z.number().int().nonnegative(),
  note: z.string().max(2000).optional(),
})
export type MoveTaskInput = z.infer<typeof MoveTaskInputSchema>

export const CreateRequirementInputSchema = z.object({
  projectId: IdSchema,
  title: z.string().trim().min(1).max(240),
  body: z.string().max(40_000).default(''),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(2000)).max(50).default([]),
  source: z.string().trim().max(240).default('local'),
})
export type CreateRequirementInput = z.infer<typeof CreateRequirementInputSchema>

export const CreateMilestoneInputSchema = z.object({
  projectId: IdSchema,
  title: z.string().trim().min(1).max(240),
  description: z.string().max(8000).default(''),
  dueAt: TimestampSchema.nullable().default(null),
})
export type CreateMilestoneInput = z.infer<typeof CreateMilestoneInputSchema>

export const CreateDecisionInputSchema = z.object({
  projectId: IdSchema,
  title: z.string().trim().min(1).max(240),
  body: z.string().max(40_000).default(''),
  status: DecisionStatusSchema.default('proposed'),
  supersedesId: IdSchema.nullable().optional(),
})
export type CreateDecisionInput = z.infer<typeof CreateDecisionInputSchema>

export const CreateSessionInputSchema = z.object({
  projectId: IdSchema,
  agentId: IdSchema,
  title: z.string().trim().min(1).max(240).optional(),
})
export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>

export const SendMessageInputSchema = z.object({
  sessionId: IdSchema,
  content: z.string().trim().min(1).max(100_000),
  taskId: IdSchema.nullable().optional(),
  startRun: z.boolean().default(false),
})
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>

export const StartRunInputSchema = z.object({
  projectId: IdSchema,
  sessionId: IdSchema,
  prompt: z.string().trim().min(1).max(100_000),
  taskId: IdSchema.nullable().default(null),
})
export type StartRunInput = z.infer<typeof StartRunInputSchema>

export const DecideApprovalInputSchema = z.object({
  approvalId: IdSchema,
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(2000).default(''),
})
export type DecideApprovalInput = z.infer<typeof DecideApprovalInputSchema>

export const SendCrossSessionInputSchema = z.object({
  projectId: IdSchema,
  fromSessionId: IdSchema,
  toSessionId: IdSchema,
  type: CrossSessionTypeSchema.default('agent.message'),
  body: z.string().trim().min(1).max(20_000),
  taskId: IdSchema.nullable().default(null),
  wake: z.boolean().default(true),
})
export type SendCrossSessionInput = z.infer<typeof SendCrossSessionInputSchema>

export const HandoffModeSchema = z.enum(['manual', 'auto'])
export type HandoffMode = z.infer<typeof HandoffModeSchema>

export const RequestHandoffInputSchema = z.object({
  taskId: IdSchema,
  toAgentId: IdSchema,
  summary: z.string().trim().min(1).max(20_000),
  sessionId: IdSchema.nullable().default(null),
  completed: z.array(z.string().max(4000)).default([]),
  remaining: z.array(z.string().max(4000)).default([]),
  risks: z.array(z.string().max(4000)).default([]),
  nextActions: z.array(z.string().max(4000)).default([]),
  artifactRefs: z.array(IdSchema).default([]),
  riskLevel: z.enum(['low', 'medium', 'high']).default('medium'),
})
export type RequestHandoffInput = z.input<typeof RequestHandoffInputSchema>

export const ProviderUpdateInputSchema = z.object({
  baseUrl: z.string().trim().url().max(2048),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().max(4000).optional(),
  temperature: z.number().min(0).max(2).default(0.2),
})
export type ProviderUpdateInput = z.infer<typeof ProviderUpdateInputSchema>

export const ProviderTestResultSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  model: z.string(),
  message: z.string(),
})
export type ProviderTestResult = z.infer<typeof ProviderTestResultSchema>

export const RuntimeHealthSchema = z.object({
  ok: z.boolean(),
  protocolVersion: z.number().int(),
  runtimeVersion: z.string(),
  pid: z.number().int(),
  uptimeMs: z.number().int().nonnegative(),
  activeRuns: z.number().int().nonnegative(),
  queuedApprovals: z.number().int().nonnegative(),
})
export type RuntimeHealth = z.infer<typeof RuntimeHealthSchema>

export const SeedDemoResultSchema = z.object({
  projectId: IdSchema,
  projectName: z.string(),
  created: z.boolean(),
})
export type SeedDemoResult = z.infer<typeof SeedDemoResultSchema>

const empty = z.object({})
const ok = z.object({ ok: z.literal(true) })

const projectIdInput = z.object({ projectId: IdSchema })

/** Renderer → Main → Runtime request catalogue. Inputs are validated at both boundaries. */
export const ApiSchemas = {
  'app.bootstrap': {
    input: empty,
    output: z.object({
      projects: z.array(ProjectSummarySchema),
      stats: ProjectStatsSchema,
      provider: ProviderInfoSchema,
      runtime: z.object({
        status: z.enum(['starting', 'ready', 'restarting', 'stopped', 'failed']),
        pid: z.number().int().nullable(),
        restartCount: z.number().int().nonnegative(),
        message: z.string().nullable(),
        since: TimestampSchema,
      }),
      pendingApprovals: z.array(ApprovalViewSchema),
      recentActivity: z.array(ActivityItemSchema),
    }),
  },
  'project.list': {
    input: z.object({ includeArchived: z.boolean().default(false) }).default({ includeArchived: false }),
    output: z.object({ projects: z.array(ProjectSummarySchema) }),
  },
  'project.create': {
    input: CreateProjectInputSchema,
    output: z.object({ project: ProjectSchema }),
  },
  'project.overview': {
    input: projectIdInput,
    output: ProjectOverviewSchema,
  },
  'project.update': {
    input: UpdateProjectInputSchema,
    output: z.object({ project: ProjectSchema }),
  },
  'project.advanceStage': {
    input: z.object({ projectId: IdSchema, stage: StageKeySchema.optional() }),
    output: z.object({ project: ProjectSchema, overview: ProjectOverviewSchema }),
  },
  'project.activity': {
    input: z.object({ projectId: IdSchema, limit: z.number().int().min(1).max(200).default(50) }),
    output: z.object({ events: z.array(ProjectEventViewSchema) }),
  },
  'project.reveal': {
    input: projectIdInput,
    output: ok,
  },
  'task.board': {
    input: projectIdInput,
    output: TaskBoardSchema,
  },
  'task.detail': {
    input: z.object({ taskId: IdSchema }),
    output: TaskDetailSchema,
  },
  'task.create': {
    input: CreateTaskInputSchema,
    output: z.object({ task: TaskCardSchema }),
  },
  'task.update': {
    input: UpdateTaskInputSchema,
    output: z.object({ task: TaskCardSchema }),
  },
  'task.move': {
    input: MoveTaskInputSchema,
    output: z.object({ task: TaskCardSchema }),
  },
  'task.addDependency': {
    input: z.object({ taskId: IdSchema, dependsOnId: IdSchema }),
    output: z.object({ task: TaskCardSchema }),
  },
  'task.removeDependency': {
    input: z.object({ taskId: IdSchema, dependsOnId: IdSchema }),
    output: z.object({ task: TaskCardSchema }),
  },
  'requirement.list': {
    input: projectIdInput,
    output: z.object({ requirements: z.array(RequirementSchema) }),
  },
  'requirement.create': {
    input: CreateRequirementInputSchema,
    output: z.object({ requirement: RequirementSchema }),
  },
  'requirement.setStatus': {
    input: z.object({ requirementId: IdSchema, status: RequirementStatusSchema }),
    output: z.object({ requirement: RequirementSchema }),
  },
  'milestone.list': {
    input: projectIdInput,
    output: z.object({ milestones: z.array(MilestoneSchema) }),
  },
  'milestone.create': {
    input: CreateMilestoneInputSchema,
    output: z.object({ milestone: MilestoneSchema }),
  },
  'milestone.setStatus': {
    input: z.object({ milestoneId: IdSchema, status: MilestoneStatusSchema }),
    output: z.object({ milestone: MilestoneSchema }),
  },
  'decision.list': {
    input: projectIdInput,
    output: z.object({ decisions: z.array(DecisionSchema) }),
  },
  'decision.create': {
    input: CreateDecisionInputSchema,
    output: z.object({ decision: DecisionSchema }),
  },
  'decision.setStatus': {
    input: z.object({ decisionId: IdSchema, status: DecisionStatusSchema }),
    output: z.object({ decision: DecisionSchema }),
  },
  'artifact.list': {
    input: z.object({ projectId: IdSchema, taskId: IdSchema.nullable().default(null) }),
    output: z.object({ artifacts: z.array(ArtifactSchema) }),
  },
  'artifact.create': {
    input: z.object({
      projectId: IdSchema,
      taskId: IdSchema.nullable().default(null),
      runId: IdSchema.nullable().default(null),
      kind: ArtifactKindSchema.default('document'),
      title: z.string().trim().min(1).max(240),
      body: z.string().max(400_000).default(''),
      uri: z.string().max(2048).nullable().default(null),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
    output: z.object({ artifact: ArtifactSchema }),
  },
  'knowledge.list': {
    input: projectIdInput,
    output: z.object({ entries: z.array(KnowledgeEntrySchema) }),
  },
  'knowledge.search': {
    input: z.object({
      projectId: IdSchema,
      query: z.string().trim().min(1).max(500),
      limit: z.number().int().min(1).max(100).default(30),
    }),
    output: z.object({ entries: z.array(KnowledgeEntrySchema) }),
  },
  'agentDefinition.list': {
    input: empty,
    output: z.object({ agents: z.array(AgentDefinitionSchema) }),
  },
  'agentDefinition.upsert': {
    input: AgentDefinitionUpsertSchema,
    output: AgentDefinitionSchema,
  },
  'agentDefinition.setStatus': {
    input: z.object({ id: IdSchema, status: z.enum(['active', 'disabled', 'archived']) }),
    output: AgentDefinitionSchema,
  },
  'agentDefinition.export': {
    input: z.object({ id: IdSchema }),
    output: z.object({ json: z.string(), filename: z.string() }),
  },
  'agentDefinition.import': {
    input: z.object({ json: z.string().min(2).max(200_000) }),
    output: AgentDefinitionSchema,
  },
  'agentDefinition.delete': {
    input: z.object({ id: IdSchema }),
    output: ok,
  },
  'agentDefinition.run': {
    input: z.object({ agentId: IdSchema, projectId: IdSchema, prompt: z.string().trim().min(1).max(20_000), cwd: z.string().max(2000).optional() }),
    output: z.object({ sessionId: IdSchema, runId: IdSchema, profileId: IdSchema, executionId: z.string(), status: z.enum(['completed', 'failed', 'cancelled', 'timeout']), output: z.string(), events: z.array(z.object({ type: z.string(), text: z.string() })), durationMs: z.number().int().nonnegative(), workspaceRef: z.string().nullable() }),
  },
  'agentDefinition.preview': {
    input: z.object({ id: IdSchema }),
    output: z.object({ prompt: z.string(), sources: z.array(z.string()) }),
  },
  'skill.list': {
    input: empty,
    output: z.object({ skills: z.array(SkillSchema) }),
  },
  'skill.import': {
    input: z.object({ name: z.string().trim().min(1).max(120), content: z.string().min(1).max(100_000), description: z.string().max(4000).default(''), version: z.string().max(40).default('1.0.0') }),
    output: SkillSchema,
  },
  'runtime.list': {
    input: empty,
    output: z.object({ profiles: z.array(RuntimeProfileSchema), detections: z.array(RuntimeDetectionSchema) }),
  },
  'runtime.upsert': {
    input: RuntimeProfileUpsertSchema,
    output: RuntimeProfileSchema,
  },
  'runtime.delete': {
    input: z.object({ id: IdSchema }),
    output: ok,
  },
  'runtime.detect': {
    input: z.object({ profileId: IdSchema.optional() }),
    output: z.object({ detections: z.array(RuntimeDetectionSchema) }),
  },
  'runtime.install': {
    input: z.object({ profileId: IdSchema }),
    output: z.object({ detection: RuntimeDetectionSchema, output: z.string() }),
  },
  'runtime.importRegistry': {
    input: z.object({ registryId: z.string().min(1).max(200), name: z.string().trim().min(1).max(120), version: z.string().max(40).nullable().default(null), description: z.string().max(2000).default('') }),
    output: RuntimeProfileSchema,
  },
  'runtime.acpAuthenticate': {
    input: z.object({ profileId: IdSchema, methodId: z.string().min(1).max(120), cwd: z.string().max(2000).optional() }),
    output: z.object({ ok: z.boolean(), result: z.unknown() }),
  },
  'runtime.acpPrompt': {
    input: z.object({ profileId: IdSchema, prompt: z.string().trim().min(1).max(20_000), cwd: z.string().max(2000).optional() }),
    output: z.object({ sessionId: z.string(), result: z.unknown(), events: z.array(z.unknown()), durationMs: z.number().int().nonnegative() }),
  },
  'runtime.acpHandshake': {
    input: z.object({ profileId: IdSchema, cwd: z.string().max(2000).optional() }),
    output: z.object({ sessionId: z.string(), protocolVersion: z.number().optional(), agentInfo: z.unknown().optional(), capabilities: z.unknown().optional() }),
  },
  'runtime.execute': {
    input: z.object({ profileId: IdSchema, prompt: z.string().trim().min(1).max(20_000), cwd: z.string().max(2000).optional() }),
    output: z.object({ executionId: z.string(), status: z.enum(['completed', 'failed', 'cancelled', 'timeout']), output: z.string(), events: z.array(z.object({ type: z.string(), text: z.string() })), durationMs: z.number().int().nonnegative() }),
  },
  'runtime.cancel': {
    input: z.object({ executionId: z.string() }),
    output: ok,
  },
  'runtime.registry': {
    input: z.object({ force: z.boolean().default(false) }),
    output: z.object({ source: z.string(), cachedAt: TimestampSchema, entries: z.array(RuntimeRegistryEntrySchema) }),
  },
  'agent.list': {
    input: projectIdInput,
    output: z.object({ agents: z.array(AgentViewSchema) }),
  },
  'session.list': {
    input: projectIdInput,
    output: z.object({ sessions: z.array(SessionSummarySchema) }),
  },
  'session.create': {
    input: CreateSessionInputSchema,
    output: z.object({ session: SessionSummarySchema }),
  },
  'session.get': {
    input: z.object({ sessionId: IdSchema, messageLimit: z.number().int().min(1).max(500).default(200) }),
    output: SessionDetailSchema,
  },
  'session.sendMessage': {
    input: SendMessageInputSchema,
    output: z.object({
      message: MessageViewSchema,
      runId: IdSchema.nullable(),
      warning: z.string().nullable(),
    }),
  },
  'session.update': {
    input: z.object({
      sessionId: IdSchema,
      title: z.string().trim().min(1).max(240).optional(),
      status: z.enum(['active', 'idle', 'archived']).optional(),
    }),
    output: z.object({ session: SessionSummarySchema }),
  },
  'run.start': {
    input: StartRunInputSchema,
    output: z.object({ runId: IdSchema, messageId: IdSchema }),
  },
  'run.cancel': {
    input: z.object({ runId: IdSchema }),
    output: ok,
  },
  'run.reconcile': {
    input: z.object({
      runId: IdSchema,
      decision: z.enum(['completed', 'retry', 'failed']),
      note: z.string().max(4000).default(''),
    }),
    output: z.object({
      runId: IdSchema,
      status: z.string().max(40),
      taskId: IdSchema.nullable(),
    }),
  },
  'run.list': {
    input: z.object({
      projectId: IdSchema,
      limit: z.number().int().min(1).max(200).default(50),
    }),
    output: z.object({ runs: z.array(RunSummarySchema) }),
  },
  'run.get': {
    input: z.object({ runId: IdSchema }),
    output: RunDetailSchema,
  },
  'approval.list': {
    input: z.object({
      projectId: IdSchema.nullable().default(null),
      runId: IdSchema.nullable().default(null),
    }),
    output: z.object({ approvals: z.array(ApprovalViewSchema) }),
  },
  'approval.decide': {
    input: DecideApprovalInputSchema,
    output: z.object({ approval: ApprovalViewSchema }),
  },
  'collaboration.snapshot': {
    input: projectIdInput,
    output: CollaborationSnapshotSchema,
  },
  'inbox.send': {
    input: SendCrossSessionInputSchema,
    output: z.object({ inbox: InboxItemViewSchema }),
  },
  'inbox.list': {
    input: z.object({
      projectId: IdSchema,
      sessionId: IdSchema.nullable().default(null),
      limit: z.number().int().min(1).max(200).default(100),
    }),
    output: z.object({ items: z.array(InboxItemViewSchema) }),
  },
  'inbox.ack': {
    input: z.object({ inboxId: IdSchema }),
    output: z.object({ inbox: InboxItemViewSchema }),
  },
  'inbox.resume': {
    input: z.object({ inboxId: IdSchema }),
    output: z.object({ runId: IdSchema.nullable(), warning: z.string().nullable() }),
  },
  'handoff.list': {
    input: projectIdInput,
    output: z.object({ handoffs: z.array(HandoffViewSchema) }),
  },
  'handoff.request': {
    input: RequestHandoffInputSchema,
    output: z.object({ handoff: HandoffViewSchema }),
  },
  'handoff.accept': {
    input: z.object({ handoffId: IdSchema, sessionId: IdSchema.nullable().default(null) }),
    output: z.object({ handoff: HandoffViewSchema, sessionId: IdSchema }),
  },
  'handoff.reject': {
    input: z.object({ handoffId: IdSchema, reason: z.string().max(2000).default('') }),
    output: z.object({ handoff: HandoffViewSchema }),
  },
  'handoff.cancel': {
    input: z.object({ handoffId: IdSchema, reason: z.string().max(2000).default('') }),
    output: z.object({ handoff: HandoffViewSchema }),
  },
  'handoff.policy.get': {
    input: projectIdInput,
    output: z.object({ mode: HandoffModeSchema }),
  },
  'handoff.policy.set': {
    input: z.object({ projectId: IdSchema, mode: HandoffModeSchema }),
    output: z.object({ mode: HandoffModeSchema }),
  },
  'workspace.snapshot': {
    input: projectIdInput,
    output: WorkspaceSnapshotSchema,
  },
  'workspace.readFile': {
    input: z.object({ projectId: IdSchema, path: z.string().min(1).max(2048) }),
    output: FileContentSchema,
  },
  'workspace.gitDiff': {
    input: z.object({ projectId: IdSchema, path: z.string().max(2048).optional() }),
    output: z.object({ patch: z.string(), truncated: z.boolean() }),
  },
  'workspace.runReadonly': {
    input: z.object({ projectId: IdSchema, command: z.string().trim().min(1).max(400) }),
    output: CommandResultSchema,
  },
  'event.list': {
    input: z.object({
      projectId: IdSchema,
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
      sinceSeq: z.number().int().nonnegative().optional(),
    }),
    output: z.object({ events: z.array(ProjectEventViewSchema) }),
  },
  'provider.status': {
    input: empty,
    output: ProviderInfoSchema,
  },
  'provider.test': {
    input: empty,
    output: ProviderTestResultSchema,
  },
  'runtime.health': {
    input: empty,
    output: RuntimeHealthSchema,
  },
  'runtime.ai.credentials': {
    input: z.object({ connections: z.array(AIConnectionProbeSchema) }),
    output: ok,
  },
  'demo.seed': {
    input: z.object({ force: z.boolean().default(false) }).default({ force: false }),
    output: SeedDemoResultSchema,
  },
  'settings.get': {
    input: empty,
    output: ProviderInfoSchema,
  },
  'settings.update': {
    input: ProviderUpdateInputSchema,
    output: ProviderInfoSchema,
  },
  'settings.clearKey': {
    input: empty,
    output: ProviderInfoSchema,
  },
  'settings.test': {
    input: empty,
    output: ProviderTestResultSchema,
  },
  'aiConnections.list': {
    input: empty,
    output: AIConnectionListSchema,
  },
  'aiConnections.create': {
    input: AIConnectionCreateInputSchema,
    output: AIConnectionViewSchema,
  },
  'aiConnections.update': {
    input: AIConnectionUpdateInputSchema,
    output: AIConnectionViewSchema,
  },
  'aiConnections.delete': {
    input: AIConnectionIdInputSchema,
    output: ok,
  },
  'aiConnections.setDefault': {
    input: AIConnectionIdInputSchema,
    output: AIConnectionViewSchema,
  },
  'aiConnections.test': {
    input: AIConnectionIdInputSchema,
    output: AIConnectionTestResultSchema,
  },
  'aiConnections.discoverModels': {
    input: AIConnectionIdInputSchema,
    output: AIModelListSchema,
  },
  'aiModels.list': {
    input: AIConnectionIdInputSchema,
    output: AIModelListSchema,
  },
  'aiModels.create': {
    input: AIModelCreateInputSchema,
    output: AIModelListSchema,
  },
  'aiModels.delete': {
    input: AIModelDeleteInputSchema,
    output: AIModelListSchema,
  },
  'aiModels.setDefault': {
    input: AIModelSetDefaultInputSchema,
    output: AIConnectionViewSchema,
  },
  'aiPricing.list': {
    input: z.object({ connectionId: IdSchema.optional() }).default({}),
    output: AIModelPriceListSchema,
  },
  'aiPricing.upsert': {
    input: AIModelPriceUpsertSchema,
    output: AIModelPriceListSchema,
  },
  'aiPricing.delete': {
    input: z.object({ id: IdSchema }),
    output: ok,
  },
  'aiRouting.list': {
    input: z.object({ projectId: IdSchema.optional() }).default({}),
    output: AgentBackendBindingListSchema,
  },
  'aiRouting.upsert': {
    input: AgentBackendBindingUpsertSchema,
    output: AgentBackendBindingListSchema,
  },
  'aiRouting.delete': {
    input: AgentBackendBindingDeleteSchema,
    output: ok,
  },
  'aiUsage.summary': {
    input: z.object({ projectId: IdSchema.optional() }).default({}),
    output: AIUsageSummarySchema,
  },
  'externalAgents.list': {
    input: empty,
    output: ExternalAgentListSchema,
  },
  'externalAgents.execute': {
    input: ExternalAgentRunInputSchema,
    output: ExternalAgentRunResultSchema,
  },
  'externalAgents.cancel': {
    input: z.object({ runId: IdSchema }),
    output: ok,
  },
  'project.scan': {
    input: z.object({ projectId: IdSchema }),
    output: ProjectSnapshotSchema,
  },
  'project.snapshot.get': {
    input: z.object({ projectId: IdSchema }),
    output: z.object({ snapshot: ProjectSnapshotSchema.nullable() }),
  },
  'project.metrics': {
    input: z.object({ projectId: IdSchema }),
    output: ProjectMetricsSchema,
  },
  'operations.snapshot': {
    input: z.object({ projectId: IdSchema }),
    output: OperationsSnapshotSchema,
  },
  'operations.runChecks': {
    input: z.object({ projectId: IdSchema }),
    output: OperationsSnapshotSchema,
  },
  'operations.propose': {
    input: z.object({ projectId: IdSchema, findingIds: z.array(IdSchema).min(1) }),
    output: RepairProposalSchema,
  },
  'operations.startRepair': {
    input: z.object({ proposalId: IdSchema }),
    output: z.object({ proposal: RepairProposalSchema, plan: PlanDraftSchema }),
  },
  'operations.reviewProposal': {
    input: z.object({ proposalId: IdSchema, decision: z.enum(['approved', 'rejected']) }),
    output: RepairProposalSchema,
  },
  'operations.getTrigger': {
    input: z.object({ projectId: IdSchema }),
    output: AutomationTriggerSchema.nullable(),
  },
  'operations.setTrigger': {
    input: z.object({ projectId: IdSchema, intervalMinutes: z.number().int().min(5).max(1440), enabled: z.boolean() }),
    output: AutomationTriggerSchema,
  },
  'operations.insights': {
    input: z.object({ projectId: IdSchema, runAudit: z.boolean().default(false) }),
    output: OperationsInsightsSchema,
  },
  'operations.risk': {
    input: z.object({ proposalId: IdSchema }),
    output: RiskDecisionSchema,
  },
  'operations.getGrant': {
    input: z.object({ projectId: IdSchema }),
    output: AutomationGrantSchema.nullable(),
  },
  'operations.grant': {
    input: z.object({ projectId: IdSchema, hours: z.number().int().min(1).max(168).default(24), maxRuns: z.number().int().min(1).max(50).default(5) }),
    output: AutomationGrantSchema,
  },
  'operations.revokeGrant': {
    input: z.object({ projectId: IdSchema }),
    output: AutomationGrantSchema,
  },
  'operations.setMode': {
    input: z.object({
      projectId: IdSchema,
      mode: AutonomyModeSchema,
      repairAgentId: IdSchema.nullable().optional(),
    }),
    output: OperationsSnapshotSchema,
  },
  'project.budget.get': {
    input: z.object({ projectId: IdSchema }),
    output: ProjectBudgetStatusSchema,
  },
  'project.qualityPolicy.get': {
    input: z.object({ projectId: IdSchema }),
    output: z.object({
      required: z.array(z.string().max(80)).max(20),
      optional: z.array(z.string().max(80)).max(20),
    }),
  },
  'project.qualityPolicy.set': {
    input: z.object({
      projectId: IdSchema,
      required: z.array(z.string().max(80)).max(20),
      optional: z.array(z.string().max(80)).max(20),
    }),
    output: z.object({
      required: z.array(z.string().max(80)).max(20),
      optional: z.array(z.string().max(80)).max(20),
    }),
  },
  'project.budget.set': {
    input: z.object({
      projectId: IdSchema,
      softLimit: z.number().nonnegative(),
      currency: z.string().trim().min(1).max(12).default('USD'),
    }),
    output: ProjectBudgetStatusSchema,
  },
  'plan.generate': {
    input: z.object({ projectId: IdSchema, goal: z.string().trim().min(3).max(8000) }),
    output: PlanDraftSchema,
  },
  'plan.list': {
    input: z.object({ projectId: IdSchema }),
    output: z.object({ plans: z.array(PlanDraftSchema) }),
  },
  'plan.get': {
    input: z.object({ planId: IdSchema }),
    output: PlanDraftSchema,
  },
  'plan.update': {
    input: PlanUpdateInputSchema,
    output: PlanDraftSchema,
  },
  'plan.revise': {
    input: PlanUpdateInputSchema,
    output: PlanDraftSchema,
  },
  'plan.approve': {
    input: z.object({ planId: IdSchema }),
    output: z.object({ plan: PlanDraftSchema, taskIds: z.array(IdSchema) }),
  },
  'plan.reject': {
    input: z.object({ planId: IdSchema }),
    output: PlanDraftSchema,
  },
  'plan.discuss': {
    input: z.object({ planId: IdSchema, content: z.string().trim().min(1).max(20_000) }),
    // The discussion runs in the background; the final per-agent success/failure counts
    // are appended to the group session as a system summary message.
    output: z.object({
      groupSessionId: IdSchema,
      participants: z.number().int().nonnegative(),
      status: z.literal('started'),
    }),
  },
  'orchestration.start': {
    input: z.object({ planId: IdSchema, concurrency: z.number().int().min(1).max(8).default(2), maxRetries: z.number().int().min(0).max(5).default(2), allowOverBudget: z.boolean().default(false) }),
    output: PlanDraftSchema,
  },
  'orchestration.pause': {
    input: z.object({ planId: IdSchema }),
    output: PlanDraftSchema,
  },
  'orchestration.resume': {
    input: z.object({ planId: IdSchema }),
    output: PlanDraftSchema,
  },
  'orchestration.cancel': {
    input: z.object({ planId: IdSchema }),
    output: PlanDraftSchema,
  },
  'worktree.info': {
    input: z.object({ planId: IdSchema }),
    output: WorktreeInfoSchema,
  },
  'worktree.merge': {
    input: z.object({ planId: IdSchema }),
    output: WorktreeInfoSchema,
  },
  'worktree.discard': {
    input: z.object({ planId: IdSchema }),
    output: ok,
  },
  'graph.snapshot.get': {
    input: z.object({ projectId: IdSchema }),
    output: GraphSnapshotSchema,
  },
  'graph.layout.save': {
    input: z.object({
      projectId: IdSchema,
      viewId: z.string().min(1).max(80).default('default'),
      positions: GraphLayoutPositionsSchema,
    }),
    output: ok,
  },
  'app.pickDirectory': {
    input: z.object({ title: z.string().max(200).default('选择项目根目录') }).default({ title: '选择项目根目录' }),
    output: z.object({ canceled: z.boolean(), path: z.string().nullable() }),
  },
  'app.revealPath': {
    input: z.object({ path: z.string().min(1).max(2048) }),
    output: ok,
  },
  'app.openExternal': {
    input: z.object({ url: z.string().url().max(2048) }),
    output: ok,
  },
  'app.windowMinimize': { input: empty, output: ok },
  'app.windowToggleMaximize': { input: empty, output: z.object({ maximized: z.boolean() }) },
  'app.windowClose': { input: empty, output: ok },
  'app.runtimeStatus': {
    input: empty,
    output: z.object({
      status: z.enum(['starting', 'ready', 'restarting', 'stopped', 'failed']),
      pid: z.number().int().nullable(),
      restartCount: z.number().int().nonnegative(),
      message: z.string().nullable(),
      since: TimestampSchema,
    }),
  },
  'app.preferences.get': {
    input: empty,
    output: z.object({
      provider: ProviderInfoSchema,
      dataDir: z.string(),
      appVersion: z.string(),
      platform: z.string(),
    }),
  },
} as const

export type ApiMethod = keyof typeof ApiSchemas
export type ApiInput<M extends ApiMethod> = z.input<(typeof ApiSchemas)[M]['input']>
export type ApiOutput<M extends ApiMethod> = z.output<(typeof ApiSchemas)[M]['output']>
export type ApiParsedInput<M extends ApiMethod> = z.output<(typeof ApiSchemas)[M]['input']>

export const MAIN_METHODS = [
  'settings.get',
  'settings.update',
  'settings.clearKey',
  'settings.test',
  'aiConnections.list',
  'aiConnections.create',
  'aiConnections.update',
  'aiConnections.delete',
  'aiConnections.setDefault',
  'aiConnections.test',
  'aiConnections.discoverModels',
  'aiModels.list',
  'aiModels.create',
  'aiModels.delete',
  'aiModels.setDefault',
  'app.pickDirectory',
  'app.revealPath',
  'app.openExternal',
  'app.windowMinimize',
  'app.windowToggleMaximize',
  'app.windowClose',
  'app.runtimeStatus',
  'app.preferences.get',
  'runtime.health',
  'project.reveal',
  'app.bootstrap',
] as const satisfies readonly ApiMethod[]

export type MainMethod = (typeof MAIN_METHODS)[number]

export const RUNTIME_METHODS = (Object.keys(ApiSchemas) as ApiMethod[]).filter(
  (method): method is Exclude<ApiMethod, MainMethod> =>
    !(MAIN_METHODS as readonly string[]).includes(method),
)

export function isApiMethod(value: string): value is ApiMethod {
  return Object.prototype.hasOwnProperty.call(ApiSchemas, value)
}

export function isMainMethod(value: string): value is MainMethod {
  return (MAIN_METHODS as readonly string[]).includes(value)
}

export const ApprovalDecisionSchema = ApprovalStatusSchema.extract(['approved', 'rejected'])
export const PageSchema = PageInputSchema
export const HandoffDecisionSchema = HandoffStatusSchema.extract(['accepted', 'rejected'])



















