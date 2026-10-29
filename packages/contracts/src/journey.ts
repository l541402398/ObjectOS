import { z } from 'zod'
import { IdSchema, TimestampSchema } from './common.js'

/**
 * ADR-0053 — the global goal journey.
 *
 * One projection answers the four questions a first-time user has: what goal am I on, which step of
 * the whole journey is this, is the system working or stopped, and who owns the next move. It is
 * derived from the same persisted facts CompletionDecision / GoalStatus / GateEvaluation already use —
 * never from task counts, plan status alone or model prose.
 */
export const JourneyStageKeySchema = z.enum([
  'setup',
  'requirement',
  'plan',
  'review',
  'grant',
  'execute',
  'verify',
  'code-review',
  'delivery',
])
export type JourneyStageKey = z.infer<typeof JourneyStageKeySchema>

/** `done` is only used when a persisted fact proves it (grant active, verification passed, …). */
export const JourneyStageStateSchema = z.enum(['pending', 'active', 'blocked', 'done', 'skipped'])
export type JourneyStageState = z.infer<typeof JourneyStageStateSchema>

export const JourneyOwnerSchema = z.enum(['user', 'ai', 'system', 'none'])
export type JourneyOwner = z.infer<typeof JourneyOwnerSchema>

export const JourneyEntrySchema = z.object({
  label: z.string().max(120),
  /** Exact hash route to the object that owns this stage. */
  route: z.string().max(500),
})
export type JourneyEntry = z.infer<typeof JourneyEntrySchema>

export const JourneyStageSchema = z.object({
  key: JourneyStageKeySchema,
  label: z.string().max(40),
  state: JourneyStageStateSchema,
  owner: JourneyOwnerSchema,
  /** One sentence a user can act on ("等待你批准计划"). */
  detail: z.string().max(600),
  /** Conditions this stage must satisfy, in user language. */
  requirements: z.array(z.string().max(240)).default([]),
  /** Which of those conditions a persisted fact already proves. */
  satisfied: z.array(z.string().max(240)).default([]),
  /** Exact objects behind the stage, so the UI can deep-link without guessing. */
  objects: z
    .object({
      planId: IdSchema.nullable().optional(),
      revision: z.number().int().positive().nullable().optional(),
      taskId: IdSchema.nullable().optional(),
      runId: IdSchema.nullable().optional(),
      approvalId: IdSchema.nullable().optional(),
      grantId: IdSchema.nullable().optional(),
      versionId: IdSchema.nullable().optional(),
      mergeCommit: z.string().max(120).nullable().optional(),
      evidenceId: IdSchema.nullable().optional(),
    })
    .default({}),
  entry: JourneyEntrySchema.nullable().default(null),
})
export type JourneyStage = z.infer<typeof JourneyStageSchema>

export const ProjectJourneySchema = z.object({
  projectId: IdSchema.nullable(),
  projectName: z.string().max(240),
  /** The goal the journey is currently about. */
  goal: z.string().max(4000),
  projectStage: z.string().max(60),
  /** Which plan revision the journey is anchored to, and why that one. */
  selection: z.object({
    kind: z.enum(['none', 'draft', 'approved', 'executing']),
    planId: IdSchema.nullable(),
    revision: z.number().int().positive().nullable(),
    reason: z.string().max(300),
  }),
  stages: z.array(JourneyStageSchema).default([]),
  nextAction: z.object({
    owner: JourneyOwnerSchema,
    label: z.string().max(240),
    detail: z.string().max(600),
    route: z.string().max(500).nullable(),
    objectId: z.string().max(120).nullable(),
  }),
  blockers: z.array(z.string().max(300)).default([]),
  /** Other projects with real background work, so the bar can offer a switch. */
  background: z
    .object({
      runningProjects: z.number().int().nonnegative(),
      pendingApprovals: z.number().int().nonnegative(),
    })
    .default({ runningProjects: 0, pendingApprovals: 0 }),
  updatedAt: TimestampSchema,
})
export type ProjectJourney = z.infer<typeof ProjectJourneySchema>
