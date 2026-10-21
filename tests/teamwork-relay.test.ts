import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlanDraft } from '@projectos/contracts'
import { CoreServices, type WorkspacePort } from '@projectos/application'
import { SqliteStore } from '@projectos/persistence'
import { ensureProjectRoot, getGitStatus, initGitRepository, readTextFile, readWorkspaceTree, writeTextFile } from '@projectos/workspace'
import type { ChatRequest, LlmProvider, ProviderStreamEvent, ProviderTestResult } from '@projectos/provider-interfaces'
import { AgentRunner } from '../apps/runtime/src/agent-runner.js'
import { RuntimeEventHub } from '../apps/runtime/src/events.js'
import { OrchestrationService } from '../apps/runtime/src/orchestration.js'
import { OrchestrationScheduler } from '../apps/runtime/src/orchestrator.js'
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
  agent: string | null
  system: string
  user: string
  hasToolResult: boolean
  toolResults: string[]
}

type ScriptAction = { tool?: { name: string; args: Record<string, unknown> }; text?: string } | null

class FakeProvider implements LlmProvider {
  readonly id = 'fake'
  readonly model = 'fake'
  readonly calls: FakeCall[] = []
  private seq = 0

  constructor(private readonly script: (call: FakeCall) => ScriptAction) {}

  async *stream(request: ChatRequest): AsyncIterable<ProviderStreamEvent> {
    const system = request.messages.find((message) => message.role === 'system')?.content ?? ''
    const user = [...request.messages].reverse().find((message) => message.role === 'user')?.content ?? ''
    const hasToolResult = request.messages.some((message) => message.role === 'tool')
    const toolResults = request.messages
      .filter((message) => message.role === 'tool')
      .map((message) => message.content)
    const agent = ['Sage', 'Kai', 'Nova', 'Iris'].find((name) => system.includes(`${name} ·`)) ?? null
    const call: FakeCall = { agent, system, user, hasToolResult, toolResults }
    this.calls.push(call)
    const action = this.script(call)
    if (action?.tool) {
      this.seq += 1
      yield {
        type: 'tool.call',
        call: { id: `call-${this.seq}`, name: action.tool.name, arguments: JSON.stringify(action.tool.args) },
      }
      yield { type: 'done', finishReason: 'tool_calls' }
      return
    }
    yield { type: 'text.delta', text: action?.text ?? '完成' }
    yield { type: 'usage', inputTokens: 10, outputTokens: 3 }
    yield { type: 'done', finishReason: 'stop' }
  }

  async test(): Promise<ProviderTestResult> {
    return { ok: true, latencyMs: 0, message: 'ok' }
  }
}

function setup(fake: LlmProvider) {
  const store = new SqliteStore({ filePath: ':memory:' })
  const dataDir = mkdtempSync(join(tmpdir(), 'projectos-relay-'))
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
  const orchestration = new OrchestrationService(store, services)
  const scheduler = new OrchestrationScheduler(store, services, runner, logger, dataDir)
  cleanup.push(() => {
    scheduler.shutdown()
    runner.shutdown()
    store.close()
    rmSync(dataDir, { recursive: true, force: true })
  })
  return { store, services, runner, orchestration, scheduler, dataDir }
}

async function createGitProject(services: CoreServices, dataDir: string, name: string) {
  const rootPath = join(dataDir, name.replace(/[^a-zA-Z0-9_-]/g, '-'))
  mkdirSync(rootPath, { recursive: true })
  writeFileSync(
    join(rootPath, 'package.json'),
    JSON.stringify({ name, private: true, scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
  )
  const project = await services.projects.create({
    name,
    description: '',
    rootPath,
    createDirectory: false,
    initGit: true,
  })
  execFileSync('git', ['add', '.'], { cwd: rootPath })
  execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', 'commit', '-qm', 'initial'], { cwd: rootPath })
  return project
}

function planWithTasks(orchestration: OrchestrationService, projectId: string, tasks: Array<Record<string, unknown>>) {
  const draft = orchestration.generatePlan(projectId, 'Teamwork relay')
  const updated = orchestration.updatePlan({ planId: draft.id, tasks: tasks as never })
  return orchestration.approvePlan(updated.id)
}

async function drive(
  store: SqliteStore,
  runner: AgentRunner,
  projectId: string,
  planId: string,
  timeoutMs = 90_000,
): Promise<PlanDraft> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const approval of store.read.listApprovalViews(projectId)) {
      if (approval.status !== 'pending') continue
      try {
        await runner.decideApproval(approval.id, 'approved', 'relay-test')
      } catch (error) {
        // A concurrent tick may have cancelled it; keep driving.
        const current = store.getApprovalById(approval.id)
        if (current?.status === 'pending') throw error
      }
    }
    const plan = store.read.getPlanRevision(planId)
    if (plan?.execution?.status === 'completed') return plan
    if (plan?.execution?.status === 'failed') throw new Error(`plan failed: ${plan.execution.error}`)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  const plan = store.read.getPlanRevision(planId)
  throw new Error(`plan did not settle: ${plan?.execution?.status} ${plan?.execution?.error ?? ''}`)
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('timed out waiting for condition')
}

describe('Agent teamwork relay', () => {
  it('passes a real design artifact and real file changes down a DAG', async () => {
    const provider = new FakeProvider((call) => {
      if (call.hasToolResult) return { text: `${call.agent ?? 'Agent'} 完成` }
      if (call.agent === 'Sage') {
        return {
          tool: {
            name: 'create_artifact',
            args: {
              title: '权限模块设计',
              kind: 'design',
              body: 'DESIGN-MARKER 权限模块采用 RBAC，接口边界为 /api/rbac。',
            },
          },
        }
      }
      if (call.agent === 'Kai') {
        return {
          tool: {
            name: 'write_file',
            args: {
              path: 'src/rbac.ts',
              content: 'export const rbac = true // DEV-MARKER\n',
            },
          },
        }
      }
      if (call.agent === 'Iris') {
        return {
          tool: {
            name: 'run_tests',
            args: {
              command: `node -e "require('fs').writeFileSync('test-evidence.txt','tester-ok')"`,
            },
          },
        }
      }
      return { text: '完成' }
    })
    const { store, services, runner, orchestration, scheduler, dataDir } = setup(provider)
    const project = await createGitProject(services, dataDir, 'relay-dag')
    const approved = planWithTasks(orchestration, project.id, [
      { key: 'arch', title: '架构设计', description: '设计权限模块', role: 'architect', agentId: 'agt_architect', assignmentReasons: ['用户手动指定'], assignmentBlocked: false, dependsOn: [], acceptanceCriteria: ['给出设计'], expectedArtifacts: ['设计'], requiresApproval: false },
      { key: 'impl', title: '开发实现', description: '实现 RBAC', role: 'developer', agentId: 'agt_engineer', assignmentReasons: ['用户手动指定'], assignmentBlocked: false, dependsOn: ['arch'], acceptanceCriteria: ['代码可构建'], expectedArtifacts: ['代码 diff'], requiresApproval: true },
      { key: 'test', title: '测试验证', description: '执行测试', role: 'tester', agentId: 'agt_qa', assignmentReasons: ['用户手动指定'], assignmentBlocked: false, dependsOn: ['impl'], acceptanceCriteria: ['记录测试'], expectedArtifacts: ['测试报告'], requiresApproval: true },
    ])
    await scheduler.start(approved.plan.id, 2, 0)
    const final = await drive(store, runner, project.id, approved.plan.id)

    expect(final.execution?.status).toBe('completed')
    const board = store.read.getTaskBoard(project.id)
    const planTasks = board.tasks.filter((task) => approved.taskIds.includes(task.id))
    expect(planTasks.map((task) => task.status)).toEqual(['done', 'done', 'done'])

    const worktree = final.execution?.workspaceRef
    expect(worktree).toBeTruthy()
    expect(existsSync(join(worktree!, 'src', 'rbac.ts'))).toBe(true)
    expect(readFileSync(join(worktree!, 'src', 'rbac.ts'), 'utf8')).toContain('DEV-MARKER')
    expect(existsSync(join(worktree!, 'test-evidence.txt'))).toBe(true)

    const artifacts = store.read.listArtifacts(project.id)
    const design = artifacts.find((artifact) => artifact.taskId === approved.taskIds[0] && artifact.kind === 'design')
    expect(design?.title).toBe('权限模块设计')
    const testReports = artifacts.filter((artifact) => artifact.kind === 'test-report')
    expect(testReports.length).toBeGreaterThanOrEqual(2)

    const runs = store.read
      .listRunSummaries(project.id, 50)
      .filter((run) => Boolean(run.taskId && approved.taskIds.includes(run.taskId)))
    expect(runs.map((run) => run.status)).toEqual(['completed', 'completed', 'completed'])
    const archRun = runs.find((run) => run.taskId === approved.taskIds[0])
    const developerRun = runs.find((run) => run.taskId === approved.taskIds[1])
    const testerRun = runs.find((run) => run.taskId === approved.taskIds[2])
    expect((developerRun?.startedAt ?? 0) >= (archRun?.finishedAt ?? 0)).toBe(true)
    expect((testerRun?.startedAt ?? 0) >= (developerRun?.finishedAt ?? 0)).toBe(true)
    const implCard = store.read.getTaskCard(approved.taskIds[1]!)
    const testCard = store.read.getTaskCard(approved.taskIds[2]!)
    expect(implCard?.dependencyIds).toContain(approved.taskIds[0])
    expect(testCard?.dependencyIds).toContain(approved.taskIds[1])
    const developerDetail = store.read.getRunDetail(developerRun!.id)
    const upstreamStep = developerDetail?.steps.find((step) => step.title === '上游成果注入')
    expect(upstreamStep).toBeDefined()
    const injected = (upstreamStep?.payload.artifacts ?? []) as Array<{ id: string; injected: boolean }>
    expect(injected.some((artifact) => artifact.id === design?.id && artifact.injected)).toBe(true)
    expect(provider.calls.some((call) => call.agent === 'Kai' && call.system.includes('DESIGN-MARKER'))).toBe(true)
    expect(provider.calls.some((call) => call.agent === 'Iris' && call.system.includes('质量门禁'))).toBe(true)
    console.log(
      `[relay] design=${design?.id} developerRun=${developerRun?.id} injected=${injected.filter((artifact) => artifact.injected).length} ` +
        `testReports=${testReports.length} files=src/rbac.ts+test-evidence.txt ` +
        `order=${archRun?.finishedAt}->${developerRun?.startedAt}->${developerRun?.finishedAt}->${testerRun?.startedAt} worktree=${worktree}`,
    )
  }, 120_000)

  it('auto-accepts a low-risk handoff and lets the scheduler start the receiver after the source releases the lease', async () => {
    const provider = new FakeProvider((call) => {
      if (call.hasToolResult) return { text: call.agent === 'Iris' ? 'IRIS-HANDOFF-OK' : 'KAI-HANDOFF-DONE' }
      if (call.agent === 'Kai') {
        return {
          tool: {
            name: 'handoff_task',
            args: {
              toAgentId: 'agt_qa',
              summary: '开发已完成基础实现，请测试接手',
              completed: ['实现基础 RBAC'],
              remaining: ['补充边界测试'],
              risks: ['权限缓存一致性'],
              nextActions: ['执行测试并记录结果'],
              riskLevel: 'low',
            },
          },
        }
      }
      return { text: 'HANDOFF-OK' }
    })
    const { store, services, runner, orchestration, scheduler, dataDir } = setup(provider)
    const project = await createGitProject(services, dataDir, 'relay-handoff')
    services.collaboration.setPolicy(project.id, 'auto')
    const approved = planWithTasks(orchestration, project.id, [
      { key: 'impl', title: '开发实现', description: '实现 RBAC', role: 'developer', agentId: 'agt_engineer', assignmentReasons: ['用户手动指定'], assignmentBlocked: false, dependsOn: [], acceptanceCriteria: ['代码可构建'], expectedArtifacts: ['代码 diff'], requiresApproval: true },
    ])
    await scheduler.start(approved.plan.id, 1, 0)
    const final = await drive(store, runner, project.id, approved.plan.id)

    expect(final.execution?.status).toBe('completed')
    const handoffs = services.collaboration.listHandoffs(project.id)
    expect(handoffs).toHaveLength(1)
    const handoff = handoffs[0]!
    expect(handoff.status).toBe('accepted')
    expect(handoff.fromAgentId).toBe('agt_engineer')
    expect(handoff.toAgentId).toBe('agt_qa')
    expect(handoff.completed).toEqual(['实现基础 RBAC'])
    expect(handoff.remaining).toEqual(['补充边界测试'])
    expect(handoff.risks).toEqual(['权限缓存一致性'])
    expect(handoff.nextActions).toEqual(['执行测试并记录结果'])
    expect(handoff.sourceRunId).toBeTruthy()
    expect(handoff.targetRunId).toBeTruthy()
    expect(handoff.continuedAt).toBeTruthy()
    expect(handoff.toSessionId).toBeTruthy()

    const task = store.read.getTask(approved.taskIds[0]!)
    expect(task?.status).toBe('done')
    expect(task?.assigneeAgentId).toBe('agt_qa')
    const runs = store.read
      .listRunSummaries(project.id, 50)
      .filter((run) => run.taskId === approved.taskIds[0])
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    expect(runs).toHaveLength(2)
    expect(runs[0]?.agentId).toBe('agt_engineer')
    expect(runs[1]?.agentId).toBe('agt_qa')
    expect(runs[0]?.status).toBe('completed')
    expect(runs[1]?.status).toBe('completed')
    expect(runs[1]?.startedAt ?? 0).toBeGreaterThanOrEqual(runs[0]?.finishedAt ?? 0)
    expect(runs[1]?.id).toBe(handoff.targetRunId)
    console.log(
      `[handoff] id=${handoff.id} status=${handoff.status} sourceRun=${handoff.sourceRunId} ` +
        `targetRun=${handoff.targetRunId} continuedAt=${handoff.continuedAt} task=${task?.status} assignee=${task?.assigneeAgentId}`,
    )
  }, 120_000)

  it('discovers collaborators and sends a message by stable Agent id', async () => {
    const provider = new FakeProvider((call) => {
      if (call.agent === 'Iris') return { text: 'IRIS-MESSAGE-OK' }
      if (call.agent !== 'Kai') return { text: 'done' }
      if (call.toolResults.length === 0) {
        return { tool: { name: 'list_collaborators', args: { includeSelf: false } } }
      }
      if (call.toolResults.length === 1) {
        let toAgentId = 'agt_qa'
        try {
          const parsed = JSON.parse(call.toolResults[0] ?? '{}') as {
            result?: { collaborators?: Array<{ agentId: string; role: string }> }
          }
          toAgentId =
            parsed.result?.collaborators?.find((agent) => agent.role.includes('测试'))?.agentId ?? toAgentId
        } catch {
          // Keep the stable built-in id fallback.
        }
        return {
          tool: {
            name: 'send_agent_message',
            args: { toAgentId, body: '请协助检查权限边界，并回复你的结论。' },
          },
        }
      }
      return { text: 'KAI-DISCOVERY-DONE' }
    })
    const { store, services, runner, orchestration, scheduler, dataDir } = setup(provider)
    const project = await createGitProject(services, dataDir, 'relay-discovery')
    const approved = planWithTasks(orchestration, project.id, [
      { key: 'impl', title: '开发实现', description: '实现 RBAC', role: 'developer', agentId: 'agt_engineer', assignmentReasons: ['用户手动指定'], assignmentBlocked: false, dependsOn: [], acceptanceCriteria: ['代码可构建'], expectedArtifacts: [], requiresApproval: false },
    ])
    await scheduler.start(approved.plan.id, 1, 0)
    const final = await drive(store, runner, project.id, approved.plan.id)
    expect(final.execution?.status).toBe('completed')

    await waitFor(() => {
      const runs = store.read.listRunSummaries(project.id, 50)
      return runs.some((run) => run.agentId === 'agt_qa' && run.taskId === null && run.status === 'completed')
    })
    const inbox = services.collaboration.listInbox(project.id)
    expect(inbox).toHaveLength(1)
    expect(inbox[0]?.recipientAgentId).toBe('agt_qa')
    expect(inbox[0]?.status).not.toBe('failed')
    const envelopePayload = (inbox[0]?.envelope.payload ?? {}) as Record<string, unknown>
    expect(String(envelopePayload.body ?? '')).toContain('请协助检查权限边界')
    const targetSession = services.sessions.list(project.id).find(
      (session) => session.agentId === 'agt_qa' && !session.title.startsWith('计划群聊'),
    )
    expect(targetSession).toBeTruthy()
    const targetRun = store.read
      .listRunSummaries(project.id, 50)
      .find((run) => run.agentId === 'agt_qa' && run.taskId === null)
    expect(targetRun?.status).toBe('completed')
    expect(provider.calls.some((call) => call.agent === 'Kai' && call.toolResults.length >= 2)).toBe(true)
    console.log(
      `[discovery] inbox=${inbox[0]?.id} status=${inbox[0]?.status} targetSession=${targetSession?.id} targetRun=${targetRun?.id}`,
    )
  }, 120_000)

  it('does not write a file when a dangerous tool approval is rejected', async () => {
    const provider = new FakeProvider((call) => {
      if (call.agent === 'Kai' && !call.hasToolResult) {
        return {
          tool: {
            name: 'write_file',
            args: { path: 'src/rejected.ts', content: '// should never be written\n' },
          },
        }
      }
      return { text: '拒绝后的总结' }
    })
    const { store, services, runner, orchestration, scheduler, dataDir } = setup(provider)
    const project = await createGitProject(services, dataDir, 'relay-reject')
    const approved = planWithTasks(orchestration, project.id, [
      { key: 'impl', title: '危险写入', description: '尝试写盘', role: 'developer', agentId: 'agt_engineer', assignmentReasons: ['用户手动指定'], assignmentBlocked: false, dependsOn: [], acceptanceCriteria: ['不应写盘'], expectedArtifacts: [], requiresApproval: true },
    ])
    await scheduler.start(approved.plan.id, 1, 0)
    const deadline = Date.now() + 60_000
    let final: PlanDraft | null = null
    while (Date.now() < deadline) {
      for (const approval of store.read.listApprovalViews(project.id)) {
        if (approval.status === 'pending') {
          await runner.decideApproval(approval.id, 'rejected', 'reject test')
        }
      }
      final = store.read.getPlanRevision(approved.plan.id)
      if (final?.execution?.status === 'completed' || final?.execution?.status === 'failed') break
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    expect(final?.execution?.status).toBe('completed')
    const worktree = final?.execution?.workspaceRef
    expect(worktree).toBeTruthy()
    expect(existsSync(join(worktree!, 'src', 'rejected.ts'))).toBe(false)
    const runs = store.read.listRunSummaries(project.id, 50).filter((run) => run.taskId === approved.taskIds[0])
    const detail = store.read.getRunDetail(runs[0]!.id)
    const denied = detail?.toolCalls.find((toolCall) => toolCall.toolName === 'write_file')
    expect(denied?.status).toBe('denied')
    const approvals = store.read.listApprovalViews(project.id, runs[0]!.id)
    expect(approvals.some((approval) => approval.status === 'rejected')).toBe(true)
    console.log(`[rejected] run=${runs[0]?.id} toolCall=${denied?.id} status=${denied?.status} fileWritten=false`)
  }, 90_000)
})
