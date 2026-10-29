import { afterEach, describe, expect, it } from 'vitest'
import { classifyGrantedCommand } from '@projectos/application'
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
    role: 'developer',
    dependsOn: [],
    acceptanceCriteria: ['完成'],
    expectedArtifacts: ['代码 diff'],
    rationale: 'fixture',
    requiresApproval: false,
  }
}

/**
 * ADR-0056 — the user had to approve every single `node --test` / `node --version` / `git status`
 * because a grant only covered writes. `run-tests` authorizes exactly those commands, nothing else.
 */
describe('ADR-0056 run-tests grant action', () => {
  it('classifies test runners and read-only inspections as allowed, and everything else as not', () => {
    for (const command of [
      'node --test',
      'node --test test/hello.test.js',
      'node --version',
      'npm test',
      'npm run test:unit',
      'pnpm test',
      'npx vitest run',
      'git status',
      'git diff --stat',
      'git log --oneline -5',
    ]) {
      expect(classifyGrantedCommand(command).allowed, command).toBe(true)
    }
    for (const command of [
      'node -e "require(\'fs\').writeFileSync(\'x\',\'1\')"',
      'node -p "process.cwd()"',
      'rm -rf .',
      'curl https://example.com',
      'npm install left-pad',
      'git commit -m x',
      'node --test && rm -rf .',
      'cat /etc/passwd',
      'node --test | tee out.txt',
    ]) {
      expect(classifyGrantedCommand(command).allowed, command).toBe(false)
    }
  })

  it('allows allowlisted commands only when the grant carries run-tests', async () => {
    const harness = setup(undefined, { providerConfig: {} })
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'p29-run-tests')
    const grants = new PlanGrantService(harness.store, logger)
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('impl')])
    const approved = harness.store.read.getPlanRevision(plan.id)!
    const agentId = harness.store.read.listAgents()[0]!.id

    grants.issue({
      planId: plan.id,
      actions: ['plan.start', 'run-tests'],
      allowedPaths: [],
      maxRuns: 1,
      maxToolCalls: 40,
      ttlHours: 1,
      allowOverBudget: false,
      note: 'fixture run-tests',
      confirm: true,
    })

    const decide = (command: string) =>
      grants.authorizeToolCall({
        projectId: project.id,
        workspaceRoot: project.rootPath,
        taskId: approved.createdTaskIds[0] ?? null,
        runId: 'run_fixture',
        agentId,
        toolName: 'run_command',
        toolCallId: 'tol_fixture',
        args: { command },
      })

    expect(decide('node --test test/hello.test.js').decision).toBe('allow')
    expect(decide('git status').decision).toBe('allow')
    expect(decide('node -e "process.exit(1)"').decision).toBe('approval')
    expect(decide('rm -rf .').decision).toBe('approval')
  })

  it('does not broaden anything without the action', async () => {
    const harness = setup(undefined, { providerConfig: {} })
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'p29-run-tests-off')
    const grants = new PlanGrantService(harness.store, logger)
    const { plan } = planWithTasks(harness.orchestration, project.id, [task('impl')])
    const approved = harness.store.read.getPlanRevision(plan.id)!
    const agentId = harness.store.read.listAgents()[0]!.id
    grants.issue({
      planId: plan.id,
      actions: ['plan.start'],
      allowedPaths: [],
      maxRuns: 1,
      maxToolCalls: 40,
      ttlHours: 1,
      allowOverBudget: false,
      note: 'fixture no run-tests',
      confirm: true,
    })
    const decision = grants.authorizeToolCall({
      projectId: project.id,
      workspaceRoot: project.rootPath,
      taskId: approved.createdTaskIds[0] ?? null,
      runId: 'run_fixture',
      agentId,
      toolName: 'run_command',
      toolCallId: 'tol_fixture',
      args: { command: 'node --test' },
    })
    expect(decision.decision).toBe('approval')
  })
})
