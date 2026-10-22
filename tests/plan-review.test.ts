import { describe, expect, it } from 'vitest'
import type { PlanDraft, PlanRole, PlannedTask } from '@projectos/contracts'
import {
  computeStages,
  hasPlanBlockingIssues,
  planDependencyIssues,
} from '../apps/desktop/src/renderer/src/features/orchestration/components/plan-review-logic.js'

const labels: Record<PlanRole, string> = {
  architect: '架构',
  developer: '开发',
  reviewer: '审查',
  tester: '测试',
  custom: '自定义',
}

function task(key: string, dependsOn: string[] = [], overrides: Partial<PlannedTask> = {}): PlannedTask {
  return {
    key,
    title: key,
    description: '',
    role: 'developer',
    dependsOn,
    acceptanceCriteria: [],
    expectedArtifacts: [],
    assignmentReasons: [],
    assignmentBlocked: false,
    requiresApproval: true,
    ...overrides,
  }
}

function draft(tasks: PlannedTask[]): PlanDraft {
  return {
    id: 'pln_test',
    projectId: 'prj_test',
    revision: 1,
    status: 'draft',
    goal: 'test',
    tasks,
    assumptions: [],
    risks: [],
    generatedBy: 'local-rules',
    createdAt: 1,
    updatedAt: 1,
    approvedAt: null,
    createdTaskIds: [],
    execution: null,
  }
}

describe('plan review stage derivation', () => {
  it('renders a single task plan as one stage', () => {
    const stages = computeStages([task('only')], labels)
    expect(stages).toHaveLength(1)
    expect(stages[0]?.entries).toHaveLength(1)
    expect(stages[0]?.title).toBe('开发阶段')
  })

  it('derives sequential stages from real dependencies', () => {
    const stages = computeStages(
      [task('analyze', [], { role: 'architect' }), task('build', ['analyze']), task('test', ['build'], { role: 'tester' })],
      labels,
    )
    expect(stages.map((stage) => stage.title)).toEqual(['架构阶段', '开发阶段', '测试阶段'])
    expect(stages.map((stage) => stage.entries[0]?.task.key)).toEqual(['analyze', 'build', 'test'])
  })

  it('keeps independent tasks in the same parallel stage', () => {
    const stages = computeStages([task('a'), task('b'), task('c', ['a', 'b'])], labels)
    expect(stages).toHaveLength(2)
    expect(stages[0]?.entries.map((entry) => entry.task.key)).toEqual(['a', 'b'])
    expect(stages[1]?.entries.map((entry) => entry.task.key)).toEqual(['c'])
  })

  it('does not invent stages for a plan with no dependencies', () => {
    const stages = computeStages([task('a'), task('b')], labels)
    expect(stages).toHaveLength(1)
    expect(stages[0]?.entries).toHaveLength(2)
  })
})

describe('plan review dependency validation', () => {
  it('reports missing and cyclic dependencies as blocking', () => {
    const missing = [task('a', ['not-there'])]
    expect(planDependencyIssues(missing)).toEqual([
      { kind: 'missing', taskKey: 'a', detail: '前置任务「not-there」不存在' },
    ])
    expect(hasPlanBlockingIssues(draft(missing))).toBe(true)

    const cyclic = [task('a', ['b']), task('b', ['a'])]
    expect(planDependencyIssues(cyclic).some((issue) => issue.kind === 'cycle')).toBe(true)
    expect(hasPlanBlockingIssues(draft(cyclic))).toBe(true)
  })

  it('blocks approval for an unresolved Agent assignment but not for a model risk note', () => {
    expect(hasPlanBlockingIssues(draft([task('a', [], { assignmentBlocked: true })]))).toBe(true)
    const withRisk = draft([task('a')])
    withRisk.risks = ['可能影响旧数据']
    expect(hasPlanBlockingIssues(withRisk)).toBe(false)
  })
})
