import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import {
  FakeProvider,
  createGitProject,
  planWithTasks,
  setup,
  tempDir,
  waitFor,
} from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function chatSession(harness: ReturnType<typeof setup>, projectId: string, agentId: string, title: string) {
  return harness.services.sessions.create(
    { projectId, agentId, title },
    { kind: 'system', id: 'test', name: 'test' },
  )
}

/**
 * R1-C / P0-08D: hard Run and Plan budgets are enforced by the Runtime, produce
 * distinct terminal states, and survive a restart.
 */
describe('R1-C hard Run/Plan budgets', () => {
  it('terminates a hanging Run at its wall-clock deadline with an audit step', async () => {
    const harness = setup(new FakeProvider(() => ({ hang: true })), {
      limits: { runWallClockMs: 400, maxAgentSteps: 10, maxToolCalls: 10 },
    })
    cleanups.push(harness.close)
    const { store, services, runner, dataDir } = harness
    const project = await createGitProject(services, dataDir, 'r1c-wallclock')
    const session = chatSession(harness, project.id, 'agt_product', 'wall clock')
    const startedAt = Date.now()
    const run = await runner.startRun({
      projectId: project.id,
      sessionId: session.id,
      prompt: '请一直思考，不要结束（墙钟超时测试）',
    })
    const result = await runner.awaitRunTerminal(run.runId, { timeoutMs: 10_000, pollMs: 50 })
    const elapsed = Date.now() - startedAt

    expect(result.timedOut).toBe(false)
    expect(result.run.status).toBe('timed_out')
    expect(result.run.error).toContain('墙钟上限')
    expect(elapsed).toBeLessThan(9_000)
    const budgetStep = store.read
      .getRunSteps(run.runId)
      .find((step) => step.kind === 'budget' && step.payload.reason === 'wall_clock_timeout')
    expect(budgetStep).toBeTruthy()
    expect(store.getAgentExecutionSlot('agt_product')).toBeNull()
    const taskAttempt = store.read.getRun(run.runId)
    expect(taskAttempt?.status).toBe('timed_out')
    // No token/cost figure is invented when the provider never returned usage.
    const usage = store.read.summarizeAIUsage(project.id)
    expect(Number(usage.estimatedCost)).toBe(0)
    console.log(`[r1c-wallclock] run=${run.runId} status=${result.run.status} elapsedMs=${elapsed}`)
  }, 30_000)

  it('stops after the step budget and executes no further tool after the limit', async () => {
    const harness = setup(
      new FakeProvider(() => ({
        tool: {
          name: 'create_artifact',
          args: { title: '步骤预算证据', kind: 'document', body: 'step budget' },
        },
      })),
      { limits: { runWallClockMs: 60_000, maxAgentSteps: 2, maxToolCalls: 10 } },
    )
    cleanups.push(harness.close)
    const { store, services, runner, dataDir } = harness
    const project = await createGitProject(services, dataDir, 'r1c-steps')
    const session = chatSession(harness, project.id, 'agt_engineer', 'steps')
    const run = await runner.startRun({
      projectId: project.id,
      sessionId: session.id,
      prompt: '无限调用工具（步骤预算测试）',
    })
    const result = await runner.awaitRunTerminal(run.runId, { timeoutMs: 15_000 })
    expect(result.run.status).toBe('budget_exhausted')
    expect(result.run.error).toMatch(/步骤预算|最大工具轮次/)
    const toolCalls = store.read.getToolCalls(run.runId)
    expect(toolCalls.length).toBeLessThanOrEqual(2)
    expect(toolCalls.length).toBeGreaterThan(0)
    expect(store.read.getRunSteps(run.runId).some((step) => step.payload.reason === 'step_budget_exhausted')).toBe(true)
    expect(store.getAgentExecutionSlot('agt_engineer')).toBeNull()
    console.log(`[r1c-steps] run=${run.runId} status=${result.run.status} toolCalls=${toolCalls.length}`)
  }, 30_000)

  it('refuses a tool call beyond the tool-call budget without creating a ToolCall row', async () => {
    const harness = setup(
      new FakeProvider((call) => {
        if (call.hasToolResult) return { text: 'done' }
        return {
          tools: [
            { name: 'create_artifact', args: { title: '工具上限一', kind: 'document', body: 'one' } },
            { name: 'create_artifact', args: { title: '工具上限二', kind: 'document', body: 'two' } },
          ],
        }
      }),
      { limits: { runWallClockMs: 60_000, maxAgentSteps: 5, maxToolCalls: 1 } },
    )
    cleanups.push(harness.close)
    const { store, services, runner, dataDir } = harness
    const project = await createGitProject(services, dataDir, 'r1c-tools')
    const session = chatSession(harness, project.id, 'agt_qa', 'tools')
    const run = await runner.startRun({
      projectId: project.id,
      sessionId: session.id,
      prompt: '一次请求两个工具（工具预算测试）',
    })
    const result = await runner.awaitRunTerminal(run.runId, { timeoutMs: 15_000 })
    expect(result.run.status).toBe('budget_exhausted')
    expect(result.run.error).toMatch(/工具调用预算/)
    const toolCalls = store.read.getToolCalls(run.runId)
    expect(toolCalls).toHaveLength(1)
    expect(store.read.getRunSteps(run.runId).some((step) => step.payload.reason === 'tool_budget_exhausted')).toBe(true)
    expect(store.getAgentExecutionSlot('agt_qa')).toBeNull()
    console.log(`[r1c-tools] run=${run.runId} status=${result.run.status} toolCalls=${toolCalls.length}`)
  }, 30_000)

  it('fails the Plan at its total wall-clock limit and stops the running Run', async () => {
    const harness = setup(new FakeProvider(() => ({ hang: true })), {
      limits: { planWallClockMs: 1_500, runWallClockMs: 120_000, maxAgentSteps: 10 },
    })
    cleanups.push(harness.close)
    const { store, services, orchestration, scheduler, dataDir } = harness
    const project = await createGitProject(services, dataDir, 'r1c-plan')
    const plan = planWithTasks(orchestration, project.id, [
      {
        key: 'impl',
        title: '计划超时任务',
        description: '等待计划总超时',
        role: 'custom',
        agentId: 'agt_architect',
        assignmentReasons: ['用户手动指定'],
        assignmentBlocked: false,
        dependsOn: [],
        acceptanceCriteria: ['完成'],
        expectedArtifacts: [],
        requiresApproval: false,
      },
    ])
    await scheduler.start(plan.plan.id, 1, 0)
    await waitFor(
      () => store.read.getPlanRevision(plan.plan.id)?.execution?.status === 'failed',
      20_000,
      'plan to hit its wall-clock limit',
    )
    const execution = store.read.getPlanRevision(plan.plan.id)?.execution
    expect(execution?.budgetExhausted).toBe('plan_wall_clock')
    expect(execution?.error).toContain('计划总执行时间')
    const runs = store.read.listRunSummaries(project.id, 20).filter((run) => run.taskId === plan.taskIds[0])
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe('timed_out')
    expect(store.read.getTask(plan.taskIds[0]!)?.status).toBe('blocked')
    expect(store.getAgentExecutionSlot('agt_architect')).toBeNull()
    expect(store.read.getTaskLease(plan.taskIds[0]!)?.expiresAt ?? 0).toBe(0)
    const event = store.read.getProjectActivity(project.id, 200)
      .find((item) => item.eventType === PROJECT_EVENT_TYPES.planStatusChanged)
    expect(event).toBeTruthy()
    console.log(
      `[r1c-plan] plan=${plan.plan.id} status=${execution?.status} reason=${execution?.budgetExhausted} ` +
        `run=${runs[0]?.id}/${runs[0]?.status} task=blocked`,
    )
  }, 40_000)

  it('keeps the remaining budget across a restart and blocks the approved tool', async () => {
    const dataDir = tempDir('projectos-r1c-restart-')
    cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }))
    const dbPath = join(dataDir, 'projectos.db')
    const provider = new FakeProvider((call) =>
      call.hasToolResult
        ? { text: 'done' }
        : {
            tool: {
              name: 'write_file',
              args: { path: 'generated/restart.txt', content: 'should never be written' },
            },
          },
    )
    const first = setup(provider, {
      dataDir,
      filePath: dbPath,
      limits: { runWallClockMs: 120_000, maxAgentSteps: 8, maxToolCalls: 8 },
    })
    const project = await createGitProject(first.services, dataDir, 'r1c-restart')
    const session = chatSession(first, project.id, 'agt_engineer', 'restart budget')
    const started = await first.runner.startRun({
      projectId: project.id,
      sessionId: session.id,
      prompt: '写入文件（重启预算测试）',
    })
    await waitFor(
      () => first.store.read.getRun(started.runId)?.status === 'waiting_approval',
      10_000,
      'run to wait for approval',
    )
    const persisted = first.store.read.getRun(started.runId)
    expect(persisted?.deadlineAt).toBeTruthy()
    expect(persisted?.budget?.maxToolCalls).toBe(8)
    const approval = first.store.read
      .listApprovalViews(project.id)
      .find((item) => item.runId === started.runId && item.status === 'pending')
    expect(approval).toBeTruthy()
    const filePath = join(project.rootPath, 'generated/restart.txt')
    expect(existsSync(filePath)).toBe(false)
    first.close()

    // Simulate downtime that consumed the remaining wall-clock budget.
    const second = setup(new FakeProvider(() => ({ text: 'unused' })), {
      dataDir,
      filePath: dbPath,
      limits: { runWallClockMs: 120_000, maxAgentSteps: 8, maxToolCalls: 8 },
    })
    cleanups.push(second.close)
    const reopened = second.store.read.getRun(started.runId)
    expect(reopened?.deadlineAt).toBe(persisted?.deadlineAt)
    second.store.updateRun(started.runId, { deadlineAt: Date.now() - 1_000 })
    await second.runner.decideApproval(approval!.id, 'approved', 'restart budget test')
    await waitFor(
      () => second.store.read.getRun(started.runId)?.status === 'timed_out',
      10_000,
      'run to time out after restart',
    )
    const final = second.store.read.getRun(started.runId)
    expect(final?.status).toBe('timed_out')
    expect(final?.error).toContain('墙钟上限')
    expect(existsSync(filePath)).toBe(false)
    expect(second.store.getAgentExecutionSlot('agt_engineer')).toBeNull()
    const budgetStep = second.store.read
      .getRunSteps(started.runId)
      .find((step) => step.payload.reason === 'wall_clock_timeout')
    expect(budgetStep).toBeTruthy()
    console.log(
      `[r1c-restart] run=${started.runId} deadlinePersisted=${persisted?.deadlineAt} final=${final?.status} fileWritten=false`,
    )
  }, 40_000)
})

