import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '@projectos/contracts'
import { CoreServices, type WorkspacePort } from '@projectos/application'
import { SqliteStore } from '@projectos/persistence'
import { ensureProjectRoot, getGitStatus, initGitRepository, readTextFile, readWorkspaceTree, writeTextFile } from '@projectos/workspace'
import { AgentStudioService } from '../apps/runtime/src/agent-studio.js'
import { RuntimeExecutionService } from '../apps/runtime/src/runtime-executor.js'
import { RuntimeRunService } from '../apps/runtime/src/runtime-run.js'

const workspace: WorkspacePort = { ensureProjectRoot, readWorkspaceTree, writeTextFile, readTextFile, getGitStatus, initGitRepository }
const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()?.() })

describe('runtime run', () => {
  it('creates a session and AgentRun for a custom runtime execution', async () => {
    const store = new SqliteStore({ filePath: ':memory:' })
    const dir = mkdtempSync(join(tmpdir(), 'projectos-runtime-run-'))
    cleanup.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })
    const services = new CoreServices(store, workspace)
    const project = await services.projects.create({ name: 'Runtime Run', description: '', rootPath: join(dir, 'project'), createDirectory: true, initGit: false })
    const studio = new AgentStudioService(store)
    const script = join(dir, 'agent.mjs')
    writeFileSync(script, `console.log(JSON.stringify({ type: 'message.delta', text: 'done ' + process.argv[2] }))\n`)
    const profile = await studio.upsertRuntime({ name: 'Test CLI', protocol: 'cli', executable: process.execPath, endpoint: null, args: [script], authRef: null, modelRef: null, options: {}, capabilities: {} })
    const agent = studio.upsertAgent({
      name: 'Runtime Agent', role: '执行', description: '', category: 'general', avatar: '', visibility: 'project',
      persona: { role: '执行', background: '', responsibilities: '', principles: '', style: '', constraints: '', systemPrompt: '' },
      skillIds: [], runtimeProfileIds: [profile.id], primaryRuntimeProfileId: profile.id, modelRef: null,
      permissions: { tools: [], files: false, shell: false, network: false },
    })
    const executor = new RuntimeExecutionService(store)
    const runs = new RuntimeRunService(store, executor)
    const result = await runs.run({ agentId: agent.id, projectId: project.id, prompt: 'hello', cwd: dir })
    expect(result.status).toBe('completed')
    const run = store.read.getRun(result.runId)
    expect(run?.status).toBe('completed')
    const messages = store.read.getMessages(result.sessionId)
    expect(messages.some((message) => message.role === 'assistant' && message.content.includes('done'))).toBe(true)
  })
})


