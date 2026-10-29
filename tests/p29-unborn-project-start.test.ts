import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeProvider, setup, waitFor } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function unbornProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'p29-project-unborn-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'README.md'), '# 演示系统\n')
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const x = 1\n')
  return dir
}

/**
 * ADR-0050 regression for the reported failure: a project folder that is a git repository with no
 * commit used to fail deep inside worktree creation with
 * `fatal: invalid reference: projectos/plan-…`. Starting the plan must now create a baseline commit,
 * record it, and cut the worktree from it.
 */
describe('ADR-0050 starting a plan on an unborn repository', () => {
  it('creates the baseline commit, records it, and starts the run in an isolated worktree', async () => {
    const provider = new FakeProvider(() => ({ text: '已完成' }))
    const harness = setup(provider)
    cleanups.push(harness.close)
    const rootPath = unbornProjectDir()
    const project = await harness.services.projects.create({
      name: '演示系统',
      description: '空仓库基线回归',
      rootPath,
      createDirectory: false,
      initGit: false,
    })
    const draft = harness.orchestration.generatePlan(project.id, '实现第一个功能并自测')
    const approved = harness.orchestration.approvePlan(draft.id)

    await harness.scheduler.start(approved.plan.id, 1, 0)

    await waitFor(
      () => {
        const plan = harness.store.read.getPlanRevision(approved.plan.id)
        return Boolean(plan?.execution?.workspaceRef) || plan?.execution?.status === 'failed'
      },
      30_000,
      'worktree created',
    )
    const plan = harness.store.read.getPlanRevision(approved.plan.id)!
    expect(plan.execution?.status).not.toBe('failed')
    expect(plan.execution?.error ?? '').not.toContain('invalid reference')
    expect(plan.execution?.workspaceRef).toBeTruthy()
    expect(plan.execution?.baseCommit).toMatch(/^[0-9a-f]{40}$/)

    const events = harness.store.read.listEventViews(project.id, 50, 0)
    const baseline = events.find((event) => event.eventType === 'project.event' && event.summary.includes('基线提交'))
    expect(baseline, 'baseline commit event recorded').toBeTruthy()
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootPath, encoding: 'utf8' }).trim()).toMatch(/^[0-9a-f]{40}$/)
  })
})
