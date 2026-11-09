/**
 * ADR-0089 — verified-worktree auto-allow, verification command families and batch approvals.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { approvalKindOf, verifyCommandFamily } from '@projectos/policy'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import { verifyIsolatedWorktree } from '@projectos/worktree'
import { PlanGrantService } from '../apps/runtime/src/plan-grant.js'
import { ActionCenter } from '../apps/runtime/src/action-center.js'
import { ApprovalBatchService, approvalKind } from '../apps/runtime/src/approval-batch.js'
import { FakeProvider, createGitProject, logger, planWithTasks, setup } from './helpers/r1-fixture.js'
import { attachPlanWorktree } from './helpers/plan-worktree.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' })

function repo(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `po-${name}-`))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'README.md'), name)
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  return dir
}

function task(key: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key,
    title: `任务 ${key}`,
    description: `完成 ${key}`,
    role: 'developer',
    dependsOn: [],
    acceptanceCriteria: ['命令退出码为 0'],
    expectedArtifacts: ['代码 diff'],
    rationale: '实现',
    requiresApproval: true,
    ...overrides,
  }
}

describe('verifyIsolatedWorktree', () => {
  it('accepts only the registered linked worktree of the same repository on the plan branch', () => {
    const root = repo('iso')
    const wt = join(mkdtempSync(join(tmpdir(), 'po-wt-')), 'plan')
    git(root, 'worktree', 'add', '-q', '-b', 'projectos/plan-x', wt, 'HEAD')
    const ok = verifyIsolatedWorktree({ projectRoot: root, workspaceRoot: wt, registeredPath: wt, expectedBranch: 'projectos/plan-x' })
    expect(ok.ok, ok.reason).toBe(true)
    expect(ok.checks.every((check) => check.ok)).toBe(true)

    // Main working tree: never isolated, even when someone registers it.
    const main = verifyIsolatedWorktree({ projectRoot: root, workspaceRoot: root, registeredPath: root })
    expect(main.ok).toBe(false)
    expect(main.checks.at(-1)?.name).toBe('not-main-root')

    // Not registered for this plan / no registration at all.
    expect(verifyIsolatedWorktree({ projectRoot: root, workspaceRoot: wt, registeredPath: null }).checks.at(-1)?.name).toBe('registered')
    const other = join(mkdtempSync(join(tmpdir(), 'po-wt2-')), 'other')
    git(root, 'worktree', 'add', '-q', '-b', 'projectos/plan-y', other, 'HEAD')
    expect(verifyIsolatedWorktree({ projectRoot: root, workspaceRoot: other, registeredPath: wt }).checks.at(-1)?.name).toBe('registered')

    // Wrong branch for the plan.
    expect(verifyIsolatedWorktree({ projectRoot: root, workspaceRoot: wt, registeredPath: wt, expectedBranch: 'projectos/plan-z' }).checks.at(-1)?.name).toBe('branch')
  })

  it('rejects a fake worktree, a foreign repository and a symlink into the main tree', () => {
    const root = repo('fake')
    // A plain directory with a forged `.git` file pointing at the main repository's git dir.
    const fake = mkdtempSync(join(tmpdir(), 'po-fake-'))
    cleanups.push(() => rmSync(fake, { recursive: true, force: true }))
    writeFileSync(join(fake, '.git'), `gitdir: ${join(root, '.git')}\n`)
    const forged = verifyIsolatedWorktree({ projectRoot: root, workspaceRoot: fake, registeredPath: fake })
    expect(forged.ok).toBe(false)
    expect(['git-toplevel', 'linked-git-dir', 'listed']).toContain(forged.checks.at(-1)?.name)

    // A real linked worktree, but of a different repository.
    const foreign = repo('foreign')
    const foreignWt = join(mkdtempSync(join(tmpdir(), 'po-fwt-')), 'wt')
    git(foreign, 'worktree', 'add', '-q', '-b', 'b', foreignWt, 'HEAD')
    expect(verifyIsolatedWorktree({ projectRoot: root, workspaceRoot: foreignWt, registeredPath: foreignWt }).checks.at(-1)?.name).toBe('same-repository')

    // A separate clone is a full repository, not a linked worktree.
    const clone = mkdtempSync(join(tmpdir(), 'po-clone-'))
    cleanups.push(() => rmSync(clone, { recursive: true, force: true }))
    execFileSync('git', ['clone', '-q', root, join(clone, 'c')])
    expect(verifyIsolatedWorktree({ projectRoot: root, workspaceRoot: join(clone, 'c'), registeredPath: join(clone, 'c') }).checks.at(-1)?.name).toBe('linked-git-dir')

    // A symlink that resolves to the main working tree.
    const linkDir = mkdtempSync(join(tmpdir(), 'po-link-'))
    cleanups.push(() => rmSync(linkDir, { recursive: true, force: true }))
    const link = join(linkDir, 'ws')
    symlinkSync(root, link, 'dir')
    expect(verifyIsolatedWorktree({ projectRoot: root, workspaceRoot: link, registeredPath: link }).checks.at(-1)?.name).toBe('not-symlink')

    // A symlink to a genuine registered worktree is still refused (escape vector).
    const wt = join(mkdtempSync(join(tmpdir(), 'po-wt3-')), 'plan')
    git(root, 'worktree', 'add', '-q', '-b', 'projectos/plan-s', wt, 'HEAD')
    const link2 = join(linkDir, 'ws2')
    symlinkSync(wt, link2, 'dir')
    expect(verifyIsolatedWorktree({ projectRoot: root, workspaceRoot: link2, registeredPath: wt }).ok).toBe(false)
  })
})

describe('verification command families and approval kinds', () => {
  it('classifies only narrow verification commands', () => {
    expect(verifyCommandFamily('pnpm test')).toBe('test')
    expect(verifyCommandFamily('npm run test:unit -- --reporter=dot')).toBe('test')
    expect(verifyCommandFamily('pnpm exec vitest run tests/a.test.ts')).toBe('test')
    expect(verifyCommandFamily('pnpm lint')).toBe('lint')
    expect(verifyCommandFamily('npx eslint src')).toBe('lint')
    expect(verifyCommandFamily('pnpm typecheck')).toBe('typecheck')
    expect(verifyCommandFamily('npx tsc --noEmit -p tsconfig.json')).toBe('typecheck')
    expect(verifyCommandFamily('pnpm build')).toBe('build')
    for (const command of [
      'pnpm install', 'pnpm add left-pad', 'npm publish', 'pnpm lint --fix', 'pnpm test && rm -rf .',
      'pnpm test | tee x', 'pnpm build > out', 'git commit -am x', 'git push', 'curl https://x', 'node -e "1"',
      'pnpm dlx evil', 'npx some-tool', 'pnpm test $(whoami)', 'vitest', 'pnpm build --registry=https://x',
    ]) {
      expect(verifyCommandFamily(command), command).toBeNull()
    }
  })

  it('marks protected paths, git writes and arbitrary shell as non-batchable', () => {
    expect(approvalKindOf('write_file', { path: 'src/a.ts' })).toMatchObject({ key: 'write_file', batchable: true })
    expect(approvalKindOf('write_file', { path: '.env' }).batchable).toBe(false)
    expect(approvalKindOf('write_file', { path: 'config/secrets.json' }).batchable).toBe(false)
    expect(approvalKindOf('write_file', { path: '.git/config' }).batchable).toBe(false)
    expect(approvalKindOf('run_command', { command: 'pnpm test' })).toMatchObject({ key: 'command:test', batchable: true })
    expect(approvalKindOf('run_command', { command: 'rm -rf build' }).batchable).toBe(false)
    expect(approvalKindOf('git_commit', {}).batchable).toBe(false)
    expect(approvalKindOf('git_delivery', {}).batchable).toBe(false)
    expect(approvalKind({ request: { toolName: 'write_file', args: { path: 'src/auth/guard.ts' } } }).batchable).toBe(false)
    expect(approvalKind({ request: { toolName: 'write_file', args: { path: 'package.json' } } }).batchable).toBe(false)
    expect(approvalKind({ request: { kind: 'task-acceptance' } }).batchable).toBe(false)
  })
})

describe('plan grant + verified worktree', () => {
  async function granted(name: string) {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, name)
    const planned = planWithTasks(harness.orchestration, project.id, [task('dev')])
    const card = harness.store.read.getTaskCard(planned.taskIds[0]!)!
    const grants = new PlanGrantService(harness.store, logger)
    grants.issue({
      planId: planned.plan.id,
      actions: ['plan.start', 'workspace-write'],
      allowedPaths: ['.'],
      maxRuns: 1,
      maxToolCalls: 50,
      ttlHours: 1,
      allowOverBudget: false,
      note: '',
      confirm: true,
    })
    const worktree = attachPlanWorktree(harness.store, planned.plan.id, project.rootPath, harness.dataDir)
    const call = (toolName: string, args: Record<string, unknown>, workspaceRoot = worktree) =>
      grants.authorizeToolCall({
        projectId: project.id,
        workspaceRoot,
        taskId: card.id,
        runId: 'run_v2',
        agentId: card.assigneeAgentId!,
        toolName,
        toolCallId: `tol_${Math.random()}`,
        args,
      })
    return { harness, project, worktree, call, planId: planned.plan.id }
  }

  it('auto-allows writes and verification families only inside the verified worktree', async () => {
    const { project, call, harness, planId } = await granted('v2-auto-allow')
    expect(call('write_file', { path: 'src/a.ts', content: 'x' }).decision).toBe('allow')
    expect(call('run_command', { command: 'pnpm lint' }).decision).toBe('allow')
    expect(call('run_command', { command: 'pnpm typecheck' }).decision).toBe('allow')
    expect(call('run_command', { command: 'pnpm build' }).decision).toBe('allow')
    // Main workspace, protected/critical paths, arbitrary shell, git writes: always a human.
    expect(call('write_file', { path: 'src/a.ts', content: 'x' }, project.rootPath).decision).toBe('approval')
    expect(call('run_command', { command: 'pnpm test' }, project.rootPath).decision).toBe('approval')
    expect(call('write_file', { path: 'src/auth/session.ts', content: 'x' }).decision).toBe('approval')
    expect(call('write_file', { path: 'package.json', content: '{}' }).decision).toBe('approval')
    expect(call('run_command', { command: 'curl https://example.com' }).decision).toBe('approval')
    expect(call('git_commit', { message: 'x' }).decision).toBe('approval')
    // Every auto-allow is audited with its basis.
    const events = harness.store.db
      .prepare("SELECT payload_json FROM project_events WHERE aggregate_id=? AND event_type=?")
      .all(planId, PROJECT_EVENT_TYPES.planGrantConsumed) as Array<{ payload_json: string }>
    expect(events.length).toBeGreaterThanOrEqual(4)
    expect(events.every((event) => JSON.parse(event.payload_json).authorizationBasis === 'verified-worktree')).toBe(true)
    const rejected = harness.store.db
      .prepare("SELECT payload_json FROM project_events WHERE aggregate_id=? AND event_type=?")
      .all(planId, PROJECT_EVENT_TYPES.custom) as Array<{ payload_json: string }>
    expect(rejected.some((event) => JSON.parse(event.payload_json).kind === 'plan.grant.isolationRejected')).toBe(true)
  })

  it('honours the project toggle and the selected families', async () => {
    const { project, harness, call } = await granted('v2-toggle')
    const actions = new ActionCenter(harness.store, {} as never)
    expect(actions.autonomySettings(project.id).worktreeAutoAllow).toBe(true)
    actions.setAutonomySettings(project.id, { mode: 'autonomous', worktreeAutoAllowFamilies: ['test'] })
    expect(call('run_command', { command: 'pnpm test' }).decision).toBe('allow')
    expect(call('run_command', { command: 'pnpm build' }).decision).toBe('approval')
    actions.setAutonomySettings(project.id, { mode: 'autonomous', worktreeAutoAllow: false })
    expect(call('write_file', { path: 'src/b.ts', content: 'x' }).decision).toBe('approval')
    expect(call('run_command', { command: 'pnpm test' }).decision).toBe('approval')
  })

  it('falls back to approval when the worktree is removed or replaced by a symlink', async () => {
    const { project, worktree, call } = await granted('v2-removed')
    git(project.rootPath, 'worktree', 'remove', '--force', worktree)
    expect(existsSync(worktree)).toBe(false)
    mkdirSync(join(worktree, '..'), { recursive: true })
    symlinkSync(project.rootPath, worktree, 'dir')
    expect(call('write_file', { path: 'src/a.ts', content: 'x' }).decision).toBe('approval')
  })
})

describe('batch approvals', () => {
  async function pendingRuns(count: number, script: (index: number) => Record<string, unknown> | null) {
    const provider = new FakeProvider((call) => {
      if (call.hasToolResult) return { text: '完成' }
      const runIndex = Number(/RUN-(\d+)/.exec(JSON.stringify(call.messages))?.[1] ?? 0)
      const tool = script(runIndex)
      return tool ? { tool: tool as never } : { text: '完成' }
    })
    const harness = setup(provider)
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, `v2-batch-${count}-${Math.random().toString(36).slice(2, 6)}`)
    const agents = harness.store.read.listAgents()
    const runIds: string[] = []
    for (let index = 0; index < count; index += 1) {
      const session = harness.services.sessions.create(
        { projectId: project.id, agentId: agents[index % agents.length]!.id, title: `batch-${index}` },
        { kind: 'system', id: 'test', name: 'test' },
      )
      const run = await harness.runner.startRun({ projectId: project.id, sessionId: session.id, workspaceRoot: project.rootPath, prompt: `RUN-${index}` })
      runIds.push(run.runId ?? (run as unknown as { id: string }).id)
    }
    const waitPending = async (n: number) => {
      const started = Date.now()
      while (Date.now() - started < 10_000) {
        if (harness.store.read.listApprovalViews(project.id).filter((view) => view.status === 'pending').length >= n) return
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
    }
    await waitPending(count)
    const batch = new ApprovalBatchService(harness.store, {
      ownedElsewhere: () => false,
      decide: async (approvalId, decision, note) => {
        await harness.runner.decideApproval(approvalId, decision, note)
      },
    })
    return { harness, project, runIds, batch, provider }
  }

  it('approves a multi-selection item by item and skips non-batchable kinds', async () => {
    const { harness, project, batch } = await pendingRuns(3, (index) =>
      index === 2
        ? { name: 'run_command', args: { command: 'rm -rf build' } }
        : { name: 'write_file', args: { path: `src/batch-${index}.txt`, content: `b${index}` } },
    )
    const pending = harness.store.read.listApprovalViews(project.id).filter((view) => view.status === 'pending')
    expect(pending).toHaveLength(3)
    const result = await batch.decideBatch({
      projectId: project.id,
      decision: 'approved',
      note: '',
      approvalIds: pending.map((view) => view.id),
      rememberForRun: false,
    })
    expect(result.approved).toBe(2)
    expect(result.skipped).toBe(1)
    expect(result.outcomes.find((outcome) => outcome.status === 'skipped')?.reason).toContain('任意命令')
    const started = Date.now()
    while (Date.now() - started < 10_000 && !(existsSync(join(project.rootPath, 'src/batch-1.txt')))) {
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    expect(readFileSync(join(project.rootPath, 'src/batch-0.txt'), 'utf8')).toBe('b0')
    expect(readFileSync(join(project.rootPath, 'src/batch-1.txt'), 'utf8')).toBe('b1')
    // Already-decided ids in a later batch are reported, never re-applied.
    const again = await batch.decideBatch({ projectId: project.id, decision: 'approved', note: '', approvalIds: [pending[0]!.id], rememberForRun: false })
    expect(again.outcomes[0]!.status).toBe('skipped')
    // Rejection works for any kind, including arbitrary shell.
    const shell = harness.store.read.listApprovalViews(project.id).find((view) => view.status === 'pending')!
    const rejected = await batch.decideBatch({ projectId: project.id, decision: 'rejected', note: 'no', approvalIds: [shell.id], rememberForRun: false })
    expect(rejected.rejected).toBe(1)
  })

  it('"approve the rest of this kind in this Run" also covers later requests of that kind only', async () => {
    let writes = 0
    const provider = new FakeProvider((call) => {
      const results = call.toolResults.length
      if (results === 0) return { tool: { name: 'write_file', args: { path: 'src/k1.txt', content: '1' } } }
      if (results === 1) return { tool: { name: 'write_file', args: { path: 'src/k2.txt', content: '2' } } }
      if (results === 2) return { tool: { name: 'run_command', args: { command: 'pnpm test' } } }
      writes += 1
      return { text: '完成' }
    })
    const harness = setup(provider)
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'v2-batch-kind')
    const agent = harness.store.read.listAgents()[0]!
    const session = harness.services.sessions.create({ projectId: project.id, agentId: agent.id, title: 'kind' }, { kind: 'system', id: 'test', name: 'test' })
    await harness.runner.startRun({ projectId: project.id, sessionId: session.id, workspaceRoot: project.rootPath, prompt: 'kind' })
    const waitFor = async (predicate: () => boolean) => {
      const started = Date.now()
      while (Date.now() - started < 10_000 && !predicate()) await new Promise((resolve) => setTimeout(resolve, 40))
    }
    const pending = () => harness.store.read.listApprovalViews(project.id).filter((view) => view.status === 'pending')
    await waitFor(() => pending().length === 1)
    const anchor = pending()[0]!
    const batch = new ApprovalBatchService(harness.store, {
      ownedElsewhere: () => false,
      decide: async (approvalId, decision, note) => {
        await harness.runner.decideApproval(approvalId, decision, note)
      },
    })
    const result = await batch.decideBatch({ projectId: project.id, decision: 'approved', note: '', sameKindAs: anchor.id, rememberForRun: true })
    expect(result.approved).toBe(1)
    expect(result.rememberedKind).toMatchObject({ key: 'write_file' })
    // The second write runs without asking; the test command is a different kind and still asks.
    await waitFor(() => existsSync(join(project.rootPath, 'src/k2.txt')) && pending().length === 1)
    expect(readFileSync(join(project.rootPath, 'src/k2.txt'), 'utf8')).toBe('2')
    expect(pending()).toHaveLength(1)
    expect(pending()[0]!.kind ?? approvalKind(pending()[0]!)).toMatchObject({ key: 'command:test' })
    expect(writes).toBe(0)
  })
})

describe('dispatcher wiring and next actions', () => {
  it('exposes approval kinds, batch decisions and plan-review actions with real routes', async () => {
    const { RuntimeDispatcher } = await import('../apps/runtime/src/dispatcher.js')
    const provider = new FakeProvider((call) =>
      call.hasToolResult ? { text: '完成' } : { tool: { name: 'write_file', args: { path: 'src/d.txt', content: 'd' } } },
    )
    const harness = setup(provider)
    cleanups.push(harness.close)
    const dispatcher = new RuntimeDispatcher({
      config: harness.config,
      store: harness.store,
      services: harness.services,
      runner: harness.runner,
      provider: harness.provider,
      hub: harness.hub,
      logger,
      startedAt: Date.now(),
      shutdown: () => undefined,
    })
    cleanups.push(() => dispatcher.shutdownOrchestrations())
    const project = await createGitProject(harness.services, harness.dataDir, 'v2-dispatch')
    const draft = harness.orchestration.generatePlan(project.id, '一个等待审核的计划')
    const agent = harness.store.read.listAgents()[0]!
    const session = harness.services.sessions.create({ projectId: project.id, agentId: agent.id, title: 'd' }, { kind: 'system', id: 'test', name: 'test' })
    await harness.runner.startRun({ projectId: project.id, sessionId: session.id, workspaceRoot: project.rootPath, prompt: 'd' })
    const started = Date.now()
    while (Date.now() - started < 10_000 && harness.store.read.listApprovalViews(project.id).length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    const listed = (await dispatcher.dispatch('approval.list', { projectId: project.id })) as { approvals: Array<{ id: string; kind?: { key: string } }> }
    expect(listed.approvals[0]!.kind?.key).toBe('write_file')

    const center = (await dispatcher.dispatch('action.center', { projectId: project.id })) as { items: Array<{ kind: string; route: string; planId: string | null }> }
    const review = center.items.find((item) => item.kind === 'plan_review')
    expect(review?.planId).toBe(draft.id)
    expect(review?.route).toBe(`/projects/${project.id}/orchestration?plan=${draft.id}`)
    expect(center.items.every((item) => !item.route.includes('/plans?'))).toBe(true)
    expect(center.items[0]!.kind).toBe('tool_approval')

    const result = (await dispatcher.dispatch('approval.decideBatch', {
      projectId: project.id,
      decision: 'approved',
      approvalIds: [listed.approvals[0]!.id],
    })) as { approved: number }
    expect(result.approved).toBe(1)
    await expect(dispatcher.dispatch('approval.decideBatch', { projectId: project.id, decision: 'approved' })).rejects.toBeTruthy()
  })
})
