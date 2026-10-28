import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { LifecycleService } from '../apps/runtime/src/lifecycle.js'
import { ReleaseService } from '../apps/runtime/src/release-service.js'
import { createGitProject, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

/**
 * Regression: createRollback previously inserted 21 values into 22 columns, so every
 * rollback failed with "21 values for 22 columns" and the console silently created
 * nothing. This pins the insert arity and the "new deployment, never overwrite the
 * source" rule.
 */
describe('Phase 2.5 rollback creates a new deployment', () => {
  it('inserts a distinct awaiting_approval deployment linked to the source', async () => {
    const harness = setup()
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'p25-rollback')
    const lifecycle = new LifecycleService(harness.store)
    const release = new ReleaseService(harness.store)
    const version = lifecycle.overview(project.id).versions[0]!
    const environment = lifecycle.createEnvironment({ projectId: project.id, key: 'staging', name: 'Staging', kind: 'staging', protected: false })
    const target = release.createTarget({
      projectId: project.id, environmentId: environment.id, name: 'local', kind: 'local',
      controlMode: 'external_observed', adapterType: 'local-artifact', targetRef: harness.dataDir,
      resourceId: null, connectionProfileId: null, protected: false,
    })

    const now = Date.now()
    const candidateId = 'rcd_p25rollback'
    harness.store.db
      .prepare(
        `INSERT INTO release_candidates
         (id, project_id, version_id, change_request_id, status, artifacts_ready, gate_status, evidence_summary, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'ready', 1, 'passed', '{}', '', 'test', ?, ?)`,
      )
      .run(candidateId, project.id, version.id, now, now)

    const releaseIds = ['rel_p25a', 'rel_p25b']
    for (const [index, id] of releaseIds.entries()) {
      harness.store.db
        .prepare(
          `INSERT INTO releases
           (id, project_id, version_id, candidate_id, version, status, notes, manifest_hash, idempotency_key, published_at, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'recorded', '', ?, ?, ?, 'test', ?, ?)`,
        )
        .run(id, project.id, version.id, candidateId, version.version, createHash('sha256').update(id).digest('hex'), `p25-rel-${index}`, now, now, now)
    }

    // v1 succeeded on this target, then v2 succeeded: rolling back from v2 must pick v1.
    const insertDeployment = harness.store.db.prepare(
      `INSERT INTO deployments
       (id, project_id, version_id, release_id, environment_id, target_id, status, source, assurance,
        idempotency_key, receipt_json, notes, requested_by, created_at, updated_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, 'succeeded', 'manual', 'self_declared', ?, '{}', '', 'u', ?, ?, ?)`,
    )
    insertDeployment.run('dep_prev', project.id, version.id, releaseIds[0]!, environment.id, target.id, 'seed-prev', now - 2000, now - 2000, now - 2000)
    insertDeployment.run('dep_source', project.id, version.id, releaseIds[1]!, environment.id, target.id, 'seed-source', now, now, now)

    const rollback = release.createRollback('dep_source', { idempotencyKey: 'p25-rollback-1', notes: 'back to r1' })
    expect(rollback.id).not.toBe('dep_source')
    expect(rollback.status).toBe('awaiting_approval')
    expect(rollback.rollbackOfDeploymentId).toBe('dep_source')
    expect(rollback.releaseId).toBe(releaseIds[0])

    const sourceRow = harness.store.db.prepare("SELECT status, release_id FROM deployments WHERE id='dep_source'").get() as { status: string; release_id: string }
    expect(sourceRow.status).toBe('succeeded')
    expect(sourceRow.release_id).toBe(releaseIds[1])

    const pending = harness.store.db
      .prepare("SELECT COUNT(*) AS n FROM approval_requests WHERE subject_type='deployment' AND subject_id=? AND status='pending'")
      .get(rollback.id) as { n: number }
    expect(Number(pending.n)).toBe(1)
  })
})
