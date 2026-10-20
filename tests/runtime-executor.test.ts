import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { newId, type RuntimeProfile } from '@projectos/contracts'
import { SqliteStore } from '@projectos/persistence'
import { RuntimeExecutionService } from '../apps/runtime/src/runtime-executor.js'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()?.() })

describe('runtime executor', () => {
  it('executes a custom CLI runtime and normalizes JSON events', async () => {
    const store = new SqliteStore({ filePath: ':memory:' })
    const dir = mkdtempSync(join(tmpdir(), 'projectos-runtime-'))
    cleanup.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })
    const script = join(dir, 'agent.mjs')
    writeFileSync(script, `console.log(JSON.stringify({ type: 'message.delta', text: process.argv[2] }))\nconsole.log(JSON.stringify({ type: 'run.completed', text: 'ok' }))\n`)
    const timestamp = Date.now()
    const profile: RuntimeProfile = {
      id: newId('rtp'), name: 'Test CLI', protocol: 'cli', executable: process.execPath,
      endpoint: null, args: [script], authRef: null, modelRef: null, options: {},
      capabilities: { stream: true, toolCalls: false, skills: false, systemPrompt: 'unsupported', sessionResume: false, subagents: false, worktree: false, permissions: false, costMetrics: false, modelSwitch: false },
      status: 'available', version: null, source: 'custom', createdAt: timestamp, updatedAt: timestamp,
    }
    store.upsertRuntimeProfile(profile)
    const executor = new RuntimeExecutionService(store)
    const result = await executor.execute(profile.id, 'hello runtime', dir)
    expect(result.status).toBe('completed')
    expect(result.output).toContain('hello runtime')
    expect(result.events.some((event) => event.type === 'run.completed')).toBe(true)
  })
})
