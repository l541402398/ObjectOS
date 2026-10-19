import { z } from 'zod'
import { IdSchema, TimestampSchema } from './common.js'

export const HealthCheckStatusSchema = z.enum(['queued', 'running', 'passed', 'failed', 'error', 'cancelled', 'skipped'])
export type HealthCheckStatus = z.infer<typeof HealthCheckStatusSchema>

export const HealthCheckRunSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  checkId: z.string(),
  sourceRevision: z.string().nullable(),
  status: HealthCheckStatusSchema,
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema.nullable(),
  result: z.record(z.string(), z.unknown()),
})
export type HealthCheckRun = z.infer<typeof HealthCheckRunSchema>

export const FindingStatusSchema = z.enum(['open', 'triaged', 'proposed', 'in_progress', 'resolved', 'ignored', 'reopened'])
export type FindingStatus = z.infer<typeof FindingStatusSchema>
export const FindingSeveritySchema = z.enum(['low', 'medium', 'high', 'critical'])
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>

export const FindingEvidenceSchema = z.object({
  id: IdSchema,
  findingId: IdSchema,
  checkRunId: IdSchema.nullable(),
  sourceUri: z.string().nullable(),
  sourceRevision: z.string().nullable(),
  excerpt: z.string(),
  contentHash: z.string(),
  createdAt: TimestampSchema,
})
export type FindingEvidence = z.infer<typeof FindingEvidenceSchema>

export const FindingSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  fingerprint: z.string(),
  category: z.string(),
  severity: FindingSeveritySchema,
  status: FindingStatusSchema,
  title: z.string(),
  firstSeenAt: TimestampSchema,
  lastSeenAt: TimestampSchema,
  occurrenceCount: z.number().int().positive(),
  evidence: z.array(FindingEvidenceSchema).default([]),
})
export type Finding = z.infer<typeof FindingSchema>

export const ProposalStatusSchema = z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'expired', 'executing', 'completed', 'failed'])
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>

export const RepairProposalSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  status: ProposalStatusSchema,
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  scope: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  findingIds: z.array(IdSchema),
  planId: IdSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type RepairProposal = z.infer<typeof RepairProposalSchema>

export const AutomationGrantSchema = z.object({
  projectId: IdSchema,
  allowedActions: z.array(z.string()),
  allowedPaths: z.array(z.string()),
  expiresAt: TimestampSchema,
  maxRuns: z.number().int().positive(),
  usedRuns: z.number().int().nonnegative(),
  revokedAt: TimestampSchema.nullable(),
})

export type AutomationGrant = z.infer<typeof AutomationGrantSchema>

export const AutonomyModeSchema = z.enum(['observe', 'propose', 'approved-autofix'])
export type AutonomyMode = z.infer<typeof AutonomyModeSchema>

export const AutomationTriggerSchema = z.object({
  projectId: IdSchema,
  intervalMinutes: z.number().int().min(5).max(1440),
  enabled: z.boolean(),
  nextRunAt: TimestampSchema.nullable(),
})

export type AutomationTrigger = z.infer<typeof AutomationTriggerSchema>

export const OperationsSnapshotSchema = z.object({
  projectId: IdSchema,
  mode: AutonomyModeSchema,
  checks: z.array(HealthCheckRunSchema),
  findings: z.array(FindingSchema),
  proposals: z.array(RepairProposalSchema),
})
export type OperationsSnapshot = z.infer<typeof OperationsSnapshotSchema>


