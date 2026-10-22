import { z } from 'zod'

/**
 * Global runtime limits. They are persisted in app_settings and applied to new
 * Planner calls, Agent Runs and Plan executions. Existing Runs keep their
 * snapshotted budget; changing a setting never retroactively widens a live Run.
 */
export const RuntimeSettingsSchema = z.object({
  plannerMaxOutputTokens: z.number().int().min(2_048).max(32_768).default(12_288),
  plannerMaxTasks: z.number().int().min(1).max(20).default(20),
  plannerTimeoutMs: z.number().int().min(30_000).max(300_000).default(120_000),
  agentMaxSteps: z.number().int().min(1).max(200).default(32),
  agentMaxToolCalls: z.number().int().min(1).max(500).default(64),
  agentRunTimeoutMinutes: z.number().int().min(1).max(1_440).default(30),
  planTimeoutMinutes: z.number().int().min(1).max(10_080).default(120),
})
export type RuntimeSettings = z.infer<typeof RuntimeSettingsSchema>

export const RuntimeSettingsUpdateSchema = z.object({
  plannerMaxOutputTokens: z.number().int().min(2_048).max(32_768).optional(),
  plannerMaxTasks: z.number().int().min(1).max(20).optional(),
  plannerTimeoutMs: z.number().int().min(30_000).max(300_000).optional(),
  agentMaxSteps: z.number().int().min(1).max(200).optional(),
  agentMaxToolCalls: z.number().int().min(1).max(500).optional(),
  agentRunTimeoutMinutes: z.number().int().min(1).max(1_440).optional(),
  planTimeoutMinutes: z.number().int().min(1).max(10_080).optional(),
})
export type RuntimeSettingsUpdate = z.infer<typeof RuntimeSettingsUpdateSchema>

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = RuntimeSettingsSchema.parse({})

export function normalizeRuntimeSettings(value: unknown): RuntimeSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_RUNTIME_SETTINGS }
  const parsed = RuntimeSettingsSchema.safeParse(value)
  if (!parsed.success) return { ...DEFAULT_RUNTIME_SETTINGS }
  return parsed.data
}

export function mergeRuntimeSettings(
  current: RuntimeSettings,
  patch: RuntimeSettingsUpdate,
): RuntimeSettings {
  const merged = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) }
  return normalizeRuntimeSettings(merged)
}
