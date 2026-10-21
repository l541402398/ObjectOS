/**
 * R1-A worker: a real OS process that owns its own SQLite connection and
 * Scheduler, waits on a file barrier, then starts a Plan for an Agent shared
 * with the sibling process.
 *
 * Usage: tsx scripts/r1a-worker.ts <contextPath> <role> <resultPath>
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
import type { ChatRequest, LlmProvider, ProviderStreamEvent, ProviderTestResult } from '@projectos/provider-interfaces'
import { AgentRunner } from '../apps/runtime/src/agent-runner.js'
import type { RuntimeConfig } from '../apps/runtime/src/config.js'
import { RuntimeEventHub } from '../apps/runtime/src/events.js'
import { OrchestrationScheduler } from '../apps/runtime/src/orchestrator.js'
import { ProviderManager } from '../apps/runtime/src/provider-manager.js'

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
}

class SlowProvider implements LlmProvider {
  readonly id = 'slow-fake'
  readonly model = 'slow-fake'
  private calls = 0

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderStreamEvent> {
    this.calls += 1
    const hasToolResult = request.messages.some((message) => message.role === 'tool')
    // Hold the Agent long enough that a second process would overlap if the
    // SQLite slot were not atomic.
    await new Promise((resolve) => setTimeout(resolve, 900))
    if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    if (!hasToolResult) {
      yield {
        type: 'tool.call',
        call: {
          id: `call-${this.calls}`,
          name: 'create_artifact',
          arguments: JSON.stringify({
            title: `跨进程证据 ${process.pid}`,
            kind: 'document',
            body: `R1-A cross process evidence from pid ${process.pid}`,
          }),
        },
      }
      yield { type: 'done', finishReason: 'tool_calls' }
      return
    }
    yield { type: 'text.delta', text: 'done' }
    yield { type: 'done', finishReason: 'stop' }
  }

  async test(): Promise<ProviderTestResult> {
    return { ok: true, latencyMs: 0, message: 'ok' }
  }
}

function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (existsSync(path)) {
        clearInterval(timer)
        resolve(true)
      } else if (Date.now() > deadline) {
        clearInterval(timer)
        resolve(false)
      }
    }, 20)
  })
}

async function main(): Promise<void> {
  const [contextPath, role, resultPath] = process.argv.slice(2)
  if (!contextPath || !role || !resultPath) throw new Error('missing arguments')
  const context = JSON.parse(readFileSync(contextPath, 'utf8')) as {
    dataDir: string
    dbPath: string
    agentId: string
    roles: Record<string, { planId: string; projectId: string }>
  }
  const entry = context.roles[role]
  if (!entry) throw new Error(`unknown role ${role}`)
  const config: RuntimeConfig = {
    dataDir: context.dataDir,
    dbPath: context.dbPath,
    logDir: join(context.dataDir, 'logs'),
    runtimeVersion: 'test',
    provider: {
      provider: 'openai-compatible',
      protocol: 'openai-chat',
      baseUrl: 'http://127.0.0.1:9/v1',
      model: 'slow-fake',
      apiKey: 'test',
      temperature: 0,
    },
    seedDemo: false,
  }
  const store = new SqliteStore({ filePath: context.dbPath })
  const services = new CoreServices(store, workspace)
  const provider = new ProviderManager(config.provider)
  ;(provider as unknown as { createProvider: () => LlmProvider }).createProvider = () => new SlowProvider()
  const hub = new RuntimeEventHub({ sendEvent: () => undefined }, store, logger as never)
  const runner = new AgentRunner(config, store, services, provider, hub, logger as never)
  const scheduler = new OrchestrationScheduler(store, services, runner, logger as never, context.dataDir)
  const startedAt = Date.now()
  const result: Record<string, unknown> = { role, pid: process.pid, startedAt }
  try {
    const go = await waitForFile(join(context.dataDir, 'go.flag'), 30_000)
    if (!go) throw new Error('barrier timeout')
    result.startCalledAt = Date.now()
    await scheduler.start(entry.planId, 1, 0)
    const deadline = Date.now() + 40_000
    for (;;) {
      const plan = store.read.getPlanRevision(entry.planId)
      if (plan?.execution?.status === 'completed') break
      if (plan?.execution?.status === 'failed') throw new Error(`plan failed: ${plan.execution.error}`)
      if (Date.now() > deadline) throw new Error(`plan timeout: ${plan?.execution?.status}`)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    result.planStatus = 'completed'
    const runs = store.read
      .listRunSummaries(entry.projectId, 50)
      .filter((run) => run.taskId && run.taskId.length > 0)
    result.runIds = runs.map((run) => run.id)
    result.runs = runs.map((run) => ({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    }))
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  } finally {
    result.finishedAt = Date.now()
    writeFileSync(resultPath, JSON.stringify(result, null, 2))
    scheduler.shutdown()
    runner.shutdown()
    store.close()
  }
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
