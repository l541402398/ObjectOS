import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { posix } from 'node:path'
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

export interface SshDeployStep {
  phase: string
  status: 'started' | 'ok' | 'failed' | 'skipped'
  detail: string
  remoteRef?: string | null
  durationMs?: number | null
}

/**
 * Raised when a remote command fails. `remoteMutated` tells the caller whether the
 * target may already have changed, so the deployment can move to
 * needs_reconciliation instead of being recorded as a plain failure.
 */
export class SshDeployError extends Error {
  constructor(
    message: string,
    readonly remoteMutated: boolean,
    readonly phase: string,
  ) {
    super(message)
    this.name = 'SshDeployError'
  }
}

interface TargetAddress {
  path: string
  container: string
  healthPort: number
  image: string
}

const COMMAND_TIMEOUT_MS = 90_000

export function parseTarget(ref: string): TargetAddress {
  const url = new URL(ref)
  const path = decodeURIComponent(url.pathname)
  if (!/^\/opt\/projectos-[a-z0-9/_-]+$/.test(path)) throw new SshDeployError('远程目录必须位于 /opt/projectos-* 隔离目录', false, 'validate')
  const container = url.searchParams.get('container') || 'projectos-delivery-test'
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(container)) throw new SshDeployError('容器名不合法', false, 'validate')
  const healthPort = Number(url.searchParams.get('healthPort') || '18080')
  if (!Number.isInteger(healthPort) || healthPort < 1024 || healthPort > 65535) throw new SshDeployError('健康检查端口不合法', false, 'validate')
  const image = url.searchParams.get('image') || 'nginx:alpine'
  if (!/^[a-z0-9][a-z0-9./:_-]*$/i.test(image)) throw new SshDeployError('镜像名不合法', false, 'validate')
  return { path, container, healthPort, image }
}

function connect(profile: ConnectionProfile, secret: Record<string, unknown>): { client: Client; ready: Promise<void>; observedHostKey: () => string | null } {
  const client = new Client()
  let observedHostKey: string | null = null
  const ready = new Promise<void>((resolve, reject) => {
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    client.on('ready', () => {
      if (settled) return
      settled = true
      resolve()
    })
    client.on('error', (error: Error & { level?: string }) =>
      fail(new SshDeployError(error.level === 'client-authentication' ? 'SSH 身份验证失败' : error.message, false, 'connect')),
    )
    client.connect({
      host: profile.host,
      port: profile.port,
      username: profile.username,
      readyTimeout: profile.connectTimeoutMs,
      ...(profile.authType === 'password' ? { password: String(secret.password ?? '') } : {}),
      ...(profile.authType === 'private_key'
        ? { privateKey: String(secret.privateKey ?? ''), passphrase: secret.passphrase ? String(secret.passphrase) : undefined }
        : {}),
      hostVerifier: (key: Buffer) => {
        observedHostKey = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
        if (observedHostKey !== profile.hostKeyFingerprint) {
          fail(new SshDeployError('主机指纹与审批快照不一致，已拒绝连接', false, 'host-key'))
          return false
        }
        return true
      },
    })
  })
  return { client, ready, observedHostKey: () => observedHostKey }
}

function exec(client: Client, command: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new SshDeployError(`远程命令超时（${Math.round(timeoutMs / 1000)}s）：${command.slice(0, 120)}`, true, 'exec'))
    }, timeoutMs)
    const done = (error: Error | null, value?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value ?? '')
    }
    client.exec(command, (error, stream) => {
      if (error) return done(error)
      let stdout = ''
      let stderr = ''
      stream.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      stream.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      stream.on('close', (code: number) => {
        if (code !== 0) done(new SshDeployError(stderr.trim() || `远程命令退出码 ${code}`, false, 'exec'))
        else done(null, stdout)
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
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new SshDeployError(`SFTP 上传超时：${remote}`, true, 'upload'))
    }, COMMAND_TIMEOUT_MS)
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const stream = sftp.createWriteStream(remote)
    stream.on('close', () => finish())
    stream.on('error', (error: Error) => finish(error))
    stream.end(readFileSync(local))
  })
}

async function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise<SFTPWrapper>((resolve, reject) => client.sftp((error, value) => (error ? reject(error) : resolve(value))))
}

/** Waits for the container health endpoint; nginx needs a moment after start. */
async function waitForHealth(client: Client, url: string, attempts = 10, delayMs = 700): Promise<string> {
  let last = ''
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const body = (await exec(client, `curl -fsS --max-time 5 ${url}`, 15_000)).trim()
      if (body) return body
      last = body
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  return last
}

export async function executeSshDeployment(
  context: SshDeployContext,
  secret: Record<string, unknown> | null,
  onStep?: (step: SshDeployStep) => void,
): Promise<SshDeployResult> {
  const step = (value: SshDeployStep): void => {
    try {
      onStep?.(value)
    } catch {
      /* progress reporting must never break the deploy */
    }
  }
  if (!secret) throw new SshDeployError('凭据不可用或已停用', false, 'credential')
  const address = parseTarget(context.targetRef)
  if (!context.profile.hostKeyFingerprint) throw new SshDeployError('SSH 目标未固定 Host Key', false, 'host-key')
  const releaseDir = posix.join(address.path, 'releases', context.deploymentId)
  const hashes: Array<{ name: string; hash: string }> = []
  for (const artifact of context.artifacts) {
    if (!artifact.uri || !existsSync(artifact.uri)) throw new SshDeployError(`制品缺少真实文件：${artifact.name}`, false, 'verify-local')
    const hash = createHash('sha256').update(readFileSync(artifact.uri)).digest('hex')
    if (hash !== artifact.contentHash) throw new SshDeployError(`制品哈希不一致：${artifact.name}`, false, 'verify-local')
    hashes.push({ name: artifact.name, hash })
  }
  step({ phase: 'verify-local', status: 'ok', detail: `本地校验 ${hashes.length} 个制品` })

  const { client, ready, observedHostKey } = connect(context.profile, secret)
  let remoteMutated = false
  let phase = 'connect'
  try {
    step({ phase: 'connect', status: 'started', detail: `${context.profile.host}:${context.profile.port}` })
    await ready
    step({ phase: 'connect', status: 'ok', detail: 'SSH 连接建立，Host Key 已固定' })
    phase = 'upload'
    const sftp = await openSftp(client)
    await mkdirRecursive(sftp, releaseDir)
    for (const artifact of context.artifacts) {
      const safeName = posix.basename(artifact.name).replace(/[^A-Za-z0-9._-]/g, '_')
      const remotePath = posix.join(releaseDir, safeName)
      await upload(sftp, artifact.uri!, remotePath)
      const remoteHash = (await exec(client, `sha256sum '${remotePath}'`)).trim().split(/\s+/)[0]
      if (remoteHash !== artifact.contentHash) throw new SshDeployError(`远端制品哈希不一致：${artifact.name}`, true, 'upload')
      step({ phase: 'upload', status: 'ok', detail: `已上传并校验 ${safeName}`, remoteRef: remotePath })
    }
    phase = 'container'
    remoteMutated = true
    step({ phase: 'container', status: 'started', detail: `重建容器 ${address.container}`, remoteRef: address.container })
    await exec(client, `docker rm -f ${address.container} >/dev/null 2>&1 || true`)
    await exec(
      client,
      `docker run -d --name ${address.container} -p 127.0.0.1:${address.healthPort}:80 -v ${releaseDir}:/usr/share/nginx/html:ro --restart unless-stopped ${address.image}`,
    )
    step({ phase: 'container', status: 'ok', detail: '容器已重建', remoteRef: address.container })
    phase = 'health'
    step({ phase: 'health', status: 'started', detail: `GET 127.0.0.1:${address.healthPort}/health` })
    const health = await waitForHealth(client, `http://127.0.0.1:${address.healthPort}/health`)
    const healthOk = health.includes('ok')
    step({ phase: 'health', status: healthOk ? 'ok' : 'failed', detail: health.slice(0, 400) })
    const manifestHash = createHash('sha256').update(JSON.stringify(hashes)).digest('hex')
    return {
      status: healthOk ? 'succeeded' : 'failed',
      externalId: `ssh:${address.container}:${context.deploymentId}`,
      artifactHash: manifestHash,
      receipt: {
        adapter: 'ssh2',
        host: `${context.profile.username}@${context.profile.host}:${context.profile.port}`,
        releaseDir,
        container: address.container,
        healthPort: address.healthPort,
        manifestHash,
        artifacts: hashes,
        healthBody: health,
        hostKey: observedHostKey(),
      },
      notes: healthOk ? 'SSH 远端部署完成，HTTP 健康检查通过' : 'SSH 远端部署完成，但健康检查未通过',
      health: { ok: healthOk, detail: healthOk ? '远端 /health 返回 ok' : '远端 /health 未返回预期内容' },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const mutated = remoteMutated || (error instanceof SshDeployError && error.remoteMutated)
    throw new SshDeployError(message, mutated, error instanceof SshDeployError ? error.phase : phase)
  } finally {
    client.end()
  }
}

export interface SshObservation {
  reachable: boolean
  externalId: string | null
  healthOk: boolean
  detail: string
  facts: Record<string, unknown>
}

/**
 * Read-only reconciliation: establishes what is actually running on the target.
 * Never mutates the remote side, so it is safe to run on an unknown outcome.
 */
export async function observeSshDeployment(
  context: { deploymentId: string; targetRef: string; profile: ConnectionProfile },
  secret: Record<string, unknown> | null,
): Promise<SshObservation> {
  if (!secret) {
    return { reachable: false, externalId: null, healthOk: false, detail: '凭据不可用，无法查询远程事实', facts: {} }
  }
  let address: TargetAddress
  try {
    address = parseTarget(context.targetRef)
  } catch (error) {
    return { reachable: false, externalId: null, healthOk: false, detail: error instanceof Error ? error.message : String(error), facts: {} }
  }
  const { client, ready, observedHostKey } = connect(context.profile, secret)
  try {
    await ready
    const releaseDir = posix.join(address.path, 'releases', context.deploymentId)
    const facts: Record<string, unknown> = {}
    try {
      facts.releaseDir = (await exec(client, `ls ${releaseDir} 2>/dev/null || echo ABSENT`)).trim()
    } catch (error) {
      facts.releaseDir = error instanceof Error ? error.message : String(error)
    }
    let containerImage = ''
    let containerMount = ''
    try {
      containerImage = (await exec(client, `docker inspect ${address.container} --format '{{.Config.Image}}'`)).trim()
      containerMount = (await exec(client, `docker inspect ${address.container} --format '{{json .Mounts}}'`)).trim()
    } catch (error) {
      facts.containerError = error instanceof Error ? error.message : String(error)
    }
    let health = ''
    try {
      health = (await exec(client, `curl -fsS --max-time 5 http://127.0.0.1:${address.healthPort}/health`, 15_000)).trim()
    } catch (error) {
      health = error instanceof Error ? error.message : String(error)
    }
    facts.containerImage = containerImage
    facts.containerMount = containerMount
    facts.healthBody = health
    facts.hostKey = observedHostKey()
    const servesThisDeployment = containerMount.includes(`/releases/${context.deploymentId}`)
    const healthOk = health.includes('ok') && servesThisDeployment
    return {
      reachable: true,
      externalId: servesThisDeployment ? `ssh:${address.container}:${context.deploymentId}` : null,
      healthOk,
      detail: servesThisDeployment
        ? healthOk
          ? '远端容器正在提供本次部署的 Release，/health 通过'
          : '远端容器指向本次 Release，但 /health 未通过'
        : '远端容器未指向本次部署的 Release',
      facts,
    }
  } catch (error) {
    return {
      reachable: false,
      externalId: null,
      healthOk: false,
      detail: error instanceof Error ? error.message : String(error),
      facts: {},
    }
  } finally {
    client.end()
  }
}
