import { afterEach, describe, expect, it } from 'vitest'
import { now } from '@projectos/contracts'
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
import { detectApprovalPark } from '../apps/runtime/src/approval-park.js'
import { FakeProvider, createGitProject, logger, planWithTasks, setup, waitFor } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function task(key: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key,
    title: `任务 ${key}`,
    description: `完成 ${key} 的可验证实现。`,
    role: 'developer',
    dependsOn: [],
    acceptanceCriteria: ['命令退出码为 0'],
    expectedArtifacts: ['代码 diff'],
    rationale: '完成需求所需的实现步骤。',
    requiresApproval: true,
    ...overrides,
  }
}

function modelSource(provider: LlmProvider): PlannerModelSource {
  return {
    resolve: () => ({
      provider,
      connectionId: 'aic_p287',
      connectionName: '测试 AI 连接',
      model: 'fake-p287-model',
      protocol: 'openai-chat',
    }),
  }
}

function makeHarness(fake: LlmProvider) {
  const harness = setup(fake)
  const planner = new PlannerService({ store: harness.store, modelSource: modelSource(fake), logger, maxRepairAttempts: 1 })
  const grants = new PlanGrantService(harness.store, logger)
  const replans = new ReplanService(harness.store, harness.orchestration, planner, grants, logger)
  const actions = new ActionCenter(harness.store, new LifecycleService(harness.store))
  const preflight = new TaskContractPreflightService(harness.store)
  const autopilot = new ReplanAutopilot(
    harness.store,
    replans,
    harness.orchestration,
    grants,
    harness.scheduler,
    actions,
    preflight,
    new LifecycleService(harness.store),
    new ReviewCoordinator(
      harness.store,
      harness.services,
      grants,
      harness.scheduler,
      logger,
    ),
    logger,
  )
  cleanups.push(harness.close)
  return { ...harness, planner, grants, replans, actions, preflight, autopilot }
}

function issueGrant(
  harness: ReturnType<typeof makeHarness>,
  planId: string,
  overrides: { maxRuns?: number; maxToolCalls?: number; allowedAgentIds?: string[] } = {},
) {
  return harness.grants.issue({
    planId,
    actions: ['plan.start', 'workspace-write'],
    allowedPaths: ['.'],
    maxRuns: overrides.maxRuns ?? 3,
    maxToolCalls: overrides.maxToolCalls ?? 60,
    ttlHours: 1,
    allowOverBudget: false,
    note: '测试授权',
    confirm: true,
  })
}

/** Puts the plan into a state where a replan is legally allowed (evidence exhausted). */
function markEvidenceExhausted(harness: ReturnType<typeof makeHarness>, planId: string): void {
  const plan = harness.store.read.getPlanRevision(planId)!
  harness.store.updatePlanRevision({
    ...plan,
    execution: {
      status: 'paused',
      concurrency: 1,
      startedAt: now(),
      updatedAt: now(),
      error: '任务「dev」缺少有效完成依据：缺少代码证据',
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
}

describe('ADR-0026 product autonomy pipeline', () => {
  it('starts an approved plan that already has an active grant, without any script call', async () => {
    const harness = makeHarness(new FakeProvider(() => ({ text: '完成' })))
    const project = await createGitProject(harness.services, harness.dataDir, 'p287-autostart')
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('dev')])
    issueGrant(harness, plan.id)

    const outcomes = await harness.autopilot.runPass(project.id)
    expect(outcomes.some((item) => item.kind === 'plan.auto-started')).toBe(true)
    const started = harness.store.read.getPlanRevision(plan.id)!
    expect(started.execution?.status).toBe('running')
    // The scheduler starts Runs asynchronously on its own tick; wait for the real evidence.
    await waitFor(
      () => (harness.store.read.getPlanRevision(plan.id)?.execution?.runIds.length ?? 0) > 0,
      15_000,
      'first run of the auto-started plan',
    )
    // The decision is recorded, with the policy that authorized it.
    const events = harness.store.read.listEventViews(project.id, 100)
    expect(events.some((event) => event.eventType === 'plan.status.changed' && event.payload.authorizedBy === 'policy')).toBe(
      true,
    )
  })

  it('preflights a task contract and refuses one that no Agent can fulfil', async () => {
    const harness = makeHarness(new FakeProvider(() => ({ text: '完成' })))
    const project = await createGitProject(harness.services, harness.dataDir, 'p287-preflight')
    const agent = harness.services.projects.listAgents(project.id).find((item) => item.agent.capabilities.includes('implement'))!
    const base = {
      projectId: project.id,
      taskId: 'tsk_preflight',
      title: '实现任务',
      role: 'developer',
      expectedArtifacts: ['代码 diff'],
      acceptanceCriteria: ['命令退出码为 0'],
      grant: null,
    }
    // Unknown Agent: nothing can run it.
    const unknown = harness.preflight.preflightTaskCard({ ...base, agentId: 'agt_missing' })
    expect(unknown.map((gap) => gap.code)).toContain('agent-not-in-project')
    // Unknown WorkType: CompletionDecision cannot judge the outcome.
    const badType = harness.preflight.preflightTaskCard({ ...base, agentId: agent.agent.id, workType: 'not-a-work-type' })
    expect(badType.map((gap) => gap.code)).toContain('unknown-work-type')
    // No declared artifacts: completion evidence falls back to a role default.
    const noArtifacts = harness.preflight.preflightTaskCard({
      ...base,
      agentId: agent.agent.id,
      expectedArtifacts: [],
    })
    expect(noArtifacts.map((gap) => gap.code)).toContain('no-expected-artifacts')
    // A healthy contract produces no gaps.
    expect(harness.preflight.preflightTaskCard({ ...base, agentId: agent.agent.id })).toEqual([])
  })

  it('applies a revision that stays inside the granted envelope and restarts execution', async () => {
    const holder = { text: '完成' }
    const harness = makeHarness(new FakeProvider(() => ({ text: holder.text })))
    const project = await createGitProject(harness.services, harness.dataDir, 'p287-autoapply')
    const agentId = harness.services.projects.listAgents(project.id).find((item) => item.agent.capabilities.includes('implement'))!.agent.id
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('dev', { agentId })])
    // The revision stays strictly inside what the user already authorized: same Agent, same
    // paths, same tools; it only adds a verification task.
    holder.text = JSON.stringify({
      reason: '补上验证任务',
      assumptions: [],
      risks: [],
      tasks: [
        task('dev', { agentId }),
        task('verify', { agentId, role: 'developer', expectedArtifacts: ['测试报告'], dependsOn: ['dev'] }),
      ],
    })
    issueGrant(harness, plan.id)
    markEvidenceExhausted(harness, plan.id)
    const proposal = await harness.replans.propose({
      planId: plan.id,
      trigger: 'evidence_exhausted',
      reason: '缺少验证任务',
    })
    expect(proposal.status).toBe('proposed')

    const outcomes = await harness.autopilot.runPass(project.id)
    expect(outcomes.some((item) => item.kind === 'replan.auto-applied')).toBe(true)
    const applied = harness.store.read.getReplanProposal(proposal.id)!
    expect(applied.status).toBe('applied')
    expect(applied.decidedReason).toContain('自动应用')
    // The revision is a new approved plan, running under a derived grant.
    const revised = harness.store.read.getPlanRevision(applied.appliedPlanId!)!
    expect(revised.status).toBe('approved')
    expect(revised.execution?.status).toBe('running')
    const grant = harness.grants.get(revised.id)!
    expect(grant.actor.id).toBe('autonomy-policy')
    expect(grant.note).toContain('派生自授权')
    const events = harness.store.read.listEventViews(project.id, 200)
    expect(
      events.some((event) => event.eventType === 'plan.replan.applied' && event.payload.authorizedBy === 'policy'),
    ).toBe(true)
  })

  it('asks the user, with the exact delta, when the revision needs an Agent outside the grant', async () => {
    const otherAgent = { id: null as string | null }
    const revision = {
      reason: '需要一个新 Agent',
      assumptions: [],
      risks: [],
      tasks: [task('dev'), task('audit', { role: 'reviewer', expectedArtifacts: ['审查报告'], dependsOn: ['dev'] })],
    }
    const fake = new FakeProvider(() => ({ text: JSON.stringify(revision) }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'p287-envelope')
    const agents = harness.services.projects.listAgents(project.id)
    otherAgent.id = agents[0]?.agent.id ?? null
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('dev')])
    // Grant covers only the *current* assignee; a revision that adds a new Agent must escalate.
    issueGrant(harness, plan.id, { allowedAgentIds: [agents[0]!.agent.id] })
    markEvidenceExhausted(harness, plan.id)
    const proposal = await harness.replans.propose({ planId: plan.id, trigger: 'evidence_exhausted', reason: '缺少审查' })
    // Simulate the Replanner assigning a different Agent for the new task.
    const stored = harness.store.read.getReplanProposal(proposal.id)!
    const outsider = agents.find((item) => item.agent.id !== stored.proposedTasks[0]?.agentId)?.agent.id ?? 'agt_other'
    harness.store.updateReplanProposal({
      ...stored,
      proposedTasks: stored.proposedTasks.map((item, index) => (index === 0 ? { ...item, agentId: outsider } : item)),
    })

    const outcomes = await harness.autopilot.runPass(project.id)
    expect(outcomes.some((item) => item.kind === 'replan.awaiting-approval')).toBe(true)
    expect(harness.store.read.getReplanProposal(proposal.id)!.status).toBe('proposed')
    const items = harness.actions.items(project.id)
    const scopeItem = items.find((item) => item.kind === 'replan_scope')
    expect(scopeItem?.proposalId).toBe(proposal.id)
    expect(scopeItem?.reason).toBeTruthy()
  })

  it('stops auto-revising once the project policy limit is reached', async () => {
    const revision = { reason: '再试一次', assumptions: [], risks: [], tasks: [task('dev')] }
    const fake = new FakeProvider(() => ({ text: JSON.stringify(revision) }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'p287-limit')
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('dev')])
    issueGrant(harness, plan.id)
    markEvidenceExhausted(harness, plan.id)
    harness.actions.setAutonomySettings(project.id, { mode: 'autonomous', maxAutoReplans: 0 })
    const proposal = await harness.replans.propose({ planId: plan.id, trigger: 'evidence_exhausted', reason: '再次失败' })

    const outcomes = await harness.autopilot.runPass(project.id)
    expect(outcomes.some((item) => item.kind === 'replan.blocked')).toBe(true)
    expect(harness.store.read.getReplanProposal(proposal.id)!.status).toBe('proposed')
  })
})

  it('keeps the approved Agent binding when a revision repairs the same task', async () => {
    const holder = { text: '完成' }
    const harness = makeHarness(new FakeProvider(() => ({ text: holder.text })))
    const project = await createGitProject(harness.services, harness.dataDir, 'p287-agent-binding')
    const agentId = harness.services.projects.listAgents(project.id).find((item) =>
      item.agent.capabilities.includes('implement'),
    )!.agent.id
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('dev', { agentId })])
    issueGrant(harness, plan.id)
    markEvidenceExhausted(harness, plan.id)
    // The Replanner returns the same task key/role but no agentId: the product must not
    // re-resolve it to a different Agent, or every legitimate repair would escalate.
    holder.text = JSON.stringify({
      reason: '补齐证据',
      assumptions: [],
      risks: [],
      tasks: [task('dev'), task('verify', { role: 'developer', expectedArtifacts: ['测试报告'], dependsOn: ['dev'] })],
    })
    const proposal = await harness.replans.propose({
      planId: plan.id,
      trigger: 'evidence_exhausted',
      reason: '缺少测试证据',
    })
    const kept = proposal.proposedTasks.find((item) => item.key === 'dev')
    expect(kept?.agentId).toBe(agentId)
    expect(proposal.diff.agentChanges).toHaveLength(0)
    expect(proposal.grantImpact.newAgents).toHaveLength(0)
    // ...and because the Agent scope did not change, the revision is auto-appliable.
    const evaluation = harness.autopilot.evaluateProposal(proposal.id)
    expect(evaluation.authorization.decision).toBe('auto-apply')
  })

  it('assigns a newly added repair task to an Agent the user already authorized', async () => {
    const holder = { text: '完成' }
    const harness = makeHarness(new FakeProvider(() => ({ text: holder.text })))
    const project = await createGitProject(harness.services, harness.dataDir, 'p287-authorised-agent')
    const implementAgent = harness.services.projects.listAgents(project.id).find((item) =>
      item.agent.capabilities.includes('implement'),
    )!.agent.id
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('dev', { agentId: implementAgent })])
    issueGrant(harness, plan.id)
    markEvidenceExhausted(harness, plan.id)
    // The Replanner adds a repair task without an agentId; the resolver would pick a builtin
    // Agent that is *not* in the grant. The product must reuse the authorized Agent instead of
    // asking the user to widen authorization for work the envelope already covers.
    holder.text = JSON.stringify({
      reason: '修复实现',
      assumptions: [],
      risks: [],
      tasks: [
        task('dev'),
        task('fix', { role: 'developer', expectedArtifacts: ['代码 diff'], dependsOn: ['dev'] }),
      ],
    })
    const proposal = await harness.replans.propose({
      planId: plan.id,
      trigger: 'evidence_exhausted',
      reason: '需要修复任务',
    })
    const added = proposal.proposedTasks.find((item) => item.key === 'fix')
    expect(added?.agentId).toBe(implementAgent)
    expect(proposal.grantImpact.newAgents).toHaveLength(0)
    expect(harness.autopilot.evaluateProposal(proposal.id).authorization.decision).toBe('auto-apply')
  })

  it('counts plan starts, not task runs, against the Run budget', async () => {
    // A revision with many tasks still needs exactly one plan start; measuring tasks against
    // maxRuns (which bounds starts) would wrongly escalate every sizeable repair.
    const harness = makeHarness(new FakeProvider(() => ({ text: '完成' })))
    const project = await createGitProject(harness.services, harness.dataDir, 'p287-start-budget')
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('dev')])
    issueGrant(harness, plan.id, { maxRuns: 2 })
    markEvidenceExhausted(harness, plan.id)
    const evaluation = harness.autopilot.evaluateProposal(
      (
        await harness.replans.propose({ planId: plan.id, trigger: 'evidence_exhausted', reason: '预算语义' })
      ).id,
    )
    expect(evaluation.requirements.startsNeeded).toBe(1)
    expect(evaluation.authorization.diffs.join(' ')).not.toContain('次计划启动')
  })

describe('ADR-0027 approval park is not "running"', () => {
  it('detects a run parked on an undecided approval and reports the exact object', async () => {
    const harness = makeHarness(new FakeProvider(() => ({ text: '完成' })))
    const project = await createGitProject(harness.services, harness.dataDir, 'p287-park')
    const { plan, taskIds } = planWithTasks(harness.orchestration, project.id, [task('dev')])
    // Materialise a Run plus a parked tool call, exactly as the runner persists them.
    const taskId = taskIds[0]!
    const agentId = harness.services.projects.listAgents(project.id).find((item) =>
      item.agent.capabilities.includes('implement'),
    )!.agent.id
    const session = harness.services.sessions.create({ projectId: project.id, agentId, title: 'approval park' })
    harness.store.db
      .prepare(
        "INSERT INTO agent_runs (id, project_id, task_id, session_id, agent_id, status, error, created_at, started_at, finished_at, input_tokens, output_tokens) VALUES ('run_park','" +
          project.id +
          "','" +
          taskId +
          "','" +
          session.id +
          "','" +
          agentId +
          "','waiting_approval','',?,?,NULL,0,0)",
      )
      .run(now() - 60_000, now() - 60_000)
    harness.store.db
      .prepare(
        "INSERT INTO tool_calls (id, run_id, tool_name, idempotency_key, status, args_hash, args_json, created_at, started_at, finished_at) VALUES ('tol_park','run_park','run_command','k1','waiting_approval','h','{\"command\":\"npm test\"}',?,NULL,NULL)",
      )
      .run(now() - 60_000)
    harness.store.db
      .prepare(
        "INSERT INTO approvals (id, project_id, run_id, tool_call_id, status, title, detail, request_json, requested_at, expires_at) VALUES ('apr_park','" +
          project.id +
          "','run_park','tol_park','pending','授权 run_command','需要确认','{}',?,?)",
      )
      .run(now() - 60_000, now() + 600_000)

    const park = detectApprovalPark(harness.store, harness.store.read.getPlanRevision(plan.id)!, {
      idleMs: 15_000,
      at: now(),
    })
    expect(park?.runId).toBe('run_park')
    expect(park?.toolName).toBe('run_command')
    expect(park?.approvalId).toBe('apr_park')
    expect(park?.detail).toContain('等待审批')

    // A working run (recent step) must never be mistaken for a parked one.
    const fresh = detectApprovalPark(harness.store, harness.store.read.getPlanRevision(plan.id)!, {
      idleMs: 15_000,
      at: (harness.store.read.getActiveRunForTask(taskId)?.startedAt ?? 0) + 1_000,
    })
    expect(fresh).toBeNull()
  })
})

