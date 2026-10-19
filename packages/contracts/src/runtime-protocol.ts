import { z } from 'zod'
import { SerializedAppErrorSchema } from './errors.js'
import { TimestampSchema } from './common.js'
import { ApprovalStatusSchema, RunStatusSchema, TaskStatusSchema } from './enums.js'
import { RuntimeStatusSchema } from './entities.js'

export const RUNTIME_PROTOCOL_VERSION = 1

export const RuntimeEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('project.changed'),
    projectId: z.string(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('task.changed'),
    projectId: z.string(),
    taskId: z.string(),
    status: TaskStatusSchema,
    reason: z.string(),
  }),
  z.object({
    type: z.literal('session.changed'),
    projectId: z.string(),
    sessionId: z.string(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('run.changed'),
    projectId: z.string(),
    runId: z.string(),
    sessionId: z.string(),
    status: RunStatusSchema,
  }),
  z.object({
    type: z.literal('run.delta'),
    projectId: z.string(),
    runId: z.string(),
    sessionId: z.string(),
    text: z.string(),
    stepSeq: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('run.step'),
    projectId: z.string(),
    runId: z.string(),
    stepId: z.string(),
    kind: z.string(),
  }),
  z.object({
    type: z.literal('approval.changed'),
    projectId: z.string(),
    approvalId: z.string(),
    status: ApprovalStatusSchema,
  }),
  z.object({
    type: z.literal('inbox.changed'),
    projectId: z.string(),
    inboxId: z.string().nullable(),
  }),
  z.object({
    type: z.literal('handoff.changed'),
    projectId: z.string(),
    handoffId: z.string(),
  }),
  z.object({
    type: z.literal('provider.changed'),
    configured: z.boolean(),
    model: z.string(),
  }),
  z.object({
    type: z.literal('runtime.status'),
    status: RuntimeStatusSchema,
  }),
  z.object({
    type: z.literal('runtime.log'),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string(),
    createdAt: TimestampSchema,
  }),
])
export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>

export const RuntimeHelloFrameSchema = z.object({
  kind: z.literal('hello'),
  protocolVersion: z.number().int().positive(),
  runtimeVersion: z.string(),
  pid: z.number().int().positive(),
  startedAt: TimestampSchema,
})
export type RuntimeHelloFrame = z.infer<typeof RuntimeHelloFrameSchema>

export const RuntimeRequestFrameSchema = z.object({
  kind: z.literal('request'),
  id: z.string().min(1),
  method: z.string().min(1),
  input: z.unknown(),
})
export type RuntimeRequestFrame = z.infer<typeof RuntimeRequestFrameSchema>

export const RuntimeResponseFrameSchema = z.object({
  kind: z.literal('response'),
  id: z.string().min(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: SerializedAppErrorSchema.optional(),
})
export type RuntimeResponseFrame = z.infer<typeof RuntimeResponseFrameSchema>

export const RuntimeEventFrameSchema = z.object({
  kind: z.literal('event'),
  seq: z.number().int().positive(),
  event: RuntimeEventSchema,
})
export type RuntimeEventFrame = z.infer<typeof RuntimeEventFrameSchema>

export const RuntimePingFrameSchema = z.object({
  kind: z.literal('ping'),
  id: z.string().min(1),
  sentAt: TimestampSchema,
})
export type RuntimePingFrame = z.infer<typeof RuntimePingFrameSchema>

export const RuntimePongFrameSchema = z.object({
  kind: z.literal('pong'),
  id: z.string().min(1),
  sentAt: TimestampSchema,
  receivedAt: TimestampSchema,
})
export type RuntimePongFrame = z.infer<typeof RuntimePongFrameSchema>

export const RuntimeFrameSchema = z.discriminatedUnion('kind', [
  RuntimeHelloFrameSchema,
  RuntimeRequestFrameSchema,
  RuntimeResponseFrameSchema,
  RuntimeEventFrameSchema,
  RuntimePingFrameSchema,
  RuntimePongFrameSchema,
])
export type RuntimeFrame = z.infer<typeof RuntimeFrameSchema>

export const RuntimeHealthPayloadSchema = z.object({
  ok: z.boolean(),
  protocolVersion: z.number().int(),
  runtimeVersion: z.string(),
  pid: z.number().int(),
  uptimeMs: z.number().int().nonnegative(),
  activeRuns: z.number().int().nonnegative(),
  queuedApprovals: z.number().int().nonnegative(),
})
export type RuntimeHealthPayload = z.infer<typeof RuntimeHealthPayloadSchema>

export const ProviderRuntimeConfigSchema = z.object({
  provider: z.literal('openai-compatible').default('openai-compatible'),
  protocol: z.enum(['openai-chat', 'openai-responses', 'anthropic-messages']).default('openai-chat'),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  apiKey: z.string().default(''),
  temperature: z.number().min(0).max(2).default(0.2),
})
export type ProviderRuntimeConfig = z.infer<typeof ProviderRuntimeConfigSchema>

/** Internal methods accepted by the runtime beyond the renderer catalogue. */
export const RUNTIME_INTERNAL_METHODS = [
  'runtime.health',
  'runtime.shutdown',
  'runtime.provider.configure',
  'runtime.provider.clear',
  'runtime.ai.registry',
  'runtime.ai.probe',
  'runtime.ai.discover',
] as const
