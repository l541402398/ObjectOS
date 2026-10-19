import { z } from 'zod'

export const CapabilityKindSchema = z.enum([
  'llm',
  'agent-driver',
  'tool',
  'skill',
  'memory',
  'transport',
  'workflow',
])
export type CapabilityKind = z.infer<typeof CapabilityKindSchema>

export const PluginManifestSchema = z.object({
  id: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9._-]+$/),
  name: z.string().min(1).max(160),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/),
  apiVersion: z.string().regex(/^\d+\.\d+$/),
  capabilities: z.array(CapabilityKindSchema).min(1),
  dependencies: z.record(z.string(), z.string()).optional(),
  permissions: z.array(z.string().max(120)).max(50).optional(),
  description: z.string().max(2000).optional(),
})
export type PluginManifest = z.infer<typeof PluginManifestSchema>

export const PLUGIN_STATES = [
  'discovered',
  'validated',
  'resolved',
  'loaded',
  'active',
  'stopping',
  'unloaded',
  'failed',
] as const
export const PluginStateSchema = z.enum(PLUGIN_STATES)
export type PluginState = z.infer<typeof PluginStateSchema>

export interface Disposable {
  dispose(): Promise<void> | void
}

export interface PluginContext {
  manifest: PluginManifest
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void
  registerCapability(kind: CapabilityKind, id: string, value: unknown): void
  getService<T>(name: string): T
}

export interface ProjectOSPlugin {
  manifest: PluginManifest
  setup(context: PluginContext): Promise<Disposable | void>
}
