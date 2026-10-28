import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  AppError,
  newId,
  now,
  type ReleaseApprovalDecideInput,
  type ApprovalRequest,
  type ChangeRequest,
  type ChangeRequestEvent,
  type ChangeRequestLink,
  type ChangeRequestStatus,
  type CreateCandidateInput,
  type CreateChangeRequestInput,
  type CreateDeploymentInput,
  type CreateReleaseInput,
  
  type ConnectionProfile,
  type Resource,
  type Deployment,
  type DeploymentEvent,
  type DeploymentOperation,
  type DeploymentOperationState,
  type DeploymentOperationStep,
  type DeploymentOperationTrace,
  type DeploymentSource,
  type DeploymentStatus,
  type DeploymentStrategy,
  type DeploymentTarget,
  type RecordDeploymentResultInput,
  type Release,
  type ReleaseArtifact,
  type ReleaseCandidate,
  type ReleaseOverview,
  type UpdateChangeRequestInput,
} from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'
import { DELIVERY_ADAPTERS, LocalArtifactAdapter } from './delivery-adapters.js'

const CHANGE_SOURCE_STATUS: Record<string, string> = {
  draft: 'draft',
  awaiting_approval: 'awaiting_approval',
  approved: 'approved',
  rejected: 'rejected',
  changes_requested: 'changes_requested',
  cancelled: 'cancelled',
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function artifactHash(artifact: { contentHash?: string | null; body?: string | null; title: string; uri?: string | null }): string {
  if (artifact.uri && existsSync(artifact.uri)) return createHash('sha256').update(readFileSync(artifact.uri)).digest('hex')
  return artifact.contentHash?.trim() || createHash('sha256').update(`${artifact.title}\n${artifact.body ?? ''}`).digest('hex')
}

function parseJson(value: unknown, fallback: unknown): unknown {
  try {
    return JSON.parse(String(value ?? ''))
  } catch {
    return fallback
  }
}

function bool(value: unknown): boolean {
  return Number(value) === 1
}

export class ReleaseService {
  constructor(private readonly store: SqliteStore) {}

  overview(projectId: string, versionId: string): ReleaseOverview {
    const project = this.store.read.getProject(projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    const versions = this.store.read.listProductVersions(projectId)
    if (!versions.some((version) => version.id === versionId)) throw new AppError('NOT_FOUND', '版本不存在')
    const changeRequests = this.listChangeRequests(projectId, versionId)
    const approvals = this.listApprovals(projectId)
    const candidates = this.listCandidates(projectId, versionId)
    const releases = this.listReleases(projectId, versionId)
    const deployments = this.listDeployments(projectId, versionId)
    const environments = this.store.read.listEnvironments(projectId).map((environment) => ({
      id: environment.id,
      key: environment.key,
      name: environment.name,
      kind: environment.kind,
      protected: environment.protected,
    }))
    return {
      projectId,
      versionId,
      changeRequests,
      approvals: approvals.filter((approval) =>
        changeRequests.some((request) => request.id === approval.subjectId) ||
        deployments.some((deployment) => deployment.id === approval.subjectId),
      ),
      candidates,
      releases,
      deployments,
      environments,
      targets: this.listTargets(projectId),
      strategies: this.listStrategies(projectId),
      environmentVersions: this.store.read.listEnvironments(projectId).map((environment) => ({
        environmentId: environment.id,
        ...this.currentEnvironmentVersion(projectId, environment.id),
      })),
      capabilities: {
        canBuild: false,
        canExecuteDeployment: true,
        canImportDeployment: true,
        reason: '本地目录与 SSH/VPS Adapter 可执行；Pipeline/K8s/GitOps 远程连接未配置。',
      },
    }
  }

  listChangeRequests(projectId: string, versionId: string): ChangeRequest[] {
    return this.store.db
      .prepare('SELECT * FROM change_requests WHERE project_id = ? AND version_id = ? ORDER BY created_at DESC')
      .all(projectId, versionId)
      .map((row) => this.toChangeRequest(row))
  }

  createChangeRequest(input: CreateChangeRequestInput, actor = 'local-user'): ChangeRequest {
    return this.store.transaction(() => {
      const version = this.getVersion(input.projectId, input.versionId)
      if (input.targetEnvironmentId) this.assertEnvironment(input.projectId, input.targetEnvironmentId)
      const id = newId('crq')
      const timestamp = now()
      const content = {
        title: input.title,
        description: input.description,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        riskLevel: input.riskLevel,
        impactScope: input.impactScope,
        targetEnvironmentId: input.targetEnvironmentId,
        linkedArtifactIds: input.linkedArtifactIds,
        linkedTaskIds: input.linkedTaskIds,
      }
      this.store.db
        .prepare(
          `INSERT INTO change_requests
           (id, project_id, version_id, title, description, source_type, source_id, risk_level, impact_scope, target_environment_id, status, revision, content_fingerprint, requested_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.versionId,
          input.title,
          input.description,
          input.sourceType,
          input.sourceId,
          input.riskLevel,
          input.impactScope,
          input.targetEnvironmentId,
          fingerprint(content),
          actor,
          timestamp,
          timestamp,
        )
      for (const artifactId of input.linkedArtifactIds) {
        this.assertArtifact(input.projectId, artifactId)
        this.insertChangeLink(id, 'supports', 'artifact', artifactId, timestamp)
      }
      for (const taskId of input.linkedTaskIds) {
        const task = this.store.read.getTask(taskId)
        if (!task || task.projectId !== input.projectId) throw new AppError('NOT_FOUND', '关联任务不存在')
        this.insertChangeLink(id, 'includes', 'task', taskId, timestamp)
      }
      this.insertChangeEvent(id, 'created', '变更申请已创建', { revision: version.version }, actor, timestamp)
      return this.getChangeRequest(id)
    })
  }

  updateChangeRequest(input: UpdateChangeRequestInput, actor = 'local-user'): ChangeRequest {
    return this.store.transaction(() => {
      const existing = this.getChangeRequest(input.id)
      if (['rejected', 'cancelled'].includes(existing.status)) {
        throw new AppError('CONFLICT', '已拒绝或取消的变更申请不能编辑')
      }
      const content = {
        title: input.title ?? existing.title,
        description: input.description ?? existing.description,
        sourceType: input.sourceType ?? existing.sourceType,
        sourceId: input.sourceId ?? existing.sourceId,
        riskLevel: input.riskLevel ?? existing.riskLevel,
        impactScope: input.impactScope ?? existing.impactScope,
        targetEnvironmentId: input.targetEnvironmentId ?? existing.targetEnvironmentId,
        linkedArtifactIds: input.linkedArtifactIds ?? [],
        linkedTaskIds: input.linkedTaskIds ?? [],
      }
      if (content.targetEnvironmentId) this.assertEnvironment(existing.projectId, content.targetEnvironmentId)
      const nextFingerprint = fingerprint(content)
      const timestamp = now()
      this.store.db
        .prepare(
          `UPDATE change_requests SET title=?, description=?, source_type=?, source_id=?, risk_level=?, impact_scope=?, target_environment_id=?, revision=revision+1, content_fingerprint=?, status='draft', updated_at=? WHERE id=?`,
        )
        .run(
          content.title,
          content.description,
          content.sourceType,
          content.sourceId,
          content.riskLevel,
          content.impactScope,
          content.targetEnvironmentId,
          nextFingerprint,
          timestamp,
          existing.id,
        )
      this.store.db
        .prepare("UPDATE approval_requests SET status='superseded', decided_at=? WHERE subject_type='change_request' AND subject_id=? AND status IN ('pending','approved','changes_requested')")
        .run(timestamp, existing.id)
      this.store.db.prepare('DELETE FROM change_request_links WHERE change_request_id = ?').run(existing.id)
      for (const artifactId of content.linkedArtifactIds) this.insertChangeLink(existing.id, 'supports', 'artifact', artifactId, timestamp)
      for (const taskId of content.linkedTaskIds) this.insertChangeLink(existing.id, 'includes', 'task', taskId, timestamp)
      this.insertChangeEvent(existing.id, 'revised', '变更内容已修改，原审批失效', { revision: existing.revision + 1 }, actor, timestamp)
      return this.getChangeRequest(existing.id)
    })
  }

  submitChangeRequest(id: string, actor = 'local-user'): { changeRequest: ChangeRequest; approval: ApprovalRequest } {
    return this.store.transaction(() => {
      const request = this.getChangeRequest(id)
      if (!['draft', 'changes_requested'].includes(request.status)) {
        throw new AppError('CONFLICT', '当前状态不能提交审批')
      }
      if (!request.description.trim()) throw new AppError('BAD_REQUEST', '变更说明不能为空')
      const timestamp = now()
      const approval = this.createApproval(
        request.projectId,
        'change_request',
        request.id,
        request.revision,
        request.contentFingerprint,
        actor,
        timestamp,
      )
      this.store.db
        .prepare("UPDATE change_requests SET status='awaiting_approval', submitted_at=?, updated_at=? WHERE id=?")
        .run(timestamp, timestamp, request.id)
      this.insertChangeEvent(request.id, 'submitted', '变更已提交审批', { approvalId: approval.id, revision: request.revision }, actor, timestamp)
      return { changeRequest: this.getChangeRequest(request.id), approval }
    })
  }

  decideApproval(input: ReleaseApprovalDecideInput, actor = 'local-user'): ApprovalRequest {
    return this.store.transaction(() => {
      const approval = this.getApproval(input.approvalId)
      if (approval.status !== 'pending') throw new AppError('CONFLICT', '审批已处理，不能重复消费')
      if (approval.expiresAt && approval.expiresAt <= now()) {
        this.store.db.prepare("UPDATE approval_requests SET status='expired', decided_at=? WHERE id=? AND status='pending'").run(now(), approval.id)
        throw new AppError('CONFLICT', '审批已过期')
      }
      if (approval.subjectType === 'change_request') {
        const request = this.getChangeRequest(approval.subjectId)
        if (request.contentFingerprint !== approval.contentFingerprint || request.revision !== approval.subjectRevision) {
          this.store.db
            .prepare("UPDATE approval_requests SET status='superseded', decided_at=?, decided_by=?, decision_note=? WHERE id=? AND status='pending'")
            .run(now(), actor, '内容已变化，审批失效', approval.id)
          throw new AppError('CONFLICT', '变更内容已变化，原审批已失效，请重新提交')
        }
        const nextStatus: ChangeRequestStatus =
          input.decision === 'approved' ? 'approved' : input.decision === 'rejected' ? 'rejected' : 'changes_requested'
        const timestamp = now()
        this.store.db
          .prepare("UPDATE change_requests SET status=?, decided_at=?, updated_at=? WHERE id=?")
          .run(nextStatus, timestamp, timestamp, request.id)
        this.insertChangeEvent(request.id, input.decision, input.note || `变更审批：${input.decision}`, { approvalId: approval.id }, actor, timestamp)
      } else {
        const deployment = this.getDeployment(approval.subjectId)
        if (deployment.status !== 'awaiting_approval') throw new AppError('CONFLICT', '部署不在等待审批状态')
        const nextStatus: DeploymentStatus = input.decision === 'approved' ? 'pending' : 'cancelled'
        this.store.db
          .prepare('UPDATE deployments SET status=?, updated_at=? WHERE id=? AND status=?')
          .run(nextStatus, now(), deployment.id, 'awaiting_approval')
        this.appendDeploymentEvent(deployment.id, input.decision === 'approved' ? 'approved' : 'rejected', nextStatus, input.note, {
          approvalId: approval.id,
        })
      }
      const timestamp = now()
      this.store.db
        .prepare("UPDATE approval_requests SET status=?, decided_by=?, decision_note=?, decided_at=? WHERE id=? AND status='pending'")
        .run(input.decision, actor, input.note, timestamp, approval.id)
      return this.getApproval(approval.id)
    })
  }

  createCandidate(input: CreateCandidateInput, actor = 'local-user'): ReleaseCandidate {
    return this.store.transaction(() => {
      const version = this.getVersion(input.projectId, input.versionId)
      let changeRequest: ChangeRequest | null = null
      if (input.changeRequestId) {
        changeRequest = this.getChangeRequest(input.changeRequestId)
        if (changeRequest.projectId !== input.projectId || changeRequest.versionId !== input.versionId) {
          throw new AppError('CONFLICT', '变更申请不属于该版本')
        }
        if (changeRequest.status !== 'approved') throw new AppError('CONFLICT', '变更申请尚未批准，不能创建可发布候选')
      }
      const artifacts = this.snapshotArtifacts(input.projectId, input.artifactIds)
      const gate = this.latestGate(input.versionId)
      const gatePassed = gate?.status === 'passed'
      const git = this.readGit(version.projectId)
      const id = newId('rcd')
      const timestamp = now()
      const status = artifacts.length > 0 && gatePassed ? 'ready' : 'blocked'
      this.store.db
        .prepare(
          `INSERT INTO release_candidates
           (id, project_id, version_id, change_request_id, status, git_commit, git_branch, repository, artifacts_ready, gate_status, gate_evaluation_id, evidence_summary, notes, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.versionId,
          input.changeRequestId,
          status,
          git.commit,
          git.branch,
          git.root,
          artifacts.length > 0 ? 1 : 0,
          gatePassed ? 'passed' : gate ? 'failed' : 'missing',
          gate?.id ?? null,
          artifacts.length > 0 ? `${artifacts.length} 个真实 Artifact，构建制品未配置` : '没有关联制品',
          input.notes,
          actor,
          timestamp,
          timestamp,
        )
      for (const artifact of artifacts) {
        this.store.db
          .prepare(
            `INSERT INTO release_candidate_artifacts (id, candidate_id, artifact_id, name, kind, content_hash, size_bytes, uri, source, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(newId('rel'), id, artifact.artifactId, artifact.name, artifact.kind, artifact.contentHash, artifact.sizeBytes, artifact.uri, artifact.source, timestamp)
      }
      return this.getCandidate(id)
    })
  }

  createRelease(input: CreateReleaseInput, actor = 'local-user'): Release {
    return this.store.transaction(() => {
      const existing = this.store.db
        .prepare('SELECT * FROM releases WHERE idempotency_key = ?')
        .get(input.idempotencyKey) as Record<string, unknown> | undefined
      if (existing) return this.toRelease(existing)
      const candidate = this.getCandidate(input.candidateId)
      if (candidate.status !== 'ready') throw new AppError('CONFLICT', '发布候选尚未就绪，不能创建 Release')
      if (!candidate.artifacts.length) throw new AppError('CONFLICT', '发布候选没有不可变制品清单')
      if (candidate.gateStatus !== 'passed') throw new AppError('CONFLICT', '版本门禁未通过，不能创建 Release')
      if (candidate.changeRequestId) {
        const request = this.getChangeRequest(candidate.changeRequestId)
        if (request.status !== 'approved') throw new AppError('CONFLICT', '变更申请审批未通过或已失效')
        const approval = this.store.db
          .prepare("SELECT * FROM approval_requests WHERE subject_type='change_request' AND subject_id=? AND status='approved' ORDER BY decided_at DESC LIMIT 1")
          .get(request.id)
        if (!approval || String(approval.content_fingerprint) !== request.contentFingerprint) {
          throw new AppError('CONFLICT', '变更审批与当前内容不匹配')
        }
      }
      const version = this.getVersion(candidate.projectId, candidate.versionId)
      const id = newId('rel')
      const timestamp = now()
      const manifest = candidate.artifacts
      const manifestHash = fingerprint(manifest.map((artifact) => [artifact.name, artifact.contentHash]))
      this.store.db
        .prepare(
          `INSERT INTO releases
           (id, project_id, version_id, candidate_id, version, status, git_commit, notes, manifest_hash, distribution_status, external_receipt_json, idempotency_key, published_at, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'recorded', ?, ?, ?, 'not_distributed', '{}', ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          candidate.projectId,
          candidate.versionId,
          candidate.id,
          version.version,
          candidate.gitCommit,
          input.notes,
          manifestHash,
          input.idempotencyKey,
          timestamp,
          actor,
          timestamp,
          timestamp,
        )
      for (const artifact of manifest) {
        this.store.db
          .prepare(
            `INSERT INTO release_artifacts (id, release_id, artifact_id, name, kind, content_hash, size_bytes, uri, source, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(newId('rel'), id, artifact.artifactId, artifact.name, artifact.kind, artifact.contentHash, artifact.sizeBytes, artifact.uri, artifact.source, timestamp)
      }
      this.store.db.prepare("UPDATE release_candidates SET status='released', updated_at=? WHERE id=?").run(timestamp, candidate.id)
      return this.getRelease(id)
    })
  }

  listCandidates(projectId: string, versionId: string): ReleaseCandidate[] {
    return this.store.db
      .prepare('SELECT * FROM release_candidates WHERE project_id=? AND version_id=? ORDER BY created_at DESC')
      .all(projectId, versionId)
      .map((row) => this.toCandidate(row))
  }

  listReleases(projectId: string, versionId: string): Release[] {
    return this.store.db
      .prepare('SELECT * FROM releases WHERE project_id=? AND version_id=? ORDER BY created_at DESC')
      .all(projectId, versionId)
      .map((row) => this.toRelease(row))
  }

  listDeployments(projectId: string, versionId: string): Deployment[] {
    return this.store.db
      .prepare('SELECT * FROM deployments WHERE project_id=? AND version_id=? ORDER BY created_at DESC')
      .all(projectId, versionId)
      .map((row) => this.toDeployment(row))
  }

  listTargets(projectId: string): DeploymentTarget[] {
    return this.store.db
      .prepare('SELECT * FROM deployment_targets WHERE project_id=? ORDER BY created_at DESC')
      .all(projectId)
      .map((row) => this.toTarget(row))
  }

  listStrategies(projectId: string): DeploymentStrategy[] {
    return this.store.db
      .prepare('SELECT * FROM deployment_strategies WHERE project_id=? ORDER BY created_at DESC')
      .all(projectId)
      .map((row) => this.toStrategy(row))
  }

  createTarget(input: {
    projectId: string
    environmentId: string
    name: string
    kind: DeploymentTarget['kind']
    controlMode: DeploymentTarget['controlMode']
    adapterType?: string | null
    targetRef?: string
    resourceId?: string | null
    connectionProfileId?: string | null
    protected?: boolean
  }): DeploymentTarget {
    return this.store.transaction(() => {
      this.assertEnvironment(input.projectId, input.environmentId)
      const id = newId('dtg')
      const timestamp = now()
      this.store.db
        .prepare(
          `INSERT INTO deployment_targets (id, project_id, environment_id, name, kind, control_mode, adapter_type, target_ref, resource_id, connection_profile_id, protected, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, input.projectId, input.environmentId, input.name, input.kind, input.controlMode, input.adapterType ?? null, input.targetRef ?? '', input.resourceId ?? null, input.connectionProfileId ?? null, input.protected ? 1 : 0, timestamp, timestamp)
      return this.getTarget(id)
    })
  }

  createStrategy(input: {
    projectId: string
    environmentId: string
    targetId: string
    name: string
    adapterType: string
    source: DeploymentStrategy['source']
    requiresApproval?: boolean
  }): DeploymentStrategy {
    return this.store.transaction(() => {
      const target = this.getTarget(input.targetId)
      if (target.projectId !== input.projectId || target.environmentId !== input.environmentId) throw new AppError('CONFLICT', '部署目标与项目/环境不匹配')
      const id = newId('dst')
      const timestamp = now()
      this.store.db
        .prepare(
          `INSERT INTO deployment_strategies (id, project_id, environment_id, target_id, name, adapter_type, source, requires_approval, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(id, input.projectId, input.environmentId, input.targetId, input.name, input.adapterType, input.source, input.requiresApproval === false ? 0 : 1, timestamp, timestamp)
      return this.getStrategy(id)
    })
  }

  private deploymentAuthorization(releaseId: string, environmentId: string, targetId: string | null): { fingerprint: string; snapshot: Record<string, unknown> } {
    const release = this.getRelease(releaseId)
    const target = targetId ? this.getTarget(targetId) : null
    const profile = target?.connectionProfileId
      ? this.store.db.prepare('SELECT * FROM connection_profiles WHERE id=?').get(target.connectionProfileId) as Record<string, unknown> | undefined
      : undefined
    const resource = target?.resourceId
      ? this.store.db.prepare('SELECT * FROM resources WHERE id=?').get(target.resourceId) as Record<string, unknown> | undefined
      : undefined
    const artifacts = this.releaseArtifacts(releaseId)
      .map((artifact) => ({ id: artifact.id, name: artifact.name, contentHash: artifact.contentHash, uri: artifact.uri ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const snapshot = {
      releaseId: release.id,
      manifestHash: release.manifestHash,
      gitCommit: release.gitCommit ?? null,
      environmentId,
      target: target ? {
        id: target.id, name: target.name, kind: target.kind, controlMode: target.controlMode,
        adapterType: target.adapterType, targetRef: target.targetRef,
        resourceId: target.resourceId, connectionProfileId: target.connectionProfileId,
        protected: target.protected,
      } : null,
      resource: resource ? {
        id: String(resource.id), revision: Number(resource.revision ?? 1), status: String(resource.status),
        name: String(resource.name), endpoint: String(resource.endpoint),
      } : null,
      profile: profile ? {
        id: String(profile.id), revision: Number(profile.revision ?? 1), host: String(profile.host),
        port: Number(profile.port), username: String(profile.username), authType: String(profile.auth_type),
        credentialRef: profile.credential_ref ? String(profile.credential_ref) : null,
        hostKeyFingerprint: profile.host_key_fingerprint ? String(profile.host_key_fingerprint) : null,
        trustPolicy: String(profile.trust_policy),
      } : null,
      artifacts,
    }
    return { snapshot, fingerprint: fingerprint(snapshot) }
  }

  createDeployment(input: CreateDeploymentInput, actor = 'local-user'): Deployment {
    return this.store.transaction(() => {
      if (input.source === 'adapter') {
        throw new AppError('POLICY_DENIED', '当前没有可执行的部署适配器；不能伪造外部部署')
      }
      const existing = this.store.db
        .prepare('SELECT * FROM deployments WHERE project_id=? AND environment_id=? AND idempotency_key=?')
        .get(input.projectId, input.environmentId, input.idempotencyKey) as Record<string, unknown> | undefined
      if (existing) return this.toDeployment(existing)
      const release = this.getRelease(input.releaseId)
      if (release.projectId !== input.projectId) throw new AppError('CONFLICT', 'Release 不属于该项目')
      this.assertEnvironment(input.projectId, input.environmentId)
      if (input.targetId) {
        const target = this.getTarget(input.targetId)
        if (target.projectId !== input.projectId || target.environmentId !== input.environmentId) throw new AppError('CONFLICT', '部署目标与环境不匹配')
      }
      if (input.strategyId) {
        const strategy = this.getStrategy(input.strategyId)
        if (strategy.projectId !== input.projectId || strategy.environmentId !== input.environmentId) throw new AppError('CONFLICT', '部署策略与环境不匹配')
      }
      const timestamp = now()
      const id = newId('dep')
      const authorization = this.deploymentAuthorization(release.id, input.environmentId, input.targetId)
      const approval =
        input.source === 'unknown'
          ? null
          : this.createApproval(
              input.projectId,
              'deployment',
              id,
              1,
              authorization.fingerprint,
              actor,
              timestamp,
              authorization.snapshot,
            )
      const assurance =
        input.source === 'imported' ? 'source_observed' : input.source === 'unknown' ? 'self_declared' : 'self_declared'
      const status: DeploymentStatus = input.source === 'unknown' ? 'needs_reconciliation' : 'awaiting_approval'
      this.store.db
        .prepare(
          `INSERT INTO deployments
           (id, project_id, version_id, release_id, environment_id, target_id, strategy_id, status, source, assurance, idempotency_key, artifact_hash, external_id, receipt_json, execution_state, authorization_fingerprint, approval_id, rollback_of_deployment_id, notes, requested_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 'not_started', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          release.versionId,
          release.id,
          input.environmentId,
          input.targetId,
          input.strategyId,
          status,
          input.source,
          assurance,
          input.idempotencyKey,
          input.artifactHash ?? release.manifestHash,
          input.externalId,
          authorization.fingerprint,
          approval?.id ?? null,
          input.rollbackOfDeploymentId,
          input.notes,
          actor,
          timestamp,
          timestamp,
        )
      this.appendDeploymentEvent(id, 'created', status, `部署来源：${input.source}`, { source: input.source })
      return this.getDeployment(id)
    })
  }

  recordDeploymentResult(input: RecordDeploymentResultInput, actor = 'local-user'): Deployment {
    return this.store.transaction(() => {
      const deployment = this.getDeployment(input.deploymentId)
      if (['cancelled', 'rolled_back'].includes(deployment.status)) throw new AppError('CONFLICT', '该部署已结束，不能改写结果')
      if (deployment.source === 'adapter' && !input.receipt) throw new AppError('CONFLICT', '适配器部署缺少外部回执')
      const assurance = deployment.source === 'imported' ? 'source_observed' : 'self_declared'
      const timestamp = now()
      const result = this.store.db
        .prepare(
          `UPDATE deployments SET status=?, assurance=?, external_id=COALESCE(?, external_id), artifact_hash=COALESCE(?, artifact_hash), receipt_json=?, notes=?, started_at=COALESCE(started_at, ?), finished_at=?, updated_at=? WHERE id=?`,
        )
        .run(
          input.status,
          assurance,
          input.externalId,
          input.artifactHash,
          JSON.stringify(input.receipt),
          input.notes || deployment.notes,
          timestamp,
          timestamp,
          timestamp,
          deployment.id,
        )
      if (Number(result.changes) !== 1) throw new AppError('CONFLICT', '部署状态更新失败')
      this.appendDeploymentEvent(deployment.id, 'result_recorded', input.status, input.notes || `记录部署结果：${input.status}`, {
        externalId: input.externalId,
        source: deployment.source,
        assurance,
      })
      return this.getDeployment(deployment.id)
    })
  }

  createRollback(sourceDeploymentId: string, input: { idempotencyKey: string; targetReleaseId?: string | null; notes: string }, actor = 'local-user'): Deployment {
    return this.store.transaction(() => {
      const source = this.getDeployment(sourceDeploymentId)
      const previous = this.store.db.prepare(
        "SELECT release_id FROM deployments WHERE target_id=? AND environment_id=? AND id<>? AND release_id<>? AND status='succeeded' ORDER BY finished_at DESC LIMIT 1",
      ).get(source.targetId, source.environmentId, source.id, source.releaseId) as { release_id: string } | undefined
      const targetReleaseId = input.targetReleaseId ?? previous?.release_id
      if (!targetReleaseId) throw new AppError('CONFLICT', '没有可回滚的上一个成功 Release')
      const release = this.getRelease(targetReleaseId)
      const authorization = this.deploymentAuthorization(release.id, source.environmentId, source.targetId)
      const id = newId('dep')
      const timestamp = now()
      const approval = this.createApproval(
        source.projectId,
        'deployment',
        id,
        1,
        authorization.fingerprint,
        actor,
        timestamp,
        { ...authorization.snapshot, rollbackOfDeploymentId: source.id },
      )
      this.store.db
        .prepare(
          `INSERT INTO deployments
           (id, project_id, version_id, release_id, environment_id, target_id, strategy_id, status, source, assurance, idempotency_key, artifact_hash, receipt_json, execution_state, authorization_fingerprint, approval_id, rollback_of_deployment_id, previous_deployment_id, notes, requested_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'awaiting_approval', 'manual', 'self_declared', ?, ?, '{}', 'not_started', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          source.projectId,
          release.versionId,
          release.id,
          source.environmentId,
          source.targetId,
          source.strategyId,
          input.idempotencyKey,
          release.manifestHash,
          authorization.fingerprint,
          approval.id,
          source.id,
          source.id,
          input.notes || `回滚 ${source.id}`,
          actor,
          timestamp,
          timestamp,
        )
      this.appendDeploymentEvent(id, 'rollback_created', 'awaiting_approval', `回滚来源部署 ${source.id}`, { sourceDeploymentId: source.id })
      return this.getDeployment(id)
    })
  }

  inspectDeployment(deploymentId: string): { adapterType: string | null; targetId: string | null } {
    const deployment = this.getDeployment(deploymentId)
    const target = deployment.targetId ? this.getTarget(deployment.targetId) : null
    return { adapterType: target?.adapterType ?? null, targetId: deployment.targetId }
  }

  prepareDeployment(deploymentId: string) {
    const deployment = this.getDeployment(deploymentId)
    if (!deployment.targetId) throw new AppError('CONFLICT', '部署缺少目标')
    if (!deployment.approvalId) throw new AppError('POLICY_DENIED', '部署缺少独立授权')
    const approval = this.getApproval(deployment.approvalId)
    if (approval.status !== 'approved') throw new AppError('POLICY_DENIED', '部署授权未批准')
    const currentAuthorization = this.deploymentAuthorization(deployment.releaseId, deployment.environmentId, deployment.targetId)
    if (approval.contentFingerprint !== currentAuthorization.fingerprint || deployment.authorizationFingerprint !== currentAuthorization.fingerprint) {
      throw new AppError('POLICY_DENIED', '部署目标、凭据或制品已变化，原授权失效，需要重新审批')
    }
    const target = this.getTarget(deployment.targetId)
    const resourceRow = target.resourceId
      ? this.store.db.prepare('SELECT * FROM resources WHERE id=?').get(target.resourceId) as Record<string, unknown> | undefined
      : undefined
    if (resourceRow && String(resourceRow.status) !== 'active') throw new AppError('POLICY_DENIED', '资源已停用或归档')
    const profileRow = target.connectionProfileId
      ? this.store.db.prepare('SELECT * FROM connection_profiles WHERE id=?').get(target.connectionProfileId) as Record<string, unknown> | undefined
      : undefined
    if (target.connectionProfileId && !profileRow) throw new AppError('POLICY_DENIED', '连接 Profile 不存在')
    if (profileRow?.credential_ref) {
      const credential = this.store.db.prepare('SELECT status FROM credential_metadata WHERE id=?').get(String(profileRow.credential_ref)) as { status: string } | undefined
      if (!credential || credential.status !== 'active') throw new AppError('POLICY_DENIED', '凭据已停用')
    }
    // Resume an in-flight attempt instead of starting a second one. This makes the
    // remote side effect idempotent even when the renderer retries or Electron restarts.
    const inflight = this.store.db
      .prepare("SELECT * FROM deployment_operations WHERE deployment_id=? AND state IN ('prepared','executing') ORDER BY attempt DESC LIMIT 1")
      .get(deployment.id) as Record<string, unknown> | undefined
    if (inflight) {
      return this.prepareDeploymentPayload(deployment.id, target, resourceRow, profileRow, this.mapDeploymentOperation(inflight), true)
    }
    // An operation whose outcome is unknown must be reconciled first: repeating the
    // remote mutation could apply the same release twice or clobber a newer one.
    const unknownOperation = this.store.db
      .prepare("SELECT * FROM deployment_operations WHERE deployment_id=? AND state='unknown' ORDER BY attempt DESC LIMIT 1")
      .get(deployment.id) as Record<string, unknown> | undefined
    if (unknownOperation) {
      throw new AppError('CONFLICT', '上一次执行结果未知，必须先对账远程事实，禁止重复执行')
    }
    if (deployment.status !== 'pending') throw new AppError('CONFLICT', '只有已批准且待执行的部署才能执行')
    const attemptRow = this.store.db
      .prepare('SELECT MAX(attempt) AS attempt FROM deployment_operations WHERE deployment_id=?')
      .get(deployment.id) as { attempt: number | null } | undefined
    const attempt = Number(attemptRow?.attempt ?? 0) + 1
    const operationId = newId('dop')
    const operationKey = `${deployment.id}:${attempt}`
    const startedAt = now()
    const adapterType = target.adapterType ?? 'unknown'
    this.store.transaction(() => {
      this.store.db
        .prepare(
          `INSERT INTO deployment_operations
           (id, deployment_id, operation_key, attempt, adapter_type, target_ref, state, external_id, remote_facts_json, last_error, started_at, finished_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'prepared', NULL, '{}', NULL, ?, NULL, ?, ?)`,
        )
        .run(operationId, deployment.id, operationKey, attempt, adapterType, target.targetRef, startedAt, startedAt, startedAt)
      this.store.db
        .prepare("UPDATE deployments SET status='running', execution_state='running', started_at=?, active_operation_id=?, updated_at=? WHERE id=?")
        .run(startedAt, operationId, startedAt, deployment.id)
      this.appendDeploymentEvent(deployment.id, 'adapter_started', 'running', '受控 Adapter 开始执行', {
        targetId: target.id, operationId, operationKey, attempt,
      })
    })
    const operationRow = this.store.db.prepare('SELECT * FROM deployment_operations WHERE id=?').get(operationId) as Record<string, unknown>
    return this.prepareDeploymentPayload(deployment.id, target, resourceRow, profileRow, this.mapDeploymentOperation(operationRow), false)
  }

  private prepareDeploymentPayload(
    deploymentId: string,
    target: DeploymentTarget,
    resourceRow: Record<string, unknown> | undefined,
    profileRow: Record<string, unknown> | undefined,
    operation: DeploymentOperation,
    resumed: boolean,
  ) {
    const deployment = this.getDeployment(deploymentId)
    const release = this.getRelease(deployment.releaseId)
    return {
      deployment,
      target,
      profile: profileRow ? {
        id: String(profileRow.id), resourceId: String(profileRow.resource_id), name: String(profileRow.name),
        protocol: String(profileRow.protocol) as ConnectionProfile['protocol'], host: String(profileRow.host), port: Number(profileRow.port),
        username: String(profileRow.username), authType: String(profileRow.auth_type) as ConnectionProfile['authType'],
        credentialRef: profileRow.credential_ref ? String(profileRow.credential_ref) : null,
        hostKeyFingerprint: profileRow.host_key_fingerprint ? String(profileRow.host_key_fingerprint) : null,
        trustPolicy: String(profileRow.trust_policy) as ConnectionProfile['trustPolicy'], connectTimeoutMs: Number(profileRow.connect_timeout_ms),
        lastTestStatus: profileRow.last_test_status ? String(profileRow.last_test_status) : null,
        lastTestAt: profileRow.last_test_at ? Number(profileRow.last_test_at) : null, revision: Number(profileRow.revision ?? 1),
        createdAt: Number(profileRow.created_at), updatedAt: Number(profileRow.updated_at),
      } : null,
      resource: resourceRow ? {
        id: String(resourceRow.id), projectId: String(resourceRow.project_id), type: String(resourceRow.type) as Resource['type'],
        name: String(resourceRow.name), endpoint: String(resourceRow.endpoint), purpose: String(resourceRow.purpose),
        labels: parseJson(resourceRow.labels_json, []) as string[], metadata: parseJson(resourceRow.metadata_json, {}) as Record<string, unknown>,
        status: String(resourceRow.status) as Resource['status'], revision: Number(resourceRow.revision ?? 1),
        createdAt: Number(resourceRow.created_at), updatedAt: Number(resourceRow.updated_at),
      } : null,
      release,
      artifacts: this.releaseArtifacts(deployment.releaseId).map((artifact) => ({ name: artifact.name, uri: artifact.uri ?? null, contentHash: artifact.contentHash })),
      operation,
      resumed,
    }
  }

  finishDeployment(input: { deploymentId: string; operationId: string; status: DeploymentStatus; assurance: Deployment['assurance']; externalId: string | null; artifactHash: string | null; receipt: Record<string, unknown>; notes: string }): Deployment {
    const deployment = this.getDeployment(input.deploymentId)
    const operationRow = this.store.db.prepare('SELECT * FROM deployment_operations WHERE id=?').get(input.operationId) as Record<string, unknown> | undefined
    if (!operationRow) throw new AppError('NOT_FOUND', '执行操作不存在，不能写入回执')
    if (String(operationRow.deployment_id) !== deployment.id) throw new AppError('CONFLICT', '执行操作不属于该部署')
    const operationState = String(operationRow.state)
    if (operationState === 'confirmed' || operationState === 'failed') {
      // A retried IPC call must not rewrite an already-settled fact.
      return this.getDeployment(deployment.id)
    }
    const finishedAt = now()
    const executionState = input.status === 'succeeded' ? 'completed' : input.status === 'needs_reconciliation' || input.status === 'unknown' ? 'unknown' : 'failed'
    const nextOperationState: DeploymentOperationState = input.status === 'succeeded' ? 'confirmed' : 'failed'
    this.store.transaction(() => {
      this.store.db
        .prepare('UPDATE deployment_operations SET state=?, external_id=?, last_error=?, finished_at=?, updated_at=? WHERE id=?')
        .run(nextOperationState, input.externalId, input.status === 'succeeded' ? null : input.notes, finishedAt, finishedAt, input.operationId)
      this.store.db.prepare(
        "UPDATE deployments SET status=?, execution_state=?, assurance=?, external_id=?, artifact_hash=?, receipt_json=?, notes=?, finished_at=?, updated_at=? WHERE id=?",
      ).run(input.status, executionState, input.assurance, input.externalId, input.artifactHash, JSON.stringify(input.receipt), input.notes, finishedAt, finishedAt, deployment.id)
      this.appendDeploymentEvent(deployment.id, 'adapter_result', input.status, input.notes, { externalId: input.externalId, operationId: input.operationId })
    })
    return this.getDeployment(deployment.id)
  }

  recordOperationStep(input: {
    operationId: string
    phase: string
    status: 'started' | 'ok' | 'failed' | 'skipped'
    detail: string
    remoteRef: string | null
    durationMs: number | null
    state?: DeploymentOperationState
  }): DeploymentOperation {
    const row = this.store.db.prepare('SELECT * FROM deployment_operations WHERE id=?').get(input.operationId) as Record<string, unknown> | undefined
    if (!row) throw new AppError('NOT_FOUND', '执行操作不存在')
    const sequenceRow = this.store.db
      .prepare('SELECT COALESCE(MAX(sequence), -1) AS seq FROM deployment_operation_steps WHERE operation_id=?')
      .get(input.operationId) as { seq: number }
    const nowTs = now()
    this.store.transaction(() => {
      this.store.db
        .prepare(
          'INSERT INTO deployment_operation_steps (id, operation_id, sequence, phase, status, detail, remote_ref, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(newId('dos'), input.operationId, Number(sequenceRow.seq) + 1, input.phase, input.status, input.detail, input.remoteRef, input.durationMs, nowTs)
      const nextState = input.state ?? (input.status === 'started' ? 'executing' : undefined)
      if (nextState) {
        this.store.db
          .prepare('UPDATE deployment_operations SET state=?, updated_at=?, started_at=COALESCE(started_at, ?) WHERE id=? AND state NOT IN (\'confirmed\',\'failed\')')
          .run(nextState, nowTs, nowTs, input.operationId)
      } else {
        this.store.db.prepare('UPDATE deployment_operations SET updated_at=? WHERE id=?').run(nowTs, input.operationId)
      }
    })
    const refreshed = this.store.db.prepare('SELECT * FROM deployment_operations WHERE id=?').get(input.operationId) as Record<string, unknown>
    return this.mapDeploymentOperation(refreshed)
  }

  /**
   * Marks an attempt whose remote outcome cannot be confirmed locally. The deployment
   * moves to needs_reconciliation so nothing is blindly replayed; a human (or the
   * reconcile action) must establish the remote truth first.
   */
  markOperationUnknown(input: { operationId: string; reason: string; remoteFacts: Record<string, unknown> }): Deployment {
    const row = this.store.db.prepare('SELECT * FROM deployment_operations WHERE id=?').get(input.operationId) as Record<string, unknown> | undefined
    if (!row) throw new AppError('NOT_FOUND', '执行操作不存在')
    const deploymentId = String(row.deployment_id)
    if (String(row.state) === 'confirmed') return this.getDeployment(deploymentId)
    const timestamp = now()
    this.store.transaction(() => {
      this.store.db
        .prepare("UPDATE deployment_operations SET state='unknown', last_error=?, remote_facts_json=?, finished_at=?, updated_at=? WHERE id=?")
        .run(input.reason, JSON.stringify(input.remoteFacts), timestamp, timestamp, input.operationId)
      this.store.db
        .prepare("UPDATE deployments SET status='needs_reconciliation', execution_state='unknown', notes=?, updated_at=? WHERE id=? AND status NOT IN ('succeeded','rolled_back')")
        .run(input.reason, timestamp, deploymentId)
      this.appendDeploymentEvent(deploymentId, 'needs_reconciliation', 'needs_reconciliation', input.reason, {
        operationId: input.operationId, remoteFacts: input.remoteFacts,
      })
    })
    return this.getDeployment(deploymentId)
  }

  /**
   * Records the outcome of an out-of-band remote observation (see the Main process
   * reconcile action). Only reachable from needs_reconciliation/unknown/running.
   */
  reconcileDeployment(input: {
    deploymentId: string
    observation: { reachable: boolean; externalId: string | null; healthOk: boolean; detail: string; facts: Record<string, unknown> }
    note: string
  }): Deployment {
    const deployment = this.getDeployment(input.deploymentId)
    const allowed = ['needs_reconciliation', 'unknown', 'running', 'pending', 'failed']
    if (!allowed.includes(deployment.status)) throw new AppError('CONFLICT', `当前状态 ${deployment.status} 不需要对账`)
    const timestamp = now()
    const succeeded = input.observation.reachable && input.observation.healthOk && Boolean(input.observation.externalId)
    const status: DeploymentStatus = succeeded ? 'succeeded' : 'needs_reconciliation'
    const receipt = {
      ...(deployment.receipt ?? {}),
      reconciledAt: timestamp,
      reconcile: input.observation.facts,
      health: { ok: input.observation.healthOk, detail: input.observation.detail },
      note: input.note,
    }
    this.store.transaction(() => {
      const operation = this.store.db
        .prepare("SELECT * FROM deployment_operations WHERE deployment_id=? AND state IN ('unknown','executing','prepared') ORDER BY attempt DESC LIMIT 1")
        .get(deployment.id) as Record<string, unknown> | undefined
      if (operation) {
        this.store.db
          .prepare('UPDATE deployment_operations SET state=?, external_id=?, remote_facts_json=?, finished_at=?, updated_at=? WHERE id=?')
          .run(succeeded ? 'confirmed' : 'unknown', input.observation.externalId, JSON.stringify(input.observation.facts), timestamp, timestamp, String(operation.id))
      }
      this.store.db
        .prepare(
          'UPDATE deployments SET status=?, execution_state=?, assurance=?, external_id=COALESCE(?, external_id), receipt_json=?, notes=?, finished_at=?, updated_at=? WHERE id=?',
        )
        .run(
          status,
          succeeded ? 'completed' : 'unknown',
          succeeded ? 'externally_confirmed' : 'source_observed',
          input.observation.externalId,
          JSON.stringify(receipt),
          input.note || input.observation.detail,
          succeeded ? timestamp : null,
          timestamp,
          deployment.id,
        )
      this.appendDeploymentEvent(deployment.id, 'reconciled', status, input.note || input.observation.detail, {
        reachable: input.observation.reachable,
        externalId: input.observation.externalId,
        healthOk: input.observation.healthOk,
      })
    })
    return this.getDeployment(deployment.id)
  }

  /** Read-only context used by reconciliation: no status transition, no operation created. */
  deploymentContext(deploymentId: string): { deployment: Deployment; target: DeploymentTarget | null; profile: ConnectionProfile | null } {
    const deployment = this.getDeployment(deploymentId)
    const target = deployment.targetId ? this.getTarget(deployment.targetId) : null
    let profile: ConnectionProfile | null = null
    if (target?.connectionProfileId) {
      const row = this.store.db.prepare('SELECT * FROM connection_profiles WHERE id=?').get(target.connectionProfileId) as Record<string, unknown> | undefined
      if (row) {
        profile = {
          id: String(row.id), resourceId: String(row.resource_id), name: String(row.name),
          protocol: String(row.protocol) as ConnectionProfile['protocol'], host: String(row.host), port: Number(row.port),
          username: String(row.username), authType: String(row.auth_type) as ConnectionProfile['authType'],
          credentialRef: row.credential_ref ? String(row.credential_ref) : null,
          hostKeyFingerprint: row.host_key_fingerprint ? String(row.host_key_fingerprint) : null,
          trustPolicy: String(row.trust_policy) as ConnectionProfile['trustPolicy'], connectTimeoutMs: Number(row.connect_timeout_ms),
          lastTestStatus: row.last_test_status ? String(row.last_test_status) : null,
          lastTestAt: row.last_test_at ? Number(row.last_test_at) : null, revision: Number(row.revision ?? 1),
          createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
        }
      }
    }
    return { deployment, target, profile }
  }

  deploymentOperations(deploymentId: string): DeploymentOperationTrace {
    this.getDeployment(deploymentId)
    const operations = this.store.db
      .prepare('SELECT * FROM deployment_operations WHERE deployment_id=? ORDER BY attempt ASC')
      .all(deploymentId) as Record<string, unknown>[]
    const steps = operations.length
      ? (this.store.db
          .prepare(
            `SELECT * FROM deployment_operation_steps WHERE operation_id IN (${operations.map(() => '?').join(',')}) ORDER BY operation_id, sequence ASC`,
          )
          .all(...operations.map((operation) => String(operation.id))) as Record<string, unknown>[])
      : []
    return { operations: operations.map((row) => this.mapDeploymentOperation(row)), steps: steps.map((row) => this.mapDeploymentStep(row)) }
  }

  private mapDeploymentOperation(row: Record<string, unknown>): DeploymentOperation {
    return {
      id: String(row.id),
      deploymentId: String(row.deployment_id),
      operationKey: String(row.operation_key),
      attempt: Number(row.attempt),
      adapterType: String(row.adapter_type),
      targetRef: String(row.target_ref),
      state: String(row.state) as DeploymentOperationState,
      externalId: row.external_id ? String(row.external_id) : null,
      remoteFacts: parseJson(row.remote_facts_json, {}) as Record<string, unknown>,
      lastError: row.last_error ? String(row.last_error) : null,
      startedAt: row.started_at ? Number(row.started_at) : null,
      finishedAt: row.finished_at ? Number(row.finished_at) : null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }

  private mapDeploymentStep(row: Record<string, unknown>): DeploymentOperationStep {
    return {
      id: String(row.id),
      operationId: String(row.operation_id),
      sequence: Number(row.sequence),
      phase: String(row.phase),
      status: String(row.status),
      detail: String(row.detail ?? ''),
      remoteRef: row.remote_ref ? String(row.remote_ref) : null,
      durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
      createdAt: Number(row.created_at),
    }
  }

  /**
   * Runs an in-process adapter (local-artifact only). It reuses prepareDeployment
   * so both execution paths share one authorization check and one operation record.
   * Remote adapters must go through the Main process, which owns credentials.
   */
  async executeDeployment(deploymentId: string): Promise<Deployment> {
    const prepared = this.prepareDeployment(deploymentId)
    const target = prepared.target
    if (!target) throw new AppError('CONFLICT', '部署缺少目标')
    if (target.adapterType !== 'local-artifact' && target.kind !== 'local') {
      throw new AppError('POLICY_DENIED', '远程目标必须在 Main 进程内执行，Runtime 不持有凭据')
    }
    const adapter = DELIVERY_ADAPTERS.find((item) => item.type === 'local-artifact') as LocalArtifactAdapter | undefined
    if (!adapter) throw new AppError('INTERNAL', '部署 Adapter 未注册')
    const operation = prepared.operation
    try {
      const result = await adapter.execute({
        deploymentId: prepared.deployment.id,
        targetPath: target.targetRef,
        artifacts: prepared.artifacts.map((artifact) => ({ name: artifact.name, uri: artifact.uri, contentHash: artifact.contentHash })),
      })
      this.recordOperationStep({
        operationId: operation.id, phase: 'adapter', status: result.status === 'succeeded' ? 'ok' : 'failed',
        detail: result.health.detail, remoteRef: result.externalId, durationMs: null,
      })
      return this.finishDeployment({
        deploymentId: prepared.deployment.id,
        operationId: operation.id,
        status: result.status,
        assurance: result.assurance,
        externalId: result.externalId,
        artifactHash: result.artifactHash,
        receipt: { ...result.receipt, health: result.health },
        notes: result.health.detail,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.recordOperationStep({
        operationId: operation.id, phase: 'adapter', status: 'failed', detail: message, remoteRef: null, durationMs: null,
      })
      // The local adapter stages into a fresh per-deployment directory, so a failure
      // leaves no ambiguous partial state: record it as a clean, retryable failure.
      this.finishDeployment({
        deploymentId: prepared.deployment.id,
        operationId: operation.id,
        status: 'failed',
        assurance: 'self_declared',
        externalId: null,
        artifactHash: null,
        receipt: {},
        notes: `本地 Adapter 执行失败：${message}`,
      })
      throw new AppError('CONFLICT', `本地 Adapter 执行失败：${message}`)
    }
  }

  adapterCapabilities(): Array<{ type: string; label: string; capabilities: (typeof DELIVERY_ADAPTERS)[number]['capabilities'] }> {
    return DELIVERY_ADAPTERS.map((adapter) => ({ type: adapter.type, label: adapter.label, capabilities: adapter.capabilities }))
  }

  currentEnvironmentVersion(projectId: string, environmentId: string): { releaseId: string | null; deploymentId: string | null; assurance: string | null } {
    this.assertEnvironment(projectId, environmentId)
    const row = this.store.db
      .prepare(
        `SELECT id, release_id, assurance FROM deployments
         WHERE project_id=? AND environment_id=? AND status='succeeded' AND assurance IN ('source_observed','independently_reproduced','externally_confirmed')
         ORDER BY finished_at DESC, created_at DESC LIMIT 1`,
      )
      .get(projectId, environmentId) as Record<string, unknown> | undefined
    return row
      ? { releaseId: String(row.release_id), deploymentId: String(row.id), assurance: String(row.assurance) }
      : { releaseId: null, deploymentId: null, assurance: null }
  }

  private createApproval(
    projectId: string,
    subjectType: 'change_request' | 'deployment',
    subjectId: string,
    revision: number,
    contentFingerprint: string,
    actor: string,
    timestamp: number,
    snapshot: Record<string, unknown> = {},
  ): ApprovalRequest {
    const id = newId('apr')
    this.store.db
      .prepare(
        `INSERT INTO approval_requests (id, project_id, subject_type, subject_id, subject_revision, content_fingerprint, subject_snapshot_json, status, requested_by, requested_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .run(id, projectId, subjectType, subjectId, revision, contentFingerprint, JSON.stringify(snapshot), actor, timestamp, timestamp + 7 * 24 * 3600 * 1000)
    return this.getApproval(id)
  }

  private getApproval(id: string): ApprovalRequest {
    const row = this.store.db.prepare('SELECT * FROM approval_requests WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (!row) throw new AppError('NOT_FOUND', '审批不存在')
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      subjectType: String(row.subject_type) as ApprovalRequest['subjectType'],
      subjectId: String(row.subject_id),
      subjectRevision: Number(row.subject_revision),
      subjectTitle: null,
      contentFingerprint: String(row.content_fingerprint),
      status: String(row.status) as ApprovalRequest['status'],
      requestedBy: String(row.requested_by),
      decidedBy: row.decided_by ? String(row.decided_by) : null,
      decisionNote: row.decision_note ? String(row.decision_note) : null,
      requestedAt: Number(row.requested_at),
      decidedAt: row.decided_at ? Number(row.decided_at) : null,
      expiresAt: row.expires_at ? Number(row.expires_at) : null,
    }
  }

  listApprovals(projectId: string): ApprovalRequest[] {
    return this.store.db
      .prepare('SELECT * FROM approval_requests WHERE project_id=? ORDER BY requested_at DESC')
      .all(projectId)
      .map((row) => {
        const approval = this.getApproval(String((row as Record<string, unknown>).id))
        if (approval.subjectType === 'change_request') {
          const request = this.store.db.prepare('SELECT title FROM change_requests WHERE id=?').get(approval.subjectId) as { title: string } | undefined
          return { ...approval, subjectTitle: request?.title ?? null }
        }
        const deployment = this.store.db
          .prepare('SELECT d.id, e.name AS environment_name FROM deployments d LEFT JOIN environments e ON e.id=d.environment_id WHERE d.id=?')
          .get(approval.subjectId) as { id: string; environment_name: string | null } | undefined
        return { ...approval, subjectTitle: deployment ? `部署 · ${deployment.environment_name ?? deployment.id}` : null }
      })
  }

  private getChangeRequest(id: string): ChangeRequest {
    const row = this.store.db.prepare('SELECT * FROM change_requests WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (!row) throw new AppError('NOT_FOUND', '变更申请不存在')
    return this.toChangeRequest(row)
  }

  private toChangeRequest(row: Record<string, unknown>): ChangeRequest {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      versionId: String(row.version_id),
      title: String(row.title),
      description: String(row.description ?? ''),
      sourceType: String(row.source_type) as ChangeRequest['sourceType'],
      sourceId: row.source_id ? String(row.source_id) : null,
      riskLevel: String(row.risk_level) as ChangeRequest['riskLevel'],
      impactScope: String(row.impact_scope ?? ''),
      targetEnvironmentId: row.target_environment_id ? String(row.target_environment_id) : null,
      status: String(row.status) as ChangeRequestStatus,
      revision: Number(row.revision),
      contentFingerprint: String(row.content_fingerprint),
      requestedBy: String(row.requested_by),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      submittedAt: row.submitted_at ? Number(row.submitted_at) : null,
      decidedAt: row.decided_at ? Number(row.decided_at) : null,
    }
  }

  private getCandidate(id: string): ReleaseCandidate {
    const row = this.store.db.prepare('SELECT * FROM release_candidates WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (!row) throw new AppError('NOT_FOUND', '发布候选不存在')
    return this.toCandidate(row)
  }

  private toCandidate(row: Record<string, unknown>): ReleaseCandidate {
    const id = String(row.id)
    return {
      id,
      projectId: String(row.project_id),
      versionId: String(row.version_id),
      changeRequestId: row.change_request_id ? String(row.change_request_id) : null,
      status: String(row.status) as ReleaseCandidate['status'],
      gitCommit: row.git_commit ? String(row.git_commit) : null,
      gitBranch: row.git_branch ? String(row.git_branch) : null,
      repository: row.repository ? String(row.repository) : null,
      artifactsReady: bool(row.artifacts_ready),
      gateStatus: String(row.gate_status) as ReleaseCandidate['gateStatus'],
      gateEvaluationId: row.gate_evaluation_id ? String(row.gate_evaluation_id) : null,
      artifacts: this.candidateArtifacts(id),
      evidenceSummary: String(row.evidence_summary ?? ''),
      notes: String(row.notes ?? ''),
      createdBy: String(row.created_by),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }

  private candidateArtifacts(candidateId: string): ReleaseArtifact[] {
    return this.store.db
      .prepare('SELECT * FROM release_candidate_artifacts WHERE candidate_id=? ORDER BY created_at')
      .all(candidateId)
      .map((row) => this.toReleaseArtifact(row))
  }

  private toReleaseArtifact(row: Record<string, unknown>): ReleaseArtifact {
    return {
      id: String(row.id),
      artifactId: row.artifact_id ? String(row.artifact_id) : null,
      name: String(row.name),
      kind: String(row.kind),
      contentHash: String(row.content_hash),
      sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
      uri: row.uri ? String(row.uri) : null,
      source: String(row.source),
      createdAt: Number(row.created_at),
    }
  }

  private getRelease(id: string): Release {
    const row = this.store.db.prepare('SELECT * FROM releases WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (!row) throw new AppError('NOT_FOUND', 'Release 不存在')
    return this.toRelease(row)
  }

  private toRelease(row: Record<string, unknown>): Release {
    const id = String(row.id)
    return {
      id,
      projectId: String(row.project_id),
      versionId: String(row.version_id),
      candidateId: String(row.candidate_id),
      version: String(row.version),
      status: String(row.status) as Release['status'],
      gitCommit: row.git_commit ? String(row.git_commit) : null,
      notes: String(row.notes ?? ''),
      artifactManifest: this.releaseArtifacts(id),
      manifestHash: String(row.manifest_hash),
      distributionStatus: String(row.distribution_status) as Release['distributionStatus'],
      externalReceipt: parseJson(row.external_receipt_json, {}) as Record<string, unknown>,
      publishedAt: Number(row.published_at),
      createdBy: String(row.created_by),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }

  private releaseArtifacts(releaseId: string): ReleaseArtifact[] {
    return this.store.db
      .prepare('SELECT * FROM release_artifacts WHERE release_id=? ORDER BY created_at')
      .all(releaseId)
      .map((row) => this.toReleaseArtifact(row))
  }

  private getDeployment(id: string): Deployment {
    const row = this.store.db.prepare('SELECT * FROM deployments WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (!row) throw new AppError('NOT_FOUND', '部署不存在')
    return this.toDeployment(row)
  }

  private toDeployment(row: Record<string, unknown>): Deployment {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      versionId: String(row.version_id),
      releaseId: String(row.release_id),
      environmentId: String(row.environment_id),
      targetId: row.target_id ? String(row.target_id) : null,
      strategyId: row.strategy_id ? String(row.strategy_id) : null,
      status: String(row.status) as DeploymentStatus,
      source: String(row.source) as DeploymentSource,
      assurance: String(row.assurance) as Deployment['assurance'],
      idempotencyKey: String(row.idempotency_key),
      artifactHash: row.artifact_hash ? String(row.artifact_hash) : null,
      externalId: row.external_id ? String(row.external_id) : null,
      receipt: parseJson(row.receipt_json, {}) as Record<string, unknown>,
      executionState: String(row.execution_state ?? 'not_started'),
      authorizationFingerprint: row.authorization_fingerprint ? String(row.authorization_fingerprint) : null,
      approvalId: row.approval_id ? String(row.approval_id) : null,
      rollbackOfDeploymentId: row.rollback_of_deployment_id ? String(row.rollback_of_deployment_id) : null,
      previousDeploymentId: row.previous_deployment_id ? String(row.previous_deployment_id) : null,
      notes: String(row.notes ?? ''),
      requestedBy: String(row.requested_by),
      startedAt: row.started_at ? Number(row.started_at) : null,
      finishedAt: row.finished_at ? Number(row.finished_at) : null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }

  private getTarget(id: string): DeploymentTarget {
    const row = this.store.db.prepare('SELECT * FROM deployment_targets WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (!row) throw new AppError('NOT_FOUND', '部署目标不存在')
    return this.toTarget(row)
  }

  private toTarget(row: Record<string, unknown>): DeploymentTarget {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      environmentId: String(row.environment_id),
      name: String(row.name),
      kind: String(row.kind) as DeploymentTarget['kind'],
      controlMode: String(row.control_mode) as DeploymentTarget['controlMode'],
      adapterType: row.adapter_type ? String(row.adapter_type) : null,
      targetRef: String(row.target_ref ?? ''),
      resourceId: row.resource_id ? String(row.resource_id) : null,
      connectionProfileId: row.connection_profile_id ? String(row.connection_profile_id) : null,
      protected: bool(row.protected),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }

  private getStrategy(id: string): DeploymentStrategy {
    const row = this.store.db.prepare('SELECT * FROM deployment_strategies WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (!row) throw new AppError('NOT_FOUND', '部署策略不存在')
    return this.toStrategy(row)
  }

  private toStrategy(row: Record<string, unknown>): DeploymentStrategy {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      environmentId: String(row.environment_id),
      targetId: String(row.target_id),
      name: String(row.name),
      adapterType: String(row.adapter_type),
      source: String(row.source) as DeploymentStrategy['source'],
      requiresApproval: bool(row.requires_approval),
      enabled: bool(row.enabled),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }

  private snapshotArtifacts(projectId: string, artifactIds: string[]): ReleaseArtifact[] {
    const result: ReleaseArtifact[] = []
    for (const artifactId of artifactIds) {
      const artifact = this.assertArtifact(projectId, artifactId)
      result.push({
        id: newId('rel'),
        artifactId: artifact.id,
        name: artifact.title,
        kind: artifact.kind,
        contentHash: artifactHash(artifact),
        sizeBytes: artifact.body ? Buffer.byteLength(artifact.body, 'utf8') : null,
        uri: artifact.uri,
        source: 'artifact',
        createdAt: now(),
      })
    }
    return result
  }

  private assertArtifact(projectId: string, artifactId: string) {
    const artifact = this.store.read.listArtifacts(projectId).find((item) => item.id === artifactId)
    if (!artifact) throw new AppError('NOT_FOUND', 'Artifact 不存在')
    return artifact
  }

  private latestGate(versionId: string): { id: string; status: string } | null {
    const row = this.store.db
      .prepare("SELECT id, status FROM gate_evaluations WHERE subject_type='version' AND subject_id=? ORDER BY evaluated_at DESC, rowid DESC LIMIT 1")
      .get(versionId) as Record<string, unknown> | undefined
    return row ? { id: String(row.id), status: String(row.status) } : null
  }

  private getVersion(projectId: string, versionId: string) {
    const version = this.store.read.listProductVersions(projectId).find((item) => item.id === versionId)
    if (!version) throw new AppError('NOT_FOUND', '版本不存在')
    return version
  }

  private assertEnvironment(projectId: string, environmentId: string): void {
    if (!this.store.read.listEnvironments(projectId).some((environment) => environment.id === environmentId)) {
      throw new AppError('NOT_FOUND', '环境不存在或不属于该项目')
    }
  }

  private readGit(projectId: string): { commit: string | null; branch: string | null; root: string | null } {
    const project = this.store.read.getProject(projectId)
    if (!project) return { commit: null, branch: null, root: null }
    try {
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project.rootPath, encoding: 'utf8' }).trim()
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: project.rootPath, encoding: 'utf8' }).trim()
      return { commit, branch, root: project.rootPath }
    } catch {
      return { commit: null, branch: null, root: project.rootPath }
    }
  }

  private insertChangeLink(changeRequestId: string, linkType: string, targetType: string, targetId: string, timestamp: number): void {
    this.store.db
      .prepare('INSERT INTO change_request_links (id, change_request_id, link_type, target_type, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId('crq'), changeRequestId, linkType, targetType, targetId, timestamp)
  }

  private insertChangeEvent(changeRequestId: string, eventType: string, message: string, payload: Record<string, unknown>, actor: string, timestamp: number): void {
    this.store.db
      .prepare('INSERT INTO change_request_events (id, change_request_id, event_type, message, payload_json, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId('crq'), changeRequestId, eventType, message, JSON.stringify(payload), actor, timestamp)
  }

  private appendDeploymentEvent(deploymentId: string, type: string, status: string | null, message: string, payload: Record<string, unknown>): void {
    this.store.db
      .prepare('INSERT INTO deployment_events (id, deployment_id, type, status, message, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId('dep'), deploymentId, type, status, message, JSON.stringify(payload), now())
  }
}
