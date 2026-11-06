import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CreateTaskInputSchema, RequirementWorkViewSchema } from '@projectos/contracts'
import { WorktreeManager } from '@projectos/worktree'
import { RequirementWorkService, managedTaskRoot } from '../apps/runtime/src/requirement-work.js'
import { createGitProject, FakeProvider, setup, waitFor } from './helpers/r1-fixture.js'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()?.() })
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim()

async function fixture(fake?: FakeProvider) {
  const h = setup(fake)
  cleanup.push(() => { h.close(); rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })
  const project = await createGitProject(h.services, h.dataDir, 'requirements')
  const work = new RequirementWorkService(h.store, h.dataDir)
  const requirement = h.services.projects.createRequirement({ projectId: project.id, title: '离线笔记', body: '离线编辑正文', source: 'local', acceptanceCriteria: ['离线可用'] })
  const task = (title = '实现编辑', dependsOn: string[] = []) => h.services.tasks.create(CreateTaskInputSchema.parse({ projectId: project.id, title, requirementId: requirement.id, acceptanceCriteria: ['单元测试通过'], assigneeAgentId: 'agt_engineer', dependsOn }))
  return { ...h, work, project, requirement, task }
}

describe('requirement delivery scope and isolated development work', () => {
  it('prepares real task worktrees under a deep data root using compact destinations', async () => {
    const f = await fixture(), task = f.task()
    const dataRoot = join(f.dataDir, 'desktop-profile-with-a-long-name-'.repeat(2))
    mkdirSync(dataRoot, { recursive: true })
    const work = new RequirementWorkService(f.store, dataRoot)
    const op = work.request({ taskId: task.id, expectedVersion: task.version })
    const before = git(f.project.rootPath, 'rev-parse', 'HEAD')
    await work.decide(op.approvalId, 'approved', '验证真实长路径场景')
    const record = f.store.read.getTaskWorkspace(task.id)!
    expect(record.rootPath.length).toBeLessThan(dataRoot.length + 60)
    expect(git(record.rootPath, 'rev-parse', 'HEAD')).toBe(before)
    expect(managedTaskRoot(f.store, task)).toBe(record.rootPath)
    expect(git(f.project.rootPath, 'rev-parse', 'HEAD')).toBe(before)
  }, 30_000)

  it('never stages or commits an unborn project while preparing an approval preview', async () => {
    const f = await fixture()
    const project = await f.services.projects.create({ name: 'unborn preview', description: '', rootPath: join(f.dataDir, 'unborn'), createDirectory: true, initGit: true })
    const requirement = f.services.projects.createRequirement({ projectId: project.id, title: '无初始提交', body: '', source: 'local', acceptanceCriteria: [] })
    const task = f.services.tasks.create(CreateTaskInputSchema.parse({ projectId: project.id, requirementId: requirement.id, title: '不得自动提交', acceptanceCriteria: ['原内容不变'] }))
    writeFileSync(join(project.rootPath, '.env'), 'LOCAL_TEST_SECRET=not-for-git\n')
    const before = git(project.rootPath, 'status', '--porcelain=v1', '-uall')
    expect(() => f.work.request({ taskId: task.id, expectedVersion: task.version })).toThrow(/代码基线/)
    expect(git(project.rootPath, 'status', '--porcelain=v1', '-uall')).toBe(before)
    expect(git(project.rootPath, 'diff', '--cached', '--name-only')).toBe('')
  })

  it('retains legacy tasks, rejects foreign requirement links and uses optimistic document edits', async () => {
    const f = await fixture()
    const old = f.services.tasks.create(CreateTaskInputSchema.parse({ projectId: f.project.id, title: '历史任务' }))
    expect(old.requirementId).toBeNull()
    expect(managedTaskRoot(f.store, old)).toBeNull()
    const other = f.services.projects.createRequirement({ projectId: f.project.id, title: '其他需求', body: '', source: 'local', acceptanceCriteria: [] })
    const project2 = await createGitProject(f.services, f.dataDir, 'second')
    expect(() => f.services.tasks.create(CreateTaskInputSchema.parse({ projectId: project2.id, title: '错误项目', requirementId: f.requirement.id,  }))).toThrow(/需求/)
    const updated = f.work.update({ requirementId: f.requirement.id, expectedVersion: 0, title: '离线笔记', body: '正文 v2', technicalDesign: '事务保存', acceptanceCriteria: ['保存可恢复'] })
    expect(updated.designVersion).toBe(1)
    expect(updated.status).toBe('draft')
    expect(() => f.work.update({ requirementId: updated.id, expectedVersion: 0, title: '旧编辑', body: '', technicalDesign: '', acceptanceCriteria: [] })).toThrow(/更新/)
    expect(() => RequirementWorkViewSchema.parse(f.work.view(updated.id))).not.toThrow()
    const linked = f.task()
    expect(() => f.store.db.prepare('UPDATE tasks SET requirement_id=? WHERE id=?').run(other.id, linked.id)).toThrow(/immutable/)
    expect(() => f.services.tasks.update({ taskId: linked.id, expectedVersion: 0, workType: 'review' })).toThrow(/工作类型/)
  })

  it('does not mutate Git before approval; rejection is terminal and re-request has a fresh approval', async () => {
    const f = await fixture(), task = f.task()
    const before = git(f.project.rootPath, 'worktree', 'list', '--porcelain')
    const op = f.work.request({ taskId: task.id, expectedVersion: task.version })
    expect(f.work.request({ taskId: task.id, expectedVersion: task.version }).id).toBe(op.id)
    expect(git(f.project.rootPath, 'worktree', 'list', '--porcelain')).toBe(before)
    expect(f.store.read.getRunDetail(op.runId)?.toolCalls[0]?.status).toBe('waiting_approval')
    await f.work.decide(op.approvalId, 'rejected', '暂不创建')
    expect(f.work.view(f.requirement.id).preparations[0]?.status).toBe('rejected')
    await expect(f.work.decide(op.approvalId, 'approved', '')).rejects.toThrow(/已处理/)
    expect(git(f.project.rootPath, 'worktree', 'list', '--porcelain')).toBe(before)
    expect(f.work.request({ taskId: task.id, expectedVersion: task.version }).approvalId).not.toBe(op.approvalId)
  })

  it('creates two separate task worktrees on one frozen requirement base and preserves them on reassignment', async () => {
    const f = await fixture(), first = f.task(), second = f.task('实现搜索')
    for (const task of [first, second]) {
      const op = f.work.request({ taskId: task.id, expectedVersion: task.version })
      await f.work.decide(op.approvalId, 'approved', '只批准准备')
      expect(f.store.read.getRun(op.runId)?.status).toBe('completed')
      await expect(f.work.decide(op.approvalId, 'approved', '')).rejects.toThrow(/已处理/)
    }
    const view = f.work.view(f.requirement.id)
    expect(view.workspaces).toHaveLength(3)
    const a = f.store.read.getTaskWorkspace(first.id)!, b = f.store.read.getTaskWorkspace(second.id)!
    expect(a.rootPath).not.toBe(b.rootPath)
    expect(a.baseCommit).toBe(b.baseCommit)
    writeFileSync(join(a.rootPath, 'only-a.txt'), 'only A')
    expect(existsSync(join(b.rootPath, 'only-a.txt'))).toBe(false)
    expect(existsSync(join(f.project.rootPath, 'only-a.txt'))).toBe(false)
    expect(() => managedTaskRoot(f.store, first, f.project.rootPath)).toThrow(/独立工作区/)
    const reassigned = f.services.tasks.update({ taskId: first.id, expectedVersion: first.version, assigneeAgentId: 'agt_architect' })
    expect(managedTaskRoot(f.store, reassigned)).toBe(a.rootPath)
  })

  it.each(['documents', 'base', 'task', 'expiry', 'cancel'] as const)('refuses a stale %s approval without creating workspaces', async change => {
    const f = await fixture(), task = f.task()
    const op = f.work.request({ taskId: task.id, expectedVersion: task.version })
    if (change === 'documents') f.work.update({ requirementId: f.requirement.id, expectedVersion: 0, title: '变更需求', body: 'new', technicalDesign: '', acceptanceCriteria: [] })
    if (change === 'base') { writeFileSync(join(f.project.rootPath, 'change.txt'), 'new'); git(f.project.rootPath, 'add', '.'); git(f.project.rootPath, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'new base') }
    if (change === 'task') f.services.tasks.update({ taskId: task.id, expectedVersion: 0, title: '变更任务' })
    if (change === 'expiry') f.store.db.prepare('UPDATE approvals SET expires_at=? WHERE id=?').run(Date.now() - 1, op.approvalId)
    if (change === 'cancel') f.store.updateRun(op.runId, { status: 'cancelled', finishedAt: Date.now() })
    await expect(f.work.decide(op.approvalId, 'approved', '')).rejects.toThrow()
    expect(f.work.view(f.requirement.id).workspaces).toHaveLength(0)
    expect(f.work.view(f.requirement.id).preparations[0]?.status).toBe('failed')
    expect(f.store.getApprovalById(op.approvalId)?.status).toBe('expired')
  })

  it('does not prepare tasks with unintegrated dependencies or a dirty base', async () => {
    const f = await fixture(), a = f.task(), b = f.task('依赖编辑', [a.id])
    expect(() => f.work.request({ taskId: b.id, expectedVersion: b.version })).toThrow(/前置依赖/)
    writeFileSync(join(f.project.rootPath, 'dirty.txt'), 'pending')
    expect(() => f.work.request({ taskId: a.id, expectedVersion: a.version })).toThrow(/未提交/)
    expect(f.work.view(f.requirement.id).preparations).toHaveLength(0)
  })

  it('marks interrupted preparation unknown and never retries or cleans up automatically', async () => {
    const f = await fixture(), task = f.task()
    const op = f.work.request({ taskId: task.id, expectedVersion: task.version })
    f.store.db.prepare("UPDATE task_workspace_preparations SET status='executing' WHERE id=?").run(op.id)
    const recovered = new RequirementWorkService(f.store, f.dataDir)
    expect(recovered.view(f.requirement.id).preparations[0]?.status).toBe('needs_reconciliation')
    expect(f.store.read.getRun(op.runId)?.status).toBe('needs_reconciliation')
    expect(recovered.request({ taskId: task.id, expectedVersion: task.version }).id).toBe(op.id)
    await expect(recovered.decide(op.approvalId, 'approved', '')).rejects.toThrow(/已处理/)
    expect(recovered.view(f.requirement.id).workspaces).toHaveLength(0)
  })

  it('never adopts an unknown branch or directory during pinned worktree creation', async () => {
    const f = await fixture(), manager = new WorktreeManager()
    const base = git(f.project.rootPath, 'rev-parse', 'HEAD')
    const root = join(f.dataDir, 'pinned')
    await manager.create(f.project.rootPath, root, 'projectos/pinned', base)
    await expect(manager.create(f.project.rootPath, root, 'projectos/pinned', base)).rejects.toThrow(/已存在/)
    await expect(manager.create(f.project.rootPath, join(f.dataDir, 'other'), 'projectos/pinned', base)).rejects.toThrow(/分支已存在/)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(base)
  })

  it.each([false, true])('reconciles interrupted preparation from actual state without repeating writes (task created: %s)', async taskWasCreated => {
    const f = await fixture(), task = f.task()
    class InterruptedManager extends WorktreeManager {
      calls = 0
      override async create(...args: Parameters<WorktreeManager['create']>) {
        this.calls++
        if (this.calls === 2 && !taskWasCreated) throw new Error('interrupted before task creation')
        const result = await super.create(...args)
        if (this.calls === 2) throw new Error('interrupted after task creation')
        return result
      }
    }
    const manager = new InterruptedManager(), work = new RequirementWorkService(f.store, f.dataDir, manager)
    const op = work.request({ taskId: task.id, expectedVersion: task.version })
    await expect(work.decide(op.approvalId, 'approved', '准备')).rejects.toThrow(/interrupted/)
    const before = git(f.project.rootPath, 'worktree', 'list', '--porcelain')
    const result = work.reconcile(op.id)
    expect(result.status).toBe(taskWasCreated ? 'completed' : 'failed')
    expect(manager.calls).toBe(2)
    expect(git(f.project.rootPath, 'worktree', 'list', '--porcelain')).toBe(before)
    if (taskWasCreated) expect(managedTaskRoot(f.store, task)).toBeTruthy()
    else expect(work.request({ taskId: task.id, expectedVersion: task.version }).id).not.toBe(op.id)
    await expect(work.decide(op.approvalId, 'approved', '')).rejects.toThrow(/已处理/)
  })

  it('runs native tools only in the task root, with an independent write approval and frozen documents', async () => {
    const fake = new FakeProvider(call => call.hasToolResult ? { text: '写入已完成，请人工检查' } : { tool: { name: 'write_file', args: { path: 'task-output.txt', content: 'isolated output' } } })
    const f = await fixture(fake), task = f.task()
    const session = f.services.sessions.create({ projectId: f.project.id, agentId: 'agt_engineer', title: '任务运行' })
    const start = { projectId: f.project.id, taskId: task.id, sessionId: session.id, prompt: '执行任务' }
    await expect(f.runner.startRun(start)).rejects.toThrow(/独立工作区/)
    const prep = f.work.request({ taskId: task.id, expectedVersion: task.version })
    await f.work.decide(prep.approvalId, 'approved', '仅准备')
    const { runId } = await f.runner.startRun(start)
    await waitFor(() => f.store.read.getRun(runId)?.status === 'waiting_approval')
    const approval = f.store.read.listApprovalViews(f.project.id, runId).find(a => a.status === 'pending')!
    const root = f.store.read.getTaskWorkspace(task.id)!.rootPath
    expect(existsSync(join(root, 'task-output.txt'))).toBe(false)
    expect(approval.id).not.toBe(prep.approvalId)
    expect(fake.calls[0]?.messages[0]?.content).toContain('离线编辑正文')
    f.work.update({ requirementId: f.requirement.id, expectedVersion: 0, title: '新名称', body: '不应注入本次运行', technicalDesign: '', acceptanceCriteria: [] })
    await f.runner.decideApproval(approval.id, 'approved', '写入任务目录')
    await waitFor(() => ['completed', 'failed'].includes(f.store.read.getRun(runId)?.status ?? ''))
    expect(readFileSync(join(root, 'task-output.txt'), 'utf8')).toBe('isolated output')
    expect(existsSync(join(f.project.rootPath, 'task-output.txt'))).toBe(false)
    expect(fake.calls.at(-1)?.messages[0]?.content).not.toContain('不应注入本次运行')
  }, 30_000)
})
