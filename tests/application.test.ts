import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureProjectRoot,
  getGitStatus,
  initGitRepository,
  readTextFile,
  readWorkspaceTree,
  writeTextFile,
} from '@projectos/workspace'
import type { WorkspacePort } from '@projectos/application'
import { CoreServices } from '@projectos/application'
import { SqliteStore } from '@projectos/persistence'
import type { CreateTaskInput } from '@projectos/contracts'

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

function makeServices() {
  const store = new SqliteStore({ filePath: ':memory:' })
  const dir = mkdtempSync(join(tmpdir(), 'projectos-app-'))
  cleanup.push(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return { store, dir, services: new CoreServices(store, workspace) }
}

async function createProject(services: CoreServices, dir: string) {
  return services.projects.create({
    name: 'Application Test',
    description: 'Testing lifecycle services',
    rootPath: join(dir, 'project'),
    createDirectory: true,
    initGit: false,
  })
}

function taskInput(projectId: string, title: string, acceptance: string[], dependsOn: string[] = []): CreateTaskInput {
  return {
    projectId,
    title,
    description: 'Test task',
    priority: 2,
    acceptanceCriteria: acceptance,
    labels: ['test'],
    assigneeAgentId: 'agt_engineer',
    milestoneId: null,
    dependsOn,
    dueAt: null,
  }
}

describe('application services', () => {
  it('creates a local project with starter files and a lead session', async () => {
    const { services, store, dir } = makeServices()
    const project = await createProject(services, dir)
    expect(store.read.getStages(project.id)).toHaveLength(8)
    expect(readTextFile(project.rootPath, 'README.md').content).toContain('Application Test')
    expect(readTextFile(project.rootPath, 'AGENTS.md').content).toContain('ProjectOS')
    const sessions = services.sessions.list(project.id)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.agentName).toBe('Avery')
    expect(store.read.getProjectActivity(project.id).length).toBeGreaterThan(0)
  })

  it('enforces acceptance criteria, dependencies, and cycles', async () => {
    const { services, dir } = makeServices()
    const project = await createProject(services, dir)
    const first = services.tasks.create(taskInput(project.id, 'First', ['first works']))
    for (const to of ['ready', 'running', 'review', 'done'] as const) {
      const latest = services.tasks.detail(first.id).task
      services.tasks.move({ taskId: first.id, to, expectedVersion: latest.version })
    }
    const done = services.tasks.detail(first.id)
    expect(done.task.status).toBe('done')
    expect(done.artifacts.length).toBeGreaterThan(0)

    const second = services.tasks.create(taskInput(project.id, 'Second', ['second works'], [first.id]))
    expect(second.blockedBy).toHaveLength(0)
    expect(() => services.tasks.addDependency(first.id, second.id)).toThrow(/环形/)
    expect(() => services.tasks.addDependency(second.id, second.id)).toThrow(/自身/)
    services.tasks.removeDependency(first.id, second.id)
  })

  it('blocks completion without acceptance criteria', async () => {
    const { services, dir } = makeServices()
    const project = await createProject(services, dir)
    const task = services.tasks.create(taskInput(project.id, 'No criteria', []))
    for (const to of ['ready', 'running', 'review'] as const) {
      const latest = services.tasks.detail(task.id).task
      services.tasks.move({ taskId: task.id, to, expectedVersion: latest.version })
    }
    const latest = services.tasks.detail(task.id).task
    expect(() => services.tasks.move({ taskId: task.id, to: 'done', expectedVersion: latest.version })).toThrow(
      /验收标准/,
    )
  })

  it('advances lifecycle stages only when gates are satisfied', async () => {
    const { services, dir } = makeServices()
    const project = await createProject(services, dir)
    await expect(services.projects.advanceStage(project.id)).rejects.toThrow(/阶段守卫/)
    services.projects.createRequirement({
      projectId: project.id,
      title: 'R1',
      body: 'body',
      acceptanceCriteria: ['works'],
      source: 'test',
    })
    const requirement = services.projects.requirements(project.id)[0]!
    services.projects.setRequirementStatus(requirement.id, 'approved')
    const advanced = await services.projects.advanceStage(project.id)
    expect(advanced.currentStage).toBe('requirements')
    await expect(services.projects.advanceStage(project.id)).rejects.toThrow(/阶段守卫/)
    services.projects.createDecision({
      projectId: project.id,
      title: 'ADR',
      body: 'decision',
      status: 'accepted',
    })
    const architecture = await services.projects.advanceStage(project.id)
    expect(architecture.currentStage).toBe('architecture')
  })

  it('persists cross-session delivery and handoff acceptance', async () => {
    const { services, store, dir } = makeServices()
    const project = await createProject(services, dir)
    const productSession = services.sessions.list(project.id)[0]!
    const engineerSession = services.sessions.create({
      projectId: project.id,
      agentId: 'agt_engineer',
      title: 'Engineer',
    })
    const task = services.tasks.create(taskInput(project.id, 'Handoff task', ['works']))
    const sent = services.collaboration.send({
      projectId: project.id,
      fromSessionId: productSession.id,
      toSessionId: engineerSession.id,
      type: 'task.delegate',
      body: 'Please implement this task',
      taskId: task.id,
      wake: false,
    })
    expect(sent.created).toBe(true)
    expect(sent.inbox.status).toBe('delivered')
    const acked = services.collaboration.ack(sent.inbox.id)
    expect(acked.status).toBe('accepted')
    expect(store.read.getMessages(engineerSession.id).length).toBeGreaterThan(0)

    const handoff = services.collaboration.requestHandoff({
      taskId: task.id,
      toAgentId: 'agt_qa',
      summary: 'Ready for acceptance testing',
      sessionId: engineerSession.id,
    })
    expect(handoff.status).toBe('requested')
    const accepted = services.collaboration.acceptHandoff(handoff.id)
    expect(accepted.handoff.status).toBe('accepted')
    expect(store.read.getTask(task.id)?.assigneeAgentId).toBe('agt_qa')
    expect(store.read.getSession(accepted.sessionId)?.agentId).toBe('agt_qa')
  })

  it('supersedes an old decision when a replacement is created', async () => {
    const { services, store, dir } = makeServices()
    const project = await createProject(services, dir)
    const old = services.projects.createDecision({
      projectId: project.id,
      title: 'Old ADR',
      body: 'Old choice',
      status: 'accepted',
    })
    const replacement = services.projects.createDecision({
      projectId: project.id,
      title: 'New ADR',
      body: 'New choice',
      status: 'accepted',
      supersedesId: old.id,
    })
    expect(replacement.supersedesId).toBe(old.id)
    expect(store.read.getDecision(old.id)?.status).toBe('superseded')
    expect(store.read.listDecisions(project.id).find((decision) => decision.id === replacement.id)?.status).toBe('accepted')
  })
})

