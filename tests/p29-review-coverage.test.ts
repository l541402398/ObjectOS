import { afterEach, describe, expect, it } from 'vitest'
import type { PlannedTask } from '@projectos/contracts'
import { ensureReviewTask } from '@projectos/planning'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function task(key: string, role: PlannedTask['role']): PlannedTask {
  return {
    key,
    title: `任务 ${key}`,
    description: `完成 ${key}`,
    role,
    assignmentReasons: [],
    assignmentBlocked: false,
    dependsOn: [],
    acceptanceCriteria: ['完成'],
    expectedArtifacts: ['代码 diff'],
    requiresApproval: false,
  }
}

/**
 * ADR-0062 — a plan without a reviewer can complete and verify but can never deliver, because the
 * delivery gate requires review evidence for the current content (ADR-0033).
 */
describe('ADR-0062 review coverage for model plans', () => {
  it('adds one reviewer task that depends on every developer task', () => {
    const tasks = ensureReviewTask('实现搜索', [task('impl-a', 'developer'), task('impl-b', 'developer')])
    const reviewers = tasks.filter((item) => item.role === 'reviewer')
    expect(reviewers).toHaveLength(1)
    expect(reviewers[0]!.dependsOn).toEqual(['impl-a', 'impl-b'])
    expect(reviewers[0]!.expectedArtifacts).toEqual(['审查报告'])
    expect(reviewers[0]!.description).toContain('artifactType')
  })

  it('is idempotent and does nothing without developer work', () => {
    const withReviewer = [task('impl', 'developer'), task('review', 'reviewer')]
    expect(ensureReviewTask('实现搜索', withReviewer)).toBe(withReviewer)
    const architectOnly = [task('design', 'architect')]
    expect(ensureReviewTask('写一份方案', architectOnly)).toEqual(architectOnly)
  })
})
