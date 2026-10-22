import { afterEach, describe, expect, it } from 'vitest'
import { AppError, now } from '@projectos/contracts'
import type { LlmProvider } from '@projectos/provider-interfaces'
import { PlanGrantService } from '../apps/runtime/src/plan-grant.js'
import { PlannerService } from '../apps/runtime/src/planner.js'
import type { PlannerModelSource } from '../apps/runtime/src/planner-provider.js'
import { ReplanService } from '../apps/runtime/src/replan-service.js'
import { OrchestrationService } from '../apps/runtime/src/orchestration.js'
import { OrchestrationScheduler } from '../apps/runtime/src/orchestrator.js'
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
      connectionId: 'aic_replan_test',
      connectionName: '测试 AI 连接',
      model: 'fake-replan-model',
      protocol: 'openai-chat',
    }),
  }
}

function response(tasks: unknown[], reason = '执行事实需要修订 DAG'): string {
  return JSON.stringify({ reason, assumptions: ['基于真实失败记录'], risks: ['测试环境'], tasks })
}

function makeHarness(fake: LlmProvider) {
  const harness = setup(fake)
  const planner = new PlannerService({
    store: harness.store,
    modelSource: modelSource(fake),
    logger,
    maxRepairAttempts: 1,
  })
  const orchestration = new OrchestrationService(harness.store, harness.services, planner)
  const grants = new PlanGrantService(harness.store, logger)
  const replans = new ReplanService(harness.store, orchestration, planner, grants, logger)
  cleanups.push(harness.close)
  return { ...harness, planner, orchestration, grants, replans }
}

function setExecution(harness: ReturnType<typeof setup>, planId: string, status: 'failed' | 'paused' | 'running', error: string) {
  const plan = harness.store.read.getPlanRevision(planId)!
  harness.store.updatePlanRevision({
    ...plan,
    execution: {
      status,
      concurrency: 1,
      startedAt: now(),
      updatedAt: now(),
      error,
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
    } as never,
  })
}

function errorOf(fn: () => unknown): AppError {
  try {
    fn()
  } catch (error) {
    return error as AppError
  }
  throw new Error('expected AppError')
}

describe('Phase 2B-3 dynamic replan proposals', () => {
  it('does not propose a revision for a plan with no exhausted execution fact', async () => {
    const harness = makeHarness(new FakeProvider(() => ({ text: response([task('dev')]) })))
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b3-replan-guard')
    const approved = planWithTasks(harness.orchestration, project.id, [task('dev')])
    const error = await harness.replans
      .propose({ planId: approved.plan.id, trigger: 'retry_exhausted', reason: '不应该触发' })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('CONFLICT')
    expect(harness.store.read.listReplanProposals(project.id, approved.plan.id)).toHaveLength(0)
  })

  it('builds a revision proposal with diff, agent change and re-authorization requirement', async () => {
    const fake = new FakeProvider(() => ({
      text: response([
        task('dev'),
        task('verify', {
          role: 'tester',
          capabilities: ['test'],
          expectedArtifacts: ['测试报告'],
          acceptanceCriteria: ['记录真实退出码'],
          dependsOn: ['dev'],
        }),
      ]),
    }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b3-replan-diff')
    const approved = planWithTasks(harness.orchestration, project.id, [task('dev')])
    harness.grants.issue({
      planId: approved.plan.id,
      actions: ['plan.start', 'workspace-write'],
      allowedPaths: ['src'],
      maxRuns: 2,
      maxToolCalls: 10,
      ttlHours: 24,
      allowOverBudget: false,
      note: '',
      confirm: true,
    })
    setExecution(harness, approved.plan.id, 'failed', '任务执行失败（重试已用尽）')
    const proposal = await harness.replans.propose({
      planId: approved.plan.id,
      trigger: 'retry_exhausted',
      reason: '执行失败需要增加独立测试节点',
    })
    expect(proposal.status).toBe('proposed')
    expect(proposal.diff.kept.map((item) => item.key)).toContain('dev')
    expect(proposal.diff.added.map((item) => item.key)).toContain('verify')
    expect(proposal.grantImpact.requiresNewGrant).toBe(true)
    expect(proposal.grantImpact.newAgents.length).toBeGreaterThan(0)
    expect(proposal.proposedTasks.some((item) => item.key === 'verify' && item.agentId)).toBe(true)
    expect(proposal.generation?.mode).toBe('provider')
    expect(harness.store.read.listReplanProposals(project.id, approved.plan.id)).toHaveLength(1)
  })

  it('refuses to apply while a Run is active and keeps the old plan untouched when rejected', async () => {
    const fake = new FakeProvider(() => ({
      text: response([task('dev'), task('review', { role: 'reviewer', expectedArtifacts: ['审查报告'] })]),
    }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b3-replan-reject')
    const approved = planWithTasks(harness.orchestration, project.id, [task('dev')])
    setExecution(harness, approved.plan.id, 'failed', '任务执行失败（重试已用尽）')
    const proposal = await harness.replans.propose({
      planId: approved.plan.id,
      trigger: 'retry_exhausted',
      reason: '需要补一个独立审查节点',
    })
    setExecution(harness, approved.plan.id, 'running', '测试运行中')
    expect(errorOf(() => harness.replans.apply(proposal.id)).code).toBe('CONFLICT')
    setExecution(harness, approved.plan.id, 'failed', '任务执行失败（重试已用尽）')
    const rejected = harness.replans.reject(proposal.id, '用户不接受新增节点')
    expect(rejected.status).toBe('rejected')
    expect(harness.orchestration.getPlan(approved.plan.id).revision).toBe(1)
    expect(harness.orchestration.getPlan(approved.plan.id).status).toBe('approved')
    expect(harness.store.read.listPlanRevisions(project.id)).toHaveLength(1)
  })

  it('rejects an invalid DAG without persisting proposed tasks', async () => {
    const fake = new FakeProvider(() => ({
      text: response([task('a', { dependsOn: ['b'] }), task('b', { dependsOn: ['a'] })]),
    }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b3-replan-invalid')
    const approved = planWithTasks(harness.orchestration, project.id, [task('dev')])
    setExecution(harness, approved.plan.id, 'failed', '任务执行失败（重试已用尽）')
    const proposal = await harness.replans.propose({
      planId: approved.plan.id,
      trigger: 'retry_exhausted',
      reason: '模型输出了循环依赖',
    })
    expect(proposal.status).toBe('failed')
    expect(proposal.proposedTasks).toHaveLength(0)
    expect(proposal.error).toBeTruthy()
    expect(harness.orchestration.getPlan(approved.plan.id).revision).toBe(1)
  })

  it('applies a proposal as a new draft revision and invalidates the old grant', async () => {
    const falseFake = new FakeProvider(() => ({
      text: response([task('dev'), task('review', { role: 'reviewer', expectedArtifacts: ['审查报告'] })]),
    }))
    const harness = makeHarness(falseFake)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b3-replan-apply')
    const approved = planWithTasks(harness.orchestration, project.id, [task('dev')])
    const issued = harness.grants.issue({
      planId: approved.plan.id,
      actions: ['plan.start', 'workspace-write'],
      allowedPaths: ['src'],
      maxRuns: 2,
      maxToolCalls: 10,
      ttlHours: 24,
      allowOverBudget: false,
      note: '',
      confirm: true,
    })
    setExecution(harness, approved.plan.id, 'failed', '任务执行失败（重试已用尽）')
    const proposal = await harness.replans.propose({
      planId: approved.plan.id,
      trigger: 'retry_exhausted',
      reason: '需要补一个独立审查节点',
    })
    const applied = harness.replans.apply(proposal.id)
    expect(applied.plan.revision).toBe(2)
    expect(applied.plan.status).toBe('draft')
    expect(harness.orchestration.getPlan(approved.plan.id).status).toBe('superseded')
    expect(harness.grants.get(approved.plan.id)?.valid).toBe(false)
    expect(harness.grants.getById(issued.id)?.status).not.toBe('active')
    expect(applied.proposal.status).toBe('applied')
    expect(applied.proposal.appliedRevision).toBe(2)
    expect(errorOf(() => harness.replans.apply(proposal.id)).code).toBe('CONFLICT')
  })

  it('rejects stale proposals after a new Run or source task change', async () => {
    const fake = new FakeProvider(() => ({
      text: response([task('dev'), task('review', { role: 'reviewer', expectedArtifacts: ['审查报告'] })]),
    }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b3-replan-stale')
    const approved = planWithTasks(harness.orchestration, project.id, [task('dev')])
    setExecution(harness, approved.plan.id, 'failed', '任务执行失败（重试已用尽）')
    const proposal = await harness.replans.propose({
      planId: approved.plan.id,
      trigger: 'retry_exhausted',
      reason: '需要补验证节点',
    })
    const plan = harness.store.read.getPlanRevision(approved.plan.id)!
    harness.store.updatePlanRevision({
      ...plan,
      execution: plan.execution ? { ...plan.execution, runIds: ['run_new_after_proposal'] } : null,
    })
    expect(errorOf(() => harness.replans.apply(proposal.id)).code).toBe('CONFLICT')
    expect(harness.orchestration.getPlan(approved.plan.id).status).toBe('approved')
  })

  it('allows only one atomic claim for a proposal', async () => {
    const fake = new FakeProvider(() => ({ text: response([task('dev')]) }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b3-replan-claim')
    const approved = planWithTasks(harness.orchestration, project.id, [task('dev')])
    setExecution(harness, approved.plan.id, 'failed', '任务执行失败（重试已用尽）')
    const proposal = await harness.replans.propose({
      planId: approved.plan.id,
      trigger: 'retry_exhausted',
      reason: 'claim 测试',
    })
    expect(harness.store.claimReplanProposal(proposal.id)).toBe(true)
    expect(harness.store.claimReplanProposal(proposal.id)).toBe(false)
    expect(() => harness.replans.apply(proposal.id)).toThrow()
    expect(harness.orchestration.getPlan(approved.plan.id).revision).toBe(1)
  })

  it('suppresses Replan for provider protocol failures and allows Agent unavailability', async () => {
    const harness = makeHarness(new FakeProvider(() => ({ text: response([task('dev')]) })))
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b3-failure-classification')
    const approved = planWithTasks(harness.orchestration, project.id, [task('dev')])
    setExecution(harness, approved.plan.id, 'failed', "模型服务返回 400：assistant message tool_calls must be followed by tool messages")
    const protocolError = await harness.replans
      .propose({ planId: approved.plan.id, trigger: 'retry_exhausted', reason: 'provider 协议错误' })
      .catch((caught: unknown) => caught)
    expect(protocolError).toBeInstanceOf(AppError)
    expect((protocolError as AppError).code).toBe('CONFLICT')
    expect((protocolError as AppError).message).toContain('provider_protocol')
    expect(harness.store.read.listReplanProposals(project.id, approved.plan.id)).toHaveLength(0)

    setExecution(harness, approved.plan.id, 'failed', 'Agent 当前状态为 disabled，不能启动新的运行')
    const proposal = await harness.replans.propose({
      planId: approved.plan.id,
      trigger: 'retry_exhausted',
      reason: 'Agent 不可用',
    })
    expect(proposal.status).toBe('proposed')
  })

  it('triggers automatically from a scheduler state change, not a direct propose call', async () => {
    const harness = makeHarness(new FakeProvider(() => ({ text: 'no evidence' })))
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b3-replan-trigger')
    const approved = planWithTasks(harness.orchestration, project.id, [task('dev')])
    const taskId = approved.taskIds[0]!
    harness.store.db.prepare('UPDATE tasks SET assignee_agent_id = NULL WHERE id = ?').run(taskId)
    const triggers: string[] = []
    const scheduler = new OrchestrationScheduler(
      harness.store,
      harness.services,
      harness.runner,
      logger,
      harness.dataDir,
      undefined,
      undefined,
      undefined,
      undefined,
      (_planId, trigger) => triggers.push(trigger),
    )
    cleanups.push(() => scheduler.shutdown())
    await scheduler.start(approved.plan.id, 1, 0)
    await waitFor(() => triggers.length > 0, 10_000, 'automatic replan trigger')
    expect(triggers).toContain('agent_unavailable')
    expect(harness.store.read.getPlanRevision(approved.plan.id)?.execution?.status).toBe('failed')
    expect(harness.store.read.getTaskCard(taskId)?.status).toBe('blocked')
  })

  it('does not trigger when a plan starts with all tasks already complete', async () => {
    const harness = makeHarness(new FakeProvider(() => ({ text: 'unused' })))
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b3-replan-no-trigger')
    const approved = planWithTasks(harness.orchestration, project.id, [task('dev')])
    harness.store.db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(approved.taskIds[0]!)
    const triggers: string[] = []
    const scheduler = new OrchestrationScheduler(
      harness.store,
      harness.services,
      harness.runner,
      logger,
      harness.dataDir,
      undefined,
      undefined,
      undefined,
      undefined,
      (_planId, trigger) => triggers.push(trigger),
    )
    cleanups.push(() => scheduler.shutdown())
    await scheduler.start(approved.plan.id, 1, 0)
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(triggers).toHaveLength(0)
  })

  it('enforces the per-plan proposal/model-call limit', async () => {
    const fake = new FakeProvider(() => ({ text: response([task('dev')]) }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b3-replan-limit')
    const approved = planWithTasks(harness.orchestration, project.id, [task('dev')])
    setExecution(harness, approved.plan.id, 'failed', '任务执行失败（重试已用尽）')
    for (let index = 0; index < 3; index += 1) {
      const proposal = await harness.replans.propose({
        planId: approved.plan.id,
        trigger: 'retry_exhausted',
        reason: `第 ${index + 1} 次重规划`,
      })
      expect(proposal.status).toBe('proposed')
      harness.replans.reject(proposal.id)
    }
    const error = await harness.replans
      .propose({ planId: approved.plan.id, trigger: 'retry_exhausted', reason: '第 4 次' })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('CONFLICT')
    expect(harness.store.read.listReplanProposals(project.id, approved.plan.id)).toHaveLength(3)
  })
})
