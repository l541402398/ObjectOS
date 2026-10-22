import { afterEach, describe, expect, it } from 'vitest'
import { AgentRunner } from '../apps/runtime/src/agent-runner.js'
import { FakeProvider, createGitProject, logger, planWithTasks, setup, waitFor } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

const USER = { kind: 'user' as const, id: 'local-user', name: '你' }

function planTask(key: string, title: string, role = 'custom', agentId = 'agt_engineer') {
  return {
    key,
    title,
    description: `${title} 的描述`,
    role,
    agentId,
    assignmentReasons: ['用户手动指定'],
    assignmentBlocked: false,
    dependsOn: [],
    acceptanceCriteria: ['完成'],
    expectedArtifacts: [],
    requiresApproval: false,
  }
}

function move(harness: ReturnType<typeof setup>, taskId: string, to: 'ready' | 'running' | 'review' | 'done') {
  const task = harness.store.read.getTask(taskId)!
  return harness.services.tasks.move({ taskId, expectedVersion: task.version, to, note: '人工完成并核对验收记录' }, USER)
}

describe('R2 P0-08A: revision supersede and reuse rule', () => {
  it('keeps completed work, cancels unfinished tasks and records reuse references without re-running old tasks', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'not used' })))
    cleanups.push(harness.close)
    const { store, services, orchestration } = harness
    const project = await createGitProject(services, harness.dataDir, 'r2-revision')
    const approved = planWithTasks(orchestration, project.id, [
      planTask('a', '已完成节点'),
      planTask('b', '未完成节点'),
    ])
    const doneTaskId = approved.taskIds[0]!
    const unfinishedTaskId = approved.taskIds[1]!
    move(harness, doneTaskId, 'ready')
    move(harness, doneTaskId, 'running')
    move(harness, doneTaskId, 'review')
    move(harness, doneTaskId, 'done')
    expect(store.read.getTask(doneTaskId)?.status).toBe('done')
    const acceptance = store.read
      .listArtifacts(project.id, doneTaskId)
      .find((artifact) => artifact.title.startsWith('验收记录'))
    expect(acceptance).toBeTruthy()
    const runsBefore = store.read.listRunSummaries(project.id, 50).length

    const source = orchestration.getPlan(approved.plan.id)
    const revised = orchestration.revisePlan({ planId: approved.plan.id, tasks: source.tasks })
    expect(revised.revision).toBe(2)
    expect(revised.status).toBe('draft')
    const reused = revised.tasks.find((task) => task.key === 'a')!
    expect(reused.reuseFromTaskId).toBe(doneTaskId)
    expect(reused.reuseArtifactIds ?? []).toContain(acceptance!.id)
    expect(revised.tasks.find((task) => task.key === 'b')?.reuseFromTaskId ?? null).toBeNull()

    const oldPlan = store.read.getPlanRevision(approved.plan.id)!
    expect(oldPlan.status).toBe('superseded')
    expect(oldPlan.supersededByPlanId).toBe(revised.id)
    expect(store.read.getTask(doneTaskId)?.status).toBe('done')
    expect(store.read.getTask(unfinishedTaskId)?.status).toBe('cancelled')
    expect(store.read.listArtifacts(project.id, doneTaskId).find((item) => item.id === acceptance!.id)?.body).toBeTruthy()

    orchestration.approvePlan(revised.id)
    expect(store.read.listRunSummaries(project.id, 50).length).toBe(runsBefore)
    expect(store.read.getTask(doneTaskId)?.status).toBe('done')
    console.log(
      `[r2-revision] old=superseded new=r${revised.revision} doneKept=${doneTaskId} cancelled=${unfinishedTaskId} ` +
        `reuse=${reused.reuseFromTaskId} artifacts=${(reused.reuseArtifactIds ?? []).length} newRuns=0`,
    )
  }, 40_000)
})

describe('R2 P0-08C: inbox priority, backoff, max retry and restart', () => {
  it('delivers by priority, backs off, stops at max attempts and resumes after a restart', async () => {
    const provider = new FakeProvider(() => ({ text: 'inbox handled' }))
    const harness = setup(provider)
    cleanups.push(harness.close)
    const { store, services, runner, dataDir, config, provider: providerManager } = harness
    const project = await createGitProject(services, dataDir, 'r2-inbox')
    const sender = services.sessions.create(
      { projectId: project.id, agentId: 'agt_engineer', title: 'sender' },
      { kind: 'system', id: 'test', name: 'test' },
    )
    const recipient = services.sessions.create(
      { projectId: project.id, agentId: 'agt_qa', title: 'recipient' },
      { kind: 'system', id: 'test', name: 'test' },
    )
    const send = (type: 'task.delegate' | 'agent.wake' | 'agent.message', body: string) =>
      services.collaboration.send({
        projectId: project.id,
        fromSessionId: sender.id,
        toSessionId: recipient.id,
        type,
        body,
        taskId: null,
        wake: false,
      }).inbox

    const delegate = send('task.delegate', '高优先级委派')
    const wake = send('agent.wake', '唤醒消息')
    const message = send('agent.message', '普通消息')
    const deliverable = store.read.listDeliverableInbox(Date.now() + 1_000, 3, 10)
    const orderedIds = deliverable.filter((item) => [delegate.id, wake.id, message.id].includes(item.id)).map((item) => item.id)
    expect(orderedIds).toEqual([delegate.id, wake.id, message.id])

    // Fail delivery by archiving the recipient session (resolveRunTarget rejects it).
    store.db.prepare("UPDATE sessions SET status = 'archived' WHERE id = ?").run(recipient.id)
    await runner.retryPendingInbox(0)
    const backedOff = store.read.getInbox(delegate.id)!
    expect(backedOff.attempts).toBe(2)
    expect(backedOff.status).toBe('delivered')
    const nextAttemptAt = Number((store.db.prepare('SELECT next_attempt_at FROM agent_inbox WHERE id = ?').get(delegate.id) as { next_attempt_at: number }).next_attempt_at)
    const delay = nextAttemptAt - Date.now()
    expect(delay).toBeGreaterThan(4_000)
    expect(delay).toBeLessThan(15_000)

    store.updateInboxStatus(delegate.id, 'delivered', { nextAttemptAt: 0 })
    await runner.retryPendingInbox(0)
    const exhausted = store.read.getInbox(delegate.id)!
    expect(exhausted.attempts).toBe(3)
    expect(exhausted.status).toBe('failed')

    // Stale delivery expires after 24h instead of living forever.
    store.db
      .prepare('UPDATE agent_inbox SET created_at = ? WHERE id = ?')
      .run(Date.now() - 25 * 60 * 60 * 1000, message.id)
    await runner.retryPendingInbox(0)
    expect(store.read.getInbox(message.id)?.status).toBe('failed')

    // Restart: a new Runner over the same SQLite resumes a deliverable message.
    store.db.prepare("UPDATE sessions SET status = 'active' WHERE id = ?").run(recipient.id)
    const fresh = send('agent.message', '重启后投递')
    store.updateInboxStatus(fresh.id, 'delivered', { nextAttemptAt: 0 })
    const restarted = new AgentRunner(config, store, services, providerManager, harness.hub, logger)
    cleanups.push(() => restarted.shutdown())
    void runner
    await restarted.retryPendingInbox(0)
    await waitFor(() => store.read.getInbox(fresh.id)?.status === 'completed', 15_000, 'restarted inbox completion')
    expect(store.read.getInbox(fresh.id)?.status).toBe('completed')
    const run = store.read.listRunSummaries(project.id, 20).find((item) => item.sessionId === recipient.id)
    expect(run?.status).toBe('completed')
    console.log(
      `[r2-inbox] order=${orderedIds.join(',')} backoffMs=${delay} exhausted=${exhausted.status} ` +
        `stale=${store.read.getInbox(message.id)?.status} restarted=${store.read.getInbox(fresh.id)?.status}`,
    )
  }, 60_000)
})

describe('R2 P0-12: legacy structured artifact compatibility', () => {
  it('refuses automatic completion for a legacy design artifact and accepts explicit human review', async () => {
    const provider = new FakeProvider((call) =>
      call.hasToolResult
        ? { text: 'done' }
        : {
            tool: {
              name: 'create_artifact',
              args: { title: '旧版设计', kind: 'design', body: 'legacy design without metadata' },
            },
          },
    )
    const harness = setup(provider)
    cleanups.push(harness.close)
    const { store, services, orchestration, scheduler, dataDir } = harness
    const project = await createGitProject(services, dataDir, 'r2-legacy-artifact')
    const planned = planWithTasks(orchestration, project.id, [
      {
        ...planTask('design', '架构设计', 'architect', 'agt_architect'),
        expectedArtifacts: ['设计'],
      },
    ])
    await scheduler.start(planned.plan.id, 1, 0)
    await waitFor(
      () => store.read.getPlanRevision(planned.plan.id)?.execution?.status === 'paused',
      30_000,
      'legacy artifact to block automatic completion',
    )
    const artifacts = store.read.listArtifacts(project.id, planned.taskIds[0]!)
    const legacy = artifacts.find((artifact) => artifact.kind === 'design')
    expect(legacy).toBeTruthy()
    expect(legacy?.metadata?.artifactType).toBeUndefined()
    expect(legacy?.body).toContain('legacy design')
    expect(store.read.getTask(planned.taskIds[0]!)?.status).toBe('review')
    expect(store.read.getPlanRevision(planned.plan.id)?.execution?.error).toMatch(/缺少有效完成依据/)

    const task = store.read.getTask(planned.taskIds[0]!)!
    services.tasks.move(
      {
        taskId: task.id,
        expectedVersion: task.version,
        to: 'done',
        note: '人工复核旧 Artifact：确认设计内容有效',
      },
      USER,
    )
    expect(store.read.getTask(task.id)?.status).toBe('done')
    const acceptance = store.read
      .listArtifacts(project.id, task.id)
      .find((artifact) => artifact.title.startsWith('验收记录'))
    expect(acceptance?.metadata).toMatchObject({ acceptanceMode: 'human', actorKind: 'user' })
    scheduler.resume(planned.plan.id)
    await waitFor(
      () => store.read.getPlanRevision(planned.plan.id)?.execution?.status === 'completed',
      20_000,
      'plan completion after human review',
    )
    console.log(
      `[r2-legacy] artifact=${legacy?.id} metadata=none task=review->done acceptance=${acceptance?.id} plan=completed`,
    )
  }, 60_000)
})
