import { afterEach, describe, expect, it } from 'vitest'
import { now } from '@projectos/contracts'
import { ActionCenter } from '../apps/runtime/src/action-center.js'
import { goalStatusOf } from '../apps/runtime/src/goal-status.js'
import { LifecycleService } from '../apps/runtime/src/lifecycle.js'
import { PlanGrantService } from '../apps/runtime/src/plan-grant.js'
import { createGitProject, logger, planWithTasks, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function task(key: string) {
  return {
    key,
    title: `任务 ${key}`,
    description: `完成 ${key}`,
    role: 'tester',
    dependsOn: [],
    acceptanceCriteria: [],
    expectedArtifacts: ['测试报告'],
    rationale: 'fixture',
    requiresApproval: false,
  }
}

/**
 * ADR-0048 — the work center must not say "通过" just because a plan has an execution record.
 *
 * Phase 2.8.8 derived `passing` from `execution !== null && no failures`, which displayed a passing
 * verification for a plan nobody had verified. Each state below is asserted against persisted facts.
 */
describe('ADR-0048 goal verification states come from real evidence', () => {
  function recordRun(
    harness: ReturnType<typeof setup>,
    projectId: string,
    taskId: string,
    runId: string,
    at: number,
    sessionId: string,
    agentId: string,
  ) {
    harness.store.db
      .prepare(
        `INSERT INTO agent_runs (id, project_id, task_id, session_id, agent_id, attempt, status, error, summary,
           input_tokens, output_tokens, checkpoint_id, started_at, finished_at, deadline_at, budget_json, created_at)
         VALUES (?, ?, ?, ?, ?, 1, 'completed', NULL, NULL, 0, 0, NULL, ?, ?, 0, '{}', ?)`,
      )
      .run(runId, projectId, taskId, sessionId, agentId, at, at, at)
  }

  function recordCall(
    harness: ReturnType<typeof setup>,
    runId: string,
    at: number,
    input: { toolName: string; args: Record<string, unknown>; result: Record<string, unknown> },
  ) {
    harness.store.db
      .prepare(
        `INSERT INTO tool_calls (id, run_id, tool_name, idempotency_key, status, args_hash, args_json, result_json,
           error, created_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, 'completed', 'hash', ?, ?, NULL, ?, ?, ?)`,
      )
      .run(`tol_${runId}_${at}`, runId, input.toolName, `idem-${runId}-${at}`, JSON.stringify(input.args), JSON.stringify(input.result), at, at, at)
  }

  async function setupPlan() {
    const harness = setup(undefined, { providerConfig: {} })
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'p29-goal-status')
    const { plan, taskIds } = planWithTasks(harness.orchestration, project.id, [task('verify')])
    const revision = harness.store.read.getPlanRevision(plan.id)!
    harness.store.updatePlanRevision({
      ...revision,
      execution: {
        ...(revision.execution ?? {}),
        status: 'paused',
        concurrency: 1,
        startedAt: now(),
        updatedAt: now(),
        error: null,
        runIds: [],
        workspaceRef: project.rootPath,
        branch: 'projectos/plan-test',
        baseBranch: 'master',
        baseCommit: 'base',
        allowedPaths: ['.'],
        diffArtifactId: null,
        mergedAt: null,
        maxRetries: 1,
        retries: {},
        nextAttemptAt: {},
        retryForRun: {},
        maxEvidenceRetries: 1,
        evidenceRetries: {},
        deadlineAt: 0,
        budgetExhausted: null,
        maxWallClockMs: 0,
        deliveryStatus: 'none',
      },
      updatedAt: now(),
    } as never)
    const assignee = harness.store.read.getTaskCard(taskIds[0]!)?.assigneeAgentId ?? 'agt_qa'
    const session = harness.services.sessions.create({ projectId: project.id, agentId: assignee, title: 'p29-goal-fixture' })
    const actions = new ActionCenter(harness.store, new LifecycleService(harness.store))
    const grants = new PlanGrantService(harness.store, logger)
    return { harness, project, planId: plan.id, taskId: taskIds[0]!, sessionId: session.id, agentId: assignee, actions, grants }
  }

  it('reports unverified for a paused plan even though it has an execution record', async () => {
    const { harness, project, actions, grants } = await setupPlan()
    const view = goalStatusOf({ store: harness.store, actions, grants, projectId: project.id })
    expect(view.execution?.status).toBe('paused')
    expect(view.verification.state).toBe('unverified')
    expect(view.verification.evidence.trusted).toBe(false)
  })

  it('reports passed only after a real passing check, and stale once the code changes again', async () => {
    const { harness, project, planId, taskId, sessionId, agentId, actions, grants } = await setupPlan()
    const t = now()
    recordRun(harness, project.id, taskId, 'run_pass', t, sessionId, agentId)
    recordCall(harness, 'run_pass', t + 10, { toolName: 'run_tests', args: { command: 'npm test' }, result: { exitCode: 0 } })
    let view = goalStatusOf({ store: harness.store, actions, grants, projectId: project.id })
    expect(view.verification.state).toBe('passed')
    expect(view.verification.evidence.lastSuccess?.command).toBe('npm test')

    // A later write means the passing run tested older code.
    recordCall(harness, 'run_pass', t + 20, { toolName: 'write_file', args: { path: 'src/sums.mjs' }, result: { ok: true } })
    view = goalStatusOf({ store: harness.store, actions, grants, projectId: project.id })
    expect(view.verification.state).toBe('stale')
    expect(view.verification.detail).toContain('过期')
    expect(planId).toBeTruthy()
  })

  it('reports failed when the newest real check exited non-zero', async () => {
    const { harness, project, taskId, sessionId, agentId, actions, grants } = await setupPlan()
    const t = now()
    recordRun(harness, project.id, taskId, 'run_fail', t, sessionId, agentId)
    recordCall(harness, 'run_fail', t + 10, { toolName: 'run_tests', args: { command: 'npm test' }, result: { exitCode: 1 } })
    const view = goalStatusOf({ store: harness.store, actions, grants, projectId: project.id })
    expect(view.verification.state).toBe('failed')
    expect(view.verification.failing.join(' ')).toContain('exit 1')
  })
})
