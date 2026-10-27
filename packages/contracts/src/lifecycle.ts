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
