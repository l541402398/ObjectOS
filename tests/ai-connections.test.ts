import { afterEach, describe, expect, it } from 'vitest'
import { AIConnectionCreateInputSchema, AgentBackendBindingUpsertSchema } from '@projectos/contracts'
import { SqliteStore } from '@projectos/persistence'
import { AIConnectionService } from '../apps/runtime/src/ai-connections.js'
import { classifyFetchError, classifyHttpStatus } from '@projectos/connection-diagnostics'

const stores: SqliteStore[] = []
afterEach(() => {
  while (stores.length > 0) stores.pop()!.close()
})

function setup() {
  const store = new SqliteStore({ filePath: ':memory:' })
  stores.push(store)
  return { store, service: new AIConnectionService(store) }
}

function input(overrides: Record<string, unknown> = {}) {
  return AIConnectionCreateInputSchema.parse({
    name: 'Test connection',
    providerId: 'custom',
    baseUrl: 'https://api.example.com/v1',
    defaultModelId: 'test-model',
    ...overrides,
  })
}

describe('AI connection registry', () => {
  it('creates connections, enforces one default, and switches default atomically', () => {
    const { service } = setup()
    const first = service.create(input({ name: 'First' }))
    const second = service.create(input({ name: 'Second', isDefault: true }))
    const list = service.listViews()
    expect(list).toHaveLength(2)
    expect(list.filter((item) => item.isDefault)).toHaveLength(1)
    expect(list.find((item) => item.id === second.id)?.isDefault).toBe(true)
    expect(service.getDefault()?.id).toBe(second.id)
    service.setDefault(first.id)
    expect(service.getDefault()?.id).toBe(first.id)
  })

  it('deletes a connection and promotes the next enabled connection', () => {
    const { service } = setup()
    const first = service.create(input({ name: 'First' }))
    service.create(input({ name: 'Second', isDefault: true }))
    service.delete(service.getDefault()!.id)
    const remaining = service.listViews()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.id).toBe(first.id)
    expect(remaining[0]?.isDefault).toBe(true)
  })

  it('stores models and default model changes', () => {
    const { service } = setup()
    const connection = service.create(input())
    service.createModel({ connectionId: connection.id, modelId: 'model-b', displayName: 'Model B' })
    service.createModel({ connectionId: connection.id, modelId: 'model-c' })
    expect(service.listModels(connection.id).map((model) => model.modelId)).toEqual([
      'model-b',
      'model-c',
      'test-model',
    ])
    service.setDefaultModel(connection.id, 'model-c')
    expect(service.getView(connection.id).defaultModelId).toBe('model-c')
    service.deleteModel(connection.id, 'model-c')
    expect(service.getView(connection.id).defaultModelId).toBeNull()
  })

  it('routes by task, agent role, project and global scope with default fallback', () => {
    const { service } = setup()
    const fallback = service.create(input({ name: 'Default', isDefault: true }))
    const secondary = service.create(input({ name: 'Secondary', defaultModelId: 'secondary-model' }))
    service.upsertBinding(
      AgentBackendBindingUpsertSchema.parse({
        scopeType: 'agent',
        agentRole: '开发工程师',
        connectionId: secondary.id,
      }),
    )
    const routed = service.resolveForRun({
      projectId: 'prj_demo',
      agentId: 'agt_engineer',
      agentRole: '开发工程师',
      taskId: 'tsk_demo',
    })
    expect(routed).toEqual({ connectionId: secondary.id, modelId: null })

    const taskBinding = service.upsertBinding(
      AgentBackendBindingUpsertSchema.parse({
        scopeType: 'task',
        scopeId: 'tsk_demo',
        connectionId: fallback.id,
        modelId: 'task-model',
      }),
    )
    expect(taskBinding).toHaveLength(2)
    expect(
      service.resolveForRun({
        projectId: 'prj_demo',
        agentId: 'agt_engineer',
        agentRole: '开发工程师',
        taskId: 'tsk_demo',
      }),
    ).toEqual({ connectionId: fallback.id, modelId: 'task-model' })

    for (const binding of service.listBindings()) service.deleteBinding(binding.id)
    expect(
      service.resolveForRun({
        projectId: 'prj_demo',
        agentId: 'agt_engineer',
        agentRole: '开发工程师',
        taskId: 'tsk_demo',
      }),
    ).toEqual({ connectionId: fallback.id, modelId: fallback.defaultModelId })
  })
})

describe('connection diagnostics', () => {
  it('classifies HTTP statuses', () => {
    expect(classifyHttpStatus(401).code).toBe('INVALID_KEY')
    expect(classifyHttpStatus(402).code).toBe('INSUFFICIENT_QUOTA')
    expect(classifyHttpStatus(429).code).toBe('RATE_LIMITED')
    expect(classifyHttpStatus(404).code).toBe('MODEL_NOT_FOUND')
    expect(classifyHttpStatus(400).code).toBe('PROTOCOL_MISMATCH')
  })

  it('classifies network errors without leaking secrets', () => {
    expect(classifyFetchError(new Error('getaddrinfo ENOTFOUND api.example.com')).code).toBe('NETWORK_UNREACHABLE')
    expect(classifyFetchError(new Error('certificate has expired')).code).toBe('TLS_ERROR')
    expect(classifyFetchError(Object.assign(new Error('aborted'), { name: 'AbortError' })).code).toBe('TIMEOUT')
  })
})

describe('connection probes', () => {
  it('tests L1/L2/L3 against an OpenAI-compatible server and records checks', async () => {    const { createServer } = await import('node:http')
    const server = createServer((req, res) => {
      if (req.url?.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'server-model' }] }))
        return
      }
      if (req.url?.endsWith('/chat/completions')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    const { store, service } = setup()
    try {
      const connection = service.create(
        input({ name: 'Fake', baseUrl: `http://127.0.0.1:${port}/v1`, defaultModelId: 'fake-model' }),
      )
      const result = await service.test(connection, 'test-key')
      expect(result.ok).toBe(true)
      expect(result.stages.map((stage) => stage.stage)).toEqual(['L1', 'L2', 'L3'])
      expect(store.read.listAIConnectionChecks(connection.id)).toHaveLength(3)
      const models = await service.discoverModels(connection, 'test-key')
      expect(models.map((model) => model.modelId)).toContain('server-model')
    } finally {
      server.close()
    }
  })

  it('classifies a live invalid-key response', async () => {
    const { createServer } = await import('node:http')
    const server = createServer((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    const { service } = setup()
    try {
      const connection = service.create(
        input({ name: 'Unauthorized', baseUrl: `http://127.0.0.1:${port}/v1`, defaultModelId: 'bad-model' }),
      )
      const result = await service.test(connection, 'wrong-key')
      expect(result.ok).toBe(false)
      expect(result.code).toBe('INVALID_KEY')
      expect(result.stages.some((stage) => stage.stage === 'L2' && stage.status === 'failed')).toBe(true)
      expect(result.message).not.toContain('wrong-key')
    } finally {
      server.close()
    }
  })
})
