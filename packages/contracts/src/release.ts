import { z } from 'zod'
import { IdSchema, TimestampSchema } from './common.js'

export const ChangeRequestStatusSchema = z.enum([
  'draft',
  'awaiting_approval',
  'approved',
  'rejected',
  'changes_requested',
  'cancelled',
])
export type ChangeRequestStatus = z.infer<typeof ChangeRequestStatusSchema>

export const ChangeSourceSchema = z.enum(['requirement', 'task', 'defect', 'manual', 'artifact'])
export const ChangeRiskSchema = z.enum(['low', 'medium', 'high', 'critical'])
export const DeliveryApprovalDecisionSchema = z.enum(['approved', 'rejected', 'changes_requested'])

export const ChangeRequestSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  versionId: IdSchema,
  title: z.string().min(1).max(240),
  description: z.string().max(40_000).default(''),
  sourceType: ChangeSourceSchema,
  sourceId: IdSchema.nullable(),
  riskLevel: ChangeRiskSchema,
  impactScope: z.string().max(4000).default(''),
  targetEnvironmentId: IdSchema.nullable(),
  status: ChangeRequestStatusSchema,
  revision: z.number().int().positive(),
  contentFingerprint: z.string().min(16),
  requestedBy: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  submittedAt: TimestampSchema.nullable(),
  decidedAt: TimestampSchema.nullable(),
})
export type ChangeRequest = z.infer<typeof ChangeRequestSchema>

export const ChangeRequestLinkSchema = z.object({
  id: IdSchema,
  changeRequestId: IdSchema,
  linkType: z.string(),
  targetType: z.string(),
  targetId: IdSchema,
  createdAt: TimestampSchema,
})
export type ChangeRequestLink = z.infer<typeof ChangeRequestLinkSchema>

export const ChangeRequestEventSchema = z.object({
  id: IdSchema,
  changeRequestId: IdSchema,
  eventType: z.string(),
  message: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
  actor: z.string(),
  createdAt: TimestampSchema,
})
export type ChangeRequestEvent = z.infer<typeof ChangeRequestEventSchema>

export const ApprovalSubjectSchema = z.enum(['change_request', 'deployment'])
export const DeliveryApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'changes_requested', 'expired', 'superseded'])
export const ApprovalRequestSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  subjectType: ApprovalSubjectSchema,
  subjectId: IdSchema,
  subjectRevision: z.number().int().positive(),
  subjectTitle: z.string().nullable().default(null),
  contentFingerprint: z.string().min(16),
  status: DeliveryApprovalStatusSchema,
  requestedBy: z.string(),
  decidedBy: z.string().nullable(),
  decisionNote: z.string().max(4000).nullable(),
  requestedAt: TimestampSchema,
  decidedAt: TimestampSchema.nullable(),
  expiresAt: TimestampSchema.nullable(),
})
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>

export const CandidateStatusSchema = z.enum([
  'draft',
  'blocked',
  'ready',
  'submitted',
  'approved',
  'rejected',
  'released',
  'superseded',
])
export const ReleaseArtifactSchema = z.object({
  id: IdSchema,
  artifactId: IdSchema.nullable(),
  name: z.string(),
  kind: z.string(),
  contentHash: z.string(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  uri: z.string().nullable(),
  source: z.string(),
  createdAt: TimestampSchema,
})
export type ReleaseArtifact = z.infer<typeof ReleaseArtifactSchema>

export const ReleaseCandidateSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  versionId: IdSchema,
  changeRequestId: IdSchema.nullable(),
  status: CandidateStatusSchema,
  gitCommit: z.string().nullable(),
  gitBranch: z.string().nullable(),
  repository: z.string().nullable(),
  artifactsReady: z.boolean(),
  gateStatus: z.enum(['pending', 'passed', 'failed', 'missing']),
  gateEvaluationId: IdSchema.nullable(),
  artifacts: z.array(ReleaseArtifactSchema),
  evidenceSummary: z.string().max(8000).default(''),
  notes: z.string().max(8000).default(''),
  createdBy: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type ReleaseCandidate = z.infer<typeof ReleaseCandidateSchema>

export const ReleaseStatusSchema = z.enum(['recorded', 'distributed', 'superseded', 'revoked'])
export const ReleaseSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  versionId: IdSchema,
  candidateId: IdSchema,
  version: z.string(),
  status: ReleaseStatusSchema,
  gitCommit: z.string().nullable(),
  notes: z.string().max(8000).default(''),
  artifactManifest: z.array(ReleaseArtifactSchema),
  manifestHash: z.string().min(16),
  distributionStatus: z.enum(['not_distributed', 'externally_confirmed']),
  externalReceipt: z.record(z.string(), z.unknown()).default({}),
  publishedAt: TimestampSchema,
  createdBy: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Release = z.infer<typeof ReleaseSchema>

export const DeploymentSourceSchema = z.enum(['manual', 'imported', 'adapter', 'unknown'])
export type DeploymentSource = z.infer<typeof DeploymentSourceSchema>
export const DeploymentAssuranceSchema = z.enum([
  'self_declared',
  'source_observed',
  'independently_reproduced',
  'externally_confirmed',
])
export const DeploymentStatusSchema = z.enum([
  'awaiting_approval',
  'pending',
  'running',
  'verifying',
  'succeeded',
  'failed',
  'cancelled',
  'unknown',
  'needs_reconciliation',
  'rolled_back',
])
export type DeploymentStatus = z.infer<typeof DeploymentStatusSchema>

export const DeploymentTargetSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  environmentId: IdSchema,
  name: z.string().min(1).max(240),
  kind: z.enum(['local', 'ssh', 'kubernetes', 'pipeline', 'gitops', 'external']),
  controlMode: z.enum(['pipeline_managed', 'gitops_managed', 'direct_kubernetes', 'ssh_managed', 'external_observed']),
  adapterType: z.string().nullable(),
  targetRef: z.string().max(1000).default(''),
  resourceId: IdSchema.nullable().default(null),
  connectionProfileId: IdSchema.nullable().default(null),
  protected: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type DeploymentTarget = z.infer<typeof DeploymentTargetSchema>

export const DeploymentStrategySchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  environmentId: IdSchema,
  targetId: IdSchema,
  name: z.string().min(1).max(240),
  adapterType: z.string(),
  source: z.enum(['manual', 'imported', 'pipeline', 'gitops', 'kubernetes', 'ssh']),
  requiresApproval: z.boolean(),
  enabled: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type DeploymentStrategy = z.infer<typeof DeploymentStrategySchema>

export const DeploymentSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  versionId: IdSchema,
  releaseId: IdSchema,
  environmentId: IdSchema,
  targetId: IdSchema.nullable(),
  strategyId: IdSchema.nullable(),
  status: DeploymentStatusSchema,
  source: DeploymentSourceSchema,
  assurance: DeploymentAssuranceSchema,
  idempotencyKey: z.string(),
  artifactHash: z.string().nullable(),
  externalId: z.string().nullable(),
  receipt: z.record(z.string(), z.unknown()).default({}),
  executionState: z.string().default('not_started'),
  authorizationFingerprint: z.string().nullable().default(null),
  approvalId: IdSchema.nullable(),
  rollbackOfDeploymentId: IdSchema.nullable(),
  previousDeploymentId: IdSchema.nullable(),
  notes: z.string().max(8000).default(''),
  requestedBy: z.string(),
  startedAt: TimestampSchema.nullable(),
  finishedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Deployment = z.infer<typeof DeploymentSchema>

export const DeploymentEventSchema = z.object({
  id: IdSchema,
  deploymentId: IdSchema,
  type: z.string(),
  status: z.string().nullable(),
  message: z.string().max(8000).default(''),
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: TimestampSchema,
})
export type DeploymentEvent = z.infer<typeof DeploymentEventSchema>

/**
 * A durable record of one attempt to apply remote side effects for a deployment.
 * The operation is persisted before any remote mutation so a crash, SSH drop or
 * app shutdown leaves a recoverable trace instead of a silently stuck row.
 */
export const DeploymentOperationStateSchema = z.enum([
  'prepared',
  'executing',
  'confirmed',
  'failed',
  'unknown',
])
export type DeploymentOperationState = z.infer<typeof DeploymentOperationStateSchema>

export const DeploymentOperationSchema = z.object({
  id: IdSchema,
  deploymentId: IdSchema,
  operationKey: z.string().min(8),
  attempt: z.number().int().positive(),
  adapterType: z.string(),
  targetRef: z.string(),
  state: DeploymentOperationStateSchema,
  externalId: z.string().nullable(),
  remoteFacts: z.record(z.string(), z.unknown()).default({}),
  lastError: z.string().nullable(),
  startedAt: TimestampSchema.nullable(),
  finishedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type DeploymentOperation = z.infer<typeof DeploymentOperationSchema>

export const DeploymentOperationStepSchema = z.object({
  id: IdSchema,
  operationId: IdSchema,
  sequence: z.number().int().nonnegative(),
  phase: z.string(),
  status: z.string(),
  detail: z.string().max(8000).default(''),
  remoteRef: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  createdAt: TimestampSchema,
})
export type DeploymentOperationStep = z.infer<typeof DeploymentOperationStepSchema>

export const DeploymentOperationTraceSchema = z.object({
  operations: z.array(DeploymentOperationSchema),
  steps: z.array(DeploymentOperationStepSchema),
})
export type DeploymentOperationTrace = z.infer<typeof DeploymentOperationTraceSchema>

export const ReleaseOverviewSchema = z.object({
  projectId: IdSchema,
  versionId: IdSchema,
  changeRequests: z.array(ChangeRequestSchema),
  approvals: z.array(ApprovalRequestSchema),
  candidates: z.array(ReleaseCandidateSchema),
  releases: z.array(ReleaseSchema),
  deployments: z.array(DeploymentSchema),
  environments: z.array(
    z.object({
      id: IdSchema,
      key: z.string(),
      name: z.string(),
      kind: z.string(),
      protected: z.boolean(),
    }),
  ),
  targets: z.array(DeploymentTargetSchema),
  strategies: z.array(DeploymentStrategySchema),
  environmentVersions: z.array(
    z.object({
      environmentId: IdSchema,
      releaseId: IdSchema.nullable(),
      deploymentId: IdSchema.nullable(),
      assurance: z.string().nullable(),
    }),
  ),
  capabilities: z.object({
    canBuild: z.boolean(),
    canExecuteDeployment: z.boolean(),
    canImportDeployment: z.boolean(),
    reason: z.string(),
  }),
})
export type ReleaseOverview = z.infer<typeof ReleaseOverviewSchema>

export const CreateChangeRequestInputSchema = z.object({
  projectId: IdSchema,
  versionId: IdSchema,
  title: z.string().trim().min(1).max(240),
  description: z.string().max(40_000).default(''),
  sourceType: ChangeSourceSchema.default('manual'),
  sourceId: IdSchema.nullable().default(null),
  riskLevel: ChangeRiskSchema.default('medium'),
  impactScope: z.string().max(4000).default(''),
  targetEnvironmentId: IdSchema.nullable().default(null),
  linkedArtifactIds: z.array(IdSchema).max(100).default([]),
  linkedTaskIds: z.array(IdSchema).max(100).default([]),
})
export type CreateChangeRequestInput = z.infer<typeof CreateChangeRequestInputSchema>

export const UpdateChangeRequestInputSchema = CreateChangeRequestInputSchema.partial().extend({
  id: IdSchema,
})
export type UpdateChangeRequestInput = z.infer<typeof UpdateChangeRequestInputSchema>

export const ReleaseApprovalDecideInputSchema = z.object({
  approvalId: IdSchema,
  decision: DeliveryApprovalDecisionSchema,
  note: z.string().trim().max(4000).default(''),
  rationale: z.string().trim().max(4000).default(''),
})
export type ReleaseApprovalDecideInput = z.infer<typeof ReleaseApprovalDecideInputSchema>

export const CreateCandidateInputSchema = z.object({
  projectId: IdSchema,
  versionId: IdSchema,
  changeRequestId: IdSchema.nullable().default(null),
  artifactIds: z.array(IdSchema).max(100).default([]),
  notes: z.string().max(8000).default(''),
})
export type CreateCandidateInput = z.infer<typeof CreateCandidateInputSchema>

export const CreateReleaseInputSchema = z.object({
  candidateId: IdSchema,
  idempotencyKey: z.string().trim().min(8).max(200),
  notes: z.string().max(8000).default(''),
})
export type CreateReleaseInput = z.infer<typeof CreateReleaseInputSchema>

export const CreateDeploymentInputSchema = z.object({
  projectId: IdSchema,
  releaseId: IdSchema,
  environmentId: IdSchema,
  targetId: IdSchema.nullable().default(null),
  strategyId: IdSchema.nullable().default(null),
  source: DeploymentSourceSchema,
  idempotencyKey: z.string().trim().min(8).max(200),
  status: DeploymentStatusSchema.default('succeeded'),
  externalId: z.string().max(500).nullable().default(null),
  artifactHash: z.string().max(256).nullable().default(null),
  receipt: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().max(8000).default(''),
  rollbackOfDeploymentId: IdSchema.nullable().default(null),
})
export type CreateDeploymentInput = z.infer<typeof CreateDeploymentInputSchema>

export const RecordDeploymentResultInputSchema = z.object({
  deploymentId: IdSchema,
  status: DeploymentStatusSchema,
  externalId: z.string().max(500).nullable().default(null),
  artifactHash: z.string().max(256).nullable().default(null),
  receipt: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().max(8000).default(''),
})
export type RecordDeploymentResultInput = z.infer<typeof RecordDeploymentResultInputSchema>
