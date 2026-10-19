import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteStore } from '@projectos/persistence'
import { seedDemo } from '../apps/runtime/src/demo.js'

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.()
})

describe('demo seed', () => {
  it('creates a complete lifecycle demo with real workspace files', async () => {
    const store = new SqliteStore({ filePath: ':memory:' })
    const dataDir = mkdtempSync(join(tmpdir(), 'projectos-demo-'))
    cleanup.push(() => {
      store.close()
      rmSync(dataDir, { recursive: true, force: true })
    })
    const result = await seedDemo({ store, dataDir })
    expect(result.created).toBe(true)
    const project = store.read.getProject(result.projectId)
    expect(project?.isDemo).toBe(true)
    expect(project?.currentStage).toBe('implementation')
    expect(existsSync(join(project!.rootPath, 'README.md'))).toBe(true)
    expect(existsSync(join(project!.rootPath, 'src', 'graph.ts'))).toBe(true)
    expect(existsSync(join(project!.rootPath, 'docs', 'IDEAS.md'))).toBe(true)

    const stats = store.read.getProjectStats(result.projectId)
    expect(stats.tasksTotal).toBeGreaterThanOrEqual(13)
    expect(stats.tasksDone).toBeGreaterThan(0)
    expect(stats.activeRuns).toBe(1)
    expect(stats.pendingApprovals).toBe(1)
    expect(stats.artifacts).toBeGreaterThan(4)

    const collaboration = store.read.getCollaborationSnapshot(result.projectId)
    expect(collaboration.inbox.length).toBeGreaterThan(0)
    expect(collaboration.handoffs.length).toBeGreaterThan(0)
    expect(collaboration.agents.length).toBeGreaterThanOrEqual(5)

    const activity = store.read.getProjectActivity(result.projectId, 100)
    expect(activity.length).toBeGreaterThan(10)
    const span = activity[0]!.createdAt - activity[activity.length - 1]!.createdAt
    expect(span).toBeGreaterThan(24 * 60 * 60 * 1000)

    const git = await import('@projectos/workspace').then((workspace) =>
      workspace.getGitStatus(project!.rootPath),
    )
    expect(git?.changes.length).toBeGreaterThan(0)

    const second = await seedDemo({ store, dataDir })
    expect(second.created).toBe(false)
    expect(store.read.listProjects(true).filter((entry) => entry.isDemo)).toHaveLength(1)
  }, 60_000)
})
