import { z } from 'zod'
import {
  AgentCapabilitySchema,
  ApprovalStatusSchema,
  ArtifactKindSchema,
  CrossSessionTypeSchema,
  DecisionStatusSchema,
  DeliveryStatusSchema,
  HandoffStatusSchema,
  MessageRoleSchema,
  MilestoneStatusSchema,
  PrioritySchema,
  ProjectStatusSchema,
  RequirementStatusSchema,
  RunStatusSchema,
  RunStepKindSchema,
  SessionStatusSchema,
  StageKeySchema,
  StageStatusSchema,
  TaskStatusSchema,
  ToolCallStatusSchema,
} from './enums.js'
import { IdSchema, JsonObjectSchema, TimestampSchema } from './common.js'

const nullableTimestamp = TimestampSchema.nullable()

export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(8000).default(''),
  rootPath: z.string().min(1).max(2048),
  status: ProjectStatusSchema,
  currentStage: StageKeySchema,
  version: z.number().int().nonnegative(),
  isDemo: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Project = z.infer<typeof ProjectSchema>

export const ProjectStageSchema = z.object({
  projectId: IdSchema,
  stage: StageKeySchema,
  status: StageStatusSchema,
  position: z.number().int().nonnegative(),
  updatedAt: TimestampSchema,
})
export type ProjectStage = z.infer<typeof ProjectStageSchema>

export const RequirementSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  title: z.string().min(1).max(240),
  body: z.string().max(40_000).default(''),
  status: RequirementStatusSchema,
  source: z.string().max(240).default('local'),
  acceptanceCriteria: z.array(z.string().max(2000)).max(50),
  version: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Requirement = z.infer<typeof RequirementSchema>

export const MilestoneSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  title: z.string().min(1).max(240),
  description: z.string().max(8000).default(''),
  dueAt: nullableTimestamp,
  status: MilestoneStatusSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Milestone = z.infer<typeof MilestoneSchema>

export const TaskSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  parentId: IdSchema.nullable(),
  milestoneId: IdSchema.nullable(),
  title: z.string().min(1).max(240),
  description: z.string().max(40_000).default(''),
  status: TaskStatusSchema,
  priority: PrioritySchema,
  assigneeAgentId: IdSchema.nullable(),
  acceptanceCriteria: z.array(z.string().max(2000)).max(50),
  labels: z.array(z.string().max(60)).max(20),
  version: z.number().int().nonnegative(),
  dueAt: nullableTimestamp,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Task = z.infer<typeof TaskSchema>

export const TaskAttemptSchema = z.object({
  id: IdSchema,
  taskId: IdSchema,
  attemptNo: z.number().int().positive(),
  agentId: IdSchema,
  runId: IdSchema.nullable(),
  status: z.string().max(40),
  createdAt: TimestampSchema,
})
export type TaskAttempt = z.infer<typeof TaskAttemptSchema>

export const TaskDependencySchema = z.object({
  taskId: IdSchema,
  dependsOnId: IdSchema,
})
export type TaskDependency = z.infer<typeof TaskDependencySchema>

export const AgentSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(80),
  description: z.string().max(4000).default(''),
  kind: z.enum(['builtin', 'external']),
  driverId: z.string().min(1).max(120),
  capabilities: z.array(AgentCapabilitySchema),
  accent: z.string().max(32),
  systemPrompt: z.string().max(30_000).default(''),
  builtin: z.boolean(),
  createdAt: TimestampSchema,
})
export type Agent = z.infer<typeof AgentSchema>

export const SessionSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  agentId: IdSchema,
  title: z.string().min(1).max(240),
  status: SessionStatusSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Session = z.infer<typeof SessionSchema>

export const MessageSchema = z.object({
  id: IdSchema,
  sessionId: IdSchema,
  seq: z.number().int().positive(),
  role: MessageRoleSchema,
  content: z.string().max(400_000),
  runId: IdSchema.nullable(),
  metadata: JsonObjectSchema.default({}),
  createdAt: TimestampSchema,
})
export type Message = z.infer<typeof MessageSchema>

export const RunSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  taskId: IdSchema.nullable(),
  sessionId: IdSchema,
  agentId: IdSchema,
  attempt: z.number().int().positive(),
  status: RunStatusSchema,
  error: z.string().max(8000).nullable(),
  summary: z.string().max(20_000).nullable(),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  checkpointId: IdSchema.nullable(),
  startedAt: nullableTimestamp,
  finishedAt: nullableTimestamp,
  createdAt: TimestampSchema,
})
export type Run = z.infer<typeof RunSchema>

export const RunStepSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  seq: z.number().int().positive(),
  kind: RunStepKindSchema,
  status: z.string().max(40).default('completed'),
  title: z.string().max(240).default(''),
  payload: JsonObjectSchema.default({}),
  createdAt: TimestampSchema,
})
export type RunStep = z.infer<typeof RunStepSchema>

export const ToolCallSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  toolName: z.string().min(1).max(120),
  idempotencyKey: z.string().min(1).max(240),
  status: ToolCallStatusSchema,
  argsHash: z.string().max(128),
  args: JsonObjectSchema.default({}),
  result: z.unknown().nullable(),
  error: z.string().max(8000).nullable(),
  createdAt: TimestampSchema,
  startedAt: nullableTimestamp,
  finishedAt: nullableTimestamp,
})
export type ToolCall = z.infer<typeof ToolCallSchema>

export const ApprovalSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  runId: IdSchema,
  toolCallId: IdSchema.nullable(),
  status: ApprovalStatusSchema,
  title: z.string().max(240),
  detail: z.string().max(20_000).default(''),
  request: JsonObjectSchema.default({}),
  decision: z.string().max(2000).nullable(),
  requestedAt: TimestampSchema,
  decidedAt: nullableTimestamp,
  expiresAt: nullableTimestamp,
})
export type Approval = z.infer<typeof ApprovalSchema>

export const HandoffSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  taskId: IdSchema,
  fromAgentId: IdSchema,
  fromSessionId: IdSchema,
  toAgentId: IdSchema,
  toSessionId: IdSchema.nullable(),
  status: HandoffStatusSchema,
  summary: z.string().max(20_000),
  payload: JsonObjectSchema.default({}),
  requestedAt: TimestampSchema,
  decidedAt: nullableTimestamp,
})
export type Handoff = z.infer<typeof HandoffSchema>

export const ArtifactSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  taskId: IdSchema.nullable(),
  runId: IdSchema.nullable(),
  kind: ArtifactKindSchema,
  title: z.string().min(1).max(240),
  uri: z.string().max(2048).nullable(),
  contentHash: z.string().max(128).nullable(),
  gitCommit: z.string().max(80).nullable(),
  verifiedAt: nullableTimestamp,
  body: z.string().max(400_000).nullable(),
  isDemo: z.boolean(),
  createdAt: TimestampSchema,
})
export type Artifact = z.infer<typeof ArtifactSchema>

export const DecisionSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  title: z.string().min(1).max(240),
  body: z.string().max(40_000).default(''),
  status: DecisionStatusSchema,
  supersedesId: IdSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Decision = z.infer<typeof DecisionSchema>

export const KnowledgeEntrySchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  title: z.string().min(1).max(240),
  body: z.string().max(200_000),
  sourceUri: z.string().max(2048).nullable(),
  sourceVersion: z.string().max(120).nullable(),
  status: z.enum(['active', 'archived']),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type KnowledgeEntry = z.infer<typeof KnowledgeEntrySchema>

export const ProjectEventSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  seq: z.number().int().positive(),
  aggregateId: z.string().min(1),
  eventType: z.string().min(1).max(120),
  payload: JsonObjectSchema.default({}),
  createdAt: TimestampSchema,
})
export type ProjectEvent = z.infer<typeof ProjectEventSchema>

export const CrossSessionEnvelopeSchema = z.object({
  protocol: z.literal('projectos.cross-session'),
  version: z.literal(1),
  messageId: IdSchema,
  idempotencyKey: z.string().min(1).max(240),
  projectId: IdSchema,
  taskId: IdSchema.optional(),
  runId: IdSchema.optional(),
  sender: z.object({ agentId: IdSchema, sessionId: IdSchema }),
  recipient: z.object({ agentId: IdSchema, sessionId: IdSchema.optional() }),
  type: CrossSessionTypeSchema,
  correlationId: z.string().max(120).optional(),
  causationId: z.string().max(120).optional(),
  sequence: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  payload: z.unknown(),
})
export type CrossSessionEnvelope = z.infer<typeof CrossSessionEnvelopeSchema>

export const InboxItemSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  recipientAgentId: IdSchema,
  recipientSessionId: IdSchema,
  messageId: IdSchema,
  envelope: CrossSessionEnvelopeSchema,
  status: DeliveryStatusSchema,
  attempts: z.number().int().nonnegative(),
  error: z.string().max(8000).nullable(),
  createdAt: TimestampSchema,
  deliveredAt: nullableTimestamp,
  acceptedAt: nullableTimestamp,
  completedAt: nullableTimestamp,
})
export type InboxItem = z.infer<typeof InboxItemSchema>

export const ProjectStatsSchema = z.object({
  tasksTotal: z.number().int().nonnegative(),
  tasksDone: z.number().int().nonnegative(),
  tasksCancelled: z.number().int().nonnegative(),
  tasksRunning: z.number().int().nonnegative(),
  tasksReview: z.number().int().nonnegative(),
  progress: z.number().min(0).max(1),
  requirementsApproved: z.number().int().nonnegative(),
  milestonesTotal: z.number().int().nonnegative(),
  milestonesCompleted: z.number().int().nonnegative(),
  artifacts: z.number().int().nonnegative(),
  activeRuns: z.number().int().nonnegative(),
  pendingApprovals: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
})
export type ProjectStats = z.infer<typeof ProjectStatsSchema>

export const AgentViewSchema = z.object({
  agent: AgentSchema,
  status: z.enum(['idle', 'working', 'offline']),
  sessionCount: z.number().int().nonnegative(),
  activeRunId: IdSchema.nullable(),
  activeSessionId: IdSchema.nullable(),
  completedRuns: z.number().int().nonnegative(),
})
export type AgentView = z.infer<typeof AgentViewSchema>

export const ProjectSummarySchema = ProjectSchema.extend({
  stats: ProjectStatsSchema,
  activeAgents: z.number().int().nonnegative(),
  lastActivityAt: TimestampSchema.nullable(),
})
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>

export const ActivityItemSchema = z.object({
  id: IdSchema,
  seq: z.number().int().positive(),
  eventType: z.string(),
  summary: z.string(),
  actorName: z.string().nullable(),
  tone: z.enum(['neutral', 'accent', 'success', 'warning', 'danger']),
  createdAt: TimestampSchema,
})
export type ActivityItem = z.infer<typeof ActivityItemSchema>

export const LifecycleGateSchema = z.object({
  stage: StageKeySchema,
  status: StageStatusSchema,
  ready: z.boolean(),
  requirement: z.string(),
  blockers: z.array(z.string()),
})
export type LifecycleGate = z.infer<typeof LifecycleGateSchema>

export const ProjectOverviewSchema = z.object({
  project: ProjectSchema,
  stages: z.array(ProjectStageSchema),
  stats: ProjectStatsSchema,
  milestones: z.array(MilestoneSchema),
  requirements: z.array(RequirementSchema),
  decisions: z.array(DecisionSchema),
  activity: z.array(ActivityItemSchema),
  agents: z.array(AgentViewSchema),
  gates: z.array(LifecycleGateSchema),
  git: z
    .object({
      branch: z.string(),
      clean: z.boolean(),
      changedFiles: z.number().int().nonnegative(),
    })
    .nullable(),
})
export type ProjectOverview = z.infer<typeof ProjectOverviewSchema>

export const TaskCardSchema = TaskSchema.extend({
  assigneeName: z.string().nullable(),
  dependencyIds: z.array(IdSchema),
  blockedBy: z.array(IdSchema),
  runCount: z.number().int().nonnegative(),
  artifactCount: z.number().int().nonnegative(),
  latestRunStatus: RunStatusSchema.nullable(),
})
export type TaskCard = z.infer<typeof TaskCardSchema>

export const TaskBoardSchema = z.object({
  projectId: IdSchema,
  tasks: z.array(TaskCardSchema),
  columns: z.array(
    z.object({
      status: TaskStatusSchema,
      taskIds: z.array(IdSchema),
    }),
  ),
})
export type TaskBoard = z.infer<typeof TaskBoardSchema>

export const RunSummarySchema = RunSchema.extend({
  agentName: z.string(),
  taskTitle: z.string().nullable(),
  sessionTitle: z.string(),
  pendingApprovals: z.number().int().nonnegative(),
})
export type RunSummary = z.infer<typeof RunSummarySchema>

export const TaskDetailSchema = z.object({
  task: TaskCardSchema,
  dependencies: z.array(TaskCardSchema),
  dependents: z.array(TaskCardSchema),
  attempts: z.array(TaskAttemptSchema),
  runs: z.array(RunSummarySchema),
  artifacts: z.array(ArtifactSchema),
  approvals: z.array(ApprovalSchema),
})
export type TaskDetail = z.infer<typeof TaskDetailSchema>

export const MessageViewSchema = MessageSchema.extend({
  agentName: z.string().nullable(),
})
export type MessageView = z.infer<typeof MessageViewSchema>

export const SessionSummarySchema = SessionSchema.extend({
  agentName: z.string(),
  agentRole: z.string(),
  agentAccent: z.string(),
  messageCount: z.number().int().nonnegative(),
  lastMessageAt: TimestampSchema.nullable(),
  latestRunStatus: RunStatusSchema.nullable(),
  pendingApprovals: z.number().int().nonnegative(),
})
export type SessionSummary = z.infer<typeof SessionSummarySchema>

export const SessionDetailSchema = z.object({
  session: SessionSchema,
  agent: AgentSchema,
  messages: z.array(MessageViewSchema),
  activeRun: RunSummarySchema.nullable(),
})
export type SessionDetail = z.infer<typeof SessionDetailSchema>

export const ApprovalViewSchema = ApprovalSchema.extend({
  runStatus: RunStatusSchema,
  sessionId: IdSchema,
  taskId: IdSchema.nullable(),
  taskTitle: z.string().nullable(),
  agentName: z.string(),
})
export type ApprovalView = z.infer<typeof ApprovalViewSchema>

export const RunDetailSchema = z.object({
  run: RunSummarySchema,
  steps: z.array(RunStepSchema),
  toolCalls: z.array(ToolCallSchema),
  approvals: z.array(ApprovalViewSchema),
  session: SessionSchema,
  task: TaskSchema.nullable(),
})
export type RunDetail = z.infer<typeof RunDetailSchema>

export const HandoffViewSchema = HandoffSchema.extend({
  fromAgentName: z.string(),
  toAgentName: z.string(),
  taskTitle: z.string(),
  fromSessionTitle: z.string(),
})
export type HandoffView = z.infer<typeof HandoffViewSchema>

export const InboxItemViewSchema = InboxItemSchema.extend({
  senderAgentName: z.string(),
  senderSessionTitle: z.string(),
  recipientAgentName: z.string(),
  type: CrossSessionTypeSchema,
  preview: z.string(),
  taskTitle: z.string().nullable(),
})
export type InboxItemView = z.infer<typeof InboxItemViewSchema>

export const CollaborationSnapshotSchema = z.object({
  agents: z.array(AgentViewSchema),
  sessions: z.array(SessionSummarySchema),
  inbox: z.array(InboxItemViewSchema),
  handoffs: z.array(HandoffViewSchema),
  deliveryStats: z.record(DeliveryStatusSchema, z.number().int().nonnegative()),
})
export type CollaborationSnapshot = z.infer<typeof CollaborationSnapshotSchema>

export const WorkspaceEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  type: z.enum(['file', 'directory']),
  size: z.number().int().nonnegative(),
  depth: z.number().int().nonnegative(),
})
export type WorkspaceEntry = z.infer<typeof WorkspaceEntrySchema>

export const GitChangeSchema = z.object({
  path: z.string(),
  status: z.string(),
  staged: z.boolean(),
})
export type GitChange = z.infer<typeof GitChangeSchema>

export const GitStatusSchema = z.object({
  branch: z.string(),
  clean: z.boolean(),
  changes: z.array(GitChangeSchema),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  lastCommit: z
    .object({ hash: z.string(), subject: z.string(), author: z.string(), committedAt: z.number() })
    .nullable(),
})
export type GitStatus = z.infer<typeof GitStatusSchema>

export const WorkspaceSnapshotSchema = z.object({
  rootPath: z.string(),
  entries: z.array(WorkspaceEntrySchema),
  git: GitStatusSchema.nullable(),
})
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>

export const FileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
  size: z.number().int().nonnegative(),
  truncated: z.boolean(),
  language: z.string(),
})
export type FileContent = z.infer<typeof FileContentSchema>

export const CommandResultSchema = z.object({
  command: z.string(),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().int().nonnegative(),
  truncated: z.boolean(),
})
export type CommandResult = z.infer<typeof CommandResultSchema>

export const RuntimeStatusSchema = z.object({
  status: z.enum(['starting', 'ready', 'restarting', 'stopped', 'failed']),
  pid: z.number().int().nullable(),
  restartCount: z.number().int().nonnegative(),
  message: z.string().nullable(),
  since: TimestampSchema,
})
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>

export const ProviderInfoSchema = z.object({
  configured: z.boolean(),
  provider: z.literal('openai-compatible'),
  baseUrl: z.string(),
  model: z.string(),
  hasKey: z.boolean(),
  temperature: z.number().min(0).max(2),
  lastTestAt: TimestampSchema.nullable(),
  lastTestOk: z.boolean().nullable(),
  lastError: z.string().nullable(),
})
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>

export const AppPreferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  reduceTransparency: z.boolean(),
  reduceMotion: z.boolean(),
  sidebarCollapsed: z.boolean(),
  inspectorOpen: z.boolean(),
})
export type AppPreferences = z.infer<typeof AppPreferencesSchema>

export const ProjectEventViewSchema = ProjectEventSchema.extend({
  summary: z.string(),
})
export type ProjectEventView = z.infer<typeof ProjectEventViewSchema>
