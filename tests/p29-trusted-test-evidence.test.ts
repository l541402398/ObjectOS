import { afterEach, describe, expect, it } from 'vitest'
import type { Artifact, TaskCard } from '@projectos/contracts'
import { evaluateCompletion } from '../packages/application/src/completion-evidence.js'
import { resolveTestEvidence, type VerificationCheck } from '../packages/application/src/test-evidence.js'

const T0 = 1_000_000

function task(overrides: Partial<TaskCard> = {}): TaskCard {
  return {
    id: 'tsk_evidence',
    projectId: 'prj_evidence',
    title: '运行真实测试并报告退出码',
    description: '',
    status: 'running',
    priority: 2,
    acceptanceCriteria: [],
    expectedArtifacts: ['测试报告（含命令、原始输出、退出码）'],
    labels: ['plan', 'tester'],
    assigneeAgentId: 'agt_qa',
    milestoneId: null,
    versionId: null,
    iterationId: null,
    dependsOn: [],
    blockedBy: [],
    createdAt: T0,
    updatedAt: T0,
    version: 1,
    ...overrides,
  } as TaskCard
}

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'art_report',
    projectId: 'prj_evidence',
    taskId: 'tsk_evidence',
    runId: 'run_1',
    kind: 'test-report',
    title: '测试报告 · node --test',
    body: 'exit 0 pass 2',
    uri: null,
    metadata: {
      artifactType: 'test-report',
      reviewSnapshot: { fingerprint: 'fp-current' },
      commands: ['npm test'],
    },
    verifiedAt: T0 + 500,
    createdAt: T0 + 500,
    ...overrides,
  } as unknown as Artifact
}

function runDetail(id: string, calls: Array<{ at: number; command: string; exitCode?: number; tool?: string; path?: string }>) {
  return {
    run: { id, taskId: 'tsk_evidence', projectId: 'prj_evidence', status: 'completed' },
    toolCalls: calls.map((call, index) => ({
      id: `${id}_call_${index}`,
      runId: id,
      toolName: call.tool ?? 'run_tests',
      status: 'completed',
      args: call.path ? { path: call.path } : { command: call.command },
      result: call.exitCode === undefined ? { ok: true } : { exitCode: call.exitCode },
      error: null,
      createdAt: call.at,
      startedAt: call.at,
      finishedAt: call.at,
    })),
  }
}

/** The negative case the user asked for: a report claims success while the code is still broken. */
describe('ADR-0047 a test report cannot stand in for a real execution', () => {
  it('rejects a "successful" report when the run really exited 1 (code not fixed)', () => {
    const decision = evaluateCompletion({
      task: task(),
      artifacts: [artifact({ metadata: { artifactType: 'test-report', reviewSnapshot: { fingerprint: 'fp-current' }, commands: ['npm test'] } })],
      runs: [runDetail('run_1', [{ at: T0 + 100, command: 'npm test', exitCode: 1 }])] as never,
      actorKind: 'agent',
      verification: { currentFingerprintFor: () => 'fp-current' },
    })
    expect(decision.ok).toBe(false)
    expect(decision.verification?.state).toBe('failed')
    expect(decision.verification?.trusted).toBe(false)
    const requirement = decision.requirements.find((item) => item.id === 'test')
    expect(requirement?.satisfied).toBe(false)
    expect(requirement?.missing.join(' ')).toContain('真实测试未通过')
  })

  it('rejects a report that is not linked to any run', () => {
    const decision = evaluateCompletion({
      task: task(),
      artifacts: [artifact({ runId: null })],
      runs: [runDetail('run_1', [{ at: T0 + 100, command: 'npm test', exitCode: 1 }])] as never,
      actorKind: 'agent',
      verification: { currentFingerprintFor: () => 'fp-current' },
    })
    expect(decision.ok).toBe(false)
    expect(decision.verification?.trusted).toBe(false)
  })

  it('rejects a human/model declaration even when it says pass', () => {
    for (const declaredBy of ['user', 'model'] as const) {
      const decision = evaluateCompletion({
        task: task(),
        artifacts: [
          artifact({
            runId: 'run_1',
            metadata: { artifactType: 'test-report', createdBy: declaredBy, reviewSnapshot: { fingerprint: 'fp-current' } },
          }),
        ],
        runs: [runDetail('run_1', [{ at: T0 + 100, command: 'npm test', exitCode: 0 }])] as never,
        actorKind: 'agent',
        verification: { currentFingerprintFor: () => 'fp-current' },
      })
      // The real run passed, so the *execution* may satisfy the requirement...
      expect(decision.verification?.trusted).toBe(true)
      // ...but the declaration itself must never be the thing that was trusted.
      const verdicts = resolveTestEvidence({
        checks: [],
        artifacts: [
          {
            id: 'art_report',
            kind: 'test-report',
            runId: 'run_1',
            verifiedAt: T0 + 500,
            createdAt: T0 + 500,
            contentFingerprint: 'fp-current',
            declaredBy,
            commands: ['npm test'],
          },
        ],
        currentFingerprintFor: () => 'fp-current',
      })
      expect(verdicts.trusted).toBe(false)
      expect(verdicts.artifacts[0]?.reason).toContain('声明')
    }
  })

  it('keeps a passing check from proving code that changed afterwards', () => {
    const check: VerificationCheck = {
      id: 'tol_1',
      runId: 'run_1',
      toolName: 'run_tests',
      command: 'npm test',
      exitCode: 0,
      at: T0 + 100,
    }
    const stale = resolveTestEvidence({
      checks: [check],
      mutations: [{ kind: 'write', at: T0 + 200, detail: 'src/sums.mjs' }],
    })
    expect(stale.state).toBe('stale')
    expect(stale.trusted).toBe(false)

    const current = resolveTestEvidence({
      checks: [check, { ...check, id: 'tol_2', at: T0 + 300 }],
      mutations: [{ kind: 'write', at: T0 + 200 }],
    })
    expect(current.state).toBe('passed')
    expect(current.trusted).toBe(true)
  })

  it('never erases an earlier real failure after a later pass', () => {
    const resolution = resolveTestEvidence({
      checks: [
        { id: 'a', runId: 'run_1', toolName: 'run_tests', command: 'npm test', exitCode: 1, at: T0 + 100 },
        { id: 'b', runId: 'run_2', toolName: 'run_tests', command: 'npm test', exitCode: 0, at: T0 + 900 },
      ],
    })
    expect(resolution.state).toBe('passed')
    expect(resolution.failures).toHaveLength(1)
    expect(resolution.failures[0]?.exitCode).toBe(1)
    expect(resolution.lastFailure?.runId).toBe('run_1')
  })

  it('lets a diagnostic task finish on a real failure without passing the gate', () => {
    const decision = evaluateCompletion({
      task: task({ labels: ['plan', 'tester'], workType: 'diagnostic' } as Partial<TaskCard>),
      artifacts: [],
      runs: [runDetail('run_1', [{ at: T0 + 100, command: 'npm test', exitCode: 1 }])] as never,
      actorKind: 'agent',
    })
    expect(decision.ok).toBe(true)
    expect(decision.verification?.trusted).toBe(false)
    expect(decision.verification?.state).toBe('failed')
  })
})

describe('ADR-0047 goal status distinguishes unverified / verifying / failed / passed / stale', () => {
  afterEach(() => {
    // no shared state in these pure cases
  })

  it('reports unverified when no real check exists', () => {
    const resolution = resolveTestEvidence({ checks: [] })
    expect(resolution.state).toBe('unverified')
    expect(resolution.trusted).toBe(false)
  })

  it('reports stale for a report whose content fingerprint no longer matches', () => {
    const resolution = resolveTestEvidence({
      // The run really passed, but the code changed afterwards, so only the report's own fingerprint
      // can still say whether it describes the current content — and it does not.
      checks: [{ id: 'tol_1', runId: 'run_1', toolName: 'run_tests', command: 'npm test', exitCode: 0, at: T0 + 90 }],
      mutations: [{ kind: 'write', at: T0 + 95, detail: 'src/sums.mjs' }],
      artifacts: [
        {
          id: 'art_1',
          kind: 'test-report',
          runId: 'run_1',
          verifiedAt: T0 + 100,
          createdAt: T0 + 100,
          contentFingerprint: 'fp-old',
          declaredBy: 'execution',
          commands: ['npm test'],
        },
      ],
      currentFingerprintFor: () => 'fp-new',
    })
    expect(resolution.state).toBe('stale')
    expect(resolution.artifacts[0]?.reason).toContain('不一致')
  })
})
