import { describe, expect, it } from 'vitest'
import type { PlanDraft, PlannedTask } from '@projectos/contracts'
import { demoteSupersededVerifications } from '../apps/runtime/src/replan-service.js'
import { evaluateCompletion } from '../packages/application/src/completion-evidence.js'

/**
 * ADR-0039 — a revision that adds the repair must demote the verification it supersedes.
 *
 * The real Phase 2.8.8 run paused here: r2 added `fix …` + `verify …`, but the kept tester task
 * (depending only on the developer note) ran before the repair, could not produce a passing test
 * report, exhausted evidence and paused the plan. The repair therefore never ran.
 */
function task(overrides: Partial<PlannedTask> & { key: string }): PlannedTask {
  return {
    title: `任务 ${overrides.key}`,
    description: '',
    role: 'developer',
    dependsOn: [],
    acceptanceCriteria: [],
    expectedArtifacts: [],
    assignmentReasons: [],
    assignmentBlocked: false,
    requiresApproval: false,
    ...overrides,
  }
}

function plan(tasks: PlannedTask[]): PlanDraft {
  return {
    id: 'pln_test',
    projectId: 'prj_test',
    revision: 1,
    status: 'approved',
    goal: '实现 sum 并让测试通过',
    assumptions: [],
    risks: [],
    tasks,
    createdTaskIds: [],
    createdAt: 1,
    updatedAt: 1,
    versionId: null,
    iterationId: null,
    generator: 'provider',
  } as unknown as PlanDraft
}

const sourcePlan = plan([
  task({ key: 'dev', role: 'developer', title: '补充说明模块' }),
  task({ key: 'test', role: 'tester', title: '运行真实测试并报告退出码', dependsOn: ['dev'], expectedArtifacts: ['测试报告'] }),
  task({ key: 'review', role: 'reviewer', title: '只读审查', dependsOn: ['test'], expectedArtifacts: ['审查报告'] }),
])

describe('ADR-0039 superseded verification becomes a diagnostic record', () => {
  it('demotes the kept pre-repair tester when the revision adds the repair', () => {
    const revision = [
      task({ key: 'dev', role: 'developer', title: '补充说明模块' }),
      task({ key: 'test', role: 'tester', title: '运行真实测试并报告退出码', dependsOn: ['dev'], expectedArtifacts: ['测试报告'] }),
      task({ key: 'review', role: 'reviewer', title: '只读审查', dependsOn: ['test'], expectedArtifacts: ['审查报告'] }),
      task({ key: 'fix', role: 'developer', title: '修复 src/sums.mjs 使 sum 返回两个参数之和', dependsOn: ['review'], expectedArtifacts: ['代码 diff'] }),
      task({ key: 'verify', role: 'tester', title: '修复后真实复跑 node --test', dependsOn: ['fix'], expectedArtifacts: ['测试报告'] }),
    ]
    const normalized = demoteSupersededVerifications(sourcePlan, revision)
    const test = normalized.find((item) => item.key === 'test')!
    const verify = normalized.find((item) => item.key === 'verify')!
    expect(test.workType).toBe('diagnostic')
    expect(test.rationale).toContain('ADR-0039')
    // The post-repair verification stays the real gate.
    expect(verify.workType).toBeUndefined()
    // The audit chain (review still depends on the reported result) is untouched.
    expect(normalized.find((item) => item.key === 'review')!.dependsOn).toEqual(['test'])
  })

  it('leaves everything alone when the revision adds no repair', () => {
    const revision = [
      task({ key: 'dev', role: 'developer', title: '补充说明模块' }),
      task({ key: 'test', role: 'tester', title: '运行真实测试并报告退出码', dependsOn: ['dev'] }),
      task({ key: 'report', role: 'tester', title: '整理测试报告', dependsOn: ['test'] }),
    ]
    const normalized = demoteSupersededVerifications(sourcePlan, revision)
    expect(normalized.find((item) => item.key === 'test')!.workType).toBeUndefined()
  })

  it('does not demote a kept verification that already runs after the repair', () => {
    const revision = [
      task({ key: 'dev', role: 'developer' }),
      task({ key: 'test', role: 'tester', title: '运行真实测试并报告退出码', dependsOn: ['fix'] }),
      task({ key: 'fix', role: 'developer', title: '修复求和实现', dependsOn: ['dev'], expectedArtifacts: ['代码 diff'] }),
    ]
    const normalized = demoteSupersededVerifications(sourcePlan, revision)
    expect(normalized.find((item) => item.key === 'test')!.workType).toBeUndefined()
  })
})

describe('ADR-0039 a diagnostic task completes on real negative evidence', () => {
  const card = {
    id: 'tsk_test',
    projectId: 'prj_test',
    title: '运行真实测试并报告退出码',
    description: '',
    status: 'running' as const,
    priority: 2,
    acceptanceCriteria: [],
    expectedArtifacts: ['测试报告（含命令、原始输出、退出码）'],
    labels: ['plan', 'tester'],
    assigneeAgentId: 'agt_test',
    milestoneId: null,
    versionId: null,
    iterationId: null,
    dependsOn: [],
    blockedBy: [],
    workType: 'diagnostic',
    createdAt: 1,
    updatedAt: 1,
    version: 1,
  }

  it('accepts a real failing test report for a diagnostic task', () => {
    const decision = evaluateCompletion({
      task: card as never,
      runs: [
        {
          run: { id: 'run_1', status: 'running', taskId: card.id },
          toolCalls: [
            {
              id: 'tol_1',
              toolName: 'run_tests',
              status: 'completed',
              args: { command: 'node --test tests/sums.test.mjs' },
              result: { exitCode: 1 },
            },
          ],
        },
      ] as never,
      artifacts: [],
      changedFiles: [],
      actorKind: 'agent',
      reviewerName: null,
    })
    const diagnostic = decision.requirements.find((item) => item.id === 'diagnostic')
    expect(diagnostic?.satisfied).toBe(true)
    expect(diagnostic?.evidence.join(' ')).toContain('真实退出码 1')
    expect(decision.ok).toBe(true)
  })
})
