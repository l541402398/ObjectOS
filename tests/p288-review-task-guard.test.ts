import { afterEach, describe, expect, it } from 'vitest'
import { now } from '@projectos/contracts'
import { PlanGrantService } from '../apps/runtime/src/plan-grant.js'
import { createGitProject, logger, planWithTasks, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function task(key: string, overrides: Record<string, unknown> = {}) {
  return {
    key,
    title: `任务 ${key}`,
    description: `完成 ${key}。`,
    role: 'developer',
    dependsOn: [],
    acceptanceCriteria: ['退出码 0'],
    expectedArtifacts: ['代码 diff'],
    rationale: '完成需求所需的实现步骤。',
    requiresApproval: false,
    ...overrides,
  }
}

/**
 * ADR-0033 — a reviewer that writes to the reviewed files makes its own snapshot stale on every
 * pass, which turns autonomous re-review into an endless loop. The grant must therefore deny writes
 * for review tasks and keep non-read-only process execution behind an approval.
 */
describe('ADR-0033 review tasks are read-only', () => {
  async function setupReviewPlan() {
    const harness = setup(undefined, { providerConfig: {} })
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'p288-reviewer-guard')
    const developer = harness.services.projects
      .listAgents(project.id)
      .find((item) => item.agent.capabilities.includes('implement'))!.agent
    const reviewer = harness.services.projects
      .listAgents(project.id)
      .find((item) => item.agent.capabilities.includes('review'))!.agent
    const { plan, taskIds } = planWithTasks(harness.orchestration, project.id, [
      task('dev', { agentId: developer.id }),
      task('review', { agentId: reviewer.id, role: 'reviewer', expectedArtifacts: ['审查报告'], dependsOn: ['dev'] }),
    ])
    const grants = new PlanGrantService(harness.store, logger)
    grants.issue({
      planId: plan.id,
      actions: ['plan.start', 'workspace-write'],
      allowedPaths: ['.'],
      maxRuns: 4,
      maxToolCalls: 80,
      ttlHours: 1,
      allowOverBudget: false,
      note: '测试授权',
      confirm: true,
    })
    return { harness, project, grants, plan, developerTaskId: taskIds[0]!, reviewTaskId: taskIds[1]! }
  }

  it('denies write_file on a review task and allows it on a developer task', async () => {
    const { harness, project, grants, plan, developerTaskId, reviewTaskId } = await setupReviewPlan()
    const asRun = (taskId: string, toolName: string, args: Record<string, unknown>) => ({
      projectId: project.id,
      workspaceRoot: project.rootPath,
      taskId,
      runId: 'run_guard',
      agentId: harness.store.read.getTaskCard(taskId)!.assigneeAgentId!,
      toolName,
      toolCallId: `tol_${toolName}_${taskId}`,
      args,
    })
    const reviewWrite = grants.authorizeToolCall(asRun(reviewTaskId, 'write_file', { path: 'src/sums.mjs', content: 'x' }))
    expect(reviewWrite.decision).toBe('deny')
    expect(reviewWrite.reason).toContain('审查任务不得修改')

    const devWrite = grants.authorizeToolCall(asRun(developerTaskId, 'write_file', { path: 'src/sums.mjs', content: 'x' }))
    expect(devWrite.decision).toBe('allow')

    // A read-only inspection is allowed for the reviewer, but arbitrary execution is not.
    const readOnly = grants.authorizeToolCall(asRun(reviewTaskId, 'run_command', { command: 'git diff HEAD' }))
    expect(['allow', 'approval']).toContain(readOnly.decision)
    const arbitrary = grants.authorizeToolCall(asRun(reviewTaskId, 'run_command', { command: 'node -e "require(\'fs\').writeFileSync(\'a\',\'b\')"' }))
    expect(arbitrary.decision).toBe('approval')
    expect(arbitrary.reason).toContain('只读检查')
    // Sanity: the plan still has its tasks and the grant is live.
    expect(harness.store.read.getPlanRevision(plan.id)!.createdTaskIds).toHaveLength(2)
    expect(grants.get(plan.id)?.valid).toBe(true)
    expect(now()).toBeGreaterThan(0)
  })
})
