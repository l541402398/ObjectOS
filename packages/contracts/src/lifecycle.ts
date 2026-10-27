import { z } from 'zod'
import { IdSchema, TimestampSchema } from './common.js'

export const ProductStatusSchema = z.enum(['active', 'retired'])
export const VersionPhaseSchema = z.enum([
  'planned',
  'discovery',
  'build',
  'verify',
  'release_candidate',
  'released',
  'maintenance',
  'retired',
])
export type VersionPhase = z.infer<typeof VersionPhaseSchema>
export const IterationStatusSchema = z.enum(['planned', 'active', 'closed', 'cancelled'])
export const EnvironmentKindSchema = z.enum(['local', 'development', 'staging', 'production', 'custom'])
export const ProjectFocusSubjectSchema = z.enum(['version', 'iteration', 'release', 'incident', 'task'])

export const ProductSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  key: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  description: z.string().max(4000).default(''),
  status: ProductStatusSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Product = z.infer<typeof ProductSchema>

export const ProductVersionSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  productId: IdSchema,
  version: z.string().min(1).max(80),
  phase: VersionPhaseSchema,
  supportLevel: z.string().max(40).default('normal'),
  isDefault: z.boolean().default(false),
  plannedAt: TimestampSchema.nullable(),
  releasedAt: TimestampSchema.nullable(),
  retiredAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type ProductVersion = z.infer<typeof ProductVersionSchema>

export const IterationSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  versionId: IdSchema,
  name: z.string().min(1).max(160),
  goal: z.string().max(4000).default(''),
  status: IterationStatusSchema,
  startsAt: TimestampSchema.nullable(),
  endsAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Iteration = z.infer<typeof IterationSchema>

export const EnvironmentSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  key: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  kind: EnvironmentKindSchema,
  protected: z.boolean().default(false),
  sortOrder: z.number().int().nonnegative().default(0),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Environment = z.infer<typeof EnvironmentSchema>

export const ProjectFocusSchema = z.object({
  projectId: IdSchema,
  subjectType: ProjectFocusSubjectSchema,
  subjectId: IdSchema.nullable(),
  updatedAt: TimestampSchema,
})
export type ProjectFocus = z.infer<typeof ProjectFocusSchema>

export const EvidenceTypeSchema = z.enum([
  'test_report',
  'code_diff',
  'build_artifact',
  'run_log',
  'metric_snapshot',
  'deployment_receipt',
  'approval_record',
  'review_record',
  'manual_attestation',
  'postmortem',
  'other',
])
export const VerificationStatusSchema = z.enum(['pending', 'passed', 'failed', 'unknown', 'waived'])
export const EvidenceAssuranceSchema = z.enum([
  'self_declared',
  'source_observed',
  'independently_reproduced',
  'externally_confirmed',
])
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>
export type EvidenceAssurance = z.infer<typeof EvidenceAssuranceSchema>

export const EvidenceSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  evidenceType: EvidenceTypeSchema,
  verificationStatus: VerificationStatusSchema,
  assurance: EvidenceAssuranceSchema,
  title: z.string().min(1).max(240),
  summary: z.string().max(8000).default(''),
  provenance: z.record(z.string(), z.unknown()).default({}),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Evidence = z.infer<typeof EvidenceSchema>

export const GateConditionSchema = z.object({
  evidenceType: EvidenceTypeSchema,
  requiredStatus: VerificationStatusSchema.default('passed'),
  minAssurance: EvidenceAssuranceSchema.default('self_declared'),
  allowSelfDeclared: z.boolean().default(false),
})
export type GateCondition = z.infer<typeof GateConditionSchema>

export const GateDefinitionSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  subjectScope: z.string(),
  key: z.string(),
  policyProfile: z.string(),
  blocking: z.boolean(),
  conditions: z.array(GateConditionSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type GateDefinition = z.infer<typeof GateDefinitionSchema>

export const GateConditionResultSchema = z.object({
  conditionIndex: z.number().int().nonnegative(),
  satisfied: z.boolean(),
  evidenceIds: z.array(IdSchema),
  reason: z.string(),
})
export const GateEvaluationSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  gateId: IdSchema,
  subjectType: z.string(),
  subjectId: IdSchema,
  status: z.enum(['passed', 'failed', 'pending', 'waived']),
  conditionResults: z.array(GateConditionResultSchema),
  evaluatedBy: z.string(),
  evaluatedAt: TimestampSchema,
})
export type GateEvaluation = z.infer<typeof GateEvaluationSchema>

export const GateOverviewSchema = z.object({
  definitions: z.array(GateDefinitionSchema),
  evaluations: z.array(GateEvaluationSchema),
  evidence: z.array(EvidenceSchema),
})
export type GateOverview = z.infer<typeof GateOverviewSchema>

export const RecordEvidenceInputSchema = z.object({
  projectId: IdSchema,
  subjectType: z.enum(['version', 'iteration', 'task', 'release', 'deployment', 'incident']),
  subjectId: IdSchema,
  evidenceType: EvidenceTypeSchema,
  verificationStatus: VerificationStatusSchema.default('unknown'),
  assurance: EvidenceAssuranceSchema.default('self_declared'),
  title: z.string().trim().min(1).max(240),
  summary: z.string().max(8000).default(''),
  provenance: z.record(z.string(), z.unknown()).default({}),
})
export type RecordEvidenceInput = z.infer<typeof RecordEvidenceInputSchema>

export const ProjectPostureSchema = z.object({
  projectId: IdSchema,
  legacyStage: z.string(),
  activeVersionId: IdSchema.nullable(),
  activeIterationId: IdSchema.nullable(),
  productCount: z.number().int().nonnegative(),
  versionCount: z.number().int().nonnegative(),
  activeVersionCount: z.number().int().nonnegative(),
  iterationCount: z.number().int().nonnegative(),
  environmentCount: z.number().int().nonnegative(),
  pendingApprovals: z.number().int().nonnegative(),
  runningRuns: z.number().int().nonnegative(),
  reviewTasks: z.number().int().nonnegative(),
})
export type ProjectPosture = z.infer<typeof ProjectPostureSchema>

export const LifecycleOverviewSchema = z.object({
  products: z.array(ProductSchema),
  versions: z.array(ProductVersionSchema),
  iterations: z.array(IterationSchema),
  environments: z.array(EnvironmentSchema),
  focus: ProjectFocusSchema.nullable(),
  posture: ProjectPostureSchema,
})
export type LifecycleOverview = z.infer<typeof LifecycleOverviewSchema>

export const CreateVersionInputSchema = z.object({
  projectId: IdSchema,
  productId: IdSchema,
  version: z.string().trim().min(1).max(80),
  phase: VersionPhaseSchema.default('planned'),
  isDefault: z.boolean().default(false),
})
export type CreateVersionInput = z.infer<typeof CreateVersionInputSchema>

export const TransitionVersionInputSchema = z.object({
  versionId: IdSchema,
  to: VersionPhaseSchema,
})
export type TransitionVersionInput = z.infer<typeof TransitionVersionInputSchema>

export const CreateIterationInputSchema = z.object({
  projectId: IdSchema,
  versionId: IdSchema,
  name: z.string().trim().min(1).max(160),
  goal: z.string().max(4000).default(''),
  startsAt: TimestampSchema.nullable().optional(),
  endsAt: TimestampSchema.nullable().optional(),
})
export type CreateIterationInput = z.infer<typeof CreateIterationInputSchema>

export const SetIterationStatusInputSchema = z.object({
  iterationId: IdSchema,
  status: IterationStatusSchema,
})
export type SetIterationStatusInput = z.infer<typeof SetIterationStatusInputSchema>

export const CreateEnvironmentInputSchema = z.object({
  projectId: IdSchema,
  key: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  kind: EnvironmentKindSchema.default('custom'),
  protected: z.boolean().default(false),
})
export type CreateEnvironmentInput = z.infer<typeof CreateEnvironmentInputSchema>

export const SetProjectFocusInputSchema = z.object({
  projectId: IdSchema,
  subjectType: ProjectFocusSubjectSchema,
  subjectId: IdSchema.nullable(),
})
export type SetProjectFocusInput = z.infer<typeof SetProjectFocusInputSchema>
