import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '@projectos/contracts'
import { CoreServices, type WorkspacePort } from '@projectos/application'
import { SqliteStore } from '@projectos/persistence'
import {
  ensureProjectRoot,
  getGitStatus,
  initGitRepository,
  readTextFile,
  readWorkspaceTree,
  writeTextFile,
} from '@projectos/workspace'
import { OperationsService } from '../apps/runtime/src/operations.js'
import { failureSignature, findingFingerprint } from '../apps/runtime/src/finding-fingerprint.js'

const workspace: WorkspacePort = {
  ensureProjectRoot,
  readWorkspaceTree,
  writeTextFile,
  readTextFile,
  getGitStatus,
  initGitRepository,
}

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.()
})

async function makeOperations(scripts: Record<string, string> = {}) {
  const store = new SqliteStore({ filePath: ':memory:' })
  const dir = mkdtempSync(join(tmpdir(), 'projectos-ops-'))
  cleanup.push(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const services = new CoreServices(store, workspace)
  const project = await services.projects.create({
    name: 'Operations Test',
    description: '',
    rootPath: join(dir, 'project'),
    createDirectory: true,
    initGit: false,
  })
  writeFileSync(join(project.rootPath, 'package.json'), JSON.stringify({ name: 'ops', private: true, scripts }))
  return { store, project, operations: new OperationsService(store, services) }
}

describe('finding fingerprint', () => {
  const root = 'C:\\work\\demo'
  const run = (duration: string, time: string) =>
    [
      ` RUN  v5.0.5 C:/work/demo`,
      ` FAIL  tests/math.test.ts > adds`,
      `AssertionError: expected 3 to be 4`,
      ` ❯ C:\\work\\demo\\tests\\math.test.ts:12:5`,
      ` Test Files  1 failed | 4 passed (5)`,
      `   Start at  ${time}`,
      `   Duration  ${duration}`,
    ].join('\n')

  it('is stable across durations, timestamps, absolute paths and counters', () => {
    const a = failureSignature(run('9.67s', '17:21:18'), root, 1)
    const b = failureSignature(run('412ms', '08:02:55'), 'D:\\other\\demo', 1)
    expect(a).toBe(b)
    expect(findingFingerprint('prj_1', 'test', a)).toBe(findingFingerprint('prj_1', 'test', b))
  })

  it('distinguishes different failures and different checks', () => {
    const a = failureSignature(run('1s', '10:00:00'), root, 1)
    const other = failureSignature(run('1s', '10:00:00').replace('expected 3 to be 4', 'expected "a" to be "b"'), root, 1)
    expect(other).not.toBe(a)
    expect(findingFingerprint('prj_1', 'test', a)).not.toBe(findingFingerprint('prj_1', 'lint', a))
  })

  it('falls back to the exit code when no failure line is recognizable', () => {
    expect(failureSignature('just some output', root, 2)).toBe('exit:2')
  })
})

describe('operations service', () => {
  it('deduplicates a repeatedly failing check into one finding with history', async () => {
    const { operations, project } = await makeOperations({
      test: 'node -e "console.log(\'Duration \' + Date.now() + \'ms\'); console.error(\'AssertionError: expected 1 to be 2\'); process.exit(1)"',
    })
    await operations.runChecks(project.id)
    const second = await operations.runChecks(project.id)
    const failures = second.findings.filter((finding) => finding.category === 'test')
    expect(failures).toHaveLength(1)
    expect(failures[0]!.occurrenceCount).toBe(2)
    expect(failures[0]!.evidence[0]!.excerpt).toContain('exit 1')
    expect(second.checks.filter((check) => check.checkId === 'test').every((check) => check.status === 'failed')).toBe(true)
  })

  it('redacts secrets in evidence', async () => {
    const { operations, project } = await makeOperations({
      test: 'node -e "console.error(\'Error: auth failed for sk-abcdefghijklmnopqrstuvwxyz0123456789\'); process.exit(1)"',
    })
    const snapshot = await operations.runChecks(project.id)
    const finding = snapshot.findings.find((item) => item.category === 'test')
    expect(finding?.evidence[0]?.excerpt).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123456789')
  })

  it('reopens a finding that recurs after its proposal was merged', async () => {
    const { operations, project, store } = await makeOperations({
      test: 'node -e "console.error(\'Error: broken\'); process.exit(1)"',
    })
    const first = await operations.runChecks(project.id)
    const finding = first.findings.find((item) => item.category === 'test')!
    const proposal = operations.propose(project.id, [finding.id])!
    store.transitionProposalFindings(proposal.id, ['proposed'], 'in_progress')
    store.transitionProposalFindings(proposal.id, ['in_progress'], 'resolved')
    const again = await operations.runChecks(project.id)
    expect(again.findings.find((item) => item.id === finding.id)?.status).toBe('reopened')
  })

  it('records unconfigured checks as skipped instead of passed', async () => {
    const { operations, project } = await makeOperations({})
    const snapshot = await operations.runChecks(project.id)
    const gate = snapshot.checks.filter((check) => ['typecheck', 'lint', 'test', 'build'].includes(check.checkId))
    expect(gate).toHaveLength(4)
    expect(gate.every((check) => check.status === 'skipped')).toBe(true)
    expect(snapshot.findings.filter((finding) => finding.category === 'test')).toHaveLength(0)
  })

  it('coalesces concurrent triggers into one check run', async () => {
    const { operations, project } = await makeOperations({ test: 'node -e "setTimeout(() => process.exit(0), 300)"' })
    const [a, b] = await Promise.all([operations.runChecks(project.id, 'interval'), operations.runChecks(project.id, 'event:task.moved')])
    expect(a.checks.filter((check) => check.checkId === 'test')).toHaveLength(1)
    expect(b.checks.filter((check) => check.checkId === 'test')).toHaveLength(1)
  })

  it('treats blocked tasks and failed runs as trigger events', async () => {
    const { operations, project } = await makeOperations()
    const base = { id: 'evt_1', projectId: project.id, aggregateId: 'tsk_1', createdAt: Date.now(), seq: 1 }
    expect(operations.isTriggerEvent({ ...base, eventType: 'task.moved', payload: { status: 'blocked' } } as never)).toBe(true)
    expect(operations.isTriggerEvent({ ...base, eventType: 'task.moved', payload: { status: 'done' } } as never)).toBe(false)
    expect(operations.isTriggerEvent({ ...base, eventType: 'operations.checks.completed', payload: {} } as never)).toBe(false)
  })

  it('does not re-propose rejected findings or findings out of repair attempts', async () => {
    const { operations, project, store } = await makeOperations({
      test: 'node -e "console.error(\'Error: broken\'); process.exit(1)"',
    })
    store.setAutonomyMode(project.id, 'propose')
    const first = await operations.runChecks(project.id)
    const proposal = first.proposals[0]!
    expect(() => operations.propose(project.id, proposal.findingIds)).toThrow(/进行中/)
    operations.reviewProposal(proposal.id, 'rejected')
    const afterReject = await operations.runChecks(project.id)
    expect(afterReject.proposals).toHaveLength(1)
    expect(afterReject.findings.find((item) => item.id === proposal.findingIds[0])?.status).toBe('triaged')

    // Two failed repair attempts exhaust automatic proposals for the finding.
    const findingId = afterReject.findings.find((item) => item.category === 'test')!.id
    for (let attempt = 0; attempt < 2; attempt += 1) {
      store.transitionProposalFindings(proposal.id, ['triaged'], 'open')
      const manual = operations.propose(project.id, [findingId])!
      store.updateProposalStatus(manual.id, 'failed')
      store.transitionProposalFindings(manual.id, ['proposed'], 'open')
    }
    const exhausted = await operations.runChecks(project.id)
    expect(exhausted.proposals.filter((item) => item.findingIds.includes(findingId) && item.status === 'pending_approval')).toHaveLength(0)
  })

  it('claims one automation run per idempotency key with monotonic fencing tokens', async () => {
    const { operations, project, store } = await makeOperations()
    const claim = (key: string) =>
      store.claimAutomationRun({ id: newId('aur'), projectId: project.id, kind: 'checks', source: 'interval', proposalId: null, idempotencyKey: key })
    const first = claim('checks:interval:slot-1')!
    expect(claim('checks:interval:slot-1')).toBeNull()
    const second = claim('checks:interval:slot-2')!
    expect(second.leaseToken).toBeGreaterThan(first.leaseToken)

    // A stale holder cannot commit, and a run commits its terminal state only once.
    expect(store.finishAutomationRun(first.id, first.leaseToken + 100, 'completed')).toBe(false)
    expect(store.finishAutomationRun(first.id, first.leaseToken, 'completed')).toBe(true)
    expect(store.finishAutomationRun(first.id, first.leaseToken, 'failed')).toBe(false)

    await operations.runChecks(project.id, 'interval', 'checks:interval:slot-2')
    const snapshot = operations.snapshot(project.id)
    expect(snapshot.checks).toHaveLength(0)
    expect(snapshot.runs.map((run) => run.status).sort()).toEqual(['completed', 'running'])
  })

  it('records manual check runs and recovers interrupted ones after restart', async () => {
    const { operations, project, store } = await makeOperations()
    await operations.runChecks(project.id)
    expect(operations.snapshot(project.id).runs[0]?.status).toBe('completed')

    store.claimAutomationRun({ id: newId('aur'), projectId: project.id, kind: 'checks', source: 'manual', proposalId: null, idempotencyKey: 'checks:crash' })
    store.claimAutomationRun({ id: newId('aur'), projectId: project.id, kind: 'repair', source: 'autofix', proposalId: null, idempotencyKey: 'repair:crash' })
    operations.recoverRuns()
    const runs = operations.snapshot(project.id).runs
    expect(runs.find((run) => run.idempotencyKey === 'checks:crash')?.status).toBe('failed')
    expect(runs.find((run) => run.idempotencyKey === 'repair:crash')?.status).toBe('reconciliation_required')
  })

  it('opens the circuit after consecutive failed repairs until a new grant', async () => {
    const { operations, project, store } = await makeOperations()
    operations.grant(project.id, 1, 5)
    for (let index = 0; index < 3; index += 1) {
      const run = store.claimAutomationRun({ id: newId('aur'), projectId: project.id, kind: 'repair', source: 'autofix', proposalId: null, idempotencyKey: `repair:fail-${index}` })!
      store.finishAutomationRun(run.id, run.leaseToken, 'failed', 'tests still failing')
    }
    expect(operations.circuitOpen(project.id)).toBe(true)
    expect(operations.snapshot(project.id).circuitOpen).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 5))
    operations.grant(project.id, 1, 5)
    expect(operations.circuitOpen(project.id)).toBe(false)
  })

  it('enforces grant run limits, revocation and expiry atomically', async () => {
    const { operations, project, store } = await makeOperations()
    expect(() => operations.consumeGrant(project.id)).toThrow(/授权/)
    operations.grant(project.id, 1, 2)
    operations.consumeGrant(project.id)
    operations.consumeGrant(project.id)
    expect(() => operations.consumeGrant(project.id)).toThrow(/授权/)
    expect(store.read.getAutomationGrant(project.id)?.usedRuns).toBe(2)

    operations.grant(project.id, 1, 5)
    operations.revokeGrant(project.id)
    expect(() => operations.consumeGrant(project.id)).toThrow(/授权/)

    store.upsertAutomationGrant({ projectId: project.id, allowedActions: ['repair'], allowedPaths: ['.'], expiresAt: Date.now() - 1, maxRuns: 5 })
    expect(() => operations.consumeGrant(project.id)).toThrow(/授权/)

    store.upsertAutomationGrant({ projectId: project.id, allowedActions: ['observe'], allowedPaths: ['.'], expiresAt: Date.now() + 60_000, maxRuns: 5 })
    expect(() => operations.consumeGrant(project.id)).toThrow(/授权/)
  })
})
