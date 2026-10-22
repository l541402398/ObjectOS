import { existsSync, readFileSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError, newId, now } from '@projectos/contracts'
import { RuntimeDispatcher } from '../apps/runtime/src/dispatcher.js'
import { PlanGrantService } from '../apps/runtime/src/plan-grant.js'
import { PlannerUsageService } from '../apps/runtime/src/planner-usage.js'
import { FakeProvider, createGitProject, logger, planWithTasks, setup } from './helpers/r1-fixture.js'

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

function grantInput(planId: string, overrides: Record<string, unknown> = {}) {
  return {
    planId,
    actions: ['plan.start', 'workspace-write'] as ('plan.start' | 'workspace-write')[],
    allowedPaths: ['src'],
    maxRuns: 1,
    maxToolCalls: 5,
    ttlHours: 24,
    allowOverBudget: false,
    note: '',
    confirm: true as const,
    ...overrides,
  }
}

function errorOf(fn: () => unknown): AppError {
  try {
    fn()
  } catch (error) {
    return error as AppError
  }
  throw new Error('expected AppError')
}

describe('Phase 2B-2 plan execution grants', () => {
  it('binds a grant to the approved revision, tasks and current Agents and consumes starts atomically', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b2-grant-basic')
    const planned = planWithTasks(harness.orchestration, project.id, [task('dev', { role: 'developer' })])
    const plan = harness.store.read.getPlanRevision(planned.plan.id)!
    const grants = new PlanGrantService(harness.store, logger)

    const grant = grants.issue(grantInput(plan.id))
    expect(grant.planFingerprint).toHaveLength(64)
    expect(grant.planRevision).toBe(plan.revision)
    expect(grant.allowedTaskIds).toEqual(plan.createdTaskIds)
    expect(grant.allowedAgentIds).toEqual([harness.store.read.getTaskCard(planned.taskIds[0]!)!.assigneeAgentId])
    expect(grant.valid).toBe(true)
    expect(grant.canStart).toBe(true)
    expect(grant.status).toBe('active')

    const startView = grants.assertStartAllowed(plan, grant.id)
    grants.consumeStart(startView, plan)
    expect(grants.get(plan.id)?.usedRuns).toBe(1)
    expect(grants.get(plan.id)?.canStart).toBe(false)
    expect(errorOf(() => grants.assertStartAllowed(plan, grant.id)).code).toBe('APPROVAL_REQUIRED')
  })

  it('reserves start capacity, releases only its own failed reservation, and is idempotent', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b3-grant-reservation')
    const planned = planWithTasks(harness.orchestration, project.id, [task('dev')])
    const plan = harness.store.read.getPlanRevision(planned.plan.id)!
    const grants = new PlanGrantService(harness.store, logger)
    const grant = grants.issue(grantInput(plan.id))

    const first = grants.reserveStart(plan, grant, 'start-a')!
    expect(first.existing).toBe(false)
    expect(grants.get(plan.id)?.usedRuns).toBe(0)
    expect(grants.get(plan.id)?.reservedRuns).toBe(1)
    expect(grants.get(plan.id)?.canStart).toBe(false)
    expect(grants.findStartReservation(grant.id, 'start-a')?.status).toBe('reserved')
    const repeated = grants.reserveStart(plan, grant, 'start-a')!
    expect(repeated.existing).toBe(true)
    expect(repeated.reservation.id).toBe(first.reservation.id)
    expect(errorOf(() => grants.reserveStart(plan, grant, 'start-b')).code).toBe('APPROVAL_REQUIRED')
    expect(grants.get(plan.id)?.reservedRuns).toBe(1)

    grants.markStartFailed(first.reservation.id, 'workspace init failed before a Run was created')
    expect(grants.get(plan.id)?.usedRuns).toBe(0)
    expect(grants.get(plan.id)?.reservedRuns).toBe(0)
    expect(grants.get(plan.id)?.canStart).toBe(true)
    expect(grants.findStartReservation(grant.id, 'start-a')?.status).toBe('failed')
    expect(errorOf(() => grants.reserveStart(plan, grant, 'start-a')).code).toBe('CONFLICT')
  })

  it('releases stale reservations without a Run and consumes stale reservations with a real execution', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b3-grant-recovery')
    const planned = planWithTasks(harness.orchestration, project.id, [task('dev')])
    const plan = harness.store.read.getPlanRevision(planned.plan.id)!
    const grants = new PlanGrantService(harness.store, logger)
    const grant = grants.issue(grantInput(plan.id, { maxRuns: 2 }))
    const first = grants.reserveStart(plan, grant, 'crash-a')!
    harness.store.db
      .prepare('UPDATE plan_grant_start_reservations SET reserved_at = ? WHERE id = ?')
      .run(now() - 10 * 60_000, first.reservation.id)
    expect(grants.recoverStartReservations()).toEqual({ started: 0, released: 1 })
    expect(grants.get(plan.id)?.usedRuns).toBe(0)
    expect(grants.get(plan.id)?.reservedRuns).toBe(0)

    const second = grants.reserveStart(plan, grant, 'crash-b')!
    harness.store.db
      .prepare('UPDATE plan_grant_start_reservations SET reserved_at = ? WHERE id = ?')
      .run(now() - 10 * 60_000, second.reservation.id)
    harness.store.updatePlanRevision({
      ...plan,
      execution: {
        status: 'running',
        concurrency: 1,
        startedAt: now(),
        updatedAt: now(),
        error: null,
        runIds: ['run_recovered'],
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
        qualityReport: null,
        qualityGate: null,
      } as never,
    })
    expect(grants.recoverStartReservations()).toEqual({ started: 1, released: 0 })
    expect(grants.get(plan.id)?.usedRuns).toBe(1)
    expect(grants.get(plan.id)?.reservedRuns).toBe(0)
  })

  it('rejects absolute, traversal, empty and sensitive grant paths', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b2-grant-paths')
    const planned = planWithTasks(harness.orchestration, project.id, [task('dev')])
    const plan = harness.store.read.getPlanRevision(planned.plan.id)!
    const grants = new PlanGrantService(harness.store, logger)

    expect(errorOf(() => grants.issue(grantInput(plan.id, { allowedPaths: [] }))).code).toBe('BAD_REQUEST')
    expect(errorOf(() => grants.issue(grantInput(plan.id, { allowedPaths: ['../outside'] }))).code).toBe('BAD_REQUEST')
    expect(errorOf(() => grants.issue(grantInput(plan.id, { allowedPaths: ['C:/outside'] }))).code).toBe('BAD_REQUEST')
    expect(errorOf(() => grants.issue(grantInput(plan.id, { allowedPaths: ['src/auth'] }))).code).toBe('APPROVAL_REQUIRED')
    expect(errorOf(() => grants.issue(grantInput(plan.id, { allowedPaths: ['package.json'] }))).code).toBe('APPROVAL_REQUIRED')
  })

  it('revocation, expiry and Agent reassignment invalidate the grant and deny writes', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b2-grant-invalid')
    const planned = planWithTasks(harness.orchestration, project.id, [task('dev')])
    const plan = harness.store.read.getPlanRevision(planned.plan.id)!
    const taskCard = harness.store.read.getTaskCard(planned.taskIds[0]!)!
    const grants = new PlanGrantService(harness.store, logger)
    const grant = grants.issue(grantInput(plan.id))
    grants.consumeStart(grants.assertStartAllowed(plan, grant.id), plan)

    const allowed = grants.authorizeToolCall({
      projectId: project.id,
      workspaceRoot: project.rootPath,
      taskId: taskCard.id,
      runId: 'run_test',
      agentId: taskCard.assigneeAgentId!,
      toolName: 'write_file',
      toolCallId: 'tool_test_1',
      args: { path: 'src/ok.txt', content: 'ok' },
    })
    expect(allowed.decision).toBe('allow')
    expect(grants.get(plan.id)?.usedToolCalls).toBe(1)

    const outside = grants.authorizeToolCall({
      projectId: project.id,
      workspaceRoot: project.rootPath,
      taskId: taskCard.id,
      runId: 'run_test',
      agentId: taskCard.assigneeAgentId!,
      toolName: 'write_file',
      toolCallId: 'tool_test_2',
      args: { path: 'docs/not-granted.txt', content: 'no' },
    })
    expect(outside.decision).toBe('deny')

    const critical = grants.authorizeToolCall({
      projectId: project.id,
      workspaceRoot: project.rootPath,
      taskId: taskCard.id,
      runId: 'run_test',
      agentId: taskCard.assigneeAgentId!,
      toolName: 'write_file',
      toolCallId: 'tool_test_3',
      args: { path: 'src/auth/guard.ts', content: 'no' },
    })
    expect(critical.decision).toBe('approval')

    const process = grants.authorizeToolCall({
      projectId: project.id,
      workspaceRoot: project.rootPath,
      taskId: taskCard.id,
      runId: 'run_test',
      agentId: taskCard.assigneeAgentId!,
      toolName: 'run_tests',
      toolCallId: 'tool_test_4',
      args: { command: 'pnpm test' },
    })
    expect(process.decision).toBe('approval')

    // Reassigning the Task invalidates the old Agent scope.
    const current = harness.store.read.getTaskCard(taskCard.id)!
    harness.services.tasks.update(
      { taskId: current.id, expectedVersion: current.version, assigneeAgentId: 'agt_qa' },
      { kind: 'user', id: 'local-user', name: '你' },
    )
    const afterReassign = grants.get(plan.id)
    expect(afterReassign?.valid).toBe(false)
    expect(afterReassign?.invalidReasons.some((reason) => reason.includes('重新分配'))).toBe(true)
    expect(
      grants.authorizeToolCall({
        projectId: project.id,
        workspaceRoot: project.rootPath,
        taskId: taskCard.id,
        runId: 'run_test',
        agentId: 'agt_qa',
        toolName: 'write_file',
        toolCallId: 'tool_test_5',
        args: { path: 'src/after-reassign.txt', content: 'no' },
      }).decision,
    ).toBe('deny')

    grants.revoke(grant.id, '测试撤销')
    expect(grants.get(plan.id)?.status).toBe('revoked')
    expect(
      grants.authorizeToolCall({
        projectId: project.id,
        workspaceRoot: project.rootPath,
        taskId: taskCard.id,
        runId: 'run_test',
        agentId: 'agt_qa',
        toolName: 'write_file',
        toolCallId: 'tool_test_6',
        args: { path: 'src/after-revoke.txt', content: 'no' },
      }).decision,
    ).toBe('deny')
  })

  it('rejects over-budget opt-in without an explicit reason and denies an expired grant', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b2-grant-expiry')
    const planned = planWithTasks(harness.orchestration, project.id, [task('dev')])
    const plan = harness.store.read.getPlanRevision(planned.plan.id)!
    const card = harness.store.read.getTaskCard(planned.taskIds[0]!)!
    const grants = new PlanGrantService(harness.store, logger)
    expect(
      errorOf(() => grants.issue(grantInput(plan.id, { allowOverBudget: true, note: 'short' }))).code,
    ).toBe('BAD_REQUEST')

    const grant = grants.issue(grantInput(plan.id))
    harness.store.db
      .prepare('UPDATE plan_execution_grants SET expires_at = ? WHERE id = ?')
      .run(now() - 1, grant.id)
    expect(grants.get(plan.id)?.status).toBe('expired')
    expect(errorOf(() => grants.assertStartAllowed(plan, grant.id)).code).toBe('APPROVAL_REQUIRED')
    expect(
      grants.authorizeToolCall({
        projectId: project.id,
        workspaceRoot: project.rootPath,
        taskId: card.id,
        runId: 'run_expired',
        agentId: card.assigneeAgentId!,
        toolName: 'write_file',
        toolCallId: 'tool_expired',
        args: { path: 'src/expired.txt', content: 'no' },
      }).decision,
    ).toBe('deny')
  })

  it('blocks a symlink escape even when the lexical path is inside the allowed directory', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b2-grant-symlink')
    const planned = planWithTasks(harness.orchestration, project.id, [task('dev')])
    const plan = harness.store.read.getPlanRevision(planned.plan.id)!
    const taskCard = harness.store.read.getTaskCard(planned.taskIds[0]!)!
    const grants = new PlanGrantService(harness.store, logger)
    const grant = grants.issue(grantInput(plan.id))
    grants.consumeStart(grants.assertStartAllowed(plan, grant.id), plan)

    const outside = join(harness.dataDir, 'outside-r2b2')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'secret.txt'), 'outside')
    mkdirSync(join(project.rootPath, 'src'), { recursive: true })
    try {
      symlinkSync(outside, join(project.rootPath, 'src', 'link'), 'junction')
    } catch (error) {
      // Windows environments without symlink privilege cannot exercise this
      // fixture; the lexical traversal test above still covers the explicit
      // `..` branch. Do not silently pass: record the limitation.
      console.log(`[r2b2-symlink] skipped fixture: ${error instanceof Error ? error.message : String(error)}`)
      return
    }

    const decision = grants.authorizeToolCall({
      projectId: project.id,
      workspaceRoot: project.rootPath,
      taskId: taskCard.id,
      runId: 'run_symlink',
      agentId: taskCard.assigneeAgentId!,
      toolName: 'write_file',
      toolCallId: 'tool_symlink',
      args: { path: 'src/link/secret.txt', content: 'escaped' },
    })
    expect(decision.decision).toBe('deny')
  })

  it('distinguishes hard role capabilities from soft preferences', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b2-hard-soft')
    const draft = harness.orchestration.generatePlan(project.id, 'capability rules')
    const hardDraft = harness.orchestration.updatePlan({
      planId: draft.id,
      tasks: [
        task('hard-missing', {
          role: 'developer',
          agentId: 'agt_product',
          hardCapabilities: ['implement'],
        }),
      ] as never,
    })
    expect(hardDraft.tasks[0]!.hardCapabilities).toEqual(['implement'])
    expect(hardDraft.tasks[0]!.assignmentBlocked).toBe(true)
    expect(hardDraft.tasks[0]!.assignmentReasons.join(' ')).toContain('硬性能力')

    const softDraft = harness.orchestration.updatePlan({
      planId: draft.id,
      tasks: [
        task('soft-missing', {
          role: 'custom',
          agentId: 'agt_product',
          requiredCapabilities: ['implement'],
          hardCapabilities: [],
        }),
      ] as never,
    })
    expect(softDraft.tasks[0]!.hardCapabilities).toEqual([])
    expect(softDraft.tasks[0]!.assignmentBlocked).toBe(false)
    expect(softDraft.tasks[0]!.agentId).toBe('agt_product')
    expect(softDraft.tasks[0]!.requiredCapabilities).toEqual(['implement'])
  })

  it('lets a real AgentRunner write through an active scoped grant without a per-call approval', async () => {
    const provider = new FakeProvider((call) =>
      call.hasToolResult
        ? { text: '写入完成' }
        : { tool: { name: 'write_file', args: { path: 'src/granted.txt', content: 'granted write' } } },
    )
    const harness = setup(provider)
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b2-grant-write')
    const planned = planWithTasks(harness.orchestration, project.id, [task('dev')])
    const plan = harness.store.read.getPlanRevision(planned.plan.id)!
    const card = harness.store.read.getTaskCard(planned.taskIds[0]!)!
    const grants = new PlanGrantService(harness.store, logger)
    const grant = grants.issue(grantInput(plan.id, { maxToolCalls: 3 }))
    grants.consumeStart(grants.assertStartAllowed(plan, grant.id), plan)
    harness.runner.setPlanGrants(grants)
    const session = harness.services.sessions.create(
      { projectId: project.id, agentId: card.assigneeAgentId!, title: 'grant-write' },
      { kind: 'system', id: 'test', name: 'test' },
    )

    await harness.runner.startRun({
      projectId: project.id,
      sessionId: session.id,
      taskId: card.id,
      workspaceRoot: project.rootPath,
      prompt: '请写一个授权范围内的文件',
    })
    await new Promise<void>((resolve) => {
      const started = Date.now()
      const timer = setInterval(() => {
        const target = join(project.rootPath, 'src', 'granted.txt')
        if (existsSync(target) && readFileSync(target, 'utf8') === 'granted write') {
          clearInterval(timer)
          resolve()
        } else if (Date.now() - started > 10_000) {
          clearInterval(timer)
          resolve()
        }
      }, 50)
    })

    expect(readFileSync(join(project.rootPath, 'src', 'granted.txt'), 'utf8')).toBe('granted write')
    expect(harness.store.read.listApprovalViews(project.id)).toHaveLength(0)
    expect(grants.get(plan.id)?.usedToolCalls).toBe(1)
  })

  it('requires the grant itself to opt into an over-budget start', async () => {
    const provider = new FakeProvider(() => ({ text: 'done' }))
    const harness = setup(provider)
    cleanups.push(harness.close)
    const dispatcher = new RuntimeDispatcher({
      config: harness.config,
      store: harness.store,
      services: harness.services,
      runner: harness.runner,
      provider: harness.provider,
      hub: harness.hub,
      logger,
      startedAt: Date.now(),
      shutdown: () => undefined,
    })
    cleanups.push(() => dispatcher.shutdownOrchestrations())
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b2-over-budget')
    const planned = planWithTasks(harness.orchestration, project.id, [task('dev')])
    const session = harness.services.sessions.create(
      { projectId: project.id, agentId: 'agt_engineer', title: 'budget-seed' },
      { kind: 'system', id: 'test', name: 'test' },
    )
    const run = harness.store.createRun({
      id: newId('run'),
      projectId: project.id,
      taskId: null,
      sessionId: session.id,
      agentId: 'agt_engineer',
      attempt: 1,
      status: 'completed',
      error: null,
      summary: 'seed cost',
      inputTokens: 100,
      outputTokens: 100,
      checkpointId: null,
      startedAt: now(),
      finishedAt: now(),
      createdAt: now(),
    })
    harness.store.recordAIUsage({
      id: newId('usg'),
      runId: run.id,
      connectionId: null,
      modelId: 'fake',
      inputTokens: 100,
      outputTokens: 100,
      usageSource: 'provider',
      estimatedCost: 1,
      currency: 'USD',
      createdAt: now(),
    })
    harness.store.upsertProjectBudget({ projectId: project.id, softLimit: 0.5, currency: 'USD' })
    const grant = (await dispatcher.dispatch('plan.grant.issue', {
      planId: planned.plan.id,
      actions: ['plan.start'],
      allowedPaths: [],
      maxRuns: 1,
      maxToolCalls: 10,
      ttlHours: 1,
      allowOverBudget: false,
      note: '',
      confirm: true,
    })) as { id: string }
    const error = await dispatcher
      .dispatch('orchestration.start', {
        planId: planned.plan.id,
        concurrency: 1,
        maxRetries: 0,
        allowOverBudget: true,
        grantId: grant.id,
      })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('APPROVAL_REQUIRED')
    expect((error as AppError).message).toContain('超预算')
    expect(harness.store.read.getPlanRevision(planned.plan.id)?.execution).toBeNull()
  })

  it('does not inherit the old grant into a superseding revision', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b2-grant-revision')
    const planned = planWithTasks(harness.orchestration, project.id, [task('dev')])
    const plan = harness.store.read.getPlanRevision(planned.plan.id)!
    const grants = new PlanGrantService(harness.store, logger)
    const grant = grants.issue(grantInput(plan.id))
    grants.consumeStart(grants.assertStartAllowed(plan, grant.id), plan)
    const revised = harness.orchestration.revisePlan({ planId: plan.id, tasks: plan.tasks })
    expect(revised.revision).toBe(2)
    expect(harness.store.read.getPlanRevision(plan.id)?.status).toBe('superseded')
    const oldView = grants.get(plan.id)
    expect(oldView?.valid).toBe(false)
    expect(oldView?.invalidReasons.join(' ')).toContain('superseded')
    expect(errorOf(() => grants.assertStartAllowed(harness.store.read.getPlanRevision(plan.id)!, grant.id)).code).toBe('APPROVAL_REQUIRED')
    expect(grants.get(revised.id)).toBeNull()
  })

  it('records Planner usage per attempt with real/unknown costs and no duplicate accumulation', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b2-planner-usage')
    const connection = harness.store.createAIConnection({
      id: newId('aic'),
      name: 'usage-connection',
      backendKind: 'native-llm',
      providerId: 'custom',
      protocol: 'openai-chat',
      baseUrl: 'http://127.0.0.1:9/v1',
      defaultModelId: 'usage-model',
      secretRef: null,
      enabled: true,
      isDefault: true,
      timeoutMs: 30_000,
      temperature: 0,
      createdAt: now(),
      updatedAt: now(),
    })
    const usage = new PlannerUsageService(harness.store)
    const requestId = newId('plr')
    usage.record({
      projectId: project.id,
      planId: 'pln_failed_attempt',
      revision: 1,
      requestId,
      attempt: 1,
      connectionId: connection.id,
      modelId: 'usage-model',
      inputTokens: 100,
      outputTokens: 50,
      outcome: 'invalid',
    })
    const unknown = harness.store.read.summarizeAIUsage(project.id)
    expect(unknown.planner.calls).toBe(1)
    expect(unknown.planner.unpricedCalls).toBe(1)
    expect(unknown.planner.estimatedCost).toBe(0)
    expect(unknown.costUnknown).toBe(true)
    expect(unknown.inputTokens).toBe(100)
    expect(unknown.outputTokens).toBe(50)

    harness.store.upsertAIModelPrice({
      id: newId('aip'),
      connectionId: connection.id,
      modelId: 'usage-model',
      inputPerMillion: 1,
      outputPerMillion: 2,
      currency: 'USD',
      version: 'v1',
      effectiveAt: now(),
      createdAt: now(),
      updatedAt: now(),
    })
    usage.record({
      projectId: project.id,
      planId: 'pln_success',
      revision: 1,
      requestId,
      attempt: 2,
      connectionId: connection.id,
      modelId: 'usage-model',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      outcome: 'valid',
    })
    // Duplicate delivery of the same attempt must not double-count.
    usage.record({
      projectId: project.id,
      planId: 'pln_success',
      revision: 1,
      requestId,
      attempt: 2,
      connectionId: connection.id,
      modelId: 'usage-model',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      outcome: 'valid',
    })
    const summary = harness.store.read.summarizeAIUsage(project.id)
    expect(summary.planner.calls).toBe(2)
    expect(summary.planner.estimatedCost).toBe(3)
    expect(summary.estimatedCost).toBe(3)
    expect(summary.costUnknown).toBe(true)
    expect(summary.unpricedCalls).toBe(1)
    expect(summary.planner.byConnection[0]?.calls).toBe(2)
  })

  it('rejects plan start through the trusted dispatcher when no grant exists', async () => {
    const provider = new FakeProvider(() => ({ text: 'done' }))
    const harness = setup(provider)
    cleanups.push(harness.close)
    const dispatcher = new RuntimeDispatcher({
      config: harness.config,
      store: harness.store,
      services: harness.services,
      runner: harness.runner,
      provider: harness.provider,
      hub: harness.hub,
      logger,
      startedAt: Date.now(),
      shutdown: () => undefined,
    })
    cleanups.push(() => dispatcher.shutdownOrchestrations())
    const project = await createGitProject(harness.services, harness.dataDir, 'r2b2-no-grant')
    const planned = planWithTasks(harness.orchestration, project.id, [task('dev')])
    const error = await dispatcher
      .dispatch('orchestration.start', { planId: planned.plan.id, concurrency: 1, maxRetries: 0 })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('APPROVAL_REQUIRED')
    expect((error as AppError).message).toContain('尚未授予执行权限')
    expect(harness.store.read.getPlanRevision(planned.plan.id)?.execution).toBeNull()
  })
})
