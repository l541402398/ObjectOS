import { mkdtempSync, rmSync } from 'node:fs'
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
import { RuntimeEventHub } from '../apps/runtime/src/events.js'
import { ProviderManager } from '../apps/runtime/src/provider-manager.js'
import type { Logger } from '../apps/runtime/src/logger.js'

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.()
})

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

function makeRunner() {
  const store = new SqliteStore({ filePath: ':memory:' })
  const dataDir = mkdtempSync(join(tmpdir(), 'projectos-recovery-'))
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
    apiKey: '',
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
        apiKey: '',
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
  return { store, services, runner }
}

async function makeRunningRun(
  store: SqliteStore,
  services: CoreServices,
  dataDir: string,
  suffix = 'a',
) {
  const project = await services.projects.create({
    name: `Recovery ${suffix}`,
    description: '',
    rootPath: join(dataDir, `project-${suffix}`),
    createDirectory: true,
    initGit: false,
  })
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
  const running = store.read.getTask(task.id)!
  const movedReady = store.moveTask(task.id, running.version, 'ready')
  store.moveTask(task.id, movedReady.version, 'running')
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
  return { project, task, run }
}

describe('runtime recovery', () => {
  it('marks interrupted runs for reconciliation and blocks their tasks', async () => {
    const { store, services, runner } = makeRunner()
    const dataDir = mkdtempSync(join(tmpdir(), 'projectos-recovery-data-'))
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }))
    const { task, run } = await makeRunningRun(store, services, dataDir)
    runner.recoverInterruptedRuns()
    expect(store.read.getRun(run.id)?.status).toBe('needs_reconciliation')
    expect(store.read.getTask(task.id)?.status).toBe('blocked')
    expect(store.read.getRun(run.id)?.error).toContain('Runtime')
  })

  it('keeps waiting-approval runs resumable and expires stale approvals on interrupted runs', async () => {
    const { store, services, runner } = makeRunner()
    const dataDir = mkdtempSync(join(tmpdir(), 'projectos-recovery-data-'))
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }))
    const { project, run } = await makeRunningRun(store, services, dataDir)
    store.updateRun(run.id, { status: 'waiting_approval' })
    const waiting = store.createApproval({
      projectId: project.id,
      runId: run.id,
      toolCallId: null,
      title: 'Approval that should survive',
    })
    const second = await makeRunningRun(store, services, dataDir, 'b')
    store.updateRun(second.run.id, { status: 'waiting_tool' })
    const stale = store.createApproval({
      projectId: second.project.id,
      runId: second.run.id,
      toolCallId: null,
      title: 'Stale approval',
    })
    runner.recoverInterruptedRuns()
    expect(store.read.getRun(run.id)?.status).toBe('waiting_approval')
    expect(store.getApprovalById(waiting.id)?.status).toBe('pending')
    expect(store.read.getRun(second.run.id)?.status).toBe('needs_reconciliation')
    expect(store.getApprovalById(stale.id)?.status).toBe('cancelled')
  })
})

