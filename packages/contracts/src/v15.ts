import { z } from 'zod'
import { IdSchema, TimestampSchema } from './common.js'

export const RuntimeProtocolSchema = z.enum(['native', 'cli', 'acp', 'http', 'sdk'])
export type RuntimeProtocol = z.infer<typeof RuntimeProtocolSchema>

export const RuntimeCapabilitiesSchema = z.object({
  stream: z.boolean().default(false),
  toolCalls: z.boolean().default(false),
  skills: z.boolean().default(false),
  systemPrompt: z.enum(['native', 'prepend', 'unsupported']).default('unsupported'),
  sessionResume: z.boolean().default(false),
  subagents: z.boolean().default(false),
  worktree: z.boolean().default(false),
  permissions: z.boolean().default(false),
  costMetrics: z.boolean().default(false),
  modelSwitch: z.boolean().default(false),
})
export type RuntimeCapabilities = z.infer<typeof RuntimeCapabilitiesSchema>

export const RuntimeProfileSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  protocol: RuntimeProtocolSchema,
  executable: z.string().max(2000).nullable(),
  endpoint: z.string().max(2000).nullable(),
  args: z.array(z.string().max(500)).max(40),
  authRef: z.string().max(120).nullable(),
  modelRef: z.string().max(200).nullable(),
  options: z.record(z.string(), z.unknown()),
  capabilities: RuntimeCapabilitiesSchema,
  status: z.enum(['unknown', 'available', 'unavailable', 'incompatible', 'degraded']),
  version: z.string().max(120).nullable(),
  source: z.enum(['builtin', 'registry', 'custom', 'plugin']),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type RuntimeProfile = z.infer<typeof RuntimeProfileSchema>

export const RuntimeProfileUpsertSchema = z.object({
  id: IdSchema.optional(),
  name: z.string().trim().min(1).max(120),
  protocol: RuntimeProtocolSchema,
  executable: z.string().max(2000).nullable().default(null),
  endpoint: z.string().max(2000).nullable().default(null),
  args: z.array(z.string().max(500)).max(40).default([]),
  authRef: z.string().max(120).nullable().default(null),
  modelRef: z.string().max(200).nullable().default(null),
  options: z.record(z.string(), z.unknown()).default({}),
  capabilities: RuntimeCapabilitiesSchema.partial().default({}),
})
export type RuntimeProfileUpsert = z.infer<typeof RuntimeProfileUpsertSchema>

export const RuntimeDetectionSchema = z.object({
  profileId: IdSchema.nullable(),
  adapterId: z.string(),
  name: z.string(),
  installed: z.boolean(),
  executable: z.string().nullable(),
  version: z.string().nullable(),
  protocol: RuntimeProtocolSchema,
  capabilities: RuntimeCapabilitiesSchema,
  status: z.enum(['available', 'unavailable', 'incompatible', 'error']),
  message: z.string(),
})
export type RuntimeDetection = z.infer<typeof RuntimeDetectionSchema>

export const AgentPersonaSchema = z.object({
  role: z.string().max(120).default(''),
  background: z.string().max(4000).default(''),
  responsibilities: z.string().max(4000).default(''),
  principles: z.string().max(4000).default(''),
  style: z.string().max(2000).default(''),
  constraints: z.string().max(4000).default(''),
  systemPrompt: z.string().max(30_000).default(''),
})
export type AgentPersona = z.infer<typeof AgentPersonaSchema>

export const SkillSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(4000),
  version: z.string().max(40),
  source: z.string().max(80),
  content: z.string().max(100_000),
  schemaVersion: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Skill = z.infer<typeof SkillSchema>

export const AgentDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  role: z.string().max(120),
  description: z.string().max(4000),
  category: z.string().max(80),
  avatar: z.string().max(80),
  visibility: z.enum(['private', 'project', 'space', 'global']),
  status: z.enum(['active', 'disabled', 'archived']),
  persona: AgentPersonaSchema,
  skills: z.array(z.object({ skillId: IdSchema, version: z.string(), enabled: z.boolean() })),
  runtimeProfileIds: z.array(IdSchema),
  primaryRuntimeProfileId: IdSchema.nullable(),
  modelRef: z.string().max(200).nullable(),
  permissions: z.object({ tools: z.array(z.string()), files: z.boolean(), shell: z.boolean(), network: z.boolean() }),
  currentVersion: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>

export const AgentDefinitionUpsertSchema = z.object({
  id: IdSchema.optional(),
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(120),
  description: z.string().max(4000).default(''),
  category: z.string().max(80).default('general'),
  avatar: z.string().max(80).default(''),
  visibility: z.enum(['private', 'project', 'space', 'global']).default('project'),
  persona: AgentPersonaSchema,
  skillIds: z.array(IdSchema).default([]),
  runtimeProfileIds: z.array(IdSchema).default([]),
  primaryRuntimeProfileId: IdSchema.nullable().default(null),
  modelRef: z.string().max(200).nullable().default(null),
  permissions: z.object({ tools: z.array(z.string()).default([]), files: z.boolean().default(false), shell: z.boolean().default(false), network: z.boolean().default(false) }),
  /** Project scope for auto-assignment; null means legacy/global. */
  ownerProjectId: IdSchema.nullable().optional(),
})
export type AgentDefinitionUpsert = z.infer<typeof AgentDefinitionUpsertSchema>

export const RunSkillSnapshotSchema = z.object({
  id: IdSchema,
  name: z.string().max(120),
  description: z.string().max(4000).default(''),
  version: z.string().max(40),
  source: z.string().max(80),
  content: z.string().max(100_000),
  enabled: z.boolean(),
})
export type RunSkillSnapshot = z.infer<typeof RunSkillSnapshotSchema>

/**
 * Frozen execution configuration. A Run must keep using this snapshot even when
 * the AgentDefinition, Skills or RuntimeProfile are edited or archived later.
 */
export const RunSnapshotSchema = z.object({
  runId: IdSchema,
  agentId: IdSchema,
  agentConfigVersion: z.number().int().nonnegative(),
  agentName: z.string().max(120),
  agentRole: z.string().max(120),
  agentDescription: z.string().max(4000).default(''),
  agentCapabilities: z.array(z.string().max(60)).default([]),
  persona: AgentPersonaSchema,
  skills: z.array(RunSkillSnapshotSchema).default([]),
  permissions: z.object({
    tools: z.array(z.string()).default([]),
    files: z.boolean().default(false),
    shell: z.boolean().default(false),
    network: z.boolean().default(false),
  }),
  modelRef: z.string().max(200).nullable(),
  runtimeProfileId: IdSchema.nullable(),
  runtimeProfileName: z.string().max(120).nullable(),
  runtimeProtocol: z.string().max(40).nullable(),
  runtimeProfileVersion: z.string().max(120).nullable(),
  connectionId: IdSchema.nullable(),
  modelId: z.string().max(200).nullable(),
  worktreeId: z.string().max(4000).nullable(),
  workflowNodeId: z.string().max(200).nullable(),
  createdAt: TimestampSchema,
})
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>

export const RuntimeRegistryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string().nullable(),
  description: z.string(),
  distribution: z.record(z.string(), z.unknown()),
})
export type RuntimeRegistryEntry = z.infer<typeof RuntimeRegistryEntrySchema>

