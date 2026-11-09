import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DecideApprovalsBatchInputSchema, newId, now, type Run } from '@projectos/contracts'
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
  const dataDir = mkdtempSync(join(tmpdir(), 'projectos-batch-'))
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
  return { store, services, runner, dataDir }
}

describe('approval.decideBatch schema', () => {
  it('requires ids or same-kind selectors', () => {
    expect(() => DecideApprovalsBatchInputSchema.parse({ decision: 'approved' })).toThrow()
    expect(
      DecideApprovalsBatchInputSchema.parse({
        decision: 'approved',
        approvalIds: ['apr_01hzyxtest000000000000001'],
      }).approvalIds,
    ).toHaveLength(1)
    expect(
      DecideApprovalsBatchInputSchema.parse({
        decision: 'approved',
        runId: 'run_01hzyxtest000000000000001',
        sameKindAs: 'apr_01hzyxtest000000000000002',
      }).grantFutureOfKind,
    ).toBe(true)
  })
})

describe('approval.decideBatch runtime', () => {
  it('rejects all pending approvals of the same tool kind in a run', async () => {
    const { store, services, runner, dataDir } = makeRunner()
    const project = await services.projects.create({
      name: 'Batch',
      description: '',
      rootPath: join(dataDir, 'project'),
      createDirectory: true,
      initGit: false,
    })
    const session = services.sessions.list(project.id)[0]!
    const timestamp = now()
    const run: Run = {
      id: newId('run'),
      projectId: project.id,
      taskId: null,
      sessionId: session.id,
      agentId: 'agt_engineer',
      attempt: 1,
      status: 'waiting_approval',
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
    const first = store.createApproval({
      projectId: project.id,
      runId: run.id,
      toolCallId: null,
      title: '授权 write_file',
      request: { toolName: 'write_file', args: { path: 'a.ts' } },
    })
    const second = store.createApproval({
      projectId: project.id,
      runId: run.id,
      toolCallId: null,
      title: '授权 write_file #2',
      request: { toolName: 'write_file', args: { path: 'b.ts' } },
    })
    store.createApproval({
      projectId: project.id,
      runId: run.id,
      toolCallId: null,
      title: '授权 run_command',
      request: { toolName: 'run_command', args: { command: 'ls' } },
    })

    const result = await runner.decideApprovalsBatch({
      decision: 'rejected',
      runId: run.id,
      sameKindAs: first.id,
      grantFutureOfKind: false,
      note: 'batch reject',
    })

    expect(result.approvals.map((item) => item.id).sort()).toEqual([first.id, second.id].sort())
    expect(store.getApprovalById(first.id)?.status).toBe('rejected')
    expect(store.getApprovalById(second.id)?.status).toBe('rejected')
    const remaining = store.read.listApprovalViews(null, run.id).filter((item) => item.status === 'pending')
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.request.toolName).toBe('run_command')
  })

  it('rejects a multi-selected approval id set', async () => {
    const { store, services, runner, dataDir } = makeRunner()
    const project = await services.projects.create({
      name: 'Multi',
      description: '',
      rootPath: join(dataDir, 'project-multi'),
      createDirectory: true,
      initGit: false,
    })
    const session = services.sessions.list(project.id)[0]!
    const timestamp = now()
    const run: Run = {
      id: newId('run'),
      projectId: project.id,
      taskId: null,
      sessionId: session.id,
      agentId: 'agt_engineer',
      attempt: 1,
      status: 'waiting_approval',
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
    const a = store.createApproval({
      projectId: project.id,
      runId: run.id,
      toolCallId: null,
      title: 'A',
      request: { toolName: 'write_file' },
    })
    const b = store.createApproval({
      projectId: project.id,
      runId: run.id,
      toolCallId: null,
      title: 'B',
      request: { toolName: 'run_command' },
    })
    const result = await runner.decideApprovalsBatch({
      decision: 'rejected',
      approvalIds: [a.id, b.id],
      grantFutureOfKind: false,
    })
    expect(result.approvals).toHaveLength(2)
    expect(store.getApprovalById(a.id)?.status).toBe('rejected')
    expect(store.getApprovalById(b.id)?.status).toBe('rejected')
  })
})
