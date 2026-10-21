import { describe, expect, it } from 'vitest'
import type { TaskCard } from '@projectos/contracts'
import { selectStartableTasks } from '../apps/runtime/src/orchestrator.js'

function card(id: string, agentId: string | null, priority = 2): TaskCard {
  return {
    id,
    projectId: 'prj_test',
    parentId: null,
    milestoneId: null,
    title: id,
    description: '',
    status: 'ready',
    priority,
    assigneeAgentId: agentId,
    assigneeName: null,
    acceptanceCriteria: ['done'],
    labels: [],
    version: 0,
    dueAt: null,
    dependencyIds: [],
    blockedBy: [],
    runCount: 0,
    artifactCount: 0,
    latestRunStatus: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('orchestrator start selection', () => {
  it('starts only one task per Agent and leaves the rest queued', () => {
    const ready = [card('a', 'agt_engineer'), card('b', 'agt_engineer')]
    expect(selectStartableTasks({ ready, activeAgentIds: [], slots: 2 }).map((task) => task.id)).toEqual(['a'])
  })

  it('keeps safe parallelism across different Agents', () => {
    const ready = [card('a', 'agt_architect'), card('b', 'agt_engineer')]
    expect(selectStartableTasks({ ready, activeAgentIds: [], slots: 2 }).map((task) => task.id)).toEqual(['a', 'b'])
  })

  it('skips Agents that already have a running task', () => {
    const ready = [card('a', 'agt_engineer'), card('b', 'agt_qa')]
    expect(selectStartableTasks({ ready, activeAgentIds: ['agt_engineer'], slots: 2 }).map((task) => task.id)).toEqual(['b'])
  })

  it('respects the concurrency slot count and skips unassigned tasks', () => {
    const ready = [card('a', 'agt_architect'), card('b', null), card('c', 'agt_qa')]
    expect(selectStartableTasks({ ready, activeAgentIds: [], slots: 1 }).map((task) => task.id)).toEqual(['a'])
    expect(selectStartableTasks({ ready, activeAgentIds: [], slots: 3 }).map((task) => task.id)).toEqual(['a', 'c'])
  })
})
