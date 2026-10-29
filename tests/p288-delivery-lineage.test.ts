import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { now } from '@projectos/contracts'
import { buildLineageIndex, lineageRootOf, replanBudgetOf } from '../apps/runtime/src/plan-lineage.js'
import {
  baseCommitIsAncestor,
  mergeWouldConflict,
  recordedVerificationCommands,
  verifyAfterMerge,
} from '../apps/runtime/src/delivery-verifier.js'
import { createGitProject, logger, planWithTasks, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function task(key: string, overrides: Record<string, unknown> = {}) {
  return {
    key,
    title: `任务 ${key}`,
    description: `完成 ${key}。`,
    role: 'developer',
    dependsOn: [],
    acceptanceCriteria: ['退出码 0'],
    expectedArtifacts: ['代码 diff'],
    rationale: '完成需求所需的实现步骤。',
    requiresApproval: false,
    ...overrides,
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

describe('ADR-0029 revision budget belongs to the goal lineage', () => {
  it('derives the lineage root from the persisted plan chain', async () => {
    const harness = setup(undefined, { providerConfig: {} })
    const project = await createGitProject(harness.services, harness.dataDir, 'p288-lineage')
    const { plan: r1 } = planWithTasks(harness.orchestration, project.id, [task('dev')])
    // Build r1 -> r2 -> r3 by revising the plan (the same goal continues).
    const r2 = harness.orchestration.revisePlan({ planId: r1.id, tasks: [task('dev') as never] })
    const r3 = harness.orchestration.revisePlan({ planId: r2.id, tasks: [task('dev') as never] })
    const plans = harness.store.read.listAllPlanRevisions().filter((plan) => plan.projectId === project.id)
    const index = buildLineageIndex(plans)
    expect(lineageRootOf(index, r1.id)).toBe(r1.id)
    expect(lineageRootOf(index, r2.id)).toBe(r1.id)
    expect(lineageRootOf(index, r3.id)).toBe(r1.id)
    cleanups.push(harness.close)
  })

  it('counts policy revisions across the whole chain, regardless of age or event volume', async () => {
    const harness = setup(undefined, { providerConfig: {} })
    const project = await createGitProject(harness.services, harness.dataDir, 'p288-lineage-count')
    const { plan: r1 } = planWithTasks(harness.orchestration, project.id, [task('dev')])
    const r2 = harness.orchestration.revisePlan({ planId: r1.id, tasks: [task('dev') as never] })
    const r3 = harness.orchestration.revisePlan({ planId: r2.id, tasks: [task('dev') as never] })
    // Two policy applies in this lineage (r1->r2, r2->r3), one in an unrelated goal.
    harness.store.appendEvent(project.id, r1.id, 'plan.replan.applied', {
      authorizedBy: 'policy',
      appliedPlanId: r2.id,
      sourcePlanId: r1.id,
      lineageRoot: r1.id,
    })
    harness.store.appendEvent(project.id, r2.id, 'plan.replan.applied', {
      authorizedBy: 'policy',
      appliedPlanId: r3.id,
      sourcePlanId: r2.id,
      lineageRoot: r1.id,
    })
    const other = planWithTasks(harness.orchestration, project.id, [task('other')])
    harness.store.appendEvent(project.id, other.plan.id, 'plan.replan.applied', {
      authorizedBy: 'policy',
      appliedPlanId: other.plan.id,
      sourcePlanId: other.plan.id,
      lineageRoot: other.plan.id,
    })
    // Age the events by a year and flood the project with unrelated events.
    harness.store.db.prepare('UPDATE project_events SET created_at = ? WHERE event_type = ?').run(
      Date.now() - 365 * 24 * 60 * 60 * 1000,
      'plan.replan.applied',
    )
    for (let index = 0; index < 800; index += 1) {
      harness.store.appendEvent(project.id, r3.id, 'task.moved', { taskId: `tsk_${index}` })
    }
    const plans = harness.store.read.listAllPlanRevisions().filter((plan) => plan.projectId === project.id)
    const budget = replanBudgetOf({ store: harness.store, projectId: project.id, plans, planId: r3.id, limit: 3 })
    expect(budget.lineageRoot).toBe(r1.id)
    expect(budget.used).toBe(2)
    expect(budget.remaining).toBe(1)
    // The unrelated goal has its own quota.
    const otherBudget = replanBudgetOf({
      store: harness.store,
      projectId: project.id,
      plans,
      planId: other.plan.id,
      limit: 3,
    })
    expect(otherBudget.used).toBe(1)
    cleanups.push(harness.close)
  })
})

describe('ADR-0030 delivery preconditions and post-merge verification', () => {
  it('re-runs only the verification commands that really passed', async () => {
    const harness = setup(undefined, { providerConfig: {} })
    const project = await createGitProject(harness.services, harness.dataDir, 'p288-delivery-cmds')
    const { plan, taskIds } = planWithTasks(harness.orchestration, project.id, [task('dev')])
    const agent = harness.services.projects.listAgents(project.id)[0]!.agent
    const session = harness.services.sessions.create({ projectId: project.id, agentId: agent.id, title: 'cmds' })
    const run = harness.store.createRun({
      id: 'run_p288_cmds',
      projectId: project.id,
      taskId: taskIds[0]!,
      sessionId: session.id,
      agentId: agent.id,
      attempt: 1,
      status: 'completed',
      error: null,
      summary: null,
      inputTokens: 0,
      outputTokens: 0,
      checkpointId: null,
      startedAt: now(),
      finishedAt: now(),
      createdAt: now(),
    })
    const record = (key: string, command: string, exitCode: number): void => {
      const call = harness.store.createToolCall({
        runId: run.id,
        toolName: 'run_tests',
        idempotencyKey: key,
        argsHash: key,
        args: { command },
        status: 'completed',
      })
      harness.store.updateToolCall(call.id, { status: 'completed', result: { exitCode }, finishedAt: now() })
    }
    record('pass-1', 'npm test', 0)
    record('fail-1', 'node --test tests/broken.test.mjs', 1)
    record('not-verification', 'git status --porcelain', 0)
    const commands = recordedVerificationCommands(harness.store, plan)
    expect(commands).toContain('npm test')
    expect(commands).not.toContain('node --test tests/broken.test.mjs')
    expect(commands).not.toContain('git status --porcelain')
    cleanups.push(harness.close)
  })

  it('reports the real result of the post-merge verification commands', async () => {
    const harness = setup(undefined, { providerConfig: {} })
    const project = await createGitProject(harness.services, harness.dataDir, 'p288-delivery-verify')
    const passing = await verifyAfterMerge({
      rootPath: project.rootPath,
      commands: ['node -e "process.exit(0)"'],
      timeoutMs: 30_000,
    })
    expect(passing.passed).toBe(true)
    expect(passing.checks[0]?.exitCode).toBe(0)
    const failing = await verifyAfterMerge({
      rootPath: project.rootPath,
      commands: ['node -e "process.exit(3)"'],
      timeoutMs: 30_000,
    })
    expect(failing.passed).toBe(false)
    expect(failing.checks[0]?.exitCode).toBe(3)
    const none = await verifyAfterMerge({ rootPath: project.rootPath, commands: [] })
    expect(none.notApplicable).toBe(true)
    expect(none.passed).toBe(false)
    cleanups.push(harness.close)
  })

  it('detects conflicts and rewritten history before merging', async () => {
    const harness = setup(undefined, { providerConfig: {} })
    const project = await createGitProject(harness.services, harness.dataDir, 'p288-delivery-conflict')
    const root = project.rootPath
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.mjs'), 'base\n')
    git(root, ['add', '-A'])
    git(root, ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', 'commit', '-qm', 'base'])
    const base = git(root, ['rev-parse', 'HEAD'])

    // A clean branch: must be mergeable.
    git(root, ['branch', 'clean-branch'])
    expect(mergeWouldConflict(root, 'clean-branch').clean).toBe(true)

    // A conflicting branch: same file, different content.
    git(root, ['checkout', '-q', '-b', 'conflict-branch'])
    writeFileSync(join(root, 'src', 'a.mjs'), 'branch change\n')
    git(root, ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', 'commit', '-qam', 'branch'])
    git(root, ['checkout', '-q', '-'])
    writeFileSync(join(root, 'src', 'a.mjs'), 'main change\n')
    git(root, ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', 'commit', '-qam', 'main'])
    const conflict = mergeWouldConflict(root, 'conflict-branch')
    expect(conflict.clean).toBe(false)
    expect(conflict.detail).toContain('冲突')

    // History relationship: the recorded base is an ancestor now, and stops being one after a
    // history rewrite.
    expect(baseCommitIsAncestor(root, base)).toBe(true)
    git(root, ['checkout', '-q', '--orphan', 'rewritten'])
    git(root, ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', 'commit', '-qm', 'orphan'])
    expect(baseCommitIsAncestor(root, base)).toBe(false)
    cleanups.push(harness.close)
  })
})
