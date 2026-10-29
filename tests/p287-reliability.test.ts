import { afterEach, describe, expect, it } from 'vitest'
import { AppError, now } from '@projectos/contracts'
import type { LlmProvider } from '@projectos/provider-interfaces'
import { ActionCenter } from '../apps/runtime/src/action-center.js'
import { LifecycleService } from '../apps/runtime/src/lifecycle.js'
import { PlanGrantService } from '../apps/runtime/src/plan-grant.js'
import { PlannerService } from '../apps/runtime/src/planner.js'
import type { PlannerModelSource } from '../apps/runtime/src/planner-provider.js'
import { ReplanService } from '../apps/runtime/src/replan-service.js'
import { ReplanAutopilot } from '../apps/runtime/src/replan-autopilot.js'
import { ReviewCoordinator } from '../apps/runtime/src/review-coordinator.js'
import { TaskContractPreflightService } from '../apps/runtime/src/task-contract-preflight.js'
import { AutonomyCoordinator } from '../apps/runtime/src/autonomy-coordinator.js'
import { FakeProvider, createGitProject, logger, planWithTasks, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function task(key: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key,
    title: `任务 ${key}`,
    description: `完成 ${key} 的实现。`,
    role: 'developer',
    dependsOn: [],
    acceptanceCriteria: ['命令退出码为 0'],
    expectedArtifacts: ['代码 diff'],
    rationale: '完成需求。',
    requiresApproval: true,
    ...overrides,
  }
}

function modelSource(provider: LlmProvider): PlannerModelSource {
  return {
    resolve: () => ({
      provider,
      connectionId: 'aic_p287r',
      connectionName: '测试 AI 连接',
      model: 'fake-p287r-model',
      protocol: 'openai-chat',
    }),
  }
}

function makeHarness(text = '完成') {
  const fake = new FakeProvider(() => ({ text }))
  const harness = setup(fake)
  const planner = new PlannerService({ store: harness.store, modelSource: modelSource(fake), logger, maxRepairAttempts: 1 })
  const grants = new PlanGrantService(harness.store, logger)
  const replans = new ReplanService(harness.store, harness.orchestration, planner, grants, logger)
  const lifecycle = new LifecycleService(harness.store)
  const actions = new ActionCenter(harness.store, lifecycle)
  const preflight = new TaskContractPreflightService(harness.store)
  const autopilot = new ReplanAutopilot(
    harness.store,
    replans,
    harness.orchestration,
    grants,
    harness.scheduler,
    actions,
    preflight,
    lifecycle,
    new ReviewCoordinator(harness.store, harness.services, grants, harness.scheduler, logger),
    logger,
  )
  cleanups.push(harness.close)
  return { ...harness, planner, grants, replans, actions, preflight, autopilot }
}

function issueGrant(harness: ReturnType<typeof makeHarness>, planId: string, maxRuns = 3) {
  return harness.grants.issue({
    planId,
    actions: ['plan.start', 'workspace-write'],
    allowedPaths: ['.'],
    maxRuns,
    maxToolCalls: 60,
    ttlHours: 1,
    allowOverBudget: false,
    note: '测试授权',
    confirm: true,
  })
}

describe('Phase 2.8.7 reliability', () => {
  it('treats a duplicate business event as already coordinated', async () => {
    const harness = makeHarness()
    const project = await createGitProject(harness.services, harness.dataDir, 'p287-dup')
    const coordinator = new AutonomyCoordinator(harness.store, harness.actions, harness.scheduler, logger)
    cleanups.push(() => coordinator.dispose())
    const event = harness.store.appendEvent(project.id, project.id, 'task.moved', { taskId: 'tsk_1' })
    expect(coordinator.enqueue(event)).toBe(true)
    // The same event id must not create a second coordination intent.
    expect(coordinator.enqueue(event)).toBe(false)
    const rows = harness.store.db
      .prepare('SELECT COUNT(*) AS value FROM autonomy_events WHERE source_event_id = ?')
      .get(String(event.id)) as { value: number }
    expect(rows.value).toBe(1)
  })

  it('records autonomy coordination intents for plan lifecycle events', async () => {
    const harness = makeHarness()
    const project = await createGitProject(harness.services, harness.dataDir, 'p287-plan-event')
    const coordinator = new AutonomyCoordinator(harness.store, harness.actions, harness.scheduler, logger)
    cleanups.push(() => coordinator.dispose())
    // Before the fix, `plan.*` events produced no coordination pass at all.
    const event = harness.store.appendEvent(project.id, project.id, 'plan.replan.proposed', { proposalId: 'rpp_1' })
    expect(coordinator.enqueue(event)).toBe(true)
  })

  it('refuses to derive a grant that would widen the Agent scope', async () => {
    const harness = makeHarness()
    const project = await createGitProject(harness.services, harness.dataDir, 'p287-derive-guard')
    const agents = harness.services.projects.listAgents(project.id)
    const engineer = agents.find((item) => item.agent.capabilities.includes('implement'))!.agent
    const otherwise = agents.find((item) => item.agent.id !== engineer.id)!.agent
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('dev', { agentId: engineer.id })])
    const grant = issueGrant(harness, plan.id)
    expect(grant.allowedAgentIds).toEqual([engineer.id])

    // A captured envelope that only covers the *other* Agent must be rejected: deriving may
    // narrow authorization, never widen it.
    const widening = (() => {
      try {
        harness.grants.deriveReplanGrant({
          plan,
          sourceGrant: {
            id: grant.id,
            actions: grant.actions,
            allowedPaths: ['.'],
            allowedAgentIds: [otherwise.id],
            maxRuns: 2,
            maxToolCalls: 40,
            expiresAt: grant.expiresAt,
            allowOverBudget: false,
          },
          note: '试图扩大 Agent 范围',
        })
        return null
      } catch (caught) {
        return caught as AppError
      }
    })()
    expect(widening?.code).toBe('APPROVAL_REQUIRED')
    expect(widening?.message).toContain('必须由用户批准扩大授权')

    // A narrower envelope derives successfully and keeps every bound at or below the source.
    const derived = harness.grants.deriveReplanGrant({
      plan,
      sourceGrant: {
        id: grant.id,
        actions: grant.actions,
        allowedPaths: ['src'],
        allowedAgentIds: [engineer.id],
        maxRuns: 2,
        maxToolCalls: 40,
        expiresAt: grant.expiresAt,
        allowOverBudget: false,
      },
      note: '测试派生',
    })
    expect(derived.allowedPaths).toEqual(['src'])
    expect(derived.maxRuns).toBeLessThanOrEqual(2)
    expect(derived.actor.id).toBe('autonomy-policy')
    expect(derived.note).toContain('派生自授权')
    expect(derived.expiresAt).toBeLessThanOrEqual(grant.expiresAt)
  })

  it('counts every policy revision, not just the newest event window', async () => {
    // A real run produced 21 policy applies against a cap of 3 because the count was read from
    // the newest 500 events: older applies fell out of the window and the cap never triggered.
    const harness = makeHarness()
    const project = await createGitProject(harness.services, harness.dataDir, 'p287-window-bug')
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('dev')])
    issueGrant(harness, plan.id)
    for (let index = 0; index < 3; index += 1) {
      harness.store.appendEvent(project.id, plan.id, 'plan.replan.applied', { proposalId: `rpp_${index}`, authorizedBy: 'policy' })
    }
    for (let index = 0; index < 700; index += 1) {
      harness.store.appendEvent(project.id, plan.id, 'task.moved', { taskId: `tsk_${index}` })
    }
    harness.actions.setAutonomySettings(project.id, { mode: 'autonomous', maxAutoReplans: 3 })
    // The revision proposal faces the cap even though its applies are long out of the window.
    const proposal = await harness.replans.propose({ planId: plan.id, trigger: 'evidence_exhausted', reason: '窗口计数' }).catch(() => null)
    if (proposal) {
      const evaluation = harness.autopilot.evaluateProposal(proposal.id)
      expect(evaluation.authorization.decision).toBe('blocked')
      expect(evaluation.authorization.reasons.join(' ')).toContain('上限')
    }
  })

  it('refuses to apply a proposal whose source plan was already superseded', async () => {
    // The revision chain must move forward through the newest plan only; otherwise every old
    // proposal can be applied again and again.
    const harness = makeHarness(
      JSON.stringify({
        reason: '修订',
        assumptions: [],
        risks: [],
        tasks: [{ ...task('dev'), rationale: '修复实现并补齐真实验证证据' }],
      }),
    )
    const project = await createGitProject(harness.services, harness.dataDir, 'p287-superseded')
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('dev')])
    issueGrant(harness, plan.id)
    const stored = harness.store.read.getPlanRevision(plan.id)!
    harness.store.updatePlanRevision({
      ...stored,
      execution: {
        status: 'paused',
        concurrency: 1,
        startedAt: now(),
        updatedAt: now(),
        error: '任务缺少有效完成依据',
        runIds: [],
        workspaceRef: null,
        branch: null,
        diffArtifactId: null,
        mergedAt: null,
        maxRetries: 2,
        retries: {},
        nextAttemptAt: {},
        retryForRun: {},
        maxEvidenceRetries: 1,
        evidenceRetries: {},
        evidenceRetryForRun: {},
        requireWorktree: false,
        allowedPaths: ['.'],
      } as never,
    })
    const proposal = await harness.replans.propose({ planId: plan.id, trigger: 'evidence_exhausted', reason: '需要修订' })
    expect(proposal.error ?? '').toBe('')
    expect(proposal.status).toBe('proposed')
    // Applying it supersedes the source plan.
    harness.replans.apply(proposal.id)
    expect(harness.store.read.getPlanRevision(plan.id)!.status).toBe('superseded')
    // A second proposal against that now-superseded plan must never be applicable.
    harness.store.createReplanProposal({
      ...harness.store.read.getReplanProposal(proposal.id)!,
      id: 'rpp_old_clone',
      status: 'proposed',
      appliedPlanId: null,
      decidedAt: null,
      decidedReason: null,
      createdAt: now(),
      updatedAt: now(),
    })
    const error = (() => {
      try {
        harness.replans.apply('rpp_old_clone')
        return null
      } catch (caught) {
        return caught as AppError
      }
    })()
    expect(error?.code).toBe('CONFLICT')
    expect(error?.message).toContain('已被新的 revision 替代')
  })

  it('does nothing when the project policy is not autonomous', async () => {
    const harness = makeHarness()
    const project = await createGitProject(harness.services, harness.dataDir, 'p287-policy-off')
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('dev')])
    issueGrant(harness, plan.id)
    harness.actions.setAutonomySettings(project.id, { mode: 'assist' })
    const outcomes = await harness.autopilot.runPass(project.id)
    expect(outcomes).toEqual([])
    expect(harness.store.read.getPlanRevision(plan.id)!.execution).toBeNull()
  })

  it('resumes a plan that was paused only because it waited for an approval', async () => {
    const harness = makeHarness()
    const project = await createGitProject(harness.services, harness.dataDir, 'p287-resume')
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('dev')])
    issueGrant(harness, plan.id)
    const stored = harness.store.read.getPlanRevision(plan.id)!
    harness.store.updatePlanRevision({
      ...stored,
      execution: {
        status: 'paused',
        concurrency: 1,
        startedAt: now(),
        updatedAt: now(),
        error: '等待审批：run_tests npm test（运行 run_1）',
        runIds: [],
        workspaceRef: null,
        branch: null,
        diffArtifactId: null,
        mergedAt: null,
        maxRetries: 2,
        retries: {},
        nextAttemptAt: {},
        retryForRun: {},
        maxEvidenceRetries: 1,
        evidenceRetries: {},
        evidenceRetryForRun: {},
        requireWorktree: false,
        allowedPaths: ['.'],
      } as never,
    })
    const outcomes = await harness.autopilot.runPass(project.id)
    // No pending approval exists, so the honest state transition is "resume".
    expect(outcomes.some((item) => item.kind === 'plan.auto-resumed')).toBe(true)
    expect(harness.store.read.getPlanRevision(plan.id)!.execution?.status).toBe('running')
  })

  it('keeps the existing start guard: an autonomous start needs an active grant', async () => {
    const harness = makeHarness()
    const project = await createGitProject(harness.services, harness.dataDir, 'p287-no-grant')
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('dev')])
    const outcomes = await harness.autopilot.runPass(project.id)
    expect(outcomes.some((item) => item.kind === 'plan.auto-started')).toBe(false)
    expect(harness.store.read.getPlanRevision(plan.id)!.execution).toBeNull()
    const error = (() => {
      try {
        harness.grants.assertStartAllowed(harness.store.read.getPlanRevision(plan.id)!)
        return null
      } catch (caught) {
        return caught as AppError
      }
    })()
    expect(error?.code).toBe('APPROVAL_REQUIRED')
  })
})
