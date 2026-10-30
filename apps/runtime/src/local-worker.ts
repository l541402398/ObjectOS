import { createHash, randomUUID } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  AppError,
  WorkerInternalSchemas,
  LocalWorkerGrantSchema,
  type LocalWorkerGrant,
  type WorkerInternalScope,
} from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function inspectRoot(raw: string) {
  try {
    const path = realpathSync.native(raw),
      info = statSync(path)
    if (!info.isDirectory()) throw new Error('not-directory')
    return { path, fingerprint: hash([path, info.dev, info.ino, info.birthtimeMs]) }
  } catch {
    throw new AppError('POLICY_DENIED', '本机项目目录不可用，请确认目录后重新授权。')
  }
}
function scopedDirectories(root: string, directories: string[]) {
  return directories.map((directory) => {
    const target = inspectRoot(resolve(root, directory)).path
    const path = relative(root, target)
    if (isAbsolute(path) || path === '..' || path.startsWith('../') || path.startsWith('..\\'))
      throw new AppError('POLICY_DENIED', '目录越过了本机项目边界，不能授权。')
    return target
  })
}

/** Local consent facts only. This service cannot launch a Run or execute a tool. */
export class LocalWorkerService {
  constructor(private readonly store: SqliteStore) {}

  private grants(scope?: WorkerInternalScope) {
    const rows = scope
      ? this.store.db
          .prepare(
            'SELECT grant_json FROM worker_local_grants WHERE server_url=? AND organization_id=? AND account_id=? ORDER BY rowid DESC LIMIT 500',
          )
          .all(scope.serverUrl, scope.organizationId, scope.accountId)
      : this.store.db.prepare('SELECT grant_json FROM worker_local_grants').all()
    return rows.map((r) => LocalWorkerGrantSchema.parse(JSON.parse(String(r.grant_json))))
  }
  private get(id: string) {
    const row = this.store.db.prepare('SELECT grant_json FROM worker_local_grants WHERE id=?').get(id)
    if (!row) throw new AppError('NOT_FOUND', '本机授权不存在。')
    return LocalWorkerGrantSchema.parse(JSON.parse(String(row.grant_json)))
  }
  private save(grant: LocalWorkerGrant, operation: string) {
    const value = LocalWorkerGrantSchema.parse(grant)
    this.store.transaction(() => {
      this.store.db
        .prepare(
          `INSERT INTO worker_local_grants(id,server_url,organization_id,account_id,local_project_id,status,expires_at,grant_json) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status,grant_json=excluded.grant_json`,
        )
        .run(
          value.id,
          value.serverUrl,
          value.organizationId,
          value.accountId,
          value.localProjectId,
          value.status,
          value.expiresAt,
          JSON.stringify(value),
        )
      this.store.db
        .prepare('INSERT INTO worker_local_audit(grant_id,operation,created_at,details_json) VALUES(?,?,?,?)')
        .run(
          value.id,
          operation,
          Date.now(),
          JSON.stringify({
            scopeDigest: value.scopeDigest,
            status: value.status,
            remoteSynced: value.remoteSynced,
          }),
        )
    })
    return value
  }
  private assertRoot(grant: LocalWorkerGrant) {
    const project = this.store.read.getProject(grant.localProjectId)
    if (
      !project ||
      project.status === 'archived' ||
      inspectRoot(project.rootPath).fingerprint !== grant.rootFingerprint ||
      Date.now() >= grant.expiresAt
    )
      throw new AppError('POLICY_DENIED', '本机目录或授权有效期已改变，请重新授权。')
    const targets = scopedDirectories(grant.rootPath, grant.scope.directories)
    const expected = hash([
      grant.id,
      grant.workerId,
      grant.organizationId,
      grant.projectId,
      grant.localProjectId,
      grant.rootFingerprint,
      grant.workspaceRef,
      grant.scope,
      targets,
      grant.expiresAt,
    ])
    if (expected !== grant.scopeDigest) throw new AppError('POLICY_DENIED', '授权目录发生变化，请重新授权。')
  }

  dispatch(method: keyof typeof WorkerInternalSchemas, raw: unknown): unknown {
    const input = WorkerInternalSchemas[method].input.parse(raw)
    switch (method) {
      case 'runtime.worker.context': {
        const scope = WorkerInternalSchemas[method].input.parse(input)
        this.store.db
          .prepare('INSERT OR IGNORE INTO worker_local_identity(singleton,instance_id) VALUES(1,?)')
          .run(randomUUID())
        return {
          instanceId: this.store.db
            .prepare('SELECT instance_id FROM worker_local_identity WHERE singleton=1')
            .get()!.instance_id,
          projects: this.store.read.listProjects().map(({ id, name, rootPath }) => ({ id, name, rootPath })),
          grants: this.grants(scope),
        }
      }
      case 'runtime.worker.prepare': {
        const { request, workerId, ...scope } = WorkerInternalSchemas[method].input.parse(input)
        const project = this.store.read.getProject(request.localProjectId)
        if (!project || project.status === 'archived')
          throw new AppError('NOT_FOUND', '本机项目不存在或已归档。')
        const root = inspectRoot(project.rootPath),
          targets = scopedDirectories(root.path, request.scope.directories)
        const other = this.grants().find(
          (g) =>
            g.status !== 'revoked' &&
            g.expiresAt > Date.now() &&
            (g.localProjectId === project.id || g.rootFingerprint === root.fingerprint),
        )
        if (other) throw new AppError('CONFLICT', '此本机项目已有授权。请先撤销原授权，再重新关联。')
        const count = this.grants(scope).length
        if (count >= 500) throw new AppError('CONFLICT', '本机授权记录已达到上限。')
        const id = randomUUID(),
          workspaceRef = randomUUID(),
          expiresAt = Date.now() + request.durationHours * 60 * 60_000
        const scopeDigest = hash([
          id,
          workerId,
          scope.organizationId,
          request.projectId,
          project.id,
          root.fingerprint,
          workspaceRef,
          request.scope,
          targets,
          expiresAt,
        ])
        return this.save(
          {
            ...scope,
            id,
            workerId,
            projectId: request.projectId,
            localProjectId: project.id,
            localProjectName: project.name,
            rootPath: root.path,
            rootFingerprint: root.fingerprint,
            workspaceRef,
            scope: request.scope,
            scopeDigest,
            expiresAt,
            createdAt: Date.now(),
            consentAt: null,
            status: 'pending',
            remoteSynced: false,
          },
          'grant.prepared',
        )
      }
      case 'runtime.worker.confirm':
      case 'runtime.worker.activate': {
        const { id, scopeDigest } = WorkerInternalSchemas[method].input.parse(input),
          grant = this.get(id)
        this.assertRoot(grant)
        if (
          grant.scopeDigest !== scopeDigest ||
          grant.status !== (method === 'runtime.worker.confirm' ? 'pending' : 'consented')
        )
          throw new AppError('CONFLICT', '本机授权状态已改变，请重新操作。')
        return this.save(
          {
            ...grant,
            status: method === 'runtime.worker.confirm' ? 'consented' : 'active',
            consentAt: grant.consentAt ?? Date.now(),
            remoteSynced: method === 'runtime.worker.activate',
          },
          method === 'runtime.worker.confirm' ? 'grant.consented' : 'grant.activated',
        )
      }
      case 'runtime.worker.revoke':
      case 'runtime.worker.synced': {
        const { id } = WorkerInternalSchemas[method].input.parse(input),
          grant = this.get(id)
        if (method === 'runtime.worker.synced' && grant.status !== 'revoked')
          throw new AppError('CONFLICT', '授权尚未撤销。')
        this.save(
          { ...grant, status: 'revoked', remoteSynced: method === 'runtime.worker.synced' },
          method === 'runtime.worker.synced' ? 'grant.revoke_synced' : 'grant.revoked',
        )
        return { ok: true }
      }
      case 'runtime.worker.clear': {
        const scope = WorkerInternalSchemas[method].input.parse(input)
        this.store.transaction(() => {
          for (const grant of this.grants(scope).filter((g) => g.status !== 'revoked'))
            this.save({ ...grant, status: 'revoked', remoteSynced: false }, 'grant.context_cleared')
        })
        return { ok: true }
      }
    }
  }
}
