import { describe, expect, it } from 'vitest'
import type { ApprovalView, Artifact, CollaborationOverviewAgent, HandoffView, TaskCard } from '@projectos/contracts'
import { projectCollaborationFocus } from '../apps/desktop/src/renderer/src/features/collaboration-overview/focus-projection'

function agent(id: string, overrides: Partial<CollaborationOverviewAgent> = {}): CollaborationOverviewAgent {
  return {
    id,
    name: id,
    role: 'developer',
    accent: '#000000',
    status: 'idle',
    activeRunId: null,
    activeSessionId: null,
    runStatus: null,
    taskId: null,
    taskTitle: null,
    taskStatus: null,
    pendingApprovals: 0,
    completedRuns: 0,
    sessionCount: 0,
    lastActivityAt: null,
    ...overrides,
  }
}

function task(id: string, overrides: Partial<TaskCard> = {}): TaskCard {
  return {
    id,
    projectId: 'prj',
    title: id,
    description: '',
    status: 'running',
    priority: 2,
    assigneeAgentId: null,
    assigneeName: null,
    labels: [],
    acceptanceCriteria: [],
    expectedArtifacts: [],
    dependencyIds: [],
    blockedBy: [],
    artifactCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as TaskCard
}

describe('collaboration focus projection', () => {
  it('keeps working/assigned/handoff agents and removes idle agents from layout', () => {
    const tasks = [task('t1'), task('t2'), task('t3', { dependencyIds: ['t2'] })]
    const agents = [
      agent('a1', { status: 'working', taskId: 't1', runStatus: 'running', activeRunId: 'r1' }),
      agent('a2', { status: 'working', taskId: 't2', runStatus: 'running', activeRunId: 'r2' }),
      agent('a3', { taskId: null }),
      agent('a4'),
      agent('a5', { pendingApprovals: 1 }),
    ]
    const handoffs = [{
      id: 'h1', taskId: 't1', fromAgentId: 'a1', toAgentId: 'a3', fromAgentName: 'a1', toAgentName: 'a3',
      status: 'requested', summary: '', completed: [], remaining: [],
    }] as unknown as HandoffView[]
    const projection = projectCollaborationFocus({
      agents,
      tasks,
      artifacts: [] as Artifact[],
      approvals: [] as ApprovalView[],
      handoffs,
      plan: { taskIds: ['t1', 't2'] } as never,
    })
    expect(projection.primaryAgents.map((item) => item.id).sort()).toEqual(['a1', 'a2', 'a3', 'a5'])
    expect(projection.standbyAgents.map((item) => item.id)).toEqual(['a4'])
    expect(projection.primaryTasks.map((item) => item.id).sort()).toEqual(['t1', 't2', 't3'])
    expect(projection.primaryHandoffs).toHaveLength(1)
    expect(projection.hasFocus).toBe(true)
  })

  it('does not invent focus when no plan/task/run exists', () => {
    const projection = projectCollaborationFocus({
      agents: [agent('a1'), agent('a2')],
      tasks: [],
      artifacts: [],
      approvals: [],
      handoffs: [],
      plan: null,
    })
    expect(projection.primaryAgents).toEqual([])
    expect(projection.primaryTasks).toEqual([])
    expect(projection.standbyAgents).toHaveLength(2)
    expect(projection.hasFocus).toBe(false)
  })
})
