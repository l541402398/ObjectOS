import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { DesktopSessionSchema } from '@projectos/organization-contracts'
import {
  AppError,
  OrganizationApiSchemas,
  OrganizationConnectionViewSchema,
  OrganizationSessionViewSchema,
  type OrganizationConnectionView,
  WorkerInternalSchemas,
} from '@projectos/contracts'
import { DesktopLoginError, runDesktopLogin } from './desktop-login-core.js'
import {
  OrganizationWorkerBridge,
  StoredWorkerSchema,
  isWorkerMethod,
  type OrganizationWorkerPorts,
  type WorkerHost,
} from './organization-worker.js'

interface SecureCodec {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
const StoredConnection = z.object({
  serverUrl: z.string(),
  session: DesktopSessionSchema,
  activeOrganizationId: z.string().nullable(),
  invalidated: z.boolean().default(false),
})
const Vault = z.object({
  version: z.literal(1),
  connection: StoredConnection.nullable(),
  pendingRevocations: z
    .array(z.object({ serverUrl: z.string(), token: z.string().min(32), expiresAt: z.number() }))
    .max(20),
  workers: z.array(StoredWorkerSchema).max(100).default([]),
  pendingWorkerClears: z.array(WorkerInternalSchemas['runtime.worker.clear'].input).max(500).default([]),
})
type StoredVault = z.infer<typeof Vault>
type Connection = z.infer<typeof StoredConnection>
type OrganizationMethod = keyof typeof OrganizationApiSchemas
interface Snapshot {
  connection: Connection
  generation: number
}
const emptyVault = (): StoredVault => ({
  version: 1,
  connection: null,
  pendingRevocations: [],
  workers: [],
  pendingWorkerClears: [],
})

export function organizationOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AppError('BAD_REQUEST', '请输入有效的组织服务地址。')
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
  ) {
    throw new AppError('BAD_REQUEST', '组织服务需使用 HTTPS；本机测试可使用 HTTP 回环地址。')
  }
  return url.origin
}

/** Main-only connection. Commit an encrypted snapshot before changing the live state. */
export class OrganizationConnection {
  private readonly path: string
  private vault = emptyVault()
  private login: AbortController | null = null
  private generation = 0
  private offline = false
  private contextChanging = false
  private revocationPass: Promise<void> | null = null
  private readonly workerBridge?: OrganizationWorkerBridge
  private workerChanging = false
  private workerQueue: Promise<void> = Promise.resolve()
  private workerPending = 0
  private workerClearPass: Promise<void> | null = null

  constructor(
    dataDir: string,
    private readonly codec: SecureCodec,
    private readonly openExternal: (url: string) => Promise<void>,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly workerPorts?: OrganizationWorkerPorts,
  ) {
    this.workerBridge = workerPorts ? new OrganizationWorkerBridge(workerPorts) : undefined
    this.path = join(dataDir, 'organization-session.vault')
    if (existsSync(this.path) && codec.isEncryptionAvailable()) {
      try {
        const loaded = Vault.parse(JSON.parse(codec.decryptString(readFileSync(this.path))))
        if (loaded.connection) {
          loaded.connection.serverUrl = organizationOrigin(loaded.connection.serverUrl)
          this.publicValue(
            OrganizationSessionViewSchema.parse(loaded.connection.session),
            loaded.connection.session.token,
          )
          if (
            !loaded.connection.session.organizations.some(
              (item) => item.id === loaded.connection!.activeOrganizationId,
            )
          )
            loaded.connection.activeOrganizationId = null
        }
        loaded.pendingRevocations.forEach((item) => {
          item.serverUrl = organizationOrigin(item.serverUrl)
        })
        this.vault = loaded
      } catch {
        /* Unreadable credentials never become a valid session. */
      }
    }
  }

  private commit(next: StoredVault, contextChanged = false): void {
    const temp = `${this.path}.${randomUUID()}.tmp`
    try {
      if (!this.codec.isEncryptionAvailable()) throw new Error('unavailable')
      const parsed = Vault.parse(next)
      const bytes = this.codec.encryptString(JSON.stringify(parsed))
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(temp, bytes, { mode: 0o600 })
      renameSync(temp, this.path)
      this.vault = parsed
      if (contextChanged) this.generation++
    } catch {
      try {
        rmSync(temp, { force: true })
      } catch {
        /* Only encrypted bytes can remain. */
      }
      throw new AppError('SECRET_STORAGE_UNAVAILABLE', '无法安全保存组织会话，本次连接变更未生效。')
    }
  }

  private publicValue<T>(value: T, token?: string): T {
    const serialized = JSON.stringify(value)
    if (
      (token && serialized.includes(token)) ||
      this.vault.workers.some((w) => serialized.includes(w.secret))
    )
      throw new AppError('BAD_REQUEST', '组织服务返回了无效的数据。')
    return value
  }

  private view(): OrganizationConnectionView {
    const connection = this.vault.connection
    return this.publicValue(
      OrganizationConnectionViewSchema.parse({
        status: !connection
          ? 'local'
          : connection.invalidated || connection.session.expiresAt <= Date.now()
            ? 'expired'
            : this.offline
              ? 'offline'
              : 'connected',
        serverUrl: connection?.serverUrl ?? null,
        session: connection ? OrganizationSessionViewSchema.parse(connection.session) : null,
        activeOrganizationId: connection?.activeOrganizationId ?? null,
        revocationPending: this.vault.pendingRevocations.length > 0,
      }),
      connection?.session.token,
    )
  }

  private snapshot(): Snapshot {
    const connection = this.vault.connection
    if (!connection || connection.invalidated || connection.session.expiresAt <= Date.now())
      throw new AppError('FORBIDDEN', '登录已失效，请重新连接组织。')
    return { connection, generation: this.generation }
  }

  private assertCurrent(snapshot: Snapshot): void {
    if (
      snapshot.generation !== this.generation ||
      snapshot.connection.session.token !== this.vault.connection?.session.token
    ) {
      throw new AppError('CANCELLED', '组织上下文已改变，请刷新后重试。')
    }
  }

  private async revoke(serverUrl: string, token: string): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${serverUrl}/v1/desktop/revoke`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(4_000),
      })
      return response.ok || response.status === 401
    } catch {
      return false
    }
  }

  private async revokePending(): Promise<void> {
    if (this.revocationPass) return this.revocationPass
    const pass = async () => {
      const snapshot = this.vault.pendingRevocations
      if (!snapshot.length) return
      const results = await Promise.allSettled(
        snapshot.map(
          async (item) => item.expiresAt <= Date.now() || (await this.revoke(item.serverUrl, item.token)),
        ),
      )
      const completed = new Set(
        snapshot
          .filter((_item, index) => {
            const result = results[index]
            return result?.status === 'fulfilled' && result.value
          })
          .map((item) => `${item.serverUrl}\n${item.token}`),
      )
      // Merge into the latest vault: a concurrent logout must not lose its revocation.
      const pending = this.vault.pendingRevocations.filter(
        (item) => !completed.has(`${item.serverUrl}\n${item.token}`),
      )
      if (pending.length !== this.vault.pendingRevocations.length) {
        try {
          this.commit({ ...this.vault, pendingRevocations: pending })
        } catch {
          /* Retain the already encrypted queue; retrying an idempotent revoke is safe. */
        }
      }
    }
    this.revocationPass = pass()
    try {
      await this.revocationPass
    } finally {
      this.revocationPass = null
    }
  }

  private async readJson(response: Response, maxBytes = 1024 * 1024): Promise<unknown> {
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new AppError('BAD_REQUEST', '组织服务返回的数据过大。')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new AppError('BAD_REQUEST', '组织服务返回了无效的数据。')
    const decoder = new TextDecoder()
    let size = 0,
      text = ''
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.length
        if (size > maxBytes) {
          await reader.cancel()
          throw new Error('oversized')
        }
        text += decoder.decode(chunk.value, { stream: true })
      }
      return JSON.parse(text + decoder.decode())
    } catch {
      throw new AppError('BAD_REQUEST', '组织服务返回了无效的数据。')
    } finally {
      reader.releaseLock()
    }
  }

  private async request(
    snapshot: Snapshot,
    path: string,
    method = 'GET',
    body?: unknown,
    maxResponseBytes = 1024 * 1024,
    workerSecret?: string,
    workerProof?: string,
  ): Promise<unknown> {
    this.assertCurrent(snapshot)
    const connection = snapshot.connection
    let response: Response
    try {
      response = await this.fetchImpl(`${connection.serverUrl}${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          authorization: `Bearer ${workerSecret ?? connection.session.token}`,
          ...(workerProof ? { 'x-worker-proof': workerProof } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      this.assertCurrent(snapshot)
      this.offline = true
      throw new AppError('RUNTIME_UNAVAILABLE', '无法连接组织服务，请检查网络后重试。', { retryable: true })
    }
    this.assertCurrent(snapshot)
    this.offline = false
    if (response.status === 401 && !workerSecret) {
      this.commit({ ...this.vault, connection: { ...connection, invalidated: true } }, true)
      throw new AppError('FORBIDDEN', '登录已失效，请重新连接组织。')
    }
    if (!response.ok) {
      // Never echo an untrusted server error body or its credentials across IPC.
      if (response.status === 403) throw new AppError('FORBIDDEN', '你没有此操作的权限。')
      if (response.status === 409) throw new AppError('CONFLICT', '当前对象已改变或已处理，请刷新后重试。')
      if (response.status === 429)
        throw new AppError('BAD_REQUEST', '操作过于频繁，请稍后重试。', { retryable: true })
      if (response.status >= 500)
        throw new AppError('RUNTIME_UNAVAILABLE', '组织服务暂时无法完成请求，请稍后重试。', {
          retryable: true,
        })
      throw new AppError('BAD_REQUEST', '组织服务未能完成操作，请检查输入或稍后重试。')
    }
    const result = await this.readJson(response, maxResponseBytes)
    this.assertCurrent(snapshot)
    return this.publicValue(result, connection.session.token)
  }

  private orgPath(snapshot: Snapshot): string {
    const id = snapshot.connection.activeOrganizationId
    if (!id) throw new AppError('BAD_REQUEST', '请先选择或创建组织。')
    return `/v1/organizations/${encodeURIComponent(id)}`
  }

  private workerHost(snapshot: Snapshot): WorkerHost {
    const { connection } = snapshot,
      organizationId = connection.activeOrganizationId
    if (!organizationId) throw new AppError('BAD_REQUEST', '请先选择组织。')
    const scope = {
      serverUrl: connection.serverUrl,
      organizationId,
      accountId: connection.session.account.id,
    }
    return {
      scope,
      organizationName:
        connection.session.organizations.find((o) => o.id === organizationId)?.name ?? organizationId,
      assertCurrent: () => this.assertCurrent(snapshot),
      request: (path, method = 'GET', body, secret, proof) =>
        this.request(snapshot, path, method, body, 1024 * 1024, secret, proof),
      credential: () =>
        this.vault.workers.find(
          (w) =>
            w.serverUrl === scope.serverUrl &&
            w.organizationId === scope.organizationId &&
            w.accountId === scope.accountId,
        ),
      persist: (worker) => {
        this.assertCurrent(snapshot)
        this.commit({
          ...this.vault,
          workers: [
            ...this.vault.workers.filter(
              (w) =>
                !(
                  w.serverUrl === scope.serverUrl &&
                  w.organizationId === scope.organizationId &&
                  w.accountId === scope.accountId
                ),
            ),
            worker,
          ],
        })
      },
    }
  }
  private async clearWorkerContext(): Promise<void> {
    const connection = this.vault.connection
    if (!this.workerPorts || !connection?.activeOrganizationId) return
    const scope = {
      serverUrl: connection.serverUrl,
      organizationId: connection.activeOrganizationId,
      accountId: connection.session.account.id,
    }
    const key = JSON.stringify(scope)
    if (!this.vault.pendingWorkerClears.some((s) => JSON.stringify(s) === key))
      this.commit({ ...this.vault, pendingWorkerClears: [...this.vault.pendingWorkerClears, scope] })
    await this.flushWorkerClears()
  }
  private async flushWorkerClears(): Promise<void> {
    if (!this.workerPorts) return
    if (this.workerClearPass) return this.workerClearPass
    const pass = async () => {
      for (const scope of this.vault.pendingWorkerClears) {
        try {
          await this.workerPorts!.runtime('runtime.worker.clear', scope)
          const key = JSON.stringify(scope)
          this.commit({
            ...this.vault,
            pendingWorkerClears: this.vault.pendingWorkerClears.filter((s) => JSON.stringify(s) !== key),
          })
        } catch {
          /* Logout still clears account credentials; durable local revoke resumes when Runtime recovers. */
        }
      }
    }
    this.workerClearPass = pass()
    try {
      await this.workerClearPass
    } finally {
      this.workerClearPass = null
    }
  }
  async syncWorkers(): Promise<void> {
    await this.flushWorkerClears()
    if (
      !this.workerBridge ||
      !this.vault.connection?.activeOrganizationId ||
      this.workerChanging ||
      this.workerPending ||
      this.contextChanging
    )
      return
    const snapshot = this.snapshot()
    await this.workerBridge.sync(this.workerHost(snapshot))
  }

  private parseMe(raw: unknown) {
    const parsed = OrganizationSessionViewSchema.omit({ expiresAt: true }).safeParse(raw)
    if (!parsed.success) throw new AppError('BAD_REQUEST', '组织服务返回了无效的账号数据。')
    return parsed.data
  }

  async status(refresh = false): Promise<OrganizationConnectionView> {
    if (refresh) {
      await this.revokePending()
      const connection = this.vault.connection
      if (connection && !connection.invalidated && connection.session.expiresAt > Date.now()) {
        const snapshot = this.snapshot()
        try {
          const me = this.parseMe(await this.request(snapshot, '/v1/me'))
          this.assertCurrent(snapshot)
          const activeOrganizationId = me.organizations.some(
            (item) => item.id === connection.activeOrganizationId,
          )
            ? connection.activeOrganizationId
            : (me.organizations[0]?.id ?? null)
          if (activeOrganizationId !== connection.activeOrganizationId) await this.clearWorkerContext()
          this.assertCurrent(snapshot)
          this.commit(
            {
              ...this.vault,
              connection: { ...connection, session: { ...connection.session, ...me }, activeOrganizationId },
            },
            activeOrganizationId !== connection.activeOrganizationId,
          )
        } catch (error) {
          if (
            error instanceof AppError &&
            ['FORBIDDEN', 'RUNTIME_UNAVAILABLE', 'CANCELLED'].includes(error.code)
          )
            return this.view()
          throw error
        }
      }
    }
    return this.view()
  }

  async execute(method: OrganizationMethod, raw: Record<string, unknown>): Promise<unknown> {
    const input = OrganizationApiSchemas[method].input.parse(raw) as Record<string, unknown>
    let result: unknown
    if (method === 'organization.status') return this.status(Boolean(input.refresh))
    if (method === 'organization.cancel') {
      this.login?.abort()
      return { ok: true }
    }
    if (method === 'organization.connect') {
      if (this.login) throw new AppError('CONFLICT', '登录正在进行，请先完成或取消。')
      if (this.vault.connection) throw new AppError('CONFLICT', '请先退出当前组织账号。')
      if (!this.codec.isEncryptionAvailable())
        throw new AppError('SECRET_STORAGE_UNAVAILABLE', '系统安全存储不可用，暂时无法登录组织。')
      const serverUrl = organizationOrigin(String(input.serverUrl))
      const controller = new AbortController()
      this.login = controller
      let issuedToken: string | null = null
      try {
        await this.revokePending()
        if (this.vault.pendingRevocations.length >= 20)
          throw new AppError('RUNTIME_UNAVAILABLE', '退出请求尚待处理，请恢复网络后重试。')
        const loggedIn = await runDesktopLogin({
          authBaseUrl: serverUrl,
          openExternal: this.openExternal,
          fetchImpl: this.fetchImpl,
          signal: controller.signal,
        })
        issuedToken = loggedIn.session.token
        if (controller.signal.aborted) throw new AppError('CANCELLED', '已取消登录。')
        this.publicValue(OrganizationSessionViewSchema.parse(loggedIn.session), loggedIn.session.token)
        const next = {
          ...this.vault,
          connection: {
            serverUrl,
            session: loggedIn.session,
            activeOrganizationId: loggedIn.session.organizations[0]?.id ?? null,
            invalidated: false,
          },
        }
        this.commit(next, true)
        issuedToken = null
        this.offline = false
        return this.view()
      } catch (error) {
        if (issuedToken) await this.revoke(serverUrl, issuedToken)
        if (controller.signal.aborted) throw new AppError('CANCELLED', '已取消登录。')
        if (error instanceof AppError) throw error
        if (error instanceof DesktopLoginError && error.code === 'timeout')
          throw new AppError('TIMEOUT', '登录等待已超时，请重新连接。', { retryable: true })
        throw new AppError('BAD_REQUEST', '组织登录未完成，请检查服务地址或重试。')
      } finally {
        if (this.login === controller) this.login = null
      }
    }
    if (method === 'organization.disconnect') {
      this.login?.abort()
      await this.clearWorkerContext()
      const connection = this.vault.connection
      if (connection) {
        const pending = this.vault.pendingRevocations.filter((item) => item.expiresAt > Date.now())
        if (connection.session.expiresAt > Date.now())
          pending.push({
            serverUrl: connection.serverUrl,
            token: connection.session.token,
            expiresAt: connection.session.expiresAt,
          })
        this.commit({ ...this.vault, connection: null, pendingRevocations: pending }, true)
        this.offline = false
        await this.revokePending()
      }
      return this.view()
    }
    if (method === 'organization.select' || method === 'organization.create') {
      if (this.contextChanging) throw new AppError('CONFLICT', '组织切换正在进行，请稍后重试。')
      this.contextChanging = true
      try {
        const snapshot = this.snapshot()
        let selected = String(input.organizationId ?? '')
        if (method === 'organization.create') {
          const created = z
            .object({ organization: z.object({ id: z.string().min(1).max(128) }) })
            .safeParse(await this.request(snapshot, '/v1/organizations', 'POST', input))
          if (!created.success) throw new AppError('BAD_REQUEST', '组织服务返回了无效的数据。')
          selected = created.data.organization.id
        }
        const me = this.parseMe(await this.request(snapshot, '/v1/me'))
        this.assertCurrent(snapshot)
        if (!me.organizations.some((item) => item.id === selected))
          throw new AppError('FORBIDDEN', '你没有此组织的访问权限。')
        await this.clearWorkerContext()
        this.assertCurrent(snapshot)
        this.commit(
          {
            ...this.vault,
            connection: {
              ...snapshot.connection,
              session: { ...snapshot.connection.session, ...me },
              activeOrganizationId: selected,
            },
          },
          true,
        )
        return this.view()
      } finally {
        this.contextChanging = false
      }
    }
    const snapshot = this.snapshot()
    if (isWorkerMethod(method)) {
      if (!this.workerBridge) throw new AppError('RUNTIME_UNAVAILABLE', '设备服务尚未就绪。')
      if (this.workerPending >= 8 || this.contextChanging)
        throw new AppError('CONFLICT', '设备或组织操作正在进行，请稍后重试。')
      const previous = this.workerQueue
      let release!: () => void
      this.workerQueue = new Promise<void>((resolve) => {
        release = resolve
      })
      this.workerPending++
      await previous
      this.workerChanging = true
      try {
        this.assertCurrent(snapshot)
        await this.flushWorkerClears()
        if (this.vault.pendingWorkerClears.length)
          throw new AppError('RUNTIME_UNAVAILABLE', '本机授权撤销尚待完成，请等待本机服务恢复。')
        const value = await this.workerBridge.execute(this.workerHost(snapshot), method, input)
        this.assertCurrent(snapshot)
        return this.publicValue(
          OrganizationApiSchemas[method].output.parse(value),
          snapshot.connection.session.token,
        )
      } finally {
        this.workerChanging = false
        this.workerPending--
        release()
      }
    }
    // Up to 100 immutable versions of a 64KiB request; still a strict streaming bound.
    const assetRequest = (suffix = '', method = 'GET', body?: unknown) =>
      this.request(snapshot, `${this.orgPath(snapshot)}/assets${suffix}`, method, body, 8 * 1024 * 1024)
    switch (method) {
      case 'organization.assets':
        result = await assetRequest()
        break
      case 'organization.assetDetail':
        result = await assetRequest(`/${encodeURIComponent(String(input.assetId))}`)
        break
      case 'organization.createAsset':
        result = await assetRequest('', 'POST', input)
        break
      case 'organization.createAssetVersion':
      case 'organization.updateAssetDraft':
      case 'organization.transitionAsset': {
        const { assetId, versionId, ...body } = input
        const path = `/${encodeURIComponent(String(assetId))}/versions`
        result = await assetRequest(
          method === 'organization.createAssetVersion'
            ? path
            : `${path}/${encodeURIComponent(String(versionId))}${method === 'organization.transitionAsset' ? '/transition' : ''}`,
          method === 'organization.updateAssetDraft' ? 'PATCH' : 'POST',
          body,
        )
        break
      }
      case 'organization.bindAsset':
      case 'organization.unbindAsset':
        result = await assetRequest(
          '/bindings',
          method === 'organization.bindAsset' ? 'PUT' : 'DELETE',
          input,
        )
        break
      case 'organization.projects':
        result = await this.request(snapshot, `${this.orgPath(snapshot)}/projects`)
        break
      case 'organization.createProject':
        result = await this.request(snapshot, `${this.orgPath(snapshot)}/projects`, 'POST', input)
        break
      case 'organization.members':
        result = await this.request(snapshot, `${this.orgPath(snapshot)}/members`)
        break
      case 'organization.invite':
        result = await this.request(snapshot, `${this.orgPath(snapshot)}/invitations`, 'POST', input)
        break
      case 'organization.invitations':
        result = await this.request(snapshot, '/v1/invitations')
        break
      case 'organization.decideInvitation':
        result = await this.request(
          snapshot,
          `/v1/invitations/${encodeURIComponent(String(input.invitationId))}/decide`,
          'POST',
          {
            decision: input.decision,
            ...(typeof input.invitationCode === 'string' ? { invitationCode: input.invitationCode } : {}),
          },
        )
        break
      case 'organization.changeMember':
        result = await this.request(
          snapshot,
          `${this.orgPath(snapshot)}/members/${encodeURIComponent(String(input.memberId))}`,
          'PATCH',
          { role: input.role },
        )
        break
      case 'organization.removeMember':
        result = await this.request(
          snapshot,
          `${this.orgPath(snapshot)}/members/${encodeURIComponent(String(input.memberId))}`,
          'DELETE',
        )
        break
      case 'organization.setProjectMember':
        result = await this.request(
          snapshot,
          `${this.orgPath(snapshot)}/projects/${encodeURIComponent(String(input.projectId))}/members`,
          'PUT',
          { accountId: input.accountId, role: input.role },
        )
        break
    }
    this.assertCurrent(snapshot)
    const parsed = OrganizationApiSchemas[method].output.safeParse(result)
    if (!parsed.success) throw new AppError('BAD_REQUEST', '组织服务返回了无效的数据。')
    return this.publicValue(parsed.data, snapshot.connection.session.token)
  }
}
