import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
  assurance: 'source_observed' | 'independently_reproduced' | 'externally_confirmed'
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
      deployedAt: Date.now(),
    }
    writeFileSync(join(releaseDir, 'deployment-receipt.json'), JSON.stringify(receipt, null, 2))
    const healthFile = join(context.targetPath, 'health.json')
    const health = {
      ok: existsSync(releaseDir) && existsSync(join(releaseDir, 'deployment-receipt.json')),
      detail: '本地制品目录与回执可读',
    }
    writeFileSync(healthFile, JSON.stringify({ ...health, deploymentId: context.deploymentId, checkedAt: Date.now() }, null, 2))
    return {
      externalId: `local-${context.deploymentId}`,
      status: health.ok ? 'succeeded' : 'failed',
      assurance: 'independently_reproduced',
      artifactHash: manifestHash,
      receipt,
      health,
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
  new ReadOnlyRemoteAdapter('pipeline', 'CI/CD Pipeline'),
  new ReadOnlyRemoteAdapter('kubernetes', 'Kubernetes Direct'),
  new ReadOnlyRemoteAdapter('gitops', 'GitOps'),
  new ReadOnlyRemoteAdapter('ssh', 'SSH / VPS'),
]
