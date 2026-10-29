import { afterEach, describe, expect, it } from 'vitest'
import { now } from '@projectos/contracts'
import { ActionCenter } from '../apps/runtime/src/action-center.js'
import { PlanGrantService } from '../apps/runtime/src/plan-grant.js'
import { projectJourney, resetJourneyGitCache } from '../apps/runtime/src/journey.js'
import { LifecycleService } from '../apps/runtime/src/lifecycle.js'
import { createGitProject, logger, planWithTasks, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
  resetJourneyGitCache()
})

function task(key: string) {
  return {
    key,
    title: `任务 ${key}`,
    description: `完成 ${key}`,
    role: 'developer',
    dependsOn: [],
    acceptanceCriteria: ['完成'],
    expectedArtifacts: ['代码 diff'],
    rationale: 'fixture',
    requiresApproval: false,
  }
}

/**
 * ADR-0053 — the journey bar must be derivable, and every stage must come from a persisted fact.
 * These cases pin the states a first-time user passes through, including the ones Phase 2.8.8 used to
 * mislabel (approved-but-not-authorized shown as "no plan", granted-but-not-started shown as nothing).
 */
describe('ADR-0053 project journey projection', () => {
  async function setupJourney() {
    const harness = setup(undefined, { providerConfig: {} })
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'p29-journey')
    const actions = new ActionCenter(harness.store, new LifecycleService(harness.store))
    const grants = new PlanGrantService(harness.store, logger)
    const journey = () => projectJourney({ store: harness.store, actions, grants, projectId: project.id })
    return { harness, project, actions, grants, journey }
  }

  it('starts at requirement for a fresh project and points the user at the right page', async () => {
    const { journey } = await setupJourney()
    const view = journey()
    expect(view.selection.kind).toBe('none')
    expect(view.stages.map((stage) => stage.key)).toEqual([
      'setup',
      'requirement',
      'plan',
      'review',
      'grant',
      'execute',
      'verify',
      'code-review',
      'delivery',
    ])
    const requirement = view.stages.find((stage) => stage.key === 'requirement')!
    expect(requirement.state).toBe('active')
    expect(requirement.owner).toBe('user')
    expect(view.nextAction.owner).toBe('user')
    expect(view.nextAction.label).toContain('需求')
    expect(view.nextAction.route).toContain('/work')
    // Nothing is claimed as done by accident.
    expect(view.stages.filter((stage) => stage.state === 'done')).toHaveLength(1)
  })

  it('shows a draft as "waiting for your review" rather than "no plan"', async () => {
    const { harness, project, journey } = await setupJourney()
    harness.services.projects.createRequirement({
      projectId: project.id,
      title: '实现便签搜索',
      body: '按标题搜索',
      acceptanceCriteria: [],
      source: 'local',
    })
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('impl')])
    const draft = harness.store.read.getPlanRevision(plan.id)!
    harness.store.updatePlanRevision({ ...draft, status: 'draft', updatedAt: now() })
    const view = journey()
    expect(view.selection.kind).toBe('draft')
    expect(view.stages.find((stage) => stage.key === 'review')!.state).toBe('active')
    expect(view.nextAction.owner).toBe('user')
    expect(view.nextAction.label).toContain('审核计划')
    expect(view.nextAction.objectId).toBe(draft.id)
  })

  it('separates "approved but not authorized" from "no plan" and from "started"', async () => {
    const { harness, project, actions, grants, journey } = await setupJourney()
    harness.services.projects.createRequirement({
      projectId: project.id,
      title: '实现便签搜索',
      body: '按标题搜索',
      acceptanceCriteria: [],
      source: 'local',
    })
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('impl')])
    let view = journey()
    expect(view.stages.find((stage) => stage.key === 'review')!.state).toBe('done')
    expect(view.stages.find((stage) => stage.key === 'grant')!.state).toBe('blocked')
    expect(view.nextAction.label).toContain('授权')

    // Authorized but not started: the bar must say it is ready / auto-starting, not "nothing".
    actions.setAutonomySettings(project.id, { mode: 'assist' })
    grants.issue({
      planId: plan.id,
      actions: ['plan.start'],
      allowedPaths: [],
      maxRuns: 1,
      maxToolCalls: 40,
      ttlHours: 1,
      allowOverBudget: false,
      note: 'fixture',
      confirm: true,
    })
    view = journey()
    expect(view.stages.find((stage) => stage.key === 'grant')!.state).toBe('done')
    expect(view.stages.find((stage) => stage.key === 'execute')!.state).toBe('active')
    expect(view.nextAction.owner).not.toBe('none')
  })

  it('keeps the goal visible when the execution failed and points at the real cause', async () => {
    const { harness, project, grants, journey } = await setupJourney()
    harness.services.projects.createRequirement({
      projectId: project.id,
      title: '空仓库首次执行',
      body: '',
      acceptanceCriteria: [],
      source: 'local',
    })
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('impl')])
    grants.issue({
      planId: plan.id,
      actions: ['plan.start'],
      allowedPaths: [],
      maxRuns: 1,
      maxToolCalls: 40,
      ttlHours: 1,
      allowOverBudget: false,
      note: 'fixture',
      confirm: true,
    })
    const approved = harness.store.read.getPlanRevision(plan.id)!
    harness.store.updatePlanRevision({
      ...approved,
      execution: {
        ...(approved.execution ?? {}),
        status: 'failed',
        concurrency: 1,
        startedAt: now(),
        updatedAt: now(),
        error: '无法创建隔离 Worktree，已停止执行：fatal: invalid reference: projectos/plan-x',
        runIds: [],
        workspaceRef: null,
        branch: null,
        baseBranch: null,
        baseCommit: null,
        allowedPaths: ['.'],
        diffArtifactId: null,
        mergedAt: null,
        maxRetries: 1,
        retries: {},
        nextAttemptAt: {},
        retryForRun: {},
        maxEvidenceRetries: 1,
        evidenceRetries: {},
        deadlineAt: 0,
        budgetExhausted: null,
        maxWallClockMs: 0,
        deliveryStatus: 'none',
      },
      updatedAt: now(),
    } as never)
    const view = journey()
    const execute = view.stages.find((stage) => stage.key === 'execute')!
    expect(execute.state).toBe('blocked')
    expect(execute.detail).toContain('Worktree')
    expect(view.blockers.join(' ')).toContain('执行')
    expect(view.nextAction.owner).toBe('ai')
    expect(view.nextAction.detail).toContain('Worktree')
  })

  it('never claims verification while the run is paused on stale evidence', async () => {
    const { harness, project, grants, journey } = await setupJourney()
    harness.services.projects.createRequirement({
      projectId: project.id,
      title: '真实 AI 测试证据过期',
      body: '',
      acceptanceCriteria: [],
      source: 'local',
    })
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('impl')])
    grants.issue({
      planId: plan.id,
      actions: ['plan.start'],
      allowedPaths: [],
      maxRuns: 1,
      maxToolCalls: 40,
      ttlHours: 1,
      allowOverBudget: false,
      note: 'fixture',
      confirm: true,
    })
    const approved = harness.store.read.getPlanRevision(plan.id)!
    harness.store.updatePlanRevision({
      ...approved,
      execution: {
        ...(approved.execution ?? {}),
        status: 'paused',
        concurrency: 1,
        startedAt: now(),
        updatedAt: now(),
        error: '任务「创建 hello.txt」缺少有效完成依据：测试证据已过期：存在历史测试证据，但它不描述当前内容',
        runIds: [],
        workspaceRef: '/tmp/ws',
        branch: 'projectos/plan-x',
        baseBranch: 'master',
        baseCommit: 'abc',
        allowedPaths: ['.'],
        diffArtifactId: null,
        mergedAt: null,
        maxRetries: 1,
        retries: {},
        nextAttemptAt: {},
        retryForRun: {},
        maxEvidenceRetries: 1,
        evidenceRetries: {},
        deadlineAt: 0,
        budgetExhausted: null,
        maxWallClockMs: 0,
        deliveryStatus: 'none',
      },
      updatedAt: now(),
    } as never)

    const view = journey()
    expect(view.stages.find((stage) => stage.key === 'verify')!.state).toBe('blocked')
    expect(view.nextAction.owner).toBe('user')
    expect(view.nextAction.label).toContain('重新验证')
    // The bar needs a real recovery action bound to the task, not just a page link.
    expect(view.nextAction.action).toBe('reverify')
    expect(view.nextAction.objectId).toBe(approved.createdTaskIds[0])
  })

  it('reports a delivered goal as done with its merge commit and evidence', async () => {
    const { harness, project, grants, journey } = await setupJourney()
    harness.services.projects.createRequirement({
      projectId: project.id,
      title: '实现并交付',
      body: '',
      acceptanceCriteria: [],
      source: 'local',
    })
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('impl')])
    grants.issue({
      planId: plan.id,
      actions: ['plan.start'],
      allowedPaths: [],
      maxRuns: 1,
      maxToolCalls: 40,
      ttlHours: 1,
      allowOverBudget: false,
      note: 'fixture',
      confirm: true,
    })
    const approved = harness.store.read.getPlanRevision(plan.id)!
    harness.store.updatePlanRevision({
      ...approved,
      execution: {
        ...(approved.execution ?? {}),
        status: 'completed',
        concurrency: 1,
        startedAt: now(),
        updatedAt: now(),
        error: null,
        runIds: [],
        workspaceRef: '/tmp/ws',
        branch: 'projectos/plan-x',
        baseBranch: 'master',
        baseCommit: 'abc',
        allowedPaths: ['.'],
        diffArtifactId: null,
        mergedAt: now(),
        mergeCommit: 'b352a3fad220149b6c9ab9bdda8ba31fd6a31906',
        maxRetries: 1,
        retries: {},
        nextAttemptAt: {},
        retryForRun: {},
        maxEvidenceRetries: 1,
        evidenceRetries: {},
        deadlineAt: 0,
        budgetExhausted: null,
        maxWallClockMs: 0,
        deliveryStatus: 'verified',
        deliveryVerifiedAt: now(),
        deliveryEvidenceId: null,
        deliveryError: null,
      },
      updatedAt: now(),
    } as never)
    const view = journey()
    expect(view.stages.find((stage) => stage.key === 'delivery')!.state).toBe('done')
    expect(view.stages.find((stage) => stage.key === 'delivery')!.objects.mergeCommit).toBe('b352a3fad220149b6c9ab9bdda8ba31fd6a31906')
    expect(view.nextAction.owner).toBe('none')
    expect(view.nextAction.label).toContain('已完成交付')
  })
})
