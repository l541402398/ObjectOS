import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import { AppError } from '@projectos/contracts'
import type { MainLogger } from './logger.js'

interface VaultFile {
  version: 1
  secrets: Record<string, string>
}

/**
 * Secret vault for AI connection profiles. Only encrypted bytes touch disk;
 * callers pass connection IDs, never secrets to the renderer or SQLite.
 */
export class ConnectionSecretStore {
  private readonly path: string
  private readonly encrypted = new Map<string, string>()
  private readonly plaintextFallback = new Map<string, string>()

  constructor(
    private readonly dataDir: string,
    private readonly logger: MainLogger,
  ) {
    this.path = join(dataDir, 'ai-secrets.vault.json')
    this.load()
  }

  private load(): void {
    if (!existsSync(this.path)) return
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as VaultFile
      if (parsed.version !== 1 || !parsed.secrets) return
      for (const [id, encrypted] of Object.entries(parsed.secrets)) {
        if (typeof encrypted === 'string') this.encrypted.set(id, encrypted)
      }
    } catch (error) {
      this.logger.warn('failed to load AI secret vault', { error: String(error) })
    }
  }

  private persist(): void {
    const secrets: Record<string, string> = {}
    for (const [id, value] of this.encrypted) secrets[id] = value
    mkdirSync(this.dataDir, { recursive: true })
    const temp = `${this.path}.tmp`
    writeFileSync(temp, JSON.stringify({ version: 1, secrets }, null, 2), 'utf8')
    renameSync(temp, this.path)
  }

  set(id: string, secret: string): void {
    if (!secret.trim()) return
    if (!safeStorage.isEncryptionAvailable()) {
      this.plaintextFallback.set(id, secret)
      throw new AppError(
        'SECRET_STORAGE_UNAVAILABLE',
        '系统安全存储不可用，无法安全保存 API Key。请先启用系统凭据保护。',
      )
    }
    this.encrypted.set(id, safeStorage.encryptString(secret).toString('base64'))
    this.plaintextFallback.delete(id)
    this.persist()
  }

  get(id: string): string | null {
    if (this.plaintextFallback.has(id)) return this.plaintextFallback.get(id) ?? null
    const encrypted = this.encrypted.get(id)
    if (!encrypted) return null
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch (error) {
      this.logger.warn('failed to decrypt AI connection secret', { id, error: String(error) })
      return null
    }
  }

  has(id: string): boolean {
    return Boolean(this.get(id))
  }

  delete(id: string): void {
    this.encrypted.delete(id)
    this.plaintextFallback.delete(id)
    this.persist()
  }
}
