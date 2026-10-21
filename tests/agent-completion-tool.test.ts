import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TaskCard } from '@projectos/contracts'
import { CoreServices, USER_ACTOR, type WorkspacePort } from '@projectos/application'
import { SqliteStore } from '@projectos/persistence'
import {
  ensureProjectRoot,
  getGitStatus,
  initGitRepository,
  readTextFile,
  readWorkspaceTree,
  writeTextFile,
} from '@projectos/workspace'
import type { ChatRequest, LlmProvider, ProviderStreamEvent, ProviderTestResult } from '@projectos/provider-interfaces'
import { AgentRunner } from '../apps/runtime/src/agent-runner.js'
import { RuntimeEventHub } from '../apps/runtime/src/events.js'
import { ProviderManager } from '../apps/runtime/src/provider-manager.js'
import type { Logger } from '../apps/runtime/src/logger.js'

const workspace: WorkspacePort = {
  ensureProjectRoot,
  readWorkspaceTree,
  writeTextFile,
  readTextFile,
  getGitStatus,
  initGitRepository,
}

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
} as unknown as Logger

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.()
})

interface FakeCall {
  toolResults: string[]
}
type ScriptAction = { tool?: { name: string; args: Record<string, unknown> }; text?: string }

class FakeProvider implements LlmProvider {
  readonly id = 'fake'
  readonly model = 'fake'
  private seq = 0

  constructor(private readonly script: (call: FakeCall) => ScriptAction) {}

  async *stream(request: ChatRequest): AsyncIterable<ProviderStreamEvent> {
    const toolResults = request.messages
      .filter((message) => message.role === 'tool')
      .map((message) => message.content)
    const action = this.script({ toolResults })
    if (action.tool) {
      this.seq += 1
      yield {
        type: 'tool.call',
        call: { id: `call-${this.seq}`, name: action.tool.name, arguments: JSON.stringify(action.tool.args) },
      }
      yield { type: 'done', finishReason: 'tool_calls' }
      return
    }
    yield { type: 'text.delta', text: action.text ?? '完成' }
    yield { type: 'done', finishReason: 'stop' }
  }

  async test(): Promise<ProviderTestResult> {
    return { ok: true, latencyMs: 0, message: 'ok' }
  }
}

function setup(fake: LlmProvider) {
  const store = new SqliteStore({ filePath: ':memory:' })
  const dataDir = mkdtempSync(join(tmpdir(), 'projectos-done-gate-'))
  const config = {
    dataDir,
    dbPath: join(dataDir, 'db.sqlite'),
    logDir: join(dataDir, 'logs'),
    runtimeVersion: 'test',
    provider: {
      provider: 'openai-compatible' as const,
      protocol: 'openai-chat' as const,
      baseUrl: 'http://127.0.0.1:9/v1',
      model: 'fake',
      apiKey: 'test',
      temperature: 0,
    },
    seedDemo: false,
  }
  const services = new CoreServices(store, workspace)
  const provider = new ProviderManager(config.provider)
  ;(provider as unknown as { createProvider: () => LlmProvider }).createProvider = () => fake
  const hub = new RuntimeEventHub({ sendEvent: () => undefined }, store, logger)
  const runner = new AgentRunner(config, store, services, provider, hub, logger)
  cleanup.push(() => {
    runner.shutdown()
    store.close()
    rmSync(dataDir, { recursive: true, force: true })
  })
  return { store, services, runner, dataDir }
}

async function createProject(services: CoreServices, dataDir: string, name: string) {
  return services.projects.create({
    name,
    description: '',
    rootPath: join(dataDir, name),
    createDirectory: true,
    initGit: false,
  })
}

async function readyTask(
  services: CoreServices,
  projectId: string,
  options: { title: string; role: string; expectedArtifacts?: string[]; assignee?: string },
): Promise<TaskCard> {
  const task = services.tasks.create({
    projectId,
    title: options.title,
    description: options.title,
    priority: 2,
    acceptanceCriteria: ['完成'],
    expectedArtifacts: options.expectedArtifacts,
    labels: ['plan', options.role],
    assigneeAgentId: options.assignee ?? 'agt_engineer',
    milestoneId: null,
    dependsOn: [],
    dueAt: null,
  })
  return services.tasks.move({ taskId: task.id, expectedVersion: task.version, to: 'ready' })
}

async function startAgent(
  store: SqliteStore,
  services: CoreServices,
  runner: AgentRunner,
  projectId: string,
  taskId: string,
): Promise<{ runId: string; sessionId: string }> {
  const session = services.sessions.create({ projectId, agentId: 'agt_engineer', title: `Gate ${taskId}` })
  const started = await runner.startRun({ projectId, sessionId: session.id, taskId, prompt: '执行任务' })
  return { runId: started.runId, sessionId: session.id }
}

function toolStatus(store: SqliteStore, projectId: string, taskId: string, name: string): string | null {
  const run = store.read.listRunSummaries(projectId, 50).find((item) => item.taskId === taskId)
  if (!run) return null
  const detail = store.read.getRunDetail(run.id)
  return detail?.toolCalls.find((call) => call.toolName === name)?.status ?? null
}

describe('Agent update_task_status(done) evidence gate', () => {
  it('blocks a done claim with no artifact, file or accepted criteria', async () => {
    const provider = new FakeProvider((call) =>
      call.toolResults.length === 0
        ? { tool: { name: 'update_task_status', args: { status: 'done' } } }
        : { text: '我已声明完成' },
    )
    const { store, services, runner, dataDir } = setup(provider)
    const project = await createProject(services, dataDir, 'done-no-evidence')
    const task = await readyTask(services, project.id, { title: '无证据完成', role: 'developer' })
    const { runId } = await startAgent(store, services, runner, project.id, task.id)
    await runner.awaitRunTerminal(runId, { timeoutMs: 10_000, pollMs: 50 })
    expect(store.read.getTask(task.id)?.status).not.toBe('done')
    expect(store.read.getTask(task.id)?.status).toBe('review')
    expect(toolStatus(store, project.id, task.id, 'update_task_status')).toBe('failed')
    console.log(`[done-gate] no-evidence task=${store.read.getTask(task.id)?.status} tool=${toolStatus(store, project.id, task.id, 'update_task_status')}`)
  }, 30_000)

  it('blocks a done claim when the necessary write approval was rejected', async () => {
    const provider = new FakeProvider((call) => {
      if (call.toolResults.length === 0) {
        return { tool: { name: 'write_file', args: { path: 'src/denied.ts', content: '// nope\n' } } }
      }
      if (call.toolResults.length === 1) {
        return { tool: { name: 'update_task_status', args: { status: 'done' } } }
      }
      return { text: '拒绝后声明完成' }
    })
    const { store, services, runner, dataDir } = setup(provider)
    const project = await createProject(services, dataDir, 'done-denied-write')
    const task = await readyTask(services, project.id, { title: '写盘被拒', role: 'developer' })
    const { runId } = await startAgent(store, services, runner, project.id, task.id)
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const pending = store.read.listApprovalViews(project.id).find((approval) => approval.status === 'pending')
      if (pending) {
        await runner.decideApproval(pending.id, 'rejected', 'test rejection')
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await runner.awaitRunTerminal(runId, { timeoutMs: 10_000, pollMs: 50 })
    expect(store.read.getTask(task.id)?.status).not.toBe('done')
    expect(store.read.getTask(task.id)?.status).toBe('review')
    expect(toolStatus(store, project.id, task.id, 'write_file')).toBe('denied')
    expect(toolStatus(store, project.id, task.id, 'update_task_status')).toBe('failed')
    console.log(`[done-gate] denied-write task=${store.read.getTask(task.id)?.status} write=${toolStatus(store, project.id, task.id, 'write_file')} done=${toolStatus(store, project.id, task.id, 'update_task_status')}`)
  }, 30_000)

  it('blocks a done claim when an artifact exists but does not match expectedArtifacts', async () => {
    const provider = new FakeProvider((call) =>
      call.toolResults.length === 0
        ? { tool: { name: 'update_task_status', args: { status: 'done' } } }
        : { text: '产物不匹配' },
    )
    const { store, services, runner, dataDir } = setup(provider)
    const project = await createProject(services, dataDir, 'done-wrong-artifact')
    const task = await readyTask(services, project.id, {
      title: '审查任务',
      role: 'reviewer',
      expectedArtifacts: ['审查报告'],
      assignee: 'agt_reviewer',
    })
    await services.projects.createArtifact({
      projectId: project.id,
      taskId: task.id,
      kind: 'code',
      title: '无关代码',
      body: 'not a review',
    })
    const session = services.sessions.create({ projectId: project.id, agentId: 'agt_reviewer', title: 'Review gate' })
    const started = await runner.startRun({ projectId: project.id, sessionId: session.id, taskId: task.id, prompt: '审查' })
    await runner.awaitRunTerminal(started.runId, { timeoutMs: 10_000, pollMs: 50 })
    expect(store.read.getTask(task.id)?.status).not.toBe('done')
    expect(toolStatus(store, project.id, task.id, 'update_task_status')).toBe('failed')
    console.log(`[done-gate] wrong-artifact task=${store.read.getTask(task.id)?.status} tool=${toolStatus(store, project.id, task.id, 'update_task_status')}`)
  }, 30_000)

  it('allows a done claim when a valid expected Artifact exists', async () => {
    const provider = new FakeProvider((call) =>
      call.toolResults.length === 0
        ? { tool: { name: 'update_task_status', args: { status: 'done' } } }
        : { text: '合法完成' },
    )
    const { store, services, runner, dataDir } = setup(provider)
    const project = await createProject(services, dataDir, 'done-valid-artifact')
    const task = await readyTask(services, project.id, {
      title: '有效审查',
      role: 'reviewer',
      expectedArtifacts: ['审查报告'],
      assignee: 'agt_reviewer',
    })
    const artifact = await services.projects.createArtifact({
      projectId: project.id,
      taskId: task.id,
      kind: 'document',
      title: '审查报告',
      body: '逐条核对通过，无阻塞项',
      metadata: {
        artifactType: 'review',
        reviewedObjects: ['src/rbac.ts'],
        scope: 'RBAC 实现',
        findings: ['未发现阻塞项'],
        conclusion: '通过',
        blockers: [],
        relatedArtifactIds: [],
        changedFiles: ['src/rbac.ts'],
      },
    })
    const session = services.sessions.create({ projectId: project.id, agentId: 'agt_reviewer', title: 'Review valid' })
    const started = await runner.startRun({ projectId: project.id, sessionId: session.id, taskId: task.id, prompt: '审查' })
    await runner.awaitRunTerminal(started.runId, { timeoutMs: 10_000, pollMs: 50 })
    expect(store.read.getTask(task.id)?.status).toBe('done')
    expect(toolStatus(store, project.id, task.id, 'update_task_status')).toBe('completed')
    const acceptance = store.read.listArtifacts(project.id, task.id).find((item) => item.title.includes('验收记录'))
    expect(acceptance?.body).toContain('审查报告')
    expect(acceptance?.metadata?.acceptanceMode).toBe('automatic')
    expect(artifact.title).toBe('审查报告')
    console.log(`[done-gate] valid-artifact task=${store.read.getTask(task.id)?.status} tool=${toolStatus(store, project.id, task.id, 'update_task_status')} acceptance=${acceptance?.id}`)
  }, 30_000)

  it('keeps human acceptance distinct from agent automatic acceptance', async () => {
    const provider = new FakeProvider(() => ({ text: 'no agent run' }))
    const { store, services, dataDir } = setup(provider)
    const project = await createProject(services, dataDir, 'done-human-vs-agent')
    const task = await readyTask(services, project.id, { title: '人工验收', role: 'developer' })
    const completed = services.tasks.move(
      { taskId: task.id, expectedVersion: task.version, to: 'done', note: '人工确认已核对' },
      USER_ACTOR,
    )
    expect(completed.status).toBe('done')
    const acceptance = store.read.listArtifacts(project.id, task.id).find((item) => item.title.includes('验收记录'))
    expect(acceptance?.body).toContain('人工验收确认')
    expect(acceptance?.body).not.toContain('质量门禁通过')
    expect(acceptance?.metadata?.acceptanceMode).toBe('human')
    console.log(`[done-gate] human task=${completed.status} acceptance=${acceptance?.id} body=${acceptance?.body?.slice(0, 80)}`)
  }, 30_000)

  it('blocks a tester done claim when no real test evidence exists', async () => {
    const provider = new FakeProvider((call) =>
      call.toolResults.length === 0
        ? { tool: { name: 'update_task_status', args: { status: 'done' } } }
        : { text: '测试通过（但没有执行）' },
    )
    const { store, services, runner, dataDir } = setup(provider)
    const project = await createProject(services, dataDir, 'done-no-test-evidence')
    const task = await readyTask(services, project.id, {
      title: '测试任务',
      role: 'tester',
      expectedArtifacts: ['测试报告'],
      assignee: 'agt_qa',
    })
    const session = services.sessions.create({ projectId: project.id, agentId: 'agt_qa', title: 'Tester gate' })
    const started = await runner.startRun({ projectId: project.id, sessionId: session.id, taskId: task.id, prompt: '执行测试' })
    await runner.awaitRunTerminal(started.runId, { timeoutMs: 10_000, pollMs: 50 })
    expect(store.read.getTask(task.id)?.status).not.toBe('done')
    expect(toolStatus(store, project.id, task.id, 'update_task_status')).toBe('failed')
    console.log(`[done-gate] no-test task=${store.read.getTask(task.id)?.status} tool=${toolStatus(store, project.id, task.id, 'update_task_status')}`)
  }, 30_000)

  it('does not create duplicate acceptance records on repeated done submissions', async () => {
    const provider = new FakeProvider((call) =>
      call.toolResults.length < 2
        ? { tool: { name: 'update_task_status', args: { status: 'done' } } }
        : { text: '重复提交' },
    )
    const { store, services, runner, dataDir } = setup(provider)
    const project = await createProject(services, dataDir, 'done-duplicate')
    const task = await readyTask(services, project.id, {
      title: '重复验收',
      role: 'reviewer',
      expectedArtifacts: ['审查报告'],
      assignee: 'agt_reviewer',
    })
    await services.projects.createArtifact({
      projectId: project.id,
      taskId: task.id,
      kind: 'document',
      title: '审查报告',
      body: '审查通过',
      metadata: {
        artifactType: 'review',
        reviewedObjects: ['src/x.ts'],
        scope: '实现',
        findings: ['无'],
        conclusion: '通过',
        blockers: [],
        relatedArtifactIds: [],
        changedFiles: [],
      },
    })
    const session = services.sessions.create({ projectId: project.id, agentId: 'agt_reviewer', title: 'Duplicate gate' })
    const started = await runner.startRun({ projectId: project.id, sessionId: session.id, taskId: task.id, prompt: '审查' })
    await runner.awaitRunTerminal(started.runId, { timeoutMs: 10_000, pollMs: 50 })
    expect(store.read.getTask(task.id)?.status).toBe('done')
    const acceptance = store.read
      .listArtifacts(project.id, task.id)
      .filter((item) => item.title.includes('验收记录'))
    expect(acceptance).toHaveLength(1)
    console.log(`[done-gate] duplicate task=${store.read.getTask(task.id)?.status} acceptance=${acceptance.length}`)
  }, 30_000)

  it('rejects done for a cancelled or superseded task', async () => {
    const provider = new FakeProvider(() => ({ text: 'no run' }))
    const { services, dataDir } = setup(provider)
    const project = await createProject(services, dataDir, 'done-cancelled')
    const task = await readyTask(services, project.id, { title: '已取消任务', role: 'developer' })
    const cancelled = services.tasks.move({ taskId: task.id, expectedVersion: task.version, to: 'cancelled' })
    expect(cancelled.status).toBe('cancelled')
    expect(() =>
      services.tasks.move({ taskId: task.id, expectedVersion: cancelled.version, to: 'done' }, USER_ACTOR),
    ).toThrow(/已完成或已取消/)
  }, 30_000)
})
