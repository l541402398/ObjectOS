import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CreateTaskInputSchema } from '@projectos/contracts'
import { RequirementWorkService } from '../apps/runtime/src/requirement-work.js'
import { RequirementIntegrationService } from '../apps/runtime/src/requirement-integration.js'
import { assertIntegratedDependencies, gitText } from '../apps/runtime/src/requirement-git.js'
import { createGitProject, setup, waitFor } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })
async function fixture() {
  const h = setup()
  cleanups.push(() => { h.close(); rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })
  const project = await createGitProject(h.services, h.dataDir, 'integration')
  const work = new RequirementWorkService(h.store, h.dataDir), integration = new RequirementIntegrationService(h.store)
  const requirement = h.services.projects.createRequirement({ projectId: project.id, title: '可靠存储', body: '保存后可以恢复', source: 'local', acceptanceCriteria: ['可恢复'] })
  const task = (title = '实现存储', dependsOn: string[] = []) => h.services.tasks.create(CreateTaskInputSchema.parse({ projectId: project.id, requirementId: requirement.id, title, assigneeAgentId: 'agt_engineer', acceptanceCriteria: ['测试通过'], dependsOn }))
  const prepare = async (taskId: string) => {
    const op = work.request({ taskId, expectedVersion: h.store.read.getTask(taskId)!.version })
    await work.decide(op.approvalId, 'approved', '准备开发目录')
    return h.store.read.getTaskWorkspace(taskId)!.rootPath
  }
  const accept = (taskId: string) => h.services.tasks.move({ taskId, expectedVersion: h.store.read.getTask(taskId)!.version, to: 'done', note: '本机所有者验收任务结果' })
  const verify = async (taskId: string, command = 'node --test check.test.cjs') => {
    const op = integration.request({ taskId, kind: 'verify', fingerprint: integration.preview(taskId).fingerprint, command })
    await integration.decide(op.approvalId, 'approved', '运行实际验证')
    await waitFor(() => ['completed','failed','needs_reconciliation'].includes(h.store.read.getRun(op.runId)?.status ?? ''))
    return op
  }
  const review = (taskId: string) => integration.recordReview({ taskId, fingerprint: integration.preview(taskId).fingerprint, note: '已检查代码、测试和验收范围，审查通过' })
  return { ...h, project, requirement, work, integration, task, prepare, accept, verify, review }
}

function code(root: string, value = 'safe') {
  writeFileSync(join(root, 'storage.cjs'), `module.exports = '${value}'\n`)
  writeFileSync(join(root, 'check.test.cjs'), "const assert = require('node:assert/strict'); require('node:test')('stored value', () => assert.equal(require('./storage.cjs'), 'safe'))\n")
}

describe('reviewed requirement task integration', () => {
  it('uses real reviewed, verified output; separately approves integration and prepares a dependent task with that content', async () => {
    const f = await fixture(), task = f.task(), dependent = f.task('读取存储', [task.id])
    const root = await f.prepare(task.id); code(root); f.accept(task.id)
    expect(() => f.work.request({ taskId: dependent.id, expectedVersion: dependent.version })).toThrow(/前置依赖/)
    expect(f.integration.preview(task.id).verification.passed).toBe(false)
    f.review(task.id); const verify = await f.verify(task.id)
    expect(f.store.read.getRunDetail(verify.runId)?.toolCalls[0]?.result).toMatchObject({ exitCode: 0, unchanged: true })
    const preview = f.integration.preview(task.id)
    expect(preview.review.approved).toBe(true); expect(preview.verification.passed).toBe(true)
    const target = f.work.view(f.requirement.id).workspaces.find(w => w.kind === 'integration')!
    const base = gitText(target.rootPath, 'rev-parse', 'HEAD')
    const op = f.integration.request({ taskId: task.id, kind: 'integrate', fingerprint: preview.fingerprint })
    expect(gitText(target.rootPath, 'rev-parse', 'HEAD')).toBe(base)
    expect(existsSync(join(target.rootPath, 'storage.cjs'))).toBe(false)
    await f.integration.decide(op.approvalId, 'approved', '只批准合入需求分支')
    expect(f.integration.list(f.requirement.id).find(i => i.id === op.id)?.status).toBe('completed')
    expect(readFileSync(join(target.rootPath, 'storage.cjs'), 'utf8')).toContain('safe')
    expect(existsSync(join(f.project.rootPath, 'storage.cjs'))).toBe(false)
    expect(f.store.read.getRequirement(f.requirement.id)?.status).toBe('draft')
    const integrated = f.integration.preview(task.id)
    expect(integrated.integrated).toBe(true)
    expect(() => f.integration.request({ taskId: task.id, kind: 'integrate', fingerprint: integrated.fingerprint })).toThrow(/已合入需求/)
    const nextRoot = await f.prepare(dependent.id)
    expect(nextRoot).not.toBe(root)
    expect(readFileSync(join(nextRoot, 'storage.cjs'), 'utf8')).toContain('safe')
    expect(assertIntegratedDependencies(f.store, f.store.read.getTask(dependent.id)!, nextRoot)).toHaveLength(1)
    await expect(f.integration.decide(op.approvalId, 'approved', '重复')).rejects.toThrow(/已处理/)
  }, 30_000)

  it.each(['file', 'target', 'document', 'task', 'expiry', 'cancel'] as const)('rejects changed %s conditions before Git mutation', async change => {
    const f = await fixture(), task = f.task(), root = await f.prepare(task.id)
    code(root); f.accept(task.id); f.review(task.id); await f.verify(task.id)
    const preview = f.integration.preview(task.id), target = f.work.view(f.requirement.id).workspaces.find(w => w.kind === 'integration')!
    const op = f.integration.request({ taskId: task.id, kind: 'integrate', fingerprint: preview.fingerprint })
    if (change === 'file') writeFileSync(join(root, 'storage.cjs'), "module.exports = 'changed'\n")
    if (change === 'target') { writeFileSync(join(target.rootPath, 'unrelated.txt'), 'new'); gitText(target.rootPath, 'add', '.'); gitText(target.rootPath, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'changed target') }
    if (change === 'document') f.work.update({ requirementId: f.requirement.id, expectedVersion: 0, title: '变更需求', body: 'new', technicalDesign: '', acceptanceCriteria: [] })
    if (change === 'task') f.services.tasks.update({ taskId: task.id, expectedVersion: f.store.read.getTask(task.id)!.version, title: '变更任务' })
    if (change === 'expiry') f.store.db.prepare('UPDATE approvals SET expires_at=? WHERE id=?').run(Date.now() - 1, op.approvalId)
    if (change === 'cancel') f.store.updateRun(op.runId, { status: 'cancelled', finishedAt: Date.now() })
    const sourceHead = gitText(root, 'rev-parse', 'HEAD'), targetHead = gitText(target.rootPath, 'rev-parse', 'HEAD')
    await expect(f.integration.decide(op.approvalId, 'approved', '过期条件')).rejects.toThrow()
    expect(gitText(root, 'rev-parse', 'HEAD')).toBe(sourceHead)
    expect(gitText(target.rootPath, 'rev-parse', 'HEAD')).toBe(targetHead)
    expect(f.integration.list(f.requirement.id).find(i => i.id === op.id)?.status).toBe('failed')
  }, 30_000)

  it('retains failed verification and invalidates old passing evidence on source edits', async () => {
    const f = await fixture(), task = f.task(), root = await f.prepare(task.id)
    code(root, 'bad'); f.accept(task.id)
    await f.verify(task.id)
    const failed = f.integration.preview(task.id)
    expect(failed.verification.passed).toBe(false)
    expect(() => f.integration.request({ taskId: task.id, kind: 'integrate', fingerprint: failed.fingerprint })).toThrow(/验证/)
    code(root); await f.verify(task.id)
    expect(f.integration.preview(task.id).verification.passed).toBe(true)
    writeFileSync(join(root, 'later.txt'), 'not tested')
    const changed = f.integration.preview(task.id)
    expect(changed.verification.passed).toBe(false)
    expect(f.integration.list(f.requirement.id).some(op => op.status === 'failed')).toBe(true)
  }, 30_000)

  it('does not count a renderer-supplied review snapshot as a trusted human review', async () => {
    const f = await fixture(), task = f.task(), root = await f.prepare(task.id)
    code(root); f.accept(task.id); f.review(task.id)
    const artifact = f.store.read.listArtifacts(f.project.id, task.id).find(a => a.metadata?.artifactType === 'review')!
    f.store.db.prepare('DELETE FROM task_integration_reviews WHERE artifact_id=?').run(artifact.id)
    expect(f.integration.preview(task.id).review.approved).toBe(false)
  })

  it('rejects sensitive content and keeps rejected approval terminal without writes', async () => {
    const f = await fixture(), task = f.task(), root = await f.prepare(task.id)
    writeFileSync(join(root, 'private.key'), 'not a real key')
    expect(() => f.integration.preview(task.id)).toThrow(/受保护/)
    rmSync(join(root, 'private.key')); code(root); f.accept(task.id)
    const op = f.integration.request({ taskId: task.id, kind: 'verify', fingerprint: f.integration.preview(task.id).fingerprint, command: 'node --test check.test.cjs' })
    await f.integration.decide(op.approvalId, 'rejected', '不运行')
    expect(f.store.read.getRun(op.runId)?.status).toBe('cancelled')
    expect(f.integration.preview(task.id).verification.passed).toBe(false)
  })

  it('serializes operations per requirement and never replays an interrupted operation', async () => {
    const f = await fixture(), a = f.task(), b = f.task('第二项')
    code(await f.prepare(a.id)); code(await f.prepare(b.id)); f.accept(a.id); f.accept(b.id)
    const op = f.integration.request({ taskId: a.id, kind: 'verify', fingerprint: f.integration.preview(a.id).fingerprint, command: 'node --test check.test.cjs' })
    expect(() => f.integration.request({ taskId: b.id, kind: 'verify', fingerprint: f.integration.preview(b.id).fingerprint, command: 'node --test' })).toThrow(/待审批/)
    f.store.db.prepare("UPDATE task_integration_operations SET status='executing' WHERE id=?").run(op.id)
    const recovered = new RequirementIntegrationService(f.store)
    expect(recovered.list(f.requirement.id).find(i => i.id === op.id)?.status).toBe('needs_reconciliation')
    expect(f.store.read.getRun(op.runId)?.status).toBe('needs_reconciliation')
    expect(() => recovered.reconcile(op.id)).toThrow(/人工核对/)
  })

  it('does not release a task to an Agent while a cancelled verification still has executing effects', async () => {
    const f = await fixture(), task = f.task(), root = await f.prepare(task.id)
    code(root)
    const op = f.integration.request({ taskId: task.id, kind: 'verify', fingerprint: f.integration.preview(task.id).fingerprint, command: 'node --test check.test.cjs' })
    // Fault injection: the UI has cancelled the Run, but the approved command has not settled.
    f.store.db.prepare("UPDATE task_integration_operations SET status='executing' WHERE id=?").run(op.id)
    f.store.updateRun(op.runId, { status: 'cancelled', finishedAt: Date.now() })
    const session = f.services.sessions.create({ projectId: f.project.id, agentId: 'agt_engineer', title: '抢占工作区' })
    await expect(f.runner.startRun({ projectId: f.project.id, taskId: task.id, sessionId: session.id, prompt: '开始执行' })).rejects.toThrow(/成果审批、执行或待核对/)
  })

  it.each(['before-commit', 'after-merge'] as const)('reconciles interruption %s without repeating any Git write', async point => {
    const f = await fixture(), task = f.task(), root = await f.prepare(task.id)
    code(root); f.accept(task.id); f.review(task.id); await f.verify(task.id)
    const op = f.integration.request({ taskId: task.id, kind: 'integrate', fingerprint: f.integration.preview(task.id).fingerprint })
    const target = f.work.view(f.requirement.id).workspaces.find(w => w.kind === 'integration')!.rootPath
    f.store.decideApproval(op.approvalId, 'approved', '模拟已批准后进程中断')
    f.store.db.prepare("UPDATE task_integration_operations SET status='executing' WHERE id=?").run(op.id)
    if (point === 'after-merge') {
      gitText(root, 'add', '.')
      gitText(root, '-c', 'user.name=ProjectOS', '-c', 'user.email=projectos@local', 'commit', '-qm', `ProjectOS task ${task.id} [${op.id}]`)
      const source = gitText(root, 'rev-parse', 'HEAD')
      gitText(target, '-c', 'user.name=ProjectOS', '-c', 'user.email=projectos@local', 'merge', '--no-ff', '-m', `ProjectOS integrate ${task.id} [${op.id}]`, source)
    }
    const before = [gitText(root, 'rev-parse', 'HEAD'), gitText(target, 'rev-parse', 'HEAD'), gitText(root, 'status', '--porcelain')]
    const recovered = new RequirementIntegrationService(f.store)
    expect(recovered.reconcile(op.id).status).toBe(point === 'after-merge' ? 'completed' : 'failed')
    expect([gitText(root, 'rev-parse', 'HEAD'), gitText(target, 'rev-parse', 'HEAD'), gitText(root, 'status', '--porcelain')]).toEqual(before)
  }, 30_000)

  it('aborts a conflicting merge and preserves both accepted task commits', async () => {
    const f = await fixture(), first = f.task(), second = f.task('另一项修改')
    const a = await f.prepare(first.id), b = await f.prepare(second.id)
    code(a); code(b)
    writeFileSync(join(b, 'storage.cjs'), "module.exports = String('safe')\n")
    f.accept(first.id); f.accept(second.id)
    for (const task of [first, second]) {
      f.review(task.id); await f.verify(task.id)
      const op = f.integration.request({ taskId: task.id, kind: 'integrate', fingerprint: f.integration.preview(task.id).fingerprint })
      await f.integration.decide(op.approvalId, 'approved', '批准独立任务合入')
      expect(f.integration.list(f.requirement.id).find(i => i.id === op.id)?.status).toBe(task.id === first.id ? 'completed' : 'failed')
    }
    const target = f.work.view(f.requirement.id).workspaces.find(w => w.kind === 'integration')!.rootPath
    expect(readFileSync(join(target, 'storage.cjs'), 'utf8').replace(/\r\n/g, '\n')).toBe("module.exports = 'safe'\n")
    expect(readFileSync(join(b, 'storage.cjs'), 'utf8')).toBe("module.exports = String('safe')\n")
    expect(gitText(target, 'status', '--porcelain')).toBe('')
    expect(f.integration.list(f.requirement.id).some(op => op.error?.includes('合并冲突'))).toBe(true)
  }, 60_000)
})
