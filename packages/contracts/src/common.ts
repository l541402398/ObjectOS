import { ulid } from 'ulid'
import { z } from 'zod'

/** Stable identifier prefixes make logs and audit trails readable. */
export const ID_PREFIXES = {
  project: 'prj',
  stage: 'stg',
  requirement: 'req',
  milestone: 'mil',
  task: 'tsk',
  dependency: 'dep',
  attempt: 'att',
  lease: 'lse',
  artifact: 'art',
  decision: 'dec',
  agent: 'agt',
  agentInstance: 'agi',
  session: 'ses',
  message: 'msg',
  run: 'run',
  step: 'stp',
  checkpoint: 'ckp',
  event: 'evt',
  outbox: 'out',
  inbox: 'inb',
  handoff: 'hnd',
  toolCall: 'tol',
  approval: 'apr',
  knowledge: 'knw',
  plugin: 'plg',
  aiConnection: 'aic',
  aiConnectionCheck: 'ack',
  aiUsage: 'usg',
  aiPrice: 'aip',
  healthCheckRun: 'hcr',
  finding: 'fnd',
  findingEvidence: 'fev',
  repairProposal: 'prp',
  agentBinding: 'bnd',
  snapshot: 'snp',
  plan: 'pln',
} as const

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES]

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid().toLowerCase()}`
}

export const IdSchema = z
  .string()
  .min(4)
  .max(80)
  .regex(/^[a-z]{3}_[0-9a-z]+$/, 'identifier must be <prefix>_<ulid>')

export const TimestampSchema = z.number().int().nonnegative()
export const IsoDateSchema = z.string().datetime({ offset: true })

export function now(): number {
  return Date.now()
}

export const PageInputSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
})

export type JsonObject = Record<string, unknown>

export const JsonObjectSchema = z.record(z.string(), z.unknown())

export const ActorSchema = z.object({
  kind: z.enum(['user', 'agent', 'system']),
  id: z.string().min(1),
  name: z.string().min(1),
})
export type Actor = z.infer<typeof ActorSchema>

export const emptyInput = z.object({}).default({})


