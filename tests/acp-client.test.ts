import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { newId, type RuntimeProfile } from '@projectos/contracts'
import { SqliteStore } from '@projectos/persistence'
import { AgentStudioService } from '../apps/runtime/src/agent-studio.js'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()?.() })

describe('acp client', () => {
  it('initializes a session over JSON-RPC stdio', async () => {
    const store = new SqliteStore({ filePath: ':memory:' })
    const dir = mkdtempSync(join(tmpdir(), 'projectos-acp-'))
    cleanup.push(() => { store.close(); try { rmSync(dir, { recursive: true, force: true }) } catch { /* child may still hold the directory */ } })
    const script = join(dir, 'agent.mjs')
    writeFileSync(script, `import readline from 'node:readline'\nconst rl = readline.createInterface({ input: process.stdin })\nrl.on('line', (line) => {\n  const msg = JSON.parse(line)\n  if (msg.method === 'initialize') console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentInfo: { name: 'Fixture' }, capabilities: { prompt: true } } }))\n  if (msg.method === 'session/new') console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'acp-session-1' } }))\n})\n`)
    const timestamp = Date.now()
    const profile: RuntimeProfile = {
      id: newId('rtp'), name: 'ACP Fixture', protocol: 'acp', executable: process.execPath, endpoint: null,
      args: [script], authRef: null, modelRef: null, options: {}, capabilities: { stream: true, toolCalls: true, skills: false, systemPrompt: 'native', sessionResume: true, subagents: false, worktree: false, permissions: true, costMetrics: false, modelSwitch: false },
      status: 'available', version: '1.0.0', source: 'custom', createdAt: timestamp, updatedAt: timestamp,
    }
    store.upsertRuntimeProfile(profile)
    const studio = new AgentStudioService(store)
    const result = await studio.acpHandshake(profile.id, dir)
    expect(result.sessionId).toBe('acp-session-1')
    expect(result.protocolVersion).toBe(1)
  })
})

