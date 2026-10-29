import { afterEach, describe, expect, it } from 'vitest'
import { FakeProvider, createGitProject, planWithTasks, setup, waitFor } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

/**
 * Parallelism contract (asked in review: "is the whole project limited to one active Agent?").
 *
 * Two independent limits exist, and neither is a bug:
 *   1. within a plan, at most `concurrency` tasks run at once (start(planId, concurrency, ...));
 *   2. one Agent never runs two tasks at the same time — the slot is enforced in SQLite across
 *      plans/processes (R1-A), so a shared Agent serialises while different Agents run in parallel.
 *
 * This test proves the positive half: two independent tasks on two different Agents really do run
 * at the same time inside one plan.
 */
describe('parallel Agents inside one project', () => {
  function task(key: string, agentId: string, title: string) {
    return {
      key,
      title,
      description: `${title} 的实现说明`,
      role: 'developer',
      agentId,
      assignmentReasons: ['用户手动指定'],
      assignmentBlocked: false,
      dependsOn: [],
      acceptanceCriteria: ['产出证据'],
      expectedArtifacts: [],
      requiresApproval: false,
    }
  }

  it('runs two independent tasks on two different Agents at the same time', async () => {
    // Each completion takes long enough that both runs must be alive simultaneously.
    const provider = new FakeProvider((call) =>
      call.hasToolResult
        ? { text: 'done', delayMs: 400 }
        : {
            tool: {
              name: 'create_artifact',
              args: { title: `并行证据 ${call.index}`, kind: 'document', body: 'parallel evidence' },
            },
            delayMs: 600,
          },
    )
    const harness = setup(provider)
    cleanups.push(harness.close)
    const { services, store, orchestration, scheduler, dataDir } = harness
    const project = await createGitProject(services, dataDir, 'p288-parallel')
    // The seeded team has exactly one implement engineer; a second *different* Agent is used with a
    // custom role so the two tasks are independent and the per-Agent slot is the only limit.
    const all = services.projects.listAgents(project.id).map((item) => item.agent)
    const implementer = all.find((agent) => agent.capabilities.includes('implement'))
    const other = all.find((agent) => agent.id !== implementer?.id)
    expect(implementer).toBeTruthy()
    expect(other).toBeTruthy()

    const { plan } = planWithTasks(orchestration, project.id, [
      task('alpha', implementer!.id, '实现 alpha'),
      { ...task('beta', other!.id, '整理 beta 的证据'), role: 'custom' as const, title: '整理 beta 的证据' },
    ])
    await scheduler.start(plan.id, 2, 1, false)

    let peak = 0
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const cards = store.read.getPlanRevision(plan.id)!.createdTaskIds.map((taskId) => store.read.getTaskCard(taskId))
      const running = cards.filter((card) => card?.status === 'running').length
      peak = Math.max(peak, running)
      if (running >= 2) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(peak).toBeGreaterThanOrEqual(2)
  })

  it('keeps a single Agent serial even when the plan allows more slots', async () => {
    const provider = new FakeProvider((call) =>
      call.hasToolResult
        ? { text: 'done', delayMs: 200 }
        : {
            tool: {
              name: 'create_artifact',
              args: { title: `串行证据 ${call.index}`, kind: 'document', body: 'serial evidence' },
            },
            delayMs: 300,
          },
    )
    const harness = setup(provider)
    cleanups.push(harness.close)
    const { services, store, orchestration, scheduler, dataDir } = harness
    const project = await createGitProject(services, dataDir, 'p288-serial')
    const agent = services.projects
      .listAgents(project.id)
      .map((item) => item.agent)
      .find((item) => item.capabilities.includes('implement'))!
    const { plan } = planWithTasks(orchestration, project.id, [
      task('one', agent.id, '实现一'),
      task('two', agent.id, '实现二'),
    ])
    await scheduler.start(plan.id, 2, 1, false)

    let peak = 0
    await waitFor(
      () => {
        const cards = store.read.getPlanRevision(plan.id)!.createdTaskIds.map((taskId) => store.read.getTaskCard(taskId))
        const running = cards.filter((card) => card?.status === 'running').length
        peak = Math.max(peak, running)
        return cards.every((card) => card?.status === 'done')
      },
      25_000,
      '同一 Agent 的两个任务依次完成',
    )
    expect(peak).toBe(1)
  })
})
