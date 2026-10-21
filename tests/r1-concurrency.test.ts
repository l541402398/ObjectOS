import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationScheduler } from '../apps/runtime/src/orchestrator.js'
import {
  FakeProvider,
  createGitProject,
  logger,
  planWithTasks,
  setup,
  waitFor,
} from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

/**
 * R1-A / P0-08B: global per-Agent capacity must be atomic across plans,
 * Scheduler instances and processes. The in-process test below uses two
 * independent Scheduler objects over one SQLite store; the cross-process
 * variant lives in scripts/r1a-cross-process.mjs.
 */
describe('R1-A atomic global Agent capacity', () => {
  it('never lets two plans run the same Agent at once and still completes both', async () => {
    const provider = new FakeProvider((call) =>
      call.hasToolResult
        ? { text: 'done', delayMs: 120 }
        : {
            tool: {
              name: 'create_artifact',
              args: { title: `并发证据 ${call.index}`, kind: 'document', body: 'R1-A concurrency evidence' },
            },
            delayMs: 180,
          },
    )
    const harness = setup(provider)
    cleanups.push(harness.close)
    const { store, services, runner, orchestration, scheduler, dataDir } = harness
    // A second Scheduler instance represents a second plan worker/process.
    const secondScheduler = new OrchestrationScheduler(store, services, runner, logger, dataDir)
    cleanups.push(() => secondScheduler.shutdown())

    const projectA = await createGitProject(services, dataDir, 'r1a-alpha')
    const projectB = await createGitProject(services, dataDir, 'r1a-beta')
    const taskTemplate = (title: string, description: string) => ({
      key: 'impl',
      title,
      description,
      role: 'custom',
      agentId: 'agt_engineer',
      assignmentReasons: ['用户手动指定'],
      assignmentBlocked: false,
      dependsOn: [],
      acceptanceCriteria: ['完成'],
      expectedArtifacts: [],
      requiresApproval: false,
    })
    const planA = planWithTasks(orchestration, projectA.id, [taskTemplate('并发任务 A', '同一 Agent 的计划 A 任务')])
    const planB = planWithTasks(orchestration, projectB.id, [taskTemplate('并发任务 B', '同一 Agent 的计划 B 任务')])

    let peakActive = 0
    let peakSlots = 0
    const sampler = setInterval(() => {
      peakActive = Math.max(peakActive, store.read.countActiveRunsForAgent('agt_engineer'))
      peakSlots = Math.max(peakSlots, store.listAgentExecutionSlots().length)
    }, 20)

    try {
      await scheduler.start(planA.plan.id, 1, 0)
      await secondScheduler.start(planB.plan.id, 1, 0)
      await waitFor(
        () =>
          store.read.getPlanRevision(planA.plan.id)?.execution?.status === 'completed' &&
          store.read.getPlanRevision(planB.plan.id)?.execution?.status === 'completed',
        30_000,
        'both plans to complete',
      ).catch((error: Error) => {
        const a = store.read.getPlanRevision(planA.plan.id)?.execution
        const b = store.read.getPlanRevision(planB.plan.id)?.execution
        throw new Error(`${error.message}; planA=${a?.status}/${a?.error}; planB=${b?.status}/${b?.error}`)
      })
    } finally {
      clearInterval(sampler)
    }

    expect(store.read.getPlanRevision(planA.plan.id)?.execution?.status).toBe('completed')
    expect(store.read.getPlanRevision(planB.plan.id)?.execution?.status).toBe('completed')
    // Peak concurrency never exceeded the per-Agent capacity of 1.
    expect(peakActive).toBe(1)
    expect(peakSlots).toBe(1)

    const runsA = store.read.listRunSummaries(projectA.id, 50).filter((run) => run.taskId === planA.taskIds[0])
    const runsB = store.read.listRunSummaries(projectB.id, 50).filter((run) => run.taskId === planB.taskIds[0])
    expect(runsA).toHaveLength(1)
    expect(runsB).toHaveLength(1)
    expect(runsA[0]?.status).toBe('completed')
    expect(runsB[0]?.status).toBe('completed')
    console.log(
      `[r1a-two-schedulers] peakActiveRuns=${peakActive} peakSlots=${peakSlots} ` +
        `runsA=${runsA.length} runsB=${runsB.length} plans=completed`,
    )
  }, 60_000)

  it('queues instead of failing the plan when another plan owns the Agent slot', async () => {
    const provider = new FakeProvider((call) => {
      if (call.messages.some((message) => message.content.includes('HOLD'))) return { hang: true }
      if (call.hasToolResult) return { text: 'ok' }
      return {
        tool: {
          name: 'create_artifact',
          args: { title: '排队执行证据', kind: 'document', body: 'queued run artifact' },
        },
      }
    })
    const harness = setup(provider)
    cleanups.push(harness.close)
    const { store, services, runner, orchestration, scheduler, dataDir } = harness
    const project = await createGitProject(services, dataDir, 'r1a-queue')
    const session = services.sessions.create(
      { projectId: project.id, agentId: 'agt_qa', title: 'slot holder' },
      { kind: 'system', id: 'test', name: 'test' },
    )
    const holder = await runner.startRun({
      projectId: project.id,
      sessionId: session.id,
      prompt: 'HOLD this capacity slot while another plan tries to start',
    })
    await waitFor(() => store.getAgentExecutionSlot('agt_qa')?.runId === holder.runId, 5_000, 'slot acquisition')

    const plan = planWithTasks(orchestration, project.id, [
      {
        key: 'impl',
        title: '排队任务',
        description: '等待 Agent 容量',
        role: 'custom',
        agentId: 'agt_qa',
        assignmentReasons: ['用户手动指定'],
        assignmentBlocked: false,
        dependsOn: [],
        acceptanceCriteria: ['完成'],
        expectedArtifacts: [],
        requiresApproval: false,
      },
    ])
    await scheduler.start(plan.plan.id, 1, 0)
    // Give the scheduler several ticks: it must keep the task ready, not fail.
    await new Promise((resolve) => setTimeout(resolve, 3_200))
    expect(store.read.getTaskCard(plan.taskIds[0]!)?.status).toBe('ready')
    expect(store.read.getPlanRevision(plan.plan.id)?.execution?.status).toBe('running')
    expect(store.read.getLatestRunForTask(plan.taskIds[0]!)).toBeNull()

    // Release the holder -> the queued task starts without a plan restart.
    await runner.cancel(holder.runId)
    const afterRelease = store.getAgentExecutionSlot('agt_qa')
    expect(afterRelease === null || afterRelease.runId !== holder.runId).toBe(true)
    await waitFor(
      () => store.read.getPlanRevision(plan.plan.id)?.execution?.status === 'completed',
      20_000,
      'queued plan to finish after the slot is released',
    ).catch((error: Error) => {
      const execution = store.read.getPlanRevision(plan.plan.id)?.execution
      const card = store.read.getTaskCard(plan.taskIds[0]!)
      const latest = store.read.getLatestRunForTask(plan.taskIds[0]!)
      throw new Error(
        `${error.message}; plan=${execution?.status}/${execution?.error}; task=${card?.status}; ` +
          `latestRun=${latest?.status}/${latest?.error}; active=${store.read.countActiveRunsForAgent('agt_qa')}`,
      )
    })
    expect(store.read.getTask(plan.taskIds[0]!)?.status).toBe('done')
    console.log(`[r1a-queue] holderCancelled run=${holder.runId} queuedPlan=completed`)
  }, 60_000)

  it('enforces the slot atomically in SQLite and releases it on cancel', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const { store } = harness

    const first = store.acquireAgentExecutionSlot('agt_architect', 'run-one', 60_000)
    expect(first.token).toBeGreaterThan(0)
    expect(() => store.acquireAgentExecutionSlot('agt_architect', 'run-two', 60_000)).toThrowError(/执行容量已满/)
    // Re-acquiring for the same Run renews but cannot create a second holder.
    const same = store.acquireAgentExecutionSlot('agt_architect', 'run-one', 60_000)
    expect(same.token).toBeGreaterThan(first.token)

    // A crash leaves the row behind; the Run is gone, so recovery must clear it.
    expect(store.releaseDeadAgentExecutionSlots()).toContain('agt_architect')
    expect(store.getAgentExecutionSlot('agt_architect')).toBeNull()
    expect(store.listAgentExecutionSlots()).toHaveLength(0)

    // Fencing: an old token cannot renew after the slot moved to a new Run.
    const owned = store.acquireAgentExecutionSlot('agt_qa', 'run-owner', 60_000)
    store.releaseAgentExecutionSlot('agt_qa', 'run-owner', owned.token)
    const stolen = store.acquireAgentExecutionSlot('agt_qa', 'run-thief', 60_000)
    expect(stolen.token).toBeGreaterThan(owned.token)
    expect(() => store.renewAgentExecutionSlot('agt_qa', 'run-owner', owned.token, 60_000)).toThrowError(/已失效/)
    expect(store.listAgentExecutionSlots().map((slot) => slot.agentId)).toEqual(['agt_qa'])
  })
})
