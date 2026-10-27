import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LifecycleService } from '../apps/runtime/src/lifecycle.js'
import { ReleaseService } from '../apps/runtime/src/release-service.js'
import { createGitProject, setup } from './helpers/r1-fixture.js'

const enabled = process.env.PROJECTOS_SSH_E2E === '1'
const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

describe('Phase 2.2 SSH/VPS adapter (real external, opt-in)', () => {
  const run = enabled ? it : it.skip
  run('deploys an isolated static app to the approved VPS and verifies /health', async () => {
    const harness = setup()
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'adapter-ssh')
    const lifecycle = new LifecycleService(harness.store)
    const release = new ReleaseService(harness.store)
    const version = lifecycle.overview(project.id).versions[0]!
    const environment = lifecycle.createEnvironment({ projectId: project.id, key: 'vps-test', name: 'VPS Test', kind: 'staging', protected: false })
    lifecycle.recordEvidence({
      projectId: project.id, subjectType: 'version', subjectId: version.id, evidenceType: 'review_record',
      verificationStatus: 'passed', assurance: 'self_declared', title: 'review', summary: 'ok', provenance: {},
    })
    if (version.phase === 'planned') lifecycle.transitionVersion({ versionId: version.id, to: 'discovery' })
    if (lifecycle.overview(project.id).versions[0]?.phase === 'discovery') lifecycle.transitionVersion({ versionId: version.id, to: 'build' })
    if (lifecycle.overview(project.id).versions[0]?.phase === 'build') {
      lifecycle.recordEvidence({
        projectId: project.id, subjectType: 'version', subjectId: version.id, evidenceType: 'test_report',
        verificationStatus: 'passed', assurance: 'source_observed', title: 'test', summary: 'ok', provenance: {},
      })
      lifecycle.transitionVersion({ versionId: version.id, to: 'verify' })
    }

    const sourceDir = mkdtempSync(join(tmpdir(), 'projectos-ssh-source-'))
    cleanups.push(() => rmSync(sourceDir, { recursive: true, force: true }))
    const indexFile = join(sourceDir, 'index.html')
    const healthFile = join(sourceDir, 'health')
    writeFileSync(indexFile, '<h1>ProjectOS SSH delivery</h1>')
    writeFileSync(healthFile, 'ok')
    const indexArtifact = await harness.services.projects.createArtifact({
      projectId: project.id, taskId: null, runId: null, kind: 'other', title: 'index.html',
      body: '', uri: indexFile, metadata: {},
    })
    const healthArtifact = await harness.services.projects.createArtifact({
      projectId: project.id, taskId: null, runId: null, kind: 'other', title: 'health',
      body: 'ok', uri: healthFile, metadata: {},
    })
    const request = release.createChangeRequest({
      projectId: project.id, versionId: version.id, title: 'VPS delivery', description: 'isolated VPS test',
      sourceType: 'manual', sourceId: null, riskLevel: 'low', impactScope: '',
      targetEnvironmentId: environment.id, linkedArtifactIds: [indexArtifact.id, healthArtifact.id], linkedTaskIds: [],
    })
    const submitted = release.submitChangeRequest(request.id)
    release.decideApproval({ approvalId: submitted.approval.id, decision: 'approved', note: 'ok', rationale: 'ok' })
    const candidate = release.createCandidate({
      projectId: project.id, versionId: version.id, changeRequestId: request.id,
      artifactIds: [indexArtifact.id, healthArtifact.id], notes: '',
    })
    expect(candidate.status).toBe('ready')
    const created = release.createRelease({ candidateId: candidate.id, idempotencyKey: 'ssh-release-1', notes: '' })
    const target = release.createTarget({
      projectId: project.id, environmentId: environment.id, name: 'Contabo isolated VPS',
      kind: 'ssh', controlMode: 'ssh_managed', adapterType: 'ssh-artifact',
      targetRef: 'ssh://root@169.58.112.111:22/opt/projectos-delivery-test?healthPort=18080&container=projectos-delivery-test&image=nginx:alpine',
      protected: false,
    })
    const deployment = release.createDeployment({
      projectId: project.id, releaseId: created.id, environmentId: environment.id, targetId: target.id,
      strategyId: null, source: 'manual', idempotencyKey: 'ssh-deploy-1', status: 'succeeded',
      externalId: null, artifactHash: null, receipt: {}, notes: '', rollbackOfDeploymentId: null,
    })
    const approval = harness.store.db
      .prepare("SELECT id FROM approval_requests WHERE subject_type='deployment' AND subject_id=?")
      .get(deployment.id) as { id: string }
    release.decideApproval({ approvalId: approval.id, decision: 'approved', note: 'ok', rationale: 'ok' })
    const executed = await release.executeDeployment(deployment.id)
    expect(executed.status).toBe('succeeded')
    expect(executed.assurance).toBe('externally_confirmed')
    expect(String(executed.receipt.healthBody)).toContain('ok')
    expect(executed.externalId).toMatch(/^ssh:projectos-delivery-test:/)
    expect(release.currentEnvironmentVersion(project.id, environment.id).releaseId).toBe(created.id)
  }, 180_000)
})
