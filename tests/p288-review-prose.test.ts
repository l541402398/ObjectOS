import { describe, expect, it } from 'vitest'
import { statedVerdictOf } from '../packages/application/src/review-verdict.js'
import { classifyExecutionFailure } from '../apps/runtime/src/failure-classifier.js'

/**
 * ADR-0033 — a real DeepSeek review is prose. These cases come from actual review artifacts of the
 * Phase 2.8.8 run: the parser must read them correctly without inventing a verdict.
 */
describe('ADR-0033 review prose is parsed without inventing a verdict', () => {
  it('accepts an explicit PASS that is not at the start of the conclusion', () => {
    expect(
      statedVerdictOf({
        conclusion: '根据当前工作区内容与真实测试证据（node --test exit 0 / pass 2），判定为通过（PASS）。',
      }),
    ).toBe('approved')
    expect(
      statedVerdictOf({ conclusion: 'PASS，通过：本次审查确认计划确实使 node --test 全部通过，tests 2 / pass 2 / fail 0。' }),
    ).toBe('approved')
    expect(statedVerdictOf({ conclusion: '结论：通过；未发现阻塞项' })).toBe('approved')
  })

  it('does not treat zero counts as a rejection', () => {
    expect(statedVerdictOf({ conclusion: '通过。tests 2 / pass 2 / fail 0 / errors 0' })).toBe('approved')
    expect(statedVerdictOf({ conclusion: '通过，tests: 2, failures: 0' })).toBe('approved')
    expect(statedVerdictOf({ conclusion: '通过，失败 0 个' })).toBe('approved')
  })

  it('still treats real negative verdicts as negative', () => {
    expect(statedVerdictOf({ conclusion: '未通过（FAIL）：sum 只返回 a，测试 2 失败' })).toBe('changes_requested')
    expect(statedVerdictOf({ conclusion: '审查不通过，需要修改 src/sums.mjs' })).toBe('changes_requested')
    expect(statedVerdictOf({ conclusion: 'changes requested: sum ignores b' })).toBe('changes_requested')
    expect(statedVerdictOf({ conclusion: '通过，但阻断项仍未解决' })).toBe('inconclusive')
    expect(statedVerdictOf({ conclusion: '' })).toBe('inconclusive')
    expect(statedVerdictOf({ conclusion: '看起来还行吧' })).toBe('inconclusive')
  })
})

describe('ADR-0033 a negative review is an implementation failure that needs a fix revision', () => {
  it('classifies review rejection as replannable', () => {
    const rejection = classifyExecutionFailure('审查未通过：审查报告 · src/sums.mjs（未通过：sum 只返回 a）')
    expect(rejection.replan).toBe(true)
    expect(rejection.action).toBe('reassign_or_replan')
  })

  it('still refuses to replan for provider/environment problems', () => {
    expect(classifyExecutionFailure('429 rate limit from provider').replan).toBe(false)
    expect(classifyExecutionFailure('worktree ENOENT: 无法创建工作树').replan).toBe(false)
  })
})
