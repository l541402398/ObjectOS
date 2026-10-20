import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { CoreServices, type WorkspacePort } from '@projectos/application'
import { SqliteStore } from '@projectos/persistence'
import { ensureProjectRoot, getGitStatus, initGitRepository, readTextFile, readWorkspaceTree, writeTextFile } from '@projectos/workspace'
import { AgentStudioService } from '../apps/runtime/src/agent-studio.js'
import { RuntimeExecutionService } from '../apps/runtime/src/runtime-executor.js'
import { RuntimeRunService } from '../apps/runtime/src/runtime-run.js'

const workspace: WorkspacePort = { ensureProjectRoot, readWorkspaceTree, writeTextFile, readTextFile, getGitStatus, initGitRepository }
const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()?.() })

describe('runtime worktree', () => {
  it('executes a CLI runtime in an isolated git worktree', async () => {
    const store = new SqliteStore({ filePath: ':memory:' })
    const dir = mkdtempSync(join(tmpdir(), 'projectos-runtime-wt-'))
    cleanup.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })
    const services = new CoreServices(store, workspace)
    const project = await services.projects.create({ name: 'Runtime Worktree', description: '', rootPath: join(dir, 'project'), createDirectory: true, initGit: true })
    const exec = promisify(execFile)
    await exec('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', 'commit', '--allow-empty', '-m', 'init'], { cwd: project.rootPath })
    writeFileSync(join(project.rootPath, 'agent.mjs'), 'console.log("worktree run")\n')
    const studio = new AgentStudioService(store)
    const profile = await studio.upsertRuntime({ name: 'Worktree CLI', protocol: 'cli', executable: process.execPath, endpoint: null, args: [join(project.rootPath, 'agent.mjs')], authRef: null, modelRef: null, options: {}, capabilities: {} })
    const agent = studio.upsertAgent({
      name: 'Worktree Agent', role: '执行', description: '', category: 'general', avatar: '', visibility: 'project',
      persona: { role: '执行', background: '', responsibilities: '', principles: '', style: '', constraints: '', systemPrompt: '' },
      skillIds: [], runtimeProfileIds: [profile.id], primaryRuntimeProfileId: profile.id, modelRef: null,
      permissions: { tools: [], files: false, shell: true, network: false },
    })
    const runs = new RuntimeRunService(store, new RuntimeExecutionService(store))
    const result = await runs.run({ agentId: agent.id, projectId: project.id, prompt: 'isolated' })
    expect(result.workspaceRef).toContain('.projectos')
    expect(result.workspaceRef).not.toBe(project.rootPath)
    expect(result.status).toBe('completed')
  })
})
