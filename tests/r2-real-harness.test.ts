import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentStudioService } from '../apps/runtime/src/agent-studio.js'
import { createGitProject, setup, waitFor } from './helpers/r1-fixture.js'

const apiKey = process.env.DEEPSEEK_API_KEY ?? ''
const opencodePath = join(
  process.env.APPDATA ?? '',
  'npm',
  'node_modules',
  'opencode-ai',
  'bin',
  'opencode.exe',
)
const canRun = Boolean(apiKey) && existsSync(opencodePath)

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

/**
 * R2 Phase 4: real external Harness (OpenCode CLI + DeepSeek) in an isolated
 * project/SQLite. The API key comes only from the environment and is never
 * written to the database, fixtures or logs.
 */
describe.skipIf(!canRun)('R2 real external Harness', () => {
  function realSetup() {
    const harness = setup(undefined, {
      realProvider: true,
      providerConfig: {
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-flash',
        apiKey,
        protocol: 'openai-chat',
        provider: 'openai-compatible',
        temperature: 0,
      },
      limits: { runWallClockMs: 180_000, maxAgentSteps: 16, maxToolCalls: 32 },
    })
    cleanups.push(harness.close)
    return harness
  }

  async function profileAndAgent(harness: ReturnType<typeof setup>, projectId: string, model: string) {
    const studio = new AgentStudioService(harness.store)
    const runtime = studio.upsertRuntime({
      name: `OpenCode ${model}`,
      protocol: 'cli',
      executable: opencodePath,
      endpoint: null,
      args: ['run', '--model', model],
      authRef: null,
      modelRef: model,
      options: {},
      capabilities: {},
    })
    harness.store.upsertRuntimeProfile({ ...runtime, status: 'available' })
    const agent = studio.upsertAgent({
      name: 'R2 Real Harness Agent',
      role: '执行者',
      description: 'OpenCode + DeepSeek',
      category: 'code',
      avatar: '',
      visibility: 'project',
      persona: {
        role: '执行者',
        background: 'External CLI harness',
        responsibilities: 'Write files',
        principles: '',
        style: '',
        constraints: '',
        systemPrompt: 'You are a real external coding agent.',
      },
      skillIds: [],
      runtimeProfileIds: [runtime.id],
      primaryRuntimeProfileId: runtime.id,
      modelRef: model,
      permissions: { tools: [], files: true, shell: true, network: true },
      ownerProjectId: projectId,
    })
    const session = harness.services.sessions.create(
      { projectId, agentId: agent.id, title: `real-${model}` },
      { kind: 'system', id: 'test', name: 'test' },
    )
    return { agent, session }
  }

  it('performs a real model inference and attributes only the file it wrote', async () => {
    const harness = realSetup()
    const { store, services, runner, dataDir } = harness
    const project = await createGitProject(services, dataDir, 'r2-real-harness')
    writeFileSync(join(project.rootPath, 'dirty-real.txt'), 'pre-existing dirty file\n')
    const { session } = await profileAndAgent(harness, project.id, 'deepseek/deepseek-flash')
    const started = await runner.startRun({
      projectId: project.id,
      sessionId: session.id,
      prompt:
        'Create a file named real-run-a.txt in the current workspace containing exactly REAL-A-OK. ' +
        'Do not create or modify any other file.',
    })
    await waitFor(
      () => store.read.listApprovalViews(project.id, started.runId).some((item) => item.status === 'pending'),
      20_000,
      'real harness approval',
    )
    const approval = store.read.listApprovalViews(project.id, started.runId).find((item) => item.status === 'pending')!
    await runner.decideApproval(approval.id, 'approved', 'real harness e2e')
    const result = await runner.awaitRunTerminal(started.runId, { timeoutMs: 170_000, pollMs: 300 })
    if (result.run.status !== 'completed') {
      console.log('DEBUG real failure error=', result.run.error)
      console.log('DEBUG real steps=', JSON.stringify(store.read.getRunSteps(started.runId).map((step) => ({ kind: step.kind, title: step.title, payload: step.payload })).slice(-6)))
    }
    expect(result.run.status).toBe('completed')

    const written = readFileSync(join(project.rootPath, 'real-run-a.txt'), 'utf8')
    expect(written).toContain('REAL-A-OK')
    const detail = store.read.getRunDetail(started.runId)!
    const paths = detail.fileChanges.map((change) => change.path)
    expect(paths).toContain('real-run-a.txt')
    expect(paths).not.toContain('dirty-real.txt')
    expect(paths.some((path) => path.startsWith('.git/'))).toBe(false)
    expect(detail.steps.some((step) => step.title === '文件变更归属')).toBe(true)
    console.log(
      `[r2-real-harness] run=${started.runId} status=${result.run.status} model=deepseek-flash ` +
        `file=real-run-a.txt attributed=${paths.join(',')} dirtyExcluded=true toolCalls=${detail.toolCalls.length}`,
    )
  }, 200_000)

  it('cancels a real Harness child process and releases the Agent slot', async () => {
    const harness = realSetup()
    const { store, services, runner, dataDir } = harness
    const project = await createGitProject(services, dataDir, 'r2-real-cancel')
    const { agent, session } = await profileAndAgent(harness, project.id, 'deepseek/deepseek-flash')
    const started = await runner.startRun({
      projectId: project.id,
      sessionId: session.id,
      prompt:
        'Create a file named real-cancel-start.txt, then run the shell command ' +
        'node -e "setTimeout(() => {}, 120000)" and wait for it to finish.',
    })
    await waitFor(
      () => store.read.listApprovalViews(project.id, started.runId).some((item) => item.status === 'pending'),
      20_000,
      'real harness approval for cancel',
    )
    const approval = store.read.listApprovalViews(project.id, started.runId).find((item) => item.status === 'pending')!
    await runner.decideApproval(approval.id, 'approved', 'cancel real harness')
    await waitFor(() => store.read.getRun(started.runId)?.status === 'running', 30_000, 'real child running')
    await runner.cancel(started.runId)
    const result = await runner.awaitRunTerminal(started.runId, { timeoutMs: 20_000, pollMs: 200 })
    expect(result.run.status).toBe('cancelled')
    expect(store.getAgentExecutionSlot(agent.id)).toBeNull()
    console.log(`[r2-real-cancel] run=${started.runId} status=${result.run.status} childKilled=true`)
  }, 120_000)

  it('reports a real Harness failure without a fake success', async () => {
    const harness = realSetup()
    const { store, services, runner, dataDir } = harness
    const project = await createGitProject(services, dataDir, 'r2-real-failure')
    const { session } = await profileAndAgent(harness, project.id, 'deepseek/not-a-real-model')
    const started = await runner.startRun({
      projectId: project.id,
      sessionId: session.id,
      prompt: 'Create fake-success.txt with content SHOULD-NOT-EXIST.',
    })
    await waitFor(
      () => store.read.listApprovalViews(project.id, started.runId).some((item) => item.status === 'pending'),
      20_000,
      'failure approval',
    )
    const approval = store.read.listApprovalViews(project.id, started.runId).find((item) => item.status === 'pending')!
    await runner.decideApproval(approval.id, 'approved', 'failure test')
    const result = await runner.awaitRunTerminal(started.runId, { timeoutMs: 120_000, pollMs: 300 })
    expect(result.run.status).toBe('failed')
    expect(result.run.error).toBeTruthy()
    expect(existsSync(join(project.rootPath, 'fake-success.txt'))).toBe(false)
    console.log(`[r2-real-failure] run=${started.runId} status=${result.run.status} error=${result.run.error?.slice(0, 120)}`)
  }, 160_000)
})
