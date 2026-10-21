import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { newId, now, type Run } from '@projectos/contracts'
import { CoreServices, type WorkspacePort } from '@projectos/application'
import { SqliteStore } from '@projectos/persistence'
import {
  ensureProjectRoot,
  getGitStatus,
  initGitRepository,
  readTextFile,
  readWorkspaceTree,
  writeTextFile,
} from '@projectos/workspace'
import { AgentRunner } from '../apps/runtime/src/agent-runner.js'
import { AgentStudioService } from '../apps/runtime/src/agent-studio.js'
import { OrchestrationService } from '../apps/runtime/src/orchestration.js'
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

function makeRunner(options: { apiKey?: string } = {}) {
  const store = new SqliteStore({ filePath: ':memory:' })
  const dataDir = mkdtempSync(join(tmpdir(), 'projectos-guards-'))
  cleanup.push(() => {
    store.close()
    rmSync(dataDir, { recursive: true, force: true })
  })
  const services = new CoreServices(store, workspace)
  const provider = new ProviderManager({
    provider: 'openai-compatible',
    protocol: 'openai-chat',
    baseUrl: 'http://127.0.0.1:9/v1',
    model: 'test',
    apiKey: options.apiKey ?? '',
    temperature: 0,
  })
  const hub = new RuntimeEventHub({ sendEvent: () => undefined }, store, logger)
  const runner = new AgentRunner(
    {
      dataDir,
      dbPath: join(dataDir, 'db.sqlite'),
      logDir: join(dataDir, 'logs'),
      runtimeVersion: 'test',
      provider: {
        provider: 'openai-compatible',
        protocol: 'openai-chat',
        baseUrl: 'http://127.0.0.1:9/v1',
        model: 'test',
        apiKey: options.apiKey ?? '',
        temperature: 0,
      },
      seedDemo: false,
    },
    store,
    services,
    provider,
    hub,
    logger,
  )
  return { store, services, runner, dataDir }
}

async function createProject(services: CoreServices, dataDir: string, suffix = 'a') {
  return services.projects.create({
    name: `Guards ${suffix}`,
    description: '',
    rootPath: join(dataDir, `project-${suffix}`),
    createDirectory: true,
    initGit: false,
  })
}

async function makeRunningRun(store: SqliteStore, services: CoreServices, dataDir: string, suffix = 'a') {
  const project = await createProject(services, dataDir, suffix)
  const session = services.sessions.list(project.id)[0]!
  const task = services.tasks.create({
    projectId: project.id,
    title: 'Interrupted task',
    description: '',
    priority: 2,
    acceptanceCriteria: ['works'],
    labels: [],
    assigneeAgentId: 'agt_engineer',
    milestoneId: null,
    dependsOn: [],
    dueAt: null,
  })
  const ready = services.tasks.move({ taskId: task.id, expectedVersion: task.version, to: 'ready' })
  services.tasks.move({ taskId: task.id, expectedVersion: ready.version, to: 'running' })
  const timestamp = now()
  const run: Run = {
    id: newId('run'),
    projectId: project.id,
    taskId: task.id,
    sessionId: session.id,
    agentId: 'agt_engineer',
    attempt: 1,
    status: 'running',
    error: null,
    summary: null,
    inputTokens: 0,
    outputTokens: 0,
    checkpointId: null,
    startedAt: timestamp,
    finishedAt: null,
    createdAt: timestamp,
  }
  store.createRun(run)
  return { project, session, task, run }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
}

describe('agent runner guards', () => {
  it('rejects a task whose dependencies are not done', async () => {
    const { store, services, runner, dataDir } = makeRunner()
    const project = await createProject(services, dataDir)
    const session = services.sessions.list(project.id)[0]!
    const dependency = services.tasks.create({
      projectId: project.id,
      title: 'Prerequisite',
      description: '',
      priority: 2,
      acceptanceCriteria: [],
      labels: [],
      assigneeAgentId: 'agt_engineer',
      milestoneId: null,
      dependsOn: [],
      dueAt: null,
    })
    const task = services.tasks.create({
      projectId: project.id,
      title: 'Dependent',
      description: '',
      priority: 2,
      acceptanceCriteria: [],
      labels: [],
      assigneeAgentId: 'agt_engineer',
      milestoneId: null,
      dependsOn: [dependency.id],
      dueAt: null,
    })
    expect(() =>
      runner.assertRunnable({ projectId: project.id, sessionId: session.id, taskId: task.id }),
    ).toThrow(/依赖/)
    expect(store.read.getTask(task.id)?.status).toBe('backlog')
  })

  it('rejects a task that already has an active run', async () => {
    const { store, services, runner, dataDir } = makeRunner()
    const { project, session, task } = await makeRunningRun(store, services, dataDir)
    expect(() =>
      runner.assertRunnable({ projectId: project.id, sessionId: session.id, taskId: task.id }),
    ).toThrow(/已有运行中/)
  })

  it('rejects an unavailable bound runtime instead of silently falling back', async () => {
    const { store, services, runner, dataDir } = makeRunner()
    const project = await createProject(services, dataDir)
    const studio = new AgentStudioService(store)
    const profile = studio.upsertRuntime({
      name: 'Unavailable Harness',
      protocol: 'cli',
      executable: process.execPath,
      endpoint: null,
      args: [],
      authRef: null,
      modelRef: null,
      options: {},
      capabilities: {},
    })
    store.upsertRuntimeProfile({ ...profile, status: 'unavailable' })
    const agent = studio.upsertAgent({
      name: 'Bound Agent',
      role: '开发',
      description: '',
      category: 'code',
      avatar: '',
      visibility: 'project',
      persona: { role: '开发', background: '', responsibilities: '', principles: '', style: '', constraints: '', systemPrompt: '' },
      skillIds: [],
      runtimeProfileIds: [profile.id],
      primaryRuntimeProfileId: profile.id,
      modelRef: null,
      permissions: { tools: [], files: false, shell: true, network: false },
    })
    const session = services.sessions.create({ projectId: project.id, agentId: agent.id, title: 'Bound session' })
    expect(() =>
      runner.assertRunnable({ projectId: project.id, sessionId: session.id }),
    ).toThrow(/不可用/)
  })

  it('uses an explicit plan-node AgentAssignment when approving the plan', async () => {
    const { store, services, dataDir } = makeRunner()
    const project = await createProject(services, dataDir)
    const studio = new AgentStudioService(store)
    const profiles = studio.ensureDefaultProfiles()
    const custom = studio.upsertAgent({
      name: 'Plan Node Agent',
      role: '开发',
      description: '',
      category: 'code',
      avatar: '',
      visibility: 'project',
      persona: { role: '开发', background: '', responsibilities: '', principles: '', style: '', constraints: '', systemPrompt: '' },
      skillIds: [],
      runtimeProfileIds: [profiles[0]!.id],
      primaryRuntimeProfileId: profiles[0]!.id,
      modelRef: null,
      permissions: { tools: [], files: false, shell: false, network: false },
    })
    const orchestration = new OrchestrationService(store, services)
    const plan = orchestration.generatePlan(project.id, '实现计划节点绑定')
    const updated = orchestration.updatePlan({
      planId: plan.id,
      tasks: plan.tasks.map((task) => task.key === 'implementation' ? { ...task, agentId: custom.id } : task),
    })
    const approved = orchestration.approvePlan(updated.id)
    const tasks = approved.taskIds.map((taskId) => store.read.getTask(taskId)!).filter(Boolean)
    const implementation = tasks.find((task) => task.labels.includes('developer'))
    expect(implementation?.assigneeAgentId).toBe(custom.id)
  })

  it('acquires the lease before creating a run, so a lease conflict leaves no orphan state', async () => {
    const { store, services, runner, dataDir } = makeRunner({ apiKey: 'test' })
    const project = await createProject(services, dataDir)
    const session = services.sessions.list(project.id)[0]!
    const task = services.tasks.create({
      projectId: project.id,
      title: 'Lease task',
      description: '',
      priority: 2,
      acceptanceCriteria: [],
      labels: [],
      assigneeAgentId: 'agt_engineer',
      milestoneId: null,
      dependsOn: [],
      dueAt: null,
    })
    const ready = services.tasks.move({ taskId: task.id, expectedVersion: task.version, to: 'ready' })
    store.acquireTaskLease(task.id, 'other-run', 60_000)
    await expect(
      runner.startRun({ projectId: project.id, sessionId: session.id, taskId: task.id, prompt: 'start' }),
    ).rejects.toThrow(/租约/)
    expect(store.read.getTask(task.id)?.status).toBe('ready')
    expect(store.read.listTaskAttempts(task.id)).toHaveLength(0)
    expect(store.read.getLatestRunForTask(task.id)).toBeNull()
    expect(store.read.getTaskLease(task.id)?.holderId).toBe('other-run')
    expect(ready.status).toBe('ready')
  })

  it('persists a frozen run snapshot and exposes it in run detail', async () => {
    const { store, services, runner, dataDir } = makeRunner({ apiKey: 'test' })
    const project = await createProject(services, dataDir)
    const session = services.sessions.list(project.id)[0]!
    const task = services.tasks.create({
      projectId: project.id,
      title: 'Snapshot task',
      description: '',
      priority: 2,
      acceptanceCriteria: [],
      labels: [],
      assigneeAgentId: session.agentId,
      milestoneId: null,
      dependsOn: [],
      dueAt: null,
    })
    const ready = services.tasks.move({ taskId: task.id, expectedVersion: task.version, to: 'ready' })
    expect(ready.status).toBe('ready')
    const result = await runner.startRun({
      projectId: project.id,
      sessionId: session.id,
      taskId: task.id,
      prompt: 'snapshot',
    })
    const agentName = store.read.getAgent(session.agentId)?.name
    const snapshot = store.read.getRunSnapshot(result.runId)
    expect(snapshot?.runId).toBe(result.runId)
    expect(snapshot?.agentName).toBe(agentName)
    expect(snapshot?.runId).toBe(store.read.getRunDetail(result.runId)?.snapshot?.runId)
    await runner.cancel(result.runId)
  })

  it('creates a real ProjectOS Approval for an ACP permission request', async () => {
    const { store, services, runner, dataDir } = makeRunner()
    const project = await createProject(services, dataDir)
    const fixture = [
      "import readline from 'node:readline'",
      "const rl = readline.createInterface({ input: process.stdin })",
      "const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n')",
      "let promptId = 0",
      "let allow = null",
      "const handlePrompt = async () => {",
      "  send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } } } })",
      "  send({ jsonrpc: '2.0', id: 9001, method: 'session/request_permission', params: { sessionId: 's1', toolCall: { kind: 'edit' }, options: [{ optionId: 'allow', kind: 'allow', name: 'Allow' }] } })",
      "  await new Promise((resolve) => { allow = resolve })",
      "  send({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } })",
      "}",
      "rl.on('line', (line) => {",
      "  const msg = JSON.parse(line)",
      "  if (msg.id === 9001) { allow?.(); return }",
      "  if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentInfo: { name: 'Guard' }, capabilities: {} } })",
      "  else if (msg.method === 'session/new') send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 's1' } })",
      "  else if (msg.method === 'session/prompt') { promptId = msg.id; void handlePrompt() }",
      "})",
    ].join('\n')
    const script = join(dataDir, 'acp-guard.mjs')
    writeFileSync(script, fixture)
    const studio = new AgentStudioService(store)
    const profile = studio.upsertRuntime({
      name: 'ACP Guard',
      protocol: 'acp',
      executable: process.execPath,
      endpoint: null,
      args: [script],
      authRef: null,
      modelRef: null,
      options: {},
      capabilities: {},
    })
    store.upsertRuntimeProfile({ ...profile, status: 'available' })
    const agent = studio.upsertAgent({
      name: 'ACP Guard Agent',
      role: '执行',
      description: '',
      category: 'general',
      avatar: '',
      visibility: 'project',
      persona: { role: '执行', background: '', responsibilities: '', principles: '', style: '', constraints: '', systemPrompt: '' },
      skillIds: [],
      runtimeProfileIds: [profile.id],
      primaryRuntimeProfileId: profile.id,
      modelRef: null,
      permissions: { tools: [], files: false, shell: false, network: false },
    })
    const session = services.sessions.create({ projectId: project.id, agentId: agent.id, title: 'ACP guard session' })
    const result = await runner.startRun({ projectId: project.id, sessionId: session.id, prompt: 'hello' })
    await waitFor(() => store.read.listApprovalViews(null, result.runId).some((approval) => approval.status === 'pending'))
    const approval = store.read.listApprovalViews(null, result.runId).find((item) => item.status === 'pending')!
    expect(approval.request.kind).toBe('acp-permission')
    await runner.decideApproval(approval.id, 'approved')
    await waitFor(() => store.read.getRun(result.runId)?.status === 'completed', 10_000)
    expect(
      store.read.getToolCalls(result.runId).some(
        (toolCall) => toolCall.toolName === 'acp.permission' && toolCall.status === 'completed',
      ),
    ).toBe(true)
  })

  it('requires a run-level Approval before spawning a CLI runtime', async () => {
    const { store, services, runner, dataDir } = makeRunner()
    const project = await createProject(services, dataDir)
    const script = join(dataDir, 'cli-guard.mjs')
    writeFileSync(script, "process.stdout.write(JSON.stringify({ type: 'message.delta', text: 'cli-done' }) + '\\n')\n")
    const studio = new AgentStudioService(store)
    const profile = studio.upsertRuntime({
      name: 'CLI Guard',
      protocol: 'cli',
      executable: process.execPath,
      endpoint: null,
      args: [script],
      authRef: null,
      modelRef: null,
      options: {},
      capabilities: {},
    })
    store.upsertRuntimeProfile({ ...profile, status: 'available' })
    const agent = studio.upsertAgent({
      name: 'CLI Guard Agent',
      role: '执行',
      description: '',
      category: 'general',
      avatar: '',
      visibility: 'project',
      persona: { role: '执行', background: '', responsibilities: '', principles: '', style: '', constraints: '', systemPrompt: '' },
      skillIds: [],
      runtimeProfileIds: [profile.id],
      primaryRuntimeProfileId: profile.id,
      modelRef: null,
      permissions: { tools: [], files: true, shell: true, network: false },
    })
    const session = services.sessions.create({ projectId: project.id, agentId: agent.id, title: 'CLI guard session' })
    const result = await runner.startRun({ projectId: project.id, sessionId: session.id, prompt: 'hello' })
    await waitFor(() => store.read.listApprovalViews(null, result.runId).some((approval) => approval.status === 'pending'))
    const approval = store.read.listApprovalViews(null, result.runId).find((item) => item.status === 'pending')!
    expect(approval.request.kind).toBe('runtime-execution')
    expect(store.read.getRun(result.runId)?.status).toBe('waiting_approval')
    await runner.decideApproval(approval.id, 'approved')
    await waitFor(() => store.read.getRun(result.runId)?.status === 'completed', 10_000)
    expect(
      store.read.getToolCalls(result.runId).some(
        (toolCall) => toolCall.toolName === 'runtime.execute' && toolCall.status === 'completed',
      ),
    ).toBe(true)
  })

  it('expires an overdue approval and fails the run instead of executing it', async () => {
    const { store, services, runner, dataDir } = makeRunner()
    const { project, task, run } = await makeRunningRun(store, services, dataDir)
    store.updateRun(run.id, { status: 'waiting_approval' })
    const approval = store.createApproval({
      projectId: project.id,
      runId: run.id,
      toolCallId: null,
      title: 'Expired approval',
      expiresAt: now() - 1,
    })
    await expect(runner.decideApproval(approval.id, 'approved')).rejects.toThrow(/过期/)
    expect(store.getApprovalById(approval.id)?.status).toBe('expired')
    expect(store.read.getRun(run.id)?.status).toBe('failed')
    expect(store.read.getTask(task.id)?.status).toBe('blocked')
  })
})
