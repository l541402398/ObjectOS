import { execFileSync } from 'node:child_process'
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
  
  type Deployment,
  type DeploymentEvent,
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

function artifactHash(artifact: { contentHash?: string | null; body?: string | null; title: string }): string {
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
        canExecuteDeployment: false,
        canImportDeployment: true,
        reason: '当前版本没有配置构建系统或部署适配器；发布记录与导入部署可登记，外部执行标记为不可用。',
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
    protected?: boolean
  }): DeploymentTarget {
    return this.store.transaction(() => {
      this.assertEnvironment(input.projectId, input.environmentId)
      const id = newId('dtg')
      const timestamp = now()
      this.store.db
        .prepare(
          `INSERT INTO deployment_targets (id, project_id, environment_id, name, kind, control_mode, adapter_type, target_ref, protected, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, input.projectId, input.environmentId, input.name, input.kind, input.controlMode, input.adapterType ?? null, input.targetRef ?? '', input.protected ? 1 : 0, timestamp, timestamp)
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
      const approval =
        input.source === 'unknown'
          ? null
          : this.createApproval(
              input.projectId,
              'deployment',
              id,
              1,
              fingerprint({ releaseId: release.id, environmentId: input.environmentId, targetId: input.targetId, source: input.source, artifactHash: input.artifactHash }),
              actor,
              timestamp,
            )
      const assurance =
        input.source === 'imported' ? 'source_observed' : input.source === 'unknown' ? 'self_declared' : 'self_declared'
      const status: DeploymentStatus = input.source === 'unknown' ? 'needs_reconciliation' : 'awaiting_approval'
      this.store.db
        .prepare(
          `INSERT INTO deployments
           (id, project_id, version_id, release_id, environment_id, target_id, strategy_id, status, source, assurance, idempotency_key, artifact_hash, external_id, receipt_json, approval_id, rollback_of_deployment_id, notes, requested_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?)`,
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
      const targetReleaseId = input.targetReleaseId ?? source.releaseId
      const release = this.getRelease(targetReleaseId)
      const id = newId('dep')
      const timestamp = now()
      const approval = this.createApproval(
        source.projectId,
        'deployment',
        id,
        1,
        fingerprint({ sourceDeploymentId, targetReleaseId, environmentId: source.environmentId, rollback: true }),
        actor,
        timestamp,
      )
      this.store.db
        .prepare(
          `INSERT INTO deployments
           (id, project_id, version_id, release_id, environment_id, target_id, strategy_id, status, source, assurance, idempotency_key, artifact_hash, receipt_json, approval_id, rollback_of_deployment_id, previous_deployment_id, notes, requested_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'awaiting_approval', 'manual', 'self_declared', ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?)`,
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
  ): ApprovalRequest {
    const id = newId('apr')
    this.store.db
      .prepare(
        `INSERT INTO approval_requests (id, project_id, subject_type, subject_id, subject_revision, content_fingerprint, status, requested_by, requested_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .run(id, projectId, subjectType, subjectId, revision, contentFingerprint, actor, timestamp, timestamp + 7 * 24 * 3600 * 1000)
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

  private listApprovals(projectId: string): ApprovalRequest[] {
    return this.store.db
      .prepare('SELECT * FROM approval_requests WHERE project_id=? ORDER BY requested_at DESC')
      .all(projectId)
      .map((row) => this.getApproval(String((row as Record<string, unknown>).id)))
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
