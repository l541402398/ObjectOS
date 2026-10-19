import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, describe, expect, it } from 'vitest'

const children: ChildProcessWithoutNullStreams[] = []
const dirs: string[] = []

afterEach(() => {
  for (const child of children.splice(0)) {
    if (!child.killed) child.kill()
  }
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows may hold SQLite files briefly
    }
  }
})

interface RuntimeClient {
  hello: unknown
  request: (method: string, input?: unknown) => Promise<unknown>
  reject: (method: string, input?: unknown) => Promise<{ code: string; message: string }>
  waitForExit: () => Promise<void>
  child: ChildProcessWithoutNullStreams
}

function startRuntime(dataDir: string): Promise<RuntimeClient> {
  const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_LOG_LEVEL: 'warn' }
  delete (env as Record<string, string | undefined>).ELECTRON_RUN_AS_NODE
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/runtime/src/main.ts'], {
    cwd: process.cwd(),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  children.push(child)
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  let seq = 0
  let helloResolve!: (value: unknown) => void
  const helloPromise = new Promise<unknown>((resolve) => {
    helloResolve = resolve
  })
  rl.on('line', (line) => {
    let frame: Record<string, unknown>
    try {
      frame = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }
    if (frame.kind === 'hello') {
      helloResolve(frame)
      return
    }
    if (frame.kind === 'response' && typeof frame.id === 'string') {
      const entry = pending.get(frame.id)
      if (!entry) return
      pending.delete(frame.id)
      if (frame.ok) entry.resolve(frame.result)
      else {
        const error = frame.error as { code?: string; message?: string } | undefined
        entry.reject(new Error(`${error?.code ?? 'ERROR'}: ${error?.message ?? 'failed'}`))
      }
    }
  })
  const request = (method: string, input: unknown = {}): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = `req_${seq++}`
      pending.set(id, { resolve, reject })
      child.stdin.write(`${JSON.stringify({ kind: 'request', id, method, input })}\n`)
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`timeout waiting for ${method}`))
        }
      }, 20_000)
    })
  const reject = async (method: string, input: unknown = {}) => {
    try {
      await request(method, input)
      throw new Error('expected request to fail')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const [code] = message.split(': ')
      return { code: code ?? 'ERROR', message }
    }
  }
  const waitForExit = (): Promise<void> =>
    new Promise((resolve) => {
      if (child.exitCode !== null) resolve()
      else child.once('exit', () => resolve())
    })
  return helloPromise.then((hello) => ({ hello, request, reject, waitForExit, child }))
}

describe('runtime protocol', () => {
  it('handshakes, persists a project, and recovers it after restart', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'projectos-runtime-'))
    dirs.push(dataDir)
    const client = await startRuntime(dataDir)
    expect(client.hello).toMatchObject({ kind: 'hello', protocolVersion: 1 })
    const projectRoot = join(dataDir, 'project')
    const created = (await client.request('project.create', {
      name: 'Runtime Project',
      description: 'persisted through restart',
      rootPath: projectRoot,
      createDirectory: true,
      initGit: false,
    })) as { project: { id: string; name: string } }
    expect(created.project.name).toBe('Runtime Project')
    const overview = (await client.request('project.overview', { projectId: created.project.id })) as {
      stages: unknown[]
      stats: { tasksTotal: number }
    }
    expect(overview.stages).toHaveLength(8)
    expect(overview.stats.tasksTotal).toBe(0)
    await client.request('runtime.shutdown')
    await client.waitForExit()
    children.length = 0

    const restarted = await startRuntime(dataDir)
    const projects = (await restarted.request('project.list', { includeArchived: true })) as {
      projects: Array<{ id: string; name: string }>
    }
    expect(projects.projects.some((project) => project.id === created.project.id)).toBe(true)
    await restarted.request('runtime.shutdown')
    await restarted.waitForExit()
    children.length = 0
  }, 60_000)

  it('rejects invalid parameters and unknown methods with typed errors', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'projectos-runtime-errors-'))
    dirs.push(dataDir)
    const client = await startRuntime(dataDir)
    const bad = await client.reject('project.create', {
      name: 'Bad',
      rootPath: 'relative/path',
      createDirectory: true,
      initGit: false,
    })
    expect(bad.code).toBe('BAD_REQUEST')
    const unknown = await client.reject('does.not.exist', {})
    expect(unknown.code).toBe('NOT_FOUND')
    const health = (await client.request('runtime.health')) as { ok: boolean; protocolVersion: number }
    expect(health.ok).toBe(true)
    expect(health.protocolVersion).toBe(1)
    await client.request('runtime.shutdown')
    await client.waitForExit()
    children.length = 0
  }, 60_000)

  it('saves a message but returns a warning when no provider is configured', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'projectos-runtime-provider-'))
    dirs.push(dataDir)
    const client = await startRuntime(dataDir)
    const created = (await client.request('project.create', {
      name: 'No Provider',
      rootPath: join(dataDir, 'project'),
      createDirectory: true,
      initGit: false,
    })) as { project: { id: string } }
    const sessions = (await client.request('session.list', { projectId: created.project.id })) as {
      sessions: Array<{ id: string }>
    }
    const result = (await client.request('session.sendMessage', {
      sessionId: sessions.sessions[0]!.id,
      content: 'hello',
      startRun: true,
    })) as { runId: string | null; warning: string | null; message: { content: string } }
    expect(result.runId).toBeNull()
    expect(result.warning).toContain('Provider')
    expect(result.message.content).toBe('hello')
    await client.request('runtime.shutdown')
    await client.waitForExit()
    children.length = 0
  }, 60_000)
})
