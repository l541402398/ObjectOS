import { createHash } from 'node:crypto'
import { Client } from 'ssh2'
import type { ConnectionProfile } from '@projectos/contracts'

export type ConnectionCheckStatus = 'connected' | 'auth_failed' | 'timeout' | 'host_key_mismatch' | 'host_key_untrusted' | 'permission_denied' | 'network_error' | 'unsupported'

export interface ConnectionCheckResult {
  status: ConnectionCheckStatus
  stage: string
  message: string
  latencyMs: number | null
  details: Record<string, unknown>
}

function fingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

/**
 * Read-only SSH connectivity/identity check. The only remote command is a
 * fixed allowlisted probe; no shell is exposed to the caller.
 */
export async function testSshConnection(profile: ConnectionProfile, secret: Record<string, unknown> | null): Promise<ConnectionCheckResult> {
  if (profile.protocol !== 'ssh') return { status: 'unsupported', stage: 'protocol', message: '当前只实现了 SSH 只读连接检查', latencyMs: null, details: {} }
  if (!secret) return { status: 'auth_failed', stage: 'credential', message: '凭据不可用或已停用', latencyMs: null, details: {} }
  if (profile.authType === 'agent') return { status: 'unsupported', stage: 'auth', message: 'SSH Agent 连接器尚未实现', latencyMs: null, details: {} }
  if (profile.authType === 'password' && typeof secret.password !== 'string') return { status: 'auth_failed', stage: 'credential', message: '缺少 SSH 密码', latencyMs: null, details: {} }
  if (profile.authType === 'private_key' && typeof secret.privateKey !== 'string') return { status: 'auth_failed', stage: 'credential', message: '缺少 SSH 私钥', latencyMs: null, details: {} }
  if (profile.trustPolicy === 'first_use' && !profile.hostKeyFingerprint) {
    return { status: 'host_key_untrusted', stage: 'host_key', message: '需要先确认主机指纹并固定，再测试连接', latencyMs: null, details: {} }
  }

  const started = Date.now()
  return await new Promise<ConnectionCheckResult>((resolve) => {
    const client = new Client()
    let observedFingerprint: string | null = null
    let settled = false
    const finish = (result: Omit<ConnectionCheckResult, 'latencyMs'> & { latencyMs?: number | null }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { client.end() } catch { /* ignore */ }
      resolve({ ...result, latencyMs: result.latencyMs ?? Date.now() - started })
    }
    const timer = setTimeout(() => finish({ status: 'timeout', stage: 'connect', message: '连接超时', details: { host: profile.host, port: profile.port } }), profile.connectTimeoutMs)

    client.on('error', (error: Error & { level?: string }) => {
      const text = `${error.level ?? ''} ${error.message}`.toLowerCase()
      if (text.includes('authentication')) finish({ status: 'auth_failed', stage: 'auth', message: '身份验证失败', details: {} })
      else if (text.includes('permission')) finish({ status: 'permission_denied', stage: 'auth', message: '权限不足', details: {} })
      else finish({ status: 'network_error', stage: 'connect', message: '无法连接主机', details: {} })
    })
    client.on('ready', () => {
      if (observedFingerprint && profile.hostKeyFingerprint && observedFingerprint !== profile.hostKeyFingerprint) {
        finish({ status: 'host_key_mismatch', stage: 'host_key', message: '主机指纹与已固定指纹不一致，已拒绝连接', details: { fingerprint: observedFingerprint } })
        return
      }
      client.exec('uname -srm && whoami', (error, stream) => {
        if (error) {
          finish({ status: 'permission_denied', stage: 'probe', message: '只读探测被拒绝', details: { fingerprint: observedFingerprint } })
          return
        }
        let output = ''
        let stderr = ''
        stream.on('data', (chunk: Buffer) => { output += chunk.toString().slice(0, 2000) })
        stream.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString().slice(0, 1000) })
        stream.on('close', (code: number) => {
          if (code !== 0) {
            finish({ status: 'permission_denied', stage: 'probe', message: '只读探测返回非零状态', details: { fingerprint: observedFingerprint, code } })
            return
          }
          finish({
            status: 'connected', stage: 'probe', message: '身份验证成功，只读探测完成',
            details: { fingerprint: observedFingerprint, output: output.trim(), stderr: stderr.trim() },
          })
        })
      })
    })
    client.connect({
      host: profile.host,
      port: profile.port,
      username: profile.username,
      readyTimeout: profile.connectTimeoutMs,
      ...(profile.authType === 'password' ? { password: String(secret.password) } : {}),
      ...(profile.authType === 'private_key' ? { privateKey: String(secret.privateKey), passphrase: secret.passphrase ? String(secret.passphrase) : undefined } : {}),
      hostVerifier: (key: Buffer) => {
        observedFingerprint = fingerprint(key)
        if (!profile.hostKeyFingerprint) {
          finish({ status: 'host_key_untrusted', stage: 'host_key', message: '首次连接需要确认主机指纹', details: { fingerprint: observedFingerprint } })
          return false
        }
        if (observedFingerprint !== profile.hostKeyFingerprint) {
          finish({ status: 'host_key_mismatch', stage: 'host_key', message: '主机指纹与已固定指纹不一致', details: { fingerprint: observedFingerprint } })
          return false
        }
        return true
      },
    })
  })
}
