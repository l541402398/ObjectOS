import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, posix } from 'node:path'
import { Client, type SFTPWrapper } from 'ssh2'
import type { ConnectionProfile } from '@projectos/contracts'

export interface SshDeployContext {
  deploymentId: string
  targetRef: string
  profile: ConnectionProfile
  artifacts: Array<{ name: string; uri: string | null; contentHash: string }>
}

export interface SshDeployResult {
  status: 'succeeded' | 'failed'
  externalId: string
  artifactHash: string
  receipt: Record<string, unknown>
  notes: string
  health: { ok: boolean; detail: string }
}

interface TargetAddress {
  path: string
  container: string
  healthPort: number
  image: string
}

function parseTarget(ref: string): TargetAddress {
  const url = new URL(ref)
  const path = decodeURIComponent(url.pathname)
  if (!/^\/opt\/projectos-[a-z0-9/_-]+$/.test(path)) throw new Error('远程目录必须位于 /opt/projectos-* 隔离目录')
  const container = url.searchParams.get('container') || 'projectos-delivery-test'
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(container)) throw new Error('容器名不合法')
  const healthPort = Number(url.searchParams.get('healthPort') || '18080')
  if (!Number.isInteger(healthPort) || healthPort < 1024 || healthPort > 65535) throw new Error('健康检查端口不合法')
  const image = url.searchParams.get('image') || 'nginx:alpine'
  if (!/^[a-z0-9][a-z0-9./:_-]*$/i.test(image)) throw new Error('镜像名不合法')
  return { path, container, healthPort, image }
}

function exec(client: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error)
      let stdout = ''
      let stderr = ''
      stream.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      stream.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      stream.on('close', (code: number) => {
        if (code !== 0) reject(new Error(stderr.trim() || `远程命令退出码 ${code}`))
        else resolve(stdout)
      })
    })
  })
}

async function mkdirRecursive(sftp: SFTPWrapper, remote: string): Promise<void> {
  const parts = remote.split('/').filter(Boolean)
  let current = ''
  for (const part of parts) {
    current += `/${part}`
    await new Promise<void>((resolve) => sftp.mkdir(current, () => resolve()))
  }
}

async function upload(sftp: SFTPWrapper, local: string, remote: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stream = sftp.createWriteStream(remote)
    stream.on('close', () => resolve())
    stream.on('error', reject)
    stream.end(readFileSync(local))
  })
}

export async function executeSshDeployment(context: SshDeployContext, secret: Record<string, unknown> | null): Promise<SshDeployResult> {
  if (!secret) throw new Error('凭据不可用或已停用')
  const address = parseTarget(context.targetRef)
  if (!context.profile.hostKeyFingerprint) throw new Error('SSH 目标未固定 Host Key')
  const releaseDir = posix.join(address.path, 'releases', context.deploymentId)
  const hashes: Array<{ name: string; hash: string }> = []
  for (const artifact of context.artifacts) {
    if (!artifact.uri || !existsSync(artifact.uri)) throw new Error(`制品缺少真实文件：${artifact.name}`)
    const hash = createHash('sha256').update(readFileSync(artifact.uri)).digest('hex')
    if (hash !== artifact.contentHash) throw new Error(`制品哈希不一致：${artifact.name}`)
    hashes.push({ name: artifact.name, hash })
  }

  const client = new Client()
  let observedHostKey: string | null = null
  const connected = new Promise<void>((resolve, reject) => {
    client.on('ready', resolve)
    client.on('error', (error: Error & { level?: string }) => reject(new Error(error.level === 'client-authentication' ? 'SSH 身份验证失败' : error.message)))
    client.connect({
      host: context.profile.host,
      port: context.profile.port,
      username: context.profile.username,
      readyTimeout: context.profile.connectTimeoutMs,
      ...(context.profile.authType === 'password' ? { password: String(secret.password ?? '') } : {}),
      ...(context.profile.authType === 'private_key' ? { privateKey: String(secret.privateKey ?? ''), passphrase: secret.passphrase ? String(secret.passphrase) : undefined } : {}),
      hostVerifier: (key: Buffer) => {
        observedHostKey = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
        if (observedHostKey !== context.profile.hostKeyFingerprint) {
          reject(new Error('主机指纹与审批快照不一致，已拒绝连接'))
          return false
        }
        return true
      },
    })
  })

  try {
    await connected
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => client.sftp((error, value) => error ? reject(error) : resolve(value)))
    await mkdirRecursive(sftp, releaseDir)
    for (const artifact of context.artifacts) {
      const safeName = posix.basename(artifact.name).replace(/[^A-Za-z0-9._-]/g, '_')
      await upload(sftp, artifact.uri!, posix.join(releaseDir, safeName))
      const remoteHash = (await exec(client, `sha256sum '${posix.join(releaseDir, safeName)}'`)).trim().split(/\s+/)[0]
      if (remoteHash !== artifact.contentHash) throw new Error(`远端制品哈希不一致：${artifact.name}`)
    }
    await exec(client, `docker rm -f ${address.container} >/dev/null 2>&1 || true`)
    await exec(client, `docker run -d --name ${address.container} -p 127.0.0.1:${address.healthPort}:80 -v ${releaseDir}:/usr/share/nginx/html:ro --restart unless-stopped ${address.image}`)
    const health = (await exec(client, `curl -fsS http://127.0.0.1:${address.healthPort}/health`)).trim()
    const healthOk = health.includes('ok')
    const manifestHash = createHash('sha256').update(JSON.stringify(hashes)).digest('hex')
    return {
      status: healthOk ? 'succeeded' : 'failed',
      externalId: `ssh:${address.container}:${context.deploymentId}`,
      artifactHash: manifestHash,
      receipt: { adapter: 'ssh2', host: `${context.profile.username}@${context.profile.host}:${context.profile.port}`, releaseDir, container: address.container, healthPort: address.healthPort, manifestHash, artifacts: hashes, healthBody: health, hostKey: observedHostKey },
      notes: healthOk ? 'SSH 远端部署完成，HTTP 健康检查通过' : 'SSH 远端部署完成，但健康检查未通过',
      health: { ok: healthOk, detail: healthOk ? '远端 /health 返回 ok' : '远端 /health 未返回预期内容' },
    }
  } finally {
    client.end()
  }
}
