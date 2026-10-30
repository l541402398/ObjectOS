import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  AppError,
  OrganizationApiSchemas,
  WorkerInternalSchemas,
  WorkerGrantInputSchema,
  WorkerServerListSchema,
  type LocalWorkerGrant,
  type WorkerInternalScope,
  type WorkerDesktopList,
} from '@projectos/contracts'

export const StoredWorkerSchema = z.object({
  serverUrl: z.string(),
  organizationId: z.string(),
  accountId: z.string(),
  instanceId: z.uuid(),
  registrationId: z.uuid(),
  secret: z.string().regex(/^[A-Za-z0-9_-]{64}$/),
  name: z.string(),
})
export type StoredWorker = z.infer<typeof StoredWorkerSchema>
export interface OrganizationWorkerPorts {
  runtime: (method: string, input: unknown) => Promise<unknown>
  confirm: (grant: LocalWorkerGrant, projectName: string, organizationName: string) => Promise<boolean>
}
export interface WorkerHost {
  scope: WorkerInternalScope
  organizationName: string
  assertCurrent: () => void
  request: (
    path: string,
    method?: string,
    body?: unknown,
    secret?: string,
    proof?: string,
  ) => Promise<unknown>
  credential: () => StoredWorker | undefined
  persist: (worker: StoredWorker) => void
}
type WorkerMethod =
  | 'organization.workers'
  | 'organization.enrollWorker'
  | 'organization.changeWorker'
  | 'organization.grantWorker'
  | 'organization.revokeWorkerGrant'
export const isWorkerMethod = (method: string): method is WorkerMethod =>
  [
    'organization.workers',
    'organization.enrollWorker',
    'organization.changeWorker',
    'organization.grantWorker',
    'organization.revokeWorkerGrant',
  ].includes(method)

/** Main orchestrates consent; Runtime alone persists local facts. No method here launches work. */
export class OrganizationWorkerBridge {
  constructor(private readonly ports: OrganizationWorkerPorts) {}
  private async runtime<M extends keyof typeof WorkerInternalSchemas>(
    host: WorkerHost,
    method: M,
    input: unknown,
  ) {
    host.assertCurrent()
    const result = WorkerInternalSchemas[method].output.parse(
      await this.ports.runtime(method, WorkerInternalSchemas[method].input.parse(input)),
    )
    host.assertCurrent()
    return result
  }
  private prefix(host: WorkerHost) {
    return `/v1/organizations/${encodeURIComponent(host.scope.organizationId)}/workers`
  }
  private async local(host: WorkerHost) {
    return WorkerInternalSchemas['runtime.worker.context'].output.parse(
      await this.runtime(host, 'runtime.worker.context', host.scope),
    )
  }
  private async heartbeat(host: WorkerHost) {
    const credential = host.credential()
    if (!credential) return
    const local = await this.local(host)
    if (local.instanceId !== credential.instanceId) return
    await host.request(
      `${this.prefix(host)}/${credential.registrationId}/heartbeat`,
      'POST',
      {},
      credential.secret,
    )
  }
  async sync(host: WorkerHost) {
    const local = await this.local(host)
    for (const grant of local.grants.filter((g) => g.status === 'revoked' && !g.remoteSynced)) {
      try {
        await host.request(`${this.prefix(host)}/grants/${grant.id}`, 'DELETE')
        await this.runtime(host, 'runtime.worker.synced', { id: grant.id })
      } catch {
        host.assertCurrent() /* Local revoke remains effective and durably pending. */
      }
    }
    try {
      await this.heartbeat(host)
    } catch {
      host.assertCurrent()
    }
  }
  private async view(host: WorkerHost): Promise<WorkerDesktopList> {
    const remote = WorkerServerListSchema.parse(await host.request(this.prefix(host)))
    const credential = host.credential()
    let local = await this.local(host)
    const currentWorkerId = credential?.instanceId === local.instanceId ? credential.registrationId : null
    // Remote revoke/removal must not leave a misleading local consent badge after refresh.
    for (const grant of local.grants.filter((g) => g.status === 'active')) {
      const worker = remote.workers.find((w) => w.id === grant.workerId)
      const shared = remote.grants.find((g) => g.id === grant.id)
      if (
        !worker ||
        ['paused', 'revoked', 'session_expired'].includes(worker.status) ||
        !shared ||
        ['revoked', 'unavailable', 'expired'].includes(shared.status)
      )
        await this.runtime(host, 'runtime.worker.revoke', { id: grant.id })
    }
    local = await this.local(host)
    return { ...remote, currentWorkerId, local }
  }
  async execute(host: WorkerHost, method: WorkerMethod, raw: unknown): Promise<unknown> {
    const input = OrganizationApiSchemas[method].input.parse(raw)
    const credential = host.credential()
    if (method === 'organization.workers') {
      await this.sync(host)
      return this.view(host)
    }
    if (method === 'organization.enrollWorker') {
      const { name } = OrganizationApiSchemas[method].input.parse(input),
        local = await this.local(host)
      const current = WorkerServerListSchema.parse(await host.request(this.prefix(host))).workers.find(
        (w) => w.id === credential?.registrationId,
      )
      if (credential && credential.instanceId !== local.instanceId)
        throw new AppError('CONFLICT', '本机数据库已更换。请先撤销原设备登记，再重新连接账号。')
      const worker: StoredWorker =
        credential && current?.state !== 'revoked'
          ? { ...credential, name }
          : {
              ...host.scope,
              instanceId: local.instanceId,
              registrationId: randomUUID(),
              secret: randomBytes(48).toString('base64url'),
              name,
            }
      // Persist before POST: an unknown response can only retry this id and proof.
      host.persist(worker)
      await host.request(this.prefix(host), 'POST', {
        registrationId: worker.registrationId,
        instanceId: worker.instanceId,
        name,
        platform: process.platform,
        protocol: 'local-worker/1',
        secret: worker.secret,
      })
      await this.sync(host)
      return this.view(host)
    }
    if (method === 'organization.changeWorker') {
      const change = OrganizationApiSchemas[method].input.parse(input)
      if (change.workerId === credential?.registrationId && change.state !== 'active') {
        await this.runtime(host, 'runtime.worker.clear', host.scope)
      }
      await host.request(
        this.prefix(host) + '/state',
        'POST',
        change,
        undefined,
        change.state === 'active' && change.workerId === credential?.registrationId
          ? credential.secret
          : undefined,
      )
      await this.sync(host)
      return this.view(host)
    }
    if (method === 'organization.revokeWorkerGrant') {
      const { grantId } = OrganizationApiSchemas[method].input.parse(input),
        local = await this.local(host)
      if (!local.grants.some((g) => g.id === grantId))
        throw new AppError('FORBIDDEN', '此授权不属于当前本机账号。')
      await this.runtime(host, 'runtime.worker.revoke', { id: grantId })
      let remoteSynced = false
      try {
        await host.request(`${this.prefix(host)}/grants/${grantId}`, 'DELETE')
        await this.runtime(host, 'runtime.worker.synced', { id: grantId })
        remoteSynced = true
      } catch {
        host.assertCurrent()
      }
      return { ok: true, remoteSynced }
    }
    const request = OrganizationApiSchemas['organization.grantWorker'].input.parse(input)
    if (!credential) throw new AppError('BAD_REQUEST', '请先登记此设备。')
    await this.heartbeat(host)
    const current = await this.view(host)
    const device = current.workers.find((w) => w.id === credential.registrationId)
    if (
      current.local.instanceId !== credential.instanceId ||
      !device ||
      device.state !== 'active' ||
      device.status === 'session_expired'
    )
      throw new AppError('FORBIDDEN', '当前设备不可授权，请先恢复设备连接。')
    // The shared project name/role is fetched by Main, not trusted from the form.
    const projects = OrganizationApiSchemas['organization.projects'].output.parse(
      await host.request(`/v1/organizations/${encodeURIComponent(host.scope.organizationId)}/projects`),
    ).projects
    const project = projects.find((p) => p.id === request.projectId)
    if (!project || !['owner', 'maintainer', 'contributor'].includes(project.role))
      throw new AppError('FORBIDDEN', '你没有此共享项目的执行授权权限。')
    const grant = WorkerInternalSchemas['runtime.worker.prepare'].output.parse(
      await this.runtime(host, 'runtime.worker.prepare', {
        ...host.scope,
        workerId: credential.registrationId,
        request,
      }),
    )
    let nativeDeclined = false,
      requestStarted = false
    try {
      const confirmed = await this.ports.confirm(grant, project.name, host.organizationName)
      nativeDeclined = !confirmed
      host.assertCurrent()
      if (!confirmed) throw new AppError('CANCELLED', '已取消本机项目授权。')
      await this.runtime(host, 'runtime.worker.confirm', { id: grant.id, scopeDigest: grant.scopeDigest })
      // An uncertain POST is never treated as a granted local capability.
      const upload = WorkerGrantInputSchema.parse({
        id: grant.id,
        projectId: grant.projectId,
        workspaceRef: grant.workspaceRef,
        scope: grant.scope,
        scopeDigest: grant.scopeDigest,
        expiresAt: grant.expiresAt,
      })
      requestStarted = true
      await host.request(
        `${this.prefix(host)}/${credential.registrationId}/grants`,
        'POST',
        upload,
        credential.secret,
      )
      await this.runtime(host, 'runtime.worker.activate', { id: grant.id, scopeDigest: grant.scopeDigest })
    } catch (error) {
      // Runtime revoke does not depend on the old UI context still being active.
      await this.ports.runtime('runtime.worker.revoke', { id: grant.id }).catch(() => undefined)
      if (nativeDeclined || !requestStarted) {
        await this.ports.runtime('runtime.worker.synced', { id: grant.id }).catch(() => undefined)
      }
      throw error
    }
    await this.sync(host)
    return this.view(host)
  }
}
