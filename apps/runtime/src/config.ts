import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { ProviderRuntimeConfigSchema, type ProviderRuntimeConfig } from '@projectos/contracts'

export interface RuntimeConfig {
  dataDir: string
  dbPath: string
  logDir: string
  runtimeVersion: string
  provider: ProviderRuntimeConfig
  seedDemo: boolean
}

const DEFAULT_PROVIDER: ProviderRuntimeConfig = {
  provider: 'openai-compatible',
  protocol: 'openai-chat',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
  temperature: 0.2,
}

export function loadRuntimeConfig(): RuntimeConfig {
  const dataDir = resolve(process.env.PROJECTOS_DATA_DIR ?? join(homedir(), '.projectos'))
  const dbPath = process.env.PROJECTOS_DB_PATH ?? join(dataDir, 'projectos.db')
  const logDir = join(dataDir, 'logs')
  let provider = DEFAULT_PROVIDER
  const raw = process.env.PROJECTOS_PROVIDER_JSON
  if (raw) {
    try {
      const parsed = ProviderRuntimeConfigSchema.parse(JSON.parse(raw))
      provider = parsed
    } catch {
      provider = DEFAULT_PROVIDER
    }
  }
  return {
    dataDir,
    dbPath,
    logDir,
    runtimeVersion: '1.7.0',
    provider,
    seedDemo: process.env.PROJECTOS_SEED_DEMO === '1',
  }
}

