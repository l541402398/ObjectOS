import { z } from 'zod'
import { IdSchema, TimestampSchema } from './common.js'

export const AIBackendKindSchema = z.enum(['native-llm', 'external-agent'])
export type AIBackendKind = z.infer<typeof AIBackendKindSchema>

export const AIProviderProtocolSchema = z.enum([
  'openai-chat',
  'openai-responses',
  'anthropic-messages',
  'external-cli',
])
export type AIProviderProtocol = z.infer<typeof AIProviderProtocolSchema>

export const AIProviderIdSchema = z.enum(['openai', 'deepseek', 'anthropic', 'custom', 'external'])
export type AIProviderId = z.infer<typeof AIProviderIdSchema>

export const AITriStateSchema = z.enum(['yes', 'no', 'unknown'])
export type AITriState = z.infer<typeof AITriStateSchema>

export const AIModelCapabilitiesSchema = z.object({
  streaming: AITriStateSchema.default('unknown'),
  toolCalling: AITriStateSchema.default('unknown'),
  vision: AITriStateSchema.default('unknown'),
  reasoning: AITriStateSchema.default('unknown'),
})
export type AIModelCapabilities = z.infer<typeof AIModelCapabilitiesSchema>

export const AIModelSourceSchema = z.enum(['discovered', 'manual'])
export type AIModelSource = z.infer<typeof AIModelSourceSchema>

export const AIModelSchema = z.object({
  connectionId: IdSchema,
  modelId: z.string().min(1).max(200),
  displayName: z.string().min(1).max(240),
  source: AIModelSourceSchema,
  capabilities: AIModelCapabilitiesSchema,
  contextWindow: z.number().int().positive().nullable(),
  maxOutputTokens: z.number().int().positive().nullable(),
  verifiedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type AIModel = z.infer<typeof AIModelSchema>

export const AIConnectionProfileSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  backendKind: AIBackendKindSchema,
  providerId: AIProviderIdSchema,
  protocol: AIProviderProtocolSchema,
  baseUrl: z.string().max(2048),
  defaultModelId: z.string().max(200).nullable(),
  secretRef: z.string().max(240).nullable(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  timeoutMs: z.number().int().min(1_000).max(120_000),
  temperature: z.number().min(0).max(2),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type AIConnectionProfile = z.infer<typeof AIConnectionProfileSchema>

export const AIErrorCodeSchema = z.enum([
  'INVALID_KEY',
  'INSUFFICIENT_QUOTA',
  'RATE_LIMITED',
  'MODEL_NOT_FOUND',
  'PROTOCOL_MISMATCH',
  'TLS_ERROR',
  'PROXY_ERROR',
  'TIMEOUT',
  'NETWORK_UNREACHABLE',
  'UNKNOWN',
])
export type AIErrorCode = z.infer<typeof AIErrorCodeSchema>

export const AIConnectionCheckStageSchema = z.enum(['L1', 'L2', 'L3', 'L4'])
export type AIConnectionCheckStage = z.infer<typeof AIConnectionCheckStageSchema>

export const AIConnectionCheckStatusSchema = z.enum(['passed', 'failed', 'skipped'])

export const AIConnectionCheckSchema = z.object({
  id: IdSchema,
  connectionId: IdSchema,
  stage: AIConnectionCheckStageSchema,
  status: AIConnectionCheckStatusSchema,
  errorCode: AIErrorCodeSchema.nullable(),
  message: z.string(),
  latencyMs: z.number().int().nonnegative(),
  checkedAt: TimestampSchema,
})
export type AIConnectionCheck = z.infer<typeof AIConnectionCheckSchema>

export const AIConnectionViewSchema = AIConnectionProfileSchema.extend({
  hasSecret: z.boolean(),
  modelCount: z.number().int().nonnegative(),
  lastCheck: AIConnectionCheckSchema.nullable(),
})
export type AIConnectionView = z.infer<typeof AIConnectionViewSchema>

export const AIConnectionListSchema = z.object({
  connections: z.array(AIConnectionViewSchema),
  defaultId: IdSchema.nullable(),
})
export type AIConnectionList = z.infer<typeof AIConnectionListSchema>

const optionalUrl = z.union([z.literal(''), z.string().trim().url().max(2048)])

export const AIConnectionCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  backendKind: AIBackendKindSchema.default('native-llm'),
  providerId: AIProviderIdSchema.default('custom'),
  protocol: AIProviderProtocolSchema.default('openai-chat'),
  baseUrl: optionalUrl.default(''),
  apiKey: z.string().trim().max(8000).optional(),
  defaultModelId: z.string().trim().max(200).optional(),
  temperature: z.number().min(0).max(2).default(0.2),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
})
export type AIConnectionCreateInput = z.infer<typeof AIConnectionCreateInputSchema>

export const AIConnectionUpdateInputSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(120).optional(),
  backendKind: AIBackendKindSchema.optional(),
  providerId: AIProviderIdSchema.optional(),
  protocol: AIProviderProtocolSchema.optional(),
  baseUrl: optionalUrl.optional(),
  apiKey: z.string().trim().max(8000).optional(),
  defaultModelId: z.string().trim().max(200).nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
})
export type AIConnectionUpdateInput = z.infer<typeof AIConnectionUpdateInputSchema>

export const AIConnectionIdInputSchema = z.object({ id: IdSchema })

export const AIConnectionTestResultSchema = z.object({
  ok: z.boolean(),
  code: AIErrorCodeSchema,
  message: z.string(),
  latencyMs: z.number().int().nonnegative(),
  httpStatus: z.number().int().nullable(),
  checkedAt: TimestampSchema,
  stages: z.array(AIConnectionCheckSchema),
})
export type AIConnectionTestResult = z.infer<typeof AIConnectionTestResultSchema>

export const AIModelListSchema = z.object({ models: z.array(AIModelSchema) })
export type AIModelList = z.infer<typeof AIModelListSchema>

export const AIModelPriceSchema = z.object({
  id: IdSchema,
  connectionId: IdSchema,
  modelId: z.string().min(1).max(200),
  inputPerMillion: z.number().nonnegative(),
  outputPerMillion: z.number().nonnegative(),
  currency: z.string().min(1).max(12),
  version: z.string().min(1).max(40),
  effectiveAt: TimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type AIModelPrice = z.infer<typeof AIModelPriceSchema>

export const AIModelPriceListSchema = z.object({ prices: z.array(AIModelPriceSchema) })
export type AIModelPriceList = z.infer<typeof AIModelPriceListSchema>

export const AIModelPriceUpsertSchema = z.object({
  connectionId: IdSchema,
  modelId: z.string().trim().min(1).max(200),
  inputPerMillion: z.number().nonnegative().default(0),
  outputPerMillion: z.number().nonnegative().default(0),
  currency: z.string().trim().min(1).max(12).default('USD'),
})
export type AIModelPriceUpsert = z.infer<typeof AIModelPriceUpsertSchema>

export const AIModelCreateInputSchema = z.object({
  connectionId: IdSchema,
  modelId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(240).optional(),
  capabilities: AIModelCapabilitiesSchema.partial().optional(),
  contextWindow: z.number().int().positive().nullable().optional(),
  maxOutputTokens: z.number().int().positive().nullable().optional(),
})
export type AIModelCreateInput = z.infer<typeof AIModelCreateInputSchema>

export const AIModelDeleteInputSchema = z.object({
  connectionId: IdSchema,
  modelId: z.string().trim().min(1).max(200),
})

export const AIModelSetDefaultInputSchema = z.object({
  connectionId: IdSchema,
  modelId: z.string().trim().min(1).max(200),
})

export const ExternalAgentInstallationSchema = z.object({
  adapterId: z.enum(['claude-code', 'codex']),
  name: z.string(),
  installed: z.boolean(),
  executablePath: z.string().nullable(),
  version: z.string().nullable(),
  authState: z.enum(['authorized', 'unauthorized', 'unknown']),
  lastCheckedAt: TimestampSchema,
  message: z.string(),
})
export type ExternalAgentInstallation = z.infer<typeof ExternalAgentInstallationSchema>

export const ExternalAgentListSchema = z.object({
  installations: z.array(ExternalAgentInstallationSchema),
})
export type ExternalAgentList = z.infer<typeof ExternalAgentListSchema>

export const ExternalAgentRunInputSchema = z.object({
  projectId: IdSchema,
  adapterId: z.enum(['claude-code', 'codex']),
  prompt: z.string().trim().min(1).max(100_000),
  taskId: IdSchema.nullable().optional(),
  planId: IdSchema.nullable().optional(),
  allowWrite: z.boolean().default(false),
})
export type ExternalAgentRunInput = z.infer<typeof ExternalAgentRunInputSchema>

export const ExternalAgentRunResultSchema = z.object({
  runId: IdSchema,
  sessionId: IdSchema,
  adapterId: z.enum(['claude-code', 'codex']),
  readOnly: z.boolean(),
})
export type ExternalAgentRunResult = z.infer<typeof ExternalAgentRunResultSchema>

export const AgentBackendScopeSchema = z.enum(['global', 'project', 'agent', 'task'])
export type AgentBackendScope = z.infer<typeof AgentBackendScopeSchema>

export const AgentBackendBindingSchema = z.object({
  id: IdSchema,
  scopeType: AgentBackendScopeSchema,
  scopeId: z.string().max(80).nullable(),
  agentRole: z.string().max(120).nullable(),
  taskType: z.string().max(120).nullable(),
  connectionId: IdSchema.nullable(),
  modelId: z.string().max(200).nullable(),
  priority: z.number().int().min(-100).max(100),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type AgentBackendBinding = z.infer<typeof AgentBackendBindingSchema>

export const AgentBackendBindingListSchema = z.object({
  bindings: z.array(AgentBackendBindingSchema),
})
export type AgentBackendBindingList = z.infer<typeof AgentBackendBindingListSchema>

export const AgentBackendBindingUpsertSchema = z.object({
  id: IdSchema.optional(),
  scopeType: AgentBackendScopeSchema.default('agent'),
  scopeId: z.string().max(80).nullable().optional(),
  agentRole: z.string().max(120).nullable().optional(),
  taskType: z.string().max(120).nullable().optional(),
  connectionId: IdSchema.nullable().optional(),
  modelId: z.string().max(200).nullable().optional(),
  priority: z.number().int().min(-100).max(100).default(0),
})
export type AgentBackendBindingUpsert = z.infer<typeof AgentBackendBindingUpsertSchema>

export const AgentBackendBindingDeleteSchema = z.object({ id: IdSchema })

export const AIUsageRecordSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  connectionId: IdSchema.nullable(),
  modelId: z.string().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  usageSource: z.enum(['provider', 'estimate', 'unknown']),
  estimatedCost: z.number().nonnegative().nullable(),
  currency: z.string().nullable(),
  createdAt: TimestampSchema,
})
export type AIUsageRecord = z.infer<typeof AIUsageRecordSchema>

export const AIUsageSummarySchema = z.object({
  runs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedCost: z.number().nonnegative(),
  byConnection: z.array(z.object({
    connectionId: IdSchema.nullable(),
    modelId: z.string().nullable(),
    runs: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    estimatedCost: z.number().nonnegative(),
  })),
})
export type AIUsageSummary = z.infer<typeof AIUsageSummarySchema>

/** Internal shape handed from Main to Runtime for a probe. The secret exists only in memory. */
export const AIConnectionProbeSchema = z.object({
  connectionId: IdSchema,
  name: z.string().optional(),
  protocol: AIProviderProtocolSchema,
  baseUrl: z.string(),
  model: z.string().max(200),
  apiKey: z.string(),
  timeoutMs: z.number().int().min(1_000).max(120_000),
  temperature: z.number().min(0).max(2).default(0.2),
})
export type AIConnectionProbe = z.infer<typeof AIConnectionProbeSchema>

export const AIRegistryActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }),
  z.object({ action: z.literal('getDefault') }),
  z.object({ action: z.literal('create'), input: AIConnectionCreateInputSchema }),
  z.object({ action: z.literal('update'), input: AIConnectionUpdateInputSchema }),
  z.object({ action: z.literal('delete'), id: IdSchema }),
  z.object({ action: z.literal('setDefault'), id: IdSchema }),
  z.object({ action: z.literal('setSecretRef'), id: IdSchema, secretRef: z.string().max(240).nullable() }),
  z.object({ action: z.literal('listModels'), connectionId: IdSchema }),
  z.object({ action: z.literal('createModel'), input: AIModelCreateInputSchema }),
  z.object({ action: z.literal('deleteModel'), input: AIModelDeleteInputSchema }),
  z.object({ action: z.literal('setDefaultModel'), input: AIModelSetDefaultInputSchema }),
  z.object({ action: z.literal('recordCheck'), check: AIConnectionCheckSchema }),
  z.object({ action: z.literal('upsertModels'), connectionId: IdSchema, models: z.array(AIModelSchema) }),
])
export type AIRegistryAction = z.infer<typeof AIRegistryActionSchema>
