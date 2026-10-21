import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentStudioService } from '../apps/runtime/src/agent-studio.js'
import { FakeProvider, createGitProject, setup, waitFor } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

describe('R2 P0-01: per-Run file change attribution', () => {
  it('attributes only files written by the external Runtime Run, not pre-existing dirty files', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const { store, services, runner, dataDir } = harness
    const project = await createGitProject(services, dataDir, 'r2-attribution')
    // Pre-existing uncommitted change: must NOT be attributed to the Run.
    writeFileSync(join(project.rootPath, 'dirty.txt'), 'already dirty before run\n')
    mkdirSync(join(project.rootPath, 'generated'), { recursive: true })

    const studio = new AgentStudioService(store)
    const script = [
      "const fs = require('node:fs')",
      "fs.writeFileSync('generated/a.txt', 'a')",
      "fs.writeFileSync('generated/b.txt', 'b')",
      "console.log('attribution-ok')",
    ].join('\n')
    const runtime = studio.upsertRuntime({
      name: 'R2 Attribution CLI',
      protocol: 'cli',
      executable: process.execPath,
      endpoint: null,
      args: ['-e', script],
      authRef: null,
      modelRef: null,
      options: {},
      capabilities: {},
    })
    store.upsertRuntimeProfile({ ...runtime, status: 'available' })
    const agent = studio.upsertAgent({
      name: 'R2 Attribution Agent',
      role: '执行者',
      description: '',
      category: 'code',
      avatar: '',
      visibility: 'project',
      persona: {
        role: '执行者',
        background: '',
        responsibilities: '',
        principles: '',
        style: '',
        constraints: '',
        systemPrompt: 'Write the files.',
      },
      skillIds: [],
      runtimeProfileIds: [runtime.id],
      primaryRuntimeProfileId: runtime.id,
      modelRef: null,
      permissions: { tools: [], files: true, shell: true, network: false },
      ownerProjectId: project.id,
    })
    const session = services.sessions.create(
      { projectId: project.id, agentId: agent.id, title: 'attribution' },
      { kind: 'system', id: 'test', name: 'test' },
    )
    const started = await runner.startRun({
      projectId: project.id,
      sessionId: session.id,
      prompt: '写入 generated/a.txt 与 generated/b.txt',
    })
    await waitFor(
      () => store.read.listApprovalViews(project.id, started.runId).some((item) => item.status === 'pending'),
      10_000,
      'runtime approval',
    )
    const pending = store.read.listApprovalViews(project.id, started.runId).find((item) => item.status === 'pending')
    expect(pending).toBeTruthy()
    await runner.decideApproval(pending!.id, 'approved', 'attribution test')
    const result = await runner.awaitRunTerminal(started.runId, { timeoutMs: 20_000 })
    expect(result.run.status).toBe('completed')

    const detail = store.read.getRunDetail(started.runId)!
    const paths = detail.fileChanges.map((change) => change.path)
    expect(paths).toEqual(['generated/a.txt', 'generated/b.txt'])
    expect(detail.fileChanges.every((change) => change.changeType === 'added')).toBe(true)
    expect(paths).not.toContain('dirty.txt')
    expect(paths.some((path) => path.startsWith('.git/'))).toBe(false)
    const attributionStep = detail.steps.find((step) => step.title === '文件变更归属')
    expect(attributionStep?.payload.count).toBe(2)
    const rows = store.db
      .prepare('SELECT path, change_type FROM run_file_changes WHERE run_id = ? ORDER BY path')
      .all(started.runId) as Array<{ path: string; change_type: string }>
    expect(rows.map((row) => row.path)).toEqual(['generated/a.txt', 'generated/b.txt'])
    console.log(
      `[r2-attribution] run=${started.runId} attributed=${paths.join(',')} dirtyExcluded=true ` +
        `rows=${rows.length} stepCount=${attributionStep?.payload.count}`,
    )
  }, 60_000)
})
