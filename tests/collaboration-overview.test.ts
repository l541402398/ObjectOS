import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CoreServices, type WorkspacePort } from '@projectos/application'
import { SqliteStore } from '@projectos/persistence'
import { ensureProjectRoot, getGitStatus, initGitRepository, readTextFile, readWorkspaceTree, writeTextFile } from '@projectos/workspace'

const workspace: WorkspacePort = {
  ensureProjectRoot,
  readWorkspaceTree,
  writeTextFile,
  readTextFile,
  getGitStatus,
  initGitRepository,
}

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.()
})

function setup(): { services: CoreServices; dataDir: string } {
  const store = new SqliteStore({ filePath: ':memory:' })
  const dataDir = mkdtempSync(join(tmpdir(), 'projectos-overview-'))
  const services = new CoreServices(store, workspace)
  cleanup.push(() => {
    store.close()
    rmSync(dataDir, { recursive: true, force: true })
  })
  return { services, dataDir }
}

describe('collaboration overview projection', () => {
  it('composes real agents, tasks, dependencies and handoffs without inventing a plan', async () => {
    const { services, dataDir } = setup()
    const project = await services.projects.create({
      name: 'overview-projection',
      description: '',
      rootPath: join(dataDir, 'overview-projection'),
      createDirectory: true,
      initGit: false,
    })

    const first = services.tasks.create({
      projectId: project.id,
      title: '梳理对象边界',
      description: '',
      priority: 2,
      acceptanceCriteria: ['边界清晰'],
      labels: [],
      assigneeAgentId: 'agt_architect',
      milestoneId: null,
      dependsOn: [],
      dueAt: null,
    })
    const second = services.tasks.create({
      projectId: project.id,
      title: '实现总览',
      description: '',
      priority: 2,
      acceptanceCriteria: ['可验收'],
      labels: [],
      assigneeAgentId: 'agt_engineer',
      milestoneId: null,
      dependsOn: [first.id],
      dueAt: null,
    })
    const session = services.sessions.create({ projectId: project.id, agentId: 'agt_architect', title: '架构会话' })
    services.collaboration.requestHandoff({
      taskId: first.id,
      toAgentId: 'agt_qa',
      summary: '边界已确认，请验证',
      sessionId: session.id,
      completed: ['对象关系'],
      remaining: ['Electron 验证'],
      risks: [],
      nextActions: ['启动验证'],
      riskLevel: 'low',
    })

    const overview = services.collaboration.overview(project.id)

    expect(overview.projectId).toBe(project.id)
    expect(overview.plan).toBeNull()
    expect(overview.tasks).toHaveLength(2)
    expect(overview.tasks.find((task) => task.id === second.id)?.dependencyIds).toEqual([first.id])
    expect(overview.metrics).toMatchObject({
      totalTasks: 2,
      doneTasks: 0,
      artifacts: 0,
      pendingApprovals: 0,
      pendingHandoffs: 1,
    })

    const architect = overview.agents.find((agent) => agent.id === 'agt_architect')
    expect(architect).toBeDefined()
    // Without an active Run the agent card must not claim a current task; assignment is still visible
    // on the task row itself. This is the difference between "assigned" and "executing".
    expect(architect?.taskId).toBeNull()
    expect(overview.tasks.find((task) => task.assigneeAgentId === 'agt_architect')?.id).toBe(first.id)
    expect(architect?.sessionCount).toBeGreaterThanOrEqual(1)

    expect(overview.handoffs).toHaveLength(1)
    expect(overview.handoffs[0]).toMatchObject({
      fromAgentId: 'agt_architect',
      toAgentId: 'agt_qa',
      taskId: first.id,
      status: 'requested',
      summary: '边界已确认，请验证',
    })
    expect(overview.activity.length).toBeGreaterThan(0)
    expect(overview.generatedAt).toBeGreaterThan(0)
  })
})
