import { afterEach, describe, expect, it } from 'vitest'
import { RuntimeDispatcher } from '../apps/runtime/src/dispatcher.js'
import { OrchestrationService } from '../apps/runtime/src/orchestration.js'
import { FakeProvider, createGitProject, logger, planWithTasks, setup, waitFor } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

const task = (role: string, extra: Record<string, unknown> = {}) => ({
  key: 'impl',
  title: '功能交付',
  description: '交付功能并留下真实证据',
  role,
  agentId: role === 'developer' ? 'agt_engineer' : 'agt_qa',
  assignmentReasons: ['用户手动指定'],
  assignmentBlocked: false,
  dependsOn: [],
  acceptanceCriteria: ['完成'],
  expectedArtifacts: [],
  requiresApproval: false,
  ...extra,
})

function providerArtifact(kind = 'code', title = '实现证据') {
  return { tool: { name: 'create_artifact', args: { title, kind, body: 'real evidence' } } }
}

describe('R2 P0-03: project quality policy in the Scheduler', () => {
  it('fails the gate when a required script is missing and passes when it exists', async () => {
    const provider = new FakeProvider((call) =>
      call.hasToolResult ? { text: 'done' } : providerArtifact('code', '实现证据'),
    )
    const harness = setup(provider)
    cleanups.push(harness.close)
    const { store, services, orchestration, scheduler, dataDir } = harness

    // Project A: only lint exists; required test is missing -> must not pass.
    const strictProject = await createGitProject(services, dataDir, 'r2-policy-missing', {
      lint: 'node -e "process.exit(0)"',
    })
    store.setQualityPolicy(strictProject.id, { required: ['test'], optional: ['lint'] })
    const strictPlan = planWithTasks(orchestration, strictProject.id, [
      task('developer', { expectedArtifacts: ['测试报告'] }),
    ])
    await scheduler.start(strictPlan.plan.id, 1, 0)
    await waitFor(
      () => store.read.getPlanRevision(strictPlan.plan.id)?.execution?.status === 'paused',
      30_000,
      'missing required script to block completion',
    )
    const strictReports = store.read
      .listArtifacts(strictProject.id)
      .filter((artifact) => artifact.kind === 'test-report')
    expect(strictReports.length).toBeGreaterThan(0)
    expect(strictReports.some((artifact) => artifact.verifiedAt === null)).toBe(true)
    const strictBody = strictReports.map((artifact) => artifact.body ?? '').join('\n')
    expect(strictBody).toMatch(/缺失必需检查|必需检查未执行|skipped/i)
    expect(store.read.getTask(strictPlan.taskIds[0]!)?.status).toBe('review')
    expect(store.read.getPlanRevision(strictPlan.plan.id)?.execution?.status).toBe('paused')

    // Project B: the required test script exists -> gate passes and task is done.
    const passingProject = await createGitProject(services, dataDir, 'r2-policy-passing')
    store.setQualityPolicy(passingProject.id, { required: ['test'], optional: [] })
    const passingPlan = planWithTasks(orchestration, passingProject.id, [
      task('developer', { expectedArtifacts: ['测试报告'] }),
    ])
    await scheduler.start(passingPlan.plan.id, 1, 0)
    await waitFor(
      () => store.read.getPlanRevision(passingPlan.plan.id)?.execution?.status === 'completed',
      30_000,
      'passing quality gate completion',
    )
    const passingTask = store.read.getTask(passingPlan.taskIds[0]!)
    expect(passingTask?.status).toBe('done')
    const passingReports = store.read
      .listArtifacts(passingProject.id)
      .filter((artifact) => artifact.kind === 'test-report')
    expect(passingReports.some((artifact) => artifact.verifiedAt !== null)).toBe(true)
    console.log(
      `[r2-policy] missing=${store.read.getPlanRevision(strictPlan.plan.id)?.execution?.status} ` +
        `passing=${store.read.getPlanRevision(passingPlan.plan.id)?.execution?.status} task=${passingTask?.status}`,
    )
  }, 90_000)
})

describe('R2 P0-05: evidence supplement success', () => {
  it('runs a bounded evidence retry and completes the task when real evidence arrives', async () => {
    const provider = new FakeProvider((call) => {
      const isSupplement = call.messages.some((message) => message.content.includes('补证任务'))
      if (isSupplement && !call.hasToolResult) return providerArtifact('code', '补证实现')
      return { text: '没有产物的口头完成' }
    })
    const harness = setup(provider)
    cleanups.push(harness.close)
    const { store, services, orchestration, scheduler, dataDir } = harness
    const project = await createGitProject(services, dataDir, 'r2-evidence-retry')
    const planned = planWithTasks(orchestration, project.id, [task('developer')])
    await scheduler.start(planned.plan.id, 1, 0)
    await waitFor(
      () => store.read.getPlanRevision(planned.plan.id)?.execution?.status === 'completed',
      40_000,
      'supplemented plan completion',
    )
    const execution = store.read.getPlanRevision(planned.plan.id)?.execution
    expect(execution?.status).toBe('completed')
    expect(execution?.evidenceRetries?.[planned.taskIds[0]!]).toBe(1)
    expect(store.read.getTask(planned.taskIds[0]!)?.status).toBe('done')
    const runs = store.read.listRunSummaries(project.id, 20).filter((run) => run.taskId === planned.taskIds[0])
    expect(runs).toHaveLength(2)
    expect(runs.map((run) => run.status)).toEqual(['completed', 'completed'])
    const orderedRuns = [...runs].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
    const codeArtifacts = store.read
      .listArtifacts(project.id)
      .filter((artifact) => artifact.kind === 'code' && artifact.taskId === planned.taskIds[0])
    expect(codeArtifacts.length).toBeGreaterThan(0)
    expect(codeArtifacts.some((artifact) => artifact.runId === orderedRuns[1]!.id)).toBe(true)
    console.log(
      `[r2-evidence] plan=completed task=done runs=${runs.length} retries=${execution?.evidenceRetries?.[planned.taskIds[0]!]} ` +
        `codeArtifacts=${codeArtifacts.length}`,
    )
  }, 90_000)
})

describe('R2 P0-06: reconcile resumes the plan', () => {
  it('auto-resumes a paused plan after a retry reconciliation and starts exactly one new run', async () => {
    let mode: 'hang' | 'ok' = 'hang'
    const provider = new FakeProvider((call) => {
      if (mode === 'hang') return { hang: true }
      return call.hasToolResult ? { text: 'done' } : providerArtifact('code', '重试实现')
    })
    const harness = setup(provider)
    cleanups.push(harness.close)
    const { store, services, runner, provider: providerManager, hub, config, dataDir } = harness
    const dispatcher = new RuntimeDispatcher({
      config,
      store,
      services,
      runner,
      provider: providerManager,
      hub,
      logger,
      startedAt: Date.now(),
      shutdown: () => undefined,
    })
    cleanups.push(() => dispatcher.shutdownOrchestrations())

    const project = await createGitProject(services, dataDir, 'r2-reconcile-resume')
    const service = new OrchestrationService(store, services)
    const planned = planWithTasks(service, project.id, [task('developer')])
    await dispatcher.dispatch('orchestration.start', { planId: planned.plan.id, concurrency: 1, maxRetries: 0 })
    await waitFor(
      () => store.read.getLatestRunForTask(planned.taskIds[0]!)?.status === 'running',
      15_000,
      'first run',
    )
    const running = store.read.getLatestRunForTask(planned.taskIds[0]!)!
    expect(running.status).toBe('running')
    // Simulate a crash/unknown-side-effect window, then a restart that cleared
    // the in-memory runner state.
    store.updateRun(running!.id, {
      status: 'needs_reconciliation',
      error: 'R2 simulated crash with unknown side effects',
      finishedAt: Date.now(),
    })
    runner.shutdown()
    await waitFor(
      () => store.read.getPlanRevision(planned.plan.id)?.execution?.status === 'paused',
      20_000,
      'plan paused for reconciliation',
    )

    mode = 'ok'
    const reconciled = (await dispatcher.dispatch('run.reconcile', {
      runId: running!.id,
      decision: 'retry',
      note: 'R2 reconcile test',
    })) as { status: string }
    expect(reconciled.status).toBe('failed')
    await waitFor(
      () => store.read.getPlanRevision(planned.plan.id)?.execution?.status === 'completed',
      40_000,
      'plan to auto-resume and complete',
    )
    expect(store.read.getTask(planned.taskIds[0]!)?.status).toBe('done')
    const runs = store.read.listRunSummaries(project.id, 20).filter((run) => run.taskId === planned.taskIds[0])
    expect(runs).toHaveLength(2)
    const ordered = [...runs].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
    expect(ordered.map((run) => run.status)).toEqual(['failed', 'completed'])
    console.log(
      `[r2-reconcile] reconciled=${reconciled.status} plan=completed runs=${runs.map((run) => run.status).join(',')}`,
    )
  }, 90_000)
})
