import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlanDraft } from '@projectos/contracts'
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
import { RuntimeDispatcher } from '../apps/runtime/src/dispatcher.js'
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

interface FakeProvider {
  baseUrl: string
  requests: number
  server: Server
  close: () => Promise<void>
}

async function startFakeProvider(options: { delayMs?: number; failFirst?: boolean } = {}): Promise<FakeProvider> {
  let requests = 0
  const server = createServer((req, res) => {
    let body = ''
    let aborted = false
    req.on('aborted', () => { aborted = true })
    res.on('close', () => { aborted = true })
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      requests += 1
      const index = requests
      let payload: { stream?: boolean } = {}
      try { payload = JSON.parse(body) as { stream?: boolean } } catch { /* ignore */ }
      setTimeout(() => {
        if (aborted || res.writableEnded || res.destroyed) return
        if (options.failFirst && index === 1) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'fake provider failure' } }))
          return
        }
        if (!payload.stream) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ choices: [{ message: { content: `reply-${index}` } }] }))
          return
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: `reply-${index}` } }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 5 } })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      }, options.delayMs ?? 30)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fake provider failed to listen')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    get requests() { return requests },
    server,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections?.()
      server.close(() => resolve())
    }),
  }
}

function setup(baseUrl: string) {
  const store = new SqliteStore({ filePath: ':memory:' })
  const dataDir = mkdtempSync(join(tmpdir(), 'projectos-group-unit-'))
  const config = {
    dataDir,
    dbPath: join(dataDir, 'db.sqlite'),
    logDir: join(dataDir, 'logs'),
    runtimeVersion: 'test',
    provider: {
      provider: 'openai-compatible' as const,
      protocol: 'openai-chat' as const,
      baseUrl,
      model: 'test',
      apiKey: 'test',
      temperature: 0,
    },
    seedDemo: false,
  }
  const services = new CoreServices(store, workspace)
  const provider = new ProviderManager(config.provider)
  const hub = new RuntimeEventHub({ sendEvent: () => undefined }, store, logger)
  const runner = new AgentRunner(config, store, services, provider, hub, logger)
  const dispatcher = new RuntimeDispatcher({
    config,
    store,
    services,
    runner,
    provider,
    hub,
    logger,
    startedAt: Date.now(),
    shutdown: () => undefined,
  })
  cleanup.push(() => {
    dispatcher.shutdownOrchestrations()
    runner.shutdown()
    store.close()
    rmSync(dataDir, { recursive: true, force: true })
  })
  return { store, services, dispatcher }
}

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function createApprovedPlan(dispatcher: RuntimeDispatcher, services: CoreServices, rootPath: string): Promise<{
  projectId: string
  planId: string
  groupSessionId: string
}> {
  const project = await services.projects.create({
    name: 'Group Discussion',
    description: '',
    rootPath,
    createDirectory: true,
    initGit: false,
  })
  const plan = (await dispatcher.dispatch('plan.generate', {
    projectId: project.id,
    goal: '开发用户权限管理模块',
  })) as PlanDraft
  await dispatcher.dispatch('plan.approve', { planId: plan.id })
  const group = services.sessions.list(project.id).find((session) => session.title.startsWith('计划群聊 ·'))
  if (!group) throw new Error('group session missing')
  return { projectId: project.id, planId: plan.id, groupSessionId: group.id }
}

describe('group discussion', () => {
  it('lets all four Agents speak, one turn at a time, and reports real counts', async () => {
    const fake = await startFakeProvider({ delayMs: 40 })
    cleanup.push(() => void fake.close())
    const { store, services, dispatcher } = setup(fake.baseUrl)
    const { projectId, planId, groupSessionId } = await createApprovedPlan(
      dispatcher,
      services,
      join(tmpdir(), `projectos-group-project-${Date.now()}`),
    )

    const result = (await dispatcher.dispatch('plan.discuss', {
      planId,
      content: '请确认权限模块的接口边界和分工。',
    })) as { groupSessionId: string; participants: number; status: string }
    expect(result.status).toBe('started')
    expect(result.participants).toBe(4)
    await expect(dispatcher.dispatch('plan.discuss', { planId, content: '第二条消息' })).rejects.toThrow(/正在讨论/)

    await waitFor(() => {
      const detail = store.read.getSessionDetail(groupSessionId, 200)
      return (detail?.messages ?? []).some((message) => message.metadata?.kind === 'group-summary')
    })

    const detail = store.read.getSessionDetail(groupSessionId, 200)
    const messages = detail?.messages ?? []
    const summary = messages.find((message) => message.metadata?.kind === 'group-summary')
    expect(summary).toBeDefined()
    expect(summary?.metadata?.succeeded).toBe(4)
    expect(summary?.metadata?.failed).toBe(0)
    expect(summary?.metadata?.skipped).toBe(0)
    expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(4)
    expect(messages.some((message) => message.content.includes('本轮未能发言'))).toBe(false)
    const names = new Set(messages.filter((message) => message.role === 'assistant').map((message) => message.agentName))
    expect(names.size).toBe(4)

    const runs = store.read.listRunSummaries(projectId, 100).filter((run) => run.sessionId === groupSessionId)
    expect(runs).toHaveLength(4)
    expect(runs.every((run) => run.status === 'completed')).toBe(true)
    expect(fake.requests).toBe(4)
  })

  it('stops and reports a timeout without leaving the group session busy', async () => {
    const previous = process.env.PROJECTOS_GROUP_TURN_TIMEOUT_MS
    process.env.PROJECTOS_GROUP_TURN_TIMEOUT_MS = '150'
    const fake = await startFakeProvider({ delayMs: 1_500 })
    cleanup.push(() => void fake.close())
    const { store, services, dispatcher } = setup(fake.baseUrl)
    const { planId, groupSessionId } = await createApprovedPlan(
      dispatcher,
      services,
      join(tmpdir(), `projectos-group-timeout-${Date.now()}`),
    )
    try {
      await dispatcher.dispatch('plan.discuss', { planId, content: '超时测试' })
      await waitFor(() => {
        const detail = store.read.getSessionDetail(groupSessionId, 200)
        return (detail?.messages ?? []).some((message) => message.metadata?.kind === 'group-summary')
      })
      const detail = store.read.getSessionDetail(groupSessionId, 200)
      const summary = (detail?.messages ?? []).find((message) => message.metadata?.kind === 'group-summary')
      expect(summary?.metadata?.succeeded).toBe(0)
      expect(summary?.metadata?.failed).toBe(1)
      expect(summary?.metadata?.skipped).toBe(3)
      expect(store.read.getActiveRunForSession(groupSessionId)).toBeNull()
    } finally {
      if (previous === undefined) delete process.env.PROJECTOS_GROUP_TURN_TIMEOUT_MS
      else process.env.PROJECTOS_GROUP_TURN_TIMEOUT_MS = previous
    }
  }, 20_000)
})
