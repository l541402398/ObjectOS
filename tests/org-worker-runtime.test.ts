import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteStore } from '@projectos/persistence'
import {
  ApiSchemas,
  WorkerInternalSchemas,
  WorkerGrantInputSchema,
  type LocalWorkerGrant,
} from '@projectos/contracts'
import { LocalWorkerService } from '../apps/runtime/src/local-worker.js'
import {
  OrganizationWorkerBridge,
  type StoredWorker,
  type WorkerHost,
} from '../apps/desktop/src/main/auth/organization-worker.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'projectos-worker-')),
    root = join(directory, 'project'),
    db = join(directory, 'worker.sqlite')
  mkdirSync(join(root, 'src'), { recursive: true })
  const store = new SqliteStore({ filePath: db })
  const project = store.createProject(
    {
      id: 'local-project',
      name: '本机工作区',
      rootPath: root,
      description: '',
      status: 'active',
      currentStage: 'planning',
      version: 1,
      isDemo: false,
      createdAt: 1,
      updatedAt: 1,
    },
    [],
  )
  const service = new LocalWorkerService(store)
  const scope = {
    serverUrl: 'http://127.0.0.1:19876',
    organizationId: 'organization-a',
    accountId: 'account-a',
  }
  const input = {
    ...scope,
    workerId: randomUUID(),
    request: {
      projectId: 'shared-project',
      localProjectId: project.id,
      durationHours: 1,
      scope: { directories: ['src'], tools: ['read_file'], maxToolCalls: 20 },
    },
  }
  cleanups.push(() => {
    store.close()
    const absolute = resolve(directory)
    if (!absolute.startsWith(resolve(tmpdir()) + sep) || !absolute.includes('projectos-worker-'))
      throw new Error('unexpected cleanup')
    rmSync(absolute, { recursive: true, force: true })
  })
  const prepare = () => service.dispatch('runtime.worker.prepare', input) as LocalWorkerGrant
  return { service, store, scope, root, directory, db, input, prepare }
}
describe('Worker local authority and Main consent orchestration', () => {
  it('keeps internal consent methods out of the renderer catalogue; persists identity and grant audit', () => {
    for (const key of Object.keys(WorkerInternalSchemas)) expect(Object.hasOwn(ApiSchemas, key)).toBe(false)
    const f = fixture(),
      identity = f.service.dispatch('runtime.worker.context', f.scope)
    expect(f.service.dispatch('runtime.worker.context', f.scope)).toEqual(identity)
    const grant = f.prepare()
    expect(grant.rootPath).toBe(realpathSync.native(f.root))
    expect(grant.status).toBe('pending')
    expect(() =>
      f.service.dispatch('runtime.worker.activate', { id: grant.id, scopeDigest: grant.scopeDigest }),
    ).toThrow('状态已改变')
    f.service.dispatch('runtime.worker.confirm', { id: grant.id, scopeDigest: grant.scopeDigest })
    f.service.dispatch('runtime.worker.activate', { id: grant.id, scopeDigest: grant.scopeDigest })
    expect(f.store.db.prepare('SELECT count(*) AS n FROM worker_local_audit').get()!.n).toBe(3)
    const next = new LocalWorkerService(f.store)
    expect((next.dispatch('runtime.worker.context', f.scope) as any).grants[0].status).toBe('active')
    expect(f.store.read.listRunSummaries('local-project')).toHaveLength(0)
    expect(JSON.stringify(next.dispatch('runtime.worker.context', f.scope))).not.toContain('secret')
  })
  it('blocks root escapes, drive/UNC paths, links outside root and scope changes after consent', () => {
    const f = fixture()
    for (const directory of [
      '../private',
      'C:/private',
      '\\\\host\\share',
      '/root',
      'src/../private',
      'src//file',
      'src:stream',
    ])
      expect(() =>
        f.service.dispatch('runtime.worker.prepare', {
          ...f.input,
          request: { ...f.input.request, scope: { ...f.input.request.scope, directories: [directory] } },
        }),
      ).toThrow()
    const outside = join(f.directory, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, join(f.root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() =>
      f.service.dispatch('runtime.worker.prepare', {
        ...f.input,
        request: { ...f.input.request, scope: { ...f.input.request.scope, directories: ['escape'] } },
      }),
    ).toThrow('越过')
    const grant = f.prepare()
    renameSync(join(f.root, 'src'), join(f.root, 'old-src'))
    symlinkSync(outside, join(f.root, 'src'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() =>
      f.service.dispatch('runtime.worker.confirm', { id: grant.id, scopeDigest: grant.scopeDigest }),
    ).toThrow('越过')
  })
  it('prevents parallel/cross-organization association and clears grants on context change', () => {
    const f = fixture(),
      grant = f.prepare()
    expect(() =>
      f.service.dispatch('runtime.worker.prepare', { ...f.input, organizationId: 'other-org' }),
    ).toThrow('已有授权')
    f.service.dispatch('runtime.worker.clear', f.scope)
    const cleared = (f.service.dispatch('runtime.worker.context', f.scope) as any).grants[0]
    expect(cleared).toMatchObject({ id: grant.id, status: 'revoked', remoteSynced: false })
    expect(f.prepare().id).not.toBe(grant.id)
  })
  it('Main cancellation revokes prepared consent and never sends a shared grant', async () => {
    const f = fixture(),
      id = randomUUID()
    const credential: StoredWorker = {
      ...f.scope,
      instanceId: (f.service.dispatch('runtime.worker.context', f.scope) as any).instanceId,
      registrationId: id,
      secret: 'x'.repeat(64),
      name: 'Device',
    }
    let grantPosts = 0,
      confirmations = 0
    const bridge = new OrganizationWorkerBridge({
      runtime: async (method, input) =>
        f.service.dispatch(method as keyof typeof WorkerInternalSchemas, input),
      confirm: async (grant) => {
        confirmations++
        expect(grant.rootPath).toBe(realpathSync.native(f.root))
        return false
      },
    })
    const host: WorkerHost = {
      scope: f.scope,
      organizationName: 'Org',
      assertCurrent: () => {},
      credential: () => credential,
      persist: () => {},
      request: async (path) => {
        if (path.endsWith('/projects'))
          return {
            organizationId: f.scope.organizationId,
            projects: [
              {
                id: 'shared-project',
                organizationId: f.scope.organizationId,
                key: 'PROJECT',
                name: '共享项目',
                role: 'owner',
                status: 'active',
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          }
        if (path.endsWith('/grants')) {
          grantPosts++
          return { ok: true }
        }
        return {
          workers: [
            {
              id,
              organizationId: f.scope.organizationId,
              ownerId: f.scope.accountId,
              ownerName: 'Owner',
              name: 'Device',
              platform: 'win32',
              protocol: 'local-worker/1',
              state: 'active',
              status: 'online',
              revision: 1,
              createdAt: 1,
              lastSeenAt: Date.now(),
              executionReady: false,
              canManage: true,
            },
          ],
          grants: [],
        }
      },
    }
    await expect(bridge.execute(host, 'organization.grantWorker', f.input.request)).rejects.toThrow('取消')
    expect(confirmations).toBe(1)
    expect(grantPosts).toBe(0)
    expect((f.service.dispatch('runtime.worker.context', f.scope) as any).grants[0]).toMatchObject({
      status: 'revoked',
      remoteSynced: true,
    })
  })

  it.each([false, true])(
    'exports only the shared grant shape and reconciles an unknown response (%s)',
    async (unknownResponse) => {
      const f = fixture(),
        id = randomUUID()
      const credential: StoredWorker = {
        ...f.scope,
        instanceId: (f.service.dispatch('runtime.worker.context', f.scope) as any).instanceId,
        registrationId: id,
        secret: 'x'.repeat(64),
        name: 'Device',
      }
      const remote: any[] = [],
        payloads: unknown[] = []
      const bridge = new OrganizationWorkerBridge({
        runtime: async (method, input) =>
          f.service.dispatch(method as keyof typeof WorkerInternalSchemas, input),
        confirm: async () => true,
      })
      const host: WorkerHost = {
        scope: f.scope,
        organizationName: 'Org',
        assertCurrent: () => {},
        credential: () => credential,
        persist: () => {},
        request: async (path, method, body) => {
          if (path.endsWith('/projects'))
            return {
              organizationId: f.scope.organizationId,
              projects: [
                {
                  id: 'shared-project',
                  organizationId: f.scope.organizationId,
                  key: 'PROJECT',
                  name: 'Shared',
                  role: 'owner',
                  status: 'active',
                  createdAt: 1,
                  updatedAt: 1,
                },
              ],
            }
          if (path.endsWith('/grants') && method === 'POST') {
            const shared = WorkerGrantInputSchema.parse(body)
            payloads.push(shared)
            remote.push({
              ...shared,
              workerId: id,
              projectName: 'Shared',
              createdAt: Date.now(),
              status: 'active',
            })
            if (unknownResponse) throw new Error('Response lost after commit')
            return { ok: true }
          }
          if (method === 'DELETE') {
            remote.forEach((g) => {
              g.status = 'revoked'
            })
            return { ok: true }
          }
          return {
            workers: [
              {
                id,
                organizationId: f.scope.organizationId,
                ownerId: f.scope.accountId,
                ownerName: 'Owner',
                name: 'Device',
                platform: 'win32',
                protocol: 'local-worker/1',
                state: 'active',
                status: 'online',
                revision: 1,
                createdAt: 1,
                lastSeenAt: Date.now(),
                executionReady: false,
                canManage: true,
              },
            ],
            grants: remote,
          }
        },
      }
      if (unknownResponse) {
        await expect(bridge.execute(host, 'organization.grantWorker', f.input.request)).rejects.toThrow(
          'Response lost',
        )
        expect((f.service.dispatch('runtime.worker.context', f.scope) as any).grants[0]).toMatchObject({
          status: 'revoked',
          remoteSynced: false,
        })
        await bridge.sync(host)
        expect((f.service.dispatch('runtime.worker.context', f.scope) as any).grants[0]).toMatchObject({
          status: 'revoked',
          remoteSynced: true,
        })
      } else {
        const result = (await bridge.execute(host, 'organization.grantWorker', f.input.request)) as any
        expect(result.local.grants[0].status).toBe('active')
        expect(result.grants[0].id).toBe(result.local.grants[0].id)
      }
      expect(payloads).toHaveLength(1)
      expect(JSON.stringify(payloads)).not.toContain('rootPath')
      expect(JSON.stringify(payloads)).not.toContain(realpathSync.native(f.root))
      expect(JSON.stringify(payloads)).not.toContain('consentAt')
    },
  )
})
