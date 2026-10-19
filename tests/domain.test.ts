import { describe, expect, it } from 'vitest'
import {
  assertRunTransition,
  assertStageAdvanceAllowed,
  assertTaskTransition,
  checkTaskCompletion,
  evaluateStageGates,
  wouldCreateCycle,
} from '@projectos/domain'
import type { ProjectStage, StageKey, TaskDependency } from '@projectos/contracts'

function stage(stageKey: StageKey, status: ProjectStage['status']): ProjectStage {
  return { projectId: 'prj_test', stage: stageKey, status, position: 0, updatedAt: 0 }
}

describe('task state machine', () => {
  it('allows the documented forward flow', () => {
    expect(() => assertTaskTransition('backlog', 'ready')).not.toThrow()
    expect(() => assertTaskTransition('ready', 'running')).not.toThrow()
    expect(() => assertTaskTransition('running', 'review')).not.toThrow()
    expect(() => assertTaskTransition('review', 'done')).not.toThrow()
  })

  it('rejects illegal jumps', () => {
    expect(() => assertTaskTransition('backlog', 'done')).toThrow()
    expect(() => assertTaskTransition('done', 'running')).toThrow()
    expect(() => assertTaskTransition('cancelled', 'running')).toThrow()
  })
})

describe('run state machine', () => {
  it('allows approval pauses and terminal states', () => {
    expect(() => assertRunTransition('running', 'waiting_approval')).not.toThrow()
    expect(() => assertRunTransition('waiting_approval', 'running')).not.toThrow()
    expect(() => assertRunTransition('running', 'completed')).not.toThrow()
    expect(() => assertRunTransition('completed', 'running')).toThrow()
  })
})

describe('task dependency graph', () => {
  const edges: TaskDependency[] = [
    { taskId: 'b', dependsOnId: 'a' },
    { taskId: 'c', dependsOnId: 'b' },
  ]

  it('detects a new edge that closes a cycle', () => {
    expect(wouldCreateCycle(edges, 'a', 'c')).toBe(true)
    expect(wouldCreateCycle(edges, 'd', 'c')).toBe(false)
  })

  it('rejects self dependency', () => {
    expect(wouldCreateCycle(edges, 'a', 'a')).toBe(true)
  })
})

describe('completion invariants', () => {
  it('requires acceptance criteria and completed dependencies', () => {
    const result = checkTaskCompletion({
      task: { status: 'review', title: 'Task', acceptanceCriteria: [] },
      dependencies: [{ id: 'a', title: 'Dep', status: 'running' }],
    })
    expect(result.ok).toBe(false)
    expect(result.blockers.join(' ')).toContain('缺少验收标准')
    expect(result.blockers.join(' ')).toContain('尚未完成')
  })

  it('passes when criteria exist and dependencies are done', () => {
    const result = checkTaskCompletion({
      task: { status: 'review', title: 'Task', acceptanceCriteria: ['works'] },
      dependencies: [{ id: 'a', title: 'Dep', status: 'done' }],
    })
    expect(result.ok).toBe(true)
  })
})

describe('lifecycle gates', () => {
  it('blocks requirements until a requirement is approved', () => {
    const stages = [
      stage('ideation', 'completed'),
      stage('requirements', 'active'),
      stage('architecture', 'pending'),
      stage('planning', 'pending'),
      stage('implementation', 'pending'),
      stage('testing', 'pending'),
      stage('release', 'pending'),
      stage('maintenance', 'pending'),
    ]
    const gates = evaluateStageGates(stages, {
      approvedRequirements: 0,
      acceptedDecisions: 0,
      milestones: 0,
      readyTasks: 0,
      reviewOrDoneTasks: 0,
      verifiedArtifacts: 0,
      releaseArtifacts: 0,
    })
    const architecture = gates.find((gate) => gate.stage === 'architecture')
    expect(architecture?.ready).toBe(false)
    expect(() => assertStageAdvanceAllowed(gates, 'architecture')).toThrow()
    const requirements = gates.find((gate) => gate.stage === 'requirements')
    expect(requirements?.ready).toBe(false)
  })

  it('allows advancing when signals are present', () => {
    const stages = [
      stage('ideation', 'completed'),
      stage('requirements', 'active'),
      stage('architecture', 'pending'),
      stage('planning', 'pending'),
      stage('implementation', 'pending'),
      stage('testing', 'pending'),
      stage('release', 'pending'),
      stage('maintenance', 'pending'),
    ]
    const gates = evaluateStageGates(stages, {
      approvedRequirements: 2,
      acceptedDecisions: 1,
      milestones: 1,
      readyTasks: 3,
      reviewOrDoneTasks: 1,
      verifiedArtifacts: 1,
      releaseArtifacts: 0,
    })
    expect(() => assertStageAdvanceAllowed(gates, 'testing')).not.toThrow()
    expect(() => assertStageAdvanceAllowed(gates, 'maintenance')).toThrow()
  })
})
