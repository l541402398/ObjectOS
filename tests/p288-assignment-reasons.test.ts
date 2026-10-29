import { describe, expect, it } from 'vitest'
import { mergeAssignmentReasons } from '../apps/runtime/src/orchestration.js'

/**
 * ADR-0040 — assignment reasons are audit evidence: a revision's recorded reason must survive the
 * resolver pass when the resolver keeps the same Agent.
 */
describe('ADR-0040 assignment reasons are merged, not replaced', () => {
  it('keeps the revision reason and appends the resolver reason', () => {
    const merged = mergeAssignmentReasons(
      ['复用授权范围内的 P288 QA（同角色）'],
      ['正式指定：用户已选 P288 QA', '能力匹配：test'],
      true,
    )
    expect(merged).toEqual(['复用授权范围内的 P288 QA（同角色）', '正式指定：用户已选 P288 QA', '能力匹配：test'])
  })

  it('drops stale reasons when the resolver picked a different Agent', () => {
    const merged = mergeAssignmentReasons(['复用授权范围内的 P288 QA（同角色）'], ['角色默认 Agent', '能力匹配：review'], false)
    expect(merged).toEqual(['角色默认 Agent', '能力匹配：review'])
  })

  it('dedupes repeated passes and keeps the list bounded', () => {
    const merged = mergeAssignmentReasons(['A', 'A'], ['A', 'B'], true)
    expect(merged).toEqual(['A', 'B'])
    const many = mergeAssignmentReasons(
      Array.from({ length: 20 }, (_, index) => `r${index}`),
      Array.from({ length: 20 }, (_, index) => `n${index}`),
      true,
    )
    expect(many.length).toBe(12)
    expect(many.at(-1)).toBe('n19')
  })
})
