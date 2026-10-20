import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { newId, type RuntimeProfile } from '@projectos/contracts'
import { SqliteStore } from '@projectos/persistence'
import { CoreServices, type WorkspacePort } from '@projectos/application'
import { ensureProjectRoot, getGitStatus, initGitRepository, readTextFile, readWorkspaceTree, writeTextFile } from '@projectos/workspace'
import { RuntimeExecutionService } from '../apps/runtime/src/runtime-executor.js'
import { RuntimeRunService } from '../apps/runtime/src/runtime-run.js'
import { AgentStudioService } from '../apps/runtime/src/agent-studio.js'

const workspace: WorkspacePort = { ensureProjectRoot, readWorkspaceTree, writeTextFile, readTextFile, getGitStatus, initGitRepository }
const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()?.() })

describe('acp client', () => {
  it('initializes a session over JSON-RPC stdio', async () => {
    const store = new SqliteStore({ filePath: ':memory:' })
    const dir = mkdtempSync(join(tmpdir(), 'projectos-acp-'))
    cleanup.push(() => { store.close(); try { rmSync(dir, { recursive: true, force: true }) } catch { /* child may still hold the directory */ } })
    const script = join(dir, 'agent.mjs')
    writeFileSync(script, `import readline from 'node:readline'\nconst rl = readline.createInterface({ input: process.stdin })\nrl.on('line', (line) => {\n  const msg = JSON.parse(line)\n  if (msg.method === 'initialize') console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentInfo: { name: 'Fixture' }, capabilities: { prompt: true } } }))\n  if (msg.method === 'session/new') console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'acp-session-1' } }))
  if (msg.method === 'authenticate') console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { authenticated: true } }))
  if (msg.method === 'session/prompt') {
    console.log(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'acp-session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } } } }))
    console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } }))
  }\n})\n`)
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
    const auth = await studio.acpAuthenticate(profile.id, 'oauth', dir)
    expect(auth.ok).toBe(true)
    expect(auth.result).toEqual({ authenticated: true })
    const prompted = await studio.acpPrompt(profile.id, 'hello', dir)
    expect(prompted.sessionId).toBe('acp-session-1')
    expect(prompted.events.length).toBe(1)
    expect(prompted.result).toEqual({ stopReason: 'end_turn' })
    const services = new CoreServices(store, workspace)
    const project = await services.projects.create({ name: 'ACP Project', description: '', rootPath: join(dir, 'project'), createDirectory: true, initGit: false })
    const agent = studio.upsertAgent({
      name: 'ACP Agent', role: '执行', description: '', category: 'general', avatar: '', visibility: 'project',
      persona: { role: '执行', background: '', responsibilities: '', principles: '', style: '', constraints: '', systemPrompt: '' },
      skillIds: [], runtimeProfileIds: [profile.id], primaryRuntimeProfileId: profile.id, modelRef: null,
      permissions: { tools: [], files: false, shell: false, network: false },
    })
    const runs = new RuntimeRunService(store, new RuntimeExecutionService(store))
    const executed = await runs.run({ agentId: agent.id, projectId: project.id, prompt: 'hello', cwd: project.rootPath })
    expect(executed.status).toBe('completed')
    expect(store.read.getRun(executed.runId)?.status).toBe('completed')
  })
})




