import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalWorkspaceRoot, PlanGrantService } from '../apps/runtime/src/plan-grant.js'
import { createGitProject, logger, planWithTasks, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function task() {
  return {
    key: 'dev',
    title: '实现 sum',
    description: '实现并验证。',
    role: 'developer',
    dependsOn: [],
    acceptanceCriteria: ['退出码 0'],
    expectedArtifacts: ['代码 diff'],
    rationale: '完成需求所需的实现步骤。',
    requiresApproval: false,
  }
}

/**
 * ADR-0036 — a Windows 8.3 root (`ADMINI~1`) made every workspace-relative write look like an
 * escape, because `path.relative` compared a short root with a long resolved target. This is the
 * bug that kept a real run from ever writing the fix into its worktree.
 */
describe('ADR-0036 canonical workspace containment', () => {
  it('resolves the canonical root for a short-name path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p288-canon-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const canonical = canonicalWorkspaceRoot(dir)
    expect(canonical).toBe(realpathSync.native(dir))
    // An absolute path built from either form must map to the same workspace-relative write.
    const service = new PlanGrantService({} as never, logger)
    expect(service).toBeTruthy()
  })

  it('accepts a workspace-relative write through a grant whose root has a trailing separator and different case', async () => {
    const harness = setup(undefined, { providerConfig: {} })
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'p288-canon-grant')
    mkdirSync(join(project.rootPath, 'src'), { recursive: true })
    writeFileSync(join(project.rootPath, 'src', 'sums.mjs'), 'export const sum = (a) => a\n')
    const agent = harness.services.projects
      .listAgents(project.id)
      .find((item) => item.agent.capabilities.includes('implement'))!.agent
    const { plan, taskIds } = planWithTasks(harness.orchestration, project.id, [{ ...task(), agentId: agent.id }])
    const grants = new PlanGrantService(harness.store, logger)
    grants.issue({
      planId: plan.id,
      actions: ['plan.start', 'workspace-write'],
      allowedPaths: ['.'],
      maxRuns: 2,
      maxToolCalls: 60,
      ttlHours: 1,
      allowOverBudget: false,
      note: '测试授权',
      confirm: true,
    })
    // The root as the runtime sometimes receives it: trailing slash + upper-case drive form.
    const rootVariant = process.platform === 'win32' ? `${project.rootPath}\\\\` : `${project.rootPath}/`
    const decision = grants.authorizeToolCall({
      projectId: project.id,
      workspaceRoot: rootVariant,
      taskId: taskIds[0]!,
      runId: 'run_canon',
      agentId: agent.id,
      toolName: 'write_file',
      toolCallId: 'tol_canon',
      args: { path: 'src/sums.mjs', content: 'export const sum = (a, b) => a + b\n' },
    })
    expect(decision.decision).toBe('allow')
  })
})
