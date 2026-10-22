import { z } from 'zod'
import { IdSchema, TimestampSchema } from './common.js'
import {
  PlanContextSourceSchema,
  PlanGenerationSchema,
  PlanRoleSchema,
  PlannedTaskSchema,
  PlanStatusSchema,
} from './orchestration.js'

export const ReplanTriggerSchema = z.enum([
  'retry_exhausted',
  'evidence_exhausted',
  'quality_gate_failed',
  'agent_unavailable',
  'artifact_invalid',
  'user_requested',
  'constraints_changed',
])
export type ReplanTrigger = z.infer<typeof ReplanTriggerSchema>

export const ReplanStatusSchema = z.enum(['proposed', 'applying', 'applied', 'rejected', 'failed'])
export type ReplanStatus = z.infer<typeof ReplanStatusSchema>

export const RevisionDiffSchema = z.object({
  kept: z.array(z.object({ key: z.string(), title: z.string() })),
  added: z.array(z.object({ key: z.string(), title: z.string(), role: PlanRoleSchema })),
  removed: z.array(z.object({
    key: z.string(),
    title: z.string(),
    sourceTaskId: IdSchema.nullable(),
    sourceStatus: z.string().nullable(),
  })),
  modified: z.array(z.object({ key: z.string(), fields: z.array(z.string()) })),
  dependencyChanges: z.array(z.object({
    key: z.string(),
    before: z.array(z.string()),
    after: z.array(z.string()),
  })),
  agentChanges: z.array(z.object({
    key: z.string(),
    beforeAgentId: IdSchema.nullable(),
    afterAgentId: IdSchema.nullable(),
    beforeAgentName: z.string().nullable(),
    afterAgentName: z.string().nullable(),
  })),
  acceptanceChanges: z.array(z.object({
    key: z.string(),
    before: z.array(z.string()),
    after: z.array(z.string()),
  })),
  reusableArtifacts: z.array(z.object({
    taskKey: z.string(),
    sourceTaskId: IdSchema,
    artifactIds: z.array(IdSchema),
    artifactTitles: z.array(z.string()),
  })),
  revalidate: z.array(z.object({
    taskKey: z.string(),
    sourceTaskId: IdSchema,
    reason: z.string(),
    artifactIds: z.array(IdSchema),
  })),
})
export type RevisionDiff = z.infer<typeof RevisionDiffSchema>

export const ReplanGrantImpactSchema = z.object({
  oldGrantId: IdSchema.nullable(),
  oldGrantStatus: z.string().nullable(),
  oldGrantValid: z.boolean(),
  requiresNewGrant: z.boolean(),
  withinOriginalScope: z.boolean(),
  expanded: z.array(z.string()),
  newAgents: z.array(z.object({ agentId: IdSchema, name: z.string() })),
  removedAgents: z.array(z.object({ agentId: IdSchema, name: z.string() })),
  newTasks: z.array(z.string()),
  removedTasks: z.array(z.string()),
  reasons: z.array(z.string()),
})
export type ReplanGrantImpact = z.infer<typeof ReplanGrantImpactSchema>

export const ReplanProposalSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  planId: IdSchema,
  sourceRevision: z.number().int().positive(),
  /** Fingerprint and Run count at proposal time; stale proposals are rejected. */
  sourceFingerprint: z.string().length(64).or(z.literal('')),
  sourceRunCount: z.number().int().nonnegative(),
  trigger: ReplanTriggerSchema,
  status: ReplanStatusSchema,
  reason: z.string().max(4000),
  contextChars: z.number().int().nonnegative(),
  contextSources: z.array(PlanContextSourceSchema),
  proposedTasks: z.array(PlannedTaskSchema),
  proposedAssumptions: z.array(z.string()),
  proposedRisks: z.array(z.string()),
  diff: RevisionDiffSchema,
  grantImpact: ReplanGrantImpactSchema,
  generation: PlanGenerationSchema.nullable(),
  error: z.string().max(8000).nullable(),
  requestedBy: z.string().max(120),
  requestedAt: TimestampSchema,
  decidedAt: TimestampSchema.nullable(),
  decidedReason: z.string().max(4000).nullable(),
  appliedPlanId: IdSchema.nullable(),
  modelCalls: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type ReplanProposal = z.infer<typeof ReplanProposalSchema>

export const ReplanProposalViewSchema = ReplanProposalSchema.extend({
  sourcePlanStatus: PlanStatusSchema,
  currentPlanStatus: PlanStatusSchema,
  canApply: z.boolean(),
  blockedReasons: z.array(z.string().max(1000)),
  appliedRevision: z.number().int().positive().nullable(),
})
export type ReplanProposalView = z.infer<typeof ReplanProposalViewSchema>

export const ReplanProposeInputSchema = z.object({
  planId: IdSchema,
  trigger: ReplanTriggerSchema,
  reason: z.string().trim().min(3).max(4000),
  allowOverBudget: z.boolean().default(false),
})
export type ReplanProposeInput = z.infer<typeof ReplanProposeInputSchema>
