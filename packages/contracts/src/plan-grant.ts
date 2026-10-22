import { z } from 'zod'
import { IdSchema, TimestampSchema } from './common.js'

/**
 * A PlanExecutionGrant is deliberately narrower than an Approval and much
 * narrower than a shell permission:
 *
 * - `plan.start` allows the user to start an approved plan revision.
 * - `workspace-write` allows write_file only inside explicitly listed project
 *   paths, only for the listed tasks/Agents, and only while the grant is active.
 *
 * Process, Git-write, external Runtime and sensitive paths always keep their
 * existing per-call Approval. The grant can never authorize those.
 */
export const PlanGrantActionSchema = z.enum(['plan.start', 'workspace-write'])
export type PlanGrantAction = z.infer<typeof PlanGrantActionSchema>

export const PlanGrantActorSchema = z.object({
  kind: z.enum(['user', 'system']),
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(240),
})
export type PlanGrantActor = z.infer<typeof PlanGrantActorSchema>

export const PlanExecutionGrantStatusSchema = z.enum(['active', 'revoked', 'expired', 'exhausted'])
export type PlanExecutionGrantStatus = z.infer<typeof PlanExecutionGrantStatusSchema>

export const PlanExecutionGrantSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  planId: IdSchema,
  planRevision: z.number().int().positive(),
  /** Stable hash of the approved plan content; a new revision cannot reuse it. */
  planFingerprint: z.string().min(16).max(128),
  actor: PlanGrantActorSchema,
  actions: z.array(PlanGrantActionSchema).min(1),
  /** Project-relative paths; `['.']` means the project root (sensitive paths still excluded). */
  allowedPaths: z.array(z.string().max(500)).max(30),
  allowedTaskIds: z.array(IdSchema).max(200),
  allowedAgentIds: z.array(IdSchema).max(200),
  maxRuns: z.number().int().min(1).max(10),
  usedRuns: z.number().int().nonnegative(),
  /** In-flight startup reservations; counted against maxRuns until settled. */
  reservedRuns: z.number().int().nonnegative().default(0),
  maxToolCalls: z.number().int().min(1).max(500),
  usedToolCalls: z.number().int().nonnegative(),
  /** Explicit opt-in only; never implied by a plan start call. */
  allowOverBudget: z.boolean(),
  note: z.string().max(2000),
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  revokedAt: TimestampSchema.nullable(),
  revokedReason: z.string().max(2000).nullable(),
  lastUsedAt: TimestampSchema.nullable(),
})
export type PlanExecutionGrant = z.infer<typeof PlanExecutionGrantSchema>

export const PlanExecutionGrantViewSchema = PlanExecutionGrantSchema.extend({
  status: PlanExecutionGrantStatusSchema,
  valid: z.boolean(),
  invalidReasons: z.array(z.string().max(1000)),
  /** True only when the plan is approved, no execution is running, and starts remain. */
  canStart: z.boolean(),
  planStatus: z.enum(['draft', 'approved', 'rejected', 'superseded']),
  planGoal: z.string().max(8000),
})
export type PlanExecutionGrantView = z.infer<typeof PlanExecutionGrantViewSchema>

export const PlanExecutionGrantIssueInputSchema = z.object({
  planId: IdSchema,
  actions: z.array(PlanGrantActionSchema).min(1).max(2),
  allowedPaths: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  /** Omit to cover every task created by this plan revision. */
  allowedTaskIds: z.array(IdSchema).max(200).optional(),
  /** Omit to derive from the current assignees of the covered tasks. */
  allowedAgentIds: z.array(IdSchema).max(200).optional(),
  maxRuns: z.number().int().min(1).max(10).default(1),
  maxToolCalls: z.number().int().min(1).max(500).default(40),
  ttlHours: z.number().min(0.25).max(168).default(24),
  allowOverBudget: z.boolean().default(false),
  note: z.string().trim().max(2000).default(''),
  /** Makes the grant an explicit action rather than a form default. */
  confirm: z.literal(true),
})
export type PlanExecutionGrantIssueInput = z.infer<typeof PlanExecutionGrantIssueInputSchema>

export const PlanExecutionGrantRevokeInputSchema = z.object({
  grantId: IdSchema,
  reason: z.string().trim().max(2000).default('用户撤销计划执行授权'),
})
export type PlanExecutionGrantRevokeInput = z.infer<typeof PlanExecutionGrantRevokeInputSchema>

export const PlannerUsageConnectionSchema = z.object({
  connectionId: IdSchema.nullable(),
  modelId: z.string().nullable(),
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedCost: z.number().nonnegative(),
  unpricedCalls: z.number().int().nonnegative(),
})
export type PlannerUsageConnection = z.infer<typeof PlannerUsageConnectionSchema>

export const PlannerUsageSummarySchema = z.object({
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedCost: z.number().nonnegative(),
  unpricedCalls: z.number().int().nonnegative(),
  byConnection: z.array(PlannerUsageConnectionSchema),
})
export type PlannerUsageSummary = z.infer<typeof PlannerUsageSummarySchema>
