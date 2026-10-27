import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { safeStorage } from 'electron'
import { AppError } from '@projectos/contracts'
import type { MainLogger } from './logger.js'

interface VaultFile {
  version: 1
  secrets: Record<string, string>
}

/**
 * OS-backed vault for resource credentials (SSH keys/passwords/tokens).
 * Only ciphertext is written to disk; the renderer and SQLite never see it.
 */
export class ResourceCredentialVault {
  private readonly path: string
  private readonly encrypted = new Map<string, string>()

  constructor(dataDir: string, private readonly logger: MainLogger) {
    this.path = join(dataDir, 'resource-credentials.vault.json')
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
      this.logger.warn('failed to load resource credential vault', { error: String(error) })
    }
  }

  private persist(): void {
    const secrets: Record<string, string> = {}
    for (const [id, value] of this.encrypted) secrets[id] = value
    mkdirSync(dirname(this.path), { recursive: true })
    const temp = `${this.path}.tmp`
    writeFileSync(temp, JSON.stringify({ version: 1, secrets }, null, 2), 'utf8')
    renameSync(temp, this.path)
  }

  available(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  set(id: string, secret: Record<string, unknown>): void {
    if (!this.available()) {
      throw new AppError('SECRET_STORAGE_UNAVAILABLE', '系统安全存储不可用，拒绝保存凭据。请启用系统凭据保护后重试。')
    }
    this.encrypted.set(id, safeStorage.encryptString(JSON.stringify(secret)).toString('base64'))
    this.persist()
  }

  get(id: string): Record<string, unknown> | null {
    const encrypted = this.encrypted.get(id)
    if (!encrypted) return null
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))) as Record<string, unknown>
    } catch (error) {
      this.logger.warn('failed to decrypt resource credential', { id, error: String(error) })
      return null
    }
  }

  delete(id: string): void {
    this.encrypted.delete(id)
    this.persist()
  }
}
