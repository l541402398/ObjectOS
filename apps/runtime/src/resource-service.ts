import { AppError, newId, now, type ConnectionProfile, type ConnectionTestRun, type CreateConnectionProfileInput, type CreateResourceInput, type CredentialMetadata, type Resource, type ResourceOverview } from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'

type Row = Record<string, unknown>

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

export class ResourceService {
  constructor(private readonly store: SqliteStore) {}

  private resource(row: Row): Resource {
    return {
      id: String(row.id), projectId: String(row.project_id), type: String(row.type) as Resource['type'],
      name: String(row.name), endpoint: String(row.endpoint), purpose: String(row.purpose),
      labels: json<string[]>(row.labels_json, []), metadata: json<Record<string, unknown>>(row.metadata_json, {}),
      status: String(row.status) as Resource['status'], createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    }
  }

  private profile(row: Row): ConnectionProfile {
    return {
      id: String(row.id), resourceId: String(row.resource_id), name: String(row.name),
      protocol: String(row.protocol) as ConnectionProfile['protocol'], host: String(row.host), port: Number(row.port),
      username: String(row.username), authType: String(row.auth_type) as ConnectionProfile['authType'],
      credentialRef: row.credential_ref ? String(row.credential_ref) : null,
      hostKeyFingerprint: row.host_key_fingerprint ? String(row.host_key_fingerprint) : null,
      trustPolicy: String(row.trust_policy) as ConnectionProfile['trustPolicy'],
      connectTimeoutMs: Number(row.connect_timeout_ms),
      lastTestStatus: row.last_test_status ? String(row.last_test_status) : null,
      lastTestAt: row.last_test_at ? Number(row.last_test_at) : null,
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    }
  }

  private credential(row: Row): CredentialMetadata {
    return {
      id: String(row.id), projectId: String(row.project_id), kind: String(row.kind) as CredentialMetadata['kind'],
      label: String(row.label), status: String(row.status) as CredentialMetadata['status'],
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    }
  }

  private testRun(row: Row): ConnectionTestRun {
    return {
      id: String(row.id), profileId: String(row.profile_id), resourceId: String(row.resource_id),
      status: String(row.status) as ConnectionTestRun['status'], stage: String(row.stage),
      message: String(row.message), latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
      details: json<Record<string, unknown>>(row.details_json, {}), createdAt: Number(row.created_at),
    }
  }

  overview(projectId: string): ResourceOverview {
    const resources = this.store.db.prepare('SELECT * FROM resources WHERE project_id=? ORDER BY updated_at DESC').all(projectId).map((row) => this.resource(row as Row))
    const profiles = this.store.db
      .prepare('SELECT p.* FROM connection_profiles p JOIN resources r ON r.id=p.resource_id WHERE r.project_id=? ORDER BY p.updated_at DESC')
      .all(projectId).map((row) => this.profile(row as Row))
    const credentials = this.store.db.prepare('SELECT * FROM credential_metadata WHERE project_id=? AND status=\'active\' ORDER BY updated_at DESC').all(projectId).map((row) => this.credential(row as Row))
    const testRuns = this.store.db
      .prepare('SELECT t.* FROM connection_test_runs t JOIN resources r ON r.id=t.resource_id WHERE r.project_id=? ORDER BY t.created_at DESC LIMIT 100')
      .all(projectId).map((row) => this.testRun(row as Row))
    return { resources, profiles, credentials, testRuns }
  }

  create(input: CreateResourceInput): Resource {
    this.assertProject(input.projectId)
    const id = newId('res')
    const timestamp = now()
    this.store.db.prepare(
      `INSERT INTO resources (id, project_id, type, name, endpoint, purpose, labels_json, metadata_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(id, input.projectId, input.type, input.name, input.endpoint, input.purpose, JSON.stringify(input.labels), JSON.stringify(input.metadata), timestamp, timestamp)
    return this.resource(this.store.db.prepare('SELECT * FROM resources WHERE id=?').get(id) as Row)
  }

  update(input: { resourceId: string; name?: string; endpoint?: string; purpose?: string; status?: Resource['status']; labels?: string[]; metadata?: Record<string, unknown> }): Resource {
    const current = this.getResource(input.resourceId)
    const timestamp = now()
    this.store.db.prepare(
      'UPDATE resources SET name=?, endpoint=?, purpose=?, status=?, labels_json=?, metadata_json=?, updated_at=? WHERE id=?',
    ).run(
      input.name ?? current.name, input.endpoint ?? current.endpoint, input.purpose ?? current.purpose,
      input.status ?? current.status, JSON.stringify(input.labels ?? current.labels),
      JSON.stringify(input.metadata ?? current.metadata), timestamp, input.resourceId,
    )
    return this.getResource(input.resourceId)
  }

  createProfile(input: CreateConnectionProfileInput): ConnectionProfile {
    const resource = this.getResource(input.resourceId)
    if (input.credentialRef) this.assertCredentialForProject(input.credentialRef, resource.projectId)
    if (input.protocol === 'ssh' && !['password', 'private_key', 'agent'].includes(input.authType)) {
      throw new AppError('BAD_REQUEST', 'SSH Profile 需要密码/私钥/Agent 认证')
    }
    const id = newId('prf')
    const timestamp = now()
    this.store.db.prepare(
      `INSERT INTO connection_profiles
       (id, resource_id, name, protocol, host, port, username, auth_type, credential_ref, host_key_fingerprint, trust_policy, connect_timeout_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.resourceId, input.name, input.protocol, input.host, input.port, input.username, input.authType,
      input.credentialRef ?? null, input.hostKeyFingerprint ?? null, input.trustPolicy, input.connectTimeoutMs, timestamp, timestamp)
    return this.getProfile(id)
  }

  updateProfile(input: { profileId: string; name?: string; host?: string; port?: number; username?: string; authType?: ConnectionProfile['authType']; credentialRef?: string | null; hostKeyFingerprint?: string | null; trustPolicy?: ConnectionProfile['trustPolicy']; connectTimeoutMs?: number }): ConnectionProfile {
    const current = this.getProfile(input.profileId)
    const resource = this.getResource(current.resourceId)
    if (input.credentialRef) this.assertCredentialForProject(input.credentialRef, resource.projectId)
    this.store.db.prepare(
      `UPDATE connection_profiles SET name=?, host=?, port=?, username=?, auth_type=?, credential_ref=?, host_key_fingerprint=?, trust_policy=?, connect_timeout_ms=?, updated_at=? WHERE id=?`,
    ).run(
      input.name ?? current.name, input.host ?? current.host, input.port ?? current.port, input.username ?? current.username,
      input.authType ?? current.authType, input.credentialRef === undefined ? current.credentialRef : input.credentialRef,
      input.hostKeyFingerprint === undefined ? current.hostKeyFingerprint : input.hostKeyFingerprint,
      input.trustPolicy ?? current.trustPolicy, input.connectTimeoutMs ?? current.connectTimeoutMs, now(), input.profileId,
    )
    return this.getProfile(input.profileId)
  }

  deleteProfile(profileId: string): { deleted: boolean } {
    this.getProfile(profileId)
    const linked = this.store.db.prepare('SELECT COUNT(*) AS count FROM deployment_targets WHERE connection_profile_id=?').get(profileId) as { count: number }
    if (Number(linked.count) > 0) throw new AppError('CONFLICT', '该 Profile 已被部署目标引用，不能删除')
    this.store.db.prepare('DELETE FROM connection_profiles WHERE id=?').run(profileId)
    return { deleted: true }
  }

  registerCredential(input: { id: string; projectId: string; kind: CredentialMetadata['kind']; label: string; vaultKey: string }): CredentialMetadata {
    this.assertProject(input.projectId)
    const timestamp = now()
    this.store.db.prepare(
      `INSERT INTO credential_metadata (id, project_id, kind, label, vault_key, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(input.id, input.projectId, input.kind, input.label, input.vaultKey, timestamp, timestamp)
    return this.getCredential(input.id)
  }

  disableCredential(credentialId: string): CredentialMetadata {
    this.getCredential(credentialId)
    this.store.db.prepare("UPDATE credential_metadata SET status='disabled', updated_at=? WHERE id=?").run(now(), credentialId)
    return this.getCredential(credentialId)
  }

  internalProfile(profileId: string): ConnectionProfile {
    return this.getProfile(profileId)
  }

  recordTest(input: { profileId: string; status: ConnectionTestRun['status']; stage: string; message: string; latencyMs: number | null; details: Record<string, unknown> }): ConnectionTestRun {
    const profile = this.getProfile(input.profileId)
    const id = newId('ctr')
    const timestamp = now()
    this.store.db.prepare(
      `INSERT INTO connection_test_runs (id, profile_id, resource_id, status, stage, message, latency_ms, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, profile.id, profile.resourceId, input.status, input.stage, input.message, input.latencyMs, JSON.stringify(input.details), timestamp)
    this.store.db.prepare('UPDATE connection_profiles SET last_test_status=?, last_test_at=?, updated_at=? WHERE id=?').run(input.status, timestamp, timestamp, profile.id)
    return this.testRun(this.store.db.prepare('SELECT * FROM connection_test_runs WHERE id=?').get(id) as Row)
  }

  private getResource(id: string): Resource {
    const row = this.store.db.prepare('SELECT * FROM resources WHERE id=?').get(id) as Row | undefined
    if (!row) throw new AppError('NOT_FOUND', '资源不存在')
    return this.resource(row)
  }

  private getProfile(id: string): ConnectionProfile {
    const row = this.store.db.prepare('SELECT * FROM connection_profiles WHERE id=?').get(id) as Row | undefined
    if (!row) throw new AppError('NOT_FOUND', '连接 Profile 不存在')
    return this.profile(row)
  }

  private getCredential(id: string): CredentialMetadata {
    const row = this.store.db.prepare('SELECT * FROM credential_metadata WHERE id=?').get(id) as Row | undefined
    if (!row) throw new AppError('NOT_FOUND', '凭据不存在')
    return this.credential(row)
  }

  private assertCredentialForProject(credentialId: string, projectId: string): void {
    const credential = this.getCredential(credentialId)
    if (credential.projectId !== projectId) throw new AppError('FORBIDDEN', '凭据不属于该项目')
    if (credential.status !== 'active') throw new AppError('CONFLICT', '凭据已停用')
  }

  private assertProject(projectId: string): void {
    const row = this.store.db.prepare('SELECT id FROM projects WHERE id=?').get(projectId)
    if (!row) throw new AppError('NOT_FOUND', '项目不存在')
  }
}
