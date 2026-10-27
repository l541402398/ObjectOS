import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LifecycleService } from '../apps/runtime/src/lifecycle.js'
import { ReleaseService } from '../apps/runtime/src/release-service.js'
import { createGitProject, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

describe('Phase 2.2 local delivery adapter', () => {
  it('executes a frozen artifact with real hash verification and health evidence', async () => {
    const harness = setup()
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'adapter-local')
    const lifecycle = new LifecycleService(harness.store)
    const release = new ReleaseService(harness.store)
    const version = lifecycle.overview(project.id).versions[0]!
    const environment = lifecycle.createEnvironment({ projectId: project.id, key: 'staging', name: 'Staging', kind: 'staging', protected: false })
    lifecycle.recordEvidence({
      projectId: project.id,
      subjectType: 'version',
      subjectId: version.id,
      evidenceType: 'review_record',
      verificationStatus: 'passed',
      assurance: 'self_declared',
      title: 'review',
      summary: 'ok',
      provenance: {},
    })
    if (version.phase === 'planned') lifecycle.transitionVersion({ versionId: version.id, to: 'discovery' })
    if (lifecycle.overview(project.id).versions[0]?.phase === 'discovery') lifecycle.transitionVersion({ versionId: version.id, to: 'build' })
    if (lifecycle.overview(project.id).versions[0]?.phase === 'build') {
      lifecycle.recordEvidence({
        projectId: project.id,
        subjectType: 'version',
        subjectId: version.id,
        evidenceType: 'test_report',
        verificationStatus: 'passed',
        assurance: 'source_observed',
        title: 'test',
        summary: 'ok',
        provenance: {},
      })
      lifecycle.transitionVersion({ versionId: version.id, to: 'verify' })
    }

    const sourceDir = mkdtempSync(join(tmpdir(), 'projectos-adapter-source-'))
    cleanups.push(() => rmSync(sourceDir, { recursive: true, force: true }))
    const sourceFile = join(sourceDir, 'index.html')
    writeFileSync(sourceFile, '<h1>ProjectOS local deployment</h1>')
    const artifact = await harness.services.projects.createArtifact({
      projectId: project.id,
      taskId: null,
      runId: null,
      kind: 'other',
      title: 'index.html',
      body: '',
      uri: sourceFile,
      metadata: {},
    })
    const request = release.createChangeRequest({
      projectId: project.id,
      versionId: version.id,
      title: 'Local deployment',
      description: 'deploy local artifact',
      sourceType: 'manual',
      sourceId: null,
      riskLevel: 'low',
      impactScope: '',
      targetEnvironmentId: environment.id,
      linkedArtifactIds: [artifact.id],
      linkedTaskIds: [],
    })
    const submitted = release.submitChangeRequest(request.id)
    release.decideApproval({ approvalId: submitted.approval.id, decision: 'approved', note: 'ok', rationale: 'ok' })
    const candidate = release.createCandidate({ projectId: project.id, versionId: version.id, changeRequestId: request.id, artifactIds: [artifact.id], notes: '' })
    expect(candidate.status).toBe('ready')
    const created = release.createRelease({ candidateId: candidate.id, idempotencyKey: 'adapter-release-1', notes: '' })

    const targetDir = mkdtempSync(join(tmpdir(), 'projectos-adapter-target-'))
    cleanups.push(() => rmSync(targetDir, { recursive: true, force: true }))
    const target = release.createTarget({
      projectId: project.id,
      environmentId: environment.id,
      name: 'local staging',
      kind: 'local',
      controlMode: 'external_observed',
      adapterType: 'local-artifact',
      targetRef: targetDir,
      protected: false,
    })
    const deployment = release.createDeployment({
      projectId: project.id,
      releaseId: created.id,
      environmentId: environment.id,
      targetId: target.id,
      strategyId: null,
      source: 'manual',
      idempotencyKey: 'adapter-deploy-1',
      status: 'succeeded',
      externalId: null,
      artifactHash: null,
      receipt: {},
      notes: '',
      rollbackOfDeploymentId: null,
    })
    const approval = harness.store.db
      .prepare("SELECT id FROM approval_requests WHERE subject_type='deployment' AND subject_id=?")
      .get(deployment.id) as { id: string }
    release.decideApproval({ approvalId: approval.id, decision: 'approved', note: 'ok', rationale: 'ok' })
    const executed = await release.executeDeployment(deployment.id)
    expect(executed.status).toBe('succeeded')
    expect(executed.assurance).toBe('independently_reproduced')
    expect(executed.externalId).toBe(`local-${deployment.id}`)
    expect(executed.receipt.health).toMatchObject({ ok: true })
    const expectedHash = createHash('sha256').update('<h1>ProjectOS local deployment</h1>').digest('hex')
    expect(executed.receipt.artifacts).toEqual([{ name: 'index.html', hash: expectedHash }])
    expect(release.currentEnvironmentVersion(project.id, environment.id).releaseId).toBe(created.id)
    expect(release.adapterCapabilities().find((adapter) => adapter.type === 'local-artifact')?.capabilities.execute).toBe(true)
    expect(release.adapterCapabilities().find((adapter) => adapter.type === 'ssh-artifact')?.capabilities.execute).toBe(true)
    expect(release.adapterCapabilities().find((adapter) => adapter.type === 'pipeline')?.capabilities.execute).toBe(false)
    await expect(release.executeDeployment(deployment.id)).rejects.toThrow(/只有已批准/)

    writeFileSync(sourceFile, '<h1>tampered</h1>')
    const second = release.createDeployment({
      projectId: project.id,
      releaseId: created.id,
      environmentId: environment.id,
      targetId: target.id,
      strategyId: null,
      source: 'manual',
      idempotencyKey: 'adapter-deploy-2',
      status: 'succeeded',
      externalId: null,
      artifactHash: null,
      receipt: {},
      notes: '',
      rollbackOfDeploymentId: null,
    })
    const secondApproval = harness.store.db
      .prepare("SELECT id FROM approval_requests WHERE subject_type='deployment' AND subject_id=?")
      .get(second.id) as { id: string }
    release.decideApproval({ approvalId: secondApproval.id, decision: 'approved', note: 'ok', rationale: 'ok' })
    await expect(release.executeDeployment(second.id)).rejects.toThrow(/哈希不一致/)
    expect(release.overview(project.id, version.id).deployments.find((item) => item.id === second.id)?.status).toBe('failed')
  }, 30_000)
})
