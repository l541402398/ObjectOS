import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationService } from '../apps/runtime/src/orchestration.js'
import { PlannerService } from '../apps/runtime/src/planner.js'
import type { PlannerModelSource } from '../apps/runtime/src/planner-provider.js'
import type { LlmProvider } from '@projectos/provider-interfaces'
import { FakeProvider, createGitProject, logger, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function modelSource(provider: LlmProvider): PlannerModelSource {
  return {
    resolve: () => ({
      provider,
      connectionId: 'aic_p29_race',
      connectionName: '测试 AI 连接',
      model: 'fake-p29-race',
      protocol: 'openai-chat',
    }),
  }
}

/**
 * ADR-0051 exposed a real UNIQUE violation: the autonomous draft pass and an explicit 生成计划 could
 * both call `getNextPlanRevision` before inserting, so the second insert failed with
 * `UNIQUE constraint failed: plan_revisions.project_id, plan_revisions.revision`.
 * Plan revisions for one project are now allocated through a per-project queue.
 */
describe('ADR-0051 plan revision allocation is serialized per project', () => {
  it('two concurrent AI generations both persist, with distinct revisions', async () => {
    const fake = new FakeProvider(() => ({ text: '{"tasks": []}' }))
    const harness = setup(fake)
    cleanups.push(harness.close)
    const planner = new PlannerService({ store: harness.store, modelSource: modelSource(fake), logger, maxRepairAttempts: 0 })
    const orchestration = new OrchestrationService(harness.store, harness.services, planner)
    const project = await createGitProject(harness.services, harness.dataDir, 'p29-plan-race')

    const results = await Promise.allSettled([
      orchestration.generateAIPlan({ projectId: project.id, goal: '实现搜索', mode: 'ai', allowRuleFallback: true, maxTasks: 3, allowOverBudget: false }),
      orchestration.generateAIPlan({ projectId: project.id, goal: '实现导出', mode: 'ai', allowRuleFallback: true, maxTasks: 3, allowOverBudget: false }),
    ])
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(rejected, rejected.map((result) => String((result as PromiseRejectedResult).reason)).join('; ')).toHaveLength(0)

    const plans = harness.store.read.listAllPlanRevisions().filter((plan) => plan.projectId === project.id)
    expect(plans).toHaveLength(2)
    expect(new Set(plans.map((plan) => plan.revision)).size).toBe(2)
  })
})
