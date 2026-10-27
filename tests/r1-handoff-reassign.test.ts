import { afterEach, describe, expect, it } from 'vitest'
import { now, type AgentDefinition } from '@projectos/contracts'
import { AgentStudioService } from '../apps/runtime/src/agent-studio.js'
import { FakeProvider, createGitProject, planWithTasks, setup, waitFor } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

const persona = {
  role: '测试接收方',
  background: '',
  responsibilities: '',
  principles: '',
  style: '',
  constraints: '',
  systemPrompt: 'Handle the handed-off task.',
}

function createCustomAgent(
  harness: ReturnType<typeof setup>,
  projectId: string,
  name: string,
  category: string,
): AgentDefinition {
  const studio = new AgentStudioService(harness.store)
  return studio.upsertAgent({
    name,
    role: name,
    description: '',
    category,
    avatar: '',
    visibility: 'project',
    persona,
    skillIds: [],
    runtimeProfileIds: [],
    primaryRuntimeProfileId: null,
    modelRef: null,
    permissions: { tools: [], files: false, shell: false, network: false },
    ownerProjectId: projectId,
  })
}

/**
 * Disable every Agent so the resolver has no legal candidate.
 *
 * Builtin Agents have no editable definition row (`getAgentDefinition` filters
 * `builtin = 0`), so the test flips that flag first; this only touches the
 * temporary test database and simulates "all Agents unavailable".
 */
function disableAllCandidateAgents(harness: ReturnType<typeof setup>): void {
  harness.store.db.exec('UPDATE agents SET builtin = 0')
  for (const agent of harness.store.read.listAgents()) {
    const existing = harness.store.read.getAgentDefinition(agent.id)
    // Always build a complete definition: flipping `builtin` makes the raw row
    // readable but it has no persona_json yet.
    harness.store.upsertAgentDefinition({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      description: agent.description,
      category: existing?.category ?? 'general',
      avatar: '',
      visibility: 'global',
      status: 'disabled',
      persona: { ...persona, systemPrompt: agent.systemPrompt || persona.systemPrompt },
      skills: existing?.skills ?? [],
      runtimeProfileIds: [],
      primaryRuntimeProfileId: null,
      modelRef: null,
      permissions: { tools: [], files: false, shell: false, network: false },
      currentVersion: (existing?.currentVersion ?? 0) + 1,
      createdAt: now(),
      updatedAt: now(),
    })
  }
}

interface HandoffScenario {
  receiverName?: string
  receiverCategory?: string
  riskLevel?: 'low' | 'medium' | 'high'
  explicit?: boolean
  /** Disable the receiver as soon as the Handoff is accepted. */
  disableReceiver?: boolean
  /** Disable every Agent synchronously with the receiver (no candidate left). */
  disableAllCandidates?: boolean
}

function scenarioProvider(receiverIdRef: { id: string }, options: HandoffScenario) {
  let handoffCreated = false
  return new FakeProvider((call) => {
    const system = String(call.messages[0]?.content ?? '')
    if (system.includes('R1D Receiver')) return { text: 'receiver must not run' }
    const isSource = system.includes('Iris')
    if (!isSource) {
      // Any legitimate substitute / confirmed Agent: produce real test evidence.
      if (!call.hasToolResult) {
        return {
          tool: {
            name: 'create_artifact',
            args: { title: '替代执行证据', kind: 'test-report', body: 'substitute test evidence' },
          },
        }
      }
      return { text: 'SUBSTITUTE-DONE' }
    }
    if (handoffCreated) {
      if (!call.hasToolResult) {
        return {
          tool: {
            name: 'create_artifact',
            args: { title: '测试证据', kind: 'test-report', body: 'real test evidence' },
          },
        }
      }
      return { text: 'IRIS-DONE' }
    }
    if (call.toolResults.length === 0) {
      return {
        tool: {
          name: 'create_artifact',
          args: { title: '测试报告', kind: 'test-report', body: 'pre-handoff evidence' },
        },
      }
    }
    if (call.toolResults.length === 1) {
      handoffCreated = true
      const artifactId = (() => {
        try {
          const parsed = JSON.parse(call.toolResults[0] ?? '{}') as Record<string, unknown>
          return typeof parsed.artifactId === 'string' ? parsed.artifactId : ''
        } catch {
          return ''
        }
      })()
      return {
        tool: {
          name: 'handoff_task',
          args: {
            toAgentId: receiverIdRef.id,
            summary: '请接收测试任务',
            completed: ['基础验证'],
            remaining: ['接收方继续'],
            risks: [],
            nextActions: ['继续执行'],
            riskLevel: options.riskLevel ?? 'low',
            artifactRefs: artifactId ? [artifactId] : [],
          },
        },
      }
    }
    return { text: 'IRIS-SOURCE-DONE' }
  })
}

async function startHandoffScenario(options: HandoffScenario = {}) {
  const receiverRef = { id: '' }
  const provider = scenarioProvider(receiverRef, options)
  const harness = setup(provider)
  cleanups.push(harness.close)
  const { store, services, runner, orchestration, scheduler, dataDir } = harness
  const project = await createGitProject(services, dataDir, `r1d-${Math.random().toString(36).slice(2, 8)}`)
  services.collaboration.setPolicy(project.id, 'auto')
  const receiver = createCustomAgent(
    harness,
    project.id,
    options.receiverName ?? 'R1D Receiver',
    options.receiverCategory ?? 'quality',
  )
  receiverRef.id = receiver.id
  if (options.receiverCategory === 'ops') {
    // keep the receiver name stable for provider routing
    receiverRef.id = receiver.id
  }
  const planned = planWithTasks(orchestration, project.id, [
    {
      key: 'impl',
      title: '交接任务',
      description: '测试交接失败后的安全替代',
      role: 'tester',
      agentId: options.explicit ? 'agt_qa' : null,
      assignmentReasons: options.explicit ? ['显式指定：用户已选择 Iris'] : ['自动分配'],
      assignmentBlocked: false,
      dependsOn: [],
      acceptanceCriteria: ['完成'],
      expectedArtifacts: [],
      requiresApproval: false,
    },
  ])
  await scheduler.start(planned.plan.id, 1, 0)
  // Wait for the auto-accepted Handoff, then break the receiver's availability
  // before the scheduler prepares the continuation.
  await waitFor(
    () => services.collaboration.listHandoffs(project.id).some((item) => item.status === 'accepted'),
    15_000,
    'handoff acceptance',
  )
  const handoff = services.collaboration.listHandoffs(project.id).find((item) => item.status === 'accepted')!
  if (options.disableReceiver !== false) {
    // Synchronous block: no Scheduler tick can interleave between the receiver
    // going away and the candidate set being cleared.
    new AgentStudioService(store).setStatus(receiver.id, 'disabled')
    if (options.disableAllCandidates) disableAllCandidateAgents(harness)
  }
  return { harness, project, planned, receiver, handoff, scheduler, store, runner }
}

function reassignmentOf(harness: ReturnType<typeof setup>, projectId: string, taskId: string) {
  const handoff = harness.services.collaboration
    .listHandoffs(projectId)
    .find((item) => item.taskId === taskId && item.status === 'accepted')
  return (handoff?.payload.reassignment ?? null) as Record<string, unknown> | null
}

describe('R1-D safe Handoff receiver fallback', () => {
  it('reassigns a low-risk handoff to a legal substitute and starts it via the scheduler', async () => {
    const { harness, project, planned, receiver, handoff, scheduler, store } = await startHandoffScenario({
      riskLevel: 'low',
    })
    await waitFor(
      () => store.read.getPlanRevision(planned.plan.id)?.execution?.status === 'completed',
      30_000,
      'plan with reassigned receiver to complete',
    ).catch((error: Error) => {
      const execution = store.read.getPlanRevision(planned.plan.id)?.execution
      const card = store.read.getTaskCard(planned.taskIds[0]!)
      throw new Error(`${error.message}; plan=${execution?.status}/${execution?.error}; task=${card?.status}`)
    })
    const task = store.read.getTask(planned.taskIds[0]!)
    expect(task?.status).toBe('done')
    expect(task?.assigneeAgentId).toBe('agt_qa')
    expect(task?.assigneeAgentId).not.toBe(receiver.id)

    const reassignment = reassignmentOf(harness, project.id, planned.taskIds[0]!)!
    expect(reassignment.status).toBe('applied')
    expect(reassignment.toAgentId).toBe('agt_qa')
    expect(reassignment.requiresConfirmation).toBe(false)
    expect(Array.isArray(reassignment.candidates)).toBe(true)

    const runs = store.read.listRunSummaries(project.id, 50).filter((run) => run.taskId === planned.taskIds[0])
    expect(runs).toHaveLength(2)
    expect(runs[0]?.status).toBe('completed')
    expect(runs[1]?.status).toBe('completed')
    expect(runs.some((run) => run.agentId === receiver.id)).toBe(false)
    const updatedHandoff = harness.services.collaboration.listHandoffs(project.id).find((item) => item.id === handoff.id)
    expect(updatedHandoff?.status).toBe('accepted')
    expect(updatedHandoff?.continuedAt).toBeTruthy()
    const sourceArtifact = store.read
      .listArtifacts(project.id)
      .find((artifact) => artifact.title === '测试报告')
    expect(sourceArtifact).toBeTruthy()
    expect(updatedHandoff?.artifactRefs.map((artifact) => artifact.id)).toContain(sourceArtifact!.id)
    const downstreamRun = runs.find((run) => run.agentId === 'agt_qa')
    expect(downstreamRun).toBeTruthy()
    const contextStep = store.read
      .getRunSteps(downstreamRun!.id)
      .find((step) => step.kind === 'context' && typeof step.payload.handoffId === 'string')
    expect(contextStep).toBeTruthy()
    expect(JSON.stringify(contextStep!.payload)).toContain(sourceArtifact!.id)
    console.log(
      `[handoff-structured] handoff=${updatedHandoff!.id} from=${updatedHandoff!.fromAgentId} ` +
        `to=${updatedHandoff!.toAgentId} artifact=${sourceArtifact!.id} downstreamRun=${downstreamRun!.id} ` +
        `artifactRefs=${updatedHandoff!.artifactRefs.length} contextStep=${contextStep!.id}`,
    )

    // Repeat tick / restart recovery must not duplicate the Run.
    const before = store.read.listRunSummaries(project.id, 50).filter((run) => run.taskId === planned.taskIds[0]).length
    scheduler.recover()
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const after = store.read.listRunSummaries(project.id, 50).filter((run) => run.taskId === planned.taskIds[0]).length
    expect(after).toBe(before)
    console.log(
      `[r1d-auto] handoff=${handoff.id} from=${handoff.fromAgentId} failedReceiver=${receiver.id} ` +
        `to=${String(reassignment.toAgentId)} runs=${runs.length} task=done`,
    )
  }, 60_000)

  it('blocks with an explicit reason when no legal substitute exists', async () => {
    const { harness, project, planned, receiver, store } = await startHandoffScenario({
      riskLevel: 'low',
      disableAllCandidates: true,
    })
    await waitFor(
      () => ['failed', 'paused'].includes(store.read.getPlanRevision(planned.plan.id)?.execution?.status ?? ''),
      20_000,
      'plan to settle without a candidate',
    ).catch((error: Error) => {
      const execution = store.read.getPlanRevision(planned.plan.id)?.execution
      const card = store.read.getTaskCard(planned.taskIds[0]!)
      throw new Error(
        `${error.message}; plan=${execution?.status}/${execution?.error}; task=${card?.status}; ` +
          `assignment=${JSON.stringify(reassignmentOf(harness, project.id, planned.taskIds[0]!))}`,
      )
    })
    const reassignment = reassignmentOf(harness, project.id, planned.taskIds[0]!)!
    expect(reassignment.status).toBe('none')
    expect(reassignment.requiresConfirmation).toBe(false)
    expect(store.read.getTask(planned.taskIds[0]!)?.status).toBe('blocked')
    const runs = store.read.listRunSummaries(store.read.getTask(planned.taskIds[0]!)!.projectId, 50)
    expect(runs.filter((run) => run.taskId === planned.taskIds[0]).every((run) => run.agentId !== receiver.id)).toBe(true)
    expect(store.read.getPlanRevision(planned.plan.id)?.execution?.error).toBeTruthy()
    console.log(`[r1d-none] status=${String(reassignment.status)} task=blocked runs=${runs.length}`)
  }, 60_000)

  it('never silently replaces an explicitly assigned Agent and applies it only after confirmation', async () => {
    const { harness, project, planned, store, scheduler, runner } = await startHandoffScenario({
      riskLevel: 'low',
      explicit: true,
    })
    await waitFor(
      () => reassignmentOf(harness, project.id, planned.taskIds[0]!)?.status === 'needs_confirmation',
      20_000,
      'reassignment proposal',
    )
    const proposal = reassignmentOf(harness, project.id, planned.taskIds[0]!)!
    expect(proposal.status).toBe('needs_confirmation')
    expect(proposal.explicitAssignment).toBe(true)
    expect(store.read.getTask(planned.taskIds[0]!)?.status).toBe('blocked')
    const runsBefore = store.read.listRunSummaries(project.id, 50).filter((run) => run.taskId === planned.taskIds[0])
    expect(runsBefore).toHaveLength(1)

    await waitFor(
      () => store.read.getPlanRevision(planned.plan.id)?.execution?.status === 'paused',
      15_000,
      'plan to pause for confirmation',
    )

    // A stale lease must block confirmation instead of silently switching Agents.
    const stale = store.acquireTaskLease(planned.taskIds[0]!, 'run:ghost', 60_000)
    expect(() => scheduler.confirmReassignment(planned.plan.id, planned.taskIds[0]!, 'agt_qa')).toThrowError(/租约/)
    store.releaseTaskLease(planned.taskIds[0]!, 'run:ghost', stale.token)

    const confirmed = scheduler.confirmReassignment(planned.plan.id, planned.taskIds[0]!, 'agt_qa')
    expect(confirmed.agentId).toBe('agt_qa')
    await waitFor(
      () => store.read.getPlanRevision(planned.plan.id)?.execution?.status === 'completed',
      30_000,
      'confirmed plan to complete',
    )
    expect(store.read.getTask(planned.taskIds[0]!)?.status).toBe('done')
    const confirmedPayload = reassignmentOf(harness, project.id, planned.taskIds[0]!)!
    expect(confirmedPayload.status).toBe('confirmed')
    const runsAfter = store.read.listRunSummaries(project.id, 50).filter((run) => run.taskId === planned.taskIds[0])
    expect(runsAfter.length).toBeGreaterThan(runsBefore.length)
    void runner
    console.log(
      `[r1d-explicit] proposal=${String(proposal.status)} confirmed=${String(confirmedPayload.status)} ` +
        `runs=${runsBefore.length}->${runsAfter.length}`,
    )
  }, 90_000)

  it('requires confirmation when the substitute would expand permissions', async () => {
    const { harness, project, planned, receiver, store } = await startHandoffScenario({
      riskLevel: 'low',
      receiverCategory: 'ops',
    })
    await waitFor(
      () => reassignmentOf(harness, project.id, planned.taskIds[0]!)?.status === 'needs_confirmation',
      20_000,
      'permission expansion proposal',
    )
    const proposal = reassignmentOf(harness, project.id, planned.taskIds[0]!)!
    expect(proposal.status).toBe('needs_confirmation')
    expect(String((proposal.reasons as string[]).join('；'))).toContain('权限更大')
    expect(store.read.getTask(planned.taskIds[0]!)?.assigneeAgentId).toBe(receiver.id)
    console.log(`[r1d-expansion] reasons=${JSON.stringify(proposal.reasons)}`)
  }, 60_000)

  it('rejects candidates from another project scope and reports why', async () => {
    const { harness, project, planned, store } = await startHandoffScenario({ riskLevel: 'low' })
    const otherProject = await createGitProject(harness.services, harness.dataDir, 'r1d-other-project')
    const hidden = createCustomAgent(harness, otherProject.id, 'R1D Hidden Agent', 'quality')
    await waitFor(
      () => store.read.getPlanRevision(planned.plan.id)?.execution?.status === 'completed',
      30_000,
      'plan to complete with a visible substitute',
    )
    const proposal = reassignmentOf(harness, project.id, planned.taskIds[0]!)!
    const rejected = (proposal.rejected ?? []) as Array<{ agentId: string; reasons: string[] }>
    expect(rejected.some((item) => item.agentId === hidden.id && item.reasons.join('；').includes('可见范围'))).toBe(true)
    const candidates = (proposal.candidates ?? []) as Array<{ agentId: string }>
    expect(candidates.some((item) => item.agentId === hidden.id)).toBe(false)
    console.log(`[r1d-invisible] hidden=${hidden.id} rejected=${rejected.length} candidates=${candidates.length}`)
  }, 60_000)
})
