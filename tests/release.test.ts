import { afterEach, describe, expect, it } from 'vitest'
import { LifecycleService } from '../apps/runtime/src/lifecycle.js'
import { ReleaseService } from '../apps/runtime/src/release-service.js'
import { createGitProject, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

async function preparedProject() {
  const harness = setup()
  cleanups.push(harness.close)
  const project = await createGitProject(harness.services, harness.dataDir, `phase2-${Math.random().toString(36).slice(2, 8)}`)
  const lifecycle = new LifecycleService(harness.store)
  const release = new ReleaseService(harness.store)
  const overview = lifecycle.overview(project.id)
  const version = overview.versions[0]!
  const environment = lifecycle.createEnvironment({
    projectId: project.id,
    key: 'staging',
    name: 'Staging',
    kind: 'staging',
    protected: false,
  })
  lifecycle.recordEvidence({
    projectId: project.id,
    subjectType: 'version',
    subjectId: version.id,
    evidenceType: 'review_record',
    verificationStatus: 'passed',
    assurance: 'self_declared',
    title: 'review',
    summary: 'reviewed',
    provenance: { sourceSystem: 'test' },
  })
  if (version.phase === 'planned') lifecycle.transitionVersion({ versionId: version.id, to: 'discovery' })
  if (lifecycle.overview(project.id).versions.find((item) => item.id === version.id)?.phase === 'discovery') {
    lifecycle.transitionVersion({ versionId: version.id, to: 'build' })
  }
  lifecycle.recordEvidence({
    projectId: project.id,
    subjectType: 'version',
    subjectId: version.id,
    evidenceType: 'test_report',
    verificationStatus: 'passed',
    assurance: 'source_observed',
    title: 'test report',
    summary: 'npm test exit 0',
    provenance: { command: 'npm test', exitCode: 0 },
  })
  const currentPhase = lifecycle.overview(project.id).versions.find((item) => item.id === version.id)?.phase
  if (currentPhase === 'build') lifecycle.transitionVersion({ versionId: version.id, to: 'verify' })
  const artifact = await harness.services.projects.createArtifact({
    projectId: project.id,
    taskId: null,
    runId: null,
    kind: 'test-report',
    title: 'phase2 test report',
    body: 'npm test exit 0',
    uri: null,
    metadata: {},
  })
  return { harness, project, version, environment, lifecycle, release, artifact }
}

describe('Phase 2 release and deployment domain', () => {
  it('creates a change request, candidate, immutable release and records deployment provenance', async () => {
    const { harness, project, version, environment, release, artifact } = await preparedProject()
    const request = release.createChangeRequest({
      projectId: project.id,
      versionId: version.id,
      title: 'Release 0.1.0',
      description: 'First release',
      sourceType: 'manual',
      sourceId: null,
      riskLevel: 'low',
      impactScope: 'staging',
      targetEnvironmentId: environment.id,
      linkedArtifactIds: [artifact.id],
      linkedTaskIds: [],
    })
    const submitted = release.submitChangeRequest(request.id)
    const pendingApproval = release.listApprovals(project.id).find((approval) => approval.id === submitted.approval.id)
    expect(pendingApproval?.subjectType).toBe('change_request')
    expect(pendingApproval?.subjectTitle).toBe('Release 0.1.0')
    const approved = release.decideApproval({ approvalId: submitted.approval.id, decision: 'approved', note: 'ok', rationale: 'ok' })
    expect(approved.status).toBe('approved')

    const candidate = release.createCandidate({
      projectId: project.id,
      versionId: version.id,
      changeRequestId: request.id,
      artifactIds: [artifact.id],
      notes: 'candidate',
    })
    expect(candidate.status).toBe('ready')
    expect(candidate.gateStatus).toBe('passed')
    expect(candidate.artifacts).toHaveLength(1)
    expect(candidate.gitCommit).toBeTruthy()

    const created = release.createRelease({ candidateId: candidate.id, idempotencyKey: 'release-0.1.0', notes: 'release' })
    expect(created.status).toBe('recorded')
    expect(created.distributionStatus).toBe('not_distributed')
    expect(created.artifactManifest[0]?.contentHash).toBe(artifact.contentHash ?? created.artifactManifest[0]?.contentHash)
    const duplicate = release.createRelease({ candidateId: candidate.id, idempotencyKey: 'release-0.1.0', notes: 'again' })
    expect(duplicate.id).toBe(created.id)

    const target = release.createTarget({
      projectId: project.id,
      environmentId: environment.id,
      name: 'staging-local',
      kind: 'local',
      controlMode: 'external_observed',
      targetRef: 'staging',
      protected: false,
    })
    const strategy = release.createStrategy({
      projectId: project.id,
      environmentId: environment.id,
      targetId: target.id,
      name: 'manual import',
      adapterType: 'none',
      source: 'manual',
    })
    const deployment = release.createDeployment({
      projectId: project.id,
      releaseId: created.id,
      environmentId: environment.id,
      targetId: target.id,
      strategyId: strategy.id,
      source: 'manual',
      idempotencyKey: 'deploy-manual-1',
      status: 'succeeded',
      externalId: null,
      artifactHash: null,
      receipt: {},
      notes: 'manual statement',
      rollbackOfDeploymentId: null,
    })
    expect(deployment.status).toBe('awaiting_approval')
    expect(deployment.assurance).toBe('self_declared')
    const deploymentApproval = harness.store.db
      .prepare("SELECT id FROM approval_requests WHERE subject_type='deployment' AND subject_id=?")
      .get(deployment.id) as { id: string }
    release.decideApproval({ approvalId: deploymentApproval.id, decision: 'approved', note: 'approved', rationale: 'ok' })
    const recorded = release.recordDeploymentResult({
      deploymentId: deployment.id,
      status: 'succeeded',
      externalId: 'manual-1',
      artifactHash: created.manifestHash,
      receipt: { source: 'manual' },
      notes: 'operator says deployed',
    })
    expect(recorded.status).toBe('succeeded')
    expect(recorded.assurance).toBe('self_declared')
    expect(release.currentEnvironmentVersion(project.id, environment.id).releaseId).toBeNull()

    const imported = release.createDeployment({
      projectId: project.id,
      releaseId: created.id,
      environmentId: environment.id,
      targetId: target.id,
      strategyId: strategy.id,
      source: 'imported',
      idempotencyKey: 'deploy-imported-1',
      status: 'succeeded',
      externalId: 'ci-123',
      artifactHash: null,
      receipt: { source: 'ci' },
      notes: 'imported CI result',
      rollbackOfDeploymentId: null,
    })
    expect(imported.assurance).toBe('source_observed')
    const importedApproval = harness.store.db
      .prepare("SELECT id FROM approval_requests WHERE subject_type='deployment' AND subject_id=?")
      .get(imported.id) as { id: string }
    release.decideApproval({ approvalId: importedApproval.id, decision: 'approved', note: 'approved', rationale: 'ok' })
    release.recordDeploymentResult({
      deploymentId: imported.id,
      status: 'succeeded',
      externalId: 'ci-123',
      artifactHash: created.manifestHash,
      receipt: { source: 'ci' },
      notes: 'imported success',
    })
    expect(release.currentEnvironmentVersion(project.id, environment.id).releaseId).toBe(created.id)

    const duplicateImported = release.createDeployment({
      projectId: project.id,
      releaseId: created.id,
      environmentId: environment.id,
      targetId: target.id,
      strategyId: strategy.id,
      source: 'imported',
      idempotencyKey: 'deploy-imported-1',
      status: 'succeeded',
      externalId: 'ci-123',
      artifactHash: null,
      receipt: { source: 'ci' },
      notes: 'duplicate request',
      rollbackOfDeploymentId: null,
    })
    expect(duplicateImported.id).toBe(imported.id)

    const unknown = release.createDeployment({
      projectId: project.id,
      releaseId: created.id,
      environmentId: environment.id,
      targetId: target.id,
      strategyId: strategy.id,
      source: 'unknown',
      idempotencyKey: 'deploy-unknown-1',
      status: 'succeeded',
      externalId: null,
      artifactHash: null,
      receipt: {},
      notes: 'result unknown',
      rollbackOfDeploymentId: null,
    })
    expect(unknown.status).toBe('needs_reconciliation')
    expect(unknown.approvalId).toBeNull()

    const rollback = release.createRollback(recorded.id, { idempotencyKey: 'rollback-manual-1', targetReleaseId: null, notes: 'rollback required' })
    expect(rollback.status).toBe('awaiting_approval')
    expect(rollback.rollbackOfDeploymentId).toBe(recorded.id)
    expect(release.overview(project.id, version.id).deployments.find((item) => item.id === recorded.id)?.status).toBe('succeeded')
  })

  it('rejects reuse of an approval after change content changes and blocks adapter execution', async () => {
    const { project, version, environment, release, artifact } = await preparedProject()
    const request = release.createChangeRequest({
      projectId: project.id,
      versionId: version.id,
      title: 'Change submit',
      description: 'desc',
      sourceType: 'manual',
      sourceId: null,
      riskLevel: 'medium',
      impactScope: '',
      targetEnvironmentId: environment.id,
      linkedArtifactIds: [artifact.id],
      linkedTaskIds: [],
    })
    const submitted = release.submitChangeRequest(request.id)
    release.decideApproval({ approvalId: submitted.approval.id, decision: 'approved', note: 'ok', rationale: 'ok' })
    const updated = release.updateChangeRequest({ id: request.id, description: 'new content' })
    expect(updated.status).toBe('draft')
    expect(updated.revision).toBe(2)
    const approvals = release.overview(project.id, version.id).approvals
    expect(approvals.some((approval) => approval.status === 'superseded')).toBe(true)
    await expect(
      Promise.resolve().then(() =>
        release.createDeployment({
          projectId: project.id,
          releaseId: 'rel_missing',
          environmentId: environment.id,
          targetId: null,
          strategyId: null,
          source: 'adapter',
          idempotencyKey: 'adapter-attempt',
          status: 'succeeded',
          externalId: null,
          artifactHash: null,
          receipt: {},
          notes: '',
          rollbackOfDeploymentId: null,
        }),
      ),
    ).rejects.toThrow(/没有可执行的部署适配器/)
  })
})
