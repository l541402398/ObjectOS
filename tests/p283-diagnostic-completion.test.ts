import { describe, expect, it } from 'vitest'
import { evaluateCompletion, isDiagnosticTask } from '../packages/application/src/completion-evidence.js'

/**
 * ADR-2.8.3 invariants: a diagnostic task completes because it really ran the check and
 * recorded the real exit code; a failing check is never turned into a passing test.
 */

function task(workType?: string, labels: string[] = ['tester']) {
  return {
    id: 'tsk_1', projectId: 'prj_1', title: '运行 npm test 并如实报告结果',
    status: 'review', labels, workType, expectedArtifacts: ['npm test 原始输出与退出码记录'],
  } as never
}

function run(exitCode: number | undefined, toolName = 'run_tests') {
  return {
    run: { id: 'run_1', status: 'completed' },
    toolCalls: [{
      toolName,
      status: 'completed',
      args: { command: 'npm test' },
      result: exitCode === undefined ? { stdout: 'no code reported' } : { exitCode },
    }],
  } as never
}

const base = { artifacts: [], qualityGate: null, actorKind: 'agent' as const }

describe('ADR-2.8.3 diagnostic verification intent', () => {
  it('treats only the explicit workType contract as diagnostic', () => {
    expect(isDiagnosticTask(task('diagnostic') as never)).toBe(true)
    expect(isDiagnosticTask(task('Diagnosis') as never)).toBe(true)
    expect(isDiagnosticTask(task(undefined) as never)).toBe(false)
    expect(isDiagnosticTask(task('development') as never)).toBe(false)
    // A tempting title must NOT be enough.
    expect(isDiagnosticTask({ id: 't', title: '测试并报告失败', labels: ['tester'] } as never)).toBe(false)
  })

  it('completes a diagnostic task on a real failing exit code', () => {
    const decision = evaluateCompletion({ ...base, task: task('diagnostic'), runs: [run(1)] })
    const diagnostic = decision.requirements.find((item) => item.id === 'diagnostic')
    expect(diagnostic?.satisfied).toBe(true)
    expect(diagnostic?.evidence.join(' ')).toContain('退出码 1')
    expect(decision.ok).toBe(true)
  })

  it('keeps an acceptance task blocked by the same failing run', () => {
    const decision = evaluateCompletion({ ...base, task: task(undefined), runs: [run(1)] })
    const testReq = decision.requirements.find((item) => item.id === 'test')
    expect(testReq?.satisfied).toBe(false)
    expect(decision.ok).toBe(false)
    // No diagnostic escape hatch appears when the intent is not declared.
    expect(decision.requirements.some((item) => item.id === 'diagnostic')).toBe(false)
  })

  it('never lets a diagnostic completion satisfy the passing-test requirement', () => {
    const decision = evaluateCompletion({ ...base, task: task('diagnostic'), runs: [run(1)] })
    // The only satisfied requirement is `diagnostic`; no `test` requirement is claimed.
    expect(decision.requirements.some((item) => item.id === 'test')).toBe(false)
  })

  it('requires a real exit code, not just a completed tool call', () => {
    const decision = evaluateCompletion({ ...base, task: task('diagnostic'), runs: [run(undefined)] })
    expect(decision.ok).toBe(false)
    const diagnostic = decision.requirements.find((item) => item.id === 'diagnostic')
    expect(diagnostic?.satisfied).toBe(false)
  })

  it('accepts a passing diagnostic run too', () => {
    const decision = evaluateCompletion({ ...base, task: task('diagnostic'), runs: [run(0)] })
    expect(decision.ok).toBe(true)
  })
})
