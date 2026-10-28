import { describe, expect, it } from 'vitest'
import { evaluateCompletion } from '../packages/application/src/completion-evidence.js'
import { buildReviewSnapshot } from '../packages/application/src/review-snapshot.js'
import { resolveEffectiveToolArgs } from '../apps/runtime/src/agent-runner.js'

/**
 * ADR-0022 / ADR-0023 deterministic contract tests:
 *  - review performed != review approved
 *  - a negative but valid review completes the review task yet never approves it
 *  - empty findings are allowed (no fabricated "no issues" finding is required)
 *  - tool defaults are resolved once, before any security decision
 */

function task(extra: Record<string, unknown> = {}) {
  return {
    id: 'tsk_r', projectId: 'prj_1', title: '审查实现', status: 'review',
    labels: ['reviewer'], expectedArtifacts: ['审查报告'], ...extra,
  } as never
}

function reviewArtifact(metadata: Record<string, unknown>) {
  return {
    id: 'art_r', projectId: 'prj_1', taskId: 'tsk_r', runId: 'run_1',
    kind: 'document', title: '审查结论', body: 'review', uri: null,
    metadata, verifiedAt: null, isDemo: false,
  } as never
}

const base = { qualityGate: null, actorKind: 'agent' as const, runs: [] as never[] }

function currentSnapshot(paths: string[] = ['src/formatting.mjs']) {
  return buildReviewSnapshot({
    files: paths.map((path) => ({ path, sha256: 'a'.repeat(64) })),
  })
}

describe('ADR-0022 review performed vs approved', () => {
  it('completes the review task when the review reports required changes', () => {
    const decision = evaluateCompletion({
      ...base,
      task: task(),
      artifacts: [reviewArtifact({
        artifactType: 'review',
        reviewedObjects: ['src/visibility.mjs'],
        scope: 'src/visibility.mjs 的 canView 实现',
        findings: ['owner 规则缺失，私有资源对属主不可见'],
        conclusion: '需要修改',
        blockers: ['owner 规则缺失'],
      })],
    })
    expect(decision.ok).toBe(true)
    expect(decision.review?.performed).toBe(true)
    expect(decision.review?.approved).toBe(false)
  })

  it('marks a positive review as approved only when it is bound to the current content', () => {
    const snapshot = currentSnapshot()
    const decision = evaluateCompletion({
      ...base,
      task: task(),
      reviewContext: { currentSnapshot: snapshot },
      artifacts: [reviewArtifact({
        artifactType: 'review',
        reviewedObjects: ['src/formatting.mjs'],
        scope: 'formatting 模块',
        findings: [],
        conclusion: '通过',
        blockers: [],
        reviewSnapshot: snapshot,
      })],
    })
    expect(decision.ok).toBe(true)
    expect(decision.review?.approved).toBe(true)
  })

  it('never reports an unverifiable review as approved', () => {
    // No content snapshot and no review context: the system cannot prove the review is about
    // the code that exists now, so "approved" must not be claimed (ADR-0025).
    const decision = evaluateCompletion({
      ...base,
      task: task(),
      artifacts: [reviewArtifact({
        artifactType: 'review',
        reviewedObjects: ['src/formatting.mjs'],
        scope: 'formatting 模块',
        findings: [],
        conclusion: '通过',
        blockers: [],
      })],
    })
    // The review task itself is still complete: reporting a verdict is finished work.
    expect(decision.ok).toBe(true)
    expect(decision.review?.performed).toBe(true)
    expect(decision.review?.approved).toBe(false)
    expect(decision.reasons.join(' ')).toContain('没有可校验的当前审查')
  })

  it('allows an honest clean review with zero findings (no fabricated finding)', () => {
    const decision = evaluateCompletion({
      ...base,
      task: task(),
      artifacts: [reviewArtifact({
        artifactType: 'review',
        reviewedObjects: ['src/formatting.mjs'],
        scope: 'formatting 模块',
        findings: [],
        conclusion: '通过：未发现问题',
        blockers: [],
      })],
    })
    expect(decision.ok).toBe(true)
  })

  it('rejects a review artifact that references nothing', () => {
    const decision = evaluateCompletion({
      ...base,
      task: task(),
      artifacts: [reviewArtifact({
        artifactType: 'review',
        reviewedObjects: [],
        scope: 'x',
        findings: [],
        conclusion: '通过',
        blockers: [],
      })],
    })
    expect(decision.ok).toBe(false)
  })

  it('rejects a review artifact without a conclusion', () => {
    const decision = evaluateCompletion({
      ...base,
      task: task(),
      artifacts: [reviewArtifact({
        artifactType: 'review',
        reviewedObjects: ['src/a.mjs'],
        scope: 'x',
        findings: [],
        conclusion: '',
        blockers: [],
      })],
    })
    expect(decision.ok).toBe(false)
  })

  it('keeps a non-review task from completing on a review artifact alone', () => {
    const decision = evaluateCompletion({
      ...base,
      task: task({ labels: ['developer'], expectedArtifacts: ['代码实现'] }),
      artifacts: [reviewArtifact({
        artifactType: 'review',
        reviewedObjects: ['src/a.mjs'],
        scope: 'x',
        findings: [],
        conclusion: '通过',
        blockers: [],
      })],
    })
    expect(decision.ok).toBe(false)
  })
})

describe('ADR-0023 effective tool arguments', () => {
  it('resolves the run_tests default command', () => {
    const resolved = resolveEffectiveToolArgs('run_tests', {})
    expect(resolved.args.command).toBe('pnpm test')
    expect(resolved.defaulted).toContain('command')
  })

  it('keeps an explicit run_tests command', () => {
    const resolved = resolveEffectiveToolArgs('run_tests', { command: 'node --test tests/a.test.mjs' })
    expect(resolved.args.command).toBe('node --test tests/a.test.mjs')
    expect(resolved.defaulted).toHaveLength(0)
  })

  it('trims run_command input', () => {
    const resolved = resolveEffectiveToolArgs('run_command', { command: '  npm test  ' })
    expect(resolved.args.command).toBe('npm test')
  })

  it('does not mutate the raw arguments', () => {
    const raw = {}
    resolveEffectiveToolArgs('run_tests', raw)
    expect(raw).toEqual({})
  })
})
