import { describe, expect, it } from 'vitest'
import { newId, now, STAGE_KEYS, type Project, type ProjectStage } from '@projectos/contracts'
import { SqliteStore } from '@projectos/persistence'
import { buildEnvelope } from '@projectos/collaboration'

function createStore(): SqliteStore {
  return new SqliteStore({ filePath: ':memory:' })
}

function seedProject(store: SqliteStore): Project {
  const projectId = newId('prj')
  const timestamp = now()
  const project: Project = {
    id: projectId,
    name: 'Persistence Test',
    description: '',
    rootPath: 'C:\\tmp\\projectos-test',
    status: 'active',
    currentStage: 'ideation',
    version: 0,
    isDemo: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const stages: ProjectStage[] = STAGE_KEYS.map((stage, index) => ({
    projectId,
    stage,
    status: index === 0 ? 'active' : 'pending',
    position: index,
    updatedAt: timestamp,
  }))
  store.transaction(() => {
    store.createProject(project, stages)
    store.appendEvent(projectId, projectId, 'project.created', { title: project.name })
  })
  return project
}

function seedSessions(store: SqliteStore, project: Project) {
  const timestamp = now()
  const sessionA = store.createSession({
    id: newId('ses'),
    projectId: project.id,
    agentId: 'agt_product',
    title: 'Product session',
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  const sessionB = store.createSession({
    id: newId('ses'),
    projectId: project.id,
    agentId: 'agt_engineer',
    title: 'Engineer session',
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  return { sessionA, sessionB }
}

describe('SqliteStore', () => {
  it('runs migrations, persists a project, and emits committed events', () => {
    const events: string[] = []
    const store = new SqliteStore({
      filePath: ':memory:',
      onEvents: (committed) => events.push(...committed.map((event) => event.eventType)),
    })
    expect(store.listAgents().length).toBeGreaterThanOrEqual(5)
    const project = seedProject(store)
    expect(store.read.getProject(project.id)?.name).toBe('Persistence Test')
    expect(store.read.getStages(project.id)).toHaveLength(STAGE_KEYS.length)
    expect(events).toContain('project.created')
    expect(store.listPendingOutbox()).toHaveLength(0)
    store.close()
  })

  it('enforces optimistic concurrency on task updates', () => {
    const store = createStore()
    const project = seedProject(store)
    const timestamp = now()
    const task = store.createTask(
      {
        id: newId('tsk'),
        projectId: project.id,
        parentId: null,
        milestoneId: null,
        title: 'Task',
        description: '',
        status: 'backlog',
        priority: 3,
        assigneeAgentId: null,
        acceptanceCriteria: ['Acceptance'],
        labels: [],
        version: 0,
        dueAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      [],
    )
    const updated = store.updateTask(task.id, 0, { title: 'Updated' })
    expect(updated.version).toBe(1)
    expect(() => store.updateTask(task.id, 0, { title: 'Stale' })).toThrow(/刷新/)
    store.close()
  })

  it('deduplicates cross-session messages by idempotency key', () => {
    const store = createStore()
    const project = seedProject(store)
    const { sessionA, sessionB } = seedSessions(store, project)
    const envelope = buildEnvelope({
      projectId: project.id,
      sender: { agentId: sessionA.agentId, sessionId: sessionA.id },
      recipient: { agentId: sessionB.agentId, sessionId: sessionB.id },
      type: 'agent.message',
      body: 'Please review',
    })
    const first = store.transaction(() =>
      store.insertInboxWithMessage({
        projectId: project.id,
        envelope,
        recipientAgentId: sessionB.agentId,
        recipientSessionId: sessionB.id,
      }),
    )
    const second = store.transaction(() =>
      store.insertInboxWithMessage({
        projectId: project.id,
        envelope,
        recipientAgentId: sessionB.agentId,
        recipientSessionId: sessionB.id,
      }),
    )
    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(store.read.listInbox(project.id)).toHaveLength(1)
    expect(store.read.getMessages(sessionB.id)).toHaveLength(1)
    store.close()
  })

  it('rolls back all writes when a transaction fails', () => {
    const store = createStore()
    const project = seedProject(store)
    expect(() =>
      store.transaction(() => {
        store.appendEvent(project.id, project.id, 'test.rollback', {})
        throw new Error('boom')
      }),
    ).toThrow('boom')
    const events = store.read.listEventViews(project.id)
    expect(events.some((event) => event.eventType === 'test.rollback')).toBe(false)
    expect(store.getProjectEventCount(project.id)).toBe(1)
    store.close()
  })

  it('fences task leases with monotonic tokens', () => {
    const store = createStore()
    const project = seedProject(store)
    const timestamp = now()
    const task = store.createTask(
      {
        id: newId('tsk'),
        projectId: project.id,
        parentId: null,
        milestoneId: null,
        title: 'Lease task',
        description: '',
        status: 'ready',
        priority: 2,
        assigneeAgentId: 'agt_engineer',
        acceptanceCriteria: ['works'],
        labels: [],
        version: 0,
        dueAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      [],
    )
    const first = store.acquireTaskLease(task.id, 'holder-1', 60_000)
    expect(first.token).toBe(1)
    expect(() => store.acquireTaskLease(task.id, 'holder-2', 60_000)).toThrow(/租约/)
    expect(() => store.renewTaskLease(task.id, 'holder-2', first.token, 60_000)).toThrow(/租约/)
    store.releaseTaskLease(task.id, 'holder-1', first.token)
    const second = store.acquireTaskLease(task.id, 'holder-2', 60_000)
    expect(second.token).toBe(2)
    store.releaseTaskLease(task.id, 'holder-2', second.token)
    const expired = store.acquireTaskLease(task.id, 'holder-3', -1)
    expect(expired.token).toBe(3)
    const third = store.acquireTaskLease(task.id, 'holder-4', 60_000)
    expect(third.token).toBe(4)
    store.close()
  })
})
