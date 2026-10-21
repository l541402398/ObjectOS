import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreServices, type WorkspacePort } from '@projectos/application'
import type { PlanDraft } from '@projectos/contracts'
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
import { AgentRunner } from '../../apps/runtime/src/agent-runner.js'
import type { RuntimeConfig } from '../../apps/runtime/src/config.js'
import { RuntimeEventHub } from '../../apps/runtime/src/events.js'
import type { RuntimeLimits } from '../../apps/runtime/src/limits.js'
import { OrchestrationService } from '../../apps/runtime/src/orchestration.js'
import { OrchestrationScheduler } from '../../apps/runtime/src/orchestrator.js'
import { ProviderManager } from '../../apps/runtime/src/provider-manager.js'
import type { Logger } from '../../apps/runtime/src/logger.js'

export const workspace: WorkspacePort = {
  ensureProjectRoot,
  readWorkspaceTree,
  writeTextFile,
  readTextFile,
  getGitStatus,
  initGitRepository,
}

export const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
} as unknown as Logger

export interface FakeCall {
  index: number
  messages: ChatRequest['messages']
  hasToolResult: boolean
  toolResults: string[]
}

export interface FakeAction {
  text?: string
  tool?: { name: string; args: Record<string, unknown> }
  tools?: Array<{ name: string; args: Record<string, unknown> }>
  /** Wait this long before answering (keeps Runs overlapping). */
  delayMs?: number
  /** Never answer until the signal aborts (wall-clock tests). */
  hang?: boolean
}

/** Deterministic provider driven by a per-call script. */
export class FakeProvider implements LlmProvider {
  readonly id = 'fake'
  readonly model = 'fake'
  readonly calls: FakeCall[] = []
  private seq = 0

  constructor(private readonly script: (call: FakeCall) => FakeAction) {}

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderStreamEvent> {
    const call: FakeCall = {
      index: this.calls.length,
      messages: request.messages,
      hasToolResult: request.messages.some((message) => message.role === 'tool'),
      toolResults: request.messages.filter((message) => message.role === 'tool').map((message) => message.content),
    }
    this.calls.push(call)
    const action = this.script(call)
    if (action.hang) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve()
        const timer = setTimeout(resolve, 60_000)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          resolve()
        }, { once: true })
      })
      if (signal.aborted) {
        const error = new Error('aborted by signal')
        error.name = 'AbortError'
        throw error
      }
    }
    if (action.delayMs && action.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, action.delayMs))
    }
    if (signal.aborted) {
      const error = new Error('aborted by signal')
      error.name = 'AbortError'
      throw error
    }
    const calls = action.tools ?? (action.tool ? [action.tool] : [])
    if (calls.length > 0) {
      for (const tool of calls) {
        this.seq += 1
        yield {
          type: 'tool.call',
          call: { id: `call-${this.seq}`, name: tool.name, arguments: JSON.stringify(tool.args) },
        }
      }
      yield { type: 'done', finishReason: 'tool_calls' }
      return
    }
    yield { type: 'text.delta', text: action.text ?? '完成' }
    yield { type: 'usage', inputTokens: 10, outputTokens: 3 }
    yield { type: 'done', finishReason: 'stop' }
  }

  async test(): Promise<ProviderTestResult> {
    return { ok: true, latencyMs: 0, message: 'ok' }
  }
}

export interface Harness {
  store: SqliteStore
  services: CoreServices
  runner: AgentRunner
  orchestration: OrchestrationService
  scheduler: OrchestrationScheduler
  provider: ProviderManager
  hub: RuntimeEventHub
  dataDir: string
  dbPath: string
  config: RuntimeConfig
  close: () => void
}

export function makeConfig(dataDir: string, filePath: string, limits: Partial<RuntimeLimits> = {}): RuntimeConfig {
  return {
    dataDir,
    dbPath: filePath,
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
    limits,
  }
}

export function setup(
  fake?: LlmProvider,
  options: {
    limits?: Partial<RuntimeLimits>
    filePath?: string
    dataDir?: string
    cleanup?: Array<() => void>
    /** Use a real ProviderManager config (for external CLI Harness tests). */
    realProvider?: boolean
    providerConfig?: Partial<RuntimeConfig['provider']>
  } = {},
): Harness {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'projectos-r1-'))
  const dbPath = options.filePath ?? ':memory:'
  const config = makeConfig(dataDir, dbPath, options.limits ?? {})
  if (options.providerConfig) {
    config.provider = { ...config.provider, ...options.providerConfig }
  }
  const store = new SqliteStore({ filePath: dbPath })
  const services = new CoreServices(store, workspace)
  const provider = new ProviderManager(config.provider)
  if (!options.realProvider && fake) {
    ;(provider as unknown as { createProvider: () => LlmProvider }).createProvider = () => fake
  }
  const hub = new RuntimeEventHub({ sendEvent: () => undefined }, store, logger)
  const runner = new AgentRunner(config, store, services, provider, hub, logger)
  const orchestration = new OrchestrationService(store, services)
  const scheduler = new OrchestrationScheduler(store, services, runner, logger, dataDir)
  const cleanupList = options.cleanup ?? []
  const close = (): void => {
    scheduler.shutdown()
    runner.shutdown()
    store.close()
    for (const fn of cleanupList) fn()
  }
  return { store, services, runner, orchestration, scheduler, provider, hub, dataDir, dbPath, config, close }
}

export async function createGitProject(
  services: CoreServices,
  dataDir: string,
  name: string,
  scripts: Record<string, string> = { test: 'node -e "process.exit(0)"' },
) {
  const rootPath = join(dataDir, name.replace(/[^a-zA-Z0-9_-]/g, '-'))
  mkdirSync(rootPath, { recursive: true })
  writeFileSync(join(rootPath, 'package.json'), JSON.stringify({ name, private: true, scripts }, null, 2))
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

export function planWithTasks(
  orchestration: OrchestrationService,
  projectId: string,
  tasks: Array<Record<string, unknown>>,
): { plan: PlanDraft; taskIds: string[] } {
  const draft = orchestration.generatePlan(projectId, 'R1 fixture plan')
  const updated = orchestration.updatePlan({ planId: draft.id, tasks: tasks as never })
  return orchestration.approvePlan(updated.id)
}

export async function waitFor(predicate: () => boolean, timeoutMs = 15_000, label = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timed out waiting for ${label}`)
}

export function tempDir(prefix = 'projectos-r1-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function spawnCleanup(path: string): () => void {
  return () => rmSync(path, { recursive: true, force: true })
}
