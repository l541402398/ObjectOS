import { afterEach, describe, expect, it } from 'vitest'
import { ActionCenter } from '../apps/runtime/src/action-center.js'
import { LifecycleService } from '../apps/runtime/src/lifecycle.js'
import { PlanGrantService } from '../apps/runtime/src/plan-grant.js'
import { ReplanAutopilot } from '../apps/runtime/src/replan-autopilot.js'
import { ReplanService } from '../apps/runtime/src/replan-service.js'
import { ReviewCoordinator } from '../apps/runtime/src/review-coordinator.js'
import { TaskContractPreflightService } from '../apps/runtime/src/task-contract-preflight.js'
import { PlannerService } from '../apps/runtime/src/planner.js'
import { OrchestrationService } from '../apps/runtime/src/orchestration.js'
import type { LlmProvider } from '@projectos/provider-interfaces'
import type { PlannerModelSource } from '../apps/runtime/src/planner-provider.js'
import { FakeProvider, createGitProject, logger, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

/**
 * ADR-0051 — autonomous mode drafts the plan; the human still approves and authorizes.
 *
 * Before this, creating a requirement left the user to click "生成计划" before anything could happen.
 * Drafting is read-only, so the product does it once per requirement; a draft never executes until
 * the user approves the plan and issues the grant.
 */
function modelSource(provider: LlmProvider): PlannerModelSource {
  return {
    resolve: () => ({
      provider,
      connectionId: 'aic_p29',
      connectionName: '测试 AI 连接',
      model: 'fake-p29-model',
      protocol: 'openai-chat',
    }),
  }
}

function makeHarness() {
  const fake = new FakeProvider(() => ({ text: '完成' }))
  const harness = setup(fake)
  const planner = new PlannerService({ store: harness.store, modelSource: modelSource(fake), logger, maxRepairAttempts: 1 })
  // Production wires the model planner into OrchestrationService; the fixture's instance has none.
  const orchestration = new OrchestrationService(harness.store, harness.services, planner)
  const grants = new PlanGrantService(harness.store, logger)
  const replans = new ReplanService(harness.store, orchestration, planner, grants, logger)
  const actions = new ActionCenter(harness.store, new LifecycleService(harness.store))
  const autopilot = new ReplanAutopilot(
    harness.store,
    replans,
    orchestration,
    grants,
    harness.scheduler,
    actions,
    new TaskContractPreflightService(harness.store),
    new LifecycleService(harness.store),
    new ReviewCoordinator(harness.store, harness.services, grants, harness.scheduler, logger),
    logger,
  )
  cleanups.push(harness.close)
  return { ...harness, orchestration, grants, actions, autopilot }
}

describe('ADR-0051 autonomous planning from a requirement', () => {
  it('drafts exactly once for the newest requirement, and never approves or authorizes by itself', async () => {
    const harness = makeHarness()
    const project = await createGitProject(harness.services, harness.dataDir, 'p29-autodraft')
    harness.actions.setAutonomySettings(project.id, { mode: 'autonomous', autoStartPlans: true, autoApplyReplans: true })
    harness.services.projects.createRequirement({
      projectId: project.id,
      title: '实现便签搜索',
      body: '支持按标题与正文关键字搜索，并给出匹配高亮。',
      acceptanceCriteria: ['搜索返回匹配项'],
      source: 'local',
    })

    const first = await harness.autopilot.runPass(project.id)
    expect(first.some((outcome) => outcome.kind === 'plan.draft-created')).toBe(true)
    const plans = harness.orchestration.listPlans(project.id)
    expect(plans).toHaveLength(1)
    expect(plans[0]?.status).toBe('draft')
    expect(plans[0]?.goal).toContain('实现便签搜索')
    // No task was created and no grant was issued: approval + authorization are still human.
    expect(plans[0]?.createdTaskIds).toHaveLength(0)
    expect(harness.grants.get(plans[0]!.id)).toBeNull()

    const second = await harness.autopilot.runPass(project.id)
    expect(second.some((outcome) => outcome.kind === 'plan.draft-created')).toBe(false)
    expect(harness.orchestration.listPlans(project.id)).toHaveLength(1)
  })

  it('does nothing in assist mode', async () => {
    const harness = makeHarness()
    const project = await createGitProject(harness.services, harness.dataDir, 'p29-autodraft-assist')
    harness.actions.setAutonomySettings(project.id, { mode: 'assist' })
    harness.services.projects.createRequirement({
      projectId: project.id,
      title: '实现导出',
      body: '导出为 Markdown 文件。',
      acceptanceCriteria: [],
      source: 'local',
    })
    const outcomes = await harness.autopilot.runPass(project.id)
    expect(outcomes.some((outcome) => outcome.kind === 'plan.draft-created')).toBe(false)
    expect(harness.orchestration.listPlans(project.id)).toHaveLength(0)
  })
})
