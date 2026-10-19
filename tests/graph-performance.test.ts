import { describe, expect, it } from 'vitest'
import type { AgentView, TaskCard } from '@projectos/contracts'
import { buildGraphSnapshot } from '@projectos/graph-projection'

const agent: AgentView = {
  agent: {
    id: 'agt_engineer', name: 'Kai', role: '开发工程师', description: '', kind: 'builtin',
    driverId: 'native', capabilities: ['implement'], accent: '#34D399', systemPrompt: '',
    builtin: true, createdAt: 1,
  },
  status: 'working', sessionCount: 1, activeRunId: null,
  activeSessionId: null, completedRuns: 0,
}

function task(index: number): TaskCard {
  return {
    id: `tsk_perf${String(index).padStart(4, '0')}`,
    projectId: 'prj_perf',
    parentId: null,
    milestoneId: null,
    title: `Task ${index}`,
    description: '',
    status: index % 7 === 0 ? 'done' : index % 5 === 0 ? 'running' : 'backlog',
    priority: 2,
    assigneeAgentId: 'agt_engineer',
    assigneeName: 'Kai',
    acceptanceCriteria: ['works'],
    labels: [],
    version: 0,
    dueAt: null,
    dependencyIds: index === 0 ? [] : [`tsk_perf${String(index - 1).padStart(4, '0')}`],
    blockedBy: [],
    runCount: 0,
    artifactCount: 0,
    latestRunStatus: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('200-node graph projection', () => {
  it('projects 200 tasks under the latency budget', () => {
    const tasks = Array.from({ length: 200 }, (_, index) => task(index))
    const started = performance.now()
    const snapshot = buildGraphSnapshot({
      projectId: 'prj_perf',
      projectName: 'Perf',
      lastEventSeq: 200,
      agents: [agent],
      tasks,
      latestRuns: {},
      layout: null,
    })
    const duration = performance.now() - started
    expect(snapshot.nodes.length).toBe(202)
    expect(snapshot.edges.length).toBeGreaterThanOrEqual(399)
    expect(Object.keys(snapshot.positions).length).toBe(202)
    expect(duration).toBeLessThan(1_500)
  })
})

