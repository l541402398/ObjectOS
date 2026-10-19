import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { ProviderInfo, ProviderRuntimeConfig } from '@projectos/contracts'
import type { MainLogger } from './logger.js'

export interface ProviderUpdate {
  baseUrl: string
  model: string
  apiKey?: string
  temperature?: number
}

interface PersistedProvider {
  baseUrl: string
  model: string
  temperature: number
  encryptedApiKey?: string
  connectionsMigrated?: boolean
}

const DEFAULT_BASE_URL = process.env.PROJECTOS_PROVIDER_BASE_URL ?? 'https://api.openai.com/v1'
const DEFAULT_MODEL = process.env.PROJECTOS_PROVIDER_MODEL ?? 'gpt-4o-mini'

/**
 * The API key never enters SQLite, logs, or the renderer. It is encrypted with
 * Electron safeStorage (DPAPI on Windows) and only handed to the runtime over its
 * private stdio channel.
 */
export class ProviderConfigStore {
  private baseUrl = DEFAULT_BASE_URL
  private model = DEFAULT_MODEL
  private temperature = 0.2
  private apiKey = process.env.PROJECTOS_PROVIDER_API_KEY ?? ''
  private keyPersisted = false
  private connectionsMigrated = false
  private readonly configPath: string

  constructor(
    private readonly dataDir: string,
    private readonly logger: MainLogger,
  ) {
    this.configPath = join(dataDir, 'provider.json')
    this.load()
  }

  private load(): void {
    if (!existsSync(this.configPath)) return
    try {
      const parsed = JSON.parse(readFileSync(this.configPath, 'utf8')) as PersistedProvider
      if (typeof parsed.baseUrl === 'string') this.baseUrl = parsed.baseUrl
      if (typeof parsed.model === 'string') this.model = parsed.model
      if (typeof parsed.temperature === 'number') this.temperature = parsed.temperature
      this.connectionsMigrated = Boolean(parsed.connectionsMigrated)
      if (parsed.encryptedApiKey && safeStorage.isEncryptionAvailable()) {
        this.apiKey = safeStorage.decryptString(Buffer.from(parsed.encryptedApiKey, 'base64'))
        this.keyPersisted = true
      }
    } catch (error) {
      this.logger.warn('failed to read provider config; using defaults', { error: String(error) })
    }
  }

  private persist(): void {
    const payload: PersistedProvider = {
      baseUrl: this.baseUrl,
      model: this.model,
      temperature: this.temperature,
      connectionsMigrated: this.connectionsMigrated,
    }
    if (this.apiKey) {
      if (safeStorage.isEncryptionAvailable()) {
        payload.encryptedApiKey = safeStorage.encryptString(this.apiKey).toString('base64')
        this.keyPersisted = true
      } else {
        this.keyPersisted = false
        this.logger.warn('safeStorage is unavailable; API key kept in memory only')
      }
    } else {
      this.keyPersisted = false
    }
    mkdirSync(this.dataDir, { recursive: true })
    const temp = `${this.configPath}.tmp`
    writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf8')
    renameSync(temp, this.configPath)
  }

  update(input: ProviderUpdate): void {
    this.baseUrl = input.baseUrl.replace(/\/+$/, '') || DEFAULT_BASE_URL
    this.model = input.model.trim() || DEFAULT_MODEL
    this.temperature = input.temperature ?? this.temperature
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
      this.apiKey = input.apiKey.trim()
    }
    this.persist()
  }

  clearKey(): void {
    this.apiKey = ''
    this.keyPersisted = false
    this.persist()
  }

  hasKey(): boolean {
    return Boolean(this.apiKey)
  }

  isConnectionMigrationDone(): boolean {
    return this.connectionsMigrated
  }

  hasConfigFile(): boolean {
    return existsSync(this.configPath)
  }

  markConnectionMigrationDone(): void {
    this.connectionsMigrated = true
    this.persist()
  }

  /** Mirror the active connection into the legacy provider file for V1.1 compatibility. */
  syncFromConnection(input: { baseUrl: string; model: string; temperature: number; apiKey: string }): void {
    this.baseUrl = input.baseUrl
    this.model = input.model
    this.temperature = input.temperature
    this.apiKey = input.apiKey
    this.persist()
  }

  runtimeConfig(): ProviderRuntimeConfig {
    return {
      provider: 'openai-compatible',
      protocol: 'openai-chat',
      baseUrl: this.baseUrl,
      model: this.model,
      apiKey: this.apiKey,
      temperature: this.temperature,
    }
  }

  info(runtimeInfo?: ProviderInfo | null): ProviderInfo {
    return {
      configured: this.hasKey(),
      provider: 'openai-compatible',
      baseUrl: this.baseUrl,
      model: this.model,
      hasKey: this.hasKey(),
      temperature: this.temperature,
      lastTestAt: runtimeInfo?.lastTestAt ?? null,
      lastTestOk: runtimeInfo?.lastTestOk ?? null,
      lastError: runtimeInfo?.lastError ?? null,
    }
  }

  keyIsPersisted(): boolean {
    return this.keyPersisted
  }
}
