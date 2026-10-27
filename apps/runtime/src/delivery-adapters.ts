import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export interface DeliveryAdapterCapabilities {
  inspect: boolean
  execute: boolean
  observe: boolean
  logs: boolean
  health: boolean
  rollback: boolean
  cancel: boolean
  reconcile: boolean
}

export interface DeliveryArtifact {
  name: string
  uri: string | null
  contentHash: string
}

export interface DeliveryExecutionContext {
  deploymentId: string
  targetPath: string
  artifacts: DeliveryArtifact[]
}

export interface DeliveryExecutionResult {
  externalId: string
  status: 'succeeded' | 'failed' | 'needs_reconciliation'
  assurance: 'self_declared' | 'source_observed' | 'independently_reproduced' | 'externally_confirmed'
  artifactHash: string | null
  receipt: Record<string, unknown>
  health: { ok: boolean; detail: string }
}

export interface DeliveryAdapter {
  readonly type: string
  readonly label: string
  readonly capabilities: DeliveryAdapterCapabilities
  inspect(targetPath: string): Promise<{ ok: boolean; detail: string }>
  execute(context: DeliveryExecutionContext): Promise<DeliveryExecutionResult>
}

const execFileAsync = promisify(execFile)

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Real local filesystem delivery adapter used for isolated integration tests and
 * approved local targets. It copies the frozen release artifacts, verifies every
 * declared SHA-256, writes a receipt and performs a deterministic health check.
 * It never executes a shell and never touches a remote system.
 */
export class LocalArtifactAdapter implements DeliveryAdapter {
  readonly type = 'local-artifact'
  readonly label = 'Local Artifact'
  readonly capabilities: DeliveryAdapterCapabilities = {
    inspect: true,
    execute: true,
    observe: true,
    logs: false,
    health: true,
    rollback: false,
    cancel: false,
    reconcile: false,
  }

  async inspect(targetPath: string): Promise<{ ok: boolean; detail: string }> {
    return existsSync(targetPath)
      ? { ok: true, detail: `目标目录可访问：${targetPath}` }
      : { ok: false, detail: `目标目录不存在：${targetPath}` }
  }

  async execute(context: DeliveryExecutionContext): Promise<DeliveryExecutionResult> {
    if (!context.artifacts.length) throw new Error('没有可部署的冻结制品')
    if (!context.targetPath.trim()) throw new Error('部署目标缺少本地目录')
    const releaseDir = join(context.targetPath, 'versions', context.deploymentId)
    mkdirSync(releaseDir, { recursive: true })
    const hashes: Array<{ name: string; hash: string }> = []
    for (const artifact of context.artifacts) {
      if (!artifact.uri || !existsSync(artifact.uri)) {
        throw new Error(`制品缺少真实文件：${artifact.name}`)
      }
      const actual = sha256File(artifact.uri)
      if (actual !== artifact.contentHash) {
        throw new Error(`制品哈希不一致：${artifact.name}`)
      }
      const destination = join(releaseDir, artifact.name.replace(/[\\/:*?"<>|]/g, '_'))
      writeFileSync(destination, readFileSync(artifact.uri))
      hashes.push({ name: artifact.name, hash: actual })
    }
    const manifestHash = createHash('sha256').update(JSON.stringify(hashes)).digest('hex')
    const receipt = {
      adapter: this.type,
      targetPath: releaseDir,
      manifestHash,
      artifacts: hashes,
      artifactDelivered: true,
      serviceHealthVerified: false,
      deployedAt: Date.now(),
    }
    // File delivery is not service health. Keep assurance self_declared so this
    // record can never become the environment's verified current release.
    writeFileSync(join(releaseDir, 'delivery-receipt.json'), JSON.stringify(receipt, null, 2))
    return {
      externalId: `local-${context.deploymentId}`,
      status: 'succeeded',
      assurance: 'self_declared',
      artifactHash: manifestHash,
      receipt,
      health: { ok: false, detail: '制品已交付并校验哈希；未启动服务，未验证健康' },
    }
  }
}

/**
 * Controlled SSH/VPS adapter for a single isolated static application. It uses
 * a fixed deployment layout, Docker container and health endpoint. It never
 * exposes a general-purpose shell: commands and paths are validated.
 */
export class SshArtifactAdapter implements DeliveryAdapter {
  readonly type = 'ssh-artifact'
  readonly label = 'SSH / VPS'
  readonly capabilities: DeliveryAdapterCapabilities = {
    inspect: true,
    execute: true,
    observe: true,
    logs: false,
    health: true,
    rollback: false,
    cancel: false,
    reconcile: false,
  }

  private connection(ref: string) {
    const url = new URL(ref)
    if (url.protocol !== 'ssh:') throw new Error('SSH 目标必须是 ssh:// 地址')
    const host = url.hostname
    const user = decodeURIComponent(url.username || 'root')
    const port = url.port || '22'
    const remotePath = decodeURIComponent(url.pathname)
    if (!/^\/opt\/projectos-[a-z0-9/_-]+$/.test(remotePath) || remotePath.includes('..')) {
      throw new Error('远程目录必须位于 /opt/projectos-* 隔离目录')
    }
    const container = url.searchParams.get('container') || 'projectos-delivery-test'
    if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(container)) throw new Error('容器名不合法')
    const healthPort = Number(url.searchParams.get('healthPort') || '18080')
    if (!Number.isInteger(healthPort) || healthPort < 1024 || healthPort > 65535) throw new Error('健康检查端口不合法')
    const image = url.searchParams.get('image') || 'nginx:alpine'
    if (!/^[a-z0-9][a-z0-9./:_-]*$/i.test(image)) throw new Error('镜像名不合法')
    const keyPath = process.env.PROJECTOS_DEPLOY_SSH_KEY
    if (!keyPath || !existsSync(keyPath)) throw new Error('未配置 SSH 部署密钥')
    const knownHosts = process.env.PROJECTOS_DEPLOY_SSH_KNOWN_HOSTS || ''
    return { host, user, port, remotePath, container, healthPort, image, keyPath, knownHosts }
  }

  private async sshArgs(conn: ReturnType<SshArtifactAdapter['connection']>, command: string[]): Promise<Buffer> {
    const common = [
      '-p', conn.port,
      '-i', conn.keyPath,
      '-o', 'BatchMode=yes',
      '-o', 'IdentitiesOnly=yes',
      '-o', 'StrictHostKeyChecking=yes',
      ...(conn.knownHosts ? ['-o', `UserKnownHostsFile=${conn.knownHosts}`] : []),
      `${conn.user}@${conn.host}`,
      ...command,
    ]
    const { stdout } = await execFileAsync('ssh', common, { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 })
    return Buffer.from(stdout)
  }

  private async scpArgs(conn: ReturnType<SshArtifactAdapter['connection']>, source: string, destination: string): Promise<void> {
    await execFileAsync(
      'scp',
      [
        '-P', conn.port,
        '-i', conn.keyPath,
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=yes',
        ...(conn.knownHosts ? ['-o', `UserKnownHostsFile=${conn.knownHosts}`] : []),
        source,
        `${conn.user}@${conn.host}:${destination}`,
      ],
      { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 },
    )
  }

  async inspect(ref: string): Promise<{ ok: boolean; detail: string }> {
    const conn = this.connection(ref)
    const output = (await this.sshArgs(conn, ['test', '-d', conn.remotePath, '&&', 'echo', 'SSH_TARGET_OK'])).toString()
    return { ok: output.includes('SSH_TARGET_OK'), detail: `SSH 目标可访问：${conn.host}:${conn.port}` }
  }

  async execute(context: DeliveryExecutionContext): Promise<DeliveryExecutionResult> {
    if (!context.artifacts.length) throw new Error('没有可部署的冻结制品')
    const conn = this.connection(context.targetPath)
    const remoteRelease = `${conn.remotePath}/releases/${context.deploymentId}`
    const healthArtifact = context.artifacts.find((artifact) => basename(artifact.name) === 'health')
    if (!healthArtifact) throw new Error('SSH 部署需要名为 health 的健康文件')
    await this.sshArgs(conn, ['mkdir', '-p', remoteRelease])
    const hashes: Array<{ name: string; hash: string }> = []
    for (const artifact of context.artifacts) {
      if (!artifact.uri || !existsSync(artifact.uri)) throw new Error(`制品缺少真实文件：${artifact.name}`)
      const safeName = basename(artifact.name).replace(/[^A-Za-z0-9._-]/g, '_')
      const actual = sha256File(artifact.uri)
      if (actual !== artifact.contentHash) throw new Error(`制品哈希不一致：${artifact.name}`)
      await this.scpArgs(conn, artifact.uri, `${remoteRelease}/${safeName}`)
      const remoteHash = (await this.sshArgs(conn, ['sha256sum', `${remoteRelease}/${safeName}`])).toString().split(/\s+/)[0]
      if (remoteHash !== actual) throw new Error(`远程制品哈希不一致：${artifact.name}`)
      hashes.push({ name: safeName, hash: actual })
    }
    try {
      await this.sshArgs(conn, ['docker', 'rm', '-f', conn.container])
    } catch {
      // No previous isolated container is a valid first deployment.
    }
    await this.sshArgs(conn, [
      'docker', 'run', '-d', '--name', conn.container,
      '-p', `127.0.0.1:${conn.healthPort}:80`,
      '-v', `${remoteRelease}:/usr/share/nginx/html:ro`,
      '--restart', 'unless-stopped',
      conn.image,
    ])
    const health = (await this.sshArgs(conn, ['curl', '-fsS', `http://127.0.0.1:${conn.healthPort}/health`])).toString()
    const healthOk = health.includes('ok')
    const manifestHash = createHash('sha256').update(JSON.stringify(hashes)).digest('hex')
    const receipt = {
      adapter: this.type,
      host: `${conn.user}@${conn.host}:${conn.port}`,
      remoteRelease,
      container: conn.container,
      image: conn.image,
      healthPort: conn.healthPort,
      manifestHash,
      artifacts: hashes,
      healthBody: health.slice(0, 500),
      deployedAt: Date.now(),
    }
    return {
      externalId: `ssh:${conn.container}:${context.deploymentId}`,
      status: healthOk ? 'succeeded' : 'failed',
      assurance: 'externally_confirmed',
      artifactHash: manifestHash,
      receipt,
      health: { ok: healthOk, detail: healthOk ? 'SSH 目标 /health 返回 ok' : 'SSH 目标 /health 未返回预期内容' },
    }
  }
}

/** Capability-only adapters: they are intentionally not executable in Phase 2.2. */
export class ReadOnlyRemoteAdapter implements DeliveryAdapter {
  readonly capabilities: DeliveryAdapterCapabilities = {
    inspect: true,
    execute: false,
    observe: true,
    logs: false,
    health: false,
    rollback: false,
    cancel: false,
    reconcile: false,
  }
  readonly label: string
  constructor(readonly type: string, label: string) {
    this.label = label
  }
  async inspect(): Promise<{ ok: boolean; detail: string }> {
    return { ok: false, detail: '未配置远程连接；仅保留只读适配器契约' }
  }
  async execute(): Promise<DeliveryExecutionResult> {
    throw new Error('该适配器未配置可执行连接，不能伪造部署')
  }
}

export const DELIVERY_ADAPTERS: DeliveryAdapter[] = [
  new LocalArtifactAdapter(),
  new SshArtifactAdapter(),
  new ReadOnlyRemoteAdapter('pipeline', 'CI/CD Pipeline'),
  new ReadOnlyRemoteAdapter('kubernetes', 'Kubernetes Direct'),
  new ReadOnlyRemoteAdapter('gitops', 'GitOps'),
]
